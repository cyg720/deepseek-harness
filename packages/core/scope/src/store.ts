/**
 * ================================ 文件注释 ================================
 * 【文件职责】作用域感知注册表的共享存储基元：插入有序的命名/匿名条目表，以及按作用域分层（全局层 + 精确作用域层）的注册所有权管理。
 * 【技术维度】NamedEntries/AnonymousEntries 用 Map 保序；ScopedLayers 用 scopeChainOf 沿父链取层，effect 通过 ctx.effect 把注册生命周期挂到 Cordis 纤维。
 * 【产品维度】支撑“同一工具/同名前缀在不同 agent 作用域下互不干扰”的能力，是 agent 隔离与 guard 分层的基础设施。
 * 【逻辑维度】ScopeLayer/EntryValues 契约 → NamedEntries → AnonymousEntries → ScopedLayers（global 层 + peek/chainLayers/merge/effect）。
 * 【关键边界】读取不创建层；完全清空的层才回收；merge 时最近的层覆盖名字；迭代器只在非空表代内 live，清空后脱离后续插入。
 * 【新手阅读建议】先看 ScopedLayers.effect 的 generator 生命周期，再看 merge 如何把全局层与链上层合并出“有效视图”。
 * ==========================================================================
 */
/**
 * Shared insertion-ordered storage and effect ownership for scope-aware registries.
 *
 * @module @deepseek-ai/dsh-scope
 */

import type { Context } from '@deepseek-ai/cordis'
import { scopeChainOf, scopeOf } from './index.ts'
import type { ScopeKey } from './index.ts'

/** One scope's aggregate contribution to a registry. */
// 单个作用域对一个注册表的整体贡献层：合并视图会按层读取其中的条目表。
export interface ScopeLayer {
  /** Whether every table in this layer is empty. */
  // 该层所有表是否都为空（决定层是否可被回收）。
  isEmpty(): boolean
}

/** Internal common read contract for the two entry-table implementations. */
// 两种条目表共有的内部读取契约（values + isEmpty），供 ScopedLayers 统一操作。
interface EntryValues<V> {
  values(): IterableIterator<V>
  isEmpty(): boolean
}

/**
 * Insertion-ordered named entries with caller-owned duplicate diagnostics.
 *
 * Values are borrowed. Iterators are live within one nonempty table
 * generation; draining the table detaches them from later insertions. Each
 * successful insertion returns an idempotent undo for that exact entry.
 */
// 插入有序的“命名条目表”：同名的重复插入由调用方提供错误信息拒绝。
// 值是被“借用”存放的；迭代器只在当前这张非空表内有效，表被清空换新后脱离后续插入。
export class NamedEntries<V> implements EntryValues<V> {
  // 数据本体：Map 天然保插入序。
  private data = new Map<string, V>()

  constructor(
    // 重复名的错误构造器：由注册表业务方提供，以便给出带上下文的错误消息。
    private readonly duplicateError: (name: string) => Error,
  ) {}

  /**
   * Insert one unique name.
   * @param name - name unique within this table.
   * @param value - borrowed value to retain.
   * @returns an idempotent undo that removes only this insertion.
   */
  // 插入一个唯一名字的条目；返回幂等撤销函数（重复调用只生效一次）。
  insert(name: string, value: V): () => void {
    const data = this.data
    if (data.has(name)) throw this.duplicateError(name)
    data.set(name, value)
    let active = true
    return () => {
      if (!active) return
      active = false
      data.delete(name)
      // 表被清空时换一张新 Map：使正在外泄的迭代器脱离后续插入（迭代器契约）。
      if (data.size === 0 && this.data === data) this.data = new Map()
    }
  }

  /**
   * Read one named value.
   * @param name - name to resolve.
   * @returns the retained value, or `undefined` when absent.
   */
  // 按名字读取条目。
  get(name: string): V | undefined {
    return this.data.get(name)
  }

  /**
   * Test one name for membership.
   * @param name - name to test.
   * @returns whether the table contains that name.
   */
  // 判断名字是否已存在。
  has(name: string): boolean {
    return this.data.has(name)
  }

  /**
   * Iterate live names in insertion order.
   * @returns the native live key iterator.
   */
  // 按插入序迭代名字（原生 Map 迭代器，保持 live）。
  keys(): IterableIterator<string> {
    return this.data.keys()
  }

  /**
   * Iterate live entries in insertion order.
   * @returns the native live entry iterator.
   */
  // 按插入序迭代 [名字, 值] 对。
  entries(): IterableIterator<[string, V]> {
    return this.data.entries()
  }

  /**
   * Iterate live values in insertion order.
   * @returns the native live value iterator.
   */
  // 按插入序迭代值。
  values(): IterableIterator<V> {
    return this.data.values()
  }

  /**
   * Test whether this table has no entries.
   * @returns whether the table is empty.
   */
  // 表是否为空。
  isEmpty(): boolean {
    return this.data.size === 0
  }
}

/**
 * Insertion-ordered anonymous entries with independent registration identity.
 *
 * Equal values remain separate registrations. Values are borrowed, and
 * iterators are live within one nonempty table generation; draining the table
 * detaches them from later appends.
 */
// 插入有序的“匿名条目表”：每个 append 用独立 Symbol 作键，即使值相等也是两次独立注册。
export class AnonymousEntries<V> implements EntryValues<V> {
  // 数据本体：Symbol 键保证每次追加都有唯一注册身份。
  private data = new Map<symbol, V>()

  /**
   * Append one independently owned value.
   * @param value - borrowed value to retain.
   * @returns an idempotent undo for this exact append.
   */
  // 追加一个独立条目；返回幂等撤销函数。
  append(value: V): () => void {
    const data = this.data
    const key = Symbol()
    data.set(key, value)
    let active = true
    return () => {
      if (!active) return
      active = false
      data.delete(key)
      // 清空后换新表，脱离外泄迭代器。
      if (data.size === 0 && this.data === data) this.data = new Map()
    }
  }

  /**
   * Iterate live values in insertion order.
   * @returns the native live value iterator.
   */
  // 按插入序迭代值。
  values(): IterableIterator<V> {
    return this.data.values()
  }

  /**
   * Test whether this table has no entries.
   * @returns whether the table is empty.
   */
  // 表是否为空。
  isEmpty(): boolean {
    return this.data.size === 0
  }
}

/**
 * Own the global and exact-scope layers for one registry.
 *
 * Reads never create scoped layers. Registrations derive both visibility and
 * effect ownership from the supplied Cordis context, collect undo before
 * notification, and reclaim only a completely empty aggregate layer.
 */
// 为一个注册表管理“全局层 + 各精确作用域层”：读取不创建层，注册的可见性与生命周期都跟随传入的 ctx。
export class ScopedLayers<L extends ScopeLayer> {
  /** The eagerly constructed context-global layer. */
  // 全局层：注册表启动时立即创建，所有无作用域上下文的注册都进这一层。
  readonly global: L

  // 精确作用域层表：按作用域键存放各层，只有真正产生注册时才创建。
  private readonly scoped = new Map<ScopeKey, L>()

  constructor(
    // 层工厂：给定作用域键（undefined 表示全局层）创建新层。
    private readonly createLayer: (scope: ScopeKey | undefined) => L,
    // 变更通知：层内容发生变化时回调（用于让注册表重算缓存或广播）。
    private readonly onChange: () => void,
  ) {
    this.global = createLayer(undefined)
  }

  /**
   * Read an existing exact-scope overlay. Deliberately chain-blind: callers
   * addressing one scope's OWN contributions (its restrictions, its guards)
   * must not silently pick up an ancestor's — use {@link chainLayers} where
   * inheritance is the point.
   * @param scope - exact scope key; `undefined` denotes no overlay.
   * @returns the existing scoped layer, or `undefined` without creating one.
   */
  // 精确读取某一作用域自己的层（不看祖先）：读“自己的限制/守卫”时必须精确，避免误取祖先的。
  peek(scope: ScopeKey | undefined): L | undefined {
    if (scope === undefined) return undefined
    return this.scoped.get(scope)
  }

  /**
   * Existing overlays along the scope's parent chain ({@link scopeChainOf}),
   * farthest ancestor first and the exact scope last, so a caller layering
   * them in order gives the nearest scope the final word.
   * @param scope - viewing scope, or `undefined` for no overlays.
   * @returns the existing layers, nearest last; absent overlays are skipped.
   */
  // 沿父链收集已存在的层（最远祖先在前、最近作用域在后）：按序叠放时最近作用域拥有最终发言权。
  chainLayers(scope: ScopeKey | undefined): L[] {
    const layers: L[] = []
    for (const key of scopeChainOf(scope).reverse()) {
      const layer = this.scoped.get(key)
      if (layer !== undefined) layers.push(layer)
    }
    return layers
  }

  /**
   * Materialize global named entries followed by scope-chain shadows,
   * farthest ancestor first, so the nearest scope's entry wins a name.
   * @param scope - viewing scope, or `undefined` for the global view.
   * @param pick - select the named table from a layer.
   * @returns an insertion-ordered effective map.
   */
  // 合并出“有效命名视图”：先铺全局层，再按父链由远及近覆盖同名条目，最近的层胜出。
  merge<V>(
    scope: ScopeKey | undefined,
    pick: (layer: L) => NamedEntries<V>,
  ): Map<string, V> {
    const merged = new Map(pick(this.global).entries())
    for (const layer of this.chainLayers(scope)) {
      for (const [name, value] of pick(layer).entries()) merged.set(name, value)
    }
    return merged
  }

  /**
   * Attach one synchronous layer mutation to its registration context.
   * @param ctx - context that determines both scope visibility and effect ownership.
   * @param action - atomic mutation returning its synchronous undo.
   * @param options - Cordis effect label and optional change notification.
   * @returns the exact disposer returned by `ctx.effect()`.
   */
  // 把一次同步的层变更挂到 ctx 的生命周期上：变更在 effect 内执行，undo 在 effect 拆除时执行。
  effect(
    ctx: Context,
    action: (layer: L) => () => void,
    options: { label: string; notify?: boolean },
  ): () => void {
    const scope = scopeOf(ctx)
    const notify = options.notify ?? true
    const dispose = ctx.effect(function* (this: ScopedLayers<L>) {
      let layer: L
      let created = false
      // 按上下文的作用域键选层：无作用域用全局层；有作用域则取现有层或新建。
      if (scope === undefined) {
        layer = this.global
      } else {
        const existing = this.scoped.get(scope)
        if (existing === undefined) {
          layer = this.createLayer(scope)
          this.scoped.set(scope, layer)
          created = true
        } else {
          layer = existing
        }
      }

      let undo: () => void
      try {
        undo = action(layer)
      } catch (error) {
        // 新建的层如果 action 抛错且为空，立即回收，避免留下空壳层。
        if (scope !== undefined && created && layer.isEmpty()) this.scoped.delete(scope)
        throw error
      }

      yield () => {
        undo()
        // 层被完全清空后回收；随后通知注册表。
        if (scope !== undefined && layer.isEmpty()) this.scoped.delete(scope)
        if (notify) this.onChange()
      }
      // 注册生效时也通知一次（让依赖方在“出现”时就感知）。
      if (notify) this.onChange()
    }.bind(this), options.label)
    // oxlint-disable-next-line typescript/no-misused-promises -- exact synchronous disposer preserves Cordis effect identity
    return dispose
  }
}
