/** Host operations used directly by the frame-wide Cordis panel. */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】全框架 Cordis 面板直接使用的 Host 操作类型定义：停止、删除、读库存
 *             三个动词的签名与结果，以及库存行类型。
 * 【技术维度】纯类型文件：CordisActionResult 折叠远程错误；CordisDynamicPort 是
 *             注入给 createCordisInventory 的 RPC 接缝（真实实现见 client/index.ts
 *             的 port，测试可注入桩）。
 * 【产品维度】让面板代码不感知远程细节：点击"停止/移除"按钮即得到一个统一的
 *             成功/失败结果。
 * 【逻辑维度】结果类型 → 端口接口 → 库存行类型别名。
 * 【关键边界】只含类型；所有动词都带 sessionId（面板跨会话操作）。
 * 【新手阅读建议】与 inventory.ts、client/index.ts 的 port 实现对照阅读。
 * ==========================================================================
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  CordisDynamicPluginId, DynamicCordisInventoryRow,
} from './events.ts'

/** Result of a panel lifecycle gesture. */
export type CordisActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/** RPC seam kept outside the React surface. */
export interface CordisDynamicPort {
  /** Stop one Plugin while retaining its immutable Packages. */
  stop(sessionId: SessionId, pluginId: CordisDynamicPluginId): Promise<CordisActionResult>
  /** Stop and remove one Plugin together with every Package. */
  remove(sessionId: SessionId, pluginId: CordisDynamicPluginId): Promise<CordisActionResult>
  /** Read the frame-wide Plugin inventory. */
  inventory(): Promise<readonly DynamicCordisInventoryRow[]>
}

/** One stable Plugin row as the panel receives it. */
export type CordisInventoryRow = DynamicCordisInventoryRow
