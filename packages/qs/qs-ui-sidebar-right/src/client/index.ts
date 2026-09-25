/** 对应官方 ui-sidebar-right 的呈现插件，共享唯一 store 与标签域。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-qs-shell/client'
import type { PropsLocale, SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { QsGuideInjected } from './contract.ts'
/** 正文贡献包通过客户端入口获得槽声明。 */
export type * from './contract.ts'
import { QsRightPanel } from './RightPanel.tsx'
import { QsPanelSession } from './PanelSession.tsx'
import { QsGuide } from './Guide.tsx'
import { zh, en } from './view-locales.ts'
import { panelLayoutPersistence } from './layout-persistence.ts'
import { watchPanelLogout } from './layout-lifecycle.ts'
import type { IQsAuth } from '@deepseek-ai/dsh-qs-shell/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-ui-sidebar-right': keyof typeof zh }
}
/** 等待官方服务就绪，不实例化第二个导航控制器。 */
export const inject = ['slots', 'locale', 'sidebarRightPresentation', 'sidebarRightTabs']
/**
 * 装配根与会话座位；释放父座位时一并释放正文声明和贡献。
 * @param ctx - 已具有官方右栏服务的客户端上下文。
 */
export function apply(ctx: Context): void {
  ctx.inject(['qsAuth'], (authCtx) => {
    authCtx.effect(() => watchPanelLogout(authCtx.get('qsAuth') as IQsAuth), 'qs-ui-sidebar-right: logout layout cleanup')
  })
  ctx.effect(() => ctx.locale.register('qs-ui-sidebar-right', { zh, en }), 'qs-ui-sidebar-right: dictionaries')
  const presentation = ctx.sidebarRightPresentation
  const writers = new Map<SessionId, Set<symbol>>()
  let entries = ctx.slots.entries('qs.sidebar.right.tab')
  // 父槽尚未由本插件声明，初始无正文贡献；keyed 槽的键已由注册表校验。
  let keys: readonly string[] = []
  const guide: QsGuideInjected = {
    definitionId: kind => ctx.sidebarRightTabs.get(kind)?.id,
    hooks: {
      guideEntries: { subscribe: listener => ctx.sidebarRightTabs.subscribe(listener), getSnapshot: () => ctx.sidebarRightTabs.guide() },
      bodyKeys: {
        subscribe: listener => ctx.slots.subscribe('qs.sidebar.right.tab', listener),
        getSnapshot: () => {
          const current = ctx.slots.entries('qs.sidebar.right.tab')
          if (current !== entries) {
            entries = current
            keys = current.map(entry => entry.options.key as string)
          }
          return keys
        },
      },
    },
  }
  const persistenceOf = (sessionId: SessionId) => panelLayoutPersistence(sessionId, ctx.sidebarRightTabs,
    () => new Set(guide.hooks.bodyKeys.getSnapshot()),
    () => (ctx.get('qsAuth') as IQsAuth | undefined)?.getSnapshot().authenticated !== false)
  // QS 座位负责即时错误提示；座位不在场时仍保存官方界面提交，避免同一次提交写两遍。
  ctx.effect(() => presentation.observeLayouts((sessionId, layout) => {
    if (!writers.has(sessionId)) persistenceOf(sessionId).write(layout)
  }), 'qs-ui-sidebar-right: shared layout persistence')
  ctx.slots.inject('qs.inspector', function* () {
    yield ctx.slots.register({ name: 'qs.inspector', locale: 'qs-ui-sidebar-right', children: {
      'qs.sidebar.right.session': { kind: 'single', scope: 'session' },
    } }, QsRightPanel)
    yield ctx.slots.register({ name: 'qs.sidebar.right.session', locale: 'qs-ui-sidebar-right', store: presentation.store,
      inject: sessionId => ({ ...presentation.seat(sessionId),
        persistence: persistenceOf(sessionId),
        bindLayoutWriter: () => {
          const tokens = writers.get(sessionId) ?? new Set<symbol>(), token = Symbol()
          tokens.add(token); writers.set(sessionId, tokens)
          return () => { if (tokens.delete(token) && tokens.size === 0) writers.delete(sessionId) }
        },
      }), children: {
        'qs.sidebar.right.tab': { kind: 'keyed', scope: 'session', inject: presentation.tab },
        'qs.sidebar.right.tab.title': { kind: 'keyed', scope: 'session', inject: presentation.tab },
        'qs.sidebar.right.menu': { kind: 'list', scope: 'session' },
      },
    }, QsPanelSession)
  })
  const guideTabInfo: SlotHookFactory<'qs.sidebar.right.guide', UseSidebarRightTabInfo> = (_standard, context) => context
  // guide 标题随语言变化重新读取，不沿用打开标签时的旧文案。
  const GuideTitle = ({ t }: PropsLocale<'qs-ui-sidebar-right'>) => t('tab.guide.title')
  ctx.slots.inject('qs.sidebar.right.tab.title', () => ctx.slots.register({
    name: 'qs.sidebar.right.tab.title', key: '@deepseek-ai/dsh-client-ui-sidebar-right/guide', locale: 'qs-ui-sidebar-right',
  }, GuideTitle))
  ctx.slots.inject('qs.sidebar.right.tab', () => ctx.slots.register({ name: 'qs.sidebar.right.tab',
    // 注册到官方 guide 定义身份，保持官方与 QS 导航使用同一个 kind。
    key: '@deepseek-ai/dsh-client-ui-sidebar-right/guide', locale: 'qs-ui-sidebar-right', inject: () => guide,
    children: { 'qs.sidebar.right.guide': { kind: 'chain', scope: 'session', inject: { hooks: { tabInfo: guideTabInfo } } } },
  }, QsGuide))
}
