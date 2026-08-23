/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话"事件"定义的运行时注册表：注册节点构建器（按 kind 键控）
 *   与一个仅兜底的 fallback 定义。
 * 【技术维度】继承 ConversationDefinitionRegistry；额外管理唯一 fallback；
 *   注册前用 assertDefinitionTarget 校验 target/buildViewNode 成对出现。
 * 【产品维度】会话消息流按事件类型渲染：普通定义匹配具体 kind，
 *   fallback 只在没有任何普通定义匹配时兜底渲染未知事件。
 * 【逻辑维度】register 以 kind 为键注册；registerFallback 注册唯一兜底；
 *   fallbackEntry 读取当前兜底。
 * 【关键边界】fallback 全局唯一（重复注册抛错）且必须声明 target；
 *   普通定义的 target 与 buildViewNode 必须同时声明或同时不声明。
 * 【新手阅读建议】先读 definition-registry.ts 基类，再看本类的差异点。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '../contract/conversation.ts'
import { ConversationDefinitionRegistry } from './definition-registry.ts'

/** Runtime registry of independently owned Conversation business Definitions. */
/** 独立持有的会话业务定义的运行时注册表。 */
export class ConversationEventRegistry extends ConversationDefinitionRegistry<ConversationNodeDefinition> {
  private fallback: ConversationNodeDefinition | undefined // 唯一兜底定义；未注册时为 undefined

  /** @param ctx - owning Client Runtime context. */
  /** 构造函数：把注册表挂到给定上下文，注册表键名为 'conversationEvents'。 */
  constructor(ctx: Context) {
    super(ctx, 'conversationEvents')
  }

  /**
   * Register a uniquely named business Definition for the caller's lifetime.
   * @param definition - Definition contribution.
   * @returns idempotent disposer.
   */
  /**
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
      `conversationEvents.register(${JSON.stringify(definition.kind)})`,
    )
  }

  /**
   * Register the sole fallback used only when no ordinary Definition matches.
   * @param definition - fallback Definition.
   * @returns idempotent disposer.
   */
  /**
   * 注册唯一的兜底定义，仅在没有普通定义匹配时使用。
   * @param definition 兜底定义。
   * @returns 幂等销毁函数。
   */
  registerFallback(definition: ConversationNodeDefinition): () => void {
    assertDefinitionTarget(definition)
    const target = definition.target
    if (target === undefined) throw new Error('conversation fallback Definition must declare a target')
    if (this.fallback !== undefined) throw new Error('conversation fallback Definition is already registered')
    const owner = this.ctx
    const dispose = owner.effect(() => {
      this.fallback = definition
      this.refresh()
      return () => {
        if (this.fallback !== definition) return
        this.fallback = undefined
        this.refresh()
      }
    }, `conversationEvents.registerFallback(${JSON.stringify(definition.kind)})`)
    return () => { void dispose() }
  }

  /**
   * Return the current unmatched-event fallback.
   * @returns installed fallback, when present.
   */
  /**
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
