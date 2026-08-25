/*
 * ================================ 文件注释 ================================
 * 【文件职责】无框架启动页的 fiber 状态投影词汇表：启动链订阅
 *   internal/status 并投影所属 loader 条目的当前状态。
 * 【技术维度】const enum 的值镜像：cordis 的 FiberState 是 const enum，
 *   没有运行时对象可导入（esbuild 管线也无法跨模块内联），因此这里镜像
 *   钉住的 vendored 定义的值同时保留其类型。
 * 【产品维度】启动页展示每个插件条目的加载进度与失败状态，无需 React。
 * 【逻辑维度】FIBER_STATE 镜像枚举值；STATE_LABELS 提供每状态标签；
 *   LoaderEntryState 是字符串标签联合。
 * 【关键边界】STATE_LABELS 按成员键控（内联安全——无反向映射）；
 *   值必须与 vendored FiberState 钉住定义一致。
 * 【新手阅读建议】无前置依赖，常量即全部。
 * ==========================================================================
 */
/**
 * Fiber-state projection vocabulary for the framework-free boot page. The
 * boot chain subscribes to `internal/status` and projects the owning loader
 * entry's current state.
 * @module @deepseek-ai/dsh-client-web/src/loader-status
 */
/*
 * 无框架启动页的 fiber 状态投影词汇表。启动链订阅 internal/status 并投影
 * 所属 loader 条目的当前状态。
 * @module @deepseek-ai/dsh-client-web/src/loader-status
 */
import type { FiberState } from '@deepseek-ai/cordis'

/**
 * Value mirror of cordis's `FiberState` const enum: a const enum has no
 * runtime object to import (and esbuild-based pipelines cannot inline it
 * across modules), so these values mirror the pinned vendored definition
 * while retaining its type (same rationale as dsh-tool-cordis's mirror).
 */
/*
 * cordis FiberState const enum 的值镜像：const enum 没有可导入的运行时
 * 对象（esbuild 管线也无法跨模块内联它），因此这些值镜像钉住的 vendored
 * 定义，同时保留其类型（与 dsh-tool-cordis 的镜像同理）。
 */
export const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** One entry's projected state label (lower-case face of {@link FiberState}). */
/* 一个条目的投影状态标签（FiberState 的小写面）。 */
export type LoaderEntryState = 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading'

/** Label for each fiber state, keyed by member (inlining-safe — no reverse mapping). */
/* 每个 fiber 状态的标签，按成员键控（内联安全——无反向映射）。 */
export const STATE_LABELS: Record<FiberState, LoaderEntryState> = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: 'disposed',
  [FIBER_STATE.UNLOADING]: 'unloading',
}
