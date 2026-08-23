/**
 * ================================ 文件注释 ================================
 * 【文件职责】Web 提问插件的浏览器侧入口：QuestionComposer 作为对话声明输入条链的
 *             选择器路由条目注册，外加 question 字典。
 * 【技术维度】Cordis 浏览器插件 + 链选择器：选择器把所有者货币收窄到提问载体
 *             （matched prop）；业务行为全部骑在载体上（contract/slots.ts 的
 *             PendingQuestion 领域编码）；文案走标准 locale 席位。
 * 【产品维度】等待用户回答的提问：通用提问流程与 plan-review 决策卡片两种形态。
 * 【逻辑维度】selectQuestion 从交互中选出提问载体 → QuestionComposer 按载体呈现
 *             对应表面（plan-review 意图或通用提问）。
 * 【关键边界】一个条目两种形态（而非每形态一个链条目）——同一载体不会竞速。
 * 【新手阅读建议】先读 contract/slots.ts 的载体类型，再看组件的形态分派。
 * ==========================================================================
 */
/**
 * Web question plugin, browser half: QuestionComposer registered as a
 * selector-routed entry of the conversation-declared composer chain, plus the
 * `question` dictionaries. The selector narrows the owner's currency to the
 * question carrier (matched prop), and the whole behavior surface rides the
 * carrier (domain encoding in contract/slots.ts PendingQuestion); copy rides
 * the standard locale seat. Export discipline: packages/client/AGENTS.md.
 *
 * One entry, two shapes: the composer renders a request that declares a
 * presentation intent as that intent's own surface (`plan-review` → the plan
 * decision card) and every other request as the generic question flow. A
 * separate chain entry per shape would race the same carrier, so the shape
 * choice lives inside this entry — see QuestionComposer.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { QuestionWait } from './contract/slots.ts'
import { QuestionComposer } from './QuestionComposer.tsx'
import { en, zh, type QuestionKey } from './locales.ts'

export { PendingQuestion } from './contract/slots.ts'
export type {
  PlanReview, QuestionAnswer, QuestionComposerProps, QuestionWait,
} from './contract/slots.ts'
export type { QuestionKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The question composer's copy. */
    question: QuestionKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'question'

/** Required services: the slot registry and the question composer's copy. */
export const inject = ['slots', 'locale']

/** Chain routing: claim the composer while a question wait is pending (pure — owner props only). */
function selectQuestion({ interactions }: ComposerChainProps): QuestionWait | null {
  return interactions.find((i): i is QuestionWait => i.kind === 'question') ?? null
}

/**
 * Client plugin body: register the `question` dictionaries and the question
 * composer into the composer chain. Zero business face — data and verbs live
 * on the matched carrier; t rides the standard locale seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-user-questions: dictionaries')

  ctx.slots.inject('conversation.composer', () => ctx.slots.register(
    { name: 'conversation.composer', select: selectQuestion, locale: NS },
    QuestionComposer,
  ))
}
