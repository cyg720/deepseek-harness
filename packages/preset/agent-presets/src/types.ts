/** Client-safe event declarations owned by the agent-preset domain. */
/*
 * 文件职责：声明代理预设领域可供客户端安全引用的 Cordis 事件类型。
 * 技术维度：通过 TypeScript 模块扩充为 Cordis Events 接口增加强类型事件签名。
 * 产品维度：让界面在会话切换代理预设后准确刷新由该会话组合派生的状态。
 * 逻辑维度：导入品牌化会话标识，扩充事件映射，最后以空导出保持本文件的模块身份。
 * 关键边界：本文件只声明类型，不发送事件；事件参数必须与实际提交到持久日志的预设保持一致。
 * 新手阅读建议：先理解 SessionId 用于区分会话，再沿事件名查找事件的发送者和监听者。
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

// 类型扩充：把代理预设领域拥有的事件合并到 Cordis 的全局事件映射中。
declare module '@deepseek-ai/cordis' {
  // Events：Cordis 的事件名到监听函数签名的映射；这里只增加一个预设选择事件。
  interface Events {
    /**
     * One session committed a different agent preset to its durable log.
     * Consumers invalidate only state derived from that session's composition.
     * @mode emit
     * @param sessionId - the session whose composition changed.
     * @param agentPreset - the preset recorded by the committed selection.
     */
    /*
     * 一个会话把新的代理预设提交到持久日志后发出此事件。
     * 消费方只应失效由该会话组合派生的状态。
     * @mode emit
     * @param sessionId - 发生组合变化的品牌化会话标识。
     * @param agentPreset - 已提交选择所记录的预设名称。
     * @returns 不返回值；该事件仅用于通知监听者。
     * @example ctx.emit('agent-preset/selected', sessionId, 'default')
     */
    'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
  }
}

// 空导出：确保模块扩充在模块作用域生效，不产生运行时代码。
export {}
