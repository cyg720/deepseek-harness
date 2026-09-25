/** 视口收敛属于布局所有者；窗口变化不应抢占焦点或改变浮窗层叠。 */
import { getPane, type LayoutOp, type LayoutState } from '@deepseek-ai/dsh-client-ui-dockkit'

/**
 * 为超出视口的浮窗规划几何调整，保持当前焦点与层叠次序。
 * @param state - 官方已提交布局。
 * @param viewport - 实际浏览器视口尺寸；不可见的零尺寸视口不调整。
 * @returns 一次性提交的操作，无变化时为空。
 */
export function fitFloats(state: LayoutState, viewport: { width: number; height: number }): readonly LayoutOp[] {
  if (viewport.width <= 0 || viewport.height <= 0) return []
  const ops: LayoutOp[] = []
  for (const paneId of state.floats) {
    const rect = getPane(state, paneId).rect
    if (rect === undefined) throw new Error('sidebarRight: floating pane has no rectangle')
    // 视口小于手动拖拽最小尺寸时，仍须让回收和关闭控件留在屏幕内。
    const width = Math.min(rect.width, viewport.width), height = Math.min(rect.height, viewport.height)
    const x = Math.max(0, Math.min(rect.x, viewport.width - width)), y = Math.max(0, Math.min(rect.y, viewport.height - height))
    if (x !== rect.x || y !== rect.y || width !== rect.width || height !== rect.height) {
      ops.push({ type: 'resizeFloat', paneId, rect: { x, y, width, height } })
    }
  }
  if (ops.length > 0) ops.push({ type: 'restoreFocus', activePaneId: state.activePaneId, floats: state.floats, paneActiveTabs: {} })
  return ops
}
