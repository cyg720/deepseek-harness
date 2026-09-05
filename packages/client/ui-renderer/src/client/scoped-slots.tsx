/**
 * React renderer for declarative slots. Per-entry bindings enforce child
 * authorization, and entry boundaries contain registrant failures.
 */

/*
 * 【文件职责】将声明式插槽绑定到 React，检查子插槽使用授权并隔离单个注册项的渲染错误。
 */

import { Component, useMemo, useState, useSyncExternalStore, type FC, type ReactNode } from 'react'
import {
  SlotOwnershipError, StaleAuthorizationError, standardHookPropName,
  type ChainRenderOpts, type HostObservable, type KeyedStandardSource, type LocaleFace, type RenderOpts,
  type ScopedStandardSourceBinding, type SessionAreaProps, type SessionProviderComponent, type SlotRenderer,
  type SlotRendererHost, type SlotScope, type SlotScopeAdapter, type StandardSourceBinding,
  type StoredEntry, type Translate,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  HostContext, RootStandardProvider, ScopeProvider, SlotAssemblyError,
  keyedObservableHook, maybeObservableHook, observableHook, useHost, useRootBinding,
  useScopeBinding,
} from './bindings.tsx'

/** 中文说明：类型或类 InjectedProps 约束模块数据或职责。 */
type InjectedProps = Record<string, unknown>

/** 中文说明：类型或类 SlotHookFactory 约束模块数据或职责。 */
type SlotHookFactory = (standard: InjectedProps, hookContext: unknown) => unknown
/** 中文说明：类型或类 SlotHookFactories 约束模块数据或职责。 */
type SlotHookFactories = Readonly<Record<string, SlotHookFactory>>

/** 中文说明：类型或类 BoundSlotInject 约束模块数据或职责。 */
interface BoundSlotInject {
  readonly props: InjectedProps
  readonly slotHookFactories?: SlotHookFactories | undefined
}

/** 中文说明：类型或类 RenderSlotBinding 约束模块数据或职责。 */
type RenderSlotBinding = (key: string, owner: object, opts?: RenderOpts) => ReactNode

/** 中文说明：类型或类 RenderSlotChainBinding 约束模块数据或职责。 */
type RenderSlotChainBinding = (key: string, owner: object, opts?: ChainRenderOpts) => ReactNode

/**
 * Per-entry renderSlot bindings. The binding is identity-stable per entry
 * (memoized components must not resubscribe on unrelated re-renders) and dies
 * with the entry: a retained closure calling after the entry's disposal hits
 * the in-ledger check and throws.
 */
/* 中文说明：模块局部值 renderSlotCache，由紧邻初始化决定。 */
const renderSlotCache = new WeakMap<StoredEntry, RenderSlotBinding>()

/** 中文说明：函数 boundRenderSlot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function boundRenderSlot(host: SlotRendererHost, entry: StoredEntry): RenderSlotBinding {
  /** 中文说明：模块局部值 binding，由紧邻初始化决定。 */
  let binding = renderSlotCache.get(entry)
  if (!binding) {
    binding = (key, owner, opts) => {
      if (!host.isLive(entry)) {
        throw new StaleAuthorizationError(`renderSlot('${key}') from a disposed registration`)
      }
      // Plain-JS backstop; typed callers are narrowed to the declared keys.
      /** 中文说明：模块局部值 declared，由紧邻初始化决定。 */
      const declared = entry.children?.[key]
      if (declared === undefined) {
        throw new SlotOwnershipError(`slot '${key}' is not declared by this entry's children`)
      }
      if (declared.kind === 'chain') {
        throw new SlotOwnershipError(`slot '${key}' is declared 'chain' — use renderSlotChain`)
      }
      return <SlotOutlet slotKey={key} ownerProps={owner} opts={opts} />
    }
    renderSlotCache.set(entry, binding)
  }
  return binding
}

/**
 * Per-entry renderSlotChain bindings: identity-stable per entry (same cache
 * axis as renderSlot — a per-frame dispatch must not rebuild the binding) and
 * dead with the entry. The chain-kind check is the plain-JS backstop twin of
 * the declaration check; typed callers are narrowed to chain keys.
 */
/* 中文说明：模块局部值 renderSlotChainCache，由紧邻初始化决定。 */
const renderSlotChainCache = new WeakMap<StoredEntry, RenderSlotChainBinding>()

/** 中文说明：函数 boundRenderSlotChain 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function boundRenderSlotChain(host: SlotRendererHost, entry: StoredEntry): RenderSlotChainBinding {
  /** 中文说明：模块局部值 binding，由紧邻初始化决定。 */
  let binding = renderSlotChainCache.get(entry)
  if (!binding) {
    binding = (key, owner, opts) => {
      if (!host.isLive(entry)) {
        throw new StaleAuthorizationError(`renderSlotChain('${key}') from a disposed registration`)
      }
      /** 中文说明：模块局部值 declared，由紧邻初始化决定。 */
      const declared = entry.children?.[key]
      if (declared === undefined) {
        throw new SlotOwnershipError(`slot '${key}' is not declared by this entry's children`)
      }
      if (declared.kind !== 'chain') {
        throw new SlotOwnershipError(`slot '${key}' is declared '${declared.kind}', not 'chain' — use renderSlot`)
      }
      return <SlotOutlet slotKey={key} ownerProps={owner} opts={opts} />
    }
    renderSlotChainCache.set(entry, binding)
  }
  return binding
}

/**
 * Inject results cache: root entries per entry, session entries per
 * (entry x scope binding). WeakMap keys are entry/binding objects (both
 * identity-stable per registration/session scope), so cache lifetime rides
 * the same axes as the values it memoizes.
 */
/* 中文说明：模块局部值 rootInjectCache，由紧邻初始化决定。 */
const rootInjectCache = new WeakMap<StoredEntry, InjectedProps>()
const sessionInjectCache = new WeakMap<StoredEntry, WeakMap<StandardSourceBinding, InjectedProps>>()
const sessionMaybeInjectCache = new WeakMap<StoredEntry, WeakMap<StandardSourceBinding, InjectedProps>>()

/** 中文说明：模块局部值 EMPTY_INJECTED_PROPS，由紧邻初始化决定。 */
const EMPTY_INJECTED_PROPS: InjectedProps = {}

function runInject(entry: StoredEntry, binding: StandardSourceBinding | undefined, actions: object | undefined): InjectedProps {
  const inject = entry.inject
  if (!inject) return EMPTY_INJECTED_PROPS
  // Declaration-derived positional arguments: sessionId for session scope,
  // baked actions when a store is declared.
  /** 中文说明：模块局部值 args，由紧邻初始化决定。 */
  const args: unknown[] = []
  if (binding !== undefined) args.push(binding.key)
  if (actions !== undefined) args.push(actions)
  return bindInjectSources((inject as (...args: unknown[]) => InjectedProps)(...args))
}

/** Bind one entry-owned inject face on its existing cache axis. */
function bindInjectSources(face: InjectedProps): InjectedProps {
  const sources = face['hooks']
  const keyedSources = face['keyedHooks']
  if (sources === undefined && keyedSources === undefined) return face
  const { hooks: _hooks, keyedHooks: _keyedHooks, ...rest } = face
  const bound: InjectedProps = rest
  for (const [name, source] of Object.entries(
    (sources ?? {}) as Record<string, HostObservable<unknown>>,
  )) {
    const hookName = standardHookPropName(name)
    bound[hookName] = observableHook(source)
  }
  for (const [name, source] of Object.entries(
    (keyedSources ?? {}) as Record<string, KeyedStandardSource>,
  )) {
    const hookName = standardHookPropName(name)
    bound[hookName] = keyedObservableHook(source)
  }
  return bound
}

/** 中文说明：模块局部值 slotInjectCache，由紧邻初始化决定。 */
const slotInjectCache = new WeakMap<object, BoundSlotInject>()
/** 中文说明：模块局部值 EMPTY_SLOT_INJECT，由紧邻初始化决定。 */
const EMPTY_SLOT_INJECT: BoundSlotInject = { props: EMPTY_INJECTED_PROPS }

/** Normalize one dispatcher-owned inject face by its stable object identity. */
/* 中文说明：函数 cachedSlotInject 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function cachedSlotInject(face: object | undefined): BoundSlotInject {
  if (face === undefined) return EMPTY_SLOT_INJECT
  /** 中文说明：模块局部值 bound，由紧邻初始化决定。 */
  let bound = slotInjectCache.get(face)
  if (bound !== undefined) return bound
  /** 中文说明：模块局部值 definitions，由紧邻初始化决定。 */
  const definitions = (face as InjectedProps)['hooks']
  if (definitions === undefined) {
    bound = { props: face as InjectedProps }
    slotInjectCache.set(face, bound)
    return bound
  }
  /** 中文说明：模块局部值 { hooks，由紧邻初始化决定。 */
  const { hooks: _hooks, ...rest } = face as InjectedProps
  /** 中文说明：模块局部值 props，由紧邻初始化决定。 */
  const props: InjectedProps = rest
  /** 中文说明：模块局部值 解构结果，由紧邻初始化决定。 */
  let factories: Record<string, SlotHookFactory> | undefined
  /** 中文说明：模块局部值 [name，由紧邻初始化决定。 */
  for (const [name, definition] of Object.entries(definitions as Record<string, unknown>)) {
    const hookName = standardHookPropName(name)
    if (typeof definition === 'function') {
      factories ??= {}
      factories[name] = definition as SlotHookFactory
    } else {
      props[hookName] = observableHook(definition as HostObservable<unknown>)
    }
  }
  bound = factories === undefined
    ? { props }
    : { props, slotHookFactories: factories }
  slotInjectCache.set(face, bound)
  return bound
}

/** Bind deferred slot-level factories for one stable renderSlot occurrence. */
/* 中文说明：函数 bindSlotHookFactories 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function bindSlotHookFactories(
  factories: SlotHookFactories,
  standard: InjectedProps,
  hookContext: unknown,
): InjectedProps {
  /** 中文说明：模块局部值 hooks，由紧邻初始化决定。 */
  const hooks: InjectedProps = {}
  /** 中文说明：模块局部值 [name，由紧邻初始化决定。 */
  for (const [name, factory] of Object.entries(factories)) {
    const hookName = standardHookPropName(name)
    hooks[hookName] = factory(standard, hookContext)
  }
  return hooks
}

/** 中文说明：函数 cachedRootInject 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function cachedRootInject(entry: StoredEntry, actions: object | undefined): InjectedProps {
  /** 中文说明：模块局部值 props，由紧邻初始化决定。 */
  let props = rootInjectCache.get(entry)
  if (!props) {
    props = runInject(entry, undefined, actions)
    rootInjectCache.set(entry, props)
  }
  return props
}

function cachedSessionInject(entry: StoredEntry, binding: StandardSourceBinding, actions: object | undefined): InjectedProps {
  let perBinding = sessionInjectCache.get(entry)
  if (!perBinding) {
    perBinding = new WeakMap()
    sessionInjectCache.set(entry, perBinding)
  }
  let props = perBinding.get(binding)
  if (!props) {
    props = runInject(entry, binding, actions)
    perBinding.set(binding, props)
  }
  return props
}

/** 中文说明：函数 cachedSessionMaybeInject 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function cachedSessionMaybeInject(
  entry: StoredEntry,
  binding: StandardSourceBinding,
  actions: object | undefined,
): InjectedProps {
  let perBinding = sessionMaybeInjectCache.get(entry)
  if (!perBinding) {
    perBinding = new WeakMap()
    sessionMaybeInjectCache.set(entry, perBinding)
  }
  let props = perBinding.get(binding)
  if (!props) {
    props = runInject(entry, binding, actions)
    perBinding.set(binding, props)
  }
  return props
}

/**
 * Locale `t` seat bindings, cached per (face, namespace, revision). The
 * revision is part of the cache key ON PURPOSE: a locale switch mints a NEW
 * function reference per namespace, so `React.memo` components taking `t`
 * re-render through ordinary shallow comparison — freshness rides identity,
 * no extra invalidation channel. Within one revision the reference is stable
 * (memoized children do not churn on unrelated re-renders).
 */
/* 中文说明：模块局部值 localeSeatCache，由紧邻初始化决定。 */
const localeSeatCache = new WeakMap<LocaleFace, Map<string, { revision: number; t: Translate }>>()

/** 中文说明：函数 localeSeat 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function localeSeat(face: LocaleFace, ns: string): Translate {
  /** 中文说明：模块局部值 perNs，由紧邻初始化决定。 */
  let perNs = localeSeatCache.get(face)
  if (!perNs) {
    perNs = new Map()
    localeSeatCache.set(face, perNs)
  }
  /** 中文说明：模块局部值 revision，由紧邻初始化决定。 */
  const revision = face.getSnapshot().revision
  /** 中文说明：模块局部值 cached，由紧邻初始化决定。 */
  const cached = perNs.get(ns)
  if (cached && cached.revision === revision) return cached.t
  /** 中文说明：模块局部值 bound，由紧邻初始化决定。 */
  const bound = face.bind(ns)
  // Fresh wrapper per revision: bind() itself may return a stable reference.
  /** 中文说明：模块局部值 t，由紧邻初始化决定。 */
  const t: Translate = (key, params) => bound(key, params)
  perNs.set(ns, { revision, t })
  return t
}

/** 中文说明：模块局部值 noopSubscribe，由紧邻初始化决定。 */
const noopSubscribe = (): (() => void) => () => {}
/** 中文说明：模块局部值 zeroRevision，由紧邻初始化决定。 */
const zeroRevision = (): number => 0

/**
 * Per-face subscribe/getSnapshot closure pair. Cached by face identity: the
 * face is one global source shared by every outlet, and uSES resubscribes
 * whenever the subscribe reference changes — fresh closures per render would
 * churn one unsubscribe/resubscribe pair per outlet per render.
 */
/* 中文说明：模块局部值 localeSubscriptionCache，由紧邻初始化决定。 */
const localeSubscriptionCache = new WeakMap<LocaleFace, {
  subscribe: (fn: () => void) => () => void
  getRevision: () => number
}>()

/** 中文说明：函数 localeSubscription 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function localeSubscription(face: LocaleFace): { subscribe: (fn: () => void) => () => void; getRevision: () => number } {
  /** 中文说明：模块局部值 cached，由紧邻初始化决定。 */
  let cached = localeSubscriptionCache.get(face)
  if (!cached) {
    cached = {
      subscribe: fn => face.subscribe(fn),
      getRevision: () => face.getSnapshot().revision,
    }
    localeSubscriptionCache.set(face, cached)
  }
  return cached
}

/**
 * Subscribe an outlet to the installed locale face's revision (0 while none
 * is installed — exactly one uSES call either way, keeping hook order
 * stable). Every outlet re-renders on a locale switch; entry bodies then
 * re-derive their `t` seat at the new revision. The face must be installed
 * before the first render that needs it — a face appearing later has no
 * notification channel to already-mounted outlets.
 */
/* 中文说明：函数 useLocaleRevision 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function useLocaleRevision(face: LocaleFace | undefined): number {
  /** 中文说明：模块局部值 subscription，由紧邻初始化决定。 */
  const subscription = face !== undefined ? localeSubscription(face) : undefined
  return useSyncExternalStore(
    subscription?.subscribe ?? noopSubscribe,
    subscription?.getRevision ?? zeroRevision,
  )
}

/**
 * Entry-identity React keys for entry boundaries. An outlet renders one
 * winner per position (single/keyed/list cell head, chain election) through
 * an error boundary; without a key, a boundary that failed on entry A would
 * survive a winner change (re-election, shadowing fallback after an
 * abdication, HMR re-registration) and keep a healthy entry B blacked out.
 * Keying by entry identity remounts the boundary fresh whenever the winner
 * changes (entries are identity-stable per registration, so the key is
 * stable while the same entry stays the winner).
 */
/* 中文说明：模块局部值 nextEntryKey，由紧邻初始化决定。 */
let nextEntryKey = 0
/** 中文说明：模块局部值 entryKeys，由紧邻初始化决定。 */
const entryKeys = new WeakMap<StoredEntry, number>()

/** 中文说明：函数 entryKeyOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function entryKeyOf(entry: StoredEntry): number {
  /** 中文说明：模块局部值 key，由紧邻初始化决定。 */
  let key = entryKeys.get(entry)
  if (key === undefined) {
    key = nextEntryKey++
    entryKeys.set(entry, key)
  }
  return key
}

/**
 * Per-entry isolation: one registrant crashing (component render or inject
 * factory) must not take down siblings. Assembly errors (missing providers)
 * rethrow — a miswired shell must fail loud, not degrade into fallbacks.
 * Every catch reports through `onEntryError` (the ledger's supervision
 * seam); for shadowing kinds the report abdicates the entry, the outlet
 * re-renders onto the cell's next survivor, and this boundary's crash face
 * only shows until that re-render lands (permanently once the cell is dry —
 * the outlet then owns the crash face).
 */
/* 中文说明：类型或类 SlotErrorBoundary 约束模块数据或职责。 */
class SlotErrorBoundary extends Component<
  { slotKey: string; onEntryError: (error: unknown) => void; children: ReactNode }, { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError(error: unknown): { failed: boolean } {
    if (error instanceof SlotAssemblyError) throw error
    return { failed: true }
  }
  override componentDidCatch(error: unknown): void {
    console.error(`slot entry crashed in '${this.props.slotKey}':`, error)
    this.props.onEntryError(error)
  }
  override render(): ReactNode {
    if (this.state.failed) return <div data-slot-error={this.props.slotKey} />
    return this.props.children
  }
}

const rootStandardCache = new WeakMap<StandardSourceBinding, InjectedProps>()
const sessionStandardCache = new WeakMap<StandardSourceBinding, WeakMap<StandardSourceBinding, InjectedProps>>()
const sessionMaybeStandardCache = new WeakMap<StandardSourceBinding, WeakMap<StandardSourceBinding, InjectedProps>>()

/** Materialize one binding into stable framework Hook and plain-prop seats. */
function materializeStandardBinding(binding: StandardSourceBinding, optional: boolean): InjectedProps {
  const standard: InjectedProps = { ...binding.props }
  for (const [name, source] of Object.entries(binding.hooks)) {
    if (source === undefined && !optional) {
      throw new SlotAssemblyError(`strict standard hook '${name}' has no source`)
    }
    standard[standardHookPropName(name)] = optional
      ? maybeObservableHook(source)
      : observableHook(source as HostObservable<unknown>)
  }
  for (const [name, source] of Object.entries(binding.keyedHooks)) {
    if (source === undefined && !optional) {
      throw new SlotAssemblyError(`strict keyed standard hook '${name}' has no source resolver`)
    }
    standard[standardHookPropName(name)] = keyedObservableHook(source)
  }
  return standard
}

/** Stable official-props object used by contextual Hook factories. */
/* 中文说明：函数 standardProps 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function standardProps(
  scope: SlotScope,
  rootBinding: StandardSourceBinding,
  scopeBinding: StandardSourceBinding | undefined,
): InjectedProps {
  let root = rootStandardCache.get(rootBinding)
  if (root === undefined) {
    root = materializeStandardBinding(rootBinding, false)
    rootStandardCache.set(rootBinding, root)
  }
  if (scope === 'root') return root
  if (scopeBinding === undefined) throw new SlotAssemblyError(`scope '${scope}' rendered without a standard-source binding`)
  const cache = scope === 'session' ? sessionStandardCache : sessionMaybeStandardCache
  let perScope = cache.get(rootBinding)
  if (perScope === undefined) {
    perScope = new WeakMap()
    cache.set(rootBinding, perScope)
  }
  let standard = perScope.get(scopeBinding)
  if (standard !== undefined) return standard
  standard = {
    ...root,
    ...materializeStandardBinding(scopeBinding, scope === 'session-maybe'),
  }
  perScope.set(scopeBinding, standard)
  return standard
}

const scopeAreaCache = new WeakMap<SlotScopeAdapter, SessionProviderComponent>()

/** Bind one domain-owned scope area renderer to the current scope binding. */
function scopeAreaProvider(adapter: SlotScopeAdapter): SessionProviderComponent {
  let Provider = scopeAreaCache.get(adapter)
  if (Provider !== undefined) return Provider
  if (adapter.renderArea === undefined) {
    throw new SlotAssemblyError("scope 'session' adapter does not provide its area renderer")
  }
  const renderArea = adapter.renderArea.bind(adapter)
  Provider = function ScopeAreaProvider(props: SessionAreaProps): ReactNode {
    return renderArea(useScopeBinding(), props)
  }
  scopeAreaCache.set(adapter, Provider)
  return Provider
}

/**
 * Standard-kit synthesis shared by both scope branches: the global
 * useSessions/useWorkspaces hooks, the per-session provide bundle (every
 * `hooks` source becomes a `use<Name>` selector hook — useSession is the
 * runtime's own 'session' contribution, no special case — and `props` spread
 * verbatim), the store pair when declared, the renderSlot binding when
 * children are declared, and the SessionProvider seat when the children
 * declare a session-scope slot. Hosts hand out BARE observable sources
 * (hooks never cross the host contract); every hook is bound HERE, cached
 * per source (observableHook), so spreading a fresh kit object per render
 * never churns child subscriptions.
 */
/* 中文说明：函数 standardKit 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function standardKit(
  host: SlotRendererHost,
  entry: StoredEntry,
  scope: SlotScope,
  rootBinding: StandardSourceBinding,
  scopeBinding: StandardSourceBinding | undefined,
): {
  kit: InjectedProps
  standard: InjectedProps
  actions: object | undefined
} {
  const standard = standardProps(scope, rootBinding, scopeBinding)
  const kit: InjectedProps = { ...standard }
  if (entry.locale !== undefined) {
    /** 中文说明：模块局部值 face，由紧邻初始化决定。 */
    const face = host.locale
    // Loud assembly failure: locale is immediately-tier infrastructure; a
    // declared namespace with no installed face is a miswired composition.
    if (face === undefined) {
      throw new SlotAssemblyError(
        `entry declares locale namespace '${entry.locale}' but no locale face is installed (locale plugin missing from the composition?)`)
    }
    kit['t'] = localeSeat(face, entry.locale)
  }
  const scopedStoreBinding = scopeBinding?.key === undefined
    ? undefined
    : scopeBinding as ScopedStandardSourceBinding
  const store = host.storeOf(entry, scopedStoreBinding)
  if (store !== undefined) {
    // The instance IS an observable snapshot source (contract getSnapshot/
    // subscribe); the useStore hook binds here, cached per instance.
    kit['useStore'] = observableHook(store)
    kit['actions'] = store.actions
  }
  if (entry.children !== undefined) {
    kit['renderSlot'] = boundRenderSlot(host, entry)
    // renderSlotChain rides the same declaration source: only entries whose
    // children include a chain-kind slot receive the chain dispatch seat.
    if (Object.values(entry.children).some(spec => spec.kind === 'chain')) {
      kit['renderSlotChain'] = boundRenderSlotChain(host, entry)
    }
    // The session owner supplies area semantics; the renderer only binds its
    // adapter to the current generic scope source.
    if (Object.values(entry.children).some(spec => spec.scope === 'session')) {
      const adapter = host.scope('session')
      if (adapter === undefined) {
        throw new SlotAssemblyError("entry declares a session child without an installed 'session' scope adapter")
      }
      kit['SessionProvider'] = scopeAreaProvider(adapter)
    }
  }
  return { kit, standard, actions: store?.actions }
}

/**
 * One rendered entry: standard kit + cached entry inject + common slot inject
 * + owner props (owner wins). The shares are erased at this render boundary;
 * the registration and renderSlot seams already proved their contracts.
 */
/* 中文说明：函数 ContextualEntry 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function ContextualEntry({
  slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext,
}: {
  slotKey: string
  Comp: FC<InjectedProps>
  kit: InjectedProps
  standard: InjectedProps
  injected: InjectedProps
  slotInjected: BoundSlotInject & { readonly slotHookFactories: SlotHookFactories }
  ownerProps: object
  hookContext: unknown
  hasHookContext: boolean
}) {
  /** 中文说明：模块局部值 contextual，由紧邻初始化决定。 */
  const contextual = useMemo(
    () => {
      if (!hasHookContext) {
        throw new SlotAssemblyError(`slot '${slotKey}' has contextual injected Hooks but no hookContext`)
      }
      return bindSlotHookFactories(slotInjected.slotHookFactories, standard, hookContext)
    },
    [hasHookContext, hookContext, slotInjected.slotHookFactories, slotKey, standard],
  )
  return <Comp {...kit} {...injected} {...slotInjected.props} {...contextual} {...ownerProps} />
}

/** 中文说明：函数 renderEntry 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderEntry(
  slotKey: string,
  Comp: FC<InjectedProps>,
  kit: InjectedProps,
  standard: InjectedProps,
  injected: InjectedProps,
  slotInjected: BoundSlotInject,
  ownerProps: object,
  hookContext: unknown,
  hasHookContext: boolean,
): ReactNode {
  if (slotInjected.slotHookFactories === undefined) {
    return <Comp {...kit} {...injected} {...slotInjected.props} {...ownerProps} />
  }
  return (
    <ContextualEntry
      slotKey={slotKey}
      Comp={Comp}
      kit={kit}
      standard={standard}
      injected={injected}
      slotInjected={slotInjected as BoundSlotInject & { readonly slotHookFactories: SlotHookFactories }}
      ownerProps={ownerProps}
      hookContext={hookContext}
      hasHookContext={hasHookContext}
    />
  )
}

function SessionEntry({ entry, ownerProps, binding, slotKey, slotInjected, hookContext, hasHookContext }: {
  entry: StoredEntry
  ownerProps: object
  binding: StandardSourceBinding & { readonly key: string }
  slotKey: string
  slotInjected: BoundSlotInject
  hookContext: unknown
  hasHookContext: boolean
}) {
  /** 中文说明：模块局部值 host，由紧邻初始化决定。 */
  const host = useHost()
  const rootBinding = useRootBinding()
  const Comp = entry.component as FC<InjectedProps>
  const { kit, standard, actions } = standardKit(host, entry, 'session', rootBinding, binding)
  const injected = cachedSessionInject(entry, binding, actions)
  return renderEntry(slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext)
}

function SessionMaybeEntryBody({ entry, ownerProps, binding, slotKey, slotInjected, hookContext, hasHookContext }: {
  entry: StoredEntry
  ownerProps: object
  binding: StandardSourceBinding
  slotKey: string
  slotInjected: BoundSlotInject
  hookContext: unknown
  hasHookContext: boolean
}) {
  /** 中文说明：模块局部值 host，由紧邻初始化决定。 */
  const host = useHost()
  const rootBinding = useRootBinding()
  const Comp = entry.component as FC<InjectedProps>
  const { kit, standard, actions } = standardKit(host, entry, 'session-maybe', rootBinding, binding)
  const injected = cachedSessionMaybeInject(entry, binding, actions)
  return renderEntry(slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext)
}

/**
 * Session-maybe identity: adoption — the ONLY behavior (there is no
 * hold-identity-forever mode). An incarnation born session-less ADOPTS the
 * first session that arrives: identity holds across that one transition
 * (undefined → first id), so a blank shell's DOM survives the moment a
 * session appears. From then on the entry behaves exactly like a strict
 * session entry: switching to a DIFFERENT session remounts (component-local
 * state must not leak between sessions), and dropping back to no-session
 * remounts into a fresh blank incarnation, which will adopt again.
 * Component-local per-session state therefore clears by construction; state
 * that must SURVIVE a switch belongs in session-bound sources (machine,
 * store, hooks) — the existing layering rule, now load-bearing.
 */
/* 中文说明：函数 SessionMaybeEntry 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function SessionMaybeEntry({ entry, ownerProps, slotKey, slotInjected, hookContext, hasHookContext }: {
  entry: StoredEntry
  ownerProps: object
  slotKey: string
  slotInjected: BoundSlotInject
  hookContext: unknown
  hasHookContext: boolean
}) {
  const binding = useScopeBinding()
  // The child key is an incarnation counter, NOT the session id: adoption
  // must keep the key constant across undefined → first id. Bookkeeping
  // lives in this stable (unkeyed) wrapper via the render-phase setState
  // form (React's sanctioned derived-state pattern: setState during render
  // of the same component re-renders once before children mount, and the
  // guard conditions make it convergent — StrictMode-safe).
  /** 中文说明：模块局部值 [state, setState]，由紧邻初始化决定。 */
  const [state, setState] = useState<MaybeIncarnation>(FIRST_INCARNATION)
  /** 中文说明：模块局部值 { adopted, epoch }，由紧邻初始化决定。 */
  let { adopted, epoch } = state
  if (binding.key !== undefined && adopted === undefined) {
    // Adoption: same epoch — no remount.
    adopted = binding.key
    setState({ adopted, epoch })
  } else if (adopted !== undefined && binding.key !== undefined && binding.key !== adopted) {
    // Post-adoption session switch: next incarnation, born already adopted.
    adopted = binding.key
    epoch += 1
    setState({ adopted, epoch })
  } else if (adopted !== undefined && binding.key === undefined) {
    // Back to no-session: next incarnation, born blank (adopts anew later).
    adopted = undefined
    epoch += 1
    setState({ adopted, epoch })
  }
  return (
    <SessionMaybeEntryBody
      key={epoch}
      entry={entry}
      ownerProps={ownerProps}
      binding={binding}
      slotKey={slotKey}
      slotInjected={slotInjected}
      hookContext={hookContext}
      hasHookContext={hasHookContext}
    />
  )
}

/** Adoption bookkeeping of one session-maybe outlet (see SessionMaybeEntry). */
/* 中文说明：类型或类 MaybeIncarnation 约束模块数据或职责。 */
interface MaybeIncarnation {
  /** Session this incarnation adopted; undefined while born blank and unadopted. */
  readonly adopted: string | undefined
  /** Incarnation counter — the child key; bumps exactly when an incarnation dies. */
  readonly epoch: number
}

/** 中文说明：模块局部值 FIRST_INCARNATION，由紧邻初始化决定。 */
const FIRST_INCARNATION: MaybeIncarnation = { adopted: undefined, epoch: 0 }

/** 中文说明：函数 RootEntry 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function RootEntry({ entry, ownerProps, slotKey, slotInjected, hookContext, hasHookContext }: {
  entry: StoredEntry
  ownerProps: object
  slotKey: string
  slotInjected: BoundSlotInject
  hookContext: unknown
  hasHookContext: boolean
}) {
  /** 中文说明：模块局部值 host，由紧邻初始化决定。 */
  const host = useHost()
  const rootBinding = useRootBinding()
  const Comp = entry.component as FC<InjectedProps>
  const { kit, standard, actions } = standardKit(host, entry, 'root', rootBinding, undefined)
  const injected = cachedRootInject(entry, actions)
  return renderEntry(slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext)
}

/** 中文说明：函数 StrictSessionEntry 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function StrictSessionEntry({ slotKey, entry, ownerProps, slotInjected, hookContext, hasHookContext, onEntryError }: {
  slotKey: string
  entry: StoredEntry
  ownerProps: object
  slotInjected: BoundSlotInject
  hookContext: unknown
  hasHookContext: boolean
  onEntryError: (error: unknown) => void
}) {
  const binding = useScopeBinding()
  if (binding.key === undefined) {
    throw new SlotAssemblyError(`strict session slot '${slotKey}' rendered without a scope binding`)
  }
  // Per-session remount rides this key; per-entry remount rides the outer
  // element's entry-identity key (the outlet's guarded() call).
  return (
    <SlotErrorBoundary slotKey={slotKey} key={binding.key} onEntryError={onEntryError}>
      <SessionEntry
        entry={entry}
        ownerProps={ownerProps}
        binding={binding as StandardSourceBinding & { readonly key: string }}
        slotKey={slotKey}
        slotInjected={slotInjected}
        hookContext={hookContext}
        hasHookContext={hasHookContext}
      />
    </SlotErrorBoundary>
  )
}

/**
 * Anchor style shared by every outlet wrapper: `display:contents` keeps the
 * wrapper out of layout (grid/flex parents see the slot's own children), so
 * the anchor is purely addressable surface. Module-level constant — a stable
 * reference so the wrapper never diffs its style prop.
 */
/* 中文说明：模块局部值 ANCHOR_STYLE，由紧邻初始化决定。 */
const ANCHOR_STYLE = { display: 'contents' } as const

/** 中文说明：函数 SlotOutlet 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function SlotOutlet({ slotKey, ownerProps, opts }: {
  slotKey: string
  ownerProps: object
  opts?: (RenderOpts & ChainRenderOpts) | undefined
}) {
  /** 中文说明：模块局部值 host，由紧邻初始化决定。 */
  const host = useHost()
  // Version tick drives entries() re-read; the host batches per microtask.
  useSyncExternalStore(
    fn => host.subscribe(slotKey, fn),
    () => host.getVersion(slotKey),
  )
  // Locale revision tick: a locale switch re-renders every outlet, and entry
  // bodies re-derive their `t` seat at the new revision (fresh identity).
  useLocaleRevision(host.locale)
  const scopeBinding = useScopeBinding()
  // Anchor contract: every slot render site exposes a stable
  // `[data-slot="<key>"]` wrapper — the addressable seam dynamic styles
  // target — and `display:contents` keeps it layout-neutral. The wrapper
  // rides the outlet, not the dispatch outcome: fallback, crash-face, and
  // undeclared-empty states all render inside it, so the anchor's presence
  // never flickers with registration churn.
  return (
    <div data-slot={slotKey} style={ANCHOR_STYLE}>
      {renderOutletContent(host, slotKey, ownerProps, opts, scopeBinding)}
    </div>
  )
}

/** Kind dispatch behind the outlet anchor (single/keyed/list/chain, fallbacks, crash faces). */
/* 中文说明：函数 renderOutletContent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderOutletContent(
  host: SlotRendererHost,
  slotKey: string,
  ownerProps: object,
  opts: (RenderOpts & ChainRenderOpts) | undefined,
  scopeBinding: StandardSourceBinding,
): ReactNode {
  /** 中文说明：模块局部值 spec，由紧邻初始化决定。 */
  const spec = host.specOf(slotKey)
  // Undeclared (or no-longer-declared) keys render empty: a declaring entry's
  // unload returns the slot to the undeclared state while retained elements
  // may still be mounted — natural empty, not an ownership failure.
  if (!spec) return null
  if (spec.kind === 'chain' && opts?.fallbackOnly === true) {
    return renderChainResult(slotKey, null, opts)
  }
  if (spec.scope === 'session' && scopeBinding.key === undefined) {
    throw new SlotAssemblyError(`strict session slot '${slotKey}' rendered without a scope binding`)
  }
  const entries = host.entriesOf(slotKey)
  const slotInjected = cachedSlotInject(spec.inject)

  // The boundary must wrap the Entry ELEMENT, not live inside it: inject
  // factories and kit synthesis run in the Entry body and must land in the
  // per-entry fallback rather than escaping to the tree above.
  /** 中文说明：模块局部值 guarded，由紧邻初始化决定。 */
  const guarded = (entry: StoredEntry, key?: string | number, owner: object = ownerProps) => {
    /** 中文说明：模块局部值 hasHookContext，由紧邻初始化决定。 */
    const hasHookContext = opts !== undefined && Object.hasOwn(opts, 'hookContext')
    /** 中文说明：模块局部值 hookContext，由紧邻初始化决定。 */
    const hookContext = opts?.hookContext
    // Shadowing kinds abdicate on crash (the cell falls to its next
    // survivor); chain reports without abdicating — election alternatives
    // resolve at select time, and retiring a crashed elected entry would
    // change the static crash face.
    /** 中文说明：模块局部值 onEntryError，由紧邻初始化决定。 */
    const onEntryError = (error: unknown) => {
      host.reportEntryError(slotKey, entry, error, { abdicate: spec.kind !== 'chain' })
    }
    return spec.scope === 'session'
      ? (
        <StrictSessionEntry
          slotKey={slotKey}
          entry={entry}
          ownerProps={owner}
          slotInjected={slotInjected}
          hookContext={hookContext}
          hasHookContext={hasHookContext}
          onEntryError={onEntryError}
          key={key}
        />
      )
      : (
        <SlotErrorBoundary slotKey={slotKey} key={key} onEntryError={onEntryError}>
          {spec.scope === 'session-maybe'
            ? (
              <SessionMaybeEntry
                entry={entry}
                ownerProps={owner}
                slotKey={slotKey}
                slotInjected={slotInjected}
                hookContext={hookContext}
                hasHookContext={hasHookContext}
              />
            )
            : (
              <RootEntry
                entry={entry}
                ownerProps={owner}
                slotKey={slotKey}
                slotInjected={slotInjected}
                hookContext={hookContext}
                hasHookContext={hasHookContext}
              />
            )}
        </SlotErrorBoundary>
      )
  }
  // A cell whose every registration abdicated keeps the crash face: the
  // shadowing collapse ran out of survivors, which is a failure state, not
  // the owner's natural-empty fallback.
  /** 中文说明：模块局部值 deadCell，由紧邻初始化决定。 */
  const deadCell = () => <div data-slot-error={slotKey} />

  if (spec.kind === 'single') {
    /** 中文说明：模块局部值 entry，由紧邻初始化决定。 */
    const entry = host.entriesOfSlot(slotKey)[0]
    if (!entry) return entries.length > 0 ? deadCell() : <>{opts?.fallback ?? null}</>
    return guarded(entry, entryKeyOf(entry))
  }
  if (spec.kind === 'keyed') {
    /** 中文说明：模块局部值 entry，由紧邻初始化决定。 */
    const entry = host.entriesOfSlot(slotKey).find(e => e.options.key === opts?.entryKey)
    if (!entry) {
      /** 中文说明：模块局部值 occupied，由紧邻初始化决定。 */
      const occupied = entries.some(e => e.options.key === opts?.entryKey)
      return occupied ? deadCell() : <>{opts?.fallback ?? null}</>
    }
    return guarded(entry, entryKeyOf(entry))
  }
  if (spec.kind === 'chain') {
    // Entries arrive priority-sorted from the ledger (the core orders at
    // register, ties keep registration sequence). Selectors are pure
    // functions of the owner props (register-face contract), so the routing
    // pass runs per render with zero mount side effects: the first non-null
    // election renders, decliners never mount.
    /** 中文说明：模块局部值 elected，由紧邻初始化决定。 */
    let elected: ReactNode = null
    /** 中文说明：模块局部值 entry，由紧邻初始化决定。 */
    for (const entry of entries) {
      /** 中文说明：模块局部值 matched: unknown，由紧邻初始化决定。 */
      let matched: unknown
      try {
        // Chain entries always carry select (SlotCore register validation).
        matched = (entry.select as (owner: object) => unknown)(ownerProps)
      } catch (error) {
        // A throwing selector is a registrant contract breach (select MUST be
        // pure and total), but it runs before the entry's SlotErrorBoundary
        // exists — uncontained it would black out the whole owner region. So
        // it degrades to a decline: the chain and the fallback stay intact,
        // and the breach is reported like a crashed entry.
        console.error(
          `chain selector crashed in '${slotKey}' (${entry.registrant ?? 'unknown registrant'}), treating as declined:`,
          error)
        continue
      }
      if (matched !== null) {
        elected = guarded(entry, entryKeyOf(entry), { ...ownerProps, matched })
        break
      }
    }
    return renderChainResult(slotKey, elected, opts)
  }
  // list: one row per id cell — the cell's shadowing winner, or the crash
  // face once every entry of the cell abdicated (a dry cell must not
  // silently drop its row). Row sequence: registration order refined by
  // explicit order, optional id filter, as before shadowing existed.
  /** 中文说明：模块局部值 winners，由紧邻初始化决定。 */
  const winners = host.entriesOfSlot(slotKey)
  /** 中文说明：模块局部值 rows，由紧邻初始化决定。 */
  const rows: { entry: StoredEntry | undefined; id: string | undefined; order: number }[] = winners.map(entry => ({
    entry,
    id: entry.options.id,
    order: entry.options.order ?? 0,
  }))
  /** 中文说明：模块局部值 rowIds，由紧邻初始化决定。 */
  const rowIds = new Set(rows.map(row => row.id))
  /** 中文说明：模块局部值 entry，由紧邻初始化决定。 */
  for (const entry of entries) {
    if (rowIds.has(entry.options.id)) continue
    rowIds.add(entry.options.id)
    // Dry cells anchor their row at the cell head's declared order.
    rows.push({ entry: undefined, id: entry.options.id, order: entry.options.order ?? 0 })
  }
  /** 中文说明：模块局部值 list，由紧邻初始化决定。 */
  let list = [...rows].sort((a, b) => a.order - b.order)
  if (opts?.only !== undefined) list = list.filter(item => item.id === opts.only)
  if (list.length === 0) return <>{opts?.fallback ?? null}</>
  // Winner rows key by entry identity (see entryKeyOf); dry-cell rows key by
  // id — the disjoint prefixes keep the two namespaces from colliding.
  return (
    <>
      {list.map((item, i) => item.entry !== undefined
        ? guarded(item.entry, `e${entryKeyOf(item.entry)}`)
        : <div data-slot-error={slotKey} key={`x${item.id ?? i}`} />)}
    </>
  )
}

/** Render a chain election while preserving the overlay fallback's tree position. */
function renderChainResult(
  slotKey: string,
  elected: ReactNode,
  opts: (RenderOpts & ChainRenderOpts) | undefined,
): ReactNode {
  if (!opts?.overlay) return elected ?? <>{opts?.fallback ?? null}</>
  return (
    <>
      <div
        data-chain-overlay-fallback={slotKey}
        style={{ display: elected === null ? 'contents' : 'none' }}
      >
        {opts.fallback ?? null}
      </div>
      {elected}
    </>
  )
}

/** Root outlet: the shell's single ctx-level render entry — an unregistered 'root' is a boot-order failure, never a silent blank. */
/* 中文说明：函数 RootOutlet 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function RootOutlet({ ownerProps }: { ownerProps: object }) {
  /** 中文说明：模块局部值 host，由紧邻初始化决定。 */
  const host = useHost()
  useSyncExternalStore(
    fn => host.subscribe('root', fn),
    () => host.getVersion('root'),
  )
  useLocaleRevision(host.locale)
  /** 中文说明：模块局部值 entry，由紧邻初始化决定。 */
  const entry = host.entriesOfSlot('root')[0]
  if (!entry) {
    // Registrations exist but every one abdicated: the shadowing collapse ran
    // dry, so the crash face replaces the tree (registered-but-broken is a
    // crash, not the boot-order assembly failure below).
    if (host.entriesOf('root').length > 0) return <div data-slot-error="root" />
    throw new SlotAssemblyError("renderSlot('root') before any 'root' registration (boot order)")
  }
  // Same anchor contract as SlotOutlet: 'root' is a slot like any other, and
  // display:contents keeps the wrapper out of the shell's layout.
  return (
    <div data-slot="root" style={ANCHOR_STYLE}>
      <SlotErrorBoundary
        slotKey="root"
        key={entryKeyOf(entry)}
        onEntryError={(error) => { host.reportEntryError('root', entry, error, { abdicate: true }) }}
      >
        <RootEntry
          entry={entry}
          ownerProps={ownerProps}
          slotKey="root"
          slotInjected={EMPTY_SLOT_INJECT}
          hookContext={undefined}
          hasHookContext={false}
        />
      </SlotErrorBoundary>
    </div>
  )
}

/**
 * Build the renderer installed into the `ui-renderer` SlotRegistry
 * (ctx.slots.install(createSlotRenderer()) at boot; the service owns the
 * install/renderSlot contract and the double-install/not-installed throws).
 * @returns the renderer.
 */
/* 中文说明：函数 createSlotRenderer 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function createSlotRenderer(): SlotRenderer {
  return {
    renderRoot(host, ownerProps) {
      return (
        <HostContext.Provider value={host}>
          <RootStandardProvider>
            <ScopeProvider scope="session-maybe">
              <RootOutlet ownerProps={ownerProps} />
            </ScopeProvider>
          </RootStandardProvider>
        </HostContext.Provider>
      )
    },
  }
}
