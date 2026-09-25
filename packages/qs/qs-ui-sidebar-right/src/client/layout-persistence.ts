/** 浏览器布局只保存地址白名单；恢复前复用官方解析和当前正文注册。 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LayoutState } from '@deepseek-ai/dsh-client-ui-dockkit'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { RestoredLayout } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/qs/restore-layout.ts'
import { parsePanelLayout, serializePanelLayout, type SavedPanelLayout } from './layout-record.ts'
import { PANEL_LAYOUT_PREFIX } from './layout-lifecycle.ts'

/** 存储失败与记录降级只暴露固定提示，不泄漏浏览器异常或本地路径。 */
export type PanelLayoutNotice = 'recovered' | 'memory' | 'oversized'
/** 由会话注入的同步存储能力，不持有 store 或资源订阅。 */
export interface PanelLayoutPersistence {
  /** @returns 当前会话已校验的恢复记录及需要展示的限制。 */
  read(): { layout: RestoredLayout | undefined; notice: PanelLayoutNotice | undefined }
  /** @param layout - 官方已提交布局。 @returns 保存失败时的可见原因。 */
  write(layout: LayoutState): PanelLayoutNotice | undefined
  /** @returns 清除失败时的可见原因；不会关闭当前标签。 */
  clear(): PanelLayoutNotice | undefined
}

/**
 * 在首次恢复时校验会话归属、注册类型和正文；无效项丢弃并报告。
 * @param saved - 结构解析后的记录。
 * @param sessionId - 将持有恢复标签的会话。
 * @param tabs - 当前官方注册表。
 * @param bodyKeys - 当前 QS 正文贡献身份。
 * @param viewport - 当前视口，浮窗必须可见且可回收。
 * @returns 重新解析标题和身份前的布局及降级标记。
 */
export function resolvePanelLayout(saved: SavedPanelLayout, sessionId: SessionId, tabs: SidebarRightTabRegistry,
  bodyKeys: ReadonlySet<string>, viewport: { width: number; height: number }): { layout: RestoredLayout; adjusted: boolean } {
  let adjusted = false
  const panes: RestoredLayout['panes'][number][] = []
  let active = 0
  for (const [position, pane] of saved.panes.entries()) {
    const kept: RestoredLayout['panes'][number]['tabs'][number][] = []
    const pages = new Set<string>()
    let selected = 0
    for (const [index, tab] of pane.tabs.entries()) {
      // sidebar://<kind> 是官方 seed.ts 定义的页面地址格式；不跨插件导入其私有运行时代码。
      const definition = tabs.get(tab.kind), page = tab.address === `sidebar://${tab.kind}`
      const file = page ? undefined : parseFileAddress(tab.address)
      const available = definition !== undefined && bodyKeys.has(definition.id)
        && (page ? !pages.has(tab.kind) : file?.scope === 'session' && file.sessionId === sessionId
          && tabs.candidates(tab.address).some(candidate => candidate.kind === tab.kind))
      if (!available) { adjusted = true; continue }
      if (page) pages.add(tab.kind)
      if (index === pane.active) selected = kept.length
      kept.push({ kind: tab.kind, contentId: tab.address, title: definition.title(tab.address) })
    }
    if (position >= saved.docked && kept.length === 0) continue
    let rect = pane.rect
    if (rect !== null) {
      const width = Math.min(rect.width, viewport.width), height = Math.min(rect.height, viewport.height)
      const x = Math.max(0, Math.min(rect.x, viewport.width - width)), y = Math.max(0, Math.min(rect.y, viewport.height - height))
      adjusted ||= width !== rect.width || height !== rect.height || x !== rect.x || y !== rect.y
      rect = { x, y, width, height }
    }
    if (position === saved.active) active = panes.length
    panes.push({ tabs: kept, active: kept.length === 0 ? null : selected, rect })
  }
  // parsePanelLayout 保证 sizes 非空；官方拖拽至少保留每栏 20%，恢复同样保留可操作宽度。
  const left = Math.max(0.2, Math.min(saved.sizes[0] as number, 0.8))
  const sizes = saved.docked === 1 ? [1] : [left, 1 - left]
  adjusted ||= sizes.some((size, index) => size !== saved.sizes[index])
  return { layout: { docked: saved.docked === 1 ? 1 : 2, panes, active, sizes, expanded: saved.expanded, mode: saved.mode }, adjusted }
}

/**
 * 为一个会话提供浏览器持久化；同步读取避免迟到恢复覆盖用户操作。
 * @param sessionId - 存储键和资源归属共同使用的会话。
 * @param tabs - 官方标签注册表。
 * @param bodyKeys - 恢复时读取的正文贡献。
 * @param canPersist - 每次读写时检查登录状态，防止退出后的迟到 effect 重新落盘。
 * @returns 只保存布局白名单的读写能力。
 */
export function panelLayoutPersistence(sessionId: SessionId, tabs: SidebarRightTabRegistry,
  bodyKeys: () => ReadonlySet<string>, canPersist: () => boolean): PanelLayoutPersistence {
  const key = `${PANEL_LAYOUT_PREFIX}${encodeURIComponent(sessionId)}`
  return {
    read() {
      if (!canPersist()) return { layout: undefined, notice: undefined }
      let raw: string | null
      try { raw = window.localStorage.getItem(key) }
      catch { return { layout: undefined, notice: 'memory' } /* 浏览器可能禁止读取本地存储。 */ }
      if (raw === null) return { layout: undefined, notice: undefined }
      const saved = parsePanelLayout(raw)
      if (saved === undefined) return { layout: undefined, notice: 'recovered' }
      const result = resolvePanelLayout(saved, sessionId, tabs, bodyKeys(), { width: window.innerWidth, height: window.innerHeight })
      return { layout: result.layout, notice: result.adjusted ? 'recovered' : undefined }
    },
    write(layout) {
      if (!canPersist()) return undefined
      const raw = serializePanelLayout(layout)
      if (raw === undefined) return 'oversized'
      try { window.localStorage.setItem(key, raw) }
      catch { return 'memory' /* 配额或权限失败时保留正在使用的内存布局。 */ }
      return undefined
    },
    clear() {
      try { window.localStorage.removeItem(key) }
      catch { return 'memory' /* 清理受限不改变当前资源生命周期。 */ }
      return undefined
    },
  }
}
