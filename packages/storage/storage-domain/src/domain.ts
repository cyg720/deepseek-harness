/**
 * ================================ 文件注释 ================================
 * 【文件职责】一个已打开领域的运行时实现：权威内存态、每领域唯一的写链、变更事件发出。
 * 读操作同步走内存，写操作排入写链，先等后端持久化、再改内存、最后发 domain/changed 事件。
 * 【技术维度】单文件包含核心类 DomainImpl 与表句柄 KvTableImpl。写链用 Promise 串接
 * （chain = chain.then(job)）保证同领域写入串行且有序；disposing/closed 两态区分
 * "拒绝新写入"与"连读也拒绝"两个关闭阶段。
 * 【产品维度】领域层是对外的数据读写 API：上层组件拿到 Domain/Global/KvTable 句柄，
 * 获得同步读、可靠有序的异步写，以及可订阅的变更事件，无需关心后端介质细节。
 * 【逻辑维度】按出现顺序：DomainGlobal（全局句柄接口）→ KvTable（表句柄接口）→
 * DomainGlobalHandleOf/Domain（领域接口）→ TableHost（表与领域写机制的内部桥）→
 * noop（写链消音用空函数）→ DomainImpl（领域实现）→ KvTableImpl（表实现）。
 * 【关键边界】返回的记录对象不做防御性拷贝，调用方不得就地修改，必须用 put/update 替换；
 * 关闭语义：先拒新写、再排空已排队的写（其事件照常发出）、最后关单元释放名字；
 * 写链每一环都保证 settle（拒绝由调用方的链段观察），runClose 的 await 只是排空屏障。
 * 【新手阅读建议】先看 Domain/KvTable 接口掌握对外能力，再看 DomainImpl 的写链
 * （enqueue/runClose）理解并发与关闭语义，最后看 KvTableImpl 理解表读写如何落到后端。
 * ==========================================================================
 */
/**
 * Runtime of one open domain: authoritative in-memory state, the single
 * per-domain write chain, and change-event emission. Reads are synchronous
 * from memory; every write queues on the chain, awaits backend durability
 * FIRST, then mutates memory, then emits `domain/changed` — a rejected
 * backend write leaves memory untouched (no divergence between reads and the
 * medium), and events carry values that equal the in-memory state at
 * emission, in write order.
 * @module @deepseek-ai/dsh-storage-domain/src/domain
 */
/*
 * 模块总览：领域层的"运行时"全部在本文件。上层的 DomainFacility（见 index.ts）
 * 负责打开领域并做类型擦除，真正的读写、关闭、事件发出逻辑都在这里。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import { DomainError } from './error.ts'
import type { DomainSpec, DomainGlobalSpec, TableKeyOf, TableValueOf } from './spec.ts'
import type { DomainChanged } from './events.ts'

/** Handle on a domain's global singleton. */
/*
 * 全局单例的对外句柄：get 同步返回当前值，set 排入写链持久化写入。
 */
export interface DomainGlobal<G> {
  /**
   * Current value, synchronously from the authoritative in-memory state.
   * Before the first `set` this is the spec's `initial`.
   * @returns the current global value.
   */
  /*
   * 同步返回当前全局值（来自权威内存态）。第一次 set 之前返回 spec 的 initial。
   * @returns 当前全局值。
   */
  get(): G

  /**
   * Replace the value durably. Queued on the domain's write chain; the first
   * `set` is what materializes the global on the medium.
   * @param value - New value; must satisfy the spec's schema (not re-checked
   * here — validation happens at the durable read boundary).
   * @returns resolution after durability and event emission.
   */
  /*
   * 持久化替换全局值。排入领域写链；第一次 set 才会真正把 global 写到介质上。
   * 注意：本方法不重新校验 schema（校验发生在持久化读边界，即打开介质时）。
   * @param value 新值；必须满足 spec 的 schema。
   * @returns 持久化与事件发出完成后解析。
   */
  set(value: G): Promise<void>
}

/**
 * Handle on one declared table. Records are plain immutable data: returned
 * values are the stored objects themselves (no defensive copies) and must not
 * be mutated in place — replace via `put`/`update`.
 */
/*
 * 单张已声明表的对外句柄。记录是不可变数据：get 返回的是存储对象本身（无防御性拷贝），
 * 调用方绝不能就地修改，必须用 put/update 整体替换。
 */
export interface KvTable<K extends string, V> {
  /**
   * Read one record, synchronously from memory.
   * @param key - Record key.
   * @returns the record, or `undefined` when absent.
   */
  /*
   * 同步读一条记录（来自内存）。
   * @param key 记录键。
   * @returns 记录值；不存在时返回 undefined。
   */
  get(key: K): V | undefined

  /**
   * Snapshot iterator over `[key, record]` pairs. A snapshot, not a live
   * view: iteration stays stable while queued writes land.
   * @returns the pair iterator.
   */
  /*
   * 遍历 [键, 记录] 对的快照迭代器。是"快照"而非"实时视图"：迭代过程中即使有
   * 排队的写入落地，本次迭代内容也保持稳定。
   * @returns 键值对迭代器。
   */
  entries(): IterableIterator<[K, V]>

  /**
   * Snapshot iterator over keys.
   * @returns the key iterator.
   */
  /*
   * 遍历键的快照迭代器。
   * @returns 键迭代器。
   */
  keys(): IterableIterator<K>

  /** Current record count. */
  /* 当前记录条数。 */
  readonly size: number

  /**
   * Insert or overwrite one record durably.
   * @param key - Record key.
   * @param value - The full new record (no partial merge).
   * @returns resolution after durability and event emission.
   */
  /*
   * 持久化插入或覆盖一条记录。
   * @param key 记录键。
   * @param value 完整的新记录（不做部分合并）。
   * @returns 持久化与事件发出完成后解析。
   */
  put(key: K, value: V): Promise<void>

  /**
   * Delete one record durably.
   * @param key - Record key.
   * @returns `true` when the record existed, `false` when it was already
   * absent (no write and no event in that case).
   */
  /*
   * 持久化删除一条记录。
   * @param key 记录键。
   * @returns 记录原本存在返回 true；本来就不存在返回 false（此时无写入、无事件）。
   */
  delete(key: K): Promise<boolean>

  /**
   * Atomic read-modify-write on the domain's write chain: `fn` sees the
   * value current at its queue slot, so concurrent updates never interleave.
   * @param key - Record key; a missing key rejects with `missing-key`.
   * @param fn - Synchronous pure transform from current to next record.
   * @returns the stored next record.
   */
  /*
   * 在领域写链上做"原子读-改-写"：fn 看到的是它排队位置上的最新值，
   * 因此并发更新不会互相交错。键不存在时以 missing-key 拒绝。
   * @param key 记录键。
   * @param fn 同步纯函数，把当前记录变换为下一条记录。
   * @returns 落库后的下一条记录。
   */
  update(key: K, fn: (current: V) => V): Promise<V>
}

/** Global handle of a spec: typed when declared, `never` (inaccessible) when not. */
/*
 * 按 spec 推导出的全局句柄类型：声明了 global 才有可用句柄，否则为 never（不可访问，
 * 编译期就能拦住错误用法）。
 */
export type DomainGlobalHandleOf<S extends DomainSpec> =
  S extends { readonly global: DomainGlobalSpec<infer G> } ? DomainGlobal<G> : never

/** One open domain, typed by its spec. */
/*
 * 一个已打开领域对外的接口，由 spec 提供完整类型。
 */
export interface Domain<S extends DomainSpec> {
  /** Domain name from the spec. */
  /* 领域名（来自 spec）。 */
  readonly name: string
  /** Global singleton handle; a spec without `global` has no usable handle (`never`). */
  /* 全局单例句柄；spec 没有 global 时不可用（类型为 never）。 */
  readonly global: DomainGlobalHandleOf<S>
  /**
   * Resolve one declared table handle. Handles are stable — repeated calls
   * return the same instance.
   * @param name - Declared table name.
   * @returns the typed table handle.
   */
  /*
   * 解析一张已声明表的句柄。句柄稳定：重复调用返回同一个实例。
   * @param name 已声明的表名。
   * @returns 带类型的表句柄。
   */
  table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S, N>, TableValueOf<S, N>>

  /**
   * Close this domain: reject new writes immediately, drain already-queued
   * writes (their events still emit), release the backend unit, then free
   * the domain name for a later open. Idempotent — repeated calls share one
   * teardown. The consumer owns this call (typically as its own `ctx.effect`
   * disposer); the facility closes any domain left open when it unmounts.
   * @returns resolution after the unit is released.
   */
  /*
   * 关闭领域：立刻拒绝新写入，排空已排队的写入（其事件仍照常发出），释放后端单元，
   * 然后释放领域名供日后重新打开。幂等——重复调用共享同一次拆卸。
   * 关闭由调用方负责（通常作为自己 ctx.effect 的注销函数）；facility 卸载时会关闭
   * 任何遗留未关的领域。
   * @returns 单元释放完成后解析。
   */
  close(): Promise<void>
}

/** Internal boundary handing table handles their domain-owned write machinery. */
/*
 * 表句柄与"领域持有的写机制"之间的内部桥接接口：把表操作翻译成对领域写链的调用。
 */
interface TableHost {
  readonly domainName: string
  readonly unit: KvUnit
  /** Queue one job on the domain's single write chain. */
  /* 把一个任务排到领域的唯一写链上。 */
  enqueue<T>(job: () => Promise<T>): Promise<T>
  /** Throw `closed` once the domain has fully closed (reads stay valid while draining). */
  /* 领域完全关闭后抛 closed（排空期间读仍有效）。 */
  assertReadable(): void
  /** Emit `domain/changed` for one durably landed write. */
  /* 为一次已持久化的写入发出 domain/changed 事件。 */
  emitChanged(change: DomainChanged): void
}

// 空函数：用于"消音"写链尾部，吞掉每个链环节的 rejection（拒绝由调用方链段观察）。
const noop = () => {}

/**
 * The single domain implementation behind the {@link Domain} interface. The
 * facility constructs it from a validated `loadAll` snapshot and erases it to
 * `Domain<S>`; nothing outside this package constructs one.
 */
/*
 * Domain 接口背后的唯一实现。facility（index.ts 的 DomainFacility）从已校验的
 * loadAll 快照构造它，再擦除成 Domain<S> 类型交给外部；本包之外不会有人直接构造它。
 */
export class DomainImpl {
  /** Domain name from the spec. */
  /* 领域名（来自 spec）。 */
  readonly name: string

  // 表名 → 表实现句柄 的映射；open 时按 spec 的每张表各建一个。
  private readonly tables = new Map<string, KvTableImpl<string, unknown>>()
  // 全局单例的权威内存值；仅当 spec 声明了 global 时被使用。
  private globalValue: unknown
  // 全局句柄；spec 未声明 global 时为 undefined。
  private readonly globalHandle?: DomainGlobal<unknown>

  /** Tail of the write chain; every link settles (rejections are observed by the caller's slice). */
  /* 写链的尾部：每个链环节都会 settle（拒绝由调用方那段链观察），不会让整条链悬空。 */
  private chain: Promise<void> = Promise.resolve()
  /** Set when close begins: new writes reject while already-queued writes drain. */
  /* 关闭开始后置位：新写入立即被拒，已排队的写入继续排空。 */
  private disposing = false
  /** Set when close finishes (chain drained, unit closed): reads reject from here on. */
  /* 关闭完成后置位（链已排空、单元已关闭）：此后连读也会被拒。 */
  private closed = false
  // 关闭过程的 Promise 缓存：close() 幂等就靠它——只执行一次 runClose。
  private disposal?: Promise<void>

  /**
   * @param ctx - Context that carries `domain/changed` emissions.
   * @param spec - The domain declaration.
   * @param unit - The opened backend unit; this instance owns its lifecycle.
   * @param records - Validated records from the unit's `loadAll`, one entry
   * per declared table (empty maps included) — the facility builds it from
   * the spec, so the entry set IS the table set.
   * @param globalValue - Validated stored global, or the spec's `initial`
   * when the medium held none; `undefined` when the spec declares no global.
   * @param onClosed - Facility hook run once after teardown completes; frees
   * the domain name for a later open.
   */
  /*
   * 构造领域运行时：把每张表的记录快照装进内存，并组装"表句柄 → 写链"的桥接。
   * @param ctx 承载 domain/changed 事件发出的上下文。
   * @param spec 领域声明。
   * @param unit 已打开的后端单元；本实例拥有其生命周期。
   * @param records 来自单元 loadAll 的已校验记录：每张声明表一项（空表也包含）；
   *  由 facility 按 spec 构造，所以键集合就是表集合。
   * @param globalValue 已校验的存储 global；介质中没有时用 spec 的 initial；
   *  spec 未声明 global 时为 undefined。
   * @param onClosed 拆卸完成后的钩子：释放领域名供日后重新打开。
   */
  constructor(
    private readonly ctx: Context,
    spec: DomainSpec,
    private readonly unit: KvUnit,
    records: Map<string, Map<string, unknown>>,
    globalValue: unknown,
    private readonly onClosed: () => void,
  ) {
    this.name = spec.name
    const host: TableHost = {
      domainName: spec.name,
      unit,
      enqueue: job => this.enqueue(job),
      assertReadable: () => { this.assertReadable() },
      emitChanged: (change) => { this.emitChanged(change) },
    }
    for (const [table, tableRecords] of records) {
      this.tables.set(table, new KvTableImpl(host, table, tableRecords))
    }
    if (spec.global !== undefined) {
      this.globalValue = globalValue
      this.globalHandle = {
        get: () => {
          this.assertReadable()
          return this.globalValue
        },
        set: value => this.enqueue(async () => {
          await this.unit.setGlobal(value)
          this.globalValue = value
          this.emitChanged({ domain: this.name, table: '', key: '', operation: 'put', value })
        }),
      }
    }
  }

  /** Global singleton handle; accessing it on a spec that declares no global is a caller bug and throws. */
  /* 全局单例句柄：对未声明 global 的 spec 访问它是调用方 bug，会抛错。 */
  get global(): DomainGlobal<unknown> {
    if (this.globalHandle === undefined) {
      throw new Error(`domain '${this.name}' declares no global`)
    }
    return this.globalHandle
  }

  /**
   * Resolve one declared table handle; an undeclared name is a caller bug
   * and throws.
   * @param name - Declared table name.
   * @returns the stable table handle.
   */
  /*
   * 解析一张已声明表的句柄；未声明的表名是调用方 bug，会抛错。
   * @param name 表名。
   * @returns 稳定的表句柄。
   */
  table(name: string): KvTable<string, unknown> {
    const table = this.tables.get(name)
    if (table === undefined) {
      throw new Error(`domain '${this.name}' declares no table '${name}'`)
    }
    return table
  }

  /**
   * Close this domain: reject new writes immediately, drain already-queued
   * writes (their events still emit), close the unit, then free the name via
   * the facility hook. Idempotent — repeated calls share one teardown.
   * @returns resolution after the unit is released.
   */
  /*
   * 关闭领域：立即拒新写、排空已排队写入（事件照常发出）、关闭单元，最后经钩子释放名字。
   * 幂等——重复调用共享同一次拆卸（disposal 缓存了 runClose 的 Promise）。
   * @returns 单元释放完成后解析。
   */
  close(): Promise<void> {
    this.disposal ??= this.runClose()
    return this.disposal
  }

  private async runClose(): Promise<void> {
    this.disposing = true
    // Chain links never reject (each is settled via then(noop, noop)), so
    // this await is a pure drain barrier.
    // 中文说明：链环节从不 reject（每环都经 then(noop, noop) 消音），
    // 所以这里的 await 纯粹是"排空屏障"：等所有已排队写入完成。
    await this.chain
    await this.unit.close()
    this.closed = true
    this.onClosed()
  }

  /**
   * Dispatch one post-durability change notification, containing observer
   * failures: the write is already committed (medium and memory both hold
   * the new state), so a throwing listener must not retroactively reject it.
   */
  /*
   * 分发一次"已持久化"的变更通知，并隔离观察者异常：写入此时已提交（介质与内存
   * 都已是新状态），监听器抛错不能反过来让这次写入失败。
   */
  private emitChanged(change: DomainChanged): void {
    try {
      this.ctx.emit('domain/changed', change)
    } catch (error) {
      // Swallows synchronous observer exceptions only: emit dispatches
      // listeners inline and nothing else runs in the try. The event is a
      // notification, not a transaction participant — the commit point has
      // passed, so containment (with a log) is the only correct outcome.
      // 中文说明：只吞同步观察者异常——emit 内联分发监听器，try 里没有别的东西。
      // 事件是通知而非事务参与者：提交点已过，只能就地兜住并记日志。
      this.ctx.logger.warn(`domain '${this.name}': domain/changed listener failed: ${String(error)}`)
    }
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    if (this.disposing) {
      return Promise.reject(new DomainError('closed', `domain '${this.name}' is closed`))
    }
    const result = this.chain.then(job)
    this.chain = result.then(noop, noop)
    return result
  }

  private assertReadable(): void {
    if (this.closed) {
      throw new DomainError('closed', `domain '${this.name}' is closed`)
    }
  }
}

/** Table handle bound to one in-memory record map and its domain's write chain. */
/*
 * 绑定到一张内存记录表与领域写链上的表句柄实现。所有写操作先落后端再改内存，
 * 删除/更新按"自己排队位置上的最新内存态"判断，保证与写链语义一致。
 */
class KvTableImpl<K extends string, V> implements KvTable<K, V> {
  constructor(
    private readonly host: TableHost,
    private readonly tableName: string,
    private readonly records: Map<string, unknown>,
  ) {}

  /** 同步读：先确认领域可读，再从内存表取记录。 */
  get(key: K): V | undefined {
    this.host.assertReadable()
    return this.records.get(key) as V | undefined
  }

  /** 快照遍历 [键, 记录] 对：先展开成数组再取迭代器，迭代期间写入落地不影响本次遍历。 */
  entries(): IterableIterator<[K, V]> {
    this.host.assertReadable()
    return ([...this.records.entries()] as [K, V][])[Symbol.iterator]()
  }

  /** 快照遍历键。 */
  keys(): IterableIterator<K> {
    this.host.assertReadable()
    return ([...this.records.keys()] as K[])[Symbol.iterator]()
  }

  /** 当前记录条数。 */
  get size(): number {
    this.host.assertReadable()
    return this.records.size
  }

  /** 持久化写入（插入或覆盖）：先写后端，成功后改内存并发 put 事件。 */
  put(key: K, value: V): Promise<void> {
    return this.host.enqueue(async () => {
      await this.host.unit.putRecord(this.tableName, key, value)
      this.records.set(key, value)
      this.emitPut(key, value)
    })
  }

  /** 持久化删除：以排队位置上的内存态判断是否存在；存在才写后端、删内存、发 deleted 事件。 */
  delete(key: K): Promise<boolean> {
    return this.host.enqueue(async () => {
      // Existence is decided at this job's chain slot, not at call time: an
      // earlier queued put of the same key makes this delete observe it.
      // 中文说明：是否存在以本任务排队位置上的状态为准，而不是调用时刻——
      // 前面排队的同键 put 会让这次 delete 看到该记录。
      if (!this.records.has(key)) return false
      await this.host.unit.deleteRecord(this.tableName, key)
      this.records.delete(key)
      this.host.emitChanged({
        domain: this.host.domainName,
        table: this.tableName,
        key,
        operation: 'deleted',
      })
      return true
    })
  }

  /** 原子读-改-写：键缺失抛 missing-key；fn 在排队位置看到最新值，结果落后端后更新内存并发 put 事件。 */
  update(key: K, fn: (current: V) => V): Promise<V> {
    return this.host.enqueue(async () => {
      if (!this.records.has(key)) {
        throw new DomainError(
          'missing-key',
          `domain '${this.host.domainName}' table '${this.tableName}' has no record '${key}' to update`,
        )
      }
      const next = fn(this.records.get(key) as V)
      await this.host.unit.putRecord(this.tableName, key, next)
      this.records.set(key, next)
      this.emitPut(key, next)
      return next
    })
  }

  /** 组装 put 变更事件并经 host 发出。 */
  private emitPut(key: K, value: V): void {
    this.host.emitChanged({
      domain: this.host.domainName,
      table: this.tableName,
      key,
      operation: 'put',
      value,
    })
  }
}
