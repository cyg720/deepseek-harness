/** Cursor, page, and live-tail coordination over a reconnecting Remote stream.
 * @remarks 文件说明：文件职责：实现 api/gateway 中 journal stream 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 api/gateway 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { RemoteStreamCarrierError } from './stream-client.ts'
import type {
  RemoteStream,
  RemoteStreamItem,
  RemoteStreamOptions,
} from './remote-stream.ts'

/** Transport-neutral opening snapshot or journal entry. */
export type RemoteJournalFrame<Entry, Cursor, Page> =
  | { readonly type: 'opened'; readonly cursor: Cursor; readonly page: Page }
  | { readonly type: 'entry'; readonly entry: Entry }

/** One committed journal-window update. */
export type RemoteJournalChange<Page, Entry> =
  | {
    readonly type: 'replace'
    readonly page: Page
    readonly entries: readonly Entry[]
    readonly hasMore: boolean
  }
  | {
    readonly type: 'prepend'
    readonly page: Page
    readonly entries: readonly Entry[]
    readonly hasMore: boolean
  }
  | { readonly type: 'append'; readonly entry: Entry }

type JournalStreamItem<Page, Entry, Cursor> = RemoteStreamItem<RemoteJournalFrame<Entry, Cursor, Page>>

/** Gateway capability used to create one reconnecting Remote stream. */
export interface RemoteStreamFactory {
  /**
   * Create one independently cancellable logical stream.
   * @param options - domain-owned opener and generation-end classification.
   * @returns a reconnecting single-consumer stream.
   * @remarks 中文说明：功能说明：处理 $stream 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：options（RemoteStreamOptions<Item>）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 返回值：RemoteStream<Item>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * $stream(options)，并按返回类型处理结果。
   */
  $stream<Item>(options: RemoteStreamOptions<Item>): RemoteStream<Item>
}

/** Domain publication and cursor operations for one addressed journal stream. */
export interface RemoteJournalStreamOptions<Page, Entry, Cursor> {
  /** Diagnostic stream name used in protocol failures. */
  readonly name: string
  /** Cursor representing a journal with no entries. */
  readonly emptyCursor: Cursor
  /** Read the ordered entries carried by a page. */
  readonly entries: (page: Page) => readonly Entry[]
  /** Read whether an older page exists. */
  readonly hasMore: (page: Page) => boolean
  /** Read the inclusive first durable cursor covered by one entry. */
  readonly first: (entry: Entry) => Cursor
  /** Read the inclusive final cursor, which must not precede the first. */
  readonly last: (entry: Entry) => Cursor
  /** Compare two cursors. */
  readonly compare: (left: Cursor, right: Cursor) => number
  /** Test whether the right cursor immediately follows the left cursor. */
  readonly follows: (left: Cursor, right: Cursor) => boolean
  /** Apply one complete journal-window change. */
  readonly publish: (change: RemoteJournalChange<Page, Entry>) => void
  /** Observe a retryable carrier loss before reconnection. */
  readonly carrierFailed?: (error: RemoteStreamCarrierError) => void
  /** Publish a terminal stream, page, or protocol failure after opening. */
  readonly failed: (error: unknown) => void
}

/**
 * Owns snapshot-first opening, ordered live delivery, pagination, and repair.
 *
 * The domain retains its published window during reconnection. A replacement is
 * published only after the opening page reaches the generation's cursor.
 * @remarks 中文说明：类说明：RemoteJournalStream 用于集中封装 处理 RemoteJournalStream
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/gateway
 * 在对应插件或业务生命周期内创建和调用。
 */
export abstract class RemoteJournalStream<Page, Entry, Cursor, PageRequest = void> {
  /**
   * 常量说明：stream 用于处理 stream 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly stream: RemoteStream<RemoteJournalFrame<Entry, Cursor, Page>>
  /**
   * 变量说明：initialRequest 用于处理 initialRequest 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private initialRequest!: PageRequest
  /**
   * 变量说明：resumeCursor 用于处理 resumeCursor 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private resumeCursor: Cursor | undefined
  /**
   * 变量说明：hasResumeCursor 用于判断是否包含 Resume Cursor 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private hasResumeCursor = false
  /**
   * 变量说明：generation 用于处理 generation 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private generation = 0
  /**
   * 变量说明：firstCursor 用于处理 firstCursor 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private firstCursor: Cursor | undefined
  /**
   * 变量说明：lastCursor 用于处理 lastCursor 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private lastCursor: Cursor | undefined
  /**
   * 变量说明：started 用于处理 started 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private started = false
  /**
   * 变量说明：opened 用于处理 opened 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private opened = false
  /**
   * 变量说明：disposed 用于处理 disposed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private disposed = false
  /**
   * 变量说明：done 用于处理 done 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private done: Promise<void> | undefined
  /**
   * 变量说明：closing 用于处理 closing 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closing: Promise<void> | undefined
  /**
   * 变量说明：pendingNext 用于处理 pendingNext 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private pendingNext: Promise<IteratorResult<JournalStreamItem<Page, Entry, Cursor>>> | undefined

  /**
   * @param remote - Gateway factory for the reconnecting physical-generation stream.
   * @param options - cursor algebra and domain publication sinks.
   * @remarks 中文说明：功能说明：处理 RemoteJournalStream 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：remote（RemoteStreamFactory）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（RemoteJournalStreamOptions<Page, Entry,
   * Cursor>）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：当前类实例；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：通过 new RemoteJournalStream(remote, options) 创建实例，
   * 并在所属生命周期内使用。
   */
  protected constructor(
    remote: RemoteStreamFactory,
    private readonly options: RemoteJournalStreamOptions<Page, Entry, Cursor>,
  ) {
    this.stream = remote.$stream<RemoteJournalFrame<Entry, Cursor, Page>>({
      name: options.name,
      open: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
 */ signal => this.follow(this.initialRequest, signal),
      ended: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：accepted（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(accepted)，并按返回类型处理结果。
 */ accepted => accepted
        ? new RemoteStreamCarrierError(`${options.name} ended without a terminal result`)
        : new Error(
          `${this.hasResumeCursor ? 'resumed ' : ''}${options.name} ended before its opening cursor`,
        ),
      ...(options.carrierFailed === undefined
        ? {}
        : { carrierFailed: options.carrierFailed }),
    })
  }

  /**
   * Open one physical journal generation with a complete current snapshot.
   * @param request - opening-window request retained for later repair.
   * @param signal - cancellation lifetime of the physical generation.
   * @returns opening cursor followed by live entries.
   * @remarks 中文说明：功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（PageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：AsyncIterable<RemoteJournalFrame<Entry, Cursor, Page>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 follow(request, signal)，并按返回类型处理结果。
   */
  protected abstract follow(
    request: PageRequest,
    signal: AbortSignal,
  ): AsyncIterable<RemoteJournalFrame<Entry, Cursor, Page>>

  /**
   * Read one journal page through the addressed domain source.
   * @param request - domain page request.
   * @param through - inclusive journal cursor that fixes the source read.
   * @param signal - cancellation lifetime shared with the logical stream.
   * @returns the requested page, whose tail equals `through` unless the domain request selects older entries.
   * @remarks 中文说明：功能说明：读取 Page 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（PageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 参数说明：through（Cursor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：Promise<Page>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 readPage(request,
   * through, signal)，并按返回类型处理结果。
   */
  protected abstract readPage(request: PageRequest, through: Cursor, signal: AbortSignal): Promise<Page>

  /**
   * Derive an unbounded-tail request from the initial page request.
   * @param initial - request used to open the journal window.
   * @returns request suitable for reconnect and gap repair.
   * @remarks 中文说明：功能说明：处理 repairRequest 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：initial（PageRequest）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：PageRequest；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 repairRequest(initial)，
   * 并按返回类型处理结果。
   */
  protected abstract repairRequest(initial: PageRequest): PageRequest

  /** Cancellation lifetime shared by follow and page calls.
   * @remarks 中文说明：功能说明：处理 signal 相关流程；使用场景由所在模块及调用位置决定。；返回值：AbortSignal；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 signal()，并按返回类型处理结果。 */
  get signal(): AbortSignal {
    return this.stream.signal
  }

  /**
   * Establish follow and publish the opening snapshot carried by its first frame.
   * @param request - initial tail-page request.
   * @returns after the first complete window is published.
   * @remarks 中文说明：功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（PageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * open(request)，并按返回类型处理结果。
   */
  async open(request: PageRequest): Promise<void> {
    if (this.started) throw new Error(`${this.options.name} already opened`)
    this.started = true
    this.initialRequest = request
    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = this.stream[Symbol.asyncIterator]()
    try {
      /**
       * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const first = await this.takeNext(iterator)
      if (first.done) throw new Error(`${this.options.name} ended before its opening cursor`)
      this.replaceGeneration(first.value, false)
      this.opened = true
      this.done = this.consume(iterator)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      await this.stream.dispose()
      throw error
    }
  }

  /**
   * Read and prepend one older page after a successful open.
   * @param request - domain page request bound to this stream's address.
   * @returns after the page is applied or rejected as discontinuous.
   * @remarks 中文说明：功能说明：处理 prepend 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（PageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * prepend(request)，并按返回类型处理结果。
   */
  async prepend(request: PageRequest): Promise<void> {
    if (!this.opened || this.disposed) throw new Error(`${this.options.name} is not open`)
    /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const page = await this.readPage(request, this.currentCursor(), this.stream.signal)
    this.stream.signal.throwIfAborted()
    /**
     * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entries = this.options.entries(page)
    this.assertPage(entries)
    /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const before = this.firstCursor
    /**
     * 常量说明：accepted 用于处理 accepted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const accepted = before === undefined
      ? [...entries]
      : entries.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => this.options.compare(this.options.first(entry), before) < 0)
    /**
     * 常量说明：tail 用于处理 tail 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tail = accepted.at(-1)
    if (tail !== undefined && before !== undefined
      && !this.options.follows(this.options.last(tail), before)) {
      this.options.publish({ type: 'prepend', page, entries: [], hasMore: false })
      throw new Error(`${this.options.name} history page is discontinuous`)
    }
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = accepted[0]
    if (first !== undefined) this.firstCursor = this.options.first(first)
    this.options.publish({
      type: 'prepend',
      page,
      entries: accepted,
      hasMore: this.options.hasMore(page),
    })
  }

  /** Replace the active physical generation while retaining the published window.
   * @remarks 中文说明：功能说明：处理 restart 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 restart()，并按返回类型处理结果。 */
  restart(): void {
    this.stream.restart()
  }

  /**
   * Permanently stop follow, page requests, and the background consumer.
   * @returns when no stream work or publication callback can still run.
   * @remarks 中文说明：功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 dispose()，并按返回类型处理结果。
   */
  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.disposed = true
    /**
     * 常量说明：done 用于处理 done 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const done = this.done
    /**
     * 常量说明：closing 用于处理 closing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const closing = (/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        await this.stream.dispose()
        await done
      })()
    this.closing = closing
    return closing
  }

  /**
   * 功能说明：处理 consume 相关流程；使用场景由所在模块及调用位置决定。
   * @param iterator （AsyncIterator<JournalStreamItem<Page, Entry,
   * Cursor>>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 consume(iterator)，并按返回类型处理结果。
   */
  private async consume(
    iterator: AsyncIterator<JournalStreamItem<Page, Entry, Cursor>>,
  ): Promise<void> {
    try {
      while (true) {
        /**
         * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const next = await this.takeNext(iterator)
        if (next.done) return
        /**
         * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const item = next.value
        if (item.generation !== this.generation) {
          this.replaceGeneration(item, true)
          continue
        }
        if (item.value.type === 'opened') {
          throw new Error(`${this.options.name} emitted more than one opening cursor`)
        }
        await this.acceptEntry(item.value.entry, item, iterator)
      }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      if (!this.disposed) this.options.failed(error)
    }
  }

  /**
   * 功能说明：处理 replaceGeneration 相关流程；使用场景由所在模块及调用位置决定。
   * @param initial （JournalStreamItem<Page, Entry, Cursor>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param resumed （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 replaceGeneration(initial, resumed)，并按返回类型处理结果。
   */
  private replaceGeneration(
    initial: JournalStreamItem<Page, Entry, Cursor>,
    resumed: boolean,
  ): void {
    /**
     * 常量说明：opening 用于处理 opening 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const opening = this.opening(initial, resumed)
    this.replaceFromOpening(opening.page, opening.cursor)
  }

  /**
   * 功能说明：处理 opening 相关流程；使用场景由所在模块及调用位置决定。
   * @param item （RemoteStreamItem<RemoteJournalFrame<Entry, Cursor,
   * Page>>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param resumed （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns { readonly cursor: Cursor; readonly page: Page }；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 opening(item, resumed)，并按返回类型处理结果。
   */
  private opening(
    item: RemoteStreamItem<RemoteJournalFrame<Entry, Cursor, Page>>,
    resumed: boolean,
  ): { readonly cursor: Cursor; readonly page: Page } {
    if (item.value.type !== 'opened') {
      throw new Error(`${resumed ? 'resumed ' : ''}${this.options.name} emitted an entry before its opening cursor`)
    }
    /**
     * 常量说明：cursor 用于处理 cursor 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cursor = item.value.cursor
    if (resumed && this.lastCursor !== undefined
      && this.options.compare(cursor, this.lastCursor) < 0) {
      throw new Error(
        `${this.options.name} resumed at a cursor behind the last applied entry`,
      )
    }
    this.generation = item.generation
    item.accept()
    return { cursor, page: item.value.page }
  }

  /** Publish a generation's opening page without issuing a second Remote call.
   * @remarks 中文说明：功能说明：处理 replaceFromOpening 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：page（Page）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：cursor（Cursor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 replaceFromOpening(page, cursor)，
   * 并按返回类型处理结果。 */
  private replaceFromOpening(page: Page, cursor: Cursor): void {
    this.assertPageThrough(page, cursor)
    /**
     * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entries = [...this.options.entries(page)]
    this.assertPage(entries)
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = entries[0]
    this.firstCursor = first === undefined ? undefined : this.options.first(first)
    this.lastCursor = cursor
    this.setResumeCursor(cursor)
    this.options.publish({
      type: 'replace',
      page,
      entries,
      hasMore: this.options.hasMore(page),
    })
  }

  /**
   * 功能说明：处理 acceptEntry 相关流程；使用场景由所在模块及调用位置决定。
   * @param entry （Entry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param item （JournalStreamItem<Page, Entry, Cursor>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param iterator （AsyncIterator<JournalStreamItem<Page, Entry,
   * Cursor>>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 acceptEntry(entry, item, iterator)，并按返回类型处理结果。
   */
  private async acceptEntry(
    entry: Entry,
    item: JournalStreamItem<Page, Entry, Cursor>,
    iterator: AsyncIterator<JournalStreamItem<Page, Entry, Cursor>>,
  ): Promise<void> {
    /**
     * 常量说明：first、cursor 用于处理 first、cursor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { first, last: cursor } = this.entryRange(entry)
    /**
     * 常量说明：last 用于处理 last 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const last = this.lastCursor as Cursor
    if (this.options.compare(cursor, last) <= 0) return
    if (this.options.compare(first, last) <= 0) {
      throw new Error(`${this.options.name} emitted a partially overlapping entry`)
    }
    if (!this.options.follows(last, first)) {
      /**
       * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const request = this.repairPageRequest()
      /**
       * 常量说明：superseded 用于处理 superseded 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const superseded = await this.replaceThrough(
        request,
        cursor,
        item.generation,
        item.signal,
        iterator,
        [entry],
      )
      if (superseded !== undefined) {
        this.replaceGeneration(superseded, true)
      }
      return
    }
    if (this.firstCursor === undefined) this.firstCursor = first
    this.lastCursor = cursor
    this.setResumeCursor(cursor)
    this.options.publish({ type: 'append', entry })
  }

  /**
   * 功能说明：处理 replaceThrough 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （PageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param requiredCursor （Cursor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param generation （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @param iterator （AsyncIterator<JournalStreamItem<Page, Entry,
   * Cursor>>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param queued （Entry[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<JournalStreamItem<Page, Entry, Cursor> | undefined>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 replaceThrough(request, requiredCursor, generation,
   * signal, iterator, queued)，并按返回类型处理结果。
   */
  private async replaceThrough(
    request: PageRequest,
    requiredCursor: Cursor,
    generation: number,
    signal: AbortSignal,
    iterator: AsyncIterator<JournalStreamItem<Page, Entry, Cursor>>,
    queued: Entry[],
  ): Promise<JournalStreamItem<Page, Entry, Cursor> | undefined> {
    /**
     * 变量说明：read 用于读取 read 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let read = await this.readPageWhileFollowing(
      request,
      requiredCursor,
      generation,
      signal,
      iterator,
      queued,
    )
    if (read.type === 'superseded') return read.item
    /**
     * 变量说明：page 用于处理 page 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let page = read.page
    this.assertPageThrough(page, requiredCursor)
    /**
     * 变量说明：entries 用于处理 entries 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let entries = this.mergeReplacement(page, queued)
    /**
     * 变量说明：target 用于处理 target 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let target = this.maxCursor(requiredCursor, queued)
    if (entries === undefined || this.options.compare(this.tailCursor(entries), target) < 0) {
      read = await this.readPageWhileFollowing(
        this.repairPageRequest(),
        target,
        generation,
        signal,
        iterator,
        queued,
      )
      if (read.type === 'superseded') return read.item
      page = read.page
      this.assertPageThrough(page, target)
      entries = this.mergeReplacement(page, queued)
      target = this.maxCursor(requiredCursor, queued)
    }
    if (entries === undefined || this.options.compare(this.tailCursor(entries), target) < 0) {
      throw new Error(`${this.options.name} page did not reach its opening cursor`)
    }
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = entries[0]
    /* v8 ignore next -- a successful positive-cursor replacement page cannot be empty. */
    this.firstCursor = first === undefined ? undefined : this.options.first(first)
    this.lastCursor = this.tailCursor(entries)
    this.setResumeCursor(this.lastCursor)
    this.options.publish({
      type: 'replace',
      page,
      entries,
      hasMore: this.options.hasMore(page),
    })
    return undefined
  }

  /**
   * 功能说明：读取 Page While Following 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （PageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param through （Cursor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param generation （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @param iterator （AsyncIterator<JournalStreamItem<Page, Entry,
   * Cursor>>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param queued （Entry[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise< | { readonly type: 'page'; readonly page: Page } | {
   * readonl…；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 readPageWhileFollowing(request, through, generation,
   * signal, iterator, queued)，并按返回类型处理结果。
   */
  private async readPageWhileFollowing(
    request: PageRequest,
    through: Cursor,
    generation: number,
    signal: AbortSignal,
    iterator: AsyncIterator<JournalStreamItem<Page, Entry, Cursor>>,
    queued: Entry[],
  ): Promise<
    | { readonly type: 'page'; readonly page: Page }
    | { readonly type: 'superseded'; readonly item: JournalStreamItem<Page, Entry, Cursor> }
  > {
    /**
     * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const page = this.readPage(request, through, signal).then(
      /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
       */ value => ({ type: 'page' as const, value }),
      /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
       * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
       */ (error: unknown) => ({ type: 'page-error' as const, error }),
    )
    while (true) {
      /**
       * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const pending = this.nextResult(iterator)
      /**
       * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const next = pending.then(
        /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
         */ value => ({ type: 'next' as const, value }),
        /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
         * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
         * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
         */ (error: unknown) => ({ type: 'next-error' as const, error }),
      )
      /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const result = await Promise.race([page, next])
      if (result.type === 'page') {
        signal.throwIfAborted()
        return { type: 'page', page: result.value }
      }
      if (result.type === 'page-error') {
        if (!signal.aborted || this.stream.signal.aborted) throw result.error
        return this.awaitReplacementGeneration(generation, iterator, pending)
      }
      this.releaseNext()
      if (result.type === 'next-error') throw result.error
      if (result.value.done) {
        signal.throwIfAborted()
        throw new Error(`${this.options.name} ended while reading its replacement page`)
      }
      /**
       * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const item = result.value.value
      if (item.generation !== generation) return { type: 'superseded', item }
      if (item.value.type === 'opened') {
        throw new Error(`${this.options.name} emitted more than one opening cursor`)
      }
      queued.push(item.value.entry)
    }
  }

  /**
   * 功能说明：处理 awaitReplacementGeneration 相关流程；使用场景由所在模块及调用位置决定。
   * @param generation （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param iterator （AsyncIterator<JournalStreamItem<Page, Entry,
   * Cursor>>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param initial （Promise<IteratorResult<JournalStreamItem<Page, Entry,
   * Curso…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<{ readonly type: 'superseded'; readonly item:
   * JournalStreamIt…；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 awaitReplacementGeneration(generation, iterator,
   * initial)，并按返回类型处理结果。
   */
  private async awaitReplacementGeneration(
    generation: number,
    iterator: AsyncIterator<JournalStreamItem<Page, Entry, Cursor>>,
    initial: Promise<IteratorResult<JournalStreamItem<Page, Entry, Cursor>>>,
  ): Promise<{ readonly type: 'superseded'; readonly item: JournalStreamItem<Page, Entry, Cursor> }> {
    /**
     * 变量说明：pending 用于处理 pending 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let pending = initial
    while (true) {
      /**
       * 变量说明：next 用于处理 next 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let next: IteratorResult<JournalStreamItem<Page, Entry, Cursor>>
      try {
        next = await pending
      } finally {
        this.releaseNext()
      }
      if (next.done) {
        this.stream.signal.throwIfAborted()
        throw new Error(`${this.options.name} ended while replacing an aborted page generation`)
      }
      /**
       * 常量说明：item 用于处理 item 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const item = next.value
      if (item.generation !== generation) return { type: 'superseded', item }
      if (item.value.type === 'opened') {
        throw new Error(`${this.options.name} emitted more than one opening cursor`)
      }
      pending = this.nextResult(iterator)
    }
  }

  /**
   * 功能说明：处理 mergeReplacement 相关流程；使用场景由所在模块及调用位置决定。
   * @param page （Page）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param queued （readonly Entry[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Entry[] | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 mergeReplacement(page, queued)，并按返回类型处理结果。
   */
  private mergeReplacement(page: Page, queued: readonly Entry[]): Entry[] | undefined {
    /**
     * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entries = [...this.options.entries(page)]
    this.assertPage(entries)
    for (const /*
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ entry of queued) this.entryRange(entry)
    /**
     * 常量说明：sorted 用于处理 sorted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sorted = [...queued].sort(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
 */ (left, right) => (
        this.options.compare(this.options.first(left), this.options.first(right))
      ))
    /**
     * 变量说明：tail 用于处理 tail 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let tail = this.tailCursor(entries)
    for (const /*
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ entry of sorted) {
      /**
       * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const first = this.options.first(entry)
      /**
       * 常量说明：last 用于处理 last 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const last = this.options.last(entry)
      if (this.options.compare(last, tail) <= 0) continue
      if (this.options.compare(first, tail) <= 0) {
        throw new Error(`${this.options.name} replacement contains a partially overlapping entry`)
      }
      if (!this.options.follows(tail, first)) return undefined
      entries.push(entry)
      tail = last
    }
    return entries
  }

  /**
   * 功能说明：处理 maxCursor 相关流程；使用场景由所在模块及调用位置决定。
   * @param cursor （Cursor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param entries （readonly Entry[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Cursor；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 maxCursor(cursor, entries)，并按返回类型处理结果。
   */
  private maxCursor(cursor: Cursor, entries: readonly Entry[]): Cursor {
    /**
     * 变量说明：result 用于处理 result 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let result = cursor
    for (const /*
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ entry of entries) {
      /**
       * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const candidate = this.options.last(entry)
      if (this.options.compare(candidate, result) > 0) result = candidate
    }
    return result
  }

  /**
   * 功能说明：处理 nextResult 相关流程；使用场景由所在模块及调用位置决定。
   * @param iterator （AsyncIterator<JournalStreamItem<Page, Entry,
   * Cursor>>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<IteratorResult<JournalStreamItem<Page, Entry, Cursor>>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 nextResult(iterator)，并按返回类型处理结果。
   */
  private nextResult(
    iterator: AsyncIterator<JournalStreamItem<Page, Entry, Cursor>>,
  ): Promise<IteratorResult<JournalStreamItem<Page, Entry, Cursor>>> {
    this.pendingNext ??= iterator.next()
    return this.pendingNext
  }

  /**
   * 功能说明：处理 takeNext 相关流程；使用场景由所在模块及调用位置决定。
   * @param iterator （AsyncIterator<JournalStreamItem<Page, Entry,
   * Cursor>>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<IteratorResult<JournalStreamItem<Page, Entry, Cursor>>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 takeNext(iterator)，并按返回类型处理结果。
   */
  private async takeNext(
    iterator: AsyncIterator<JournalStreamItem<Page, Entry, Cursor>>,
  ): Promise<IteratorResult<JournalStreamItem<Page, Entry, Cursor>>> {
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = this.nextResult(iterator)
    try {
      return await pending
    } finally {
      this.releaseNext()
    }
  }

  /**
   * 功能说明：处理 releaseNext 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 releaseNext()，并按返回类型处理结果。
   */
  private releaseNext(): void {
    this.pendingNext = undefined
  }

  /**
   * 功能说明：处理 repairPageRequest 相关流程；使用场景由所在模块及调用位置决定。
   * @returns PageRequest；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 repairPageRequest()，并按返回类型处理结果。
   */
  private repairPageRequest(): PageRequest {
    return this.repairRequest(this.initialRequest)
  }

  /**
   * 功能说明：设置 Resume Cursor 相关流程；使用场景由所在模块及调用位置决定。
   * @param cursor （Cursor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 setResumeCursor(cursor)，并按返回类型处理结果。
   */
  private setResumeCursor(cursor: Cursor): void {
    this.resumeCursor = cursor
    this.hasResumeCursor = true
  }

  /**
   * 功能说明：处理 currentCursor 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Cursor；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 currentCursor()，并按返回类型处理结果。
   */
  private currentCursor(): Cursor {
    return this.resumeCursor as Cursor
  }

  /**
   * 功能说明：处理 tailCursor 相关流程；使用场景由所在模块及调用位置决定。
   * @param entries （readonly Entry[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Cursor；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 tailCursor(entries)，并按返回类型处理结果。
   */
  private tailCursor(entries: readonly Entry[]): Cursor {
    /**
     * 常量说明：tail 用于处理 tail 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tail = entries.at(-1)
    return tail === undefined ? this.options.emptyCursor : this.options.last(tail)
  }

  /**
   * 功能说明：断言 Page 相关流程；使用场景由所在模块及调用位置决定。
   * @param entries （readonly Entry[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 assertPage(entries)，并按返回类型处理结果。
   */
  private assertPage(entries: readonly Entry[]): void {
    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = entries[Symbol.iterator]()
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = iterator.next()
    if (first.done) return
    /**
     * 变量说明：previousRange 用于处理 previousRange 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let previousRange = this.entryRange(first.value)
    for (const /*
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ entry of iterator) {
      /**
       * 常量说明：range 用于处理 range 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const range = this.entryRange(entry)
      if (!this.options.follows(previousRange.last, range.first)) {
        throw new Error(`${this.options.name} page contains discontinuous entries`)
      }
      previousRange = range
    }
  }

  /**
   * 功能说明：处理 entryRange 相关流程；使用场景由所在模块及调用位置决定。
   * @param entry （Entry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns { readonly first: Cursor; readonly last: Cursor }；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 entryRange(entry)，并按返回类型处理结果。
   */
  private entryRange(entry: Entry): { readonly first: Cursor; readonly last: Cursor } {
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = this.options.first(entry)
    /**
     * 常量说明：last 用于处理 last 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const last = this.options.last(entry)
    if (this.options.compare(first, last) > 0) {
      throw new Error(`${this.options.name} entry has an inverted cursor range`)
    }
    return { first, last }
  }

  /**
   * 功能说明：断言 Page Through 相关流程；使用场景由所在模块及调用位置决定。
   * @param page （Page）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param through （Cursor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 assertPageThrough(page, through)，并按返回类型处理结果。
   */
  private assertPageThrough(page: Page, through: Cursor): void {
    /**
     * 常量说明：tail 用于处理 tail 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tail = this.tailCursor(this.options.entries(page))
    if (this.options.compare(tail, through) !== 0) {
      throw new Error(`${this.options.name} page did not end at its requested cursor`)
    }
  }
}
