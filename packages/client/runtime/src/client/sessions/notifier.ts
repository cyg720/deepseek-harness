/**
 * ================================ 文件注释 ================================
 * 【文件职责】订阅 + 批量通知原语：Session 与 SessionManager 共享的通知
 *   机制，负责"标记脏 -> 调度批量冲刷 -> 重建快照缓存 -> 通知订阅者"。
 * 【技术维度】关键约束来自 React 的 useSyncExternalStore：flush 必须先
 *   重建快照缓存再通知（保证 getSnapshot 引用稳定）；无监听器时跳过重建。
 * 【产品维度】高频流式更新（token、帧级状态）需要合并成一次冲刷，避免
 *   每帧都触发 React 重渲染与 DOM 更新。
 * 【逻辑维度】markDirty 合并为一次微任务冲刷；markFrameDirty 合并为一次
 *   动画帧冲刷；notifyNow 同步冲刷；ensureFresh 拉取式重建。
 * 【关键边界】新鲜度（freshness）与通知（notify）是分离的两个位：markDirty
 *   与计划冲刷之间的 ensureFresh 只重建快照、不吞掉通知，否则拉取型读者
 *   先读会饿死推送型订阅者。
 * 【新手阅读建议】先理解 uSES 的稳定 getSnapshot 要求，再看 flush 的顺序。
 * ==========================================================================
 */
// Notifier: subscription + batched notification primitive shared by Session and
// SessionManager. Semantics: N markDirty calls collapse into one microtask flush, while
// N markFrameDirty calls collapse into one animation-frame flush;
// the flush rebuilds the snapshot cache BEFORE notifying (useSyncExternalStore requires a stable
// getSnapshot reference). With no listeners the rebuild is skipped and only the dirty bit is set
// (keeps frame storms cheap); the next getSnapshot rebuilds lazily.
//
// Freshness and notification are SEPARATE bits: a pull (ensureFresh) between
// markDirty and the scheduled flush rebuilds the snapshot but must not
// swallow the notification — push subscribers (object-layer watchers) would
// otherwise starve whenever any reader pulls first.
// 通知器：Session 与 SessionManager 共享的"订阅 + 批量通知"原语。
// 语义：N 次 markDirty 合并为一次微任务冲刷；N 次 markFrameDirty 合并为
// 一次动画帧冲刷；冲刷在通知前先重建快照缓存（useSyncExternalStore 要求
// 稳定的 getSnapshot 引用）。没有监听器时跳过重建、只置脏位（保持帧风暴
// 廉价）；下次 getSnapshot 懒重建。
//
// 新鲜度与通知是分离的两个位：markDirty 与计划冲刷之间的拉取（ensureFresh）
// 会重建快照但不能吞掉通知——否则对象层监视器等推送订阅者会在任何读者
// 先拉取时被饿死。

/** Subscription + batched notification primitive (shared by Session and SessionManager). */
/** 订阅 + 批量通知原语（Session 与 SessionManager 共用）。 */
export class Notifier {
  private listeners = new Set<() => void>() // 订阅者集合
  private dirty = false // 快照已过期（需重建）标志
  private notifyPending = false // 有待通知的订阅者（通知待处理）标志
  private scheduled: 'none' | 'microtask' | 'frame' = 'none' // 当前计划中的冲刷方式
  private scheduleGeneration = 0 // 计划代数：用于让过期计划失效

  /** @param rebuild - snapshot rebuild function injected by the owner (writes the owner's snapshotCache). */
  /** @param rebuild 属主注入的快照重建函数（写入属主的 snapshotCache）。 */
  constructor(private readonly rebuild: () => void) {}

  /**
   * uSES subscription entry.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   */
  /**
   * uSES（useSyncExternalStore）的订阅入口。
   * @param listener 变更回调。
   * @returns 取消订阅函数。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** State-change entry: mark dirty and schedule the batched flush. */
  /** 状态变更入口：标记脏并计划批量冲刷。 */
  markDirty(): void {
    this.dirty = true
    this.notifyPending = true
    if (this.scheduled === 'microtask') return // 已计划过则不再重复调度
    this.schedule('microtask')
  }

  /** Stream-change entry: mark dirty and publish the cumulative state at most once per frame. */
  /** 流式变更入口：标记脏并保证每帧最多发布一次累积状态。 */
  markFrameDirty(): void {
    this.dirty = true
    this.notifyPending = true
    if (this.scheduled !== 'none') return
    this.schedule(typeof globalThis.requestAnimationFrame === 'function' ? 'frame' : 'microtask')
  }

  /**
   * Synchronous flush: controlled-input writes must notify in the same tick as
   * onChange, or React rolls the DOM back to the stale value and the caret jumps to the end.
   */
  /**
   * 同步冲刷：受控输入的写入必须在 onChange 同一 tick 内通知，否则 React
   * 会把 DOM 回滚到旧值，光标跳到末尾。
   */
  notifyNow(): void {
    this.dirty = true
    this.notifyPending = true
    this.invalidateSchedule()
    this.flush()
  }

  /**
   * Pre-getSnapshot check: rebuild synchronously when dirty (read path
   * before first subscribe / while unobserved). Notification stays pending.
   */
  /**
   * getSnapshot 前的检查：脏时同步重建（首次订阅前/未被观察时的读路径）。
   * 通知仍保持待处理状态。
   */
  ensureFresh(): void {
    if (!this.dirty) return
    this.dirty = false
    this.rebuild()
  }

  /** 计划一次冲刷：记录代数并挂到微任务或动画帧上。 */
  private schedule(kind: 'microtask' | 'frame'): void {
    const generation = ++this.scheduleGeneration
    this.scheduled = kind
    const publish = () => {
      if (generation !== this.scheduleGeneration) return // 已被更新的计划取代则放弃
      this.scheduled = 'none'
      this.flush()
    }
    if (kind === 'frame') {
      globalThis.requestAnimationFrame(publish)
    } else {
      queueMicrotask(publish)
    }
  }

  /** 使当前计划失效（notifyNow 前调用，避免重复冲刷）。 */
  private invalidateSchedule(): void {
    this.scheduleGeneration++
    this.scheduled = 'none'
  }

  /** 执行冲刷：重建快照（如脏）并通知所有订阅者。 */
  private flush(): void {
    if (!this.notifyPending) return
    if (this.listeners.size === 0) return // lazy: dirty (if still set) rebuilds on next getSnapshot
    this.notifyPending = false
    if (this.dirty) {
      this.dirty = false
      this.rebuild()
    }
    for (const listener of this.listeners) listener()
  }
}
