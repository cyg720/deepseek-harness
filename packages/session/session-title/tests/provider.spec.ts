/**
 * 文件职责：验证 provider.spec.ts 覆盖的会话标题行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的会话标题能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import LlmRuntime, { createUserMessage, deepFreeze, markAgentLoopRequest  } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService, {
  SessionTitleProviderId,
  /** 中文说明：type SessionTitleProvider 定义本测试所需的数据或行为，用于表达会话标题场景。 */
  type SessionTitleProvider,
  /** 中文说明：type SessionTitleProviderRequest 定义本测试所需的数据或行为，用于表达会话标题场景。 */
  type SessionTitleProviderRequest,
  /** 中文说明：type SessionTitleProviderResult 定义本测试所需的数据或行为，用于表达会话标题场景。 */
  type SessionTitleProviderResult,
} from '@deepseek-ai/dsh-session-title'

/** 中文说明：常量 CONFIG 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CONFIG = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 24,
  maxTitleBytes: 24,
} as const

/** 中文说明：函数 deferred 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  /** 中文说明：函数值 resolve 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  let resolve!: (value: T) => void
  /** 中文说明：函数值 reject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  let reject!: (error: unknown) => void
  /** 中文说明：函数值 promise 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

/** 中文说明：函数 settle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** 中文说明：函数 appendHumanPrompt 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function appendHumanPrompt(session: ReturnType<Context['sessions']['create']>, text: string) {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** 中文说明：函数 appendRoute 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function appendRoute(session: ReturnType<Context['sessions']['create']>, reason: 'initial' | 'change' = 'initial'): void {
  session.append('request/header', {
    header: { config: { provider: 'main-route', model: 'chat-model' } },
    reason,
  })
}

describe('SessionTitleService Provider lifecycle', () => {
  it('inherits title events across forks, skips first-prompt retitling, and lets all-messages update later', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = ctx.sessions.create(SessionId('title-parent'))
    parent.append('turn/start', {
      turn: 1,
    })
    /** 中文说明：变量 inheritedMessage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inheritedMessage = appendHumanPrompt(parent, 'Inherited title prompt')
    await settle()
    parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.sessions.fork(parent, undefined, SessionId('title-child'))
    expect(ctx.sessionTitle.get(child)).toEqual(ctx.sessionTitle.get(parent))
    expect(child.events.find(event => event.type === 'session/title'))
      .toEqual(parent.events.find(event => event.type === 'session/title'))

    /** 中文说明：函数值 firstGenerate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const firstGenerate = vi.fn(async (request: SessionTitleProviderRequest) => ({
      title: 'Should not run',
      messageSeqs: [request.messages[0]!.seq],
    }))
    /** 中文说明：变量 disposeFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeFirst = ctx.sessionTitle.register({
      id: SessionTitleProviderId('fork-first'),
      automatic: 'first-prompt',
      generate: firstGenerate,
    })
    child.append('turn/start', {
      turn: 2,
    })
    /** 中文说明：变量 childMessage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childMessage = appendHumanPrompt(child, 'Child follow-up prompt')
    await settle()
    appendRoute(child)
    await settle()
    child.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expect(firstGenerate).not.toHaveBeenCalled()
    await disposeFirst()

    /** 中文说明：函数值 allGenerate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const allGenerate = vi.fn(async (request: SessionTitleProviderRequest) => ({
      title: 'Fork all prompts',
      messageSeqs: request.messages.map(message => message.seq),
    }))
    ctx.sessionTitle.register({
      id: SessionTitleProviderId('fork-all'),
      automatic: 'all-prompts',
      generate: allGenerate,
    })
    child.append('turn/start', {
      turn: 3,
    })
    /** 中文说明：变量 latestMessage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const latestMessage = appendHumanPrompt(child, 'Retitle the fork now')
    await settle()
    appendRoute(child, 'change')
    await settle()
    child.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    expect(allGenerate).toHaveBeenCalledOnce()
    expect(ctx.sessionTitle.get(child)).toMatchObject({
      title: 'Fork all prompts',
      messageSeqs: [inheritedMessage.seq, childMessage.seq, latestMessage.seq],
      source: { kind: 'provider', provider: SessionTitleProviderId('fork-all') },
    })
    expect(ctx.sessionTitle.get(parent)?.title).toBe('Inherited title prompt')
  })

  it('runs a first-prompt provider once after the routed request and retries only through refresh', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：变量 requests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const requests: SessionTitleProviderRequest[] = []
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider: SessionTitleProvider = {
      id: SessionTitleProviderId('first-model'),
      automatic: 'first-prompt',
      async generate(request) {
        requests.push(request)
        return {
          title: '\u001B[31m  A   model-generated title that is too long  ',
          messageSeqs: [request.messages[0]!.seq],
          model: { provider: 'aux-route', model: 'title-model' },
        }
      },
    }
    ctx.sessionTitle.register(provider)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('first-provider'))
    session.append('turn/start', {
      turn: 1,
    })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = appendHumanPrompt(session, 'Explain asynchronous title generation')
    await settle()
    expect(ctx.sessionTitle.get(session)?.source.kind).toBe('fallback')

    appendRoute(session)
    await settle()

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      session,
      messages: [{ seq: first.seq, text: 'Explain asynchronous title generation' }],
      route: { provider: 'main-route', model: 'chat-model' },
    })
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      title: 'A model-generated title',
      messageSeqs: [first.seq],
      source: {
        kind: 'provider',
        provider: SessionTitleProviderId('first-model'),
        model: { provider: 'aux-route', model: 'title-model' },
      },
    })

    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = appendHumanPrompt(session, 'A later prompt')
    appendRoute(session, 'change')
    await settle()
    expect(requests).toHaveLength(1)

    await ctx.sessionTitle.refresh(session)
    expect(requests).toHaveLength(2)
    expect(requests[1]?.messages.map(message => message.seq)).toEqual([first.seq, second.seq])
  })

  it('rejects a second provider and drains stale work when the winner is disposed', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = deferred<SessionTitleProviderResult>()
    /** 中文说明：变量 observedSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let observedSignal: AbortSignal | undefined
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first: SessionTitleProvider = {
      id: SessionTitleProviderId('winner'),
      automatic: 'all-prompts',
      generate(request) {
        observedSignal = request.signal
        return pending.promise
      },
    }
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = ctx.sessionTitle.register(first)
    expect(() => ctx.sessionTitle.register({
      id: SessionTitleProviderId('duplicate'),
      automatic: 'first-prompt',
      generate: async () => ({ title: 'duplicate', messageSeqs: [0] }),
    })).toThrow(/already registered/)

    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('dispose-provider'))
    session.append('turn/start', {
      turn: 1,
    })
    /** 中文说明：变量 message 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const message = appendHumanPrompt(session, 'Generate this title')
    await settle()
    appendRoute(session)
    await settle()
    expect(observedSignal?.aborted).toBe(false)

    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = dispose()
    expect(observedSignal?.aborted).toBe(true)
    /** 中文说明：变量 disposed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposed = false
    void disposal.then(() => { disposed = true })
    await settle()
    expect(disposed).toBe(false)
    pending.resolve({ title: 'stale provider result', messageSeqs: [message.seq] })
    await disposal
    expect(disposed).toBe(true)
    expect(ctx.sessionTitle.get(session)?.source.kind).toBe('fallback')

    /** 中文说明：变量 replacement 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replacement: SessionTitleProvider = {
      id: SessionTitleProviderId('replacement'),
      automatic: 'first-prompt',
      generate: async () => ({ title: 'replacement', messageSeqs: [message.seq] }),
    }
    /** 中文说明：变量 disposeReplacement 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeReplacement = ctx.sessionTitle.register(replacement)
    await disposeReplacement()
  })

  it('supersedes an older all-messages revision and cannot commit an ignored abort', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：变量 firstResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstResult = deferred<SessionTitleProviderResult>()
    /** 中文说明：变量 requests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const requests: SessionTitleProviderRequest[] = []
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider: SessionTitleProvider = {
      id: SessionTitleProviderId('all-model'),
      automatic: 'all-prompts',
      generate(request) {
        requests.push(request)
        if (requests.length === 1) return firstResult.promise
        return Promise.resolve({
          title: 'Newest complete title',
          messageSeqs: request.messages.map(message => message.seq),
        })
      },
    }
    ctx.sessionTitle.register(provider)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('supersede'))
    session.append('turn/start', {
      turn: 1,
    })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = appendHumanPrompt(session, 'First prompt')
    await settle()
    appendRoute(session)
    await settle()

    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = appendHumanPrompt(session, 'Second prompt')
    expect(requests[0]?.signal.aborted).toBe(true)
    appendRoute(session, 'change')
    await settle()
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      title: 'Newest complete title',
      messageSeqs: [first.seq, second.seq],
    })

    firstResult.resolve({ title: 'Old ignored result', messageSeqs: [first.seq] })
    await settle()
    expect(ctx.sessionTitle.get(session)?.title).toBe('Newest complete title')
  })

  it('runs an all-messages revision when the next main request reuses its logged header', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：变量 requests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const requests: SessionTitleProviderRequest[] = []
    ctx.sessionTitle.register({
      id: SessionTitleProviderId('unchanged-route'),
      automatic: 'all-prompts',
      async generate(request) {
        requests.push(request)
        return {
          title: `Revision ${requests.length}`,
          messageSeqs: request.messages.map(message => message.seq),
        }
      },
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('unchanged-route'))
    session.append('turn/start', {
      turn: 1,
    })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = appendHumanPrompt(session, 'First routed prompt')
    await settle()
    session.append('step/start', { turn: 1, step: 1 })
    appendRoute(session)
    await settle()
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    session.append('turn/start', {
      turn: 2,
    })
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = appendHumanPrompt(session, 'Second prompt on the same route')
    await settle()
    session.append('step/start', { turn: 2, step: 1 })
    void ctx.llm.stream(markAgentLoopRequest(deepFreeze({
      provider: 'main-route',
      model: 'chat-model',
      messages: session.deriveMessages(),
      sessionId: session.id,
    })))
    await settle()

    expect(session.events.filter(event => event.type === 'request/header')).toHaveLength(1)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      messages: [
        { seq: first.seq, text: 'First routed prompt' },
        { seq: second.seq, text: 'Second prompt on the same route' },
      ],
      route: { provider: 'main-route', model: 'chat-model' },
    })
  })

  it('ignores model streams that are not a matching loop request', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：函数值 generate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const generate = vi.fn(async (request: SessionTitleProviderRequest): Promise<SessionTitleProviderResult> => ({
      title: 'Unexpected title',
      messageSeqs: request.messages.map(message => message.seq),
    }))
    ctx.sessionTitle.register({
      id: SessionTitleProviderId('request-filter'),
      automatic: 'all-prompts',
      generate,
    })
    /** 中文说明：变量 options 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const options = { provider: 'main-route', model: 'chat-model', messages: [] }

    void ctx.llm.stream(deepFreeze(options))
    void ctx.llm.stream(markAgentLoopRequest(deepFreeze({ ...options, sessionId: SessionId('missing') })))
    /** 中文说明：变量 quiet 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const quiet = ctx.sessions.create(SessionId('quiet'))
    void ctx.llm.stream(markAgentLoopRequest(deepFreeze({ ...options, sessionId: quiet.id })))
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.sessions.create(SessionId('unmatched-boundary'))
    pending.append('turn/start', {
      turn: 1,
    })
    appendHumanPrompt(pending, 'Wait for a matching request boundary')
    await settle()
    void ctx.llm.stream(markAgentLoopRequest(deepFreeze({ ...options, sessionId: pending.id })))
    await settle()

    expect(generate).not.toHaveBeenCalled()
  })

  it('contains automatic failures but lets explicit refresh reject', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider: SessionTitleProvider = {
      id: SessionTitleProviderId('failing'),
      automatic: 'all-prompts',
      generate: async () => { throw new Error('title backend failed') },
    }
    ctx.sessionTitle.register(provider)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('failure'))
    session.append('turn/start', {
      turn: 1,
    })
    appendHumanPrompt(session, 'Keep a fallback')
    await settle()
    appendRoute(session)
    await settle()

    expect(ctx.sessionTitle.get(session)?.source.kind).toBe('fallback')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('automatic title generation failed'))
    await expect(ctx.sessionTitle.refresh(session)).rejects.toThrow('title backend failed')
    warn.mockRestore()
  })
})
