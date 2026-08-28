/** Internal React bindings for renderer hosts and standard-source scopes.
 * @remarks 文件说明：文件职责：实现 client/ui-renderer 中 bindings 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑
 * DeepSeek Harness 的 client/ui-renderer 能力，使上层功能能够稳定组合和扩展。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import { createContext, useContext, type ReactNode } from 'react'
import type {
  HostObservable,
  KeyedStandardSource,
  MaybeSnapshotSelectorHook,
  SlotRendererHost,
  SnapshotSelectorHook,
  StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from './bind.ts'

/** Missing renderer assembly dependency.
 * @remarks 中文说明：类说明：SlotAssemblyError 用于集中封装 处理 SlotAssemblyError 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/ui-renderer
 * 在对应插件或业务生命周期内创建和调用。 */
export class SlotAssemblyError extends Error {}

/** In-package renderer host context.
 * @remarks 中文说明：常量说明：HostContext 用于处理 HostContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const HostContext = createContext<SlotRendererHost | null>(null)

/**
 * Read the installed renderer host.
 * @returns the host API.
 * @remarks 中文说明：功能说明：组合使用 Host 相关流程；使用场景由所在模块及调用位置决定。；返回值：SlotRendererHost；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 useHost()，并按返回类型处理结果。
 */
export function useHost(): SlotRendererHost {
  /**
   * 常量说明：host 用于处理 host 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const host = useContext(HostContext)
  if (host === null) throw new SlotAssemblyError('slot machinery rendered outside the installed renderer tree')
  return host
}

/**
 * 常量说明：RootBindingContext 用于处理 RootBindingContext 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const RootBindingContext = createContext<StandardSourceBinding | null>(null)
/**
 * 常量说明：ScopeBindingContext 用于处理 ScopeBindingContext 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ScopeBindingContext = createContext<StandardSourceBinding | null>(null)

/**
 * Read the root standard-source binding.
 * @returns the current root binding.
 * @remarks 中文说明：功能说明：组合使用 Root Binding 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：StandardSourceBinding；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * useRootBinding()，并按返回类型处理结果。
 */
export function useRootBinding(): StandardSourceBinding {
  /**
   * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const binding = useContext(RootBindingContext)
  if (binding === null) throw new SlotAssemblyError('slot rendered outside the root standard-source provider')
  return binding
}

/**
 * Read the current-session-optional binding.
 * @returns a binding whose key is absent when no Session is selected.
 * @remarks 中文说明：功能说明：组合使用 Scope Binding 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：StandardSourceBinding；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * useScopeBinding()，并按返回类型处理结果。
 */
export function useScopeBinding(): StandardSourceBinding {
  /**
   * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const binding = useContext(ScopeBindingContext)
  if (binding === null) throw new SlotAssemblyError('scoped slot rendered outside its scope provider')
  return binding
}

/**
 * Bind one observable source to an identity-stable selector Hook.
 * @param source - observable source.
 * @returns cached selector Hook.
 * @remarks 中文说明：功能说明：处理 observableHook 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（HostObservable<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SnapshotSelectorHook<T>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 observableHook(source)，并按返回类型处理结果。
 */
export function observableHook<T>(source: HostObservable<T>): SnapshotSelectorHook<T> {
  /**
   * 变量说明：hook 用于处理 hook 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let hook = hookCache.get(source)
  if (hook === undefined) {
    hook = bindSnapshotSelector(source)
    hookCache.set(source, hook)
  }
  return hook as SnapshotSelectorHook<T>
}

/**
 * 常量说明：hookCache 用于处理 hookCache 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const hookCache = new WeakMap<object, unknown>()
/**
 * 常量说明：absentSource 用于处理 absentSource 相关数据，作用于当前作用域；初始化后不可重新赋值，
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
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
const absentSource: HostObservable<undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

/**
 * Bind an optional source without changing Hook call order.
 * @param source - current source, or absence.
 * @returns selector Hook returning `undefined` while absent.
 * @remarks 中文说明：功能说明：处理 maybeObservableHook 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（HostObservable<T> | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：MaybeSnapshotSelectorHook<T>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 maybeObservableHook(source)，并按返回类型处理结果。
 */
export function maybeObservableHook<T>(
  source: HostObservable<T> | undefined,
): MaybeSnapshotSelectorHook<T> {
  if (source !== undefined) return observableHook(source)
  return useAbsentSnapshot
}

/**
 * 功能说明：组合使用 Absent Snapshot 相关流程；使用场景由所在模块及调用位置决定。
 * @param _selector （(snapshot: never) => S）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param _equal （(left: S, right: S) => boolean）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns S | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 useAbsentSnapshot(_selector, _equal)，并按返回类型处理结果。
 */
function useAbsentSnapshot<S>(
  _selector: (snapshot: never) => S,
  _equal?: (left: S, right: S) => boolean,
): S | undefined {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  observableHook(absentSource)(() => undefined)
  return undefined
}

/** Erased open-key selector Hook synthesized from one keyed source family. */
export type KeyedSnapshotHook = (
  key: string,
  selector?: (value: unknown) => unknown,
  equal?: (left: unknown, right: unknown) => boolean,
) => unknown

/**
 * Bind an open-key source family.
 * @param source - keyed resolver, or absence for an optional scope.
 * @returns cached keyed selector Hook.
 * @remarks 中文说明：功能说明：处理 keyedObservableHook 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（KeyedStandardSource | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：KeyedSnapshotHook；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 keyedObservableHook(source)，并按返回类型处理结果。
 */
export function keyedObservableHook(source: KeyedStandardSource | undefined): KeyedSnapshotHook {
  if (source === undefined) return absentKeyedHook
  /**
   * 变量说明：hook 用于处理 hook 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let hook = keyedHookCache.get(source)
  if (hook === undefined) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：selector（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：equal（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key, selector, equal)，
     * 并按返回类型处理结果。
     */
    hook = (key, selector, equal) => {
      /**
       * 常量说明：useValue 用于组合使用 Value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const useValue = observableHook(source(key) ?? absentSource)
      return useValue(selector ?? identity, equal)
    }
    keyedHookCache.set(source, hook)
  }
  return hook
}

/**
 * 常量说明：keyedHookCache 用于处理 keyedHookCache 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const keyedHookCache = new WeakMap<KeyedStandardSource, KeyedSnapshotHook>()
/**
 * 常量说明：identity 用于处理 identity 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 identity 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 identity(value)，并按返回类型处理结果。
 */
const identity = (value: unknown): unknown => value
/**
 * 常量说明：absentKeyedHook 用于处理 absentKeyedHook 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 absentKeyedHook 相关流程；使用场景由所在模块及调用位置决定。
 * @param _key （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param selector （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param equal （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 absentKeyedHook(_key, selector, equal)，并按返回类型处理结果。
 */
const absentKeyedHook: KeyedSnapshotHook = (_key, selector, equal) =>
  observableHook(absentSource)(selector ?? identity, equal)

/** Subscribe the tree to the atomically assembled root standard-source roster.
 * @remarks 中文说明：功能说明：处理 RootStandardProvider 相关流程；使用场景由所在模块及调用位置决定。；参数说明：{
 * children }（{ children: ReactNode }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * RootStandardProvider({ children })，并按返回类型处理结果。 */
export function RootStandardProvider({ children }: { children: ReactNode }) {
  /**
   * 常量说明：host 用于处理 host 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const host = useHost()
  /**
   * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  const binding = observableHook(host.root)(value => value)
  return <RootBindingContext.Provider value={binding}>{children}</RootBindingContext.Provider>
}

/** Subscribe to the scope roster before resolving and binding its current adapter.
 * @remarks 中文说明：功能说明：处理 ScopeProvider 相关流程；使用场景由所在模块及调用位置决定。；参数说明：{ scope,
 * children, }（{ scope: 'session' | 'session-maybe' children: ReactNode
 * }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 ScopeProvider({ scope, children, })，
 * 并按返回类型处理结果。 */
export function ScopeProvider({
  scope,
  children,
}: {
  scope: 'session' | 'session-maybe'
  children: ReactNode
}) {
  /**
   * 常量说明：host 用于处理 host 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const host = useHost()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  observableHook(host.scopeRevision)(value => value)
  /**
   * 常量说明：adapter 用于处理 adapter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const adapter = host.scope(scope)
  if (adapter === undefined) throw new SlotAssemblyError(`scope '${scope}' rendered without an installed adapter`)
  /**
   * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  const binding = observableHook(adapter.current)(value => value)
  return <ScopeBindingContext.Provider value={binding}>{children}</ScopeBindingContext.Provider>
}
