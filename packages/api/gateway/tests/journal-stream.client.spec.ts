/**
 * 文件职责：验证 api/gateway 中 journal stream client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  RemoteJournalStream,
  RemoteStream,
  RemoteStreamCarrierError,
  type RemoteJournalChange,
  type RemoteJournalFrame,
  type RemoteStreamFactory,
  type RemoteStreamItem,
  type RemoteStreamOptions,
} from '../src/client/index.ts'

interface Entry {
  readonly seq: number
  readonly lastSeq?: number
}

interface Page {
  readonly entries: readonly Entry[]
  readonly hasMore: boolean
  readonly marker: string
}

interface PageRequest {
  readonly before?: number
  readonly limit?: number
}

type JournalFrame = RemoteJournalFrame<Entry, number, Page, string>
type ScriptedFrame = JournalFrame

interface Generation {
  readonly frames: readonly (
    ScriptedFrame | Promise<ScriptedFrame>
  )[]
  readonly terminal?: Error
  readonly hold?: boolean
  readonly waitAfterFrames?: Promise<void>
  readonly afterFrame?: (index: number) => void
}

type PageSource = Page | Promise<Page> | ((signal: AbortSignal) => Promise<Page>)

/**
 * 常量说明：AVAILABLE_CONNECTION 用于处理 AVAILABLE_CONNECTION 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const AVAILABLE_CONNECTION = {
  generation: {
    getSnapshot: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ id: 1, host: { home: '/home/fixture' } }),
    subscribe: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {},
  },
}

/**
 * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 entries 相关流程；使用场景由所在模块及调用位置决定。
 * @param seqs （number[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Entry[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 entries(seqs)，并按返回类型处理结果。
 */
const entries = (...seqs: number[]): Entry[] => seqs.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：seq（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(seq)，并按返回类型处理结果。
 */ seq => ({ seq }))

/**
 * 常量说明：rangedEntry 用于处理 rangedEntry 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 rangedEntry 相关流程；使用场景由所在模块及调用位置决定。
 * @param first （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param last （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Entry；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rangedEntry(first, last)，并按返回类型处理结果。
 */
const rangedEntry = (first: number, last: number): Entry => ({ seq: first, lastSeq: last })

/**
 * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 page 相关流程；使用场景由所在模块及调用位置决定。
 * @param marker （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param seqs （number[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param hasMore （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Page；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 page(marker, seqs, hasMore)，并按返回类型处理结果。
 */
const page = (marker: string, seqs: number[], hasMore = false): Page => ({
  entries: entries(...seqs),
  hasMore,
  marker,
})

/**
 * 常量说明：rangedPage 用于处理 rangedPage 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 rangedPage 相关流程；使用场景由所在模块及调用位置决定。
 * @param marker （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param values （Entry[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param hasMore （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Page；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rangedPage(marker, values, hasMore)，并按返回类型处理结果。
 */
const rangedPage = (marker: string, values: Entry[], hasMore = false): Page => ({
  entries: values,
  hasMore,
  marker,
})

/**
 * 常量说明：STREAM_FACTORY 用于处理 STREAM_FACTORY 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const STREAM_FACTORY = {
  /**
   * 功能说明：处理 $stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （RemoteStreamOptions<Item>）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @returns RemoteStream<Item>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 $stream(options)，并按返回类型处理结果。
   */
  $stream<Item>(options: RemoteStreamOptions<Item>): RemoteStream<Item> {
    return new RemoteStream(AVAILABLE_CONNECTION, options)
  },
}

class FixtureJournal extends RemoteJournalStream<Page, Entry, number, PageRequest, string> {
  constructor(
    private readonly generations: Generation[],
    private readonly pages: PageSource[],
    private readonly calls: string[],
    private readonly pageRequests: PageRequest[],
    private readonly pageCursors: number[],
    private readonly followRequests: PageRequest[],
    changes: RemoteJournalChange<Page, Entry, string>[],
    failed: (error: unknown) => void,
    factory: RemoteStreamFactory = STREAM_FACTORY,
  ) {
    super(factory, {
      name: 'fixture journal',
      emptyCursor: -1,
      entries: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */ value => value.entries,
      hasMore: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */ value => value.hasMore,
      first: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.seq,
      last: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.lastSeq ?? entry.seq,
      compare: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
 */ (left, right) => left - right,
      follows: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
 */ (left, right) => right === left + 1,
      publish: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(change)，并按返回类型处理结果。
 */ (change) => { changes.push(change) },
      failed,
    })
  }

  /** @inheritdoc
   * @remarks 中文说明：功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（PageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：AsyncIterable<JournalFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 follow(request, signal)，并按返回类型处理结果。 */
  protected override async * follow(
    request: PageRequest,
    signal: AbortSignal,
  ): AsyncIterable<JournalFrame> {
    this.calls.push('follow')
    this.followRequests.push(request)
    /**
     * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const generation = this.generations.shift()
    if (generation === undefined) throw new Error('no scripted journal generation')
    for (const /*
     * 变量说明：index、frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ [index, frame] of generation.frames.entries()) {
      yield await frame
      generation.afterFrame?.(index)
    }
    await generation.waitAfterFrames
    if (generation.terminal !== undefined) throw generation.terminal
    if (generation.hold === true && !signal.aborted) {
      await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
          signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { resolve() }, { once: true })
        })
    }
  }

  /** @inheritdoc
   * @remarks 中文说明：功能说明：读取 Page 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（PageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 参数说明：through（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：Promise<Page>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 readPage(request,
   * through, signal)，并按返回类型处理结果。 */
  protected override readPage(
    request: PageRequest,
    through: number,
    signal: AbortSignal,
  ): Promise<Page> {
    this.calls.push('page')
    this.pageRequests.push(request)
    this.pageCursors.push(through)
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = this.pages.shift()
    if (value === undefined) throw new Error('no scripted journal page')
    return typeof value === 'function' ? value(signal) : Promise.resolve(value)
  }

  /** @inheritdoc
   * @remarks 中文说明：功能说明：处理 repairRequest 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（PageRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：PageRequest；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 repairRequest(request)，
   * 并按返回类型处理结果。 */
  protected override repairRequest(request: PageRequest): PageRequest {
    return request.limit === undefined ? {} : { limit: request.limit }
  }
}

/**
 * 功能说明：处理 journalFixture 相关流程；使用场景由所在模块及调用位置决定。
 * @param generations （Generation[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param pages （PageSource[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param factory （RemoteStreamFactory）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns { readonly journal: RemoteJournalStream<Page, Entry, number,
 * PageRequ…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 journalFixture(generations, pages, factory)，
 * 并按返回类型处理结果。
 */
function journalFixture(
  generations: Generation[],
  pages: PageSource[],
  factory: RemoteStreamFactory = STREAM_FACTORY,
): {
  readonly journal: RemoteJournalStream<Page, Entry, number, PageRequest, string>
  readonly changes: RemoteJournalChange<Page, Entry, string>[]
  readonly failed: ReturnType<typeof vi.fn>
  readonly calls: string[]
  readonly pageRequests: PageRequest[]
  readonly pageCursors: number[]
  readonly followRequests: PageRequest[]
} {
  /**
   * 常量说明：calls 用于处理 calls 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const calls: string[] = []
  /**
   * 常量说明：pageRequests 用于处理 pageRequests 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const pageRequests: PageRequest[] = []
  /**
   * 常量说明：pageCursors 用于处理 pageCursors 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const pageCursors: number[] = []
  /**
   * 常量说明：followRequests 用于处理 followRequests 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const followRequests: PageRequest[] = []
  const changes: RemoteJournalChange<Page, Entry, string>[] = []
  const failed = vi.fn()
  /**
   * 常量说明：journal 用于处理 journal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const journal = new FixtureJournal(
    generations,
    pages,
    calls,
    pageRequests,
    pageCursors,
    followRequests,
    changes,
    failed,
    factory,
  )
  return { journal, changes, failed, calls, pageRequests, pageCursors, followRequests }
}

/**
 * 功能说明：处理 opened 相关流程；使用场景由所在模块及调用位置决定。
 * @param cursor （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param value （Page）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns JournalFrame；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 opened(cursor, value)，并按返回类型处理结果。
 */
function opened(cursor: number, value: Page): JournalFrame {
  return { type: 'opened', cursor, page: value }
}

/**
 * 功能说明：处理 remoteItem 相关流程；使用场景由所在模块及调用位置决定。
 * @param generation （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param value （ScriptedFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @returns RemoteStreamItem<JournalFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 remoteItem(generation, value, signal)，并按返回类型处理结果。
 */
function remoteItem(
  generation: number,
  value: ScriptedFrame,
  signal: AbortSignal,
): RemoteStreamItem<JournalFrame> {
  return { generation, value, signal, accept: vi.fn() }
}

/**
 * 功能说明：处理 controlledFactory 相关流程；使用场景由所在模块及调用位置决定。
 * @param next （() => Promise<IteratorResult<RemoteStreamItem<JournalFrame>
 * …）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RemoteStreamFactory；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 controlledFactory(next)，并按返回类型处理结果。
 */
function controlledFactory(
  next: () => Promise<IteratorResult<RemoteStreamItem<JournalFrame>>>,
): RemoteStreamFactory {
  /**
   * 常量说明：lifetime 用于处理 lifetime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const lifetime = new AbortController()
  return {
    /**
     * 功能说明：处理 $stream 相关流程；使用场景由所在模块及调用位置决定。
     * @returns RemoteStream<Item>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 $stream()，并按返回类型处理结果。
     */
    $stream<Item>(): RemoteStream<Item> {
      /**
       * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const iterator = {
        next,
        return: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => ({ done: true as const, value: undefined }),
      }
      return {
        signal: lifetime.signal,
        restart: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {},
        dispose: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => { lifetime.abort() },
        [Symbol.asyncIterator]: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => iterator,
      } as unknown as RemoteStream<Item>
    },
  }
}

describe('RemoteJournalStream', () => {
  it('publishes cursorless notifications without advancing the durable page cursor', async () => {
    const live = Promise.withResolvers<ScriptedFrame>()
    const fixture = journalFixture(
      [{ frames: [opened(-1, page('empty', [])), { type: 'notification', notification: 'partial' }, live.promise], hold: true }],
      [page('older', [])],
    )

    await fixture.journal.open({})
    await vi.waitFor(() => { expect(fixture.changes).toHaveLength(2) })
    await fixture.journal.prepend({})
    live.resolve({ type: 'entry', entry: { seq: 0 } })
    await vi.waitFor(() => { expect(fixture.changes).toHaveLength(4) })

    expect(fixture.pageCursors).toEqual([-1])
    expect(fixture.changes.map(change => change.type)).toEqual([
      'replace', 'notification', 'prepend', 'append',
    ])
    await fixture.journal.dispose()
  })

  it('defers notifications behind a durable gap until replacement commits', async () => {
    const repair = Promise.withResolvers<Page>()
    const fixture = journalFixture(
      [{
        frames: [
          opened(0, page('initial', [0])),
          { type: 'entry', entry: { seq: 2 } },
          { type: 'notification', notification: 'after-gap' },
        ],
        hold: true,
      }],
      [repair.promise],
    )

    await fixture.journal.open({})
    await vi.waitFor(() => { expect(fixture.pageCursors).toEqual([2]) })
    expect(fixture.changes.map(change => change.type)).toEqual(['replace'])
    repair.resolve(page('repair', [0, 1, 2]))
    await vi.waitFor(() => { expect(fixture.changes).toHaveLength(3) })

    expect(fixture.changes.map(change => change.type)).toEqual([
      'replace', 'replace', 'notification',
    ])
    await fixture.journal.dispose()
  })

  it('replaces from pages whose entries cover contiguous cursor ranges', async () => {
    const snapshot = rangedPage(
      'ranged',
      [rangedEntry(0, 2), rangedEntry(3, 5)],
      true,
    )
    const fixture = journalFixture(
      [{ frames: [opened(5, snapshot)], hold: true }],
      [],
    )

    await fixture.journal.open({})

    expect(fixture.changes).toEqual([{
      type: 'replace',
      page: snapshot,
      entries: snapshot.entries,
      hasMore: true,
    }])
    await fixture.journal.dispose()
  })

  it('rejects an inverted cursor range', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{ frames: [opened(2, rangedPage('inverted', [rangedEntry(3, 2)]))], hold: true }],
        [],
      )

      await expect(fixture.journal.open({})).rejects.toThrow(
        'fixture journal entry has an inverted cursor range',
      )
      expect(fixture.changes).toEqual([])
    })

  it('opens from the follow snapshot, removes overlap, appends live entries, and prepends history', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{
          frames: [
            opened(3, page('tail', [2, 3], true)),
            { type: 'entry', entry: { seq: 3 } },
            { type: 'entry', entry: { seq: 4 } },
          ],
          hold: true,
        }],
        [page('older', [0, 1])],
      )

      await fixture.journal.open({ limit: 2 })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.changes).toHaveLength(2) })
      await fixture.journal.prepend({ before: 2, limit: 2 })

      expect(fixture.calls.slice(0, 2)).toEqual(['follow', 'page'])
      expect(fixture.pageRequests).toEqual([{ before: 2, limit: 2 }])
      expect(fixture.pageCursors).toEqual([4])
      expect(fixture.changes).toEqual([
        { type: 'replace', page: page('tail', [2, 3], true), entries: entries(2, 3), hasMore: true },
        { type: 'append', entry: { seq: 4 } },
        { type: 'prepend', page: page('older', [0, 1]), entries: entries(0, 1), hasMore: false },
      ])
      await fixture.journal.dispose()
      await fixture.journal.dispose()
    })

  it('exposes its shared cancellation signal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{ frames: [opened(-1, page('empty', []))], hold: true }],
        [],
      )

      expect(fixture.journal.signal.aborted).toBe(false)
      await fixture.journal.open({})
      await fixture.journal.dispose()
      expect(fixture.journal.signal.aborted).toBe(true)
    })

  it('classifies normal endings before initial and resumed opening cursors', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：initial 用于处理 initial 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const initial = journalFixture([{ frames: [] }], [])
      await expect(initial.journal.open({})).rejects.toThrow(
        'fixture journal ended before its opening cursor',
      )

      /**
     * 常量说明：finish 用于处理 finish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const finish = Promise.withResolvers<undefined>()
      /**
     * 常量说明：resumed 用于处理 resumed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const resumed = journalFixture(
        [
          { frames: [opened(0, page('initial', [0]))], waitAfterFrames: finish.promise },
          { frames: [] },
        ],
        [],
      )
      await resumed.journal.open({})
      finish.resolve(undefined)
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(resumed.failed).toHaveBeenCalledOnce() })
      expect(resumed.failed.mock.calls[0]?.[0]).toMatchObject({
        message: 'resumed fixture journal ended before its opening cursor',
      })
      await resumed.journal.dispose()
    })

  it('prepends into an empty window and accepts its first live entry', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：empty 用于处理 empty 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const empty = journalFixture(
        [{ frames: [opened(-1, page('empty', []))], hold: true }],
        [page('older', [0]), page('oldest', [])],
      )
      await empty.journal.open({})
      await empty.journal.prepend({})
      expect(empty.changes.at(-1)).toEqual({
        type: 'prepend', page: page('older', [0]), entries: entries(0), hasMore: false,
      })
      await empty.journal.prepend({})
      expect(empty.changes.at(-1)).toEqual({
        type: 'prepend', page: page('oldest', []), entries: [], hasMore: false,
      })
      await empty.journal.dispose()

      /**
     * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const live = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：followed 用于处理 followed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const followed = journalFixture(
        [{ frames: [opened(-1, page('empty', [])), live.promise], hold: true }],
        [],
      )
      await followed.journal.open({})
      live.resolve({ type: 'entry', entry: { seq: 0 } })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(followed.changes).toHaveLength(2) })
      expect(followed.changes.at(-1)).toEqual({ type: 'append', entry: { seq: 0 } })
      await followed.journal.dispose()
    })

  it('prepends at the first cursor and rejects a partially overlapping ranged entry', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：initial 用于处理 initial 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const initial = rangedPage('initial', [rangedEntry(4, 6)], true)
      /**
     * 常量说明：older 用于处理 older 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const older = rangedPage('older', [rangedEntry(0, 3)])
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{ frames: [opened(6, initial)], hold: true }],
        [older],
      )

      await fixture.journal.open({})
      await fixture.journal.prepend({ before: 4 })

      expect(fixture.pageCursors).toEqual([6])
      expect(fixture.changes.at(-1)).toEqual({
        type: 'prepend', page: older, entries: older.entries, hasMore: false,
      })
      await fixture.journal.dispose()

      /**
     * 常量说明：overlap 用于处理 overlap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const overlap = rangedPage('overlap', [rangedEntry(0, 4)], true)
      /**
     * 常量说明：overlapping 用于处理 overlapping 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const overlapping = journalFixture(
        [{ frames: [opened(6, initial)], hold: true }],
        [overlap],
      )
      await overlapping.journal.open({})

      await expect(overlapping.journal.prepend({ before: 4 })).rejects.toThrow(
        'history page is discontinuous',
      )
      expect(overlapping.changes.at(-1)).toEqual({
        type: 'prepend', page: overlap, entries: [], hasMore: false,
      })
      await overlapping.journal.dispose()
    })

  it('deduplicates complete ranged entries and rejects partial live overlap', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：initial 用于处理 initial 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const initial = rangedPage('initial', [rangedEntry(0, 2)])
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{
          frames: [
            opened(2, initial),
            { type: 'entry', entry: rangedEntry(0, 2) },
            { type: 'entry', entry: rangedEntry(3, 5) },
            { type: 'entry', entry: rangedEntry(5, 7) },
          ],
          hold: true,
        }],
        [],
      )

      await fixture.journal.open({})
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.failed).toHaveBeenCalledOnce() })

      expect(fixture.changes).toHaveLength(2)
      expect(fixture.changes.at(-1)).toEqual({
        type: 'append', entry: rangedEntry(3, 5),
      })
      expect(fixture.failed.mock.calls[0]?.[0]).toMatchObject({
        message: 'fixture journal emitted a partially overlapping entry',
      })
      await fixture.journal.dispose()
    })

  it('repairs a replacement generation through one tail page and drops replay overlap', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：lost 用于处理 lost 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const lost = new RemoteStreamCarrierError('carrier lost')
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [
          {
            frames: [
              opened(1, page('initial', [0, 1])),
              { type: 'entry', entry: { seq: 2 } },
            ],
            terminal: lost,
          },
          {
            frames: [
              opened(4, page('replacement', [0, 1, 2, 3, 4])),
              { type: 'entry', entry: { seq: 3 } },
              { type: 'entry', entry: { seq: 4 } },
            ],
            hold: true,
          },
        ],
        [],
      )

      await fixture.journal.open({ limit: 5 })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.changes).toHaveLength(3) })

      expect(fixture.changes.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(change)，并按返回类型处理结果。
 */ change => change.type)).toEqual(['replace', 'append', 'replace'])
      expect(fixture.changes[2]).toMatchObject({
        type: 'replace', page: { marker: 'replacement' }, entries: entries(0, 1, 2, 3, 4),
      })
      expect(fixture.followRequests).toEqual([{ limit: 5 }, { limit: 5 }])
      expect(fixture.pageCursors).toEqual([])
      expect(fixture.failed).not.toHaveBeenCalled()
      await fixture.journal.dispose()
    })

  it('restarts a page aborted with its carrier generation', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [
          {
            frames: [
              opened(1, page('initial', [0, 1])),
              { type: 'entry', entry: { seq: 3 } },
            ],
            terminal: new RemoteStreamCarrierError('carrier lost during page'),
          },
          {
            frames: [opened(3, page('replacement', [0, 1, 2, 3]))],
            hold: true,
          },
        ],
        [
          /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
         * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
         */ signal => new Promise<Page>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
 * 并按返回类型处理结果。
 */ (_resolve, reject) => {
              /**
           * 常量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           * 功能说明：处理 aborted 相关流程；使用场景由所在模块及调用位置决定。
           * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
           * @example 在完成前置校验后调用 aborted()，并按返回类型处理结果。
           */
              const aborted = (): void => { reject(new Error('page aborted')) }
              signal.addEventListener('abort', aborted, { once: true })
              if (signal.aborted) aborted()
            }),
        ],
      )

      await fixture.journal.open({ limit: 3 })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.changes).toHaveLength(2) })

      expect(fixture.changes).toEqual([
        {
          type: 'replace',
          page: page('initial', [0, 1]),
          entries: entries(0, 1),
          hasMore: false,
        },
        {
          type: 'replace',
          page: page('replacement', [0, 1, 2, 3]),
          entries: entries(0, 1, 2, 3),
          hasMore: false,
        },
      ])
      expect(fixture.pageCursors).toEqual([3])
      expect(fixture.followRequests).toEqual([{ limit: 3 }, { limit: 3 }])
      expect(fixture.failed).not.toHaveBeenCalled()
      await fixture.journal.dispose()
    })

  it('repairs a live gap before publishing another change', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{
          frames: [
            opened(1, page('initial', [0, 1])),
            { type: 'entry', entry: { seq: 4 } },
          ],
          hold: true,
        }],
        [page('repair', [0, 1, 2, 3, 4])],
      )

      await fixture.journal.open({})
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.changes).toHaveLength(2) })

      expect(fixture.changes.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(change)，并按返回类型处理结果。
 */ change => change.type)).toEqual(['replace', 'replace'])
      expect(fixture.changes[1]).toMatchObject({ page: { marker: 'repair' } })
      expect(fixture.pageCursors).toEqual([4])
      await fixture.journal.dispose()
    })

  it('reports a page failure during live-gap repair', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{
          frames: [
            opened(0, page('initial', [0])),
            { type: 'entry', entry: { seq: 2 } },
          ],
          hold: true,
        }],
        [/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(new Error('repair page failed'))],
      )

      await fixture.journal.open({})
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.failed).toHaveBeenCalledOnce() })

      expect(fixture.failed.mock.calls[0]?.[0]).toMatchObject({ message: 'repair page failed' })
      expect(fixture.changes).toHaveLength(1)
      await fixture.journal.dispose()
    })

  it('replaces a superseded live-gap repair with the next generation', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：gap 用于处理 gap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const gap = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [
          {
            frames: [opened(1, page('initial', [0, 1])), gap.promise],
            terminal: new RemoteStreamCarrierError('generation lost'),
          },
          { frames: [opened(4, page('replacement', [0, 1, 2, 3, 4]))], hold: true },
        ],
        [
          /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */ () => new Promise<Page>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {}),
        ],
      )

      await fixture.journal.open({ limit: 5 })
      gap.resolve({ type: 'entry', entry: { seq: 4 } })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.changes).toHaveLength(2) })
      expect(fixture.changes.at(-1)).toMatchObject({
        type: 'replace', page: { marker: 'replacement' }, entries: entries(0, 1, 2, 3, 4),
      })
      await fixture.journal.dispose()
    })

  it('replaces a superseded second repair page with the next generation', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：firstLive 用于处理 firstLive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const firstLive = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：secondLive 用于处理 secondLive 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const secondLive = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：secondConsumed 用于处理 secondConsumed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const secondConsumed = Promise.withResolvers<undefined>()
      /**
     * 常量说明：firstRepair 用于处理 firstRepair 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const firstRepair = Promise.withResolvers<Page>()
      /**
     * 常量说明：finish 用于处理 finish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const finish = Promise.withResolvers<undefined>()
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [
          {
            frames: [
              opened(1, page('initial', [0, 1])),
              firstLive.promise,
              secondLive.promise,
            ],
            waitAfterFrames: finish.promise,
            terminal: new RemoteStreamCarrierError('generation lost'),
            afterFrame: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(index)，并按返回类型处理结果。
 */ (index) => { if (index === 2) secondConsumed.resolve(undefined) },
          },
          { frames: [opened(5, page('replacement', [0, 1, 2, 3, 4, 5]))], hold: true },
        ],
        [
          firstRepair.promise,
          /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
         * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
         */ signal => new Promise<Page>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
 * 并按返回类型处理结果。
 */ (_resolve, reject) => {
              signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { reject(new Error('page aborted')) }, { once: true })
            }),
        ],
      )

      await fixture.journal.open({})
      firstLive.resolve({ type: 'entry', entry: { seq: 3 } })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.pageCursors).toEqual([3]) })
      secondLive.resolve({ type: 'entry', entry: { seq: 5 } })
      await secondConsumed.promise
      firstRepair.resolve(page('first-repair', [0, 1, 2, 3]))
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.pageCursors).toEqual([3, 5]) })
      finish.resolve(undefined)
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.changes).toHaveLength(2) })

      expect(fixture.pageCursors).toEqual([3, 5])
      expect(fixture.changes).toEqual([
        {
          type: 'replace',
          page: page('initial', [0, 1]),
          entries: entries(0, 1),
          hasMore: false,
        },
        {
          type: 'replace',
          page: page('replacement', [0, 1, 2, 3, 4, 5]),
          entries: entries(0, 1, 2, 3, 4, 5),
          hasMore: false,
        },
      ])
      await fixture.journal.dispose()
    })

  it('rereads the tail when queued entries advance beyond the first repair page', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：firstLive 用于处理 firstLive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const firstLive = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：secondLive 用于处理 secondLive 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const secondLive = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：secondConsumed 用于处理 secondConsumed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const secondConsumed = Promise.withResolvers<undefined>()
      /**
     * 常量说明：firstRepair 用于处理 firstRepair 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const firstRepair = Promise.withResolvers<Page>()
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{
          frames: [
            opened(1, page('initial', [0, 1])),
            firstLive.promise,
            secondLive.promise,
          ],
          hold: true,
          afterFrame: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(index)，并按返回类型处理结果。
 */ (index) => { if (index === 2) secondConsumed.resolve(undefined) },
        }],
        [firstRepair.promise, page('repair', [0, 1, 2, 3, 4, 5])],
      )

      await fixture.journal.open({ limit: 4 })
      firstLive.resolve({ type: 'entry', entry: { seq: 3 } })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.pageCursors).toEqual([3]) })
      secondLive.resolve({ type: 'entry', entry: { seq: 5 } })
      await secondConsumed.promise
      firstRepair.resolve(page('first-repair', [0, 1, 2, 3]))
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.changes).toHaveLength(2) })

      expect(fixture.pageCursors).toEqual([3, 5])
      expect(fixture.changes.at(-1)).toEqual({
        type: 'replace',
        page: page('repair', [0, 1, 2, 3, 4, 5]),
        entries: entries(0, 1, 2, 3, 4, 5),
        hasMore: false,
      })
      await fixture.journal.dispose()
    })

  it('merges contiguous entries that arrive while a replacement page is loading', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：firstLive 用于处理 firstLive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const firstLive = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：secondLive 用于处理 secondLive 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const secondLive = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：secondConsumed 用于处理 secondConsumed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const secondConsumed = Promise.withResolvers<undefined>()
      /**
     * 常量说明：repair 用于处理 repair 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const repair = Promise.withResolvers<Page>()
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{
          frames: [
            opened(1, page('initial', [0, 1])),
            firstLive.promise,
            secondLive.promise,
          ],
          hold: true,
          afterFrame: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(index)，并按返回类型处理结果。
 */ (index) => { if (index === 2) secondConsumed.resolve(undefined) },
        }],
        [repair.promise],
      )

      await fixture.journal.open({})
      firstLive.resolve({ type: 'entry', entry: { seq: 3 } })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.pageCursors).toEqual([3]) })
      secondLive.resolve({ type: 'entry', entry: { seq: 4 } })
      await secondConsumed.promise
      repair.resolve(page('repair', [0, 1, 2, 3]))
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.changes).toHaveLength(2) })

      expect(fixture.changes.at(-1)).toEqual({
        type: 'replace',
        page: page('repair', [0, 1, 2, 3]),
        entries: entries(0, 1, 2, 3, 4),
        hasMore: false,
      })
      await fixture.journal.dispose()
    })

  it('rejects a partially overlapping ranged entry queued during repair', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：firstLive 用于处理 firstLive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const firstLive = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：secondLive 用于处理 secondLive 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const secondLive = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：secondConsumed 用于处理 secondConsumed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const secondConsumed = Promise.withResolvers<undefined>()
      /**
     * 常量说明：repair 用于处理 repair 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const repair = Promise.withResolvers<Page>()
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{
          frames: [
            opened(1, page('initial', [0, 1])),
            firstLive.promise,
            secondLive.promise,
          ],
          hold: true,
          afterFrame: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(index)，并按返回类型处理结果。
 */ (index) => { if (index === 2) secondConsumed.resolve(undefined) },
        }],
        [repair.promise],
      )

      await fixture.journal.open({})
      firstLive.resolve({ type: 'entry', entry: rangedEntry(3, 5) })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.pageCursors).toEqual([5]) })
      secondLive.resolve({ type: 'entry', entry: rangedEntry(5, 7) })
      await secondConsumed.promise
      repair.resolve(rangedPage('repair', [rangedEntry(0, 2), rangedEntry(3, 5)]))

      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.failed).toHaveBeenCalledOnce() })
      expect(fixture.changes).toHaveLength(1)
      expect(fixture.failed.mock.calls[0]?.[0]).toMatchObject({
        message: 'fixture journal replacement contains a partially overlapping entry',
      })
      await fixture.journal.dispose()
    })

  it('rejects when queued entries advance beyond the second repair page', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：firstLive 用于处理 firstLive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const firstLive = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：secondLive 用于处理 secondLive 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const secondLive = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：thirdLive 用于处理 thirdLive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const thirdLive = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：secondConsumed 用于处理 secondConsumed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const secondConsumed = Promise.withResolvers<undefined>()
      /**
     * 常量说明：thirdConsumed 用于处理 thirdConsumed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const thirdConsumed = Promise.withResolvers<undefined>()
      /**
     * 常量说明：firstRepair 用于处理 firstRepair 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const firstRepair = Promise.withResolvers<Page>()
      /**
     * 常量说明：secondRepair 用于处理 secondRepair 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const secondRepair = Promise.withResolvers<Page>()
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{
          frames: [
            opened(1, page('initial', [0, 1])),
            firstLive.promise,
            secondLive.promise,
            thirdLive.promise,
          ],
          hold: true,
          afterFrame: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(index)，并按返回类型处理结果。
 */ (index) => {
            if (index === 2) secondConsumed.resolve(undefined)
            if (index === 3) thirdConsumed.resolve(undefined)
          },
        }],
        [firstRepair.promise, secondRepair.promise],
      )

      await fixture.journal.open({})
      firstLive.resolve({ type: 'entry', entry: { seq: 3 } })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.pageCursors).toEqual([3]) })
      secondLive.resolve({ type: 'entry', entry: { seq: 5 } })
      await secondConsumed.promise
      firstRepair.resolve(page('first-repair', [0, 1, 2, 3]))
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.pageCursors).toEqual([3, 5]) })
      thirdLive.resolve({ type: 'entry', entry: { seq: 7 } })
      await thirdConsumed.promise
      secondRepair.resolve(page('second-repair', [0, 1, 2, 3, 4, 5]))

      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.failed).toHaveBeenCalledOnce() })
      expect(fixture.failed.mock.calls[0]?.[0]).toMatchObject({
        message: 'fixture journal page did not reach its opening cursor',
      })
      await fixture.journal.dispose()
    })

  it('reports a resumed generation that emits an entry before its cursor', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：finish 用于处理 finish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const finish = Promise.withResolvers<undefined>()
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [
          {
            frames: [opened(0, page('initial', [0]))],
            waitAfterFrames: finish.promise,
            terminal: new RemoteStreamCarrierError('lost'),
          },
          { frames: [{ type: 'entry', entry: { seq: 1 } }] },
        ],
        [],
      )

      await fixture.journal.open({})
      finish.resolve(undefined)
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.failed).toHaveBeenCalledOnce() })
      expect(fixture.failed.mock.calls[0]?.[0]).toMatchObject({
        message: 'resumed fixture journal emitted an entry before its opening cursor',
      })
      await fixture.journal.dispose()
    })

  it('reports a duplicate opening cursor after the initial page is published', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：duplicate 用于处理 duplicate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const duplicate = Promise.withResolvers<ScriptedFrame>()
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{ frames: [opened(0, page('initial', [0])), duplicate.promise], hold: true }],
        [],
      )

      await fixture.journal.open({})
      duplicate.resolve(opened(0, page('duplicate', [0])))
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.failed).toHaveBeenCalledOnce() })
      expect(fixture.failed.mock.calls[0]?.[0]).toMatchObject({
        message: 'fixture journal emitted more than one opening cursor',
      })
      await fixture.journal.dispose()
    })

  it('reports a follow failure after publishing its opening snapshot', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：failedFollow 用于处理 failedFollow 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const failedFollow = journalFixture(
        [{ frames: [opened(0, page('initial', [0]))], terminal: new Error('follow failed') }],
        [],
      )
      await failedFollow.journal.open({})
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(failedFollow.failed).toHaveBeenCalledOnce() })
      expect(failedFollow.failed.mock.calls[0]?.[0]).toMatchObject({ message: 'follow failed' })
      expect(failedFollow.changes).toHaveLength(1)
      await failedFollow.journal.dispose()
    })

  it('rejects an iterator that ends before its opening cursor', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：factory 用于处理 factory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const factory = controlledFactory(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve({ done: true, value: undefined }))
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture([], [], factory)

      await expect(fixture.journal.open({})).rejects.toThrow(
        'ended before its opening cursor',
      )
    })

  it('suppresses a consumer failure after disposal begins', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const generation = new AbortController()
      /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const next = Promise.withResolvers<IteratorResult<RemoteStreamItem<JournalFrame>>>()
      /**
     * 常量说明：results 用于处理 results 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const results = [
        Promise.resolve<IteratorResult<RemoteStreamItem<JournalFrame>>>({
          done: false,
          value: remoteItem(1, opened(0, page('initial', [0])), generation.signal),
        }),
        next.promise,
      ]
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [],
        [],
        controlledFactory(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => results.shift() ?? Promise.resolve({ done: true, value: undefined })),
      )

      await fixture.journal.open({})
      /**
     * 常量说明：closing 用于处理 closing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const closing = fixture.journal.dispose()
      next.resolve({
        done: false,
        value: remoteItem(1, opened(0, page('duplicate', [0])), generation.signal),
      })
      await closing
      expect(fixture.failed).not.toHaveBeenCalled()
    })

  it.each([
    { name: 'ends', final: { done: true as const, value: undefined }, message: 'ended while replacing' },
    {
      name: 'emits another opening cursor',
      final: undefined,
      message: 'more than one opening cursor',
    },
  ])('reports when an aborted repair generation $name', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ final, message }（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ final, message })，
 * 并按返回类型处理结果。
 */ async ({ final, message }) => {
      /**
     * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const generation = new AbortController()
      /**
     * 常量说明：gap 用于处理 gap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const gap = Promise.withResolvers<IteratorResult<RemoteStreamItem<JournalFrame>>>()
      /**
     * 常量说明：replacement 用于处理 replacement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const replacement = Promise.withResolvers<IteratorResult<RemoteStreamItem<JournalFrame>>>()
      /**
     * 常量说明：results 用于处理 results 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const results = [
        Promise.resolve<IteratorResult<RemoteStreamItem<JournalFrame>>>({
          done: false,
          value: remoteItem(1, opened(0, page('initial', [0])), generation.signal),
        }),
        gap.promise,
        replacement.promise,
      ]
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [],
        [/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
 */ signal => new Promise<Page>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
 * 并按返回类型处理结果。
 */ (_resolve, reject) => {
              signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { reject(new Error('page aborted')) }, { once: true })
            })],
        controlledFactory(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => results.shift() ?? Promise.resolve({ done: true, value: undefined })),
      )

      await fixture.journal.open({})
      gap.resolve({
        done: false,
        value: remoteItem(1, { type: 'entry', entry: { seq: 2 } }, generation.signal),
      })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.pageCursors).toEqual([2]) })
      generation.abort()
      if (final === undefined) {
        replacement.resolve({
          done: false,
          value: remoteItem(1, opened(2, page('duplicate', [0, 1, 2])), generation.signal),
        })
      } else {
        replacement.resolve(final)
      }
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.failed).toHaveBeenCalledOnce() })
      /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const failure: unknown = fixture.failed.mock.calls[0]?.[0]
      expect(failure).toBeInstanceOf(Error)
      if (!(failure instanceof Error)) throw new Error('journal failure was not an Error')
      expect(failure.message).toContain(message)
      await fixture.journal.dispose()
    })

  it('discards old-generation entries while waiting for the replacement opening', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const generation = new AbortController()
      /**
     * 常量说明：gap 用于处理 gap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const gap = Promise.withResolvers<IteratorResult<RemoteStreamItem<JournalFrame>>>()
      /**
     * 常量说明：stale 用于处理 stale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const stale = Promise.withResolvers<IteratorResult<RemoteStreamItem<JournalFrame>>>()
      /**
     * 常量说明：replacement 用于处理 replacement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const replacement = Promise.withResolvers<IteratorResult<RemoteStreamItem<JournalFrame>>>()
      /**
     * 常量说明：results 用于处理 results 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const results = [
        Promise.resolve<IteratorResult<RemoteStreamItem<JournalFrame>>>({
          done: false,
          value: remoteItem(1, opened(0, page('initial', [0])), generation.signal),
        }),
        gap.promise,
        stale.promise,
        replacement.promise,
      ]
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [],
        [/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
 */ signal => new Promise<Page>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
 * 并按返回类型处理结果。
 */ (_resolve, reject) => {
              signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { reject(new Error('page aborted')) }, { once: true })
            })],
        controlledFactory(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => results.shift() ?? Promise.resolve({ done: true, value: undefined })),
      )

      await fixture.journal.open({})
      gap.resolve({
        done: false,
        value: remoteItem(1, { type: 'entry', entry: { seq: 2 } }, generation.signal),
      })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.pageCursors).toEqual([2]) })
      generation.abort()
      stale.resolve({
        done: false,
        value: remoteItem(1, { type: 'entry', entry: { seq: 1 } }, generation.signal),
      })
      replacement.resolve({
        done: false,
        value: remoteItem(2, opened(2, page('replacement', [0, 1, 2])), new AbortController().signal),
      })

      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.changes).toHaveLength(2) })
      expect(fixture.changes.at(-1)).toMatchObject({ page: { marker: 'replacement' } })
      await fixture.journal.dispose()
    })

  it.each([
    {
      name: 'rejects',
      settle: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（(value:
 * IteratorResult<RemoteStreamItem<JournalFrame>>) => …）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：reject（(reason?: unknown) => void）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，并按返回类型处理结果。
 */ (
        _resolve: (value: IteratorResult<RemoteStreamItem<JournalFrame>>) => void,
        reject: (reason?: unknown) => void,
      ) => { reject(new Error('replacement follow failed')) },
      message: 'replacement follow failed',
    },
    {
      name: 'ends',
      settle: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（(value:
 * IteratorResult<RemoteStreamItem<JournalFrame>>) => …）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve: (value: IteratorResult<RemoteStreamItem<JournalFrame>>) => void) => {
        resolve({ done: true, value: undefined })
      },
      message: 'ended while reading its replacement page',
    },
    {
      name: 'opens twice',
      settle: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（(value:
 * IteratorResult<RemoteStreamItem<JournalFrame>>) => …）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve: (value: IteratorResult<RemoteStreamItem<JournalFrame>>) => void) => {
        resolve({
          done: false,
          value: remoteItem(1, opened(2, page('duplicate', [0, 1, 2])), new AbortController().signal),
        })
      },
      message: 'more than one opening cursor',
    },
  ])('reports when a follow $name during live-gap repair', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ settle, message }（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ settle, message })，
 * 并按返回类型处理结果。
 */ async ({ settle, message }) => {
      /**
     * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const generation = new AbortController()
      /**
     * 常量说明：gap 用于处理 gap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const gap = Promise.withResolvers<IteratorResult<RemoteStreamItem<JournalFrame>>>()
      /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const next = Promise.withResolvers<IteratorResult<RemoteStreamItem<JournalFrame>>>()
      /**
     * 常量说明：results 用于处理 results 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const results = [
        Promise.resolve<IteratorResult<RemoteStreamItem<JournalFrame>>>({
          done: false,
          value: remoteItem(1, opened(0, page('initial', [0])), generation.signal),
        }),
        gap.promise,
        next.promise,
      ]
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [],
        [/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => new Promise<Page>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {})],
        controlledFactory(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => results.shift() ?? Promise.resolve({ done: true, value: undefined })),
      )

      await fixture.journal.open({})
      gap.resolve({
        done: false,
        value: remoteItem(1, { type: 'entry', entry: { seq: 2 } }, generation.signal),
      })
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.pageCursors).toEqual([2]) })
      settle(next.resolve, next.reject)

      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(fixture.failed).toHaveBeenCalledOnce() })
      /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const failure: unknown = fixture.failed.mock.calls[0]?.[0]
      expect(failure).toBeInstanceOf(Error)
      if (!(failure instanceof Error)) throw new Error('journal failure was not an Error')
      expect(failure.message).toContain(message)
      await fixture.journal.dispose()
    })

  it('rejects malformed opening and page sequences', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：beforeOpening 用于处理 beforeOpening 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const beforeOpening = journalFixture(
        [{ frames: [{ type: 'entry', entry: { seq: 0 } }] }],
        [],
      )
      await expect(beforeOpening.journal.open({})).rejects.toThrow('entry before its opening cursor')

      /**
     * 常量说明：discontinuousPage 用于处理 discontinuousPage 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const discontinuousPage = journalFixture(
        [{ frames: [opened(3, page('bad', [0, 2, 3]))], hold: true }],
        [],
      )
      await expect(discontinuousPage.journal.open({})).rejects.toThrow('page contains discontinuous entries')

      /**
     * 常量说明：shortPage 用于处理 shortPage 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const shortPage = journalFixture(
        [{ frames: [opened(3, page('short', [0, 1]))], hold: true }],
        [],
      )
      await expect(shortPage.journal.open({})).rejects.toThrow('page did not end at its requested cursor')

      /**
     * 常量说明：longPage 用于处理 longPage 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const longPage = journalFixture(
        [{ frames: [opened(1, page('long', [0, 1, 2]))], hold: true }],
        [],
      )
      await expect(longPage.journal.open({})).rejects.toThrow('page did not end at its requested cursor')
    })

  it('reports duplicate and regressed generation cursors as terminal failures', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：duplicate 用于处理 duplicate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const duplicate = journalFixture(
        [{
          frames: [
            opened(1, page('initial', [0, 1])),
            opened(1, page('duplicate', [0, 1])),
          ],
        }],
        [],
      )
      await duplicate.journal.open({})
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(duplicate.failed).toHaveBeenCalledOnce() })
      /**
     * 常量说明：duplicateFailure 用于处理 duplicateFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const duplicateFailure: unknown = duplicate.failed.mock.calls[0]?.[0]
      expect(duplicateFailure).toBeInstanceOf(Error)
      if (!(duplicateFailure instanceof Error)) throw new Error('expected duplicate-cursor failure')
      expect(duplicateFailure.message).toContain('more than one opening cursor')

      /**
     * 常量说明：regressed 用于处理 regressed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const regressed = journalFixture(
        [
          {
            frames: [opened(1, page('initial', [0, 1])), { type: 'entry', entry: { seq: 2 } }],
            terminal: new RemoteStreamCarrierError('lost'),
          },
          { frames: [opened(1, page('regressed', [0, 1]))] },
        ],
        [],
      )
      await regressed.journal.open({})
      await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(regressed.failed).toHaveBeenCalledOnce() })
      /**
     * 常量说明：regressedFailure 用于处理 regressedFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const regressedFailure: unknown = regressed.failed.mock.calls[0]?.[0]
      expect(regressedFailure).toBeInstanceOf(Error)
      if (!(regressedFailure instanceof Error)) throw new Error('expected regressed-cursor failure')
      expect(regressedFailure.message).toContain('behind the last applied entry')
    })

  it('rejects a discontinuous older page after publishing the fail-soft pagination state', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{ frames: [opened(4, page('initial', [3, 4], true))], hold: true }],
        [page('older', [0, 1], true)],
      )
      await fixture.journal.open({})

      await expect(fixture.journal.prepend({ before: 3 })).rejects.toThrow('history page is discontinuous')
      expect(fixture.changes.at(-1)).toEqual({
        type: 'prepend', page: page('older', [0, 1], true), entries: [], hasMore: false,
      })
      await fixture.journal.dispose()
    })

  it('guards lifecycle operations before and after open', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const fixture = journalFixture(
        [{ frames: [opened(-1, page('empty', []))], hold: true }],
        [],
      )

      await expect(fixture.journal.prepend({})).rejects.toThrow('is not open')
      await fixture.journal.open({})
      await expect(fixture.journal.open({})).rejects.toThrow('already opened')
      fixture.journal.restart()
      await fixture.journal.dispose()
      await expect(fixture.journal.prepend({})).rejects.toThrow('is not open')
    })
})
