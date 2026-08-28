import { notifySubscribers } from '@deepseek-ai/dsh-client-store'

/**
 * Batches structural updates in microtasks and stream updates by animation
 * frame. Reads may rebuild a dirty snapshot without consuming the pending
 * subscriber notification.
 */
export class Notifier {
  private listeners = new Set<() => void>() // 订阅者集合
  private dirty = false // 快照已过期（需重建）标志
  private notifyPending = false // 有待通知的订阅者（通知待处理）标志
  private scheduled: 'none' | 'microtask' | 'frame' = 'none' // 当前计划中的冲刷方式
  private scheduleGeneration = 0 // 计划代数：用于让过期计划失效

  /** @param rebuild - snapshot rebuild function injected by the owner (writes the owner's snapshotCache). */
  /* @param rebuild 属主注入的快照重建函数（写入属主的 snapshotCache）。 */
  constructor(private readonly rebuild: () => void) {}

  /**
   * uSES subscription entry.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   */
  /*
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

  /** Mark the snapshot dirty and notify in a microtask. */
  markDirty(): void {
    this.dirty = true
    this.notifyPending = true
    if (this.scheduled === 'microtask') return // 已计划过则不再重复调度
    this.schedule('microtask')
  }

  /** Mark the snapshot dirty and publish cumulative state at most once per frame. */
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
  /*
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
  /*
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
    notifySubscribers(this.listeners, '[session-controller]')
  }
}
