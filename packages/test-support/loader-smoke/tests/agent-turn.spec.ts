/**
 * 文件职责：验证 agent-turn.spec.ts 覆盖的快照与装载测试支持行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的快照与装载测试支持能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { runFixtureTurn } from '../src/agent-turn.ts'

/** 中文说明：type Listener 定义本测试所需的数据或行为，用于表达快照与装载测试支持场景。 */
type Listener = (session: unknown, event: SessionEvent) => void

/** 中文说明：函数值 event 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const event = (value: object): SessionEvent => value as unknown as SessionEvent

/** 中文说明：函数 turnHarness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function turnHarness(): {
  readonly ctx: Context
  readonly session: { readonly id: string }
  readonly foreignSession: object
  readonly emit: (session: unknown, value: object) => void
  readonly setFollowup: (callback: (message: { readonly id: unknown }) => void) => void
  readonly whenIdle: ReturnType<typeof vi.fn>
  readonly disposeListener: ReturnType<typeof vi.fn>
  readonly flush: ReturnType<typeof vi.fn>
} {
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = { id: 'fixture-session' }
  /** 中文说明：变量 foreignSession 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const foreignSession = {}
  /** 中文说明：变量 listener 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let listener: Listener | undefined
  /** 中文说明：函数值 followup 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  let followup = (_message: { readonly id: unknown }): void => {}
  /** 中文说明：函数值 whenIdle 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const whenIdle = vi.fn(async () => {})
  /** 中文说明：变量 disposeListener 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const disposeListener = vi.fn()
  /** 中文说明：函数值 flush 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const flush = vi.fn(async () => {})
  /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const agent = {
    session,
    whenIdle,
    followup: vi.fn((message: { readonly id: unknown }) => { followup(message) }),
  }
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = {
    get: (name: string) => name === 'agents' ? { roots: () => [agent] } : undefined,
    on: (_name: string, callback: Listener) => {
      listener = callback
      return disposeListener
    },
    sessions: { flush },
  } as unknown as Context
  return {
    ctx,
    session,
    foreignSession,
    emit: (target, value) => { listener?.(target, event(value)) },
    setFollowup: (callback) => { followup = callback },
    whenIdle,
    disposeListener,
    flush,
  }
}

describe('runFixtureTurn', () => {
  it.each([
    ['no agent registry', undefined, 0],
    ['multiple roots', { roots: () => [{}, {}] }, 2],
  ])('rejects %s', async (_label, registry, count) => {
    const ctx = { get: () => registry, on: () => () => {} } as unknown as Context
    await expect(runFixtureTurn(ctx, { task: 'ignored' }))
      .rejects.toThrow(`fixture turn requires exactly one top-level agent, found ${count}`)
  })

  it('waits for the configured agent to publish before requiring it', async () => {
    // Configured agents publish asynchronously, so an initially empty registry
    // waits for agent/created instead of rejecting.
    const roots: object[] = []
    let created: (() => void) | undefined
    const dispose = vi.fn()
    const ctx = {
      get: (name: string) => name === 'agents' ? { roots: () => [...roots] } : undefined,
      on: (name: string, callback: () => void) => {
        if (name === 'agent/created') created = callback
        return dispose
      },
    } as unknown as Context
    const pending = runFixtureTurn(ctx, { task: 'ignored' })
    // Publication with a second root still fails the exactly-one requirement,
    // proving the count is re-checked after the wait.
    roots.push({}, {})
    created?.()
    await expect(pending).rejects.toThrow('fixture turn requires exactly one top-level agent, found 2')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('observes only the owned interval and returns its final text and deduplicated usage', async () => {
    /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const harness = turnHarness()
    /** 中文说明：变量 observed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const observed: SessionEvent[] = []
    harness.setFollowup((message) => {
      harness.emit(harness.foreignSession, {
        type: 'assistant/message', seq: 0, time: 0, data: { stream: [], message: { content: [] } },
      })
      harness.emit(harness.session, {
        type: 'step/start', seq: 0, time: 0, data: { turn: 1, step: 1 },
      })
      harness.emit(harness.session, {
        type: 'agent/inbox/spliced', seq: 1, time: 1, data: { inserted: [{ id: 'other' }] },
      })
      harness.emit(harness.session, {
        type: 'agent/inbox/spliced', seq: 2, time: 2, data: { inserted: [message] },
      })
      harness.emit(harness.session, {
        type: 'assistant/attempt', seq: 3, time: 3,
        data: {
          turn: 1,
          step: 1,
          stream: [
            { type: 'text-chunks', time0: 3, index: 0, dt: [], texts: ['partial'] },
            {
              type: 'chunk', time: 4,
              chunk: {
                type: 'usage', usage: { inputTokens: 2, outputTokens: 3, reasoningTokens: 1 },
              },
            },
          ],
        },
      })
      harness.emit(harness.session, {
        type: 'feedback/record', seq: 4, time: 4, data: { text: 'interleaved' },
      })
      harness.emit(harness.session, {
        type: 'assistant/message', seq: 5, time: 5,
        data: {
          turn: 1,
          step: 1,
          stream: [],
          message: { content: [{ type: 'text', text: 'final answer' }] },
          usage: { inputTokens: 4, outputTokens: 5, cacheReadTokens: 6 },
        },
      })
      harness.emit(harness.session, {
        type: 'assistant/attempt', seq: 6, time: 6,
        data: {
          turn: 1,
          step: 2,
          stream: [{
            type: 'chunk', time: 6,
            chunk: {
              type: 'usage',
              usage: { inputTokens: 1, outputTokens: 2, cacheWriteTokens: 7, reasoningTokens: 2 },
            },
          }],
        },
      })
      harness.emit(harness.session, {
        type: 'assistant/message', seq: 7, time: 7,
        data: { turn: 1, step: 2, stream: [], message: { content: [{ type: 'tool-call' }] } },
      })
      harness.emit(harness.session, {
        type: 'assistant/attempt', seq: 8, time: 8,
        data: {
          turn: 1,
          step: 3,
          stream: [{ type: 'text-chunks', time0: 8, index: 0, dt: [], texts: ['no usage'] }],
        },
      })
      harness.emit(harness.foreignSession, {
        type: 'assistant/message', seq: 9, time: 9, data: { stream: [], message: { content: [] } },
      })
    })

    await expect(runFixtureTurn(harness.ctx, {
      task: 'prove the fixture',
      onEvent: (_sessionId, current) => { observed.push(current) },
    })).resolves.toEqual({
      type: 'result',
      sessionId: 'fixture-session',
      output: 'final answer',
      usage: {
        inputTokens: 5,
        outputTokens: 7,
        cacheReadTokens: 6,
        cacheWriteTokens: 7,
        reasoningTokens: 2,
      },
    })
    expect(observed.map(current => current.seq)).toEqual([2, 3, 4, 5, 6, 7, 8])
    expect(harness.whenIdle).toHaveBeenCalledTimes(2)
    expect(harness.flush).toHaveBeenCalledWith(harness.session)
    expect(harness.disposeListener).toHaveBeenCalledOnce()
  })

  it('omits usage when the interval records none', async () => {
    /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const harness = turnHarness()
    harness.setFollowup((message) => {
      harness.emit(harness.session, {
        type: 'agent/inbox/spliced', seq: 0, time: 0, data: { inserted: [message] },
      })
    })

    await expect(runFixtureTurn(harness.ctx, { task: 'no model step' })).resolves.toEqual({
      type: 'result',
      sessionId: 'fixture-session',
      output: '',
    })
  })

  it('always removes its listener when the turn fails', async () => {
    /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const harness = turnHarness()
    harness.whenIdle.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('turn failed'))

    await expect(runFixtureTurn(harness.ctx, { task: 'fail' })).rejects.toThrow('turn failed')
    expect(harness.disposeListener).toHaveBeenCalledOnce()
    expect(harness.flush).not.toHaveBeenCalled()
  })
})
