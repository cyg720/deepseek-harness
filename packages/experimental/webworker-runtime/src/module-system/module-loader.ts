/**
 * CommonJS module loader over the worker VFS. It fills the `loader.internal`
 * seam Cordis uses for every entry import, and backs the `node:module`
 * `createRequire` proxy that `typert-loader`, `client-modules`, and the plugin
 * package inventory resolve package metadata through.
 *
 * Resolution is a narrowed Node `require` algorithm: `exports` walk with a
 * fixed condition order, extension probing, and one cache keyed by resolved
 * absolute path. Module bodies are wrapped as the image holds them: lowering is
 * the packer's job, so nothing here parses JavaScript.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/module-system/module-loader
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 module loader
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { createAlsRuntime, type AlsCausality, type AlsRuntime } from '../polyfill/async-context/als-runtime.ts'
import { dirname, fileUrlToPath, isAbsolute, join, pathToFileUrl, resolve as resolvePath } from './posix-path.ts'
import { WRAPPER_PARAMS } from '../image-layout.ts'
import type { MemoryVfs } from '../storage/memory.ts'

/** Condition keys honoured in `exports`, in order; `node` is deliberately absent.
 * @remarks 中文说明：常量说明：DEFAULT_CONDITIONS 用于处理 DEFAULT_CONDITIONS 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const DEFAULT_CONDITIONS = ['browser', 'require', 'import', 'default'] as const

/** Extensions probed when a specifier has no usable one.
 * @remarks 中文说明：常量说明：EXTENSIONS 用于处理 EXTENSIONS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const EXTENSIONS = ['.js', '.json', '.mjs', '.cjs'] as const

type ExportsField = string | null | readonly ExportsField[] | { readonly [key: string]: ExportsField }

interface PackageManifest {
  readonly name?: string
  readonly main?: string
  readonly exports?: ExportsField
}

/**
 * One entry of the static-module table. The loader calls it when a `require`
 * names that specifier and never before, so resolution alone — `require.resolve`
 * or `import.meta.resolve` — evaluates nothing. Repeated requires of one
 * specifier must answer the same module instance: callers depend on class
 * identity across requires (`instanceof EventEmitter`, `Buffer.isBuffer`), so a
 * factory that builds its value has to memoize it.
 * @returns The module object served for that specifier.
 */
export type StaticModuleFactory = () => unknown

/** Where a specifier resolved to. */
export type Resolution =
  | { readonly kind: 'static'; readonly specifier: string; readonly factory: StaticModuleFactory }
  | { readonly kind: 'file'; readonly path: string }

/** Node-loader-compatible resolution returned through the Cordis internal seam. */
export interface WorkerInternalResolution {
  readonly format: 'builtin' | 'commonjs' | 'json'
  /** File URL for VFS modules; the original bare specifier for builtins. */
  readonly url: string
}

interface ModuleRecord {
  readonly module: { exports: unknown }
}

/** Resolution helpers carried by a Worker-backed CommonJS require. */
export interface WorkerRequireResolve {
  /**
   * Resolve one specifier without evaluating its module.
   * @param specifier - Module request relative to the require base.
   * @returns Static or VFS-backed module identity.
   */
  (specifier: string): string
  /**
   * Return the directories this loader's Node-style package discovery searches.
   * @param specifier - Module request whose lookup roots are requested.
   * @returns Search roots, or null for a Worker-provided module.
   * @remarks 中文说明：功能说明：处理 paths 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：specifier（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string[] | null；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 paths(specifier)，
   * 并按返回类型处理结果。
   */
  paths(specifier: string): string[] | null
}

/** The `require` function shape the roster consumes through `createRequire`. */
export interface WorkerRequire {
  (specifier: string): unknown
  readonly resolve: WorkerRequireResolve
}

/** Construction inputs for {@link WorkerModuleLoader}. */
export interface WorkerModuleLoaderOptions {
  /** Filesystem holding package metadata and module sources. */
  readonly vfs: MemoryVfs
  /** Virtual root whose `node_modules` bare specifiers resolve against. */
  readonly root?: string
  /**
   * Modules served from the worker bundle instead of the VFS: `node:*` proxies
   * and the loud stubs for excluded npm packages, each behind a
   * {@link StaticModuleFactory}.
   */
  readonly staticModules: Readonly<Record<string, StaticModuleFactory>>
  /**
   * Prefix-matched proxies for packages whose subpaths are open-ended: a
   * specifier starting with the key resolves to its module. Exact keys win, and
   * the longest matching prefix wins among prefixes.
   */
  readonly staticModulePrefixes?: Readonly<Record<string, StaticModuleFactory>>
  /** Overrides {@link DEFAULT_CONDITIONS}. */
  readonly conditions?: readonly string[]
  /**
   * Ambient-store snapshot face for the suspended `rewrite-await` route; it is
   * read only when that route is the configured {@link lowering}.
   */
  readonly alsCausality?: AlsCausality
}

/**
 * 功能说明：判断是否为 Record 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isRecord(value)，并按返回类型处理结果。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Loader for one VFS mount; construct once per worker.
 * @remarks 中文说明：类说明：WorkerModuleLoader 用于集中封装 处理 WorkerModuleLoader
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
export class WorkerModuleLoader {
  /**
   * 常量说明：vfs 用于处理 vfs 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly vfs: MemoryVfs
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly root: string
  /**
   * 常量说明：staticModules 用于处理 staticModules 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly staticModules: ReadonlyMap<string, StaticModuleFactory>
  /**
   * 常量说明：staticPrefixes 用于处理 staticPrefixes 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly staticPrefixes: ReadonlyArray<readonly [string, StaticModuleFactory]>
  /**
   * 常量说明：conditions 用于处理 conditions 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly conditions: ReadonlySet<string>
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly als: AlsRuntime
  /**
   * 常量说明：modules 用于处理 modules 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly modules = new Map<string, ModuleRecord>()
  /**
   * 常量说明：manifests 用于处理 manifests 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly manifests = new Map<string, PackageManifest>()
  /**
   * 常量说明：stack 用于处理 stack 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly stack: string[] = []

  /**
   * The Cordis module seam. `parentURL` positions relative specifiers;
   * import attributes are ignored, as the client implementation does.
   * @remarks 中文说明：常量说明：internal 用于处理 internal 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly internal: {
    readonly version: 'worker'
    /**
     * 功能说明：处理 import 相关流程；使用场景由所在模块及调用位置决定。
     * @param specifier （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param parentURL （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param attributes （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 import(specifier, parentURL, attributes)，并按返回类型处理结果。
     */
    import(specifier: string, parentURL?: string, attributes?: unknown): Promise<unknown>
    /**
     * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
     * @param specifier （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param parentURL （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param attributes （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<WorkerInternalResolution>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 resolve(specifier, parentURL, attributes)，并按返回类型处理结果。
     */
    resolve(specifier: string, parentURL?: string, attributes?: unknown): Promise<WorkerInternalResolution>
    /**
     * 功能说明：解析 Sync 相关流程；使用场景由所在模块及调用位置决定。
     * @param specifier （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param parentURL （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param attributes （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns WorkerInternalResolution；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 resolveSync(specifier, parentURL, attributes)，
     * 并按返回类型处理结果。
     */
    resolveSync(specifier: string, parentURL?: string, attributes?: unknown): WorkerInternalResolution
  }

  /**
   * 功能说明：处理 WorkerModuleLoader 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （WorkerModuleLoaderOptions）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new WorkerModuleLoader(options) 创建实例，并在所属生命周期内使用。
   */
  constructor(options: WorkerModuleLoaderOptions) {
    this.vfs = options.vfs
    this.root = options.root ?? '/dsh'
    // A Map, not the record itself: a specifier that names an Object prototype
    // member must miss the table the way any other unregistered name does.
    this.staticModules = new Map(Object.entries(options.staticModules))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[left]（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：[right]（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([left], [right])，
     * 并按返回类型处理结果。
     */
    this.staticPrefixes = Object.entries(options.staticModulePrefixes ?? {})
      .sort(([left], [right]) => right.length - left.length)
    this.conditions = new Set(options.conditions ?? DEFAULT_CONDITIONS)
    this.als = createAlsRuntime(options.alsCausality)
    /**
     * 常量说明：resolveInternal 用于解析 Internal 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     * 功能说明：解析 Internal 相关流程；使用场景由所在模块及调用位置决定。
     * @param specifier （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param parentURL （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns WorkerInternalResolution；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 resolveInternal(specifier, parentURL)，并按返回类型处理结果。
     */
    const resolveInternal = (specifier: string, parentURL?: string): WorkerInternalResolution => {
      /**
       * 常量说明：from 用于处理 from 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const from = parentURL === undefined ? this.root : this.baseDirectoryOf(parentURL)
      /**
       * 常量说明：resolution 用于处理 resolution 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const resolution = this.resolve(specifier, from)
      if (resolution.kind === 'static') return { format: 'builtin', url: resolution.specifier }
      return {
        format: resolution.path.endsWith('.json') ? 'json' : 'commonjs',
        url: pathToFileUrl(resolution.path),
      }
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：specifier（string）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；参数：parentURL（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
     * 返回值：Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(specifier, parentURL)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：specifier（string）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；参数：parentURL（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
     * 返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(specifier, parentURL)，并按返回类型处理结果。
     */
    this.internal = {
      version: 'worker',
      import: async (specifier: string, parentURL?: string): Promise<unknown> => {
        /**
         * 常量说明：from 用于处理 from 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const from = parentURL === undefined ? this.root : this.baseDirectoryOf(parentURL)
        return this.load(this.resolve(specifier, from))
      },
      resolve: async (specifier: string, parentURL?: string) => resolveInternal(specifier, parentURL),
      resolveSync: resolveInternal,
    }
  }

  /**
   * 功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。
   * @param detail （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 fail(detail)，并按返回类型处理结果。
   */
  private fail(detail: string): never {
    /**
     * 常量说明：chain 用于处理 chain 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const chain = this.stack.length === 0 ? '' : ` (importer chain: ${this.stack.join(' -> ')})`
    throw new Error(`webworker modules: ${detail}${chain}`)
  }

  /** @returns Directory a base path or URL resolves specifiers from.
   * @remarks 中文说明：功能说明：处理 baseDirectoryOf 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：base（string | URL）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 baseDirectoryOf(base)，
   * 并按返回类型处理结果。 */
  private baseDirectoryOf(base: string | URL): string {
    /**
     * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const text = typeof base === 'string' ? base : base.href
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = text.startsWith('file://') ? fileUrlToPath(text) : text
    if (path.endsWith('/')) return resolvePath(path)
    return this.vfs.existsSync(path) && this.vfs.statSync(path).isDirectory() ? resolvePath(path) : dirname(path)
  }

  /**
   * 功能说明：处理 manifestOf 相关流程；使用场景由所在模块及调用位置决定。
   * @param directory （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns PackageManifest；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 manifestOf(directory)，并按返回类型处理结果。
   */
  private manifestOf(directory: string): PackageManifest {
    /**
     * 常量说明：cached 用于处理 cached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cached = this.manifests.get(directory)
    if (cached !== undefined) return cached
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = join(directory, 'package.json')
    /**
     * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const text = this.vfs.readFileSync(path, 'utf8') as string
    /**
     * 变量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let parsed: unknown
    /**
     * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      parsed = JSON.parse(text)
    } catch (reason) {
      this.fail(`${path} is not valid JSON: ${(reason as Error).message}`)
    }
    if (!isRecord(parsed)) this.fail(`${path} does not hold an object`)
    /**
     * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const manifest = parsed as PackageManifest
    this.manifests.set(directory, manifest)
    return manifest
  }

  /** Walk one `exports` value against the condition set and requested subpath.
   * @remarks 中文说明：功能说明：处理 selectExport 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：field（ExportsField）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：subpath（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：packageName（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string |
   * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * selectExport(field, subpath, packageName)，并按返回类型处理结果。 */
  private selectExport(field: ExportsField, subpath: string, packageName: string): string | undefined {
    if (field === null) return undefined
    if (typeof field === 'string') return subpath === '.' ? field : undefined
    if (Array.isArray(field)) {
      /**
       * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const candidate of field as readonly ExportsField[]) {
        /**
         * 常量说明：picked 用于处理 picked 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const picked = this.selectExport(candidate, subpath, packageName)
        if (picked !== undefined) return picked
      }
      return undefined
    }
    /**
     * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entries = Object.entries(field as { [key: string]: ExportsField })
    /**
     * 常量说明：isSubpathMap 用于判断是否为 Subpath Map 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[key]（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([key])，并按返回类型处理结果。
     */
    const isSubpathMap = entries.some(([key]) => key === '.' || key.startsWith('./'))
    if (!isSubpathMap) {
      if (subpath !== '.') return undefined
      return this.selectCondition(field, packageName)
    }
    /**
     * 变量说明：key、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [key, value] of entries) {
      if (key === subpath) {
        return typeof value === 'string' ? value : this.selectCondition(value, packageName, subpath)
      }
    }
    /**
     * 变量说明：key、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [key, value] of entries) {
      /**
       * 常量说明：star 用于处理 star 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const star = key.indexOf('*')
      if (star < 0) continue
      /**
       * 常量说明：prefix 用于处理 prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const prefix = key.slice(0, star)
      /**
       * 常量说明：suffix 用于处理 suffix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const suffix = key.slice(star + 1)
      if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue
      /**
       * 常量说明：captured 用于处理 captured 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const captured = subpath.slice(prefix.length, subpath.length - suffix.length)
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = typeof value === 'string' ? value : this.selectCondition(value, packageName, subpath)
      if (target !== undefined) return target.replaceAll('*', captured)
    }
    return undefined
  }

  /** Pick the first condition branch this runtime satisfies.
   * @remarks 中文说明：功能说明：处理 selectCondition 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：field（ExportsField）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：packageName（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：subpath（由
   * TypeScript 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string |
   * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * selectCondition(field, packageName, subpath)，并按返回类型处理结果。 */
  private selectCondition(field: ExportsField, packageName: string, subpath = '.'): string | undefined {
    if (field === null) return undefined
    if (typeof field === 'string') return field
    if (Array.isArray(field)) {
      /**
       * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const candidate of field as readonly ExportsField[]) {
        /**
         * 常量说明：picked 用于处理 picked 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const picked = this.selectCondition(candidate, packageName, subpath)
        if (picked !== undefined) return picked
      }
      return undefined
    }
    /**
     * 变量说明：key、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [key, value] of Object.entries(field as { [key: string]: ExportsField })) {
      if (!this.conditions.has(key)) continue
      /**
       * 常量说明：picked 用于处理 picked 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const picked = this.selectCondition(value, packageName, subpath)
      if (picked !== undefined) return picked
    }
    return undefined
  }

  /** Extension and directory probing for a concrete path.
   * @remarks 中文说明：功能说明：处理 probe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：specifier（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 probe(path, specifier)，
   * 并按返回类型处理结果。 */
  private probe(path: string, specifier: string): string {
    /**
     * 常量说明：candidates 用于处理 candidates 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：extension（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(extension)，并按返回类型处理结果。
     */
    const candidates: string[] = [path, ...EXTENSIONS.map(extension => path + extension)]
    /**
     * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const candidate of candidates) {
      if (this.vfs.existsSync(candidate) && this.vfs.statSync(candidate).isFile()) return candidate
    }
    if (this.vfs.existsSync(path) && this.vfs.statSync(path).isDirectory()) {
      if (this.vfs.existsSync(join(path, 'package.json'))) {
        /**
         * 常量说明：main 用于处理 main 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const main = this.manifestOf(path).main
        if (main !== undefined) return this.probe(join(path, main), specifier)
      }
      return this.probe(join(path, 'index'), specifier)
    }
    return this.fail(`cannot resolve "${specifier}": no file at ${candidates.join(', ')}`)
  }

  /** @returns The Worker-provided implementation of a static specifier.
   * @remarks 中文说明：功能说明：处理 staticModule 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：specifier（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：StaticModuleFactory | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 staticModule(specifier)，并按返回类型处理结果。 */
  private staticModule(specifier: string): StaticModuleFactory | undefined {
    /**
     * 常量说明：exact 用于处理 exact 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const exact = this.staticModules.get(specifier)
    if (exact !== undefined) return exact
    /**
     * 变量说明：prefix、factory 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [prefix, factory] of this.staticPrefixes) {
      if (specifier.startsWith(prefix)) return factory
    }
    return this.staticModules.get(`node:${specifier}`)
  }

  /**
   * Resolve a specifier the way the module that requested it would.
   * @param specifier - Bare name, relative path, absolute path, or file URL.
   * @param fromDirectory - Directory of the requesting module.
   * @returns Static module or the resolved VFS path.
   * @remarks 中文说明：功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：specifier（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：fromDirectory（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Resolution；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resolve(specifier,
   * fromDirectory)，并按返回类型处理结果。
   */
  resolve(specifier: string, fromDirectory: string): Resolution {
    /**
     * 常量说明：staticModule 用于处理 staticModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const staticModule = this.staticModule(specifier)
    if (staticModule !== undefined) return { kind: 'static', specifier, factory: staticModule }
    if (specifier.startsWith('cordis:') || specifier.startsWith('node:')) {
      return this.fail(`no static module is registered for "${specifier}"`)
    }
    if (specifier.startsWith('file://')) {
      return { kind: 'file', path: this.probe(fileUrlToPath(specifier), specifier) }
    }
    if (specifier.startsWith('.')) {
      return { kind: 'file', path: this.probe(join(fromDirectory, specifier), specifier) }
    }
    if (isAbsolute(specifier)) {
      return { kind: 'file', path: this.probe(specifier, specifier) }
    }
    /**
     * 常量说明：segments 用于处理 segments 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const segments = specifier.split('/')
    /**
     * 常量说明：packageName 用于处理 packageName 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const packageName = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0] ?? specifier
    /**
     * 常量说明：rest 用于处理 rest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rest = specifier.slice(packageName.length).replace(/^\//, '')
    /**
     * 常量说明：packageDirectory 用于处理 packageDirectory 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const packageDirectory = join(this.root, 'node_modules', packageName)
    if (!this.vfs.existsSync(join(packageDirectory, 'package.json'))) {
      return this.fail(`cannot resolve "${specifier}": ${packageDirectory}/package.json is not in the image`)
    }
    /**
     * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const manifest = this.manifestOf(packageDirectory)
    /**
     * 常量说明：subpath 用于处理 subpath 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const subpath = rest === '' ? '.' : `./${rest}`
    if (manifest.exports !== undefined) {
      /**
       * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const target = this.selectExport(manifest.exports, subpath, packageName)
      if (target === undefined) {
        return this.fail(`"${packageName}" does not export "${subpath}" under conditions [${[...this.conditions].join(', ')}]`)
      }
      return { kind: 'file', path: this.probe(join(packageDirectory, target), specifier) }
    }
    /**
     * 常量说明：legacy 用于处理 legacy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const legacy = subpath === '.' ? manifest.main ?? 'index.js' : rest
    return { kind: 'file', path: this.probe(join(packageDirectory, legacy), specifier) }
  }

  /**
   * Load a resolved module, reusing the cache and tolerating cycles with
   * CommonJS partial-export semantics.
   * @param resolution - Result of {@link resolve}.
   * @returns The module's exports.
   * @remarks 中文说明：功能说明：加载 load 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：resolution（Resolution）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：unknown；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 load(resolution)，
   * 并按返回类型处理结果。
   */
  load(resolution: Resolution): unknown {
    if (resolution.kind === 'static') return resolution.factory()
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = resolution.path
    /**
     * 常量说明：cached 用于处理 cached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cached = this.modules.get(path)
    if (cached !== undefined) return cached.module.exports
    if (path.endsWith('.json')) {
      /**
       * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const parsed: unknown = JSON.parse(this.vfs.readFileSync(path, 'utf8') as string)
      this.modules.set(path, { module: { exports: parsed } })
      return parsed
    }
    /**
     * 常量说明：exports 用于处理 exports 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const exports: Record<string, unknown> = {}
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record: ModuleRecord = { module: { exports } }
    this.modules.set(path, record)
    this.stack.push(path)
    /**
     * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const source = this.vfs.readFileSync(path, 'utf8') as string
      /**
       * 常量说明：factory 用于处理 factory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const factory = this.compile(source, path)
      /**
       * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const directory = dirname(path)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：specifier（string）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
       * 匿名回调(specifier)，并按返回类型处理结果。
       */
      factory(
        record.module.exports,
        this.requireFrom(directory),
        record.module,
        path,
        directory,
        {
          url: pathToFileUrl(path),
          // Node parity for the lowered `import.meta` face: a path resolution
          // answers a file URL; a static (built-in or proxied) module answers
          // its own specifier, the way Node echoes `node:*` back.
          resolve: (specifier: string): string => {
            /**
             * 常量说明：resolution 用于处理 resolution 相关数据，作用于当前作用域；初始化后不可重新赋值，
             * 但对象内部是否可变仍由其类型决定。
             */
            const resolution = this.resolve(specifier, directory)
            return resolution.kind === 'static' ? resolution.specifier : pathToFileUrl(resolution.path)
          },
        },
        this.als,
      )
      return record.module.exports
    } catch (reason) {
      this.modules.delete(path)
      throw reason
    } finally {
      this.stack.pop()
    }
  }

  /**
   * Compile a body the image already lowered.
   *
   * Module syntax reaching here means the image was packed by something other
   * than the packer, or its collector missed the entry. The worker carries no
   * transform to recover with, so it names the image as the thing to rebuild.
   * @param code - Module body as the image holds it.
   * @param path - Resolved VFS path.
   * @returns The wrapper factory.
   * @remarks 中文说明：功能说明：处理 compile 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：code（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：(...args:
   * unknown[]) => void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * compile(code, path)，并按返回类型处理结果。
   */
  private compile(code: string, path: string): (...args: unknown[]) => void {
    /**
     * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- wrapping an image body is this loader's job
      return new Function(...WRAPPER_PARAMS, code) as (...args: unknown[]) => void
    } catch (reason) {
      if (reason instanceof SyntaxError && /await/i.test(reason.message)) {
        this.fail(`${path} uses top-level await, which cannot run as CommonJS in the worker: ${reason.message}`)
      }
      if (reason instanceof SyntaxError && /import|export/i.test(reason.message)) {
        this.fail(`${path} still carries module syntax, so the image was not lowered by the packer `
          + `(${reason.message}); rebuild the image`)
      }
      this.fail(`${path} failed to compile: ${(reason as Error).message}`)
    }
  }

  /**
   * Build a `require` bound to a directory.
   * @param fromDirectory - Directory relative specifiers resolve against.
   * @returns Callable require with `resolve`.
   * @remarks 中文说明：功能说明：处理 requireFrom 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：fromDirectory（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：WorkerRequire；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * requireFrom(fromDirectory)，并按返回类型处理结果。
   */
  requireFrom(fromDirectory: string): WorkerRequire {
    /**
     * 常量说明：require 用于处理 require 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 require 相关流程；使用场景由所在模块及调用位置决定。
     * @param specifier （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 require(specifier)，并按返回类型处理结果。
     */
    const require = (specifier: string): unknown => this.load(this.resolve(specifier, fromDirectory))
    /**
     * 常量说明：resolve 用于解析 resolve 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：specifier（string）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(specifier)，并按返回类型处理结果。
     */
    const resolve = ((specifier: string): string => {
      /**
       * 常量说明：resolution 用于处理 resolution 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const resolution = this.resolve(specifier, fromDirectory)
      if (resolution.kind === 'static') {
        return this.fail(`"${specifier}" is a worker-provided module and has no VFS path`)
      }
      return resolution.path
    }) as WorkerRequireResolve
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：specifier（string）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：string[] | null；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(specifier)，并按返回类型处理结果。
     */
    resolve.paths = (specifier: string): string[] | null => {
      if (this.staticModule(specifier) !== undefined || specifier.startsWith('node:')) return null
      if (specifier.startsWith('.')) return [resolvePath(fromDirectory, '.')]
      return [join(this.root, 'node_modules')]
    }
    return Object.assign(require, { resolve })
  }

  /**
   * `node:module` `createRequire` for the VFS.
   * @param base - Module path, directory path, or `file:` URL.
   * @returns Require bound to that base.
   * @remarks 中文说明：功能说明：创建 Require 相关流程；使用场景由所在模块及调用位置决定。；参数说明：base（string |
   * URL）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：WorkerRequire；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 createRequire(base)，并按返回类型处理结果。
   */
  createRequire(base: string | URL): WorkerRequire {
    return this.requireFrom(this.baseDirectoryOf(base))
  }

  /**
   * Report what this loader has done, for the host's boot diagnostics.
   * @returns How many module bodies it has run.
   * @remarks 中文说明：功能说明：处理 usage 相关流程；使用场景由所在模块及调用位置决定。；返回值：{ modules: number
   * }；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 usage()，并按返回类型处理结果。
   */
  usage(): { modules: number } {
    return { modules: this.modules.size }
  }
}

/**
 * 变量说明：active 用于处理 active 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let active: WorkerModuleLoader | undefined

/**
 * Publish the loader the `node:module` proxy resolves through.
 * @param loader - Loader built by the worker entry.
 * @remarks 中文说明：功能说明：设置 Active Module Loader 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：loader（WorkerModuleLoader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * setActiveModuleLoader(loader)，并按返回类型处理结果。
 */
export function setActiveModuleLoader(loader: WorkerModuleLoader): void {
  active = loader
}

/**
 * Read the published loader.
 * @returns The active loader.
 * @remarks 中文说明：功能说明：处理 requireActiveModuleLoader 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：WorkerModuleLoader；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * requireActiveModuleLoader()，并按返回类型处理结果。
 */
export function requireActiveModuleLoader(): WorkerModuleLoader {
  if (active === undefined) {
    throw new Error('webworker modules: no loader is mounted; the worker entry must call setActiveModuleLoader before any createRequire use')
  }
  return active
}
