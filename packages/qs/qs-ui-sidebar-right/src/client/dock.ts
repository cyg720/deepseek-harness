/** Docking 公共组件只发出意图；写入始终走官方会话 store。 */
import type { DockIntents, DockLabels, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { dockPaneIds, findTabPane } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarRightPresentationService, SidebarRightInjected, SurfaceState } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** 官方共享句柄提供的会话动作。 */
export type QsPanelStore = PropsStore<SidebarRightPresentationService['store']>
/**
 * 将组件手势绑定到当前会话；guide 为官方注册的页面 kind。
 * @param sessionId - 动作所属会话。
 * @param actions - 官方 store 动作。
 * @param openTab - 官方导航入口。
 * @returns 公共 docking 组件意图。
 */
export function dockIntents(sessionId: SessionId, actions: QsPanelStore['actions'], openTab: SidebarRightInjected['openTab']): DockIntents {
  return {
    focusTab: (id) => { actions.focusTab(sessionId, id) },
    focusPane: (id) => { actions.focusPane(sessionId, id) },
    splitPane: (id) => { actions.splitPane(sessionId, id) },
    addTab: (paneId) => { openTab('guide', { paneId, revealIfOpened: false }) },
    closeTab: (id) => { actions.closeTab(sessionId, id) },
    duplicateTab: (id) => { actions.duplicateTab(sessionId, id) },
    floatTab: (id, rect) => { actions.floatTab(sessionId, id, rect) },
    unfloatPane: (id) => { actions.unfloatPane(sessionId, id) },
    placeTab: (id, pane, index) => { actions.placeTab(sessionId, id, pane, index) },
    dropTab: (id, pane, zone) => { actions.dropTab(sessionId, id, pane, zone) },
    moveFloat: (id, x, y) => { actions.moveFloat(sessionId, id, x, y) },
    resizeFloat: (id, rect) => { actions.resizeFloat(sessionId, id, rect) },
    resizeSplit: (id, sizes) => { actions.resizeSplit(sessionId, id, sizes) },
  }
}
/**
 * 与官方 store 的最后一个 guide 禁关规则对齐；实际关闭仍由 store 校验。
 * @param surface - 已提交布局。
 * @param id - 标签标识。
 * @returns 是否显示关闭入口。
 */
export function canClose(surface: SurfaceState, id: TabId): boolean {
  const tab = surface.layout.tabs[id]
  if (tab === undefined) return false
  const pane = findTabPane(surface.layout, id)
  return !(tab.kind === 'guide' && pane.host === 'dock' && pane.tabs.length === 1 && dockPaneIds(surface.layout).length === 1)
}
/**
 * 将本地化字典提供给无文案的公共组件。
 * @param t - QS 右栏字典。
 * @returns 拖拽、分栏与浮窗文案。
 */
export function dockLabels(t: TranslateNS<'qs-ui-sidebar-right'>): DockLabels {
  return { emptyPane: t('dock.emptyPane'), splitPane: t('dock.splitPane'), splitPaneDisabled: t('dock.splitPaneDisabled'),
    splitPaneNarrow: t('dock.splitPaneNarrow'), closeTab: t('dock.closeTab'), addTab: t('dock.addTab'),
    dockFloat: t('dock.dockFloat'), closeFloat: t('dock.closeFloat'),
    dropZone: { center: t('dock.drop.center'), left: t('dock.drop.left'), right: t('dock.drop.right'), top: t('dock.drop.top'), bottom: t('dock.drop.bottom') },
  }
}
