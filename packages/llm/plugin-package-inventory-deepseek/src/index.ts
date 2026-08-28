/**
 * Active Loader-backed plugin package inventory for official DeepSeek requests.
 * Host entries and the requesting agent's standing preset are resolved at request time;
 * installed dependencies and plugin fibers without Loader package provenance are excluded.
 * @module @deepseek-ai/dsh-plugin-package-inventory-deepseek
 * @remarks 文件说明：文件职责：实现 llm/plugin-package-inventory-deepseek 中 index
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * llm/plugin-package-inventory-deepseek 能力，使上层功能能够稳定组合和扩展。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, parse } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Entry, EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { DeepSeekPluginPackageIdentity, DeepSeekPluginPackageInventoryExtension } from './types.ts'
import type {} from './types.ts'

export type * from './types.ts'

/** Cordis plugin name.
 * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const name = 'plugin-package-inventory-deepseek'
/** Services required to locate host/requesting-agent entries and contribute the field.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject = ['agents', 'deepseekLlmApiExtensions', 'loader']

/** Plugin-package request contribution configuration. */
export interface Config {
  /** Contribute `dsh_plugin_packages` to official DeepSeek requests. Defaults to `true`. */
  enabled?: boolean
}

/** Validated plugin-package request contribution configuration.
 * @remarks 中文说明：常量说明：Config 用于处理 Config 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

interface PackageManifest {
  readonly name?: unknown
  readonly version?: unknown
}

interface ActiveEntry {
  readonly entry: Entry
  /** Bare-package base used by the Loader path that activated this entry. */
  readonly bareBaseUrl?: string
}

/** Parse a bare package or package-subpath specifier into its package name.
 * @remarks 中文说明：功能说明：处理 barePackageName 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：specifier（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string |
 * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * barePackageName(specifier)，并按返回类型处理结果。 */
function barePackageName(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.includes(':') || isAbsolute(specifier)) return undefined
  /**
   * 常量说明：first、second 用于处理 first、second 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [first = '', second = ''] = specifier.split('/')
  // An active Loader entry already passed module resolution, so a scoped bare name has its package segment.
  return first.startsWith('@') ? `${first}/${second}` : first
}

/** Read one manifest identity, optionally treating an absent name as a loose-module marker.
 * @remarks 中文说明：功能说明：处理 identityFromManifest 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：allowAnonymous（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：DeepSeekPluginPackageIdentity | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 identityFromManifest(path, allowAnonymous)，
 * 并按返回类型处理结果。 */
function identityFromManifest(path: string, allowAnonymous: boolean): DeepSeekPluginPackageIdentity | undefined {
  /**
   * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  if (allowAnonymous && manifest.name === undefined) return undefined
  if (typeof manifest.name !== 'string' || manifest.name.length === 0
    || typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`plugin-package-inventory-deepseek: ${path} must declare non-empty name and version`)
  }
  return { name: manifest.name, version: manifest.version }
}

/** Resolve a bare package without requiring it to export `./package.json`.
 * @remarks 中文说明：功能说明：处理 barePackageManifest 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：packageName（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：anchors（readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string
 * | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * barePackageManifest(packageName, anchors)，并按返回类型处理结果。 */
function barePackageManifest(packageName: string, anchors: readonly string[]): string | undefined {
  /**
   * 变量说明：anchor 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const anchor of anchors) {
    /**
     * 常量说明：searchPaths 用于处理 searchPaths 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const searchPaths = createRequire(anchor).resolve.paths(packageName)
    /* v8 ignore next -- active non-builtin package entries always have Node package search paths */
    if (searchPaths === null) continue
    /**
     * 变量说明：searchPath 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const searchPath of searchPaths) {
      /**
       * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const manifest = join(searchPath, packageName, 'package.json')
      if (existsSync(manifest)) return manifest
    }
  }
  return undefined
}

/** Find the nearest owning manifest for a relative or absolute plugin module.
 * @remarks 中文说明：功能说明：处理 nearestManifest 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：modulePath（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string |
 * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * nearestManifest(modulePath)，并按返回类型处理结果。 */
function nearestManifest(modulePath: string): string | undefined {
  /**
   * 变量说明：current 用于处理 current 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let current = dirname(modulePath)
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = parse(current).root
  while (true) {
    /**
     * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const manifest = join(current, 'package.json')
    if (existsSync(manifest)) return manifest
    if (current === root) return undefined
    current = dirname(current)
  }
}

/** Exact package identity resolver with immutable per-process manifest caching.
 * @remarks 中文说明：类说明：PackageIdentityResolver 用于集中封装 处理
 * PackageIdentityResolver 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 llm/plugin-package-inventory-deepseek 在对应插件或业务生命周期内创建和调用。 */
class PackageIdentityResolver {
  // TODO: Invalidate manifest identities if in-process package-version replacement becomes a supported upgrade path.
  /**
   * 常量说明：cache 用于处理 cache 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly cache = new Map<string, DeepSeekPluginPackageIdentity | undefined>()

  /**
   * 功能说明：处理 PackageIdentityResolver 相关流程；使用场景由所在模块及调用位置决定。
   * @param hostBaseUrl （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new PackageIdentityResolver(hostBaseUrl) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly hostBaseUrl: string) {}

  /** Resolve one Loader entry's owning package, or absence for a non-package loose module.
   * @remarks 中文说明：功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。；参数说明：{ entry,
   * bareBaseUrl }（ActiveEntry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：DeepSeekPluginPackageIdentity | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 resolve({ entry, bareBaseUr…)，并按返回类型处理结果。 */
  resolve({ entry, bareBaseUrl }: ActiveEntry): DeepSeekPluginPackageIdentity | undefined {
    /* v8 ignore next -- Loader entry trees inherit a base URL; the fallback supports direct embedders. */
    /**
     * 常量说明：treeBase 用于处理 treeBase 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const treeBase = entry.parent.tree.ctx.baseUrl ?? this.hostBaseUrl
    /**
     * 常量说明：anchors 用于处理 anchors 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const anchors = [...new Set([bareBaseUrl ?? treeBase, treeBase, this.hostBaseUrl, import.meta.url])]
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = `${anchors.join('\u0000')}\u0000${entry.options.name}`
    if (this.cache.has(key)) return this.cache.get(key)

    /**
     * 常量说明：packageName 用于处理 packageName 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const packageName = barePackageName(entry.options.name)
    /**
     * 变量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let manifest: string | undefined
    if (packageName !== undefined) {
      manifest = barePackageManifest(packageName, anchors)
      if (manifest === undefined) {
        throw new Error(`plugin-package-inventory-deepseek: cannot resolve active package ${JSON.stringify(packageName)}`)
      }
    } else if (!entry.options.name.startsWith('cordis:')) {
      /**
       * 常量说明：moduleUrl 用于处理 moduleUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const moduleUrl = isAbsolute(entry.options.name)
        ? pathToFileURL(entry.options.name)
        : new URL(entry.options.name, treeBase)
      if (moduleUrl.protocol === 'file:') manifest = nearestManifest(fileURLToPath(moduleUrl))
    }
    /**
     * 常量说明：identity 用于处理 identity 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const identity = manifest === undefined ? undefined : identityFromManifest(manifest, packageName === undefined)
    this.cache.set(key, identity)
    return identity
  }
}

/** Yield active, non-structural entries from one Loader tree.
 * @remarks 中文说明：功能说明：处理 activeEntries 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：tree（EntryTree）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：rootBareBaseUrl（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ActiveEntry[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * activeEntries(tree, rootBareBaseUrl)，并按返回类型处理结果。 */
function activeEntries(tree: EntryTree, rootBareBaseUrl?: string): ActiveEntry[] {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  return [...tree.entries()]
    .filter(entry => !entry.options.group
      && !entry.disabled
      && entry.fiber?.state === FiberState.ACTIVE)
    .map(entry => ({
      entry,
      ...entry.parent.tree === tree && rootBareBaseUrl !== undefined
        ? { bareBaseUrl: rootBareBaseUrl }
        : {},
    }))
}

/** Deterministic text order independent of the host's ICU data and locale.
 * @remarks 中文说明：功能说明：比较 Wire Text 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：left（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：right（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 compareWireText(left, right)，
 * 并按返回类型处理结果。 */
function compareWireText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Collect the full active package set for one request.
 * @remarks 中文说明：功能说明：收集 Active Plugin Packages 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：resolver（PackageIdentityResolver）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：hostBaseUrl（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessionId（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<DeepSeekPluginPackageIdentity[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 collectActivePluginPackages(ctx, resolver,
 * hostBaseUrl, sessionId)，并按返回类型处理结果。 */
async function collectActivePluginPackages(
  ctx: Context,
  resolver: PackageIdentityResolver,
  hostBaseUrl: string,
  sessionId?: string,
): Promise<DeepSeekPluginPackageIdentity[]> {
  /**
   * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const entries = activeEntries(ctx.loader)
  if (sessionId !== undefined && ctx.get('agentPresets') !== undefined) {
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = ctx.agents.get(SessionId(sessionId))
    if (agent !== undefined) {
      // The optional peer is loaded only when its service is present. Its existing
      // mount query keeps Loader internals off the public AgentPresets service.
      /**
       * 常量说明：standingMountFor 用于处理 standingMountFor 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const { standingMountFor } = await import('@deepseek-ai/dsh-agent-presets')
      /**
       * 常量说明：presetTree 用于处理 presetTree 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const presetTree = standingMountFor(agent.ctx)?.tree
      // PresetTree deliberately resolves its root bare rows from the harness;
      // nested ordinary includes retain their own tree base.
      if (presetTree !== undefined) entries.push(...activeEntries(presetTree, hostBaseUrl))
    }
  }
  /**
   * 常量说明：unique 用于处理 unique 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const unique = new Map<string, DeepSeekPluginPackageIdentity>()
  /**
   * 变量说明：activeEntry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const activeEntry of entries) {
    /**
     * 常量说明：identity 用于处理 identity 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const identity = resolver.resolve(activeEntry)
    if (identity === undefined) continue
    unique.set(`${identity.name}\u0000${identity.version}`, identity)
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
   */
  return [...unique.values()].sort((left, right) => (
    compareWireText(left.name, right.name) || compareWireText(left.version, right.version)
  ))
}

/**
 * Register the complete `dsh_plugin_packages` request contribution when enabled.
 * @param ctx - plugin context carrying Loader provenance and the DeepSeek request-extension registry.
 * @param config - validated default-on configuration.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：config（Config）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx, config)，并按返回类型处理结果。
 */
export function apply(ctx: Context, config: Config): void {
  if (config.enabled === false) return
  /**
   * 常量说明：hostBaseUrl 用于处理 hostBaseUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const hostBaseUrl = ctx.baseUrl ?? import.meta.url
  /**
   * 常量说明：resolver 用于处理 resolver 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const resolver = new PackageIdentityResolver(hostBaseUrl)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
   * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
   */
  ctx.deepseekLlmApiExtensions.register('dsh_plugin_packages', {
    prepare: async (request) => {
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const value: DeepSeekPluginPackageInventoryExtension = {
        version: 1,
        packages: await collectActivePluginPackages(ctx, resolver, hostBaseUrl, request.sessionId),
      }
      return { value }
    },
  })
}
