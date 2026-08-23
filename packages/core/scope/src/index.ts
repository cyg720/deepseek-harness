/**
 * ================================ 文件注释 ================================
 * 【文件职责】作用域（scope）核心原语：创建带身份标签的 Cordis 作用域上下文（createScope）、构建仅路由用的事件载体（scopeTarget）、以及作用域父子链的绑定与查询。
 * 【技术维度】用 WeakMap 存载体键与父子链；作用域标签以 Symbol 属性挂在上下文中，子 ctx 继承；事件向祖先方向流动（ancestor 监听者接收后代事件），注册视图向子孙方向继承。
 * 【产品维度】让同一份插件代码能为多个 agent 实例各持一份状态、各自过滤事件，是“多 agent 并存”的隔离基础。
 * 【逻辑维度】类型与内部表（ScopeKey/Scoped/carrierKeys/scopeParents）→ 父子链 API（bindScopeParent/scopeParentOf/scopeChainOf）
 * → Scope/createScope → 查询与载体 API（scopeOf/scopeTarget/isScopeCarrier/carrierKeyOf）。
 * 【关键边界】父链绑定一次性且防环；createScope 的 ctx 拥有其名下所有注册；事件沿链向上流动、绝不向下；载体不暴露主体属性，主体只能从事件负载取。
 * 【新手阅读建议】先看 scopeTarget 的 filter 实现理解“事件如何按作用域过滤”，再看 createScope 与 bindScopeParent 理解父子关系。
 * ==========================================================================
 */
/**
 * Scoped-context primitive: mint a Cordis context that tags registrations with
 * an opaque identity and build routing-only event carriers for that identity.
 *
 * @module @deepseek-ai/dsh-scope
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import { Context as CordisContext } from '@deepseek-ai/cordis'

export { AnonymousEntries, NamedEntries, ScopedLayers } from './store.ts'
export type { ScopeLayer } from './store.ts'

/** An opaque, identity-compared scope key. */
// 作用域键：任意对象即可充当，按对象身份（引用相等）比较，不暴露任何业务字段。
export type ScopeKey = object

/** Context tag written by {@link createScope}. */
// 作用域标签：createScope 把键以这个 Symbol 属性挂到作用域上下文上，子 ctx 继承该属性。
const kScope = Symbol('dsh.scope')

declare const ScopedBrand: unique symbol

/**
 * A routing-only event receiver built by {@link scopeTarget}. The type
 * parameter records the subject type for dispatch checking; the carrier does
 * not expose the subject's properties. Event payloads carry the real subject.
 */
// 作用域载体类型：一个只用于事件路由的接收器，类型参数 T 只参与编译期校验，
// 载体本身不暴露主体的任何属性——真正的 agent 主体始终在事件负载里。
export type Scoped<T extends object> = object & { readonly [ScopedBrand]: T }

/** The key associated with each carrier. Presence distinguishes an unkeyed carrier from a non-carrier. */
// 载体 → 作用域键 的弱映射：值可能是 undefined（无键载体），但“键存在”本身就标志“这是一个载体”。
const carrierKeys = new WeakMap<object, ScopeKey | undefined>()

/**
 * The enclosing scope of each key. One relation powers both directions of
 * scope nesting: registration views inherit DOWN the chain (a child scope
 * sees its ancestors' layers — {@link ScopedLayers}), and event admission
 * extends UP it (a listener tagged with an ancestor receives events dispatched
 * to a descendant key — {@link scopeTarget}).
 */
// 作用域父子链：一个键只有一个父键。注册视图沿链向下继承（子作用域能看到祖先的层），
// 事件接收沿链向上扩展（带祖先标签的监听器能收到后代键分发的事件）。
const scopeParents = new WeakMap<ScopeKey, ScopeKey>()

/** The privileged handle to move one scope key's parent link. */
// 父链重绑的“特权句柄”：只有最初执行绑定的调用方拿到它，才能移动该键的父链。
export interface ScopeParentBinding {
  /**
   * Re-link the bound key to a different parent, with the same cycle check as
   * the bind. Valid only while nothing produced under the old parent is
   * retained — the blank-session recompose contract, which the holder upholds
   * because this relation cannot see what a session logged.
   * @param parent - the new enclosing scope key.
   */
  // 重新绑定父键：与 bind 一样做防环检查；仅在旧父链下没有遗留产物时调用（空白会话重组契约）。
  rebind(parent: ScopeKey): void
}

/** Cycle-checked write shared by the bind and every rebind. */
// 父链写入的公共实现：从新父键向上走到根，若途中遇到 key 自身则说明会成环，抛错拒绝。
function linkScopeParent(key: ScopeKey, parent: ScopeKey): void {
  for (let cursor: ScopeKey | undefined = parent; cursor !== undefined; cursor = scopeParents.get(cursor)) {
    if (cursor === key) throw new Error('dsh-scope: scope parent link would form a cycle')
  }
  scopeParents.set(key, parent)
}

/**
 * Bind `parent` as `key`'s enclosing scope, once.
 *
 * A key that already has a parent throws: there is no open re-link path, so a
 * scope's ancestry cannot be moved by anyone but the original binder, who
 * alone receives the {@link ScopeParentBinding}. A link that would close a
 * cycle is rejected, because every chain consumer walks parents to the root.
 * @param key - the child scope key.
 * @param parent - its enclosing scope key.
 * @returns the binding that alone may re-link this key.
 */
// 一次性绑定父链：已绑定过的键再次绑定会抛错（重绑只能通过返回的句柄）；成环同样被拒。
export function bindScopeParent(key: ScopeKey, parent: ScopeKey): ScopeParentBinding {
  if (scopeParents.has(key)) {
    throw new Error('dsh-scope: scope key is already bound to a parent; re-linking requires the binding returned by the original bind')
  }
  linkScopeParent(key, parent)
  return {
    rebind(next: ScopeKey): void {
      linkScopeParent(key, next)
    },
  }
}

/**
 * Read one key's enclosing scope.
 * @param key - the scope key to inspect.
 * @returns its parent key, or `undefined` for a root scope.
 */
// 读取一个键的父键；没有父键的是根作用域，返回 undefined。
export function scopeParentOf(key: ScopeKey): ScopeKey | undefined {
  return scopeParents.get(key)
}

/**
 * The chain from a key to its root ancestor.
 * @param key - the starting key, or `undefined` for the empty chain.
 * @returns keys nearest-first: `[key, parent, grandparent, …]`.
 */
// 从给定键一路向上收集到根的键链（就近优先）；输入 undefined 得到空链。
export function scopeChainOf(key: ScopeKey | undefined): ScopeKey[] {
  const chain: ScopeKey[] = []
  for (let cursor = key; cursor !== undefined; cursor = scopeParents.get(cursor)) chain.push(cursor)
  return chain
}

/** A minted registration scope and its quiescent disposal boundaries. */
// 一个创建好的作用域：携带专属上下文，并给出两种拆除边界。
export interface Scope {
  /** Context through which scope-owned registrations are made. */
  // 作用域上下文：所有“归本作用域所有”的注册都通过它完成。
  ctx: Context
  /** Exact Cordis disposer, used when nesting this scope in an ordered composite effect. */
  // 精确的 Cordis 拆除器：用于把本作用域嵌套进有序的复合 effect 时保持拆除顺序。
  rawDispose: () => Promise<void> | void
  /** Dispose every scope-owned registration; racing calls await the same completion. */
  // 拆除全部作用域注册；并发调用共享同一个完成时机（幂等）。
  dispose(): Promise<void>
}

/** Follow a Cordis fiber through asynchronous teardown even if its raw disposer was already claimed. */
// 静默拆除辅助：即使 rawDisposer 已被占用，也继续跟随纤维完成异步拆除并等待惯性（inertia）收尾。
async function quiesceFiber(fiber: Fiber): Promise<void> {
  await Promise.resolve(fiber.dispose())
  while (fiber.inertia !== undefined) await fiber.inertia
}

/** Shared no-op plugin used as the backing scope fiber. */
// 空插件：createScope 用它创建一个独立的 Cordis 纤维作为作用域的生命周期底座。
function scope(): void {}

/** Options accepted by {@link createScope}. */
// createScope 的可选参数。
export interface CreateScopeOptions {
  /** Enclosing scope bound via {@link bindScopeParent} before the scope is usable; the binding stays internal. */
  // 可选的父作用域键：指定后在建作用域前先完成父链绑定（绑定句柄留在内部，不对外暴露）。
  parent?: ScopeKey
}

/**
 * Mint a scope under `ctx`. The scoped context inherits the minting plugin's
 * dependency API and owns every registration made through it.
 * @param ctx - active context whose dependency API the scope inherits.
 * @param key - opaque identity used for listener routing.
 * @param options - optional scope-chain placement.
 * @returns the scoped context and exact/shared disposal boundaries.
 */
// 创建作用域：派生一个带作用域标签的 ctx 和其专属纤维；返回的 ctx 拥有其名下所有注册的生命周期。
export function createScope(ctx: Context, key: ScopeKey, options?: CreateScopeOptions): Scope {
  if (options?.parent !== undefined) bindScopeParent(key, options.parent)
  const fiber = ctx.plugin(scope)
  const scoped: Context = fiber.ctx.extend({ [kScope]: key })
  let disposing: Promise<void> | undefined
  return {
    ctx: scoped,
    rawDispose: fiber.dispose,
    dispose: () => (disposing ??= quiesceFiber(fiber)),
  }
}

/**
 * Read the nearest scope tag inherited by a context.
 * @param ctx - context to inspect.
 * @returns its scope key, or `undefined` for an unscoped context.
 */
// 读取上下文继承到的作用域键：context 通过原型链继承 kScope 属性，这里直接读取最近的标签。
export function scopeOf(ctx: Context): ScopeKey | undefined {
  return (ctx as Context & { [kScope]?: ScopeKey })[kScope]
}

/**
 * Build an opaque receiver that preserves the base filter, admits untagged
 * listeners globally, and admits tagged listeners for a matching key or any
 * of its ancestors ({@link bindScopeParent}): a listener owned by an enclosing
 * scope receives every descendant scope's events, which is what lets one
 * standing composition observe each of the agents composed under it. A tag
 * BELOW the dispatch key stays excluded — events flow up the chain, never
 * down.
 * @param base - subject or service whose existing Cordis filter is preserved.
 * @param key - routed scope identity, or `undefined` for an unscoped subject.
 * @returns a carrier whose subject remains available only through event arguments.
 */
// 构建作用域载体：保留 base 原有的过滤逻辑，再叠加作用域过滤——
// 无标签的监听器全局接收；有标签的监听器接收“同键或祖先键”分发的事件（事件只向上流动，不向下）。
export function scopeTarget<T extends object>(base: T, key: ScopeKey | undefined): Scoped<T> {
  const baseFilter = (base as { [CordisContext.filter]?: (ctx: Context) => boolean })[CordisContext.filter]
  const carrier = {
    [CordisContext.filter](ctx: Context): boolean {
      if (baseFilter !== undefined && !baseFilter.call(base, ctx)) return false
      const tag = scopeOf(ctx)
      if (tag === undefined) return true
      // 沿分发键的父链向上找：命中当前上下文的作用域标签才放行。
      for (let cursor = key; cursor !== undefined; cursor = scopeParents.get(cursor)) {
        if (cursor === tag) return true
      }
      return false
    },
  }
  carrierKeys.set(carrier, key)
  return carrier as unknown as Scoped<T>
}

/**
 * Test whether a value is a scope carrier.
 * @param value - dispatch receiver to inspect.
 * @returns whether {@link scopeTarget} created it.
 */
// 判断一个值是否由 scopeTarget 创建的载体（用于运行时校验）。
export function isScopeCarrier(value: unknown): value is Scoped<object> {
  return typeof value === 'object' && value !== null && carrierKeys.has(value)
}

/**
 * Read a carrier's routing key.
 * @param value - dispatch receiver to inspect.
 * @returns the carrier key, or `undefined` for an unkeyed/non-carrier value.
 */
// 读取载体的路由键；非载体或无键载体返回 undefined。
export function carrierKeyOf(value: unknown): ScopeKey | undefined {
  if (!isScopeCarrier(value)) return undefined
  return carrierKeys.get(value)
}
