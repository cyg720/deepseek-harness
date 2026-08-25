/**
 * 文件职责：验证 session-title.spec.ts 覆盖的会话标题行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的会话标题能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService, {
  SessionTitleProviderId,
  fallbackSessionTitle,
  foldSessionTitle,
  normalizeSessionTitle,
  truncateTitleUtf8,
} from '@deepseek-ai/dsh-session-title'

/** 中文说明：常量 CONFIG 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CONFIG = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 40,
  maxTitleBytes: 80,
} as const

/** 中文说明：函数 settleTitles 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function settleTitles(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('session title normalization', () => {
  it('removes terminal controls, collapses whitespace, and applies word and UTF-8 byte caps', () => {
    expect(normalizeSessionTitle('\u001B]0;stolen\u0007  Hello\t brave\nnew world  ', 80))
      .toBe('Hello brave new world')
    expect(fallbackSessionTitle('one two three four', 3, 80)).toBe('one two three')
    expect(fallbackSessionTitle('你好世界', 5, 7)).toBe('你好')
    expect(Buffer.byteLength(fallbackSessionTitle('😀😀', 5, 5), 'utf8')).toBe(4)
  })

  it('rejects non-positive and fractional public limits', () => {
    expect(() => truncateTitleUtf8('title', 0)).toThrow(/maxBytes must be a positive integer/)
    expect(() => fallbackSessionTitle('title', 1.5, 10)).toThrow(/maxWords must be a positive integer/)
  })
})

describe('SessionTitleService', () => {
  it('logs and folds an immediate fallback after the first eligible human text message', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('fresh'))
    session.append('turn/start', {
      turn: 1,
    })
    /** 中文说明：变量 message 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const message = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '  Build\nlog-backed session titles please  ' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await settleTitles()

    /** 中文说明：函数值 titleEvent 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const titleEvent = session.events.findLast(event => event.type === 'session/title')
    expect(titleEvent).toMatchObject({
      type: 'session/title',
      seq: 2,
      data: {
        title: 'Build log-backed session titles please',
        messageSeqs: [message.seq],
        source: { kind: 'fallback' },
      },
    })
    expect(ctx.sessionTitle.get(session)).toEqual({
      title: 'Build log-backed session titles please',
      messageSeqs: [message.seq],
      source: { kind: 'fallback' },
      eventSeq: 2,
      updatedAt: titleEvent?.time,
    })
    expect(session.deriveMessages()).toHaveLength(1)
    expect(session.surface.nodes).toEqual([message.seq])
  })

  it('derives a fallback title from the direct prompt instead of injected context', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('prefixed-title'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Referenced session snapshot' }],
      source: {
        kind: 'session-reference',
        form: 'recall',
        version: 1,
        references: [],
      },
    }), { surfaceOp: 'append' })
    session.append('turn/start', {
      turn: 1,
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Explain this referenced session' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await settleTitles()

    expect(ctx.sessionTitle.get(session)?.title).toBe('Explain this referenced session')
  })

  it('waits through synthetic, empty, and non-text messages, then keeps the first fallback', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('eligibility'))
    session.append('turn/start', {
      turn: 1,
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'plugin text' }],
      source: { kind: 'plugin', plugin: 'seed' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'reasoning', text: 'not visible text' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: ' \n\t ' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settleTitles()
    expect(ctx.sessionTitle.get(session)).toBeUndefined()

    /** 中文说明：变量 eligible 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const eligible = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first real prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settleTitles()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = ctx.sessionTitle.get(session)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'later prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settleTitles()

    expect(first?.messageSeqs).toEqual([eligible.seq])
    expect(ctx.sessionTitle.get(session)).toEqual(first)
    expect(session.events.filter(event => event.type === 'session/title')).toHaveLength(1)
  })

  it('folds the latest title event during replay', () => {
    /** 中文说明：变量 seed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seed = Session.create(SessionId('source'))
    seed.append('session/title', {
      title: 'Earlier',
      messageSeqs: [1],
      source: { kind: 'fallback' },
    })
    seed.append('session/title', {
      title: 'Later',
      messageSeqs: [1, 4],
      source: {
        kind: 'provider',
        provider: SessionTitleProviderId('test-provider'),
        model: { provider: 'mock', model: 'title-model' },
      },
    })

    expect(foldSessionTitle(seed.events)).toEqual({
      title: 'Later',
      messageSeqs: [1, 4],
      source: {
        kind: 'provider',
        provider: SessionTitleProviderId('test-provider'),
        model: { provider: 'mock', model: 'title-model' },
      },
      eventSeq: 1,
      updatedAt: seed.events[1]?.time,
    })
  })
})
