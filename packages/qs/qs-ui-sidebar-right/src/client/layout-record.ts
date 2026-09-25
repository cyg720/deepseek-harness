/** 布局记录只保留结构和资源地址；反序列化不授予地址访问权。 */
import { dockPaneIds, getNode, getPane, getTab } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { FloatRect, LayoutState } from '@deepseek-ai/dsh-client-ui-dockkit'

/** 一个待重新经官方注册表解析的标签地址。 */
export interface SavedPanelTab {
  readonly kind: string
  readonly address: string
}

/** 有序标签及焦点；浮窗矩形不携带 DOM 或运行时身份。 */
export interface SavedPanelPane {
  readonly tabs: readonly SavedPanelTab[]
  readonly active: number | null
  readonly rect: FloatRect | null
}

/** 版本 1 的独立布局记录，不含会话数据、标题正文、参数或撤销历史。 */
export interface SavedPanelLayout {
  readonly version: 1
  /** 前 docked 个面板为从左到右的停靠列，后续面板为浮窗。 */
  readonly docked: number
  readonly panes: readonly SavedPanelPane[]
  readonly active: number
  readonly sizes: readonly number[]
  readonly expanded: boolean
  readonly mode: 'push' | 'fullscreen'
}

// 外部存储解析的资源消耗上限，不是可配置的布局展示偏好。
const MAX_RECORD_CHARS = 65_536
const MAX_PANES = 32
const MAX_TABS = 128

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function index(value: unknown, length: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function rectangle(value: unknown): value is FloatRect {
  return object(value) && finite(value.x) && finite(value.y)
    && finite(value.width) && value.width > 0 && finite(value.height) && value.height > 0
}

/**
 * 解析浏览器外部记录并重建白名单字段；地址仍须经会话归属和官方注册表检查。
 * @param raw - 浏览器保存的 JSON 字符串。
 * @returns 结构受限的布局，损坏或不支持时为 undefined。
 */
export function parsePanelLayout(raw: string): SavedPanelLayout | undefined {
  if (raw.length > MAX_RECORD_CHARS) return undefined
  let input: unknown
  try { input = JSON.parse(raw) }
  catch { return undefined /* 仅吞掉外部 JSON 的语法错误，后续结构检查不抛异常。 */ }
  if (!object(input) || input.version !== 1 || !Array.isArray(input.panes)
    || input.panes.length === 0 || input.panes.length > MAX_PANES
    || (input.docked !== 1 && input.docked !== 2) || input.docked > input.panes.length
    || !index(input.active, input.panes.length) || typeof input.expanded !== 'boolean'
    || (input.mode !== 'push' && input.mode !== 'fullscreen') || !Array.isArray(input.sizes)
    || input.sizes.length !== input.docked) return undefined
  const sizes: number[] = []
  for (const size of input.sizes) {
    if (!finite(size) || size <= 0 || size > 1) return undefined
    sizes.push(size)
  }
  if (Math.abs(sizes.reduce((sum, size) => sum + size, 0) - 1) > 1e-6) return undefined
  const panes: SavedPanelPane[] = []
  let tabCount = 0
  for (const [position, pane] of input.panes.entries()) {
    if (!object(pane) || !Array.isArray(pane.tabs)) return undefined
    tabCount += pane.tabs.length
    if (tabCount > MAX_TABS || (pane.tabs.length === 0 ? pane.active !== null : !index(pane.active, pane.tabs.length))) return undefined
    const floating = position >= input.docked
    if (floating ? pane.tabs.length !== 1 || !rectangle(pane.rect) : pane.rect !== null) return undefined
    const tabs: SavedPanelTab[] = []
    for (const tab of pane.tabs) {
      if (!object(tab) || typeof tab.kind !== 'string' || tab.kind === ''
        || typeof tab.address !== 'string' || tab.address === '') return undefined
      tabs.push({ kind: tab.kind, address: tab.address })
    }
    // JSON 只通过字段检查，重建对象防止未知字段传播到恢复动作。
    const rect = rectangle(pane.rect)
      ? { x: pane.rect.x, y: pane.rect.y, width: pane.rect.width, height: pane.rect.height } : null
    panes.push({ tabs, active: pane.active as number | null, rect })
  }
  return { version: 1, docked: input.docked, panes, active: input.active, sizes, expanded: input.expanded, mode: input.mode }
}

/**
 * 从官方已提交布局提取版本化白名单，不保存运行时 ID 或业务内容。
 * @param layout - 官方布局快照。
 * @returns 可恢复的 JSON；超过存储安全上限或不属于双列布局时为 undefined。
 */
export function serializePanelLayout(layout: LayoutState): string | undefined {
  const docked = dockPaneIds(layout), ids = [...docked, ...layout.floats]
  const root = getNode(layout, layout.rootId)
  const record: SavedPanelLayout = {
    version: 1, docked: docked.length, active: ids.indexOf(layout.activePaneId), expanded: layout.expanded, mode: layout.mode,
    sizes: root.kind === 'split' ? root.sizes : [1],
    panes: ids.map((id) => {
      const pane = getPane(layout, id)
      return { tabs: pane.tabs.map((tabId) => {
        const tab = getTab(layout, tabId)
        return { kind: tab.kind, address: tab.contentId }
      }), active: pane.activeTabId === undefined ? null : pane.tabs.indexOf(pane.activeTabId),
      rect: pane.rect === undefined ? null : { x: pane.rect.x, y: pane.rect.y, width: pane.rect.width, height: pane.rect.height } }
    }),
  }
  const raw = JSON.stringify(record)
  return parsePanelLayout(raw) === undefined ? undefined : raw
}
