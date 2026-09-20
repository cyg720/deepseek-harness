/**
 * 奇术工作台的布局 store。
 *
 * 持有左侧导航、右侧面板与活动标签。初始值来自视口（>700 左开、>960 右开），
 * 并在窗口尺寸变化时按断点重新判定（原型只在初始化读 innerWidth，规范明确要求补 resize）。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** 断点：与样式表的 1600/1150/960/700 一致。 */
export const LEFT_OPEN_QUERY = '(min-width: 701px)'
/** 右侧面板默认展开的最小宽度。 */
export const RIGHT_OPEN_QUERY = '(min-width: 961px)'

/** Browser-local workbench layout preference. */
export const LAYOUT_STORE_KEY = 'dsh.qs.layout'

/** 布局状态。 */
export interface QsLayoutState {
  /** 左侧导航是否展开。 */
  leftOpen: boolean
  /** 右侧面板是否展开。 */
  rightOpen: boolean
  /** 窄屏下左右面板以覆盖层呈现；true 表示当前是窄屏。 */
  compact: boolean
  leftWidth: number | undefined
  rightWidth: number | undefined
  activeRightTab: number
}

/** 布局 store 的写入集。 */
type QsLayoutActions = {
  setWidth: (draft: QsLayoutState, side: 'left' | 'right', width: number) => void
  setRightTab: (draft: QsLayoutState, tab: number) => void
  reset: (draft: QsLayoutState) => void
  setLeftOpen: (draft: QsLayoutState, open: boolean) => void
  setRightOpen: (draft: QsLayoutState, open: boolean) => void
  toggleLeft: (draft: QsLayoutState) => void
  toggleRight: (draft: QsLayoutState) => void
  /** 视口变化时收敛：窄屏关闭覆盖层，宽屏按断点恢复默认开合。 */
  applyViewport: (draft: QsLayoutState, viewport: { narrow: boolean; wide: boolean }) => void
}

/**
 * 读取当前视口是否满足媒体查询。
 * @param query - CSS 媒体查询串。
 * @returns 满足为 true；无 matchMedia（非浏览器运行）时为 false。
 */
export function matchesViewport(query: string): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false
  return globalThis.matchMedia(query).matches
}

/**
 * 声明布局 store。
 * @returns store 句柄；组件经注册的 store 座席读写。
 */
export function createQsLayoutStore(): EngineStoreHandle<QsLayoutState, QsLayoutActions> {
  let lastWide = matchesViewport(RIGHT_OPEN_QUERY)
  let remembered: QsLayoutState = {
    leftOpen: matchesViewport(LEFT_OPEN_QUERY),
    rightOpen: matchesViewport(RIGHT_OPEN_QUERY),
    compact: !matchesViewport(LEFT_OPEN_QUERY),
    leftWidth: undefined,
    rightWidth: undefined,
    activeRightTab: 0,
  }
  const defaults = { ...remembered }
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage.getItem(LAYOUT_STORE_KEY) ?? 'null')
    if (typeof saved === 'object' && saved !== null) {
      const value = saved as Record<string, unknown>
      for (const key of ['leftWidth', 'rightWidth'] as const) {
        const width = value[key]
        if (typeof width === 'number' && Number.isFinite(width) && width >= 180 && width <= 480) remembered[key] = width
      }
      if (value.activeRightTab === 0 || value.activeRightTab === 1 || value.activeRightTab === 2) {
        remembered.activeRightTab = value.activeRightTab
      }
      if (!remembered.compact) {
        if (typeof value.leftOpen === 'boolean') remembered.leftOpen = value.leftOpen
        if (lastWide && typeof value.rightOpen === 'boolean') remembered.rightOpen = value.rightOpen
      }
    }
  } catch { /* Missing, corrupt or browser-denied storage uses viewport defaults. */ }
  const remember = (state: QsLayoutState): void => {
    remembered = { ...state }
    try { globalThis.localStorage.setItem(LAYOUT_STORE_KEY, JSON.stringify(remembered)) }
    catch { /* Browser storage denial keeps layout choices in this plugin instance. */ }
  }
  return defineStore({
    init: (): QsLayoutState => {
      const narrow = !matchesViewport(LEFT_OPEN_QUERY)
      const wide = matchesViewport(RIGHT_OPEN_QUERY)
      if (narrow !== remembered.compact || wide !== lastWide) {
        remembered = { ...remembered, compact: narrow, leftOpen: !narrow, rightOpen: !narrow && wide }
        lastWide = wide
      }
      return { ...remembered }
    },
    actions: {
      setWidth: (d, side, width) => { d[side === 'left' ? 'leftWidth' : 'rightWidth'] = Math.min(480, Math.max(180, width)); remember(d) },
      setRightTab: (d, tab) => { d.activeRightTab = tab; remember(d) },
      reset: (d) => {
        Object.assign(d, defaults, {
          compact: !matchesViewport(LEFT_OPEN_QUERY),
          leftOpen: matchesViewport(LEFT_OPEN_QUERY),
          rightOpen: matchesViewport(RIGHT_OPEN_QUERY),
        })
        remembered = { ...d }
        try { globalThis.localStorage.removeItem(LAYOUT_STORE_KEY) }
        catch { /* Browser storage denial does not prevent logout. */ }
      },
      setLeftOpen: (d, open: boolean) => { d.leftOpen = open; remember(d) },
      setRightOpen: (d, open: boolean) => { d.rightOpen = open; remember(d) },
      toggleLeft: (d) => { d.leftOpen = !d.leftOpen; remember(d) },
      toggleRight: (d) => { d.rightOpen = !d.rightOpen; remember(d) },
      applyViewport: (d, viewport) => {
        lastWide = viewport.wide
        d.compact = viewport.narrow
        if (viewport.narrow) {
          d.leftOpen = false
          d.rightOpen = false
          remember(d)
          return
        }
        // 跨越断点后恢复该视口的默认面板开合。
        d.leftOpen = true
        d.rightOpen = viewport.wide
        remember(d)
      },
    },
  })
}
