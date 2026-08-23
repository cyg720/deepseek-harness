/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现"写后缓冲"（write-behind）控制器 SessionWriteBehind：为每个
 *   活跃会话管理待写事件队列、固定的攒批时限、进行中的落盘写、失败保留与显式
 *   排空屏障，是持久化协调器的写路径积木。
 * 【技术维度】有界延迟批处理（固定窗口 setTimeout）+ 单飞行（single-flight）写入 +
 *   Promise.withResolvers 实现的共享屏障；失败时把批次放回队首保证顺序与不丢。
 * 【产品维度】流式输出场景下事件产生极快（每条 delta 一个事件），攒批合并能大幅
 *   减少物理写次数、降低 IO 压力；flush 又能让用户在关键时刻（回合结束等）立即
 *   拿到"已持久化"的确定性。
 * 【逻辑维度】按代码顺序：①配置接口；②控制器类——enqueue 入队并启动窗口、
 *   flush 显式排空（并发调用共享同一屏障）、自动路径（armTimer/onDeadline/
 *   startBackground/continueAutomatic）、屏障排空 drainBarrier、底层单次写
 *   startWrite（失败回滚入队首）。
 * 【关键边界】后台写的失败不会拒绝生产者（只上报并保留数据）；flush 的 Promise
 *   才会以失败告终；每个缓冲窗口是固定时长而非滑动窗口；同一时刻最多一个活跃写。
 * 【新手阅读建议】先读 enqueue 与 flush 理解两条触发路径，再读 startWrite 理解
 *   "失败放回队首"的关键语义，最后看 onDeadline/continueAutomatic 理解预算超支
 *   （deadlineExpired）的处理。
 * ==========================================================================
 */
/**
 * Bounded per-session write batching for the shared persistence coordinator.
 * @module @deepseek-ai/dsh-session-persistence/write-behind
 */
/**
 * 【中文导读】上面英文说明：本模块为共享持久化协调器提供"每会话有界写攒批"。
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Dependencies and scheduling policy for one live session's write controller. */
/**
 * 【中文】单个活跃会话写控制器的依赖与调度策略。
 */
export interface SessionWriteBehindOptions {
  /** Maximum intentional batching wait after an idle queue receives work. */
  /** 【中文】空闲队列收到新事件后最多故意等多久（固定窗口时长，毫秒）。 */
  readonly maxDelayMs: number
  /** Persist one stable ordered prefix; resolves only after backend durability. */
  /** 【中文】把一段稳定的有序前缀交给后端持久化；仅在真正落盘后才 resolve。 */
  readonly write: (events: readonly SessionEvent[]) => Promise<void>
  /** Observe a detached background write failure without rejecting the producer. */
  /** 【中文】观察"脱管后台写"的失败：只上报不拒绝生产者。 */
  readonly reportBackgroundFailure: (error: unknown) => void
}

/**
 * Owns one live session's pending events, fixed batching deadline, active write,
 * failure retention, and explicit quiescence barrier.
 */
/**
 * 【中文】一个活跃会话的写后缓冲控制器：持有待写事件队列、固定攒批截止、
 * 进行中的写、失败保留与显式静默屏障。两条触发路径：自动窗口到期（后台写，
 * 失败不惊动生产者）与显式 flush（共享屏障，失败会拒绝调用方）。
 */
export class SessionWriteBehind {
  /** 待写事件队列：已深拷贝、归本控制器所有，按到达顺序排列。 */
  private pending: SessionEvent[] = []
  /** 自动攒批窗口的定时器句柄；undefined 表示当前无窗口。 */
  private timer: ReturnType<typeof setTimeout> | undefined
  /** 当前进行中的持久化写（同一时刻最多一个）。 */
  private active: Promise<void> | undefined
  /** 显式 flush 的共享屏障；存在期间后续 flush 直接复用同一 Promise。 */
  private barrier: Promise<void> | undefined
  /** 自动窗口已到期但活跃写未结束：等它完成后立即续写（预算超支标记）。 */
  private deadlineExpired = false
  /** 自动路径暂停中：写失败后停止自动重试，等待下次 enqueue 或 flush 唤醒。 */
  private automaticPaused = false

  /**
   * @param options - fixed scheduling policy and durable batch sink.
   */
  /**
   * 【中文】构造控制器。
   * @param options - 固定的调度策略与持久化批次出口。
   */
  constructor(private readonly options: SessionWriteBehindOptions) {}

  /** Whether this controller owns queued events or an active durable write. */
  /**
   * 【中文】是否还有未完成的工作（排队事件或进行中的写）。回收逻辑用它判断
   * 会话是否"干净"。
   */
  get hasWork(): boolean {
    return this.pending.length > 0 || this.active !== undefined
  }

  /**
   * Copy one event into the persistence-owned queue and start a fixed deadline
   * when the automatic path is idle.
   * @param event - frozen live event to retain independently of its producer.
   */
  /**
   * 【中文】把一条事件复制进持久化自有队列，并在自动路径空闲时启动固定窗口。
   * 深拷贝（structuredClone）让控制器持有独立副本，生产者后续改动互不影响。
   * 若屏障排空进行中则只入队（排空循环会带走）；自动路径被暂停时借机唤醒。
   * @param event - 已冻结的活跃事件，将被独立保留。
   */
  enqueue(event: SessionEvent): void {
    const wasEmpty = this.pending.length === 0
    this.pending.push(structuredClone(event))
    // 屏障排空中：新事件交给 drainBarrier 的 while 循环处理，不另起窗口。
    if (this.barrier !== undefined) return
    if (this.automaticPaused) {
      // 失败暂停后的第一次新事件：恢复自动路径并重新计时。
      this.automaticPaused = false
      this.deadlineExpired = false
      this.armTimer()
    } else if (wasEmpty) {
      // 队列由空变非空：启动本批次的固定窗口；已有窗口则继续攒批。
      this.armTimer()
    }
  }

  /**
   * Cancel the batching wait and durably drain through a quiescent point.
   * Concurrent callers join the same barrier.
   * @returns a promise that rejects if the barrier's durable retry fails.
   */
  /**
   * 【中文】取消攒批等待并排空到一个静默点（队列清零且无活跃写）。并发调用者
   * 共享同一个屏障 Promise。
   * @returns 屏障内的持久化重试最终失败时该 Promise 以之拒绝。
   */
  flush(): Promise<void> {
    // 已有屏障：后来者直接搭车，不重复排空。
    if (this.barrier !== undefined) return this.barrier
    this.cancelTimer()
    this.deadlineExpired = false
    this.automaticPaused = false
    const barrier = Promise.withResolvers<void>()
    this.barrier = barrier.promise
    void this.drainBarrier(barrier.resolve, barrier.reject)
    return barrier.promise
  }

  /** Cancel the current automatic deadline without draining retained work. */
  /**
   * 【中文】只取消当前的自动窗口，不动已保留的待写数据（不排空）。
   */
  cancelAutomaticWait(): void {
    this.cancelTimer()
    this.deadlineExpired = false
  }

  /** Start the one fixed window for the current pending prefix. */
  /** 【中文】为当前待写前缀启动唯一的固定窗口。 */
  private armTimer(): void {
    this.timer = setTimeout(() => { this.onDeadline() }, this.options.maxDelayMs)
  }

  /** Cancel any pending automatic deadline. */
  /** 【中文】取消尚未到期的自动窗口（若有）。 */
  private cancelTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Start a background write now, or remember that an active write used the budget. */
  /**
   * 【中文】窗口到期：若有活跃写占着单飞名额，就记下"预算已超支"，等它结束后
   * 立即续写；否则现在就启动一次后台写。
   */
  private onDeadline(): void {
    this.timer = undefined
    if (this.active !== undefined) {
      this.deadlineExpired = true
      return
    }
    this.startBackground()
  }

  /** Start one detached write whose failure is reported and retained. */
  /**
   * 【中文】启动一次"脱管"后台写：失败只上报并保留数据，不拒绝任何调用方。
   * 完成后尝试续写（若预算已超支）。
   */
  private startBackground(): void {
    const active = this.startWrite(true)
    void active.then(() => { this.continueAutomatic() }, () => {})
  }

  /** Continue immediately after an over-budget active write, otherwise keep its timer. */
  /**
   * 【中文】活跃写结束后的自动续写判断：仅当没有屏障排空、队列非空、且窗口预算
   * 已在等待中超支时，立即再起一次后台写；否则保持现状等下一个窗口。
   */
  private continueAutomatic(): void {
    if (this.barrier !== undefined || this.pending.length === 0) return
    if (this.deadlineExpired) {
      this.deadlineExpired = false
      this.startBackground()
    }
  }

  /** Await overlapping work, drain to quiescence, and settle the shared barrier. */
  /**
   * 【中文】屏障排空主循环：先等同一次重叠的活跃写落定，然后循环把队列写到清空，
   * 最后解除屏障并放行所有 flush 等待者。中途失败则拒绝屏障。
   * @param resolve - 屏障成功回调。
   * @param reject - 屏障失败回调。
   */
  private async drainBarrier(resolve: () => void, reject: (reason?: unknown) => void): Promise<void> {
    try {
      const overlapping = this.active
      if (overlapping !== undefined) {
        await Promise.allSettled([overlapping])
        this.automaticPaused = false
      }
      // 反复写直到队列彻底清空——期间新入队的事件也会被带走。
      while (this.pending.length > 0) await this.startWrite(false)
    } catch (error: unknown) {
      this.barrier = undefined
      reject(error)
      return
    }
    // Close admission to this barrier in the same job that observes the empty
    // queue, before resolving callers. A later enqueue therefore starts its own
    // automatic window instead of being stranded behind a settled barrier.
    // 在观察到队空的同一个任务里、于放行调用方之前关闭本屏障的准入：
    // 之后的新 enqueue 会启动自己的自动窗口，而不是被困在已落定的屏障后面。
    this.barrier = undefined
    resolve()
  }

  /** Start one stable pending prefix, retaining it in order if durability fails. */
  /**
   * 【中文】发起一次底层写：整体取走当前队列作为稳定前缀。失败时把这批事件放回
   * 队首（保持顺序）、暂停自动路径并重抛错误——由上层决定上报还是拒绝。
   * @param background - 是否为脱管后台写（失败走上报而非拒绝）。
   * @returns 本次写的完成 Promise（失败即拒绝）。
   */
  private startWrite(background: boolean): Promise<void> {
    const batch = this.pending.splice(0)
    this.cancelTimer()
    this.deadlineExpired = false
    const operation = Promise.resolve().then(() => this.options.write(batch))
    const active = operation
      .catch((error: unknown) => {
        // 失败回滚：批次放回队首（后到的事件排在其后），顺序不乱、一条不丢。
        this.pending = batch.concat(this.pending)
        this.cancelTimer()
        this.deadlineExpired = false
        this.automaticPaused = true
        if (background) this.options.reportBackgroundFailure(error)
        throw error
      })
      .finally(() => {
        this.active = undefined
      })
    this.active = active
    return active
  }
}
