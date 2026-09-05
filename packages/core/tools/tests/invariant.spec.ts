/**
 * 文件职责：验证工具注册与执行的 invariant.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证工具注册与执行在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import * as ToolsInvariant from '@deepseek-ai/dsh-tools/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文说明：测试局部值 testToolSignal，由紧邻初始化决定。 */
const testToolSignal = new AbortController().signal

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(ToolsInvariant)
  return ctx
}

/** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
const execution = (overrides: Partial<ToolExecution> = {}): ToolExecution => ({
  token: Symbol('tool') as ToolExecutionToken,
  callId: ToolCallId('call-1'),
  name: 'echo',
  arguments: Object.freeze({ text: 'hi' }),
  ...overrides,
  signal: overrides.signal ?? testToolSignal,
  rootCallId: overrides.rootCallId ?? overrides.callId ?? ToolCallId('call-1'),
})

/** 中文说明：测试局部值 outcome，由紧邻初始化决定。 */
const outcome = (): ToolExecutionResult => Object.freeze({
  content: Object.freeze([{ type: 'text' as const, text: 'ok' }]) as never,
  isError: false,
  value: null,
})

/** 中文说明：函数 emitResult 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function emitResult(ctx: Context, exec: ToolExecution, result: ToolExecutionResult): void {
  ctx.emit(scopeTarget(ctx as never, undefined), 'tools/result', exec, result)
}

/** 中文说明：函数 stage 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function stage(ctx: Context, name: 'tools/pre-execute' | 'tools/execute', exec: ToolExecution): Promise<void> {
  if (name === 'tools/pre-execute') {
    await ctx.waterfall(ctx as never, name, exec, () => Promise.resolve({ kind: 'allow' as const }))
  } else {
    await ctx.waterfall(ctx as never, name, exec, () => Promise.resolve(outcome()))
  }
}

describe('tool-pipeline invariants', () => {
  it('accepts dispatch and denial stage orders with frozen results', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispatched，由紧邻初始化决定。 */
    const dispatched = execution()
    await stage(ctx, 'tools/pre-execute', dispatched)
    await stage(ctx, 'tools/execute', dispatched)
    await ctx.waterfall(ctx as never, 'tools/post-execute', dispatched, outcome(), () => Promise.resolve({ kind: 'accept' as const }))
    Object.freeze(dispatched)
    emitResult(ctx, dispatched, outcome())

    const denied = execution({ callId: ToolCallId('call-2') })
    await stage(ctx, 'tools/pre-execute', denied)
    await ctx.waterfall(ctx as never, 'tools/post-execute', denied, outcome(), () => Promise.resolve({ kind: 'accept' as const }))
    Object.freeze(denied)
    emitResult(ctx, denied, outcome())
    ctx.emit('tools/change')
  })

  it('rejects repeated and out-of-order pipeline stages', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = execution()
    await stage(ctx, 'tools/pre-execute', exec)
    await expect(stage(ctx, 'tools/pre-execute', exec)).rejects.toThrow(/repeated/)

    const noPre = execution({ callId: ToolCallId('call-2') })
    await expect(stage(ctx, 'tools/execute', noPre)).rejects.toThrow(/must follow tools\/pre-execute/)
    expect(() => ctx.waterfall(
      ctx as never, 'tools/post-execute', noPre, outcome(),
      () => Promise.resolve({ kind: 'accept' as const }),
    )).toThrow(/must follow tools\/pre-execute or tools\/execute/)
  })

  it('rejects mutable or anonymous final snapshots', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    expect(() => { emitResult(ctx, execution(), outcome()) }).toThrow(/execution must be frozen/)

    /** 中文说明：测试局部值 exec，由紧邻初始化决定。 */
    const exec = Object.freeze(execution())
    expect(() => { emitResult(ctx, exec, { content: [], isError: false, value: null }) })
      .toThrow(/outcome and content must be frozen/)

    /** 中文说明：测试局部值 anonymous，由紧邻初始化决定。 */
    const anonymous = Object.freeze(execution({ name: '' }))
    expect(() => { emitResult(ctx, anonymous, outcome()) }).toThrow(/non-empty name and callId/)
  })

  it('requires ptc-dispatch records to be turn-enclosed', async () => {
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
    const data = {
      rootCallId: ToolCallId('parent'),
      parentCallId: ToolCallId('parent'),
      subCallId: ToolCallId('child'),
      name: 'echo',
      arguments: {},
    }
    expect(() => session.append('tool/code-dispatch-start', data)).toThrow(/outside any open turn/)
    session.append('turn/start', { turn: 1 })
    expect(() => session.append('tool/code-dispatch-start', data)).not.toThrow()
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  })

  it('does not commit a rejected dispatch edge into the root index', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    expect(() => session.append('tool/code-dispatch-start', {
      rootCallId: ToolCallId('rejected-root'),
      parentCallId: ToolCallId('rejected-root'),
      subCallId: ToolCallId('reused-child'),
      name: 'echo',
      arguments: {},
    })).toThrow(/outside any open turn/)

    session.append('turn/start', { turn: 1 })
    expect(() => session.append('tool/code-dispatch-start', {
      rootCallId: ToolCallId('accepted-root'),
      parentCallId: ToolCallId('accepted-root'),
      subCallId: ToolCallId('reused-child'),
      name: 'echo',
      arguments: {},
    })).not.toThrow()
  })

  it('rejects a nested code dispatch that changes its parent chain root before append', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/code-dispatch-start', {
      rootCallId: ToolCallId('root'),
      parentCallId: ToolCallId('root'),
      subCallId: ToolCallId('child'),
      name: 'run_code',
      arguments: {},
    })
    session.append('tool/code-dispatch-start', {
      rootCallId: ToolCallId('root'),
      parentCallId: ToolCallId('child'),
      subCallId: ToolCallId('grandchild'),
      name: 'echo',
      arguments: {},
    })

    expect(() => session.append('tool/code-dispatch-start', {
      rootCallId: ToolCallId('another-root'),
      parentCallId: ToolCallId('child'),
      subCallId: ToolCallId('invalid-grandchild'),
      name: 'echo',
      arguments: {},
    })).toThrow(/parentCallId child does not belong to rootCallId another-root/)
    expect(session.snapshotEvents().some(event => event.type === 'tool/code-dispatch-start'
      && String(event.data.subCallId) === 'invalid-grandchild')).toBe(false)
  })

  it('requires non-empty dispatch identities and keeps one subcall on one root', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    expect(() => session.append('tool/code-dispatch-start', {
      rootCallId: ToolCallId(''),
      parentCallId: ToolCallId('root'),
      subCallId: ToolCallId('child'),
      name: 'echo',
      arguments: {},
    })).toThrow(/must carry non-empty rootCallId/)

    session.append('tool/code-dispatch-start', {
      rootCallId: ToolCallId('root'),
      parentCallId: ToolCallId('root'),
      subCallId: ToolCallId('child'),
      name: 'echo',
      arguments: {},
    })
    expect(() => session.append('tool/code-dispatch-start', {
      rootCallId: ToolCallId('other-root'),
      parentCallId: ToolCallId('other-root'),
      subCallId: ToolCallId('child'),
      name: 'echo',
      arguments: {},
    })).toThrow(/changed rootCallId for subCallId child/)
  })

  it('indexes dispatch records emitted for a bare session', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('bare-dispatch-session'))
    session.append('turn/start', { turn: 1 })
    expect(() => {
      ctx.emit('session/event', session as never, {
        type: 'tool/code-dispatch-start',
        seq: 1,
        time: 1,
        data: {
          rootCallId: ToolCallId('root'),
          parentCallId: ToolCallId('root'),
          subCallId: ToolCallId('child'),
          name: 'echo',
          arguments: {},
        },
      } as never)
    }).not.toThrow()
  })

  it('replays enclosed ptc-dispatch records on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/code-dispatch', {
      rootCallId: ToolCallId('parent'),
      parentCallId: ToolCallId('parent'),
      subCallId: ToolCallId('child'),
      name: 'echo',
      arguments: {},
      isError: false,
      content: [{ type: 'text', text: 'ok' }],
    })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(ToolsInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it('rejects an unenclosed ptc-dispatch record on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('tool/code-dispatch-start', {
      rootCallId: ToolCallId('parent'),
      parentCallId: ToolCallId('parent'),
      subCallId: ToolCallId('child'),
      name: 'echo',
      arguments: {},
    })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(ToolsInvariant).then(() => undefined)).rejects.toThrow(/outside any open turn/)
  })
})
