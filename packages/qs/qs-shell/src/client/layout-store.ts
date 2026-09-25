/**
 * 奇术工作台的布局 store。
 *
 * 持有面板几何与外壳操作序号；会话标签由官方右栏 store 持有。初始值来自视口（>700 左开、>960 右开），
 * 并在窗口尺寸变化时按断点重新判定（原型只在初始化读 innerWidth，规范明确要求补 resize）。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** 断点：与样式表的 1600/1150/960/700 一致。 */
export const LEFT_OPEN_QUERY = '(min-width: 701px)'
/** 右侧面板默认展开的最小宽度。 */
export const RIGHT_OPEN_QUERY = '(min-width: 961px)'

/** Browser-local workbench layout preference. */
export const LAYOUT_STORE_KEY = 'dsh.qs.layout'

/** 仅布局偏好格式版本；会话和官方标签状态不属于此记录。 */
const LAYOUT_VERSION = 1

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
  /** 仅内存中的外壳意图序号，不从浏览器存储恢复。 */
  rightRequestId: number
  /** 恢复或存储失败的可见提示，不写入持久化记录。 */
  storageNotice: 'recovered' | 'memory' | undefined
}

/** 布局 store 的写入集。 */
type QsLayoutActions = {
  setWidth: (draft: QsLayoutState, side: 'left' | 'right', width: number) => void
  /** 同步会话面板实际状态，不发出新的展开意图。 */
  reportRightOpen: (draft: QsLayoutState, open: boolean) => void
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
    rightRequestId: 0,
    storageNotice: undefined,
  }
  const defaults = { ...remembered }
  try {
    const raw = globalThis.localStorage.getItem(LAYOUT_STORE_KEY)
    const saved: unknown = raw === null ? undefined : JSON.parse(raw)
    if (typeof saved === 'object' && saved !== null && !Array.isArray(saved)) {
      const value = saved as Record<string, unknown>
      // 无版本记录是第一优先发布的格式；未知版本不能当作当前结构解释。
      if (value.version === undefined || value.version === LAYOUT_VERSION) {
        for (const key of ['leftWidth', 'rightWidth'] as const) {
          const width = value[key]
          if (width === undefined) continue
          if (typeof width === 'number' && Number.isFinite(width) && width >= 180 && width <= 480) remembered[key] = width
          else remembered.storageNotice = 'recovered'
        }
        for (const key of ['leftOpen', 'rightOpen'] as const) {
          const open = value[key]
          if (open === undefined) continue
          if (typeof open !== 'boolean') remembered.storageNotice = 'recovered'
          else if (!remembered.compact && (key === 'leftOpen' || lastWide)) remembered[key] = open
        }
      } else {
        remembered.storageNotice = 'recovered'
      }
    } else if (saved !== undefined) {
      remembered.storageNotice = 'recovered'
    }
  } catch (error) {
    // JSON 损坏与浏览器拒绝存储都不能阻止工作台启动，提示不包含原始记录。
    remembered.storageNotice = error instanceof SyntaxError ? 'recovered' : 'memory'
  }
  const remember = (state: QsLayoutState): void => {
    try {
      // 只允许几何与开合偏好，禁止未来新增的会话正文/临时状态随对象展开进入存储。
      globalThis.localStorage.setItem(LAYOUT_STORE_KEY, JSON.stringify({
        version: LAYOUT_VERSION, leftOpen: state.leftOpen, rightOpen: state.rightOpen,
        leftWidth: state.leftWidth, rightWidth: state.rightWidth,
      }))
      if (state.storageNotice === 'memory') state.storageNotice = undefined
    } catch { state.storageNotice = 'memory' /* 浏览器拒绝写入时，当前实例仍保留布局。 */ }
    remembered = { ...state }
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
      reportRightOpen: (d, open) => { d.rightOpen = open; remember(d) },
      reset: (d) => {
        Object.assign(d, defaults, {
          compact: !matchesViewport(LEFT_OPEN_QUERY),
          leftOpen: matchesViewport(LEFT_OPEN_QUERY),
          rightOpen: matchesViewport(RIGHT_OPEN_QUERY),
        })
        try { globalThis.localStorage.removeItem(LAYOUT_STORE_KEY) }
        catch { d.storageNotice = 'memory' /* 浏览器拒绝清理不阻断退出或内存布局恢复。 */ }
        remembered = { ...d }
      },
      setLeftOpen: (d, open: boolean) => { d.leftOpen = open; remember(d) },
      setRightOpen: (d, open: boolean) => { d.rightRequestId += 1; d.rightOpen = open; remember(d) },
      toggleLeft: (d) => { d.leftOpen = !d.leftOpen; remember(d) },
      toggleRight: (d) => { d.rightRequestId += 1; d.rightOpen = !d.rightOpen; remember(d) },
      applyViewport: (d, viewport) => {
        d.rightRequestId += 1
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
