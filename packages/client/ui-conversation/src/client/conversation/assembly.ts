/** Per-Session target-neutral Conversation assembly.
 * @remarks 文件说明：文件职责：实现 client/ui-conversation 中 assembly 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-conversation 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  ISessions, SessionBinding, SessionEventSource, SessionEventWindow,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import {
  createSnapshotStore, type ObservableSnapshot, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
import type {
  ConversationPublication, ConversationViewSnapshotMap,
  ConversationViewSnapshotStore,
} from '../contract/conversation.ts'
import type { ConversationSnapshot } from '../contract/snapshot.ts'
import type { ConversationPromptSnapshot, RequestPromptInspection } from '../contract/request-inspection.ts'
import { inspectRequestPrompt } from '../contract/request-inspection.ts'
import { ConversationNodeAssembler } from './assembler.ts'
import { ConversationEventRegistry } from './event-registry.ts'
import { HistoricalImageCache } from './historical-images.ts'
import { ConversationViewRegistry } from './view-registry.ts'

/** Observable faces published for one Session's Conversation assembly. */
export interface ConversationBinding {
  readonly snapshot: ObservableSnapshot<ConversationSnapshot>
  /**
   * Resolve one target-owned snapshot source.
   * @param target - registered Conversation target.
   * @returns identity-stable source following the target.
   * @remarks 中文说明：功能说明：处理 target 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：target（Target）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：ObservableSnapshot<ConversationViewSnapshotMap[Target] | undefined>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 target(target)，并按返回类型处理结果。
   */
  target<Target extends Extract<keyof ConversationViewSnapshotMap, string>>(
    target: Target,
  ): ObservableSnapshot<ConversationViewSnapshotMap[Target] | undefined>
}

/**
 * 类说明：BoundConversation 用于集中封装 处理 BoundConversation 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 client/ui-conversation 在对应插件或业务生命周期内创建和调用。
 */
class BoundConversation implements ConversationBinding {
  /**
   * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly snapshot: SnapshotStore<ConversationSnapshot>
  /**
   * 常量说明：viewStore 用于处理 viewStore 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly viewStore: ConversationViewSnapshotStore
  /**
   * 常量说明：targetSources 用于处理 targetSources 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly targetSources = new Map<string, ObservableSnapshot<unknown>>()
  /**
   * 变量说明：revision 用于处理 revision 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private revision = -1
  /**
   * 变量说明：frame 用于处理 frame 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private frame: number | undefined
  /**
   * 变量说明：disposeFeed 用于处理 disposeFeed 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：处理 disposeFeed 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 disposeFeed()，并按返回类型处理结果。
   */
  private disposeFeed: () => void = () => {}

  /**
   * 功能说明：处理 BoundConversation 相关流程；使用场景由所在模块及调用位置决定。
   * @param feed （SessionEventSource）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param assembler （ConversationNodeAssembler）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new BoundConversation(feed, assembler) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    feed: SessionEventSource,
    private readonly assembler: ConversationNodeAssembler,
  ) {
    this.viewStore = assembler
    this.snapshot = createSnapshotStore(this.currentSnapshot())
    this.replace(feed.getSnapshot())
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.disposeFeed = feed.subscribe(() => {
      this.accept(feed.getSnapshot())
    })
  }

  /**
   * 功能说明：处理 target 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （Target）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ObservableSnapshot<ConversationViewSnapshotMap[Target] |
   * undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 target(target)，并按返回类型处理结果。
   */
  target<Target extends Extract<keyof ConversationViewSnapshotMap, string>>(
    target: Target,
  ): ObservableSnapshot<ConversationViewSnapshotMap[Target] | undefined> {
    /**
     * 变量说明：source 用于处理 source 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let source = this.targetSources.get(target)
    if (source === undefined) {
      /**
       * 常量说明：views 用于处理 views 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：获取 get 相关流程；使用场景由所在模块及调用位置决定。
       * @param key （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 get(key)，并按返回类型处理结果。
       */
      const views = this.viewStore as unknown as { get(key: string): unknown }
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：listener（由 TypeScript
       * 根据调用位置推断的类型）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
       * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(listener)，
       * 并按返回类型处理结果。
       */
      source = {
        getSnapshot: () => views.get(target),
        subscribe: (listener) => { return this.snapshot.subscribe(listener) },
      }
      this.targetSources.set(target, source)
    }
    return source as ObservableSnapshot<ConversationViewSnapshotMap[Target] | undefined>
  }

  /**
   * 功能说明：处理 rebuild 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rebuild()，并按返回类型处理结果。
   */
  rebuild(): void { this.publish(this.assembler.rebuildRegistry()) }

  /**
   * 功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 dispose()，并按返回类型处理结果。
   */
  dispose(): void {
    if (this.frame !== undefined && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.frame)
    }
    this.frame = undefined
    this.disposeFeed()
  }

  /**
   * 功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。
   * @param window （SessionEventWindow）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 replace(window)，并按返回类型处理结果。
   */
  private replace(window: SessionEventWindow): void {
    this.revision = window.revision
    this.publish(this.assembler.replaceWindow(window.entries, window.hasMore))
  }

  /**
   * 功能说明：处理 accept 相关流程；使用场景由所在模块及调用位置决定。
   * @param window （SessionEventWindow）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 accept(window)，并按返回类型处理结果。
   */
  private accept(window: SessionEventWindow): void {
    if (window.revision === this.revision) return
    if (window.revision !== this.revision + 1 || window.change.kind === 'replace') {
      this.replace(window)
      return
    }
    this.revision = window.revision
    switch (window.change.kind) {
      case 'prepend':
        this.publish(this.assembler.prepend(window.change.entries, window.hasMore))
        return
      case 'append': {
        /**
         * 变量说明：publication 用于处理 publication 相关数据，作用于当前作用域；其值可能随流程推进而变化，
         * 读写时需遵守声明类型和所在生命周期。
         */
        let publication: ConversationPublication = 'none'
        /**
         * 变量说明：event 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const event of window.change.entries) {
          /**
           * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const next = this.assembler.append(event)
          if (next === 'immediate' || publication === 'none') publication = next
        }
        this.publish(publication)
      }
    }
  }

  /**
   * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
   * @param publication （ConversationPublication）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publish(publication)，并按返回类型处理结果。
   */
  private publish(publication: ConversationPublication): void {
    if (publication === 'none') return
    if (publication === 'animation-frame' && typeof requestAnimationFrame === 'function') {
      if (this.frame !== undefined) return
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      this.frame = requestAnimationFrame(() => {
        this.frame = undefined
        this.flush()
      })
      return
    }
    this.flush()
  }

  /**
   * 功能说明：处理 flush 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 flush()，并按返回类型处理结果。
   */
  private flush(): void {
    if (this.assembler.flush()) this.snapshot.set(this.currentSnapshot())
  }

  /**
   * 功能说明：处理 currentSnapshot 相关流程；使用场景由所在模块及调用位置决定。
   * @returns ConversationSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 currentSnapshot()，并按返回类型处理结果。
   */
  private currentSnapshot(): ConversationSnapshot {
    return {
      views: this.viewStore,
      activeTargets: this.assembler.activeTargets(),
    }
  }
}

interface BindingRecord {
  readonly source: SessionBinding
  readonly binding: BoundConversation
  disposeScope: () => void
}

/** Root service owning Conversation registries and per-Session bindings.
 * @remarks 中文说明：类说明：UiConversation 用于集中封装 处理 UiConversation 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/ui-conversation
 * 在对应插件或业务生命周期内创建和调用。 */
export class UiConversation extends Service {
  /** Registry of event matchers and target snapshot builders.
   * @remarks 中文说明：常量说明：events 用于处理 events 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly events: ConversationEventRegistry
  /** Registry of target View definitions.
   * @remarks 中文说明：常量说明：views 用于处理 views 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly views: ConversationViewRegistry
  /**
   * 常量说明：bindings 用于处理 bindings 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly bindings = new Map<SessionId, BindingRecord>()
  /**
   * 常量说明：images 用于处理 images 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly images: HistoricalImageCache

  /**
   * @param ctx - owning Client context.
   * @param sessions - Session Controller object layer.
   * @remarks 中文说明：功能说明：处理 UiConversation 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
   * 参数说明：sessions（ISessions）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new UiConversation(ctx, sessions)
   * 创建实例，并在所属生命周期内使用。
   */
  constructor(ctx: Context, private readonly sessions: ISessions) {
    super(ctx, 'uiConversation')
    this.events = new ConversationEventRegistry(ctx)
    this.views = new ConversationViewRegistry(ctx)
    this.images = new HistoricalImageCache(ctx, sessions)
    /**
     * 常量说明：rebuild 用于处理 rebuild 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 rebuild 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 rebuild()，并按返回类型处理结果。
     */
    const rebuild = (): void => {
      /**
       * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const record of this.bindings.values()) record.binding.rebuild()
    }
    /**
     * 变量说明：rebuildQueued 用于处理 rebuildQueued 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let rebuildQueued = false
    /**
     * 常量说明：scheduleRebuild 用于处理 scheduleRebuild 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 scheduleRebuild 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 scheduleRebuild()，并按返回类型处理结果。
     */
    const scheduleRebuild = (): void => {
      if (rebuildQueued) return
      rebuildQueued = true
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      queueMicrotask(() => {
        rebuildQueued = false
        rebuild()
      })
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.effect(() => {
      /**
       * 常量说明：disposeEvents 用于处理 disposeEvents 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const disposeEvents = this.events.subscribe(scheduleRebuild)
      /**
       * 常量说明：disposeViews 用于处理 disposeViews 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const disposeViews = this.views.subscribe(scheduleRebuild)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return () => {
        disposeViews()
        disposeEvents()
        /**
         * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const record of [...this.bindings.values()]) this.drop(record, true)
      }
    }, 'ui-conversation assembly')
  }

  /**
   * Resolve the Conversation binding for one Controller binding or Session id.
   * @param source - Session binding or identity.
   * @returns stable Conversation binding.
   * @remarks 中文说明：功能说明：处理 binding 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（SessionBinding | SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：ConversationBinding；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * binding(source)，并按返回类型处理结果。
   */
  binding(source: SessionBinding | SessionId): ConversationBinding {
    /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sessionId = typeof source === 'string' ? source : source.sessionId
    /**
     * 常量说明：owner 用于处理 owner 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const owner = typeof source === 'string' ? this.sessions.binding(source) : source
    if (owner === undefined) throw new Error(`uiConversation.binding: unknown session "${sessionId}"`)
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = this.bindings.get(owner.sessionId)
    if (current?.source === owner) return current.binding
    if (current !== undefined) this.drop(current, true)
    /**
     * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const binding = new BoundConversation(
      owner.eventSource,
      new ConversationNodeAssembler(this.events, this.views),
    )
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const record: BindingRecord = { source: owner, binding, disposeScope: () => {} }
    this.bindings.set(owner.sessionId, record)
    /**
     * 常量说明：disposeScope 用于处理 disposeScope 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const disposeScope = owner.ctx.effect(
      () => () => { this.drop(record, false) },
      'ui-conversation binding',
    )
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    record.disposeScope = () => { void disposeScope() }
    return binding
  }

  /**
   * Resolve one session-authorized durable image URL, cached per Session so
   * every Conversation target shares one read and one browser URL.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference from a session event.
   * @returns browser URL valid until the Session binding is released.
   * @remarks 中文说明：功能说明：处理 imageUrl 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：attachment（ImageAttachmentRef）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * imageUrl(sessionId, attachment)，并按返回类型处理结果。
   */
  imageUrl(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string> {
    return this.images.resolve(sessionId, attachment)
  }

  /**
   * Read a cached durable image URL synchronously when one is available.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference from a session event.
   * @returns current preview or canonical URL, if cached.
   * @remarks 中文说明：功能说明：处理 peekImageUrl 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：attachment（ImageAttachmentRef）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * peekImageUrl(sessionId, attachment)，并按返回类型处理结果。
   */
  peekImageUrl(sessionId: SessionId, attachment: ImageAttachmentRef): string | undefined {
    return this.images.peek(sessionId, attachment)
  }

  /**
   * Adopt an already-displayable URL for one durable reference (see
   * HistoricalImageCache.seed): the transcript node then renders it without a
   * byte round-trip.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference the URL displays.
   * @param url - browser URL to adopt.
   * @returns whether the cache took URL ownership.
   * @remarks 中文说明：功能说明：处理 seedImageUrl 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：attachment（ImageAttachmentRef）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：url（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 seedImageUrl(sessionId, attachment,
   * url)，并按返回类型处理结果。
   */
  seedImageUrl(sessionId: SessionId, attachment: ImageAttachmentRef, url: string): boolean {
    return this.images.seed(sessionId, attachment, url)
  }

  /**
   * Canonicalize one `request/header` event against the previous prompt state.
   *
   * A pure interpretation shared by the Chat and Trajectory Definitions, exposed
   * as a service method because cross-plugin value imports are forbidden in
   * client bundles.
   * @param previous - prompt recorded by the preceding loaded header, if any.
   * @param event - the `request/header` session event to interpret.
   * @returns the canonical prompt snapshot and any model-visible change.
   * @remarks 中文说明：功能说明：处理 inspectRequestPrompt 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：previous（ConversationPromptSnapshot | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：event（SessionEvent<'request/header'>）：提供需要处理或投影的事
   * 件数据；必须满足声明的类型及调用时序要求。；返回值：RequestPromptInspection；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 inspectRequestPrompt(previous, event)，
   * 并按返回类型处理结果。
   */
  inspectRequestPrompt(
    previous: ConversationPromptSnapshot | undefined,
    event: SessionEvent<'request/header'>,
  ): RequestPromptInspection {
    return inspectRequestPrompt(previous, event)
  }

  /**
   * 功能说明：处理 drop 相关流程；使用场景由所在模块及调用位置决定。
   * @param record （BindingRecord）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param releaseScope （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 drop(record, releaseScope)，并按返回类型处理结果。
   */
  private drop(record: BindingRecord, releaseScope: boolean): void {
    if (this.bindings.get(record.source.sessionId) !== record) return
    this.bindings.delete(record.source.sessionId)
    record.binding.dispose()
    if (releaseScope) record.disposeScope()
  }
}
