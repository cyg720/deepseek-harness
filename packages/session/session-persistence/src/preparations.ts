/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现"未发布 Session"的有限共享与独占预留池（SessionPreparations）：
 *   让 load / inspect / prepare 三个入口共享同一次冷读结果，并在 resume 场景对
 *   就绪源做排他的"预留—提交—发布"管理，另含排队取消观察工具 observeQueuedAbort。
 * 【技术维度】按会话 id 的状态机（loading → ready → committing → reserved）；
 *   in-flight 冷读去重；Map 插入序实现的 LRU 淘汰（touch 重插）；Promise.withResolvers
 *   做预留等待门闩；观察者本地取消（AbortSignal）不波及共享操作。
 * 【产品维度】避免同一份日志被并发读取多次（省 IO、保一致），并保证 resume 的
 *   "准备好的会话"不被其他读者抢先或污染——用户点开历史会话时既快又稳。
 * 【逻辑维度】按代码顺序：①内部结构 PreparedSource/PreparationPhase/
 *   PreparationEntry 与对外预留接口；②SessionPreparations 类：查询、检视共享、
 *   预留流水线、发布接驳、消费/释放/作废、可写断言、就绪取走，及私有 entryFor/
 *   makeReady/remove/touch；③observeQueuedAbort 排队取消观察与 rejectObservation。
 * 【关键边界】committing/reserved 阶段该 id 禁止追加写入（assertWritable）；LRU
 *   只淘汰 ready 阶段的条目；预留只能被精确匹配的调用者消费，别名一律报错。
 * 【新手阅读建议】先看 PreparationPhase 四状态图景，再顺着 reserve→commit→
 *   attach/discard/release 走一遍生命周期；entryFor/touch 是理解去重与淘汰的关键。
 * ==========================================================================
 */
/**
 * Bounded sharing and exclusive reservation of unpublished Sessions.
 * @module @deepseek-ai/dsh-session-persistence/preparations
 */
/*
 * 【中文导读】上面英文概括：本模块管理未发布 Session 的有界共享与独占预留。
 */

import type { Session, SessionId } from '@deepseek-ai/dsh-session'

/** 【中文】准备池条目里源的最小形状要求：必须携带一个（未发布的）Session。 */
interface PreparedSource {
  readonly session: Session
}

/** 【中文】条目所处阶段：loading 冷读中 / ready 就绪可共享 / committing 预留提交中 / reserved 已被独占预留。 */
type PreparationPhase = 'loading' | 'ready' | 'committing' | 'reserved'

/**
 * 【中文】单个会话 id 的池条目：共享的冷读 Promise、当前阶段、就绪后的源，
 * 以及预留期间的等待门闩。字段随状态机推进逐步填充。
 */
interface PreparationEntry<Source, CommitState> {
  readonly id: SessionId
  /** 共享的冷读结果 Promise；去重的关键——后来者 await 同一个。 */
  readonly result: Promise<Source>
  phase: PreparationPhase
  /** 冷读完成并就绪后填入的源；预留提交后可能被替换为提交结果。 */
  source?: Source
  /** reserved 阶段持有的预留对象。 */
  reservation?: SessionPreparationReservation<Source, CommitState>
  /** committing/reserved 期间供其他等待者观察"预留何时落定"的门闩。 */
  reservationSettled?: Promise<void>
  /** 解除上述门闩的 resolve 函数。 */
  settleReservation?: () => void
  pins: number
}

/** A borrowed prepared source that remains outside ready-entry eviction until released. */
export interface PreparationLease<Source> extends Disposable {
  /** Shared immutable prepared source. */
  readonly source: Source
}

/** One exclusively held prepared source and its committed persistence state. */
/*
 * 【中文】一份被独占持有的准备源及其已提交的持久化状态：resume 发布时凭它精确
 * 接驳内存会话与磁盘游标。
 */
export interface SessionPreparationReservation<Source, CommitState> {
  readonly entry: PreparationEntry<Source, CommitState>
  readonly source: Source
  readonly state: CommitState
}

/** Per-coordinator cold-read sharing, exclusive reservation, and ready-entry LRU. */
/*
 * 【中文】协调器级"准备池"：按会话 id 共享进行中的冷读、管理独占预留，并用
 * LRU 限制就绪条目数量。泛型参数：Source 是池中流转的源类型；CommitState 是
 * 预留提交后确立的持久化状态（如游标记账）。
 */
export class SessionPreparations<Source extends PreparedSource, CommitState> {
  /** 会话 id → 池条目；Map 的插入序被 touch 用作 LRU 新旧序。 */
  private readonly entries = new Map<SessionId, PreparationEntry<Source, CommitState>>()

  /**
   * 【中文】构造准备池。
   * @param capacity - 就绪条目的 LRU 容量上限。
   */
  constructor(private readonly capacity: number) {}

  /**
   * Whether this pool currently knows about an unpublished identity.
   * @param id - session identity.
   * @returns whether an entry exists for the identity.
   */
  /*
   * 【中文】查询池中是否存在该 id 的条目（任意阶段）。
   * @param id - 会话 id。
   * @returns 存在返回 true。
   */
  has(id: SessionId): boolean {
    return this.entries.has(id)
  }

  /**
   * Observe one prepared source, sharing an in-flight read for the same id.
   * @param id - session identity.
   * @param load - cold loader used when no entry exists.
   * @param signal - optional cancellation signal while waiting.
   * @returns the shared prepared source.
   */
  /*
   * 【中文】检视式观察：为同一 id 共享进行中的冷读（不重复读盘），冷读完成后
   * 返回源；若该条目已被预留提交过，优先返回提交后的 source。就绪命中会刷新 LRU。
   * @param id - 会话 id。
   * @param load - 池中无条目时使用的冷加载函数。
   * @param signal - 等待期间的可选取消信号。
   * @returns 共享的准备源。
   */
  async inspect(
    id: SessionId,
    load: () => Promise<Source>,
    signal?: AbortSignal,
  ): Promise<Source> {
    const entry = this.entryFor(id, load)
    const loaded = signal === undefined
      ? await entry.result
      : await observeQueuedAbort(entry.result, signal)
    // 提交阶段可能已把更好的 source 写回条目：有则用条目里的，否则用本次读取结果。
    const source = entry.source ?? loaded
    if (this.entries.get(id) === entry && entry.phase === 'ready') this.touch(entry)
    return source
  }

  /**
   * Borrow one prepared source and pin its ready entry against LRU eviction.
   * @param id - session identity.
   * @param load - cold loader used when no entry exists.
   * @param signal - optional cancellation signal while waiting.
   * @returns a caller-owned observation lease.
   */
  async borrow(
    id: SessionId,
    load: () => Promise<Source>,
    signal?: AbortSignal,
  ): Promise<PreparationLease<Source>> {
    const entry = this.entryFor(id, load)
    const pinned = this.entries.get(id) === entry
    if (pinned) entry.pins += 1
    let loaded: Source
    try {
      loaded = signal === undefined
        ? await entry.result
        : await observeQueuedAbort(entry.result, signal)
    } catch (error: unknown) {
      if (pinned && this.entries.get(id) === entry) {
        entry.pins -= 1
        if (entry.phase === 'ready') this.touch(entry)
      }
      throw error
    }
    const source = entry.source ?? loaded
    if (this.entries.get(id) !== entry) {
      return { source, [Symbol.dispose]: () => {} }
    }
    if (entry.phase === 'ready') this.touch(entry)
    let released = false
    return {
      source,
      [Symbol.dispose]: () => {
        if (released) return
        released = true
        if (this.entries.get(id) !== entry) return
        entry.pins -= 1
        if (entry.phase === 'ready') this.touch(entry)
      },
    }
  }

  /**
   * Reserve one ready source after committing its pending durable repair.
   * @param id - session identity.
   * @param load - cold loader used when no entry exists.
   * @param commit - durable repair and cursor-state commit.
   * @param signal - optional cancellation signal while waiting.
   * @returns the exclusive reservation, or undefined if its entry was invalidated.
   */
  /*
   * 【中文】预留流水线：等冷读就绪 →（若他人正在提交/预留则等其落定）→ 把条目
   * 置为 committing 并执行 commit 回调（持久化修复 + 游标确立）→ 成功则进入
   * reserved 并返回独占预留。条目被并发作废、提交返回 undefined 或取消时，
   * 返回 undefined / 抛错由对应分支决定。
   * @param id - 会话 id。
   * @param load - 池中无条目时的冷加载函数。
   * @param commit - 执行持久化修复并提交游标状态；返回 undefined 表示需整体重读。
   * @param signal - 等待与提交期间的可选取消信号。
   * @returns 独占预留；条目已被作废则 undefined。
   */
  async reserve(
    id: SessionId,
    load: () => Promise<Source>,
    commit: (source: Source) => Promise<{ source: Source; state: CommitState } | undefined>,
    signal?: AbortSignal,
  ): Promise<SessionPreparationReservation<Source, CommitState> | undefined> {
    const entry = this.entryFor(id, load)
    await (signal === undefined ? entry.result : observeQueuedAbort(entry.result, signal))
    while (this.entries.get(id) === entry && entry.phase !== 'ready') {
      const settled = entry.reservationSettled
      /* v8 ignore next -- committing/reserved transitions install this waiter synchronously. */
      if (settled === undefined) throw new Error(`session "${id}" preparation lost its reservation waiter`)
      if (signal === undefined) await settled
      else await observeQueuedAbort(settled, signal)
    }
    if (this.entries.get(id) !== entry) return undefined
    const source = entry.source as Source
    // 装上"预留落定"门闩并进入 committing：其他等待者据此排队而不是抢跑。
    const reservationSettled = Promise.withResolvers<void>()
    entry.phase = 'committing'
    entry.reservationSettled = reservationSettled.promise
    entry.settleReservation = reservationSettled.resolve
    let committed: { source: Source; state: CommitState } | undefined
    try {
      committed = await commit(source)
    } catch (error: unknown) {
      // 提交失败：整个条目作废，错误原样上抛。
      this.remove(entry)
      throw error
    }
    if (committed === undefined) {
      // 提交方要求重读（如磁盘修复改变了修订号）：作废条目，调用方重试。
      this.remove(entry)
      return undefined
    }
    // 提交产物写回条目；此时取消属于"提交后反悔"，把条目放回 ready 供他人复用。
    entry.source = committed.source
    try {
      signal?.throwIfAborted()
    } catch (error: unknown) {
      this.makeReady(entry)
      throw error
    }
    if (this.entries.get(id) !== entry) return undefined
    const reservation: SessionPreparationReservation<Source, CommitState> = {
      entry,
      source: committed.source,
      state: committed.state,
    }
    entry.phase = 'reserved'
    entry.reservation = reservation
    return reservation
  }

  /**
   * Return the exact reservation for Session publication, rejecting aliases.
   * @param session - exact Session candidate for publication.
   * @returns its reservation, or undefined when no preparation exists.
   */
  /*
   * 【中文】发布前的精确核对：只有"reserved 阶段且源正是这个 Session 对象"时才
   * 返回其预留；同一 id 出现别名会话则报错——持久化状态已经认了别的对象。
   * @param session - 待发布的候选 Session（必须精确匹配）。
   * @returns 对应预留；池中无该 id 的准备时为 undefined。
   */
  reservationFor(session: Session): SessionPreparationReservation<Source, CommitState> | undefined {
    const entry = this.entries.get(session.id)
    if (entry === undefined) return undefined
    if (entry.phase === 'reserved'
      && entry.source?.session === session
      && entry.reservation !== undefined) {
      return entry.reservation
    }
    throw new Error(`cannot publish session "${session.id}": persisted state already owns this identity`)
  }

  /**
   * Consume a reservation after its exact Session has attached.
   * @param reservation - reservation to consume.
   */
  /*
   * 【中文】预留消费（发布路径）：精确 Session 已接驳后调用。核对条目与预留仍然
   * 配对，配对则把条目整体移除；失配说明状态已被并发改变，报错。
   * @param reservation - 要消费的预留。
   */
  attach(reservation: SessionPreparationReservation<Source, CommitState>): void {
    const { entry } = reservation
    if (this.entries.get(entry.id) !== entry || entry.reservation !== reservation) {
      throw new Error(`session "${entry.id}" preparation is no longer reserved`)
    }
    this.remove(entry)
  }

  /**
   * Consume a reservation whose caller only needs the committed inspection.
   * @param reservation - reservation to consume.
   */
  /*
   * 【中文】预留消费（只读路径）：load 拿到检视视图即可，不需要发布会话。
   * 配对仍成立则移除条目；已失配则静默返回（无东西可清理）。
   * @param reservation - 要消费的预留。
   */
  discard(reservation: SessionPreparationReservation<Source, CommitState>): void {
    const { entry } = reservation
    if (this.entries.get(entry.id) !== entry || entry.reservation !== reservation) return
    this.remove(entry)
  }

  /**
   * Return a reusable unpublished reservation to the ready LRU.
   * @param reservation - reservation to release.
   * @param reusable - whether the source remains valid for reuse.
   */
  /*
   * 【中文】释放预留：源仍可复用时把它放回 ready LRU（后续 inspect/prepare 可再取）；
   * 不可复用则直接移除。仅当条目、预留、阶段三者仍配对时才生效，否则静默忽略。
   * @param reservation - 要释放的预留。
   * @param reusable - 源是否仍可复用。
   */
  release(
    reservation: SessionPreparationReservation<Source, CommitState>,
    reusable: boolean,
  ): void {
    const { entry } = reservation
    if (this.entries.get(entry.id) !== entry
      || entry.reservation !== reservation
      || entry.phase !== 'reserved') return
    if (!reusable) {
      this.remove(entry)
      return
    }
    // 解除预留关系并回到 ready：LRU 重新计时。
    delete entry.reservation
    this.makeReady(entry)
  }

  /**
   * Discard a prepared view after the durable log changes.
   * @param id - changed session identity.
   */
  /*
   * 【中文】日志已变化：作废该 id 的准备视图（任意阶段），防止旧数据被继续共享。
   * @param id - 已变化的会话 id。
   */
  invalidate(id: SessionId): void {
    const entry = this.entries.get(id)
    if (entry !== undefined) this.remove(entry)
  }

  /**
   * Discard an exact stale ready source without disturbing an exclusive owner.
   * @param id - changed session identity.
   * @param expected - exact source observed before its revision check.
   * @returns whether the source was discarded, retained by a reservation, or is absent.
   */
  /*
   * 【中文】精确作废一个"过期但就绪"的源：对象身份必须与观察到的 expected 一致；
   * 若已被预留独占则保留不动（retained），借用方仍可安全读它。inspect 的重试
   * 循环据此决定"丢弃后重读"还是"借视图返回"。
   * @param id - 会话 id。
   * @param expected - 修订检查前观察到的精确源对象。
   * @returns discarded 已丢弃 / retained 被预留保留 / missing 不存在或不匹配。
   */
  discardReady(id: SessionId, expected: Source): 'discarded' | 'retained' | 'missing' {
    const entry = this.entries.get(id)
    if (entry === undefined || entry.source !== expected) return 'missing'
    if (entry.phase !== 'ready') return 'retained'
    this.remove(entry)
    return 'discarded'
  }

  /**
   * Reject writes while an unpublished Session exclusively reserves the id.
   * @param id - session identity to check.
   */
  /*
   * 【中文】写入守卫：该 id 的准备正处于 committing/reserved 时禁止追加——此时
   * 游标归属未定或被 resume 独占，写入会破坏一致性。
   * @param id - 待检查的会话 id。
   */
  assertWritable(id: SessionId): void {
    const phase = this.entries.get(id)?.phase
    if (phase === 'committing' || phase === 'reserved') {
      throw new Error(`cannot append session "${id}" while its persisted preparation is reserved`)
    }
  }

  /**
   * Remove a completed entry for an already-serialized append adoption.
   * @param id - adopted session identity.
   * @returns the prepared source, or undefined when no ready entry exists.
   */
  /*
   * 【中文】取走就绪的源并把条目移除（一次性）：供收养路径免于重复冷读。
   * 仅 ready 阶段且有源时可取。
   * @param id - 被收养的会话 id。
   * @returns 就绪的源；无可取为 undefined。
   */
  takeReady(id: SessionId): Source | undefined {
    const entry = this.entries.get(id)
    if (entry === undefined || entry.phase !== 'ready' || entry.source === undefined) return undefined
    this.remove(entry)
    return entry.source
  }

  private entryFor(
    id: SessionId,
    load: () => Promise<Source>,
  ): PreparationEntry<Source, CommitState> {
    const existing = this.entries.get(id)
    // 已有条目：无论处于哪个阶段都复用（冷读去重的关键）。
    if (existing !== undefined) return existing
    const deferred = Promise.withResolvers<Source>()
    const entry: PreparationEntry<Source, CommitState> = {
      id,
      result: deferred.promise,
      phase: 'loading',
      pins: 0,
    }
    this.entries.set(id, entry)
    let loading: Promise<Source>
    try {
      // Start immediately so a same-tick serialized append queues behind this
      // read. The deferred result settles only after the entry becomes ready.
      // 立刻启动加载：同一 tick 内串行化的 append 才能排在本读之后。
      // deferred 的结果要等条目真正 ready 后才落定。
      loading = load()
    } catch (error: unknown) {
      this.remove(entry)
      deferred.reject(error)
      return entry
    }
    void loading.then((source) => {
      // 条目仍在池中才写入源并转 ready；期间可能已被作废/替换。
      if (this.entries.get(id) === entry) {
        entry.source = source
        this.makeReady(entry)
      }
      deferred.resolve(source)
    }, (error: unknown) => {
      this.remove(entry)
      deferred.reject(error)
    })
    return entry
  }

  /** 【中文】把条目转为 ready：解除预留门闩并刷新 LRU。条目已不在池中则忽略。 */
  private makeReady(entry: PreparationEntry<Source, CommitState>): void {
    if (this.entries.get(entry.id) !== entry) return
    entry.phase = 'ready'
    const settle = entry.settleReservation
    delete entry.reservationSettled
    delete entry.settleReservation
    settle?.()
    this.touch(entry)
  }

  /** 【中文】从池中移除条目：先核对身份再删除，并解除预留门闩放行等待者。 */
  private remove(entry: PreparationEntry<Source, CommitState>): void {
    if (this.entries.get(entry.id) !== entry) return
    this.entries.delete(entry.id)
    const settle = entry.settleReservation
    delete entry.reservationSettled
    delete entry.settleReservation
    settle?.()
  }

  /**
   * 【中文】LRU 触碰：删后重插把条目移到"最新"位置；若就绪条目超出容量，
   * 淘汰 Map 序最靠前（最旧）的 ready 条目。只淘汰 ready，绝不影响提交/预留中的条目。
   */
  private touch(entry: PreparationEntry<Source, CommitState>): void {
    this.entries.delete(entry.id)
    this.entries.set(entry.id, entry)
    let readyCount = 0
    for (const candidate of this.entries.values()) {
      if (candidate.phase === 'ready') readyCount += 1
    }
    if (readyCount <= this.capacity) return
    for (const [id, candidate] of this.entries) {
      if (candidate.phase !== 'ready' || candidate.pins > 0) continue
      this.entries.delete(id)
      return
    }
  }
}

/**
 * Give a queued observer a prompt cancellation view without cancelling shared work.
 * @param operation - shared operation whose settlement remains authoritative.
 * @param signal - observer-local cancellation signal.
 * @param started - whether the operation has crossed its cancellation cutoff.
 * @returns the operation result or the observer's prompt cancellation.
 */
/*
 * 【中文】排队取消观察：给"正在等待共享操作"的观察者一个即时的本地取消视图，
 * 但绝不取消共享操作本身（它的落定仍是对外权威）。started 回调用于表达
 * "已越过取消截断点"——一旦操作真正开始，abort 事件就不再影响观察者。
 * @param operation - 共享操作 Promise，其结果/失败会原样透传。
 * @param signal - 观察者本地的取消信号。
 * @param started - 判断操作是否已越过取消截断点。
 * @returns 操作结果，或观察者自己的即时取消拒绝。
 */
export function observeQueuedAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  started: () => boolean = () => false,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // settled 保证"先到者赢"：操作落定与 abort 触发只结算一次。
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => {
      // 已越过截断点：忽略本次 abort，继续等共享操作的权威结果。
      if (started()) return
      finish(() => {
        try {
          signal.throwIfAborted()
        } catch (reason: unknown) {
          rejectObservation(reject, reason)
          return
        }
        /* v8 ignore next -- a native AbortSignal emits abort only after becoming aborted. */
        reject(new Error('queued observation abort event lacked an aborted signal'))
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => { finish(() => { resolve(value) }) },
      (reason: unknown) => {
        finish(() => { rejectObservation(reject, reason) })
      },
    )
    // 注册前就已处于 aborted 状态：手动触发一次检查。
    if (signal.aborted) onAbort()
  })
}

/** Preserve an exact loader or AbortSignal reason, including legacy non-Error values. */
/*
 * 【中文】原样转发拒绝原因（保留精确的加载错误或 AbortSignal 原因，
 * 包括非 Error 的遗留值），不做任何包装。
 */
function rejectObservation(reject: (reason?: unknown) => void, reason: unknown): void {
  reject(reason)
}
