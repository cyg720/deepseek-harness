/**
 * 文件职责：验证代码运行时的 service.spec.ts 行为。
 * 技术维度：Vitest、协议夹具、Worker/子进程或组件替身。
 * 产品维度：防止代码运行时协议与生命周期回归。
 * 逻辑维度：构造输入，运行被测入口并断言输出与清理。
 * 关键边界：跨进程数据必须校验；Worker 和异步任务必须结束。
 * 新手阅读建议：先读协议夹具，再按成功、失败和清理场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'

/**
 * Minimal concrete runtime: records requests, "executes" by invoking every
 * binding once in declaration order, and lets tests script the outcome. The
 * Service Definition package ships no provider, so the contract is exercised through
 * the smallest subclass that honors it.
 */
/** 中文说明：类型或类 StubRuntime 约束协议数据或模块职责。 */
class StubRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'in-process-stub'
  requests: CodeRunRequest[] = []
  nextResult: CodeRunResult = { logs: [] }

  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    this.requests.push(request)
    if (request.signal?.aborted) {
      return { logs: [], error: { kind: 'abort', message: String(request.signal.reason) } }
    }
    /** 中文说明：测试局部值 namespace，由紧邻初始化决定。 */
    for (const namespace of request.bindings) {
      /** 中文说明：测试局部值 fn，由紧邻初始化决定。 */
      for (const fn of Object.values(namespace.functions)) {
        await fn({ from: 'stub' })
      }
    }
    return this.nextResult
  }
}

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(StubRuntime)
  /** 中文说明：测试局部值 runtime，由紧邻初始化决定。 */
  const runtime = ctx.codeRuntime as StubRuntime
  return { ctx, runtime }
}

describe('CodeRuntime service seam', () => {
  it('registers as ctx.codeRuntime and serves the abstract API', async () => {
    /** 中文说明：测试局部值 { runtime }，由紧邻初始化决定。 */
    const { runtime } = await setup()
    expect(runtime.language).toBe('typescript')
    expect(runtime.isolation).toBe('in-process-stub')

    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    const calls: unknown[] = []
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await runtime.run({
      program: 'return 1',
      bindings: [{ global: 'tools', functions: { probe: async (args) => { calls.push(args); return null } } }],
    })
    expect(result).toEqual({ logs: [] })
    expect(calls).toEqual([{ from: 'stub' }])
    expect(runtime.requests).toHaveLength(1)
  })

  it('reports a failed run as an error field on a resolved result, never a rejection', async () => {
    /** 中文说明：测试局部值 { runtime }，由紧邻初始化决定。 */
    const { runtime } = await setup()
    runtime.nextResult = {
      logs: ['boom'],
      error: { kind: 'exception', message: 'boom' },
    }
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await runtime.run({ program: 'throw new Error("boom")', bindings: [] })
    expect(result.error).toEqual({ kind: 'exception', message: 'boom' })
    expect(result.value).toBeUndefined()
  })

  it('reports a pre-aborted signal as an abort failure', async () => {
    /** 中文说明：测试局部值 { runtime }，由紧邻初始化决定。 */
    const { runtime } = await setup()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    controller.abort('cancelled')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await runtime.run({ program: 'return 1', bindings: [], signal: controller.signal })
    expect(result.error).toEqual({ kind: 'abort', message: 'cancelled' })
  })

  it('is removed from the context when the providing fiber disposes (HMR safety)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(StubRuntime)
    expect(ctx.get('codeRuntime')).toBeInstanceOf(StubRuntime)

    await fiber.dispose()
    expect(ctx.get('codeRuntime')).toBeUndefined()
  })

  it('rejects a second implementation in the same context (duplicate service)', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await setup()
    await expect(ctx.plugin(StubRuntime)).rejects.toThrow(/registered/)
  })

})
