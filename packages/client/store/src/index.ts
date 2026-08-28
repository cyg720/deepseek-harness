/*
 * ================================ 文件注释 ================================
 * 【文件职责】快照存储引擎（zustand vanilla + immer + subscribeWithSelector
 *   + rafFlush 中间件 + 可选 persist + 开发期冻结）及其声明式外壳：
 *   defineStore 把 init/persist/actions 字面量烘焙成 StoreHandle。
 * 【技术维度】数据层自持引擎，引擎产物是裸可观察对象（subscribe/getSnapshot/
 *   update/set，无 selector 钩子）；选择器钩子由 ui-renderer 合成（唯一的
 *   uSES 桥，在绑定点按源缓存）。
 * 【产品维度】会话/工作区等 UI 状态需要统一的可写快照存储：immer 草稿
 *   变异、raf 合并通知、localStorage 持久化、开发期深冻结防意外变更。
 * 【逻辑维度】createSnapshotStore 建引擎（含 raf 批处理与持久化）；
 *   defineStore 声明存储（init/persist/actions），create 产出引擎实例；
 *   attachPersistence 手写 JSON 持久化；devFreeze 深冻结。
 * 【关键边界】持久化是手写实现而非 zustand persist 中间件（其 partialize
 *   会展开原始值状态造成损坏）；存储失败只禁用持久化，绝不破坏存储。
 * 【新手阅读建议】先读 ui-slots 的 StoreSpec/StoreHandle 契约再回来看实现。
 * ==========================================================================
 */
/**
 * React-free snapshot store engine (zustand vanilla + immer + subscribeWithSelector +
 * rafFlush middleware + opt-in persist + dev freeze) plus the declarative
 * shell over it: {@link defineStore} bakes an init/persist/actions literal
 * into a {@link StoreHandle}, the registration-side store seat of slot
 * terminals. Engine products are bare observables — subscribe/getSnapshot/
 * update/set, NO selector hook. Hook synthesis is ui-renderer's (the one
 * uSES bridge, cached per source at the binding site).
 */
/*
 * 快照存储引擎（zustand vanilla + immer + subscribeWithSelector + rafFlush
 * 中间件 + 可选 persist + 开发期冻结）以及其上的声明式外壳：defineStore
 * 把 init/persist/actions 字面量烘焙成 StoreHandle——槽位端点的注册侧存储
 * 座位。位于无 React 运行时中（数据层拥有引擎；ui-renderer 只是 React
 * 胶水）：引擎产物是裸可观察对象——subscribe/getSnapshot/update/set，
 * 没有选择器钩子。钩子合成是 ui-renderer 的事（唯一 uSES 桥，在绑定点
 * 按数据源缓存）。
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import { shallow } from 'zustand/shallow'
import { freeze, produce } from 'immer'
import type {
  ActionsDecl, BakedActions, ObservableSnapshot, StoreHandle, StoreInstance, StoreSpec,
} from './contract.ts'

// Store contract types are ui-slots authority; re-exported beside the engine
// so store consumers get one import path.
// 存储契约类型以 ui-slots 为权威；在引擎旁再导出，让存储消费方只有一个
// 导入路径。
export type {
  ActionsDecl, BakedActions, BoundActions, DefineStore, HandleOf, MaybeSnapshotSelectorHook,
  ObservableSnapshot, PropsStore, SnapshotSelectorHook, StoreDecl, StoreFactory,
  StoreHandle, StoreInstance, StoreSpec,
} from './contract.ts'

/** Writable snapshot store (bare data face; React selector hooks are synthesized in ui-renderer). */
/* 可写快照存储（裸数据面；React 选择器钩子在 ui-renderer 合成）。 */
export interface SnapshotStore<T> extends ObservableSnapshot<T> {
  /**
   * Mutate the state through an immer draft.
   * @param mutator - draft mutator.
   */
  /*
   * 通过 immer 草稿变更状态。
   * @param mutator 草稿变更函数。
   */
  update(mutator: (draft: T) => void): void
  /**
   * Replace the state wholesale.
   * @param next - next state.
   */
  /*
   * 整体替换状态。
   * @param next 下一个状态。
   */
  set(next: T): void
}

/**
 * Notify an observer set without allowing one callback to starve the rest.
 * @param listeners - current observer callbacks; copied before dispatch.
 * @param label - diagnostic owner prefix.
 * @param args - callback arguments.
 */
export function notifySubscribers<Args extends readonly unknown[]>(
  listeners: Iterable<(...args: Args) => void>,
  label: string,
  ...args: Args
): void {
  for (const listener of [...listeners]) {
    try {
      listener(...args)
    } catch (error) {
      console.error(`${label} subscriber failed:`, error)
    }
  }
}

/**
 * Shallow equality for selector slices (zustand/shallow semantics; travels
 * with the engine so hook consumers need no zustand dependency).
 * @param a - left value.
 * @param b - right value.
 * @returns whether the values are shallowly equal.
 */
/*
 * 选择器切片的浅比较（zustand/shallow 语义；随引擎提供，钩子消费方无需
 * 依赖 zustand）。
 * @param a 左侧值。
 * @param b 右侧值。
 * @returns 两值是否浅相等。
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  return shallow(a, b)
}

/** Batches subscriber notification into one flush per animation frame. */
/* 把订阅者通知批处理为每动画帧一次冲刷。 */
function rafBatch(notify: () => void): () => void {
  // Fall back to microtask batching where rAF is absent (node unit tests);
  // both preserve the N-changes=1-notification contract within a tick.
  // 没有 rAF 时（node 单元测试）回退到微任务批处理；两者都在一个 tick 内
  // 保持"N 次变更 = 1 次通知"的契约。
  const schedule: (fn: () => void) => void =
    typeof requestAnimationFrame === 'function'
      ? (fn) => { requestAnimationFrame(() => { fn() }) }
      : (fn) => { queueMicrotask(fn) }
  let scheduled = false
  return () => {
    if (scheduled) return
    scheduled = true
    schedule(() => {
      scheduled = false
      notify()
    })
  }
}

/**
 * Create a snapshot store.
 *
 * Flush default is 'sync' (controlled inputs need same-tick echo); frame-driven
 * stores opt into 'raf', where a frame's worth of updates coalesces into one
 * notification. Known raf-mode tradeoff: a component mounting mid-frame reads
 * fresh state while existing subscribers hear it next flush — transient
 * frame-level skew, same nature as the object layer's microtask batching.
 *
 * @param init - initial state.
 * @param opts - flush mode and opt-in persistence (localStorage, keyed by name).
 * @returns the store.
 */
/*
 * 创建一个快照存储。
 *
 * 默认冲刷为 'sync'（受控输入需要同 tick 回显）；帧驱动的存储选择 'raf'，
 * 一帧内的更新合并成一次通知。已知的 raf 模式权衡：帧中途挂载的组件读到
 * 新鲜状态，而既有订阅者到下次冲刷才听到——瞬态帧级偏差，与对象层的
 * 微任务批处理同性质。
 *
 * @param init 初始状态。
 * @param opts 冲刷模式与可选的持久化（localStorage，以 name 为键）。
 * @returns 该存储。
 */
export function createSnapshotStore<T>(
  init: T, opts?: { flush?: 'raf' | 'sync'; persist?: { name: string } }): SnapshotStore<T> {
  // Immer enters through produce() in update() below (identical semantics to
  // the immer middleware without its setState-signature mutator generics).
  // immer 经由下方 update() 里的 produce() 进入（与 immer 中间件语义相同，
  // 但没有其 setState 签名的 mutator 泛型）。
  const withSelector = subscribeWithSelector(() => init)
  const api: StoreApi<T> = createStore<T>()(withSelector)
  if (opts?.persist) attachPersistence(api, opts.persist.name)

  let subscribe = (fn: () => void) => api.subscribe(() => {
    notifySubscribers([fn], '[client-store]')
  })
  if (opts?.flush === 'raf') {
    const listeners = new Set<() => void>()
    const flush = rafBatch(() => { notifySubscribers(listeners, '[client-store]') })
    api.subscribe(flush)
    subscribe = (fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    }
  }

  return {
    getSnapshot: () => api.getState(),
    subscribe: fn => subscribe(fn),
    update: (mutator) => {
      // Immer's produce (not setState's partial-merge path) so scalar and
      // array roots replace correctly; produce also freezes in dev.
      // 用 immer 的 produce（而非 setState 的局部合并路径），使标量与数组
      // 根正确替换；produce 在开发期也会冻结。
      api.setState(produce(api.getState(), (draft) => { mutator(draft as T) }), true)
    },
    set: (next) => {
      api.setState(devFreeze(next), true)
    },
  }
}

/**
 * Whole-value JSON persistence to localStorage. Hand-rolled instead of the
 * zustand persist middleware: its write path spreads state into an object
 * (`partialize({ ...get() })`), exploding primitive state (a persisted string
 * draft becomes {0:'h',1:'e',...}) — not fixable via merge/deserialize options
 * because the corruption happens before serialization. Storage failures
 * (quota, private mode) only disable persistence, never break the store.
 */
/*
 * 整体值 JSON 持久化到 localStorage。手写实现而非 zustand persist 中间件：
 * 后者的写路径把状态展开成对象（partialize({ ...get() })），会把原始值
 * 状态炸开（持久化的字符串草稿变成 {0:'h',1:'e',...}）——无法通过
 * merge/deserialize 选项修复，因为损坏发生在序列化之前。存储失败
 * （配额、隐私模式）只禁用持久化，绝不破坏存储。
 */
function attachPersistence<T>(api: StoreApi<T>, name: string): void {
  // Non-browser runs (node e2e booting the client tree) have no localStorage:
  // persistence silently disables — same contract as a storage failure, minus
  // the per-store console noise a ReferenceError would produce.
  // 非浏览器运行（启动客户端树的 node e2e）没有 localStorage：持久化静默
  // 禁用——与存储失败的契约相同，且没有 ReferenceError 每存储一次的噪音。
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(name)
    if (raw !== null) {
      api.setState(devFreeze(JSON.parse(raw) as T), true)
    }
  } catch (error) {
    console.error(`snapshot store '${name}' rehydration failed:`, error)
  }
  api.subscribe((state) => {
    try {
      localStorage.setItem(name, JSON.stringify(state))
    } catch (error) {
      console.error(`snapshot store '${name}' persistence failed:`, error)
    }
  })
}

/** Deep-freeze draftable wholesale-set state outside production: set() bypasses immer's freeze. */
function devFreeze<T>(value: T): T {
  if (process.env.NODE_ENV === 'production') return value
  return freeze(value, true)
}

// ui-slots owns the contract; this module supplies the engine implementation.
// ui-slots 拥有契约；本模块提供引擎实现。

/** A live engine instance: the contract instance plus the raw engine store. */
/* 一个活跃的引擎实例：契约实例 + 原始引擎存储。 */
export interface EngineStoreInstance<T, A extends ActionsDecl<T>> extends StoreInstance<T, A> {
  /** The underlying engine store (framework/test API; components never see it). */
  /* 底层引擎存储（框架/测试 API；组件永远看不到它）。 */
  readonly store: SnapshotStore<T>
}

/** The engine-backed handle: create() narrowed to the engine instance. */
/* 引擎支撑的句柄：create() 收窄为引擎实例。 */
export interface EngineStoreHandle<T, A extends ActionsDecl<T>> extends StoreHandle<T, A> {
  /**
   * Construct a live engine instance (see the contract JSDoc on
   * {@link StoreHandle.create} for scopeKey/persist semantics).
   *
   * Known boundary: the persist key is the storage identity, so multiple live
   * instances created under the same resolved key share (and cross-pollute)
   * one localStorage entry. Instance uniqueness per key is the caller's
   * responsibility — production is safe because the framework caches one
   * instance per handle x scope key; tests wanting isolation use distinct
   * scope keys or persist-free declarations (multi-create freedom is a
   * feature there, so create() deliberately does not dedupe or throw).
   * @param scopeKey - session id for session-scope instances; omitted for root scope.
   * @returns the engine instance.
   */
  /*
   * 构造一个活跃的引擎实例（scopeKey/persist 语义见 StoreHandle.create 的
   * 契约 JSDoc）。
   *
   * 已知边界：persist 键即存储身份，因此同一解析键下创建的多个活跃实例
   * 共享（并互相污染）同一个 localStorage 条目。每键实例唯一是调用方的
   * 责任——生产环境安全，因为框架按 句柄 x 作用域键 缓存一个实例；想要
   * 隔离的测试使用不同作用域键或无持久化声明（那里的多次创建自由是特性，
   * 因此 create() 刻意不去重也不抛错）。
   * @param scopeKey 会话作用域实例传会话 id；根作用域省略。
   * @returns 引擎实例。
   */
  create(scopeKey?: string): EngineStoreInstance<T, A>
}

/**
 * Declare a store: initial state, optional persistence, and the full write
 * set as pure draft mutators. The returned handle is the registration
 * currency of the store seat — its identity keys instance sharing. Satisfies
 * ui-slots' DefineStore contract (the handle/instance are the engine-extended
 * subtypes).
 *
 * The `A & ActionsDecl<T>` actions position is load-bearing: T resolves from
 * `init` in the first inference round, and the intersection then contextually
 * types each mutator's draft parameter (context-sensitive functions defer),
 * so call sites write `(d, x: X) => { ... }` with no draft annotation. If a
 * future TS version breaks this single-literal inference, the design's
 * documented fallback is currying (`defineStore(init).actions({...})`).
 * @param decl - init lambda (fresh state per instance), optional persist key, actions table.
 * @returns the store handle.
 */
/*
 * 声明一个存储：初始状态、可选持久化，以及完整的写操作集（纯草稿变异）。
 * 返回的句柄是存储座位的注册货币——其身份键控实例共享。满足 ui-slots 的
 * DefineStore 契约（句柄/实例是引擎扩展的子类型）。
 *
 * A & ActionsDecl<T> 的 actions 位置是承重的：T 在第一轮推断中从 init
 * 解析，随后交集对每个 mutator 的草稿参数做上下文类型化（上下文敏感函数
 * 会推迟），因此调用点可写 (d, x: X) => { ... } 而无需标注草稿类型。
 * 若未来 TS 版本破坏这种单字面量推断，设计的有文档回退是柯里化
 * （defineStore(init).actions({...})）。
 * @param decl init 函数（每实例全新状态）、可选 persist 键、actions 表。
 * @returns 存储句柄。
 */
export function defineStore<T, A extends ActionsDecl<T>>(
  decl: StoreSpec<T, A> & { actions: A & ActionsDecl<T> }): EngineStoreHandle<T, A> {
  return {
    spec: decl,
    create(scopeKey?: string): EngineStoreInstance<T, A> {
      const persistKey = decl.persist === undefined
        ? undefined
        : scopeKey === undefined ? decl.persist : `${decl.persist}.${scopeKey}`
      const store = createSnapshotStore<T>(
        decl.init(),
        persistKey !== undefined ? { persist: { name: persistKey } } : undefined)
      const actions = {} as Record<string, (...params: unknown[]) => void>
      for (const key of Object.keys(decl.actions)) {
        const mutate = decl.actions[key] as (draft: T, ...params: unknown[]) => void
        actions[key] = (...params: unknown[]) => { store.update((draft) => { mutate(draft, ...params) }) }
      }
      return {
        actions: actions as BakedActions<T, A>,
        getSnapshot: () => store.getSnapshot(),
        subscribe: fn => store.subscribe(fn),
        store,
        clearPersisted: () => {
          if (persistKey === undefined || typeof localStorage === 'undefined') return
          try {
            localStorage.removeItem(persistKey)
          } catch {
            // Storage failures (private mode, quota teardown races) only skip
            // cleanup — the same non-fatal contract as attachPersistence.
            // 存储失败（隐私模式、配额拆除竞争）只跳过清理——与
            // attachPersistence 相同的非致命契约。
          }
        },
      }
    },
  }
}
