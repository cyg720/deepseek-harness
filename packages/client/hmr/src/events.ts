/*
 * ================================ 文件注释 ================================
 * 【文件职责】/plugins/events 开发 SSE 通道的线协议——本包两个半边（节点
 *   半边的发布端与浏览器半边的接收端）共享的唯一类型来源。
 * 【技术维度】纯类型 + 常量：PluginsEventFrame 是判别联合；EVENTS_ENDPOINT
 *   是固定端点。
 * 【产品维度】开发模式下 Host 检测到 bundle 重建后，经 SSE 推送 rebuilt
 *   帧，浏览器 HMR 驱动据此热换插件。
 * 【逻辑维度】graph 帧在连接时推送完整图；rebuilt 帧通知单个 bundle 更新。
 * 【关键边界】帧仍跨线上边界：浏览器半边在其 JSON 解析点校验；共享类型
 *   只是防止两端漂移，并不替代解析。
 * 【新手阅读建议】无前置依赖，类型 + 常量即全部。
 * ==========================================================================
 */
/**
 * Wire protocol of the `/plugins/events` dev SSE channel — single source for
 * both halves of this package. Frames still cross a wire boundary: the
 * browser half validates them at its JSON parse point; sharing the type keeps
 * the two ends from drifting, not from parsing.
 */
/*
 * /plugins/events 开发 SSE 通道的线协议——本包两个半边的单一来源。帧仍跨
 * 线上边界：浏览器半边在其 JSON 解析点校验；共享类型只是防止两端漂移，
 * 并不替代解析。
 */

import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'

/** One SSE frame: the full graph on connect, or one rebuilt bundle notice. */
/* 一个 SSE 帧：连接时的完整图，或一条重建 bundle 通知。 */
export type PluginsEventFrame =
  | { type: 'graph'; graph: WebBootGraph }
  | { type: 'rebuilt'; id: string; rev: string }

/** System SSE endpoint pushing graph/rebuilt frames (wire protocol constant). */
/* 推送 graph/rebuilt 帧的系统 SSE 端点（线协议常量）。 */
export const EVENTS_ENDPOINT = '/plugins/events'
