/** Test double for the `settings` Remote namespace a bench's plugins inject.
 * @remarks 文件说明：文件职责：实现 test-support/client-runtime 中 settings remote
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * test-support/client-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态
 * → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
import { vi } from 'vitest'

/** The minimum a scripted namespace view carries for the double's own bookkeeping. */
export interface ScriptedNamespace {
  /** Namespace key the write addresses. */
  ns: string
}

/** One scripted `settings` namespace face plus the controls a bench drives it with. */
export interface ScriptedSettingsRemote<View extends ScriptedNamespace> {
  /**
   * The namespace face handed to `TestRemote` as `settings`. A plugin injecting
   * `remote.settings` unparks on it, which is what most benches need; the
   * describe answer is the same one the shared mirror would read.
   */
  settings: {
    /**
     * 功能说明：处理 describe 相关流程；使用场景由所在模块及调用位置决定。
     * @returns Promise<{ ok: true; value: { writable: boolean; hasDocument:
     * boolean;…；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 describe()，并按返回类型处理结果。
     */
    describe(): Promise<{ ok: true; value: { writable: boolean; hasDocument: boolean; namespaces: readonly View[] } }>
    /**
     * 功能说明：更新 update 相关流程；使用场景由所在模块及调用位置决定。
     * @param ns （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param patch （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param expectedRevision （number | undefined）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。
     * @returns Promise< | { ok: true; value: View } | { ok: false; error: {
     * code: st…；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 update(ns, patch, expectedRevision)，并按返回类型处理结果。
     */
    update(ns: string, patch: unknown, expectedRevision: number | undefined): Promise<
      | { ok: true; value: View }
      | { ok: false; error: { code: string; message: string; details: object } }
    >
    /**
     * 功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。
     * @param ns （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param section （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param expectedRevision （number | undefined）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。
     * @returns Promise< | { ok: true; value: View } | { ok: false; error: {
     * code: st…；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 replace(ns, section, expectedRevision)，并按返回类型处理结果。
     */
    replace(ns: string, section: unknown, expectedRevision: number | undefined): Promise<
      | { ok: true; value: View }
      | { ok: false; error: { code: string; message: string; details: object } }
    >
    /**
     * 功能说明：处理 mutate 相关流程；使用场景由所在模块及调用位置决定。
     * @param ns （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param ops （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param expectedRevision （number | undefined）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。
     * @returns Promise< | { ok: true; value: View } | { ok: false; error: {
     * code: st…；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 mutate(ns, ops, expectedRevision)，并按返回类型处理结果。
     */
    mutate(ns: string, ops: unknown, expectedRevision: number | undefined): Promise<
      | { ok: true; value: View }
      | { ok: false; error: { code: string; message: string; details: object } }
    >
  }
  /** Spy behind `settings.update`, for argument assertions. */
  update: ReturnType<typeof vi.fn>
  /** Spy behind `settings.replace`, for argument assertions. */
  replace: ReturnType<typeof vi.fn>
  /** Spy behind `settings.mutate`, for argument assertions. */
  mutate: ReturnType<typeof vi.fn>
  /**
   * Replace what the next describe answers with, as a Host commit would.
   * @param namespaces - the namespace views to serve from now on.
   * @remarks 中文说明：功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：namespaces（readonly View[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 publish(namespaces)，
   * 并按返回类型处理结果。
   */
  publish(namespaces: readonly View[]): void
}

/**
 * Build a scripted `settings` Remote namespace for a bench. Each write answers
 * with the addressed namespace unchanged, so a bench that only needs its
 * plugins to activate scripts nothing; one asserting a write reads the
 * corresponding spy or replaces the face.
 * @param namespaces - namespace views the first describe answers with.
 * @param options - deployment facts the describe answer reports.
 * @returns the face and its controls.
 * @remarks 中文说明：功能说明：处理 scriptedSettingsRemote 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：namespaces（readonly View[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（{ writable?: boolean; hasDocument?: boolean
 * }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：ScriptedSettingsRemote<View>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * scriptedSettingsRemote(namespaces, options)，并按返回类型处理结果。
 */
export function scriptedSettingsRemote<View extends ScriptedNamespace>(
  namespaces: readonly View[] = [],
  options: { writable?: boolean; hasDocument?: boolean } = {},
): ScriptedSettingsRemote<View> {
  /**
   * 变量说明：served 用于处理 served 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let served = namespaces
  /**
   * 常量说明：writable 用于处理 writable 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const writable = options.writable ?? true
  /**
   * 常量说明：hasDocument 用于判断是否包含 Document 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const hasDocument = options.hasDocument ?? false
  /**
   * 常量说明：answer 用于处理 answer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 answer 相关流程；使用场景由所在模块及调用位置决定。
   * @param ns （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 answer(ns)，并按返回类型处理结果。
   */
  const answer = (ns: string) => {
    /**
     * 常量说明：view 用于处理 view 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    const view = served.find(candidate => candidate.ns === ns)
    return Promise.resolve(view === undefined
      ? {
        ok: false as const,
        error: { code: 'settings-rejected', message: `no scripted namespace "${ns}"`, details: { ns } },
      }
      : { ok: true as const, value: view })
  }
  /**
   * 常量说明：update 用于更新 update 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ns（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：_patch（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数：_expectedRevision（number | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(ns, _patch, _expectedRevision)，并按返回类型处理结果。
   */
  const update = vi.fn((ns: string, _patch: unknown, _expectedRevision: number | undefined) => answer(ns))
  /**
   * 常量说明：replace 用于处理 replace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ns（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：_section（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数：_expectedRevision（number | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(ns, _section, _expectedRevision)，并按返回类型处理结果。
   */
  const replace = vi.fn((ns: string, _section: unknown, _expectedRevision: number | undefined) => answer(ns))
  /**
   * 常量说明：mutate 用于处理 mutate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ns（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：_ops（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数：_expectedRevision（number | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(ns, _ops, _expectedRevision)，并按返回类型处理结果。
   */
  const mutate = vi.fn((ns: string, _ops: unknown, _expectedRevision: number | undefined) => answer(ns))
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ns（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：patch（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：expectedRevision（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ns, patch,
   * expectedRevision)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ns（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：section（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：expectedRevision（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ns, section,
   * expectedRevision)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ns（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：ops（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：expectedRevision（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ns, ops,
   * expectedRevision)，并按返回类型处理结果。
   */
  return {
    settings: {
      describe: () => Promise.resolve({ ok: true as const, value: { writable, hasDocument, namespaces: served } }),
      update: (ns, patch, expectedRevision) => update(ns, patch, expectedRevision),
      replace: (ns, section, expectedRevision) => replace(ns, section, expectedRevision),
      mutate: (ns, ops, expectedRevision) => mutate(ns, ops, expectedRevision),
    },
    update,
    replace,
    mutate,
    /**
     * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
     * @param next （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 publish(next)，并按返回类型处理结果。
     */
    publish(next) { served = next },
  }
}
