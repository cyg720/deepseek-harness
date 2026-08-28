/** Session Controller adapter for React selector hooks and Slot scope data.
 * @remarks 文件说明：文件职责：实现 client/ui-session 中 index 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-session 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  ISessions,
  SessionBinding,
  SessionListState,
  SessionSnapshot,
  UseProjection,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import { standardHookPropName } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  HostObservable,
  KeyedStandardSource,
  MaybeSnapshotSelectorHook,
  RootStandardSourceContribution,
  ScopedStandardSourceBinding,
  SlotScopeAdapter,
  SnapshotSelectorHook,
  StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only service merge for ctx.slots.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { renderSessionArea } from './session-provider.tsx'

/** Selector hook over the Session Controller list and current selection. */
export type UseSessions = SnapshotSelectorHook<SessionListState>
/** Selector hook over one Session's lifecycle and control state. */
export type SessionSnapshotSelector = SnapshotSelectorHook<SessionSnapshot>
/** Public name for the Session lifecycle selector hook. */
export type UseSession = SessionSnapshotSelector

/** Common identity carried by every Session-scoped pending interaction. */
export interface SessionPendingInteractionBase {
  /** Opaque request identity; a replacement request must use a new key. */
  readonly key: string
  /** Domain-owned presentation discriminator. */
  readonly kind: string
  /** Session whose UI can answer this interaction. */
  readonly sessionId: SessionId
}

/** Declaration-merged roster of domain-owned pending interaction values. */
export interface SessionPendingInteractionMap {}

/** Every pending interaction contributed by the assembled Client. */
export type SessionPendingInteraction =
  [keyof SessionPendingInteractionMap] extends [never]
    ? SessionPendingInteractionBase
    : SessionPendingInteractionMap[keyof SessionPendingInteractionMap]

/** Current effective pending interaction by Session. */
export type SessionPendingInteractionSnapshot = ReadonlyMap<SessionId, SessionPendingInteraction>
/** Selector hook over Session-scoped pending interactions. */
export type UseSessionPendingInteraction = SnapshotSelectorHook<SessionPendingInteractionSnapshot>

/** Publish one pending interaction and define how plugin teardown delegates it. */
export type PendingInteractionPublisher<T extends SessionPendingInteractionBase> = (
  interaction: T,
  delegate: () => Promise<void>,
) => () => void

interface PendingInteractionEntry<T> {
  readonly interaction: T
  readonly delegate: () => Promise<void>
}

/**
 * 类说明：PendingInteractionDomain 用于集中封装 处理 PendingInteractionDomain 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 client/ui-session 在对应插件或业务生命周期内创建和调用。
 */
class PendingInteractionDomain<T extends SessionPendingInteractionBase> {
  /**
   * 常量说明：values 用于处理 values 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly values = new Map<string, PendingInteractionEntry<T>>()

  /**
   * 功能说明：处理 PendingInteractionDomain 相关流程；使用场景由所在模块及调用位置决定。
   * @param precedence （(interaction: T) => number）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param changed （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new PendingInteractionDomain(precedence, changed) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    readonly precedence: (interaction: T) => number,
    private readonly changed: () => void,
  ) {}

  /**
   * 功能说明：处理 valuesSnapshot 相关流程；使用场景由所在模块及调用位置决定。
   * @returns readonly T[]；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 valuesSnapshot()，并按返回类型处理结果。
   */
  valuesSnapshot(): readonly T[] {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
     */
    return [...this.values.values()].map(entry => entry.interaction)
  }

  /**
   * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
   * @param interaction （T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param delegate （() => Promise<void>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns () => void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publish(interaction, delegate)，并按返回类型处理结果。
   */
  publish(interaction: T, delegate: () => Promise<void>): () => void {
    if (this.values.has(interaction.key)) {
      throw new Error(`ui-session: duplicate pending interaction key '${interaction.key}'`)
    }
    this.values.set(interaction.key, { interaction, delegate })
    this.changed()
    /**
     * 变量说明：active 用于处理 active 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let active = true
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => {
      if (!active) return
      active = false
      if (!this.values.delete(interaction.key)) return
      this.changed()
    }
  }

  /** Remove every pending value and return the operations that settle their owners.
   * @remarks 中文说明：功能说明：处理 release 相关流程；使用场景由所在模块及调用位置决定。；返回值：readonly (() =>
   * Promise<void>)[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * release()，并按返回类型处理结果。 */
  release(): readonly (() => Promise<void>)[] {
    /**
     * 常量说明：delegates 用于处理 delegates 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
     */
    const delegates = [...this.values.values()].map(entry => entry.delegate)
    this.values.clear()
    return delegates
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface GlobalStandardProps {
    /** Session list and current selection. */
    useSessions: UseSessions
    /** Pending user interaction presented by a Session-scoped UI consumer. */
    useSessionPendingInteraction: UseSessionPendingInteraction
  }

  interface SessionStandardProps {
    /** Current Session lifecycle and control state. */
    useSession: SessionSnapshotSelector
    /** Current Session identity. */
    sessionId: SessionId
    /** Host-computed projection values addressed by projection key. */
    useProjection: UseProjection
  }

  interface SessionMaybeStandardProps {
    /** Current Session state, absent while no Session is selected. */
    useSession: MaybeSnapshotSelectorHook<SessionSnapshot>
    /** Current Session identity, absent while no Session is selected. */
    sessionId: SessionId | undefined
    /** Host-computed projection values; every key is absent without a Session. */
    useProjection: UseProjection
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session Controller adapter and session-scoped source registry. */
    uiSession: UiSession
  }
}

type SessionSourceRoster = readonly string[] | undefined
type StandardMemberKind = 'hook' | 'keyed hook' | 'prop'

type SessionSourceRecord<Roster extends SessionSourceRoster, Value> =
  Roster extends readonly string[] ? Readonly<Record<Roster[number], Value>> : never

/** Bare values produced by one Session-scoped source contribution. */
export interface SessionSourceContribution<
  Hooks extends SessionSourceRoster = SessionSourceRoster,
  KeyedHooks extends SessionSourceRoster = SessionSourceRoster,
  Props extends SessionSourceRoster = SessionSourceRoster,
> {
  readonly hooks?: SessionSourceRecord<Hooks, HostObservable<unknown>>
  readonly keyedHooks?: SessionSourceRecord<KeyedHooks, KeyedStandardSource>
  readonly props?: SessionSourceRecord<Props, unknown>
}

/** Static roster and per-Session resolver for one standard-props contribution. */
export interface SessionSourceDescriptor<
  Hooks extends SessionSourceRoster = SessionSourceRoster,
  KeyedHooks extends SessionSourceRoster = SessionSourceRoster,
  Props extends SessionSourceRoster = SessionSourceRoster,
> {
  readonly hooks?: Hooks
  readonly keyedHooks?: KeyedHooks
  readonly props?: Props
  /**
   * Resolve every declared member for one Session binding.
   * @param binding - Controller-owned Session binding.
   * @returns all declared bare sources and stable props.
   * @remarks 中文说明：功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：binding（SessionBinding）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：SessionSourceContribution< NoInfer<Hooks>, NoInfer<KeyedHooks>,
   * NoInf…；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resolve(binding)，
   * 并按返回类型处理结果。
   */
  resolve(binding: SessionBinding): SessionSourceContribution<
    NoInfer<Hooks>,
    NoInfer<KeyedHooks>,
    NoInfer<Props>
  >
}

interface RuntimeSessionSourceContribution {
  readonly hooks?: Readonly<Record<string, HostObservable<unknown>>>
  readonly keyedHooks?: Readonly<Record<string, KeyedStandardSource>>
  readonly props?: Readonly<Record<string, unknown>>
}

interface RuntimeSessionSourceDescriptor {
  readonly hooks?: readonly string[]
  readonly keyedHooks?: readonly string[]
  readonly props?: readonly string[]
  /**
   * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
   * @param binding （SessionBinding）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns RuntimeSessionSourceContribution；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolve(binding)，并按返回类型处理结果。
   */
  resolve(binding: SessionBinding): RuntimeSessionSourceContribution
}

type RuntimePendingDomain = PendingInteractionDomain<SessionPendingInteractionBase>

interface MaterializedBinding {
  readonly owner: SessionBinding
  readonly value: ScopedStandardSourceBinding
  readonly release: () => void
}

/**
 * 常量说明：BUILTIN_SOURCE 用于处理 BUILTIN_SOURCE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：binding（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(binding)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
 */
const BUILTIN_SOURCE = {
  hooks: ['session'],
  keyedHooks: ['projection'],
  props: ['sessionId'],
  resolve: binding => ({
    hooks: { session: binding.session },
    keyedHooks: { projection: key => binding.session.projections.faceOf(key) },
    props: { sessionId: binding.sessionId },
  }),
} satisfies SessionSourceDescriptor<
  readonly ['session'],
  readonly ['projection'],
  readonly ['sessionId']
>

/** Session-scoped source roster and renderer adapter.
 * @remarks 中文说明：类说明：UiSession 用于集中封装 处理 UiSession 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 client/ui-session 在对应插件或业务生命周期内创建和调用。 */
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
export class UiSession extends Service {
  /**
   * 常量说明：descriptors 用于处理 descriptors 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly descriptors: RuntimeSessionSourceDescriptor[] = [
    BUILTIN_SOURCE,
  ]
  /**
   * 变量说明：bindings 用于处理 bindings 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private bindings = new Map<SessionId, MaterializedBinding>()
  /**
   * 变量说明：absent 用于处理 absent 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private absent: StandardSourceBinding
  /**
   * 变量说明：currentBinding 用于处理 currentBinding 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private currentBinding: StandardSourceBinding
  /**
   * 常量说明：currentListeners 用于处理 currentListeners 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly currentListeners = new Set<() => void>()
  /**
   * 常量说明：pendingDomains 用于处理 pendingDomains 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly pendingDomains: RuntimePendingDomain[] = []
  /**
   * 变量说明：pendingSnapshot 用于处理 pendingSnapshot 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private pendingSnapshot: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map()
  /**
   * 常量说明：pendingListeners 用于处理 pendingListeners 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly pendingListeners = new Set<() => void>()
  /** Root source of pending UI interactions, independent from Controller snapshots.
   * @remarks 中文说明：常量说明：pendingInteractions 用于处理 pendingInteractions 相关数据，
   * 作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly pendingInteractions: HostObservable<SessionPendingInteractionSnapshot> = {
    getSnapshot: () => this.pendingSnapshot,
    subscribe: (listener) => {
      this.pendingListeners.add(listener)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return () => { this.pendingListeners.delete(listener) }
    },
  }
  /** Renderer-facing adapter for `session` and `session-maybe` scopes.
   * @remarks 中文说明：常量说明：adapter 用于处理 adapter 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly adapter: SlotScopeAdapter

  /**
   * @param ctx - Client root context.
   * @param sessions - Controller-owned Session object layer.
   * @remarks 中文说明：功能说明：处理 UiSession 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
   * 参数说明：sessions（ISessions）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new UiSession(ctx, sessions) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    ctx: Context,
    private readonly sessions: ISessions,
  ) {
    super(ctx, 'uiSession')
    this.absent = this.materializeAbsent()
    this.currentBinding = this.resolveCurrent()
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
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
     */
    this.adapter = {
      current: {
        getSnapshot: () => this.currentBinding,
        subscribe: (listener) => {
          this.currentListeners.add(listener)
          /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
          return () => { this.currentListeners.delete(listener) }
        },
      },
      resolve: key => this.resolve(key as SessionId),
      renderArea: renderSessionArea,
    }

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.effect(() => {
      /**
       * 常量说明：disposeList 用于处理 disposeList 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      const disposeList = sessions.list.subscribe(() => { this.publishCurrent() })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return () => {
        disposeList()
        /**
         * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const records = [...this.bindings.values()]
        this.bindings.clear()
        /**
         * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const record of records) record.release()
      }
    }, 'ui-session: Session binding projection')
  }

  /**
   * Register one Session-scoped standard-source contribution.
   * @param descriptor - static member roster and per-binding resolver.
   * @returns disposer owned by the caller's Cordis fiber.
   * @remarks 中文说明：功能说明：处理 provide 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：descriptor（SessionSourceDescriptor<Hooks, KeyedHooks,
   * Props>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 provide(descriptor)，并按返回类型处理结果。
   */
  provide<
    const Hooks extends SessionSourceRoster = undefined,
    const KeyedHooks extends SessionSourceRoster = undefined,
    const Props extends SessionSourceRoster = undefined,
  >(descriptor: SessionSourceDescriptor<Hooks, KeyedHooks, Props>): () => void {
    /**
     * 常量说明：runtimeDescriptor 用于处理 runtimeDescriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const runtimeDescriptor = descriptor as unknown as RuntimeSessionSourceDescriptor
    /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const dispose = this.ctx.effect(() => {
      this.descriptors.push(runtimeDescriptor)
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        this.rebuildBindings()
      } catch (error) {
        this.descriptors.pop()
        throw error
      }
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return () => {
        /**
         * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const index = this.descriptors.indexOf(runtimeDescriptor)
        this.descriptors.splice(index, 1)
        this.rebuildBindings()
      }
    }, 'uiSession.provide()')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { void dispose() }
  }

  /**
   * Register one pending-interaction domain and return its publication function.
   * Domain teardown first removes its visible values, then delegates and awaits
   * every still-active owner request.
   * @param precedence - deterministic cross-domain precedence; larger values win.
   * @returns a function that publishes one interaction and its teardown delegation.
   * @remarks 中文说明：功能说明：注册 Pending Interaction 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：precedence（(interaction: T) => number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * ；返回值：PendingInteractionPublisher<T>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 registerPendingInteraction(precedence)，并按返回类型处理结果。
   */
  registerPendingInteraction<T extends SessionPendingInteractionBase>(
    precedence: (interaction: T) => number,
  ): PendingInteractionPublisher<T> {
    /**
     * 常量说明：domain 用于处理 domain 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const domain = new PendingInteractionDomain(precedence, () => {
      this.publishPendingInteractions()
    })
    /**
     * 常量说明：runtimeDomain 用于处理 runtimeDomain 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const runtimeDomain = domain as unknown as RuntimePendingDomain
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.ctx.effect(() => {
      this.pendingDomains.push(runtimeDomain)
      this.publishPendingInteractions()
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return async () => {
        /**
         * 常量说明：delegates 用于处理 delegates 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const delegates = domain.release()
        /**
         * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const index = this.pendingDomains.indexOf(runtimeDomain)
        this.pendingDomains.splice(index, 1)
        this.publishPendingInteractions()
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：delegate（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(delegate)，并按返回类型处理结果。
         */
        await Promise.allSettled(delegates.map(delegate => Promise.resolve().then(delegate)))
      }
    }, 'uiSession.registerPendingInteraction()')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：interaction（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：delegate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(interaction, delegate)，
     * 并按返回类型处理结果。
     */
    return (interaction, delegate) => domain.publish(interaction, delegate)
  }

  /**
   * 功能说明：处理 rebuildBindings 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rebuildBindings()，并按返回类型处理结果。
   */
  private rebuildBindings(): void {
    /**
     * 常量说明：absent 用于处理 absent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const absent = this.materializeAbsent()
    /**
     * 常量说明：bindings 用于处理 bindings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bindings = new Map<SessionId, MaterializedBinding>()
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 变量说明：sessionId、cached 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const [sessionId, cached] of this.bindings) {
        bindings.set(sessionId, this.createMaterializedBinding(cached.owner))
      }
    } catch (error) {
      /**
       * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const record of bindings.values()) record.release()
      throw error
    }
    /**
     * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const previous = this.bindings
    this.absent = absent
    this.bindings = bindings
    /**
     * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const record of previous.values()) record.release()
    this.publishCurrent()
  }

  /**
   * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
   * @param key （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ScopedStandardSourceBinding | undefined；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolve(key)，并按返回类型处理结果。
   */
  private resolve(key: SessionId): ScopedStandardSourceBinding | undefined {
    /**
     * 常量说明：owner 用于处理 owner 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const owner = this.sessions.binding(key)
    if (owner === undefined) return undefined
    /**
     * 常量说明：cached 用于处理 cached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cached = this.bindings.get(key)
    if (cached?.owner === owner) return cached.value
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = this.createMaterializedBinding(owner)
    this.bindings.set(key, record)
    cached?.release()
    return record.value
  }

  /**
   * 功能说明：解析 Current 相关流程；使用场景由所在模块及调用位置决定。
   * @returns StandardSourceBinding；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolveCurrent()，并按返回类型处理结果。
   */
  private resolveCurrent(): StandardSourceBinding {
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = this.sessions.list.getSnapshot().current
    return current === undefined ? this.absent : this.resolve(current) ?? this.absent
  }

  /**
   * 功能说明：处理 publishCurrent 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publishCurrent()，并按返回类型处理结果。
   */
  private publishCurrent(): void {
    /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const next = this.resolveCurrent()
    if (next === this.currentBinding) return
    this.currentBinding = next
    notifySubscribers(this.currentListeners, '[ui-session] current binding')
  }

  /**
   * 功能说明：处理 publishPendingInteractions 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publishPendingInteractions()，并按返回类型处理结果。
   */
  private publishPendingInteractions(): void {
    /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const next = new Map<SessionId, {
      interaction: SessionPendingInteractionBase
      precedence: number
    }>()
    /**
     * 变量说明：domain 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const domain of this.pendingDomains) {
      /**
       * 变量说明：interaction 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const interaction of domain.valuesSnapshot()) {
        /**
         * 常量说明：precedence 用于处理 precedence 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const precedence = domain.precedence(interaction)
        /**
         * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const previous = next.get(interaction.sessionId)
        if (previous === undefined || precedence >= previous.precedence) {
          next.set(interaction.sessionId, { interaction, precedence })
        }
      }
    }
    /**
     * 常量说明：projected 用于处理 projected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[sessionId, value]（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([sessionId, value])，
     * 并按返回类型处理结果。
     */
    const projected = new Map(
      [...next].map(([sessionId, value]) => [sessionId, value.interaction] as const),
    )
    if (samePendingInteractions(this.pendingSnapshot, projected)) return
    this.pendingSnapshot = projected
    notifySubscribers(this.pendingListeners, '[ui-session] pending interactions')
  }

  /**
   * 功能说明：创建 Materialized Binding 相关流程；使用场景由所在模块及调用位置决定。
   * @param owner （SessionBinding）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns MaterializedBinding；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 createMaterializedBinding(owner)，并按返回类型处理结果。
   */
  private createMaterializedBinding(owner: SessionBinding): MaterializedBinding {
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = this.materialize(owner)
    /**
     * 常量说明：releaseEffect 用于处理 releaseEffect 相关数据，作用于当前作用域；初始化后不可重新赋值，
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
    const releaseEffect = owner.ctx.effect(() => () => {
      if (this.bindings.get(owner.sessionId) !== record) return
      this.bindings.delete(owner.sessionId)
      if (this.currentBinding !== value) return
      this.currentBinding = this.absent
      notifySubscribers(this.currentListeners, '[ui-session] current binding')
    }, `ui-session: binding ${owner.sessionId}`)
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const record: MaterializedBinding = {
      owner,
      value,
      release: () => { void releaseEffect() },
    }
    return record
  }

  /**
   * 功能说明：处理 materialize 相关流程；使用场景由所在模块及调用位置决定。
   * @param binding （SessionBinding）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ScopedStandardSourceBinding；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 materialize(binding)，并按返回类型处理结果。
   */
  private materialize(binding: SessionBinding): ScopedStandardSourceBinding {
    /**
     * 常量说明：hooks 用于处理 hooks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const hooks: Record<string, HostObservable<unknown>> = {}
    /**
     * 常量说明：keyedHooks 用于处理 keyedHooks 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const keyedHooks: Record<string, KeyedStandardSource> = {}
    /**
     * 常量说明：props 用于处理 props 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const props: Record<string, unknown> = {}
    /**
     * 常量说明：finalProps 用于处理 finalProps 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const finalProps = new Set<string>()
    /**
     * 变量说明：descriptor 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const descriptor of this.descriptors) {
      /**
       * 常量说明：contribution 用于处理 contribution 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const contribution = descriptor.resolve(binding)
      validateContribution(descriptor, contribution)
      copyDeclared('hook', hooks, descriptor.hooks, contribution.hooks, finalProps)
      copyDeclared('keyed hook', keyedHooks, descriptor.keyedHooks, contribution.keyedHooks, finalProps)
      copyDeclared('prop', props, descriptor.props, contribution.props, finalProps)
    }
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value: ScopedStandardSourceBinding = {
      key: binding.sessionId,
      ctx: binding.ctx,
      hooks,
      keyedHooks,
      props,
    }
    this.ctx.slots.bindStoreScope(value)
    return value
  }

  /**
   * 功能说明：处理 materializeAbsent 相关流程；使用场景由所在模块及调用位置决定。
   * @returns StandardSourceBinding；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 materializeAbsent()，并按返回类型处理结果。
   */
  private materializeAbsent(): StandardSourceBinding {
    /**
     * 常量说明：hooks 用于处理 hooks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const hooks: Record<string, undefined> = {}
    /**
     * 常量说明：keyedHooks 用于处理 keyedHooks 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const keyedHooks: Record<string, undefined> = {}
    /**
     * 常量说明：props 用于处理 props 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const props: Record<string, undefined> = {}
    /**
     * 常量说明：finalProps 用于处理 finalProps 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const finalProps = new Set<string>()
    /**
     * 变量说明：descriptor 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const descriptor of this.descriptors) {
      declareAbsent('hook', hooks, descriptor.hooks, finalProps)
      declareAbsent('keyed hook', keyedHooks, descriptor.keyedHooks, finalProps)
      declareAbsent('prop', props, descriptor.props, finalProps)
    }
    return { key: undefined, hooks, keyedHooks, props }
  }
}

/**
 * 功能说明：校验 Contribution 相关流程；使用场景由所在模块及调用位置决定。
 * @param descriptor （RuntimeSessionSourceDescriptor）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param contribution （RuntimeSessionSourceContribution）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 validateContribution(descriptor, contribution)，
 * 并按返回类型处理结果。
 */
function validateContribution(
  descriptor: RuntimeSessionSourceDescriptor,
  contribution: RuntimeSessionSourceContribution,
): void {
  rejectUndeclared('hook', descriptor.hooks, contribution.hooks)
  rejectUndeclared('keyed hook', descriptor.keyedHooks, contribution.keyedHooks)
  rejectUndeclared('prop', descriptor.props, contribution.props)
}

/**
 * 功能说明：处理 rejectUndeclared 相关流程；使用场景由所在模块及调用位置决定。
 * @param kind （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param declared （readonly string[] | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param values （Readonly<Record<string, unknown>> |
 * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rejectUndeclared(kind, declared, values)，并按返回类型处理结果。
 */
function rejectUndeclared(
  kind: string,
  declared: readonly string[] | undefined,
  values: Readonly<Record<string, unknown>> | undefined,
): void {
  /**
   * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const name of Object.keys(values ?? {})) {
    if (!(declared ?? []).includes(name)) {
      throw new Error(`uiSession.provide: undeclared ${kind} '${name}'`)
    }
  }
}

/**
 * 功能说明：处理 copyDeclared 相关流程；使用场景由所在模块及调用位置决定。
 * @param kind （StandardMemberKind）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param target （Record<string, T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param declared （readonly string[] | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param values （Readonly<Record<string, T>> | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param finalProps （Set<string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 copyDeclared(kind, target, declared, values,
 * finalProps)，并按返回类型处理结果。
 */
function copyDeclared<T>(
  kind: StandardMemberKind,
  target: Record<string, T>,
  declared: readonly string[] | undefined,
  values: Readonly<Record<string, T>> | undefined,
  finalProps: Set<string>,
): void {
  /**
   * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const name of declared ?? []) {
    claimStandardProp(kind, name, finalProps)
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = values?.[name]
    if (value === undefined) throw new Error(`uiSession.provide: missing ${kind} '${name}'`)
    target[name] = value
  }
}

/**
 * 功能说明：处理 declareAbsent 相关流程；使用场景由所在模块及调用位置决定。
 * @param kind （StandardMemberKind）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param target （Record<string, undefined>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param declared （readonly string[] | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param finalProps （Set<string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 declareAbsent(kind, target, declared, finalProps)，
 * 并按返回类型处理结果。
 */
function declareAbsent(
  kind: StandardMemberKind,
  target: Record<string, undefined>,
  declared: readonly string[] | undefined,
  finalProps: Set<string>,
): void {
  /**
   * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const name of declared ?? []) {
    claimStandardProp(kind, name, finalProps)
    target[name] = undefined
  }
}

/**
 * 功能说明：处理 claimStandardProp 相关流程；使用场景由所在模块及调用位置决定。
 * @param kind （StandardMemberKind）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param finalProps （Set<string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 claimStandardProp(kind, name, finalProps)，并按返回类型处理结果。
 */
function claimStandardProp(kind: StandardMemberKind, name: string, finalProps: Set<string>): void {
  /**
   * 常量说明：propName 用于处理 propName 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const propName = kind === 'prop' ? name : standardHookPropName(name)
  if (finalProps.has(propName)) {
    throw new Error(`uiSession.provide: duplicate ${kind} '${name}' at prop '${propName}'`)
  }
  finalProps.add(propName)
}

/** Required Controller and renderer services.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject = ['sessions', 'slots']

/**
 * Install the Session root source and scoped adapter.
 * @param ctx - Client Cordis context.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。
 */
export function apply(ctx: Context): void {
  /**
   * 常量说明：service 用于处理 service 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const service = new UiSession(ctx, ctx.sessions)
  ctx.slots.provideRoot({
    hooks: {
      sessions: ctx.sessions.list,
      sessionPendingInteraction: service.pendingInteractions,
    },
  } satisfies RootStandardSourceContribution)
  ctx.slots.installScope('session', service.adapter)
}

/**
 * 功能说明：处理 samePendingInteractions 相关流程；使用场景由所在模块及调用位置决定。
 * @param left （ReadonlyMap<SessionId, SessionPendingInteractionBase>）：提供本次
 * 调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param right （ReadonlyMap<SessionId, SessionPendingInteractionBase>）：提供本
 * 次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 samePendingInteractions(left, right)，并按返回类型处理结果。
 */
function samePendingInteractions(
  left: ReadonlyMap<SessionId, SessionPendingInteractionBase>,
  right: ReadonlyMap<SessionId, SessionPendingInteractionBase>,
): boolean {
  if (left.size !== right.size) return false
  /**
   * 变量说明：sessionId、interaction 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [sessionId, interaction] of left) {
    if (right.get(sessionId) !== interaction) return false
  }
  return true
}
