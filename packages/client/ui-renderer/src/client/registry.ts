/*
 * ================================ 文件注释 ================================
 * 【文件职责】SlotRegistry：槽位系统在 Cordis 服务层的实现——纯核心
 *   SlotCore 之上的运行时层，负责事件桥、生命周期注入、渲染器安装与
 *   存储实例轴（handle x scope key）。
 * 【技术维度】继承 Cordis Service；register 通过原型方法 + ctx.effect 把
 *   注册挂到调用方 fiber（卸载级联）；类型擦除（Erased*）统一处理。
 * 【产品维度】UI 由插槽（slot）拼装：布局声明座位，功能包注册条目，
 *   渲染器渲染树；本文件是"注册 -> 渲染"的运行时中枢。
 * 【逻辑维度】模块 doc 说明与 SlotCore 的分工；声明合并定义 'root' 槽；
 *   inject 按声明生命周期安装 effect；install/installLocale 安装渲染器
 *   与本地化面；renderSlot 渲染根；存储轴管理实例生命周期。
 * 【关键边界】'root' 是单槽且被 ui-layout 占用，不得再注册（会遮蔽）；
 *   register 必须是原型方法（箭头属性会冻结 this 导致插件级清理失效）。
 * 【新手阅读建议】先读 ui-slots 的 SlotCore，再读本类的 register/inject。
 * ==========================================================================
 */
/**
 * SlotRegistry: the renderer-owned Cordis service over the pure
 * SlotCore (ui-slots owns registration semantics, the declaration ledger,
 * the load-time validations, and the unload cascade). This layer owns what
 * needs a live application: the 'slots/changed' event bridge, register and
 * declaration injection through the caller's ctx.effect (fiber unload
 * collects both), the renderer installation contract (install()/renderSlot('root') +
 * the SlotRendererHost face), and the store INSTANCE axis — handle x scope
 * key -> create/cache, dropped with the last holding entry, session instances
 * cleared (with persisted state) on scope death.
 */
/*
 * SlotRegistry：槽位系统的 Cordis 服务层，位于纯 SlotCore 之上（ui-slots
 * 拥有注册语义、声明账本、加载期校验与卸载级联）。本层拥有需要运行时的
 * 部分：'slots/changed' 事件桥；通过调用方 ctx.effect 做注册与声明注入
 * （fiber 卸载会同时收集两者）；渲染器安装契约（install()/renderSlot('root')
 * + SlotRendererHost 面）；以及存储实例轴——handle x scope key -> 创建/缓存，
 * 随最后一个持有条目丢弃，会话实例在作用域死亡时清除（连同持久化状态）。
 */
/* oxlint-disable typescript/no-redundant-type-constituents --
 * `keyof SlotMap & string` is the declare-merge key pattern: SlotMap only
 * holds this package's 'root' row in this compilation unit, but consumers
 * merge keys in; the rule fires on the narrow-map view, not on real
 * redundancy. */
/* oxlint 禁用说明：`keyof SlotMap & string` 是声明合并键模式：SlotMap 在
 * 本编译单元只有 'root' 一行，但消费方会合并进更多键；该规则在窄映射
 * 视图上触发，并非真正的冗余。*/
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { SlotCore, standardHookPropName } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  HostObservable, LiveSlotNode, LocaleFace, OwnerOf, SlotEntryDef, SlotMap, SlotRenderer, SlotRendererHost,
  RootStandardSourceContribution, ScopedStandardSourceBinding, SlotScope, SlotScopeAdapter, SlotSpec,
  StandardSourceBinding,
  StoreDecl, StoreFactory, StoredEntry, StoreInstanceLike,
} from '@deepseek-ai/dsh-client-ui-slots'

/** 声明合并：向 SlotMap 注入内置的 'root' 槽位（渲染树根洞）。 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The built-in render-tree root hole (seeded by SlotCore): the one slot the
     * shell itself renders, and the ancestor of every other seat. OCCUPIED by
     * ui-layout's AppFrame, which declares the sidebar, conversation, details,
     * and shell.overlay seats inside it.
     *
     * DO NOT register here. This is a single slot, so a second entry does not
     * sit beside the frame — it shadows it, and a dynamically registered entry
     * is assigned a lower priority than the shipped one, which makes it the
     * winner: the page would render your component alone, with every seat the
     * frame declares gone. For a surface of your own that floats over the whole
     * app, register into `shell.overlay` instead (a list slot: additive, and
     * click-through until your entry opts into pointer events).
     */
    /*
     * 内置的渲染树根洞（由 SlotCore 播种）：shell 自身渲染的唯一槽位，
     * 也是所有其他座位的祖先。已被 ui-layout 的 AppFrame 占用，后者在其内
     * 声明 sidebar、conversation、details 与 shell.overlay 座位。
     *
     * 不要在这里注册。这是单槽：第二个条目不会并排坐在框架旁，而是遮蔽它；
     * 动态注册条目会被赋予比出厂条目更低的优先级，从而成为胜者：页面将
     * 只渲染你的组件，框架声明的所有座位全部消失。若要自己的浮层覆盖整个
     * 应用，请注册到 shell.overlay（列表槽：可叠加；在你的条目选择接收
     * 指针事件前是点击穿透的）。
     */
    'root': { kind: 'single'; scope: 'root'; owner: RootOwnerProps }
  }
}

/** Root owner share: the shell supplies nothing — the frame is inject-assembled. */
/* 根属主份额：shell 不提供任何东西——框架由注入装配。 */
export interface RootOwnerProps { children?: never }

/** Instance key for root-scoped store records (session records key by session id, so the literal cannot collide). */
/* 根作用域存储记录使用的实例键（会话记录按会话 id 键控，因此该字面量不会冲突）。 */
const ROOT_INSTANCE_KEY = 'root'

/** Canonical type-erased store handle used by the runtime lifecycle map. */
/* 运行时生命周期映射使用的规范类型擦除存储句柄。 */
type EngineStoreHandle = Exclude<StoreDecl, StoreFactory>

/** Canonical engine instance derived from the handle's create contract. */
/* 由句柄 create 契约推导的规范引擎实例。 */
type EngineStoreInstance = ReturnType<EngineStoreHandle['create']>

/** Store axis record: one per live handle, dropped when the last holding entry unloads. */
/* 存储轴记录：每个活跃句柄一条，最后一个持有条目卸载时丢弃。 */
interface StoreAxisRecord {
  /** Scope of the slot the handle mounted under (the core validated cross-scope conflicts). */
  /* 句柄挂载所在槽位的作用域（跨作用域冲突已由核心校验）。 */
  scope: SlotScope
  /** Live registrations holding the handle. */
  /* 持有该句柄的活跃注册数。 */
  refs: number
  /** Root scope: the single instance under {@link ROOT_INSTANCE_KEY}; session scope: one per session id. */
  /* 根作用域：ROOT_INSTANCE_KEY 下的单实例；会话作用域：每个会话 id 一个实例。 */
  instances: Map<string, EngineStoreInstance>
}

/** Type-erased options view the implementation works with (the typed overloads proved the shares). */
/* 实现使用的类型擦除选项视图（类型化重载已证明共享面）。 */
interface ErasedRegisterOptions {
  name: string
  children?: Record<string, SlotSpec<SlotEntryDef>>
  store?: StoreDecl
  inject?: (...args: never[]) => Record<string, unknown>
  key?: string
  id?: string
  order?: number
  label?: string
  /** Chain-slot routing selector (pure; the core validates presence for chain targets). */
  /* 链槽路由选择器（纯函数；核心会校验链目标的必选性）。 */
  select?: (owner: never) => unknown
  /** Chain-slot explicit ordering override (ascending; registration order otherwise). */
  /* 链槽显式排序覆盖（升序；否则按注册顺序）。 */
  priority?: number
  /** Declared dictionary namespace (the renderer synthesizes the `t` seat from it). */
  /* 声明的字典命名空间（渲染器从中合成 t 座位）。 */
  locale?: string
  registrant?: string
}

/** Erased core call face (the service re-erases at its own boundary; the core's typed face targets end callers). */
/* 类型擦除的核心调用面（服务在自己的边界再次擦除；核心的类型化面面向最终调用方）。 */
interface ErasedCore { register(options: object, component: unknown): () => void }

/** One synchronous effect installed while an injected slot declaration is live. */
/* 注入的槽位声明存活期间安装的一个同步 effect。 */
type SlotInjectionEffect = (() => void) | Iterable<() => void, void, void>

/** cordis Service layer of the slot system; see the module doc for the split with SlotCore. */
/* 槽位系统的 Cordis 服务层；模块 doc 说明了与 SlotCore 的分工。 */
export class SlotRegistry extends Service {
  private readonly _core = new SlotCore()
  /** Store-instance axis: handle -> mounted scope, refcount, resolved instances. */
  /* 存储实例轴：句柄 -> 挂载作用域、引用计数、已解析实例。 */
  private readonly _stores = new Map<EngineStoreHandle, StoreAxisRecord>()
  /** Latest live Context generation for each scoped store key. */
  private readonly _storeScopeOwners = new Map<string, Context>()
  private _renderer: SlotRenderer | undefined
  private _locale: LocaleFace | undefined
  private _host: SlotRendererHost | undefined
  private readonly _rootContributions: RootStandardSourceContribution[] = []
  private readonly _rootListeners = new Set<() => void>()
  private _rootBinding: StandardSourceBinding = {
    key: undefined,
    hooks: {},
    keyedHooks: {},
    props: {},
  }
  private readonly _rootSource = {
    getSnapshot: (): StandardSourceBinding => this._rootBinding,
    subscribe: (listener: () => void): (() => void) => {
      this._rootListeners.add(listener)
      return () => { this._rootListeners.delete(listener) }
    },
  }
  private readonly _scopes = new Map<Exclude<SlotScope, 'root' | 'session-maybe'>, SlotScopeAdapter>()
  private _scopeRevision = 0
  private readonly _scopeListeners = new Set<() => void>()
  private readonly _scopeRevisionSource: HostObservable<number> = {
    getSnapshot: () => this._scopeRevision,
    subscribe: (listener) => {
      this._scopeListeners.add(listener)
      return () => { this._scopeListeners.delete(listener) }
    },
  }

  /**
   * @param ctx - owning root context.
   */
  /*
   * @param ctx 属主根上下文。
   */
  constructor(ctx: Context) {
    super(ctx, 'slots')
    this._core.onMutate((key) => { ctx.emit('slots/changed', key) }) // 核心变更 -> 运行时事件桥
  }

  /**
   * The single registration API. The typed face IS the core's register
   * (both overloads reused verbatim — one authority, no structural copy;
   * see SlotCore.register for children declaration, store seat, inject
   * face, load-time validation, and the unload cascade). This layer adds:
   * disposal through the caller's ctx.effect (fiber unload = cascade),
   * exclusive-factory minting (`store: createXxxStore` becomes a per-entry
   * handle), the registrant diagnostics stamp, and store-instance lifecycle
   * on the entry axis.
   *
   * Declared here, implemented by prototype assignment below the class: it
   * MUST stay a prototype method (never an instance arrow) — the cordis
   * service proxy binds `this.ctx` to the CALLER's context at call time,
   * which is what routes the effect (and the unload cascade) into the
   * caller's fiber. An arrow property would freeze `this` to the service's
   * own root ctx and silently break per-plugin disposal.
   */
  /*
   * 唯一的注册 API。类型化面就是核心的 register（两个重载原样复用——
   * 单一权威，无结构拷贝；children 声明、存储座位、inject 面、加载期
   * 校验与卸载级联见 SlotCore.register）。本层新增：通过调用方 ctx.effect
   * 的清理（fiber 卸载 = 级联）、独占工厂铸造（store: createXxxStore 成为
   * 每条目句柄）、注册者诊断戳、以及条目轴上的存储实例生命周期。
   *
   * 此处只声明，实现在类下方用原型赋值：它必须保持原型方法（绝不能是
   * 实例箭头）——Cordis 服务代理会在调用时把 this.ctx 绑定到调用方上下文，
   * 正是这一点把 effect（与卸载级联）路由进调用方 fiber。箭头属性会把
   * this 冻结在服务自身根 ctx 上，静默破坏按插件清理。
   */
  declare readonly register: SlotCore['register']

  /**
   * Install an effect for each declaration lifetime of a slot. The callback
   * runs synchronously when the declaration already exists; otherwise it runs
   * inside the declaring `register()` call after the declaration is committed.
   * Collapse disposes the effect and a later declaration runs it again.
   * Callback effects are synchronous disposers; iterable effects install
   * transactionally and dispose in reverse order. The controller belongs to
   * the caller's fiber, so plugin unload cancels a pending wait and removes any
   * active contribution.
   *
   * @param key - declared SlotMap key to depend on.
   * @param callback - creates one disposer or an iterable of disposers.
   * @returns idempotent disposer for the wait and active effect.
   * @throws callback setup failures synchronously when the slot is already declared.
   */
  /*
   * 为某个槽位的每次声明生命周期安装一个 effect。声明已存在时回调同步
   * 运行；否则在声明提交后的 register() 调用内运行。声明消失会销毁 effect，
   * 之后的声明再次运行它。回调 effect 是同步销毁器；可迭代 effect 事务性
   * 安装、逆序销毁。控制器属于调用方 fiber，因此插件卸载会取消待处理等待
   * 并移除任何活跃贡献。
   *
   * @param key 要依赖的已声明 SlotMap 键。
   * @param callback 创建单个销毁器或一组销毁器。
   * @returns 等待与活跃 effect 的幂等销毁器。
   * @throws 槽位已声明时，回调设置失败会同步抛出。
   */
  inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void {
    const ctx = this.ctx
    const disposeController = ctx.effect(() => {
      let active: (() => void) | undefined
      let activeEpoch: number | undefined
      let stopped = false
      let unsubscribe = (): void => {}

      const stop = (): void => {
        if (stopped) return
        // Failure callers retire the injection permanently: a delayed setup
        // failure never retries on a later declaration.
        // 失败调用方永久退役该注入：延迟的设置失败不会在之后的声明上重试。
        stopped = true
        unsubscribe()
        const dispose = active
        active = undefined
        activeEpoch = undefined
        dispose?.()
      }

      const reconcile = (): void => {
        if (stopped) return
        const spec = this._core.specDynamic(key)
        const epoch = this._core.declarationEpoch(key)
        if (active !== undefined && activeEpoch === epoch) return // 声明未变则保持现有 effect
        const dispose = active
        active = undefined
        activeEpoch = undefined
        dispose?.()
        if (spec === undefined) return // 当前无声明：等待下一次变更
        // A declaration lifetime is a nested Cordis effect. This gives
        // generator callbacks the same transactional setup, reverse teardown,
        // diagnostics tree, and idempotence as every other plugin effect.
        // 一次声明生命周期是一个嵌套 Cordis effect。这使生成器回调获得与
        // 其他插件 effect 相同的事务性设置、逆序拆除、诊断树与幂等性。
        const disposeEffect = ctx.effect(callback, `slots.inject(${JSON.stringify(key)}): declaration`)
        active = () => { void disposeEffect() }
        activeEpoch = epoch
      }

      const changed = (): void => {
        try {
          reconcile()
        } catch (error) {
          if ((error as { code?: unknown } | null)?.code === 'INACTIVE_EFFECT') {
            stop()
            return
          }
          stop()
          const failure = error instanceof Error ? error : new Error(String(error))
          queueMicrotask(() => { throw failure }) // 声明已提交后的失败异步抛出，避免打断注册调用
        }
      }

      unsubscribe = this._core.subscribeDeclaration(key, changed)
      try {
        reconcile()
      } catch (error) {
        stop()
        throw error
      }
      return stop
    }, `slots.inject(${JSON.stringify(key)})`)
    return () => { void disposeController() }
  }

  /**
   * Install the shell's renderer (ui-renderer's createSlotRenderer product).
   * Boot-once: a second install throws. Runs through the caller's ctx.effect,
   * so shell fiber unload uninstalls the renderer.
   * @param renderer - the outlet machinery implementing SlotRenderer.
   */
  /*
   * 安装 shell 的渲染器（ui-renderer 的 createSlotRenderer 产物）。
   * 启动一次：二次安装会抛错。经调用方 ctx.effect 运行，因此 shell fiber
   * 卸载会卸载渲染器。
   * @param renderer 实现 SlotRenderer 的输出机制。
   */
  install(renderer: SlotRenderer): void {
    if (this._renderer !== undefined) throw new Error('slot renderer already installed (install() is boot-once)')
    this.ctx.effect(() => {
      this._renderer = renderer
      return () => {
        if (this._renderer === renderer) this._renderer = undefined
      }
    }, 'slots.install()')
  }

  /**
   * Install the locale face backing the `t` standard seat (the locale
   * plugin's product; same boot-once discipline as the renderer install).
   * Runs through the caller's ctx.effect, so the installing fiber's unload
   * uninstalls the face.
   * @param face - namespace binder + revision observable.
   */
  /*
   * 安装支撑 t 标准座位的本地化面（locale 插件的产物；与渲染器安装相同
   * 的启动一次纪律）。经调用方 ctx.effect 运行，因此安装 fiber 的卸载会
   * 卸载该面。
   * @param face 命名空间绑定器 + 修订号可观察对象。
   */
  installLocale(face: LocaleFace): void {
    if (this._locale !== undefined) throw new Error('locale face already installed (installLocale() is boot-once)')
    this.ctx.effect(() => {
      this._locale = face
      return () => {
        if (this._locale === face) this._locale = undefined
      }
    }, 'slots.installLocale()')
  }

  /**
   * Contribute domain-owned root data. Hook names must be globally unique;
   * registration and disposal republish one atomic root binding.
   * @param contribution - bare sources and stable props.
   * @returns disposer owned by the caller's Cordis fiber.
   */
  provideRoot(contribution: RootStandardSourceContribution): () => void {
    const dispose = this.ctx.effect(() => {
      this._rootContributions.push(contribution)
      try {
        this.rebuildRootBinding()
      } catch (error) {
        this._rootContributions.pop()
        throw error
      }
      return () => {
        const index = this._rootContributions.indexOf(contribution)
        if (index === -1) return
        this._rootContributions.splice(index, 1)
        this.rebuildRootBinding()
      }
    }, 'slots.provideRoot()')
    return () => { void dispose() }
  }

  /**
   * Install the owner adapter for one strict scope. Its optional counterpart
   * resolves through the same adapter.
   * @param scope - strict scope name.
   * @param adapter - current/resolved binding source and release notifications.
   */
  installScope(
    scope: Exclude<SlotScope, 'root' | 'session-maybe'>,
    adapter: SlotScopeAdapter,
  ): void {
    if (this._scopes.has(scope)) throw new Error(`slot scope '${scope}' already has an adapter`)
    this.ctx.effect(() => {
      this._scopes.set(scope, adapter)
      this.publishScopeRevision()
      return () => {
        if (this._scopes.get(scope) === adapter) {
          this._scopes.delete(scope)
          this.publishScopeRevision()
        }
      }
    }, `slots.installScope(${JSON.stringify(scope)})`)
  }

  /**
   * Bind all scoped Store handles to one owner Context lifetime. The cleanup
   * materializes an otherwise-unused handle before clearing it, because a
   * previous application run may have persisted state for a Slot that this
   * scope never rendered. Rebinding the same key transfers cleanup ownership
   * to the newest Context generation.
   *
   * @param binding - materialized scope identity and its owning Context.
   */
  bindStoreScope(binding: Pick<ScopedStandardSourceBinding, 'key' | 'ctx'>): void {
    const current = this._storeScopeOwners.get(binding.key)
    if (current === binding.ctx) return
    this._storeScopeOwners.set(binding.key, binding.ctx)
    binding.ctx.effect(() => () => {
      if (this._storeScopeOwners.get(binding.key) !== binding.ctx) return
      this._storeScopeOwners.delete(binding.key)
      this.clearStoreScope(binding.key)
    }, `slots: store scope ${binding.key}`)
  }

  /**
   * The single ctx-level render entry: the shell renders 'root'; every other
   * key renders inside components through the props renderSlot face. All
   * three guards are fail-loud boot-order checks, no fallback.
   * @param key - must be 'root' (runtime-enforced for dynamically composed callers).
   * @param owner - owner share for the root entry (the shell supplies {}).
   * @returns the rendered root tree.
   */
  /*
   * 唯一的 ctx 级渲染入口：shell 渲染 'root'；其他每个键都在组件内通过
   * props 的 renderSlot 面渲染。三道守卫都是 fail-loud 的启动顺序检查，
   * 无回退。
   * @param key 必须是 'root'（对动态组合的调用方做运行时强制）。
   * @param owner 根条目的属主份额（shell 提供 {}）。
   * @returns 渲染出的根树。
   */
  renderSlot<K extends keyof SlotMap & string>(key: K, owner: OwnerOf<K>): ReturnType<SlotRenderer['renderRoot']> {
    // Widened: in this package's own program SlotMap holds only 'root', which
    // would fold the guard to constant-false; the check exists for plain-JS
    // and cross-program callers where K is wider.
    // 已放宽：在本包自己的程序中 SlotMap 只有 'root'，会把这个守卫折叠成
    // 常量 false；该检查面向 K 更宽的纯 JS 与跨程序调用方。
    if ((key as string) !== 'root') {
      throw new Error(`ctx-level renderSlot only renders 'root' (got "${key}"); child slots render through the component props face`)
    }
    if (this._renderer === undefined) {
      throw new Error("slot renderer not installed — boot must call ctx.slots.install(createSlotRenderer()) before rendering 'root'")
    }
    if (this._core.entries('root').length === 0) {
      throw new Error("'root' has no registration — a layout entry must register into 'root' before the shell renders it")
    }
    return this._renderer.renderRoot(this.hostFace(), owner)
  }

  /**
   * Snapshot entries for a key (render-erased view; stable reference between mutations).
   * @param key - SlotMap key.
   * @returns registered entries.
   */
  /*
   * 快照某个键的条目（渲染擦除视图；变更之间引用稳定）。
   * @param key SlotMap 键。
   * @returns 已注册条目。
   */
  entries(key: keyof SlotMap & string): readonly StoredEntry[] {
    return this._core.entries(key)
  }

  /**
   * Shadowing winners per cell for a key: the first live (non-abdicated)
   * entry of each cell in priority order — what outlets render; chain keys
   * pass through unchanged (election consumes every entry). The raw
   * {@link SlotsService.entries} view stays the inspection surface. Fresh
   * array per call, not a uSES getSnapshot source.
   * @param key - SlotMap key.
   * @returns the winning entry per occupied cell.
   */
  /*
   * 每个单元的遮蔽胜者：每个单元按优先级取第一个活跃（未弃权）条目——
   * 即输出口渲染的内容；链键原样通过（选举消费每个条目）。原始
   * entries 视图仍是检查面。每次调用返回新数组，不是 uSES getSnapshot 源。
   * @param key SlotMap 键。
   * @returns 每个已占用单元的胜者条目。
   */
  entriesOfSlot(key: keyof SlotMap & string): readonly StoredEntry[] {
    return this._core.entriesOfSlot(key)
  }

  /**
   * Export the current JSON-safe Slot declaration tree for read-only inspection.
   * @param root - exact live Slot root; omitted returns all roots.
   * @returns selected Slot trees.
   */
  /*
   * 导出当前 JSON 安全的槽位声明树供只读检查。
   * @param root 精确的活跃槽位根；省略返回所有根。
   * @returns 选定的槽位树。
   */
  snapshot(root?: string): LiveSlotNode[] {
    return this._core.snapshot(root)
  }

  /**
   * Observe entry boundary crashes (every render-time entry failure the
   * boundaries contain, abdicating or not) — the supervision seam for
   * plugins mirroring contribution health. Fires synchronously per report,
   * after the registry mutated for abdicating crashes. Callers own the
   * disposer (wire it through ctx.effect for fiber-lifetime cleanup, as with
   * {@link SlotsService.subscribe}).
   * @param fn - called with the slot key, the crashed entry, the crash
   * cause, and `abdicated`: whether the crash retired the entry from its cell.
   * @returns unsubscribe.
   */
  /*
   * 观察条目边界崩溃（边界包含的每次渲染期条目失败，无论是否弃权）——
   * 插件镜像贡献健康度的监督缝。每次报告同步触发，弃权崩溃发生在注册表
   * 变更之后。调用方拥有销毁器（与 subscribe 一样通过 ctx.effect 接线
   * 以获得 fiber 生命周期清理）。
   * @param fn 以槽位键、崩溃条目、崩溃原因与 abdicated（崩溃是否使条目
   *   从其单元退役）调用。
   * @returns 取消订阅函数。
   */
  onEntryError(fn: (key: string, entry: StoredEntry, error: unknown, info: { abdicated: boolean }) => void): () => void {
    return this._core.onEntryError(fn)
  }

  /**
   * Look up a declared spec (register-declared or the built-in 'root').
   * @param key - SlotMap key.
   * @returns spec or undefined.
   */
  /*
   * 查找已声明的 spec（register 声明的或内置的 'root'）。
   * @param key SlotMap 键。
   * @returns spec 或 undefined。
   */
  spec<K extends keyof SlotMap & string>(key: K): SlotSpec<SlotMap[K]> | undefined {
    return this._core.spec(key)
  }

  /**
   * Subscribe to a key's registration changes (microtask-batched).
   * @param key - SlotMap key.
   * @param fn - change callback.
   * @returns unsubscribe.
   */
  /*
   * 订阅某个键的注册变更（微任务批处理）。
   * @param key SlotMap 键。
   * @param fn 变更回调。
   * @returns 取消订阅函数。
   */
  subscribe(key: keyof SlotMap & string, fn: () => void): () => void {
    return this._core.subscribe(key, fn)
  }

  /**
   * Version counter for uSES pairing.
   * @param key - SlotMap key.
   * @returns current version.
   */
  /*
   * 供 uSES 配对的版本计数器。
   * @param key SlotMap 键。
   * @returns 当前版本号。
   */
  getVersion(key: keyof SlotMap & string): number {
    return this._core.getVersion(key)
  }

  /** Delegating registration path: factory minting + registrant stamp + core write + instance-axis bookkeeping. */
  /* 委派注册路径：工厂铸造 + 注册者戳 + 核心写入 + 实例轴记账。 */
  private _register(options: ErasedRegisterOptions, component: unknown): () => void {
    // Exclusive stores pass the factory itself: minted here into a per-entry
    // handle so the stored entry always carries a resolvable handle (the
    // core's shared-handle scope pinning applies to it harmlessly).
    // 独占存储传入工厂本身：在这里铸造为每条目句柄，使存储条目始终携带
    // 可解析的句柄（核心的共享句柄作用域钉扎对它无副作用地适用）。
    const store = typeof options.store === 'function' ? options.store() : options.store
    const registrant = options.registrant ?? (this.ctx.fiber as { name?: string } | undefined)?.name
    const erased: ErasedRegisterOptions = {
      ...options,
      ...(store !== undefined ? { store } : {}),
      ...(registrant !== undefined ? { registrant } : {}),
    }
    // Core write first: all load-time validation (undeclared target,
    // duplicate declaration, kind conflicts, cross-scope handle) throws
    // there before this layer commits anything.
    // 先写核心：所有加载期校验（未声明目标、重复声明、kind 冲突、
    // 跨作用域句柄）都在本层提交任何内容前于核心内抛出。
    const dispose = (this._core as unknown as ErasedCore).register(erased, component)
    if (store !== undefined) {
      const scope = (this._core.specDynamic(options.name) as SlotSpec<SlotEntryDef>).scope
      this._acquire(store, scope)
    }
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      dispose()
      if (store !== undefined) this._release(store)
    }
  }

  /** Build the domain-neutral host face once; installed adapters remain live through getters. */
  private hostFace(): SlotRendererHost {
    if (this._host !== undefined) return this._host
    // `locale` is a live getter: the face installs (and, under HMR, swaps)
    // on the locale plugin's own fiber lifetime, while this host object is
    // built once — a captured value would strand renders on a dead face. The
    // alias is required: `this` inside the getter is the host literal.
    // locale 是活跃 getter：该面在 locale 插件自己的 fiber 生命周期上安装
    // （HMR 下还会换装），而这个 host 对象只构建一次——捕获值会让渲染搁浅
    // 在已死的面上。别名是必需的：getter 内的 this 是 host 字面量。
    // oxlint-disable-next-line typescript/no-this-alias
    const service = this
    this._host = {
      subscribe: (key, fn) => this._core.subscribe(key, fn),
      getVersion: key => this._core.getVersion(key),
      entriesOf: key => this._core.entries(key),
      entriesOfSlot: key => this._core.entriesOfSlot(key),
      reportEntryError: (key, entry, error, info) => { this._core.reportEntryError(key, entry, error, info) },
      specOf: key => this._core.specDynamic(key),
      isLive: entry => this._core.isLive(entry),
      storeOf: (entry, scopeBinding) =>
        entry.store === undefined
          ? undefined
          : this.resolveStore(entry.store as unknown as EngineStoreHandle, scopeBinding),
      root: this._rootSource,
      scopeRevision: this._scopeRevisionSource,
      scope: scope => service._scopes.get(scope === 'session-maybe' ? 'session' : scope),
      get locale() { return service._locale },
    }
    return this._host
  }

  /** Validate and atomically publish the current root contribution roster. */
  private rebuildRootBinding(): void {
    const hooks: Record<string, HostObservable<unknown>> = {}
    const keyedHooks: Record<string, import('@deepseek-ai/dsh-client-ui-slots').KeyedStandardSource> = {}
    const props: Record<string, unknown> = {}
    const finalProps = new Set<string>()
    for (const contribution of this._rootContributions) {
      copyUnique('hook', hooks, contribution.hooks, finalProps, standardHookPropName)
      copyUnique('keyed hook', keyedHooks, contribution.keyedHooks, finalProps, standardHookPropName)
      copyUnique('prop', props, contribution.props, finalProps, name => name)
    }
    this._rootBinding = { key: undefined, hooks, keyedHooks, props }
    for (const listener of [...this._rootListeners]) {
      try {
        listener()
      } catch (error) {
        console.error('root standard-source subscriber failed:', error)
      }
    }
  }

  /** Publish one installed-scope roster transition after the map is authoritative. */
  private publishScopeRevision(): void {
    this._scopeRevision += 1
    for (const listener of [...this._scopeListeners]) {
      try {
        listener()
      } catch (error) {
        console.error('scope-adapter subscriber failed:', error)
      }
    }
  }

  /** Resolve (create or reuse) the store instance for a registered handle under a scope key. */
  private resolveStore(
    handle: EngineStoreHandle,
    scopeBinding: ScopedStandardSourceBinding | undefined,
  ): StoreInstanceLike {
    const record = this._stores.get(handle)
    if (record === undefined) throw new Error('store handle is not registered (entry unloaded, or the handle never went through register)')
    let key: string
    if (record.scope === 'root') {
      key = ROOT_INSTANCE_KEY
    } else {
      if (scopeBinding === undefined) throw new Error(`${record.scope} store resolution requires a session id`)
      key = scopeBinding.key
      this.bindStoreScope(scopeBinding)
    }
    let instance = record.instances.get(key)
    if (instance === undefined) {
      // Session instances get the scope key (the engine suffixes the persist
      // key per session); root instances stay keyless.
      // 会话实例获得作用域键（引擎按会话给 persist 键加后缀）；根实例保持
      // 无键。
      instance = record.scope === 'root' ? handle.create() : handle.create(key)
      record.instances.set(key, instance)
    }
    return instance
  }

  /** Clear every live non-root Store handle for one dead scope key. */
  private clearStoreScope(key: string): void {
    for (const [handle, record] of this._stores) {
      if (record.scope === 'root') continue
      const instance = record.instances.get(key) ?? handle.create(key)
      instance.clearPersisted()
      record.instances.delete(key)
    }
  }

  /** Bind (or re-reference) a handle on the axis; cross-scope conflicts already threw in the core. */
  /* 在轴上绑定（或重新引用）一个句柄；跨作用域冲突已在核心抛错。 */
  private _acquire(handle: EngineStoreHandle, scope: SlotScope): void {
    const record = this._stores.get(handle)
    if (record === undefined) {
      this._stores.set(handle, { scope, refs: 1, instances: new Map() })
      return
    }
    record.refs += 1
  }

  /** Drop one reference; the last holder's unload drops the record (instances go with it — engine stores need no explicit dispose). */
  /* 丢弃一个引用；最后一个持有者卸载时丢弃记录（实例随之而去——引擎存储无需显式销毁）。 */
  private _release(handle: EngineStoreHandle): void {
    const record = this._stores.get(handle)
    /* v8 ignore next -- defensive: release only runs from a disposer whose
     * register acquired the same handle, so the record must exist; kept so a
     * future call site cannot underflow the axis. */
    if (record === undefined) return
    record.refs -= 1
    if (record.refs !== 0) return
    this._stores.delete(handle)
  }
}

function copyUnique<T>(
  kind: string,
  target: Record<string, T>,
  values: Readonly<Record<string, T>> | undefined,
  finalProps: Set<string>,
  propNameOf: (name: string) => string,
): void {
  if (values === undefined) return
  for (const [name, value] of Object.entries(values)) {
    const propName = propNameOf(name)
    if (finalProps.has(propName)) {
      throw new Error(`duplicate root standard ${kind} '${name}' at prop '${propName}'`)
    }
    finalProps.add(propName)
    target[name] = value
  }
}

// register's implementation (prototype assignment pairs with the `declare`
// inside the class — see its JSDoc for why it must live on the prototype).
// Element access reaches the private _register legally and keeps it a
// TS-visible read.
// register 的实现（原型赋值与类内的 declare 配对——为何必须活在原型上
// 见其 JSDoc）。元素访问合法地到达私有 _register，并保持其为 TS 可见读。
;(SlotRegistry.prototype as { register: (options: object, component: unknown) => () => void }).register
  = function register(this: SlotRegistry, rawOptions: object, component: unknown): () => void {
    // The core's overloads proved the shares; the implementation works on
    // the erased view (same pattern as the core's own implementation arm).
    // 核心的重载已证明共享面；实现在擦除视图上工作（与核心自己的实现
    // 臂相同模式）。
    const options = rawOptions as ErasedRegisterOptions
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
    return this.ctx.effect(() => this['_register'](options, component), 'slots.register()')
  }
