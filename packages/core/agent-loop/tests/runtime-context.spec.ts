import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { RuntimeContextProjection } from '../src/runtime-context.ts'

/** 运行时上下文消息的固定插件来源，用于区分普通用户消息。 */
const SOURCE = '@deepseek-ai/dsh-system-prompt'

/** 中文：把 text 包装成系统提示插件来源的用户消息；返回可追加的消息数据。示例：contextMessage('policy')。 */
function contextMessage(text: string) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: SOURCE },
  })
}

/** 中文：RuntimeContextProjection 的回放、更新和跨会话隔离测试组。 */
describe('RuntimeContextProjection', () => {
  /** 中文：构造表面替换历史并断言投影行为；无参数和返回值。 */
  it('restores the latest visible owned snapshot and ignores other sessions', async () => {
    /** 持有会话服务的测试上下文。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 被投影读取的主会话。 */
    const session = ctx.sessions.create(SessionId('runtime-context-replay'))
    /** 仍留在可见表面的插件消息事件。 */
    const retained = session.append('user/message', contextMessage('retained'), { surfaceOp: 'append' })
    /** 随后被摘要替换的插件消息事件。 */
    const shadowed = session.append('user/message', contextMessage('shadowed'), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }],
      source: { kind: 'plugin', plugin: 'test-compaction' },
    }), {
      surfaceOp: { op: 'replace', start: shadowed.seq, end: shadowed.seq },
      sourceEventSeqs: [shadowed.seq],
    })

    /** 绑定主会话的运行时上下文投影。 */
    const projection = new RuntimeContextProjection(ctx, session)
    expect(session.surface.nodes).toContain(retained.seq)
    expect(projection.project('retained', [])).toBeUndefined()
    expect(projection.project('next', [{ name: 'sandbox:policy', text: 'policy' }])?.source).toEqual({
      kind: 'plugin',
      plugin: SOURCE,
      form: 'snapshot',
      sections: [{ name: 'sandbox:policy', text: 'policy' }],
    })

    /** 用于证明其他会话事件不会影响主会话投影的对照会话。 */
    const other = ctx.sessions.create(SessionId('runtime-context-other'))
    other.append('user/message', contextMessage('other'), { surfaceOp: 'append' })
    expect(projection.project('retained', [])).toBeUndefined()
  })
})
/**
 * 中文说明：
 * - 文件职责：验证运行时上下文投影只恢复本会话最新可见的系统提示快照。
 * - 技术维度：使用 Vitest、Cordis、会话事件表面投影和插件来源消息类型。
 * - 产品维度：保障会话压缩或多会话并存时，模型不会收到过期或串线的运行时上下文。
 * - 逻辑维度：构造保留、被替换和其他来源消息，创建投影，再验证去重、更新和会话隔离。
 * - 关键边界：只识别指定插件来源的 snapshot；被 surface replace 隐藏的事件不可恢复。
 * - 新手阅读建议：先理解 retained/shadowed 的 surface 操作，再看 project 两次调用为何返回不同结果。
 */
