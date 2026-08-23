/**
 * ================================ 文件注释 ================================
 * 【文件职责】输入域与设置域共用的"提交投递模式"词汇：普通消息的投递模式与触发它的
 *             键盘手势。
 * 【技术维度】纯类型文件；InputSubmitMode 复用设置侧的 BusyEnterBehavior。
 * 【产品维度】"Enter 排队 / 插话、Cmd+Enter 另一行为"的策略在输入与设置两端共用同一词汇。
 * 【逻辑维度】1) 转发 BusyEnterBehavior；2) InputSubmitMode；3) ComposerSubmitGesture。
 * 【关键边界】模式与手势分开：同一手势在不同运行状态下解析出不同模式。
 * 【新手阅读建议】一行一个类型，对照 submission-settings.ts 阅读。
 * ==========================================================================
 */
/** Composer submission vocabulary shared by the input and settings domains. */

import type { BusyEnterBehavior } from '../../submission-settings.ts'

export type { BusyEnterBehavior } from '../../submission-settings.ts'

/** Delivery mode requested for one ordinary composer message. */
// 一条普通输入框消息请求的投递模式（queue / steer）。
export type InputSubmitMode = BusyEnterBehavior

/** Keyboard gesture whose delivery mode the submission policy resolves. */
// 提交策略为其解析投递模式的键盘手势：Enter 与加速（Cmd/Ctrl+Enter）。
export type ComposerSubmitGesture = 'enter' | 'accelerated'
