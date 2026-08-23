/**
 * ================================ 文件注释 ================================
 * 【文件职责】Cordis `FiberState` 常量枚举的运行时镜像与人类可读标签：因为 const
 *             enum 没有可导入的运行时对象，这里按 vendored 定义镜像其数值并保留类型。
 * 【技术维度】const enum 在编译期内联、无运行时产物，因此用普通对象镜像数值
 *             （as const + 类型断言）；STATE_LABELS 用计算键避免反向映射开销。
 * 【产品维度】inspect 报告（见 inspect.ts）需要把 Fiber 状态数值转成用户可读文字，
 *             供模型判断服务/插件当前处于哪个生命周期阶段。
 * 【逻辑维度】FiberState 数值镜像 → 类型再导出 → STATE_LABELS 文案映射。
 * 【关键边界】数值必须与 vendored Cordis 的 FiberState 定义保持一致；若上游变动，
 *             需同步更新并重跑相关快照。
 * 【新手阅读建议】先理解"const enum 无运行时对象"这一背景，再看两个导出的用法。
 * ==========================================================================
 */

/**
 * Runtime mirror and labels for Cordis's `FiberState` const enum. A const enum has no runtime
 * object to import, so these values mirror the pinned vendored definition while retaining its
 * type.
 * @module @deepseek-ai/dsh-tool-cordis/fiber-state
 */

import type { FiberState as FiberStateEnum } from '@deepseek-ai/cordis'

/** Value mirror of the cordis `FiberState` const enum (see the module doc for why a mirror exists). */
export const FiberState = {
  PENDING: 0 as FiberStateEnum.PENDING,
  LOADING: 1 as FiberStateEnum.LOADING,
  ACTIVE: 2 as FiberStateEnum.ACTIVE,
  FAILED: 3 as FiberStateEnum.FAILED,
  DISPOSED: 4 as FiberStateEnum.DISPOSED,
  UNLOADING: 5 as FiberStateEnum.UNLOADING,
} as const

/** The cordis `FiberState` enum type, re-exported so mirror consumers need one import. */
export type FiberState = FiberStateEnum

/** Human-readable label for each {@link FiberState}, keyed by member (inlining-safe — no reverse mapping). */
export const STATE_LABELS = {
  [FiberState.PENDING]: 'pending',
  [FiberState.LOADING]: 'loading',
  [FiberState.ACTIVE]: 'active',
  [FiberState.FAILED]: 'failed',
  [FiberState.DISPOSED]: 'disposed',
  [FiberState.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, string>
