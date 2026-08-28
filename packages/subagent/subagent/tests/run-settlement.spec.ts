/**
 * 文件职责：验证 run-settlement.spec.ts 覆盖的子代理结算行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的子代理结算能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  settleRun,
  settleRunResult,
} from '../src/index.ts'

/** 中文说明：常量 MAX_SUBAGENT_DIAGNOSTIC_BYTES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MAX_SUBAGENT_DIAGNOSTIC_BYTES = 4_096

describe('outcome mapping helpers', () => {
  it.each([
    ['completed', { status: 'completed', output: 'partial' }],
    ['aborted', { status: 'killed' }],
    ['error', { status: 'failed', detail: 'error' }],
    ['max-tokens', { status: 'failed', detail: 'max-tokens' }],
    ['refusal', { status: 'failed', detail: 'refusal' }],
    ['paused', { status: 'failed', detail: 'paused' }],
  ] as const)('settleRun maps the %s stop reason onto its Task outcome', async (stopReason, expected) => {
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = [{ type: 'text' as const, text: 'partial' }]
    await expect(settleRun({
      id: SessionId('child'),
      localAgent: undefined,
      result: Promise.resolve({ output, stopReason: stopReason as never }),
      dispose: () => Promise.resolve(),
    })).resolves.toEqual(expected)
  })

  it('settleRun disposes the run before reporting, on both result paths', async () => {
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    /** 中文说明：变量 completed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const completed = await settleRun({
      id: SessionId('child-1'),
      localAgent: undefined,
      result: Promise.resolve({ output: [{ type: 'text' as const, text: 'ok' }], stopReason: 'completed' as const }),
      dispose() { order.push('dispose'); return Promise.resolve() },
    })
    order.push('reported')
    expect(completed).toEqual({ status: 'completed', output: 'ok' })
    expect(order).toEqual(['dispose', 'reported'])

    // An infrastructure rejection still disposes and reports failed.
    /** 中文说明：变量 disposed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposed = false
    /** 中文说明：变量 failed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failed = await settleRun({
      id: SessionId('child-2'),
      localAgent: undefined,
      result: Promise.reject(new Error('transport gone')),
      dispose() { disposed = true; return Promise.resolve() },
    })
    expect(failed).toEqual({ status: 'failed', detail: 'Error: transport gone' })
    expect(disposed).toBe(true)

    /** 中文说明：变量 disposeFailed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeFailed = await settleRun({
      id: SessionId('child-4'),
      localAgent: undefined,
      result: Promise.resolve({ output: [], stopReason: 'completed' }),
      dispose: () => Promise.reject(new Error('reap failed')),
    })
    expect(disposeFailed).toEqual({ status: 'failed', detail: 'dispose failed: Error: reap failed' })

    /** 中文说明：变量 bothFailed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bothFailed = await settleRun({
      id: SessionId('child-5'),
      localAgent: undefined,
      result: Promise.reject(new Error('result failed')),
      dispose: () => Promise.reject(new Error('reap failed')),
    })
    expect(bothFailed).toEqual({
      status: 'failed',
      detail: 'Error: result failed; dispose failed: Error: reap failed',
    })
  })

  it('keeps provider diagnostics separate in failed background outcomes', async () => {
    await expect(settleRun({
      id: SessionId('child-diagnostic'),
      localAgent: undefined,
      result: Promise.resolve({
        output: [{ type: 'text', text: 'partial assistant text' }],
        diagnostic: 'Claude Code denied a tool request',
        stopReason: 'error',
      }),
      dispose: () => Promise.resolve(),
    })).resolves.toEqual({
      status: 'failed',
      detail: 'error; diagnostic: Claude Code denied a tool request',
    })
  })

  it('treats a diagnostic-bearing remote abort as failed without changing local cancellation', async () => {
    await expect(settleRun({
      id: SessionId('child-remote-abort'),
      localAgent: undefined,
      result: Promise.resolve({
        output: [],
        diagnostic: 'ACP permission was denied',
        stopReason: 'aborted',
      }),
      dispose: () => Promise.resolve(),
    })).resolves.toEqual({
      status: 'failed',
      detail: 'aborted; diagnostic: ACP permission was denied',
    })
  })

  it('bounds multibyte diagnostics and marks truncation', async () => {
    /** 中文说明：变量 exact 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exact = 'x'.repeat(MAX_SUBAGENT_DIAGNOSTIC_BYTES)
    /** 中文说明：变量 oversized 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const oversized = '权限'.repeat(MAX_SUBAGENT_DIAGNOSTIC_BYTES)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 exactResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exactResult = await settleRunResult({
      attempt: async () => { throw new Error('provider failed') },
      collectOutput: () => [],
      collectDiagnostic: () => exact,
      cancelled: () => false,
      signal: controller.signal,
      onAbort: () => {},
    })
    expect(exactResult.diagnostic).toBe(exact)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await settleRunResult({
      attempt: async () => { throw new Error('provider failed') },
      collectOutput: () => [],
      collectDiagnostic: () => oversized,
      cancelled: () => false,
      signal: controller.signal,
      onAbort: () => {},
    })
    /** 中文说明：变量 limited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const limited = result.diagnostic ?? ''
    expect(Buffer.byteLength(limited, 'utf8'))
      .toBeLessThanOrEqual(MAX_SUBAGENT_DIAGNOSTIC_BYTES)
    expect(limited.endsWith('[diagnostic truncated]')).toBe(true)
    expect(limited).not.toContain('\uFFFD')
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toBe(limited)
  })

  it('applies the same diagnostic rules to provider-returned results', async () => {
    const controller = new AbortController()
    const oversized = '权限'.repeat(MAX_SUBAGENT_DIAGNOSTIC_BYTES)
    const failed = await settleRunResult({
      attempt: () => Promise.resolve({
        output: [],
        diagnostic: oversized,
        stopReason: 'error',
      }),
      collectOutput: () => [],
      cancelled: () => false,
      signal: controller.signal,
      onAbort: () => {},
    })
    expect(Buffer.byteLength(failed.diagnostic ?? '', 'utf8'))
      .toBeLessThanOrEqual(MAX_SUBAGENT_DIAGNOSTIC_BYTES)
    expect(failed.diagnostic).toMatch(/\[diagnostic truncated\]$/)

    const plainFailure = await settleRunResult({
      attempt: () => Promise.resolve({ output: [], stopReason: 'error' }),
      collectOutput: () => [],
      cancelled: () => false,
      signal: controller.signal,
      onAbort: () => {},
    })
    expect(plainFailure).toEqual({ output: [], stopReason: 'error' })

    const cancelledAfterAttempt = await settleRunResult({
      attempt: () => Promise.resolve({ output: [], stopReason: 'completed' }),
      collectOutput: () => [{ type: 'text', text: 'partial' }],
      cancelled: () => true,
      signal: controller.signal,
      onAbort: () => {},
    })
    expect(cancelledAfterAttempt).toEqual({
      output: [{ type: 'text', text: 'partial' }],
      stopReason: 'aborted',
    })
  })
})
