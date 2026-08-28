import type { ConversationViewDefinition } from '../contract/conversation.ts'
import { ConversationDefinitionRegistry } from './definition-registry.ts'

/** Runtime registry of per-target Conversation snapshot builders. */
export class ConversationViewRegistry extends ConversationDefinitionRegistry<ConversationViewDefinition> {

  /**
   * Register a uniquely named view builder factory for the caller's lifetime.
   * @param definition - target builder contribution.
   * @returns idempotent disposer.
   */
  /*
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
      `uiConversation.views.register(${JSON.stringify(definition.target)})`,
    )
  }
}
