// Title-source invariant: `messageSeqs` is empty iff `source.kind` is `user`.
// — the durable relationship every appended session/title event must keep.
// 中文：标题来源规则要求 messageSeqs 为空当且仅当 source.kind 为 user；每条持久化标题事件都必须保持该关系。
/**
 * 中文说明：
 * - 文件职责：验证会话标题来源与引用消息序号之间的不变量。
 * - 技术维度：使用 Vitest、Cordis 插件、不变量注册表和真实会话事件追加路径。
 * - 产品维度：保证自动标题可追溯到消息，而用户手动重命名不会伪造自动引用。
 * - 逻辑维度：setup 装载服务；有效用例接受两种合法组合，无效用例检查拒绝信息和序号不增长。
 * - 关键边界：规则只约束 session/title；失败事件不得进入日志，因此最终 session.seq 保持零。
 * - 新手阅读建议：先记住“user 等价于空引用”，再把四个 append 输入分成合法与非法两组比较。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as SessionTitleInvariantCompanion from '@deepseek-ai/dsh-session-title/invariant'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** 中文：创建装载会话、不变量注册表和标题伴生插件的上下文；无参数，返回 Context Promise。 */
async function setup(): Promise<Context> {
  /** 本测试新建的 Cordis 上下文。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(SessionTitleInvariantCompanion)
  return ctx
}

/** 中文：会话标题来源不变量测试组。 */
describe('session-title source invariant', () => {
  /** 中文：验证自动标题带引用、用户标题无引用时可追加；无参数和返回值。 */
  it('accepts cited automatic titles and citation-free user renames', async () => {
    /** 已装载完整校验链的上下文。 */
    const ctx = await setup()
    /** 接受合法事件的会话。 */
    const session = ctx.sessions.create(SessionId('title-invariant-valid'))
    const source = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'title me' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(() => {
      session.append('session/title', { title: 'auto', messageSeqs: [source.seq], source: { kind: 'fallback' } })
      session.append('session/title', { title: 'named', messageSeqs: [], source: { kind: 'user' } })
    }).not.toThrow()
  })

  /** 中文：验证两种相反非法组合都被拒绝且日志序号不增长；无参数和返回值。 */
  it('rejects a citation-free automatic title and a user rename that cites messages', async () => {
    /** 已装载完整校验链的上下文。 */
    const ctx = await setup()
    /** 专门接收非法追加尝试的会话。 */
    const session = ctx.sessions.create(SessionId('title-invariant-invalid'))
    const source = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'title me' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(() => {
      session.append('session/title', { title: 'auto', messageSeqs: [], source: { kind: 'fallback' } })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session-title',
    }))
    expect(() => {
      session.append('session/title', { title: 'named', messageSeqs: [source.seq], source: { kind: 'user' } })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session-title',
    }))
    expect(session.seq).toBe(1)
  })

  it('requires automatic-title citations to name distinct earlier human messages', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('title-invariant-sources'))
    const boundary = session.append('turn/start', { turn: 1 })
    expect(() => session.append('session/title', {
      title: 'wrong source', messageSeqs: [boundary.seq], source: { kind: 'fallback' },
    })).toThrow(/must name an earlier human user\/message/)
    expect(() => session.append('session/title', {
      title: 'future source', messageSeqs: [SessionSeq(session.seq)], source: { kind: 'fallback' },
    })).toThrow(/must name an earlier human user\/message/)
    expect(() => session.append('session/title', {
      title: 'malformed source', messageSeqs: [-1 as never], source: { kind: 'fallback' },
    })).toThrow(/invalid message seq/)
    const pluginMessage = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'plugin context' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), { surfaceOp: 'append' })
    expect(() => session.append('session/title', {
      title: 'plugin source', messageSeqs: [pluginMessage.seq], source: { kind: 'fallback' },
    })).toThrow(/must name an earlier human user\/message/)
    const source = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'title me' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(() => session.append('session/title', {
      title: 'duplicate source', messageSeqs: [source.seq, source.seq], source: { kind: 'fallback' },
    })).toThrow(/repeats message seq/)
  })

  it('validates title relations when the companion loads after a Session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('title-invariant-existing'))
    const boundary = session.append('turn/start', { turn: 1 })
    session.append('session/title', {
      title: 'wrong source', messageSeqs: [boundary.seq], source: { kind: 'fallback' },
    })
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(SessionTitleInvariantCompanion).then(() => undefined))
      .rejects.toThrow(/must name an earlier human user\/message/)
  })
})
