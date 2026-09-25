/**
 * Browser half: fill the frame's right column with the panel, put the expand
 * button in the conversation header, and own the seats a tab type registers
 * into.
 *
 * Two seats share one session-scoped store, which the slot runtime allows
 * because both are session-scoped (a handle may not span scopes). The panel seat
 * in the frame draws the surface normally or fullscreen, retaining the track
 * on wide viewports; the header's corner seat draws the way back in
 * while the panel is hidden. The store is the layout's only source of truth; the docking
 * kit's pure planners compute every change and the store records them, one
 * history entry per intent.
 *
 * The frame is a base package and never injects this one. What it needs —
 * whether the panel is shown and whether it wants a track — arrives through its
 * own `ctx.layout` action face, reported by the seat that knows both facts.
 *
 * Tab types register in two stages: the type itself into `ctx.sidebarRightTabs`,
 * its body into the keyed `sidebar.right.pane.tab` seat under the same kind. The
 * guide registers through those stages unmodified, exactly as a type shipped
 * from another package does — `ui-sidebar-documentpreview` is the live proof.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from './contract/slots.ts'
import { GuideBody, type GuideInjected } from './tabs/guide/GuideBody.tsx'
import { GuideTitle } from './tabs/guide/GuideTitle.tsx'
import { ExpandButton } from './shell/ExpandButton.tsx'
import { RightbarSeat, type SidebarRightInjected } from './shell/SidebarRight.tsx'
import { RightbarRoot } from './shell/RightbarRoot.tsx'
import { createSidebarRightController, type SidebarRightController } from './service.ts'
import { SidebarRightTabRegistry } from './tab-registry.ts'
import { createSidebarRightStore } from './stores.ts'
import { en, zh } from './locales.ts'
import { GUIDE_ID, guideDefinition } from './tabs/guide/definition.ts'
import { guideTabInfoFactory, tabInfoFactory } from './tab-info.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { defaultSeed } from './contract/seed.ts'
import { createLayoutObserver, type LayoutListener } from './qs/layout-observer.ts'

export type { RightbarSeatProps, SidebarRightInjected, SidebarRightPresentation } from './shell/SidebarRight.tsx'
export type { GuideBodyProps, GuideInjected } from './tabs/guide/GuideBody.tsx'
export type { ExpandButtonProps } from './shell/ExpandButton.tsx'
export type { SidebarRightState, SurfaceState } from './stores.ts'
export type {
  ISidebarRight, SidebarRightBinding, SidebarRightOpenResourceOptions, SidebarRightOpenTabOptions,
  SidebarRightPlacement, SurfaceActions,
} from './service.ts'
export type {
  SidebarRightGuideBox, SidebarRightGuideEntry, SidebarRightTabClaim, SidebarRightTabDefinition,
  SidebarRightTabPriority,
} from './tab-registry.ts'
export type {
  SidebarRightTabInfo, SidebarRightTabInjected, UseSidebarRightTabInfo, SidebarRightTabActions,
  SidebarRightTabMenuOwnerProps, SidebarRightTabNavigation, SidebarRightTabPlacement,
} from './contract/slots.ts'
export type {
  SidebarRightNavigationParams, SidebarRightResourceParams, SidebarRightResourceParamsMap,
  SidebarRightTabParams, SidebarRightTabParamsFor, SidebarRightTabParamsMap,
} from './contract/params.ts'
// The layout ids and rectangle the navigation face takes, so a caller needs no import from the kit.
export type { FloatRect, PaneId, TabId, TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'
export type { PinResource, SidebarRightNavigator, TabOccurrence } from './tab-domain.ts'
export type { SidebarRightKey } from './locales.ts'
export type { OpenContentIntent } from './stores.ts'

/** 两套界面共享同一 StoreDecl 和 TabDomain；座位负责绑定与解绑。 */
export interface SidebarRightPresentationService {
  /**
   * 观察已有及后续已提交布局；切换呈现不会中止通知。
   * @param listener - 会话和只读布局接收者。
   * @returns 释放本观察订阅；不释放布局或资源。
   */
  observeLayouts(listener: LayoutListener): () => void
  /** 同一会话的两个呈现必须使用相同句柄。 */
  readonly store: ReturnType<typeof createSidebarRightStore>
  /**
   * 为指定会话组装呈现动作，不创建第二份状态。
   * @param sessionId - 会话标识。
   * @returns 绑定动作与标签导航订阅。
   */
  seat(sessionId: SessionId): SidebarRightInjected
  /** 正文和标题复用官方标签信息订阅。 */
  readonly tab: { readonly hooks: { readonly tabInfo: typeof tabInfoFactory } }
}

/** This package's copy namespace. */
const NS = 'sidebarRight'

/** Required browser services: the slot registry, the frame's panel actions, copy, and the resource model. */
export const inject = ['slots', 'layout', 'locale', 'resources']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Right-Sidebar navigation and presentation face. */
    sidebarRight: SidebarRightController
    /** 二开呈现复用唯一 store、adoption 和标签域。 */
    sidebarRightPresentation: SidebarRightPresentationService
    /** Right-Sidebar tab-type registry (stage one of a tab type's registration). */
    sidebarRightTabs: SidebarRightTabRegistry
  }
}

/**
 * Client plugin body: provide the registry and the navigation face, register the
 * panel seat and the rail seat over one store with their extension children, and
 * register the guide type through the same public two-stage path any other type
 * uses.
 * @param ctx - client root context carrying the slot registry, the frame's face, and copy.
 */
export function apply(ctx: ClientContext): void {
  // The registry and the face it backs are built here, at apply's top level,
  // and never inside an effect. A registry other packages register into cannot
  // have an effect-internal scope as its host: `register()` adds an effect to
  // this fiber, and doing that from another plugin's apply while the effect is
  // still the active scope stalls browser boot with no error at all. The
  // template this follows (ui-conversation's definition registry) is built at
  // its own apply top level for the same reason.
  const t = ctx.locale.bind(NS)
  const tabs = new SidebarRightTabRegistry(ctx)
  const { controller, adopt } = createSidebarRightController(
    tabs,
    (address, signal) => { ctx.resources.pin(address, signal) },
  )
  const disposeRegistry = ctx.reflect.provide('sidebarRightTabs', tabs)
  const disposeService = ctx.reflect.provide('sidebarRight', controller)
  // Registered first, so it tears down last: the faces outlive every seat and
  // type that reaches for them. provide()'s disposer settles asynchronously;
  // teardown is synchronous fire-and-forget, matching ui-layout's root entry.
  // Unloading aborts every tab occurrence, which releases every pin.
  ctx.effect(() => () => {
    controller.tabDomain.dispose()
    void disposeService()
    void disposeRegistry()
  }, 'ui-sidebar-right: service faces')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-right: dictionaries')

  ctx.effect(() => {
    const handle = createSidebarRightStore(() => defaultSeed(tabs))
    const layouts = createLayoutObserver()
    // The runtime mints one instance of this handle per session (the scope key
    // is the session id) and caches it per key. Each is adopted as it is minted,
    // so a tab's own action reaches its session's store while another session
    // is on screen, and that store's commits sync the Tab domain themselves.
    const adoptions: Array<() => void> = []
    const store: typeof handle = {
      ...handle,
      create: (scopeKey) => {
        const instance = handle.create(scopeKey)
        if (scopeKey !== undefined) {
          adoptions.push(adopt(scopeKey as SessionId, instance))
          // 资源 occurrence 先同步，再通知独立于界面的布局持久化消费者。
          layouts.attach(scopeKey as SessionId, instance)
        }
        return instance
      },
    }
    const layout: ILayout = ctx.layout
    const injected: Omit<SidebarRightInjected, 'keyedHooks' | 'occurrence'> = {
      syncPresentation({ shown, track, fullscreen }) {
        if (shown) layout.openRightbar(track, fullscreen)
        else layout.closeRightbar()
      },
      bindService: binding => controller.bind(binding),
      openTab: (kind, options) => { controller.openTab(kind, options) },
      hooks: { tabTypes: { subscribe: listener => tabs.subscribe(listener), getSnapshot: () => tabs.entries() } },
    }

    // 服务不创建第二份状态，切换界面只更换实际挂载的座位。
    const presentation: SidebarRightPresentationService = {
      observeLayouts: listener => layouts.watch(listener),
      store,
      tab: { hooks: { tabInfo: tabInfoFactory } },
      seat: (sessionId): SidebarRightInjected => ({
        ...injected,
        keyedHooks: { tabNavigation: key => controller.tabDomain.occurrence(sessionId, { id: key as TabId }).navigation },
        occurrence: tab => controller.tabDomain.occurrence(sessionId, tab),
      }),
    }
    const disposePresentation = ctx.reflect.provide('sidebarRightPresentation', presentation)
    const disposeTypes = [tabs.register(guideDefinition(t))]
    const disposeSeat = ctx.slots.inject('rightbar', function* () {
      yield ctx.slots.register({
        name: 'rightbar',
        children: { 'rightbar.session': { kind: 'single', scope: 'session' } },
      }, RightbarRoot)
      yield ctx.slots.register({
        name: 'rightbar.session',
        locale: NS,
        children: {
          'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: presentation.tab },
          'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session', inject: presentation.tab },
          'sidebar.right.tab.menu.item': { kind: 'list', scope: 'session' },
        },
        store,
        inject: sessionId => presentation.seat(sessionId),
      }, RightbarSeat)
    })
    // The expand button shares the panel's store: it only needs to know whether
    // the panel is expanded, and to ask for it to be. The header's corner seat
    // is its own place, past the utilities, so showing and hiding it moves
    // nothing else in the row.
    const disposeExpand = ctx.slots.inject('conversation.session.header.corner', () => ctx.slots.register({
      name: 'conversation.session.header.corner',
      locale: NS,
      store,
    }, ExpandButton))
    // Stage two for the guide: it declares the chain child it hosts and reads
    // the registry's entry boxes, which an ordinary type has no reason to do.
    const guideInjected: GuideInjected = {
      hooks: { guideEntries: { subscribe: listener => tabs.subscribe(listener), getSnapshot: () => tabs.guide() } },
    }
    const disposeGuide = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: GUIDE_ID,
      children: {
        'sidebar.right.tab.guide': {
          kind: 'chain', scope: 'session', inject: { hooks: { tabInfo: guideTabInfoFactory } },
        },
      },
      inject: () => guideInjected,
    }, GuideBody))
    const disposeGuideTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
      { name: 'sidebar.right.pane.tab.title', key: GUIDE_ID },
      GuideTitle,
    ))
    return () => {
      layouts.dispose()
      void disposePresentation()
      disposeGuideTitle()
      disposeGuide()
      disposeExpand()
      disposeSeat()
      for (const dispose of disposeTypes.reverse()) dispose()
      for (const release of adoptions) release()
    }
  }, 'ui-sidebar-right: seats and shipped tab type')
}
