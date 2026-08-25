// SessionTitleService.rename: user-source acceptance, normalization/rejection
// boundaries, and the pin (a user-sourced latest title schedules no automatic
// revision; explicit refresh stays the unpin).
/**
 * 文件职责：验证 rename.spec.ts 覆盖的会话标题行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的会话标题能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService, {
  SessionTitleProviderId,
  foldSessionTitle,
  /** 中文说明：type SessionTitleProviderRequest 定义本测试所需的数据或行为，用于表达会话标题场景。 */
  type SessionTitleProviderRequest,
} from '@deepseek-ai/dsh-session-title'

/** 中文说明：常量 CONFIG 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CONFIG = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 40,
  maxTitleBytes: 40,
} as const

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

describe('SessionTitleService.rename', () => {
  it('appends a normalized user-source title', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('rename-accept'))
    session.append('turn/start', { turn: 1 })
    appendHumanPrompt(session, 'Original prompt text')
    await settle()

    /** 中文说明：变量 accepted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const accepted = ctx.sessionTitle.rename(session, '  Hand\tpicked   name  ')
    expect(accepted).toMatchObject({
      title: 'Hand picked name',
      messageSeqs: [],
      source: { kind: 'user' },
    })
    /** 中文说明：函数值 event 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const event = session.events.findLast(item => item.type === 'session/title')
    expect(event?.data).toEqual({
      title: 'Hand picked name',
      messageSeqs: [],
      source: { kind: 'user' },
    })
    // foldSessionTitle round-trips the third source kind.
    expect(foldSessionTitle(session.events)?.source).toEqual({ kind: 'user' })
  })

  it('rejects titles that normalize to empty and dead sessions', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('rename-reject'))
    expect(() => ctx.sessionTitle.rename(session, '  [31m  ')).toThrow(/visible characters/)

    expect(() => ctx.sessionTitle.rename(Session.create(SessionId('detached')), 'name'))
      .toThrow(/not live in this store/)
  })

  it('pins the title: later user messages schedule no automatic revision; refresh unpins', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：函数值 generate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const generate = vi.fn(async (request: SessionTitleProviderRequest) => ({
      title: 'Provider title',
      messageSeqs: request.messages.map(message => message.seq),
    }))
    ctx.sessionTitle.register({
      id: SessionTitleProviderId('pin-provider'),
      automatic: 'all-prompts',
      generate,
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('rename-pin'))
    session.append('turn/start', { turn: 1 })
    appendHumanPrompt(session, 'First prompt')
    await settle()
    ctx.sessionTitle.rename(session, 'Pinned by hand')

    // A later eligible prompt must schedule nothing while the pin stands.
    appendHumanPrompt(session, 'Second prompt after the pin')
    await settle()
    session.append('request/header', {
      header: { config: { provider: 'main-route', model: 'chat-model' } },
      reason: 'change',
    })
    await settle()
    expect(generate).not.toHaveBeenCalled()
    expect(ctx.sessionTitle.get(session)?.title).toBe('Pinned by hand')

    // Explicit refresh remains the deliberate unpin.
    /** 中文说明：变量 refreshed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const refreshed = await ctx.sessionTitle.refresh(session)
    expect(generate).toHaveBeenCalledOnce()
    expect(refreshed?.title).toBe('Provider title')
    expect(ctx.sessionTitle.get(session)?.source.kind).toBe('provider')
  })

  it('fallback-only refresh also unpins: the user title yields to a re-derived fallback', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('rename-unpin-fallback'))
    session.append('turn/start', { turn: 1 })
    appendHumanPrompt(session, 'Derivable prompt words')
    await settle()
    ctx.sessionTitle.rename(session, 'Pinned without provider')
    expect(ctx.sessionTitle.get(session)?.source.kind).toBe('user')

    /** 中文说明：变量 refreshed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const refreshed = await ctx.sessionTitle.refresh(session)
    expect(refreshed).toMatchObject({
      title: 'Derivable prompt words',
      source: { kind: 'fallback' },
    })
    // The pin is gone: the latest title is fallback-sourced, so the
    // onUserMessage pin check no longer skips scheduling.
    expect(ctx.sessionTitle.get(session)?.source.kind).toBe('fallback')
  })

  it('supersedes in-flight automatic generation: a late provider result cannot override the user title', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    // The provider parks on a test-held deferred so rename lands while its
    // generation is ACTIVE (not merely scheduled).
    /** 中文说明：函数值 releaseProvider 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let releaseProvider: (() => void) | undefined
    /** 中文说明：函数值 gate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const gate = new Promise<void>((resolve) => { releaseProvider = resolve })
    /** 中文说明：变量 aborted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let aborted = false
    /** 中文说明：函数值 generate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const generate = vi.fn(async (request: SessionTitleProviderRequest) => {
      request.signal.addEventListener('abort', () => { aborted = true })
      await gate
      return { title: 'Late provider title', messageSeqs: request.messages.map(message => message.seq) }
    })
    ctx.sessionTitle.register({
      id: SessionTitleProviderId('deferred-provider'),
      automatic: 'all-prompts',
      generate,
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('rename-supersede'))
    session.append('turn/start', { turn: 1 })
    appendHumanPrompt(session, 'Prompt that triggers generation')
    session.append('request/header', {
      header: { config: { provider: 'main-route', model: 'chat-model' } },
      reason: 'change',
    })
    await settle()
    expect(generate).toHaveBeenCalledOnce()

    ctx.sessionTitle.rename(session, 'User wins')
    expect(aborted).toBe(true)
    releaseProvider?.()
    await settle()
    // The released provider result must not append over the user title, and
    // the swallowed abort must not surface as an unhandled rejection.
    /** 中文说明：函数值 latest 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const latest = session.events.findLast(item => item.type === 'session/title')
    expect(latest?.data).toMatchObject({ title: 'User wins', source: { kind: 'user' } })
  })

  it('fallback-only refresh keeps the user title when no fallback is derivable', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    // A 3-byte fallback cap cannot hold the 4-byte emoji prompt: the
    // re-derived fallback is empty, so the pinned title survives the refresh.
    await ctx.plugin(SessionTitleService, { ...CONFIG, fallbackMaxBytes: 3 })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('rename-unpin-empty'))
    session.append('turn/start', { turn: 1 })
    appendHumanPrompt(session, '😀😀')
    await settle()
    ctx.sessionTitle.rename(session, 'Sticky emoji pin')

    /** 中文说明：变量 refreshed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const refreshed = await ctx.sessionTitle.refresh(session)
    expect(refreshed?.title).toBe('Sticky emoji pin')
    expect(ctx.sessionTitle.get(session)?.source.kind).toBe('user')
  })
})
