/** Internal React bindings for the renderer host and active session provide bundle. */
/**
 * 文件职责：实现客户端渲染器的 session-provider 模块。
 * 技术维度：React、TypeScript、Context、外部 Store 订阅和 Cordis 插槽。
 * 产品维度：为界面提供正确作用域的会话与插槽渲染。
 * 逻辑维度：绑定作用域，订阅状态，向子树提供值并清理。
 * 关键边界：不能跨会话复用旧授权或旧投影；卸载必须取消订阅。
 * 新手阅读建议：先读导出类型，再看 Provider/Hook 和清理逻辑。
 */
import { createContext, useContext, type ReactNode } from 'react'
import type {
  HostObservable, MaybeSnapshotSelectorHook, SessionMaybeProvideInfo, SessionProvideInfo,
  SlotRendererHost, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from './bind.ts'

/**
 * A missing-provider assembly error: the shell wired the tree wrong. The slot
 * error boundary rethrows this class so misassembly stays fail-loud while
 * registrant errors (inject factories, entry components) are contained
 * per entry.
 */
/** 中文说明：类型或类 SlotAssemblyError 约束模块数据或职责。 */
export class SlotAssemblyError extends Error {}

/** In-package renderer host context. */
/** 中文说明：模块局部值 HostContext，由紧邻初始化决定。 */
export const HostContext = createContext<SlotRendererHost | null>(null)

/**
 * Read the installed renderer host; throws outside the rendered root tree
 * (framework components must not render detached from the renderer).
 * @returns the host API.
 */
/** 中文说明：函数 useHost 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function useHost(): SlotRendererHost {
  /** 中文说明：模块局部值 host，由紧邻初始化决定。 */
  const host = useContext(HostContext)
  if (!host) throw new SlotAssemblyError('slot machinery rendered outside the installed renderer tree')
  return host
}

/** 中文说明：模块局部值 BindingContext，由紧邻初始化决定。 */
const BindingContext = createContext<SessionMaybeProvideInfo | null>(null)

/** Read the current-session-optional bundle supplied at the root. */
/** 中文说明：函数 useSessionMaybeProvideInfo 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function useSessionMaybeProvideInfo(): SessionMaybeProvideInfo {
  /** 中文说明：模块局部值 info，由紧邻初始化决定。 */
  const info = useContext(BindingContext)
  if (!info) throw new SlotAssemblyError('session-aware slot rendered outside the root binding provider')
  return info
}

/**
 * Read the enclosing session provide bundle; throws outside a SessionProvider
 * subtree (session slots must not render without a session).
 * @returns the enclosing bundle.
 */
/** 中文说明：函数 useSessionProvideInfo 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function useSessionProvideInfo(): SessionProvideInfo {
  /** 中文说明：模块局部值 info，由紧邻初始化决定。 */
  const info = useSessionMaybeProvideInfo()
  if (info.sessionId === undefined) throw new SlotAssemblyError('strict session slot rendered without a session')
  return info as SessionProvideInfo
}

/**
 * Identity-stable selector hook per host observable. uSES resubscribes when
 * the subscribe reference changes, so the bound hook must be created once per
 * source — cached here by source identity (sources are host-owned singletons).
 * @param source - host-provided observable.
 * @returns the cached selector hook.
 */
/** 中文说明：函数 observableHook 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function observableHook<T>(source: HostObservable<T>): SnapshotSelectorHook<T> {
  /** 中文说明：模块局部值 hook，由紧邻初始化决定。 */
  let hook = hookCache.get(source)
  if (hook === undefined) {
    hook = bindSnapshotSelector(source)
    hookCache.set(source, hook)
  }
  return hook as SnapshotSelectorHook<T>
}
/** 中文说明：模块局部值 hookCache，由紧邻初始化决定。 */
const hookCache = new WeakMap<object, unknown>()

/** 中文说明：模块局部值 absentSource，由紧邻初始化决定。 */
const absentSource: HostObservable<undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

/** Bind a source that disappears with the current session to an optional selector hook. */
/** 中文说明：函数 maybeObservableHook 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function maybeObservableHook<T>(source: HostObservable<T> | undefined): MaybeSnapshotSelectorHook<T> {
  if (source !== undefined) return observableHook(source)
  return useAbsentSnapshot
}

/** 中文说明：函数 useAbsentSnapshot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function useAbsentSnapshot<S>(_selector: (snapshot: never) => S, _equal?: (a: S, b: S) => boolean): S | undefined {
  // The uSES subscription must still run (hook-order stability); the absent
  // source always snapshots undefined, returned explicitly.
  observableHook(absentSource)(() => undefined)
  return undefined
}

/**
 * The useProjection framework seat (docs/subsystems/session-projection.md), one bound
 * function per provide bundle (cached by info identity — components may hold
 * it across renders). Key-addressed: the key resolves a per-session value
 * face off the projection store; the bound selector hook comes from the same
 * per-source cache as every other kit hook, so exactly one uSES subscription
 * runs per call and the subscribe reference stays stable per key. A key no
 * baseline or frame has carried (or a no-session bundle) reads `undefined` —
 * capability absence — keeping the hook order constant.
 */
/** 中文说明：函数 projectionHook 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function projectionHook(info: SessionMaybeProvideInfo): (
  key: string, selector?: (value: unknown) => unknown, eq?: (a: unknown, b: unknown) => boolean,
) => unknown {
  /** 中文说明：模块局部值 hook，由紧邻初始化决定。 */
  let hook = projectionHookCache.get(info)
  if (hook === undefined) {
    hook = (key, selector, eq) => {
      // The no-session (faceless) branch binds the shared absent source so
      // the caller's selector still runs over `undefined` (absence flows
      // through the selector) and the uSES call count stays constant.
      /** 中文说明：模块局部值 useValue，由紧邻初始化决定。 */
      const useValue = observableHook(info.projections?.faceOf(key) ?? absentSource)
      // Whole values are finished wire payloads (reference changes only when
      // a frame or baseline lands), so the identity selector needs no
      // equality function.
      return useValue(selector ?? (value => value), eq)
    }
    projectionHookCache.set(info, hook)
  }
  return hook
}
/** 中文说明：模块局部值 projectionHookCache，由紧邻初始化决定。 */
const projectionHookCache = new WeakMap<SessionMaybeProvideInfo, (
  key: string, selector?: (value: unknown) => unknown, eq?: (a: unknown, b: unknown) => boolean,
) => unknown>()

/**
 * Root-level binding provider. It follows current selection without a key;
 * per-entry identity is the outlet's adoption bookkeeping (SessionMaybeEntry):
 * a blank-born incarnation adopts the first session without remounting, and
 * every later transition (switch or loss) remounts like a strict entry.
 */
/** 中文说明：函数 SessionMaybeProvider 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function SessionMaybeProvider({ children }: { children: ReactNode }) {
  /** 中文说明：模块局部值 host，由紧邻初始化决定。 */
  const host = useHost()
  /** 中文说明：模块局部值 info，由紧邻初始化决定。 */
  const info = observableHook(host.sessions.provideInfo)(s => s)
  return (
    <BindingContext.Provider value={info}>
      {children}
    </BindingContext.Provider>
  )
}

/** SessionProvider API: render-prop body plus the no-session branch. */
/** 中文说明：类型或类 SessionProviderProps 约束模块数据或职责。 */
export interface SessionProviderProps {
  /** No-session body (also covers a current id whose session cannot be resolved). */
  empty?: (() => ReactNode) | undefined
  /** Session body; remounted per session via key={sessionId}. */
  children: (sessionId: string) => ReactNode
}

/**
 * Framework-wired session area: subscribes to the host's current provide
 * source and remounts the body under `key={sessionId}` so a session switch
 * rebuilds the session subtree. This dependency-inverted layer uses plain
 * string ids; `PropsRuntime` applies the branded type at the component
 * boundary.
 */
/** 中文说明：函数 SessionProvider 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function SessionProvider({ empty, children }: SessionProviderProps) {
  /** 中文说明：模块局部值 host，由紧邻初始化决定。 */
  const host = useHost()
  /** 中文说明：模块局部值 info，由紧邻初始化决定。 */
  const info = observableHook(host.sessions.provideInfo)(s => s)
  /** 中文说明：模块局部值 id，由紧邻初始化决定。 */
  const id = info.sessionId
  if (id === undefined) return <>{empty?.() ?? null}</>
  return (
    <BindingContext.Provider value={info} key={id}>
      {children(id)}
    </BindingContext.Provider>
  )
}
