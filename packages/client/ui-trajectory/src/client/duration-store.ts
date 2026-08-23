/**
 * ================================ 文件注释 ================================
 * 【文件职责】创建"轨迹视图是否显示真实时长"偏好的持久化数据源（SnapshotStore）。
 * 【技术维度】基于 client-runtime 的 createSnapshotStore，带持久化（键名 dsh.trajectory.duration）。
 * 【产品维度】用户在轨迹工具栏切换"使用实际时长 / 等宽操作"后，刷新页面仍保持选择。
 * 【逻辑维度】单个工厂函数，把布尔偏好封装成快照存储返回。
 * 【关键边界】一个插件生命周期内全浏览器共享一个实例；只存布尔值。
 * 【新手阅读建议】理解 createSnapshotStore 的"快照 + 持久化"能力即可。
 * ==========================================================================
 */
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Create the browser-wide trajectory duration preference source.
 * @returns a persisted source shared by every session view in one plugin lifecycle.
 */
/**
 * 创建浏览器级"轨迹显示实际时长"偏好源。
 * 使用示例：apply 里创建一次，通过 inject 的 hooks 共享给所有会话视图。
 * @returns 一个带持久化的布尔快照存储，插件生命周期内所有会话视图共享。
 */
export function createTrajectoryDurationStore(): SnapshotStore<boolean> {
  return createSnapshotStore(false, {
    persist: { name: 'dsh.trajectory.duration' },
  })
}
