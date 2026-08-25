/**
 * ================================ 文件注释 ================================
 * 【文件职责】跨"Host 库存 + 本页 Client 活动集合"的共享状态推导：把某个包版本
 *             在 UI 上应显示的生命周期状态算出来（idle / client-pending / running）。
 * 【技术维度】输入为库存行（Host 侧激活信息）与本页已加载的 Client 活动列表
 *             （来自 cordis-client-runner 的浏览器镜像），输出为三种产品可见状态。
 * 【产品维度】工具卡片/面板据此显示"待激活 / Client 待激活 / 运行中"，让用户准确
 *             知道激活进展到哪一步。
 * 【逻辑维度】packageOf 定位包 → cordisVisibleStatus 判定：无活动运行或运行的不是
 *             该包 → idle；纯 Host 包 → running；有 Client 半部则看本页是否已加载
 *             同一运行 → running 或 client-pending。
 * 【关键边界】状态以"本页加载情况"为准——同一包在其他页面运行不算本页 running；
 *             状态机不处理失败/审批（那些由 inventory/runner 的其他字段呈现）。
 * 【新手阅读建议】先看输入输出类型，再看 cordisVisibleStatus 的三个分支。
 * ==========================================================================
 */

/** Shared status derivation over Host inventory and this page's Client live set. */

import type { DynamicCordisLivePackage } from '@deepseek-ai/dsh-cordis-client-runner/client'
import type {
  CordisDynamicPackageId, DynamicCordisInventoryRow,
} from './events.ts'

/** The three product-visible lifecycle readings. */
/*
 * 三种产品可见的生命周期读数：idle（无活动运行/非该包）、client-pending（Host 已
 * 激活但本页 Client 半部未加载）、running（完全运行）。
 */
export type CordisVisibleStatus = 'idle' | 'client-pending' | 'running'

/**
 * Locate one immutable Package inside a Plugin row.
 * @param row - owning Plugin inventory row.
 * @param packageId - immutable Package identity to locate.
 * @returns the matching Package metadata, or `undefined` when absent.
 */
/*
 * 在插件库存行内定位一个包版本；找不到时返回 undefined。
 * @param row 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param packageId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function packageOf(
  row: DynamicCordisInventoryRow,
  packageId: CordisDynamicPackageId,
): DynamicCordisInventoryRow['packages'][number] | undefined {
  return row.packages.find(pkg => pkg.packageId === packageId)
}

/**
 * Derive the visible state of one Package.
 * @param row - owning Plugin inventory row.
 * @param packageId - Package being described.
 * @param loaded - Client activations loaded in this page.
 * @returns idle, Host-running/Client-pending, or fully running.
 */
/*
 * 推导某包版本的可见状态：先看该包是否就是活动运行的目标；纯 Host 包立即 running；
 * 含 Client 半部的包须本页已加载同一运行（插件/包/运行 ID 全匹配）才算 running，
 * 否则为 client-pending。
 * @param row 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param packageId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param loaded 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function cordisVisibleStatus(
  row: DynamicCordisInventoryRow,
  packageId: CordisDynamicPackageId,
  loaded: readonly DynamicCordisLivePackage[],
): CordisVisibleStatus {
  const run = row.activeRun
  if (run === undefined || run.packageId !== packageId) return 'idle'
  const pkg = packageOf(row, packageId)
  if (pkg?.hasClientHalf !== true) return 'running'
  return loaded.some(live => live.pluginId === row.pluginId
    && live.packageId === packageId
    && live.pluginRunId === run.pluginRunId)
    ? 'running'
    : 'client-pending'
}
