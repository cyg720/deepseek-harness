import type { ConversationNodeDefinition } from '../contract/conversation.ts'
import { ConversationDefinitionRegistry } from './definition-registry.ts'

/** Runtime registry of independently owned Conversation business Definitions. */
/* 独立持有的会话业务定义的运行时注册表。 */
export class ConversationEventRegistry extends ConversationDefinitionRegistry<ConversationNodeDefinition> {
  private fallback: ConversationNodeDefinition | undefined // 唯一兜底定义；未注册时为 undefined

  /**
   * Register a uniquely named business Definition for the caller's lifetime.
   * @param definition - Definition contribution.
   * @returns idempotent disposer.
   */
  /*
   * 为调用方生命周期注册一个键唯一的业务定义。
   * @param definition 定义贡献。
   * @returns 幂等销毁函数。
   */
  register(definition: ConversationNodeDefinition): () => void {
    assertDefinitionTarget(definition)
    return this.registerDefinition(
      definition.kind,
      definition,
      `conversation Definition "${definition.kind}" is already registered`,
      `uiConversation.events.register(${JSON.stringify(definition.kind)})`,
    )
  }

  /**
   * Register the sole fallback used only when no ordinary Definition matches.
   * @param definition - fallback Definition.
   * @returns idempotent disposer.
   */
  /*
   * 注册唯一的兜底定义，仅在没有普通定义匹配时使用。
   * @param definition 兜底定义。
   * @returns 幂等销毁函数。
   */
  registerFallback(definition: ConversationNodeDefinition): () => void {
    assertDefinitionTarget(definition)
    const target = definition.target
    if (target === undefined) throw new Error('conversation fallback Definition must declare a target')
    if (this.fallback !== undefined) throw new Error('conversation fallback Definition is already registered')
    const dispose = this.ctx.effect(() => {
      this.fallback = definition
      this.refresh()
      return () => {
        if (this.fallback !== definition) return
        this.fallback = undefined
        this.refresh()
      }
    }, `uiConversation.events.registerFallback(${JSON.stringify(definition.kind)})`)
    return () => { void dispose() }
  }

  /**
   * Return the current unmatched-event fallback.
   * @returns installed fallback, when present.
   */
  /*
   * 返回当前未匹配事件的兜底定义。
   * @returns 已安装的兜底定义（若有）。
   */
  fallbackEntry(): ConversationNodeDefinition | undefined {
    return this.fallback
  }
}

/**
 * 校验定义贡献的 target 与 buildViewNode 必须成对声明。
 * @param definition 待校验的节点定义。
 */
function assertDefinitionTarget(definition: ConversationNodeDefinition): void {
  if ((definition.target === undefined) !== (definition.buildViewNode === undefined)) {
    throw new Error(
      `conversation Definition "${definition.kind}" must declare target and buildViewNode together`,
    )
  }
}
