/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-input-trigger 包在浏览器侧的插件入口：挂载 InputTriggerService、
 *             注册菜单字典，并把 MenuView 注册进输入覆盖层槽位。
 * 【技术维度】Cordis 浏览器插件：ctx.plugin 挂服务、声明合并把 inputTriggers 挂到
 *             Context、把 'slash.menu' 挂到 LocaleNamespaceMap；覆盖层按会话注入。
 * 【产品维度】'/' 与 '@' 触发菜单在输入浮层中的呈现。
 * 【逻辑维度】1) 挂载服务；2) 注册字典；3) 注入 slots/inputTriggers/sessions
 *             作用域，按会话把 MenuView 注册进 overlay（会话 id → 控制器）。
 * 【关键边界】冻结管线契约在 ./contract.ts；源只能通过 ctx.inputTriggers 注册。
 * 【新手阅读建议】先读 core/ 下的纯核心与 service.ts，再看本文件的接线。
 * ==========================================================================
 */
/**
 * Slash trigger plugin, browser half: the InputTriggerService (`ctx.inputTriggers`) owning
 * trigger detection, the candidate menu, and the pick pipeline; MenuView
 * self-registers into the conversation.input.overlay slot. Frozen pipeline
 * contract in ./contract.ts; sources register through ctx.inputTriggers alone.
 */
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { InputTriggerService } from './service.ts'
import type { MenuViewInjected } from './slots.ts'
import { MenuView } from './MenuView.tsx'
import { en, zh, type MenuKey } from './locales.ts'

export { InputTriggerService } from './service.ts'
export { InputTriggerController } from './controller.ts'
export type { InputTriggerControllerDeps, SourceRoster } from './controller.ts'
export type { MenuViewInjected } from './slots.ts'
export type { MenuViewProps } from './MenuView.tsx'
export type { MenuKey } from './locales.ts'
export type {
  ArbitrateKey, ArbitrateOutcome, BeginCommandRequest, CandidateRequest, ClientSessionContext,
  CommandClaim, ConsumeTokenRequest, HeaderRequest, InsertReferenceRequest, PickOutcome, PickVia,
  ReferenceCodec, ReferenceInsert, InputTriggerCandidate, InputTriggerCrumb, InputTriggerPick,
  InputTriggerSource, SubmitEnvelope, SubmitImageAttachment, SubmitOutcome, TokenSpan, TriggerChar,
  TriggerGuard, TriggerPosition,
} from '../types.ts'
export type { DetectTrigger, ExactMatch, MenuEvent, MenuReduce, MenuState, TriggerHit } from '../core/contract.ts'
export type { InputTriggerServiceContract } from './contract.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    inputTriggers: import('./contract.ts').InputTriggerServiceContract
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The candidate menu's copy: group titles keyed by source name, the pending row, and the listbox aria. */
    'slash.menu': MenuKey
  }
}

/** Namespace owning the candidate-menu copy. */
const MENU_NS = 'slash.menu'

/** Required services: controller resolution reads the session scope tree; the menu copy is localized. */
export const inject = ['sessions', 'locale']

/**
 * Client plugin body: mount the service, then register MenuView into the
 * input overlay once its declarer is up.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.plugin(InputTriggerService)
  ctx.effect(() => ctx.locale.register(MENU_NS, { zh, en }), 'ui-input-trigger: menu dictionaries')
  ctx.inject(['slots', 'inputTriggers', 'sessions'], (scope: ClientContext) => {
    const inputTriggers = scope.inputTriggers
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
      name: 'conversation.input.overlay',
      id: 'slash-menu',
      order: 0,
      locale: MENU_NS,
      inject: (sessionId): MenuViewInjected => {
        // Session-scoped slot: resolve this session's controller (the slot
        // frame hands ids, not ctx — the registered id→ctx interchange).
        const actx = sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`ui-input-trigger: session "${String(sessionId)}" resolved no scope`)
        const controller = inputTriggers.sessionOf(actx)
        return {
          menu: controller.menu,
          headers: controller.headers,
          onPick: (source, index, action) => { controller.pick(source, index, action) },
          onCrumb: (source, index) => { controller.pickCrumb(source, index) },
          onHover: (source, index) => { controller.hover(source, index) },
          onDismiss: () => { controller.dismiss() },
        }
      },
    }, MenuView))
  })
}
