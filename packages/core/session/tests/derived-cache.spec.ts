/**
 * 文件职责：验证Session 状态的 derived-cache.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Session 状态在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { createUserMessage, createMessage } from '@deepseek-ai/dsh-llm'
/**
 * Derived-message cache contract against a scratch oracle: project new nodes
 * once, rebuild on surface replacements, return fresh arrays over shared
 * frozen messages, and remain value-equal to replay at every step.
 */

import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

/** 中文说明：测试辅助函数 userText 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function userText(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** From-scratch oracle: replay the log into a fresh session and derive. */
/* 中文说明：测试辅助函数 scratch 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function scratch(session: Session): unknown {
  return Session.create(SessionId(`${session.id}-scratch-${session.seq}`), session.snapshotEvents()).deriveMessages()
}

describe('derived-message cache', () => {
  it('stays deep-equal to a from-scratch replay derivation as the log grows', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('cache-grow'))
    session.append('turn/start', { turn: 1 })
    userText(session, 'one')
    expect(session.deriveMessages()).toEqual(scratch(session))
    userText(session, 'two')
    session.append('assistant/message', {
      stream: [],
      turn: 1, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, { surfaceOp: 'append' })
    expect(session.deriveMessages()).toEqual(scratch(session))
    session.append('assistant/message', {
      stream: [],
      turn: 1, step: 2,
      message: createMessage({
        role: 'assistant',
        content: [],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
      usage: { inputTokens: 1, outputTokens: 0 },
    }, { surfaceOp: 'append' })
    expect(session.deriveMessages()).toEqual(scratch(session))
  })

  it('rebuilds on a surface replace and still matches scratch', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('cache-replace'))
    session.append('turn/start', { turn: 1 })
    userText(session, 'one')
    userText(session, 'two')
    /** 中文说明：测试局部值 beforeReplace，由紧邻初始化决定，仅在当前场景使用。 */
    const beforeReplace = session.deriveMessages()
    expect(beforeReplace).toHaveLength(2)

    /** 中文说明：测试局部值 nodes，由紧邻初始化决定，仅在当前场景使用。 */
    const nodes = session.surface.nodes
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }], source: { kind: 'plugin', plugin: 'compact' },
    }), { surfaceOp: { op: 'replace', start: nodes[0]!, end: nodes[1]! }, sourceEventSeqs: [nodes[0]!, nodes[1]!] })

    expect(session.deriveMessages()).toHaveLength(1)
    expect(session.deriveMessages()).toEqual(scratch(session))
    expect(beforeReplace).toHaveLength(2)
  })

  it('returns a fresh array per call: later appends never grow a held snapshot', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('cache-snapshot'))
    session.append('turn/start', { turn: 1 })
    userText(session, 'one')
    /** 中文说明：测试局部值 first，由紧邻初始化决定，仅在当前场景使用。 */
    const first = session.deriveMessages()
    userText(session, 'two')
    /** 中文说明：测试局部值 second，由紧邻初始化决定，仅在当前场景使用。 */
    const second = session.deriveMessages()
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
    // Array snapshots share their frozen message projections.
    expect(second[0]).toBe(first[0])
    expect(Object.isFrozen(first[0])).toBe(true)
  })

})

describe('Session.deriveEventMessage — the per-event projection', () => {
  it('projects one appended event exactly as the full derivation projects its node', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('per-event'))
    session.append('turn/start', { turn: 1 })
    /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
    const event = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    // Full and per-event derivation share one projection.
    expect(session.deriveEventMessage(event)).toEqual(session.deriveMessages().at(-1))
  })

  it('reuses the logged event\'s already frozen content', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('per-event-clone'))
    session.append('turn/start', { turn: 1 })
    /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
    const event = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'orig' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    /** 中文说明：测试局部值 message，由紧邻初始化决定，仅在当前场景使用。 */
    const message = session.deriveEventMessage(event)!
    expect(message.content).toBe(event.data.content)
    expect(Object.isFrozen(message.content)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
    expect(() => { (message.content[0] as { text: string }).text = 'mutated' }).toThrow()
    expect(session.deriveMessages().at(-1)!.content).toEqual([{ type: 'text', text: 'orig' }])
  })

  it('projects null for events that produce no message (boundaries, empty assistant)', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('per-event-null'))
    session.append('turn/start', { turn: 1 })
    /** 中文说明：测试局部值 boundary，由紧邻初始化决定，仅在当前场景使用。 */
    const boundary = session.append('step/start', { turn: 1, step: 1 })
    expect(session.deriveEventMessage(boundary)).toBeNull()
    /** 中文说明：测试局部值 empty，由紧邻初始化决定，仅在当前场景使用。 */
    const empty = session.append('assistant/message', {
      stream: [],
      turn: 1, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, { surfaceOp: 'append' })
    expect(session.deriveEventMessage(empty)).toBeNull()
  })
})
