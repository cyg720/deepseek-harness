/** 布局清理跟随明确的退出动作；登录初始冷态和插件卸载不等同于退出。 */
import type { IQsAuth } from '@deepseek-ai/dsh-qs-shell/client'

/** 只属于 QS 标签布局的存储键前缀，不包含外壳几何及其他插件数据。 */
export const PANEL_LAYOUT_PREFIX = 'dsh.qs.panel-layout.'

function removePanelRecords(): void {
  const storage = window.localStorage
  // 先收集键，删除时不依赖会缩短的 Storage 索引。
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
  for (const key of keys) if (key?.startsWith(PANEL_LAYOUT_PREFIX)) storage.removeItem(key)
}

/**
 * 尽力清理本插件的布局记录；浏览器拒绝访问不能阻断退出。
 * @returns 浏览器允许完成清理时为 true，否则为 false。
 */
export function clearPanelLayouts(): boolean {
  try { removePanelRecords() }
  catch { return false /* 仅吞掉浏览器 Storage 读取、枚举或删除拒绝，函数不执行业务回调。 */ }
  return true
}

/**
 * 只在已登录变为未登录时清理，冷启动保留待登录后的刷新恢复记录。
 * @param auth - 官方布局之外的 QS 静态登录状态，不作为 Host 鉴权。
 * @returns 取消订阅；卸载不会删除布局。
 */
export function watchPanelLogout(auth: Pick<IQsAuth, 'getSnapshot' | 'subscribe'>): () => void {
  let authenticated = auth.getSnapshot().authenticated
  return auth.subscribe(() => {
    const next = auth.getSnapshot().authenticated
    if (authenticated && !next) clearPanelLayouts()
    authenticated = next
  })
}
