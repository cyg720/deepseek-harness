/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话快照视图（Conversation View）构建器的运行时注册表：
 *   把"目标标识 -> 快照构建定义"的映射注册进 Cordis 上下文。
 * 【技术维度】基于 @deepseek-ai/cordis 的 Context 生命周期；继承
 *   ConversationDefinitionRegistry 复用注册、去重、自动清理逻辑。
 * 【产品维度】客户端 UI 需要把会话内部状态投影成多种展示视图（消息流、
 *   工具调用树等），本文件是这些视图构建器的"注册中心"。
 * 【逻辑维度】构造函数以 'conversationViews' 为注册表键名初始化基类；
 *   register() 将 target 与定义绑定并做重名校验，返回幂等销毁函数。
 * 【关键边界】target 必须全局唯一，重复注册立即抛错；注册随调用方
 *   （插件）生命周期自动回收，调用方不应手动重复销毁。
 * 【新手阅读建议】先读 definition-registry.ts 理解基类机制。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationViewDefinition } from '../contract/conversation.ts'
import { ConversationDefinitionRegistry } from './definition-registry.ts'

/** Runtime registry of per-target Conversation snapshot builders. */
export class ConversationViewRegistry extends ConversationDefinitionRegistry<ConversationViewDefinition> {

  /** @param ctx - owning Client Runtime context. */
  /** 构造函数：把注册表挂到给定上下文中，并声明注册表键名为 'conversationViews'。 */
  constructor(ctx: Context) {
    super(ctx, 'conversationViews')
  }

  /**
   * Register a uniquely named view builder factory for the caller's lifetime.
   * @param definition - target builder contribution.
   * @returns idempotent disposer.
   */
  /**
   * 注册一个视图构建器：以 definition.target 为唯一键保存，供投影层按目标查询；
   * 调用方（插件）生命周期结束时自动回收。重复注册同名 target 会立即抛错。
   * @param definition 要注册的目标快照构建器贡献（含 target 与构建函数）。
   * @returns 幂等清理函数：调用任意次数效果相同，只清理一次。
   */
  register(definition: ConversationViewDefinition): () => void {
    return this.registerDefinition(
      definition.target,
      definition,
      `conversation view target "${definition.target}" is already registered`,
      `conversationViews.register(${JSON.stringify(definition.target)})`,
    )
  }
}
