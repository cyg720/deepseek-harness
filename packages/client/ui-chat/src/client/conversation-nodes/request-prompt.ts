/**
 * 文件职责：实现 client/ui-chat 中 request prompt 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition, RequestPromptInspector,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { chatNode } from './common.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Complete system prompt rendered for one model request. */
    'system-prompt': { readonly text: string }
  }
}

interface RequestPromptState extends ReturnType<RequestPromptInspector> {
  readonly anchorSeq: number
  readonly showsPrompt: boolean
  readonly turn?: number
  readonly step?: number
}

/** Place a request's system field at the start of its visible message series.
 * @remarks 中文说明：功能说明：处理 requestPromptAnchor 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：match（ConversationMatch）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：previous（Readonly<RequestPromptState> | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：isInitial（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：number；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * requestPromptAnchor(match, previous, isInitial)，并按返回类型处理结果。 */
function requestPromptAnchor(
  match: ConversationMatch,
  previous: Readonly<RequestPromptState> | undefined,
  isInitial: boolean,
): number {
  if (match.location.kind !== 'step') return match.event.seq
  if (previous === undefined && !isInitial) return match.event.seq
  if (previous?.turn === match.location.turn.turn
    && previous.step === match.location.step.step) return match.event.seq
  return match.location.step.step === 1
    ? match.location.turn.start?.seq ?? match.location.step.start?.seq ?? match.event.seq
    : match.location.step.start?.seq ?? match.event.seq
}

/** Keep an already rendered prompt at its page-lifetime presentation anchor.
 * @remarks 中文说明：功能说明：处理 stableRequestPromptAnchor 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：context（ConversationNodeContext<RequestPromptState>）：提供当前 Cordis
 * 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；参数说明：match（ConversationMatch）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：previous（Readonly<RequestPromptState> |
 * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：isInitial（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * stableRequestPromptAnchor(context, match, previous, isInitial)，
 * 并按返回类型处理结果。 */
function stableRequestPromptAnchor(
  context: ConversationNodeContext<RequestPromptState>,
  match: ConversationMatch,
  previous: Readonly<RequestPromptState> | undefined,
  isInitial: boolean,
): number {
  /**
   * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const current = context.current.get('chat') as ChatNode | null | undefined
  return current?.kind === 'system-prompt'
    ? current.anchorSeq
    : requestPromptAnchor(match, previous, isInitial)
}

/**
 * Request-header prompt Definition for the Chat target.
 * @param inspect - the shared prompt interpretation, supplied by the
 * uiConversation service (a client bundle cannot value-import it).
 * @returns the Chat request-prompt Definition.
 * @remarks 中文说明：功能说明：处理 requestPromptDefinition 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：inspect（RequestPromptInspector）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ConversationNodeDefinition<RequestPromptState>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 requestPromptDefinition(inspect)，
 * 并按返回类型处理结果。
 */
export function requestPromptDefinition(inspect: RequestPromptInspector): ConversationNodeDefinition<RequestPromptState> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：context（由 TypeScript
   * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；参数：match（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reader（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(context, match,
   * reader)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：context（由 TypeScript
   * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(context)，
   * 并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：context（由 TypeScript
   * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(context)，
   * 并按返回类型处理结果。
   */
  return {
    kind: 'request-prompt',
    target: 'chat',
    match: event => event.type === 'request/header'
      ? { id: String(event.seq), role: 'start' }
      : null,
    start: (context, match, reader) => {
      if (match.event.type !== 'request/header') {
        throw new Error('request-prompt start requires request/header')
      }
      /**
       * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const previous = reader.previous<RequestPromptState>('request-prompt')?.state
      /**
       * 常量说明：location 用于处理 location 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const location = match.location.kind === 'step'
        ? { turn: match.location.turn.turn, step: match.location.step.step }
        : {}
      /**
       * 常量说明：inspection 用于处理 inspection 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const inspection = inspect(previous?.prompt, match.event)
      /**
       * 常量说明：change 用于处理 change 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const change = inspection.change?.kind
      return {
        anchorSeq: stableRequestPromptAnchor(
          context,
          match,
          previous,
          match.event.data.reason === 'initial',
        ),
        showsPrompt: previous === undefined
          || match.event.data.reason !== 'change'
          || match.event.data.startsSeries === true
          || change === 'system'
          || change === 'system-and-tools',
        ...location,
        ...inspection,
      }
    },
    update: context => context.state,
    buildViewNode: (context) => {
      /**
       * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const state = context.state
      if (state === undefined || !state.showsPrompt || state.prompt.system === '') return null
      return chatNode(context, 'system-prompt', state.anchorSeq, { text: state.prompt.system })
    },
  }
}

/**
 * Register model-request system prompts in the Chat flow.
 * @param ctx - Owning UI Conversation context.
 * @remarks 中文说明：功能说明：注册 Request Prompt Conversation Node 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 registerRequestPromptConversationNode(ctx)，
 * 并按返回类型处理结果。
 */
export function registerRequestPromptConversationNode(ctx: Context): void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：previous（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(previous, event)，
   * 并按返回类型处理结果。
   */
  ctx.uiConversation.events.register(requestPromptDefinition(
    (previous, event) => ctx.uiConversation.inspectRequestPrompt(previous, event),
  ))
}
