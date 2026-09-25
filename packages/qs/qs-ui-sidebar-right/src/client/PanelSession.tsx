/** 共享官方 store 和 TabDomain，QS 只提供几何呈现与槽派发。 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import type { HookContextOf, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarRightInjected } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { canSplit, dockPaneIds, DockSurface, FloatLayer, getPane } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { HalvesFit, PaneId, TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'
import { canClose, dockIntents, dockLabels, type QsPanelStore } from './dock.ts'
import css from './inspector.module.css'
import type { PanelLayoutNotice, PanelLayoutPersistence } from './layout-persistence.ts'

/** 正文、标题及菜单各自保持官方对应职责。 */
type Children = PropsRenderSlots<'qs.sidebar.right.tab' | 'qs.sidebar.right.tab.title' | 'qs.sidebar.right.menu'>
/** 会话 store 与导航由官方服务注入。 */
export type QsPanelSessionProps = PropsRuntime<'qs.sidebar.right.session'> & QsPanelStore & InjectFace<SidebarRightInjected>
  & PropsLocale<'qs-ui-sidebar-right'> & Children & { persistence: PanelLayoutPersistence; bindLayoutWriter: () => () => void }

type TabProps = Pick<QsPanelSessionProps, 'renderSlot' | 'occurrence' | 'useTabTypes' | 'useTabNavigation' | 'useStore'>
  & { tab: TabRecord; title: boolean; fullscreen: boolean; fallback: ReactNode }
/** 用 record id 区分同类型的多个标签，避免局部状态串位。 */
function Tab({ renderSlot, occurrence, useTabTypes, useTabNavigation, useStore, tab, title, fullscreen, fallback }: TabProps) {
  const { signal, tabActions } = occurrence(tab)
  const definition = useTabTypes(types => types.find(item => item.kind === tab.kind))
  const hookContext = useMemo((): HookContextOf<'qs.sidebar.right.tab'> => ({
    tabId: tab.id, title, fullscreen, signal, actions: tabActions, useStore, useTabNavigation,
  }), [tab.id, title, fullscreen, signal, tabActions, useStore, useTabNavigation])
  return renderSlot(title ? 'qs.sidebar.right.tab.title' : 'qs.sidebar.right.tab', {}, { entryKey: definition?.id ?? tab.kind, fallback, hookContext })
}
/**
 * 会话座位绑定官方导航；外壳请求有独立序号，状态回报不能反向制造新请求。
 * @param props - 当前会话、外壳意图和共享官方状态。
 * @returns 对接面板、浮窗和可见的缺失插件说明。
 */
export function QsPanelSession(props: QsPanelSessionProps) {
  const { sessionId, hidden, requestId, reportOpen, useStore, actions, bindService, openTab, t, renderSlot } = props
  // 先取得保存责任，再执行首次恢复；卸载交回根级观察者。
  useLayoutEffect(props.bindLayoutWriter, [props.bindLayoutWriter])
  const surfaces = useStore(state => state.bySession), surface = surfaces[sessionId]
  const [notice, setNotice] = useState<PanelLayoutNotice>()
  const previous = useRef<{ sessionId: typeof sessionId; requestId: number }>()
  const room = useRef<ReadonlyMap<PaneId, HalvesFit>>(new Map())
  const reportRoom = useCallback((value: ReadonlyMap<PaneId, HalvesFit>) => { room.current = value }, [])
  const [portal, setPortal] = useState<Element | null>(null)
  const bindRoot = useCallback((element: HTMLElement | null) => { setPortal(element?.closest('[data-qs-root]') ?? null) }, [])
  useLayoutEffect(() => {
    const prior = previous.current
    previous.current = { sessionId, requestId }
    if (surface === undefined) {
      const restored = props.persistence.read()
      setNotice(restored.notice)
      if (restored.layout !== undefined) { actions.restore(sessionId, restored.layout); return }
    }
    if (surface === undefined || (prior !== undefined && prior.sessionId === sessionId && prior.requestId !== requestId)) {
      actions.setExpanded(sessionId, !hidden)
    } else if (surface.layout.expanded === hidden) reportOpen(surface.layout.expanded)
  }, [sessionId, requestId, hidden, surface, actions, reportOpen, props.persistence])
  useEffect(() => {
    if (surface === undefined) return
    const problem = props.persistence.write(surface.layout)
    setNotice(prior => problem ?? (prior === 'memory' || prior === 'oversized' ? undefined : prior))
  }, [surface, props.persistence])
  useEffect(() => bindService({ sessionId, actions, surfaces, canSplitPane: id => room.current.get(id)?.row !== false }),
    [bindService, sessionId, actions, surfaces])
  useLayoutEffect(() => {
    const fit = (): void => { actions.fitFloats(sessionId, { width: window.innerWidth, height: window.innerHeight }) }
    let frame: number | undefined
    const resize = (): void => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(() => { frame = undefined; fit() })
    }
    fit()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [sessionId, actions])
  if (surface === undefined) return null
  const fullscreen = surface.layout.mode === 'fullscreen'
  const activePane = getPane(surface.layout, surface.layout.activePaneId)
  const activeTab = activePane.activeTabId
  const activeIndex = activeTab === undefined ? -1 : activePane.tabs.indexOf(activeTab)
  // 原型的“向前移动”使用同一 placeTab 动作，保存、撤销与资源身份沿用官方所有者。
  const canMoveEarlier = activePane.host === 'dock' && activeIndex > 0
  const moveEarlier = activeTab !== undefined && canMoveEarlier
    ? () => { actions.placeTab(sessionId, activeTab, activePane.id, activeIndex - 1) }
    : undefined
  const intents = dockIntents(sessionId, actions, openTab), labels = dockLabels(t)
  const tabProps = { renderSlot, occurrence: props.occurrence, useTabTypes: props.useTabTypes,
    useTabNavigation: props.useTabNavigation, useStore, fullscreen }
  const bodies = (tab: TabRecord) => <Tab key={tab.id} {...tabProps} tab={tab} title={false}
    fallback={<p className={css.empty} data-qs-panel-unavailable>{t('tab.unavailable')}</p>} />
  const titles = (tab: TabRecord) => <Tab key={tab.id} {...tabProps} tab={tab} title fallback={tab.title} />
  const closeable = (id: TabRecord['id']) => canClose(surface, id)
  return <>
    <aside ref={bindRoot} className={`${css.panel} ${css.theme} ${hidden ? css.panelHidden : ''} ${fullscreen ? css.fullscreen : ''}`}
      aria-label={t('inspector.title')} {...(hidden ? { inert: '' } : {})} data-qs-panel-session={sessionId}>
      {notice !== undefined && <div role="status" className={css.notice} data-qs-panel-storage-notice={notice}>
        <span>{t(`layout.${notice}`)}</span>
        <button type="button" className={css.chrome} onClick={() => { setNotice(props.persistence.clear()) }}>{t('layout.forget')}</button>
      </div>}
      <DockSurface state={surface.layout} canSplit={canSplit(surface.layout) && dockPaneIds(surface.layout).length < 2}
        hideSplitWhenBlocked dropZones="horizontal" minPaneFraction={0.2}
        canAddTab={id => !getPane(surface.layout, id).tabs.some(key => surface.layout.tabs[key]?.kind === 'guide')}
        canCloseTab={closeable} intents={intents} labels={labels} renderTab={bodies} renderTabTitle={titles}
        renderTabMenuItems={(tab, dismiss) => renderSlot('qs.sidebar.right.menu', { tab, dismiss })} onRoom={reportRoom}
        chrome={<>
          <button type="button" className={css.chrome} onClick={() => { actions.setMode(sessionId, fullscreen ? 'push' : 'fullscreen') }}>{t(fullscreen ? 'chrome.exitFullscreen' : 'chrome.toFullscreen')}</button>
          <button type="button" className={css.chrome} onClick={() => { actions.setExpanded(sessionId, false) }}>{t('inspector.collapse')}</button>
        </>} />
      {/* 原型的移动动作独占操作行，不挤压窄栏内的文件标签。 */}
      <div className={css.layoutActions}>
        <button type="button" className={css.chrome} disabled={!canMoveEarlier}
          onClick={moveEarlier}>{t('dock.moveEarlier')}</button>
      </div>
    </aside>
    {portal !== null && surface.layout.floats.length > 0 && createPortal(
      <div className={`${css.floatHost} ${css.theme}`} data-qs-panel-floats>
        <FloatLayer state={surface.layout} intents={intents} labels={labels}
          canCloseTab={closeable} renderTab={bodies} renderTabTitle={titles} />
      </div>, portal)}
  </>
}
