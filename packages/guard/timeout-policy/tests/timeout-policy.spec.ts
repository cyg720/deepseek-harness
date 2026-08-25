/**
 * Unit + real-load-path coverage for @deepseek-ai/dsh-tool-call-timeout-policy. The
 * timeout-wins cases drive the deadline under fake timers (deterministic — no
 * wall-clock race) and use a COOPERATIVE tool that settles only when its
 * `exec.signal` aborts, mirroring how a real capability forwards the signal and
 * reaches quiescence.
 */
/**
 * 文件职责：验证循环守卫的 timeout-policy.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证循环守卫可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：构造事件与配置，驱动入口并断言结果。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { CallId, HarnessError } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, TOOL_ABORTED, type ToolExecutionInput, type PostToolDecision } from '@deepseek-ai/dsh-tools'
import * as timeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { TOOL_TIMEOUT } from '@deepseek-ai/dsh-tool-call-timeout-policy'

/** 中文说明：测试局部值 testToolSignal，由紧邻初始化决定。 */
const testToolSignal = new AbortController().signal

/** Mount the registry + the zero-config timeout-policy enforcer. */
/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(timeoutPolicy)
  return ctx
}

/** A cooperative tool that settles ONLY when its exec.signal aborts (returns text). */
/** 中文说明：测试局部值 cooperativeTool，由紧邻初始化决定。 */
const cooperativeTool = defineContentToolFixture({
  name: 'slow', description: 'stops when aborted', parameters: {}, timeoutMs: 100,
  execute(_args, exec): Promise<{ type: 'text'; text: string }[]> {
    /** 中文说明：测试局部值 done，由紧邻初始化决定。 */
    const done = [{ type: 'text' as const, text: 'stopped cooperatively' }]
    if (exec.signal.aborted) return Promise.resolve(done)
    return new Promise((resolve) => { exec.signal.addEventListener('abort', () => { resolve(done) }) })
  },
})

/** A cooperative tool that THROWS its own upstream-abort error when aborted (web-provider shape). */
/** 中文说明：测试局部值 abortThrowingTool，由紧邻初始化决定。 */
const abortThrowingTool = defineContentToolFixture({
  name: 'aborter', description: 'throws WEB_ABORTED when aborted', parameters: {}, timeoutMs: 100,
  execute(_args, exec): Promise<never> {
    if (exec.signal.aborted) return Promise.reject(new HarnessError('web fetch aborted', 'WEB_ABORTED'))
    return new Promise((_resolve, reject) => { exec.signal.addEventListener('abort', () => { reject(new HarnessError('web fetch aborted', 'WEB_ABORTED')) }) })
  },
})

describe('timeout-policy delegation (unconfigured / fast)', () => {
  it('delegates a tool with NO declared budget unchanged and does not touch exec.signal', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let seenSignal: AbortSignal | undefined
    ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'd', parameters: {},
      async execute(_a, exec) { seenSignal = exec.signal; return [{ type: 'text' as const, text: 'ok' }] } }))
    /** 中文说明：测试局部值 upstream，由紧邻初始化决定。 */
    const upstream = new AbortController().signal
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ callId: CallId('c1'), name: 'probe', arguments: {}, signal: upstream })
    expect(result.isError).toBe(false)
    expect(seenSignal).toBe(upstream)
  })

  it('a tool with a budget that returns fast keeps its own result (no timeout)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({ name: 'fast', description: 'd', parameters: {}, timeoutMs: 10_000,
      async execute() { return [{ type: 'text' as const, text: 'ok' }] } }))
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'fast', arguments: {} })
    expect(result).toEqual({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
      value: [{ type: 'text', text: 'ok' }],
    })
  })

  it('a budgeted tool receives the DERIVED deadline signal (not the caller signal) during dispatch', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let seenSignal: AbortSignal | undefined
    ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'd', parameters: {}, timeoutMs: 10_000,
      async execute(_a, exec) { seenSignal = exec.signal; return [{ type: 'text' as const, text: 'ok' }] } }))
    /** 中文说明：测试局部值 upstream，由紧邻初始化决定。 */
    const upstream = new AbortController().signal
    await ctx.tools.execute({ callId: CallId('c1'), name: 'probe', arguments: {}, signal: upstream })
    expect(seenSignal).toBeDefined()
    expect(seenSignal).not.toBe(upstream)
  })
})

describe('timeout-policy signal restoration', () => {
  it('restores the caller signal for post-execute after wrapping', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({ name: 'fast', description: 'd', parameters: {}, timeoutMs: 10_000,
      async execute() { return [{ type: 'text' as const, text: 'ok' }] } }))
    /** 中文说明：测试局部值 postSignal，由紧邻初始化决定。 */
    let postSignal: AbortSignal | undefined | 'unset' = 'unset'
    ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => { postSignal = exec.signal; return next() })
    /** 中文说明：测试局部值 upstream，由紧邻初始化决定。 */
    const upstream = new AbortController().signal
    await ctx.tools.execute({ callId: CallId('c1'), name: 'fast', arguments: {}, signal: upstream })
    expect(postSignal).toBe(upstream)
  })
})

describe('timeout-policy TOOL_TIMEOUT replacement (deadline wins)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('replaces a cooperative tool result with TOOL_TIMEOUT when its own deadline fires', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(cooperativeTool)
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'slow', arguments: {} })
    await vi.advanceTimersByTimeAsync(150)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await pending
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: tool call timed out after 100ms' }],
      isError: true,
      error: {
        message: 'tool call timed out after 100ms',
        info: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' },
      },
    })
  })

  it('replaces a provider-owned abort ERROR result with TOOL_TIMEOUT when the signal was ours', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(abortThrowingTool)
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'aborter', arguments: {} })
    await vi.advanceTimersByTimeAsync(150)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.error).toEqual({
      message: 'tool call timed out after 100ms',
      info: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' },
    })
    expect(result.content[0]).toMatchObject({ text: 'Error: tool call timed out after 100ms' })
  })

  it('preserves registry ABORTED when the caller aborts first (upstream cancel, not our timeout)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    ctx.tools.register(defineContentToolFixture({
      name: 'slow', description: 'stops when aborted', parameters: {}, timeoutMs: 100,
      execute(_args, exec) {
        entered.resolve(undefined)
        /** 中文说明：测试局部值 done，由紧邻初始化决定。 */
        const done = [{ type: 'text' as const, text: 'stopped cooperatively' }]
        if (exec.signal.aborted) return Promise.resolve(done)
        return new Promise((resolve) => {
          exec.signal.addEventListener('abort', () => { resolve(done) }, { once: true })
        })
      },
    }))
    /** 中文说明：测试局部值 upstream，由紧邻初始化决定。 */
    const upstream = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({ callId: CallId('c1'), name: 'slow', arguments: {}, signal: upstream.signal })
    await entered.promise
    upstream.abort('user cancelled')
    await vi.advanceTimersByTimeAsync(0)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.error).toEqual({
      message: 'tool call aborted',
      info: { name: 'AbortError', code: TOOL_ABORTED },
    })
    expect(result.content[0]).toMatchObject({ text: 'Error: tool call aborted' })
  })

  it('preserves TOOL_TIMEOUT when the deadline wins before a later caller abort', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 sawAbort，由紧邻初始化决定。 */
    const sawAbort = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 releaseCleanup，由紧邻初始化决定。 */
    const releaseCleanup = Promise.withResolvers<undefined>()
    ctx.tools.register(defineContentToolFixture({
      name: 'slow-cleanup', description: 'settles after abort cleanup', parameters: {}, timeoutMs: 100,
      async execute(_args, exec) {
        if (!exec.signal.aborted) {
          await new Promise<undefined>((resolve) => {
            exec.signal.addEventListener('abort', () => { resolve(undefined) }, { once: true })
          })
        }
        sawAbort.resolve(undefined)
        await releaseCleanup.promise
        return [{ type: 'text' as const, text: 'cleanup complete' }]
      },
    }))
    /** 中文说明：测试局部值 upstream，由紧邻初始化决定。 */
    const upstream = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('timeout-first'), name: 'slow-cleanup', arguments: {}, signal: upstream.signal,
    })

    await vi.advanceTimersByTimeAsync(100)
    await sawAbort.promise
    upstream.abort('too late to replace timeout')
    releaseCleanup.resolve(undefined)

    await expect(pending).resolves.toMatchObject({
      isError: true,
      error: {
        message: 'tool call timed out after 100ms',
        info: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' },
      },
    })
  })
})

describe('timeout-policy contract', () => {
  it('exposes the owned code constant', () => {
    expect(TOOL_TIMEOUT).toBe('TOOL_TIMEOUT')
  })
})

describe('timeout-policy disposal (HMR safety)', () => {
  it('removes its tools/execute listener when the plugin fiber disposes', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let seenSignal: AbortSignal | undefined
    ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'd', parameters: {}, timeoutMs: 10_000,
      async execute(_a, exec) { seenSignal = exec.signal; return [{ type: 'text' as const, text: 'ok' }] } }))
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(timeoutPolicy)
    /** 中文说明：测试局部值 upstream，由紧邻初始化决定。 */
    const upstream = new AbortController().signal
    await ctx.tools.execute({ callId: CallId('c1'), name: 'probe', arguments: {}, signal: upstream })
    expect(seenSignal).not.toBe(upstream)
    await fiber.dispose()
    await ctx.tools.execute({ callId: CallId('c2'), name: 'probe', arguments: {}, signal: upstream })
    expect(seenSignal).toBe(upstream)
  })
})

describe('dsh-tool-call-timeout-policy real-load-path guard', () => {
  it('has no default export and keeps name/inject through unwrapExports', () => {
    expect('default' in timeoutPolicy).toBe(false)
    /** 中文说明：测试局部值 loader，由紧邻初始化决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：测试局部值 unwrapped，由紧邻初始化决定。 */
    const unwrapped = loader.unwrapExports(timeoutPolicy) as Record<string, unknown>
    expect(unwrapped).toBe(timeoutPolicy)
    expect(unwrapped.name).toBe('timeout-policy')
    expect(unwrapped.inject).toEqual(['tools'])
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('boots over ctx.tools through the unwrapped module and wraps a budgeted tool', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(defineContentToolFixture({ name: 'fast', description: 'd', parameters: {}, timeoutMs: 5_000,
      async execute() { return [{ type: 'text' as const, text: 'ok' }] } }))
    /** 中文说明：测试局部值 loader，由紧邻初始化决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：测试局部值 unwrapped，由紧邻初始化决定。 */
    const unwrapped = loader.unwrapExports(timeoutPolicy) as Parameters<Context['plugin']>[0]
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(unwrapped)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'fast', arguments: {} } satisfies ToolExecutionInput)
    expect(result.isError).toBe(false)
    await fiber.dispose()
  })
})
