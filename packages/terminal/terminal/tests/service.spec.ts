/**
 * 文件职责：验证 service.spec.ts 覆盖的持久终端行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的持久终端能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import TerminalSessionService, { TerminalBackendCleanupError, TerminalError, TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import type {
  TerminalBackend,
  TerminalBackendSession,
  TerminalReadRequest,
  TerminalSendOperation,
  TerminalSendRequest,
  TerminalSessionId as TerminalSessionIdType,
  TerminalSessionStatus,
  TerminalSignal,
} from '@deepseek-ai/dsh-terminal'

/** 中文说明：函数值 agentScopeDisposers 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const agentScopeDisposers = new WeakMap<Agent, () => Promise<void>>()
/** 中文说明：函数值 ptyServiceDisposers 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const ptyServiceDisposers = new WeakMap<Context, () => Promise<void>>()

/** 中文说明：函数 stubAgent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function stubAgent(ctx: Context, rawId: string): Agent {
  /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const id = SessionId(rawId)
  /** 中文说明：函数值 scopeFiber 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const scopeFiber = ctx.plugin(() => {})
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = Session.create(id)
  /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const agent: Agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scopeFiber.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  agentScopeDisposers.set(agent, async () => { await scopeFiber.dispose() })
  return agent
}

/** 中文说明：函数 disposeAgentScope 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function disposeAgentScope(agent: Agent): Promise<void> {
  /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dispose = agentScopeDisposers.get(agent)
  if (dispose === undefined) throw new Error('missing agent scope')
  await dispose()
}

/** 中文说明：class StubSession 定义本测试所需的数据或行为，用于表达持久终端场景。 */
class StubSession implements TerminalBackendSession {
  readonly motd = 'stub ready'
  readonly pid = 123
  closed: string[] = []
  statusValue: TerminalSessionStatus = { kind: 'running' }
  operation: TerminalSendOperation | undefined
  rejectSend = false
  rejectClose = false
  closeGate: PromiseWithResolvers<undefined> | undefined

  startSend(_request: TerminalSendRequest): TerminalSendOperation {
    if (this.rejectSend) {
      return { done: Promise.reject(new Error('send failed')), readOutput: () => ({ delta: '', truncated: false }), cancel: () => false }
    }
    /** 中文说明：函数值 settle 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let settle!: () => void
    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    /** 中文说明：函数值 done 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const done = new Promise<void>((resolve) => { settle = resolve }).then(() => ({
      viewport: 'done',
      waitReason: 'stdin_read' as const,
      sessionStatus: this.statusValue,
      truncated: false,
    }))
    /** 中文说明：变量 operation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const operation: TerminalSendOperation = {
      done,
      readOutput: () => ({ delta: 'delta', truncated: false }),
      cancel: () => {
        if (settled) return false
        settled = true
        settle()
        return true
      },
    }
    this.operation = operation
    return operation
  }

  read(request: TerminalReadRequest) {
    return { text: `${request.offset ?? 0}:${request.count ?? 0}`, totalLines: 1, lineBegin: 0, lineEnd: 1, truncated: false }
  }

  async signal(signal: TerminalSignal) {
    return { delivered: true as const, targetPgid: signal === 'SIGINT' ? 12 : 13 }
  }

  status(): TerminalSessionStatus {
    return this.statusValue
  }

  async close(reason: string): Promise<void> {
    this.closed.push(reason)
    if (this.rejectClose) throw new Error('close failed')
    if (this.closeGate !== undefined) await this.closeGate.promise
    this.statusValue = { kind: 'exited', exitCode: 0, signal: null }
    this.operation?.cancel()
  }
}

/** 中文说明：函数 backend 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function backend(type = 'stub') {
  /** 中文说明：变量 sessions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sessions: StubSession[] = []
  /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const provider: TerminalBackend = {
    type,
    async spawn() {
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = new StubSession()
      sessions.push(session)
      return session
    },
  }
  return { provider, sessions }
}

/** 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness() {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(TerminalSessionService)
  ptyServiceDisposers.set(ctx, async () => { await fiber.dispose() })
  return ctx
}

/** 中文说明：函数 disposeTerminalSessionService 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function disposeTerminalSessionService(ctx: Context): Promise<void> {
  /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dispose = ptyServiceDisposers.get(ctx)
  if (dispose === undefined) throw new Error('missing PTY service fiber')
  await dispose()
}

describe('TerminalSessionService backend registry', () => {
  it('preserves the id brand and disposes exact backend contributions', async () => {
    expectTypeOf(TerminalSessionId('pty-1')).toEqualTypeOf<TerminalSessionIdType>()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = backend()
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = ctx.terminals.registerBackend(first.provider)
    expect(ctx.terminals.listBackends()).toEqual(['stub'])
    expect(() => ctx.terminals.registerBackend(backend().provider)).toThrow(TerminalError)
    /** 中文说明：变量 internal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internal = ctx.terminals as unknown as { backends: Map<string, TerminalBackend> }
    internal.backends.set('stub', backend('replacement').provider)
    dispose()
    expect(ctx.terminals.listBackends()).toEqual(['stub'])
    internal.backends.clear()
  })

  it('rejects empty backend types', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    expect(() => ctx.terminals.registerBackend(backend('').provider)).toThrow('must be non-empty')
  })
})

describe('TerminalSessionService ownership and lifecycle', () => {
  it('publishes only after spawn and fences every operation to the exact owner', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = backend()
    ctx.terminals.registerBackend(b.provider)
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    /** 中文说明：变量 foreign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreign = stubAgent(ctx, 'foreign')
    ctx.agents.register(owner)
    ctx.agents.register(foreign)

    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ctx.terminals.spawn(owner, { type: 'stub', name: 'main', cwd: '/tmp' })
    expect(created).toMatchObject({ sessionId: 'pty-1', name: 'main', type: 'stub', pid: 123, motd: 'stub ready', status: { kind: 'running' } })
    expect(ctx.terminals.hasOwnerActivity(owner)).toBe(true)
    expect(ctx.terminals.list(owner)).toHaveLength(1)
    expect(ctx.terminals.list(foreign)).toEqual([])
    expect(() => ctx.terminals.read(foreign, created.sessionId)).toThrow('belongs to another agent')
    expect(() => ctx.terminals.signal(foreign, created.sessionId, 'SIGINT')).toThrow('belongs to another agent')
    await expect(Promise.resolve().then(() => ctx.terminals.kill(foreign, created.sessionId))).rejects.toThrow('belongs to another agent')
  })

  it('rejects unknown backends, non-live owners, duplicate names, and active sends', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    await expect(ctx.terminals.spawn(owner, { type: 'missing' })).rejects.toMatchObject({ code: 'OWNER_NOT_LIVE' })
    ctx.agents.register(owner)
    await expect(ctx.terminals.spawn(owner, { type: 'missing' })).rejects.toMatchObject({ code: 'NO_BACKEND' })
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = backend()
    ctx.terminals.registerBackend(b.provider)
    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ctx.terminals.spawn(owner, { type: 'stub', name: 'main' })
    await expect(ctx.terminals.spawn(owner, { type: 'stub', name: '' })).rejects.toThrow('must be non-empty')
    /** 中文说明：变量 aborted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const aborted = new AbortController()
    /** 中文说明：变量 abortReason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const abortReason = new Error('spawn aborted')
    aborted.abort(abortReason)
    await expect(ctx.terminals.spawn(owner, { type: 'stub' }, aborted.signal)).rejects.toBe(abortReason)
    await expect(ctx.terminals.spawn(owner, { type: 'stub', name: 'main' })).rejects.toMatchObject({ code: 'DUPLICATE_NAME' })

    /** 中文说明：变量 operation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const operation = ctx.terminals.startSend(owner, created.sessionId, { text: 'echo hi', submit: true })
    expect(() => ctx.terminals.startSend(owner, created.sessionId, { text: 'pwd', submit: true })).toThrow(TerminalError)
    expect(operation.readOutput()).toEqual({ delta: 'delta', truncated: false })
    expect(operation.cancel()).toBe(true)
    await operation.done
    /** 中文说明：变量 next 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const next = ctx.terminals.startSend(owner, created.sessionId, { text: 'pwd', submit: true })
    next.cancel()
    await next.done

    b.sessions[0]!.rejectSend = true
    await expect(ctx.terminals.startSend(owner, created.sessionId, { text: 'bad', submit: true }).done).rejects.toThrow('send failed')
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('reserves concurrent names and rolls back a spawn whose owner disappears', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<TerminalBackendSession>()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = new StubSession()
    ctx.terminals.registerBackend({ type: 'slow', spawn: () => gate.promise })
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.terminals.spawn(owner, { type: 'slow', name: 'main' })
    await expect(ctx.terminals.spawn(owner, { type: 'slow', name: 'main' })).rejects.toMatchObject({ code: 'DUPLICATE_NAME' })
    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = disposeAgentScope(owner)
    gate.resolve(session)
    await expect(pending).rejects.toMatchObject({ code: 'OWNER_NOT_LIVE' })
    await disposal
    expect(session.closed).toEqual(['PTY spawn rolled back'])
  })

  it('preserves caller cancellation when a pending backend spawn completes', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<TerminalBackendSession>()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = new StubSession()
    ctx.terminals.registerBackend({ type: 'slow', spawn: () => gate.promise })
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('cancelled by caller')

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.terminals.spawn(owner, { type: 'slow' }, controller.signal)
    controller.abort(reason)
    gate.resolve(session)

    await expect(pending).rejects.toBe(reason)
    expect(session.closed).toEqual(['PTY spawn rolled back'])
    expect(ctx.agents.get(owner.id)).toBe(owner)
  })

  it('preserves caller cancellation when unpublished rollback fails', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<TerminalBackendSession>()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = new StubSession()
    session.rejectClose = true
    ctx.terminals.registerBackend({ type: 'slow', spawn: () => gate.promise })
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('cancelled by caller')

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.terminals.spawn(owner, { type: 'slow' }, controller.signal)
    controller.abort(reason)
    gate.resolve(session)

    await expect(pending).rejects.toBe(reason)
    expect(ctx.terminals.hasOwnerActivity(owner)).toBe(true)
    /** 中文说明：变量 internal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internal = ctx.terminals as unknown as { disposeAll(): Promise<void> }
    await expect(internal.disposeAll()).rejects.toThrow('failed to clean up PTY lifecycle')
    expect(ctx.terminals.hasOwnerActivity(owner)).toBe(false)
    expect(session.closed).toEqual(['PTY spawn rolled back'])
  })

  it('preserves caller cancellation when a backend rejects in response to it', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：变量 backendFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backendFailure = new Error('backend observed cancellation')
    ctx.terminals.registerBackend({
      type: 'abortable',
      spawn: ({ signal }) => new Promise((_resolve, reject) => {
        if (signal === undefined) throw new Error('missing spawn signal')
        started.resolve(undefined)
        signal.addEventListener('abort', () => { reject(backendFailure) }, { once: true })
      }),
    })
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('cancelled by caller')

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.terminals.spawn(owner, { type: 'abortable' }, controller.signal)
    await started.promise
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
  })

  it.each(['owner', 'service'] as const)('retains caller-triggered backend cleanup failure until %s disposal', async (scope) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：变量 cleanupFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanupFailure = new Error('backend cleanup failed')
    ctx.terminals.registerBackend({
      type: 'cleanup-failing',
      spawn: ({ signal }) => new Promise((_resolve, reject) => {
        if (signal === undefined) throw new Error('missing spawn signal')
        started.resolve(undefined)
        signal.addEventListener('abort', () => {
          reject(new TerminalBackendCleanupError(signal.reason, cleanupFailure))
        }, { once: true })
      }),
    })
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('cancelled by caller')

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.terminals.spawn(owner, { type: 'cleanup-failing' }, controller.signal)
    await started.promise
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(ctx.terminals.hasOwnerActivity(owner)).toBe(true)
    /** 中文说明：变量 internal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internal = ctx.terminals as unknown as {
      disposeOwned(owner: Agent): Promise<void>
      disposeAll(): Promise<void>
    }
    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = scope === 'owner' ? internal.disposeOwned(owner) : internal.disposeAll()
    await expect(disposal).rejects.toThrow('failed to clean up PTY lifecycle')
    expect(ctx.terminals.hasOwnerActivity(owner)).toBe(false)
  })

  it.each([
    { scope: 'owner', code: 'OWNER_NOT_LIVE' },
    { scope: 'service', code: 'SERVICE_DISPOSING' },
  ] as const)('$scope disposal aborts and awaits unpublished backend setup', async ({ scope, code }) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<TerminalBackendSession>()
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = new StubSession()
    /** 中文说明：变量 backendSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let backendSignal: AbortSignal | undefined
    ctx.terminals.registerBackend({
      type: 'slow',
      spawn: (spec) => {
        backendSignal = spec.signal
        started.resolve(undefined)
        return gate.promise
      },
    })
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.terminals.spawn(owner, { type: 'slow' })
    /** 中文说明：变量 pendingFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pendingFailure = pending.then(
      () => { throw new Error('pending spawn unexpectedly succeeded') },
      (error: unknown) => error,
    )
    await started.promise
    /** 中文说明：变量 disposalSettled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposalSettled = false
    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = (scope === 'owner' ? disposeAgentScope(owner) : disposeTerminalSessionService(ctx))
      .then(() => { disposalSettled = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    /** 中文说明：变量 signalAbortedBeforeRelease 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signalAbortedBeforeRelease = backendSignal?.aborted ?? false
    /** 中文说明：变量 signalReasonBeforeRelease 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signalReasonBeforeRelease = backendSignal?.reason as unknown
    /** 中文说明：变量 disposalSettledBeforeRelease 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposalSettledBeforeRelease = disposalSettled
    gate.resolve(session)

    expect(await pendingFailure).toMatchObject({ code })
    await disposal
    expect(signalAbortedBeforeRelease).toBe(true)
    expect(signalReasonBeforeRelease).toMatchObject({ code })
    expect(disposalSettledBeforeRelease).toBe(false)
    expect(session.closed).toEqual(['PTY spawn rolled back'])
  })

  it('reports unpublished rollback failure through service disposal', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<TerminalBackendSession>()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = new StubSession()
    session.rejectClose = true
    ctx.terminals.registerBackend({ type: 'slow', spawn: () => gate.promise })
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.terminals.spawn(owner, { type: 'slow' })
    /** 中文说明：变量 pendingFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pendingFailure = expect(pending).rejects.toThrow('PTY spawn and rollback both failed')
    /** 中文说明：变量 internal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internal = ctx.terminals as unknown as { disposeAll(): Promise<void> }
    /** 中文说明：变量 disposalFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposalFailure = expect(internal.disposeAll()).rejects.toThrow('failed to clean up PTY lifecycle')
    gate.resolve(session)

    await pendingFailure
    await disposalFailure
    expect(session.closed).toEqual(['PTY spawn rolled back'])
  })

  it.each([
    { scope: 'owner', code: 'OWNER_NOT_LIVE' },
    { scope: 'service', code: 'SERVICE_DISPOSING' },
  ] as const)('$scope disposal retains backend-side startup cleanup failure', async ({ scope, code }) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：变量 cleanupFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanupFailure = new Error('backend cleanup failed')
    /** 中文说明：变量 backendAbortReason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let backendAbortReason: unknown
    ctx.terminals.registerBackend({
      type: 'cleanup-failing',
      spawn: ({ signal }) => new Promise((_resolve, reject) => {
        if (signal === undefined) throw new Error('missing spawn signal')
        started.resolve(undefined)
        signal.addEventListener('abort', () => {
          backendAbortReason = signal.reason
          reject(new TerminalBackendCleanupError(signal.reason, cleanupFailure))
        }, { once: true })
      }),
    })
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.terminals.spawn(owner, { type: 'cleanup-failing' })
    await started.promise
    /** 中文说明：变量 internal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internal = ctx.terminals as unknown as {
      disposeOwned(owner: Agent): Promise<void>
      disposeAll(): Promise<void>
    }
    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = scope === 'owner' ? internal.disposeOwned(owner) : internal.disposeAll()
    /** 中文说明：变量 pendingError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pendingError = await pending.then(
      () => { throw new Error('pending spawn unexpectedly succeeded') },
      (error: unknown) => error,
    )

    expect(pendingError).toBe(backendAbortReason)
    expect(pendingError).toMatchObject({ code })
    /** 中文说明：变量 disposalError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposalError = await disposal.then(
      () => { throw new Error('disposal unexpectedly succeeded') },
      (error: unknown) => error,
    )
    expect(disposalError).toMatchObject({ message: 'failed to clean up PTY lifecycle' })
    /** 中文说明：变量 rollbackError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rollbackError = (disposalError as AggregateError).errors[0] as unknown
    /** 中文说明：变量 cleanupErrors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanupErrors = (rollbackError as AggregateError).errors as unknown[]
    expect(cleanupErrors).toEqual([cleanupFailure])
  })

  it('keeps independent reservations and handles provider failure before publication', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 firstGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstGate = Promise.withResolvers<TerminalBackendSession>()
    /** 中文说明：变量 secondGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondGate = Promise.withResolvers<TerminalBackendSession>()
    /** 中文说明：变量 count 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let count = 0
    ctx.terminals.registerBackend({
      type: 'slow',
      spawn: () => ++count === 1 ? firstGate.promise : secondGate.promise,
    })
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = ctx.terminals.spawn(owner, { type: 'slow', name: 'one' })
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = ctx.terminals.spawn(owner, { type: 'slow', name: 'two' })
    firstGate.resolve(new StubSession())
    await first
    secondGate.resolve(new StubSession())
    await second

    ctx.terminals.registerBackend({ type: 'throwing', spawn: () => Promise.reject(new Error('provider failed')) })
    await expect(ctx.terminals.spawn(owner, { type: 'throwing' })).rejects.toThrow('provider failed')

    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = backend('signaled')
    ctx.terminals.registerBackend(b.provider)
    await ctx.terminals.spawn(owner, { type: 'signaled' }, controller.signal)
  })

  it('omits optional pid metadata when a backend has no process id', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = new StubSession()
    Object.defineProperty(session, 'pid', { value: undefined })
    ctx.terminals.registerBackend({ type: 'virtual', spawn: () => Promise.resolve(session) })
    expect(await ctx.terminals.spawn(owner, { type: 'virtual' })).not.toHaveProperty('pid')
  })

  it('reports rollback and close failures without publishing false success', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    /** 中文说明：变量 failedSpawn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedSpawn = new StubSession()
    failedSpawn.rejectClose = true
    /** 中文说明：变量 ownerDisposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let ownerDisposal = Promise.resolve()
    /** 中文说明：变量 internal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internal = ctx.terminals as unknown as {
      disposedOwners: WeakSet<Agent>
      disposeOwned(owner: Agent): Promise<void>
    }
    ctx.terminals.registerBackend({
      type: 'bad-spawn',
      async spawn({ signal }) {
        if (signal === undefined) throw new Error('missing spawn signal')
        internal.disposedOwners.add(owner)
        ownerDisposal = internal.disposeOwned(owner)
        if (!signal.aborted) {
          await new Promise<undefined>((resolve) => {
            signal.addEventListener('abort', () => { resolve(undefined) }, { once: true })
          })
        }
        return failedSpawn
      },
    })
    await expect(ctx.terminals.spawn(owner, { type: 'bad-spawn' })).rejects.toThrow('spawn and rollback both failed')
    await expect(ownerDisposal).rejects.toThrow('failed to clean up PTY lifecycle')

    /** 中文说明：变量 nextOwner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nextOwner = stubAgent(ctx, 'next')
    ctx.agents.register(nextOwner)
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = backend('bad-close')
    ctx.terminals.registerBackend(b.provider)
    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ctx.terminals.spawn(nextOwner, { type: 'bad-close' })
    b.sessions[0]!.rejectClose = true
    await expect(ctx.terminals.kill(nextOwner, created.sessionId)).rejects.toThrow('close failed')
    expect(ctx.terminals.list(nextOwner)).toHaveLength(1)
  })

  it('joins an already-running close and refuses new sends while closing', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = backend()
    ctx.terminals.registerBackend(b.provider)
    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ctx.terminals.spawn(owner, { type: 'stub' })
    b.sessions[0]!.closeGate = Promise.withResolvers<undefined>()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = ctx.terminals.kill(owner, created.sessionId)
    expect(() => ctx.terminals.startSend(owner, created.sessionId, { text: '', submit: false })).toThrow('closing')
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = ctx.terminals.kill(owner, created.sessionId)
    b.sessions[0]!.closeGate?.resolve(undefined)
    expect(await first).toBe(true)
    expect(await second).toBe(false)
    expect(() => ctx.terminals.read(owner, created.sessionId)).toThrow('unknown PTY')
  })

  it('awaits owner cleanup and removes sessions while backend registration may reload', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = backend()
    /** 中文说明：变量 disposeBackend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeBackend = ctx.terminals.registerBackend(b.provider)
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ctx.terminals.spawn(owner, { type: 'stub' })
    disposeBackend()
    expect(ctx.terminals.listBackends()).toEqual([])
    expect(ctx.terminals.read(owner, created.sessionId).text).toBe('0:0')

    await disposeAgentScope(owner)
    expect(b.sessions[0]?.closed).toEqual(['PTY owner disposed'])
    expect(ctx.terminals.list(owner)).toEqual([])
  })

  it('kills idempotently and service disposal closes all owners', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = backend()
    ctx.terminals.registerBackend(b.provider)
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = stubAgent(ctx, 'first')
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = stubAgent(ctx, 'second')
    ctx.agents.register(first)
    ctx.agents.register(second)
    /** 中文说明：变量 a 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const a = await ctx.terminals.spawn(first, { type: 'stub' })
    await ctx.terminals.spawn(second, { type: 'stub' })
    expect(await ctx.terminals.kill(first, a.sessionId)).toBe(true)
    expect(b.sessions[0]?.closed).toEqual(['model request'])

    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = ctx.terminals
    await disposeTerminalSessionService(ctx)
    expect(b.sessions[1]?.closed).toEqual(['PTY service disposed'])
    await expect(service.spawn(first, { type: 'stub' })).rejects.toMatchObject({ code: 'SERVICE_DISPOSING' })
  })

  it('aggregates service-disposal close failures after attempting every record', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = ctx.terminals
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = backend()
    ctx.terminals.registerBackend(b.provider)
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    await ctx.terminals.spawn(owner, { type: 'stub' })
    b.sessions[0]!.rejectClose = true
    /** 中文说明：变量 internal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internal = service as unknown as {
      sessions: Map<TerminalSessionIdType, unknown>
      closeRecords(records: unknown[], reason: string): Promise<void>
    }
    /** 中文说明：变量 records 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const records = [...internal.sessions.values()]
    /** 中文说明：变量 firstFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstFailure = expect(internal.closeRecords(records, 'test failure')).rejects.toThrow('failed to close 1 PTY session')
    /** 中文说明：变量 joinedFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const joinedFailure = expect(internal.closeRecords(records, 'joined failure')).rejects.toThrow('failed to close 1 PTY session')
    await firstFailure
    await joinedFailure
    b.sessions[0]!.rejectClose = false
    await expect(internal.closeRecords([...internal.sessions.values()], 'retry')).resolves.toBeUndefined()
    expect(b.sessions[0]!.closed).toEqual(['test failure', 'retry'])
    expect(internal.sessions.size).toBe(0)
    await disposeTerminalSessionService(ctx)
    await expect(service.spawn(owner, { type: 'stub' })).rejects.toMatchObject({ code: 'SERVICE_DISPOSING' })
  })

  it('clears registries and runs owner cleanups even when a session close fails', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = ctx.terminals
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = backend()
    service.registerBackend(b.provider)
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    await service.spawn(owner, { type: 'stub' })
    b.sessions[0]!.rejectClose = true
    /** 中文说明：变量 internal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const internal = service as unknown as {
      disposeAll(): Promise<void>
      backends: Map<string, unknown>
      ownerCleanups: Map<Agent, unknown>
    }
    // Teardown surfaces the close failure, but its finally still clears the
    // backend and owner-cleanup registries instead of orphaning them.
    await expect(internal.disposeAll()).rejects.toThrow('failed to clean up PTY lifecycle')
    expect(internal.backends.size).toBe(0)
    expect(internal.ownerCleanups.size).toBe(0)
  })
})
