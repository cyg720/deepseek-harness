/**
 * Expand the workspace path aliases that a wildcard would otherwise resolve by
 * probing every package group in turn.
 *
 * `tsconfig.base.json` is the resolution facade for the whole repository, and
 * two of its aliases used one key per *group* rather than per package:
 * `@deepseek-ai/dsh-*` listed 49 candidate globs and `@deepseek-ai/dsh-*\/invariant`
 * listed 45. TypeScript and tsx try those candidates in order, so a specifier
 * whose package sits late in the list pays for every earlier miss. Under tsx's
 * ESM hook each miss is an `ERR_MODULE_NOT_FOUND` that Node decorates with a
 * full CommonJS resolution walk, which dominated source-launch boot.
 *
 * This generator writes one explicit entry per package into a marked region of
 * `tsconfig.base.json`, leaving every hand-written alias and comment outside
 * that region untouched. `--check` reports drift instead of writing, so a new
 * package that needs an alias fails a gate rather than silently resolving
 * through a fallback that no longer exists.
 *
 * @module scripts/gen-tsconfig-paths
 * @remarks 文件说明：文件职责：实现 仓库维护脚本 中 gen tsconfig paths 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 仓库维护脚本 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 常量说明：ROOT 用于处理 ROOT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
/**
 * 常量说明：CONFIG 用于处理 CONFIG 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const CONFIG = join(ROOT, 'tsconfig.base.json')
/**
 * 常量说明：BEGIN 用于处理 BEGIN 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const BEGIN = '      // BEGIN generated package aliases — pnpm run gen-tsconfig-paths'
/**
 * 常量说明：END 用于处理 END 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const END = '      // END generated package aliases'

/** Package-name prefix the expanded aliases cover.
 * @remarks 中文说明：常量说明：PREFIX 用于处理 PREFIX 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const PREFIX = '@deepseek-ai/dsh-'

/** One workspace package the generated region maps. */
interface PackageAlias {
  /** Bare specifier, e.g. `@deepseek-ai/dsh-session`. */
  readonly specifier: string
  /** Repository-relative source directory, e.g. `./packages/session/session/src`. */
  readonly source: string
  /** Whether the package carries `src/invariant.ts`, which earns a second alias. */
  readonly hasInvariant: boolean
}

/**
 * Read a workspace manifest's declared name.
 * @param manifest - absolute path to a `package.json`.
 * @returns The declared name, or undefined when the file is absent or nameless.
 * @remarks 中文说明：功能说明：处理 packageName 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：manifest（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string |
 * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * packageName(manifest)，并按返回类型处理结果。
 */
function packageName(manifest: string): string | undefined {
  /**
   * 变量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let parsed: unknown
  /**
   * 变量说明：_absentOrUnreadableManifest 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch (_absentOrUnreadableManifest) {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  /**
   * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const name: unknown = (parsed as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

/** One workspace package directory and the name its manifest declares. */
interface WorkspacePackage {
  readonly group: string
  readonly directory: string
  readonly packageDir: string
  readonly name: string
}

/**
 * Walk `packages/<group>/<directory>` once, in a stable order.
 * @returns Every directory whose manifest names a `@deepseek-ai/dsh-` package and that carries `src`.
 * @remarks 中文说明：功能说明：处理 workspacePackages 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：WorkspacePackage[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * workspacePackages()，并按返回类型处理结果。
 */
function workspacePackages(): WorkspacePackage[] {
  /**
   * 常量说明：packages 用于处理 packages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const packages = join(ROOT, 'packages')
  /**
   * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const found: WorkspacePackage[] = []
  /**
   * 变量说明：group 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const group of readdirSync(packages).sort()) {
    /**
     * 常量说明：groupDir 用于处理 groupDir 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const groupDir = join(packages, group)
    if (!statSync(groupDir).isDirectory()) continue
    /**
     * 变量说明：directory 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const directory of readdirSync(groupDir).sort()) {
      /**
       * 常量说明：packageDir 用于处理 packageDir 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const packageDir = join(groupDir, directory)
      /**
       * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const name = packageName(join(packageDir, 'package.json'))
      if (name === undefined || !name.startsWith(PREFIX)) continue
      if (existsSync(join(packageDir, 'src'))) found.push({ group, directory, packageDir, name })
    }
  }
  return found
}

/**
 * Collect every package the removed wildcards could resolve.
 *
 * A wildcard substituted the specifier's suffix into `packages/<group>/<suffix>/src`,
 * so it only ever resolved a package whose declared name is exactly
 * `@deepseek-ai/dsh-<directory>`. Packages named after something other than
 * their directory already carry a hand-written alias and are skipped here.
 *
 * @returns Aliases sorted by specifier.
 * @throws When two package directories claim one specifier, which the removed
 * wildcards resolved by group order and an explicit map cannot express.
 * @remarks 中文说明：功能说明：收集 Package Aliases 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：PackageAlias[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * collectPackageAliases()，并按返回类型处理结果。
 */
export function collectPackageAliases(): PackageAlias[] {
  /**
   * 常量说明：bySpecifier 用于处理 bySpecifier 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const bySpecifier = new Map<string, PackageAlias & { directory: string }>()
  /**
   * 变量说明：group、directory、packageDir、name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const { group, directory, packageDir, name } of workspacePackages()) {
    if (name !== `${PREFIX}${directory}`) continue
    /**
     * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const previous = bySpecifier.get(name)
    if (previous !== undefined) {
      throw new Error(
        `gen-tsconfig-paths: ${name} is claimed by packages/${previous.directory} and packages/${group}/${directory}; `
        + 'an explicit alias cannot express the group-order tiebreak the wildcard used.',
      )
    }
    bySpecifier.set(name, {
      specifier: name,
      source: `./packages/${group}/${directory}/src`,
      hasInvariant: existsSync(join(packageDir, 'src', 'invariant.ts')),
      directory: `${group}/${directory}`,
    })
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ specifier, source, hasInvariant
   * }（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
   * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({
   * specifier, source…)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
   */
  return [...bySpecifier.values()]
    .map(({ specifier, source, hasInvariant }) => ({ specifier, source, hasInvariant }))
    .sort((left, right) => left.specifier.localeCompare(right.specifier))
}

/**
 * Collect every workspace package the aliases must cover.
 *
 * Unlike {@link collectPackageAliases} this keeps packages whose name does not
 * match their directory. The generator cannot map those — only a hand-written
 * alias can — but they still have to be mapped by something, because deleting
 * the group wildcards removed the fallback that used to catch them.
 *
 * @returns Declared names of every `@deepseek-ai/dsh-` package carrying a `src` directory.
 * @remarks 中文说明：功能说明：收集 Package Names 相关流程；使用场景由所在模块及调用位置决定。；返回值：string[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 collectPackageNames()，
 * 并按返回类型处理结果。
 */
export function collectPackageNames(): string[] {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ name }（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ name })，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
   */
  return workspacePackages()
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right))
}

/**
 * Read the bare package specifiers a config maps, generated region included.
 * @param text - `tsconfig.base.json` contents.
 * @returns Specifiers mapped without a subpath.
 * @remarks 中文说明：功能说明：处理 mappedSpecifiers 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Set<string>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 mappedSpecifiers(text)，
 * 并按返回类型处理结果。
 */
export function mappedSpecifiers(text: string): Set<string> {
  /**
   * 常量说明：keys 用于处理 keys 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const keys = new Set<string>()
  /**
   * 变量说明：match 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const match of text.matchAll(/^\s*"(@deepseek-ai\/dsh-[^"/]+)":/gm)) {
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = match[1]
    if (key !== undefined) keys.add(key)
  }
  return keys
}

/**
 * Report packages that no alias maps.
 *
 * A package missing from `paths` still resolves — through the workspace symlink
 * and the package's own `exports` — but to built `lib/` output rather than to
 * source, which is the artifact-plane leak the explicit aliases exist to avoid.
 * Naming it here turns that into a gate failure instead of a silent difference.
 *
 * @param packages - every workspace package that needs an alias.
 * @param mapped - bare specifiers the config maps.
 * @returns Unmapped package names, in the order given.
 * @remarks 中文说明：功能说明：处理 uncoveredPackages 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：packages（readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：mapped（ReadonlySet<string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：string[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * uncoveredPackages(packages, mapped)，并按返回类型处理结果。
 */
export function uncoveredPackages(
  packages: readonly string[],
  mapped: ReadonlySet<string>,
): string[] {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
   */
  return packages.filter(name => !mapped.has(name))
}

/**
 * Render the generated region's alias lines.
 * @param aliases - packages to map, in emission order.
 * @param handWritten - specifiers already mapped outside the region; a duplicate key would shadow one silently.
 * @returns The region body, one JSON member per line.
 * @remarks 中文说明：功能说明：渲染 Aliases 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：aliases（readonly PackageAlias[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：handWritten（ReadonlySet<string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：string；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * renderAliases(aliases, handWritten)，并按返回类型处理结果。
 */
export function renderAliases(aliases: readonly PackageAlias[], handWritten: ReadonlySet<string>): string {
  /**
   * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const lines: string[] = []
  /**
   * 变量说明：alias 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const alias of aliases) {
    if (!handWritten.has(alias.specifier)) {
      lines.push(`      ${JSON.stringify(alias.specifier)}: [${JSON.stringify(alias.source)}]`)
    }
    /**
     * 常量说明：invariant 用于处理 invariant 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const invariant = `${alias.specifier}/invariant`
    if (alias.hasInvariant && !handWritten.has(invariant)) {
      lines.push(`      ${JSON.stringify(invariant)}: [${JSON.stringify(`${alias.source}/invariant.ts`)}]`)
    }
  }
  // The region closes `paths`, so the last member carries no trailing comma.
  return lines.join(',\n')
}

/**
 * Replace the generated region of a config's text.
 * @param text - current `tsconfig.base.json` contents.
 * @param body - rendered alias lines.
 * @returns The updated contents.
 * @throws When the markers are missing or out of order.
 * @remarks 中文说明：功能说明：写入 Region 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：body（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 writeRegion(text, body)，并按返回类型处理结果。
 */
export function writeRegion(text: string, body: string): string {
  /**
   * 常量说明：begin 用于处理 begin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const begin = text.indexOf(BEGIN)
  /**
   * 常量说明：end 用于处理 end 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const end = text.indexOf(END)
  if (begin < 0 || end < begin) {
    throw new Error(`gen-tsconfig-paths: ${CONFIG} is missing the generated-region markers.`)
  }
  return `${text.slice(0, begin)}${BEGIN}\n${body}\n${END}${text.slice(end + END.length)}`
}

/**
 * Parse the config's `paths` keys, ignoring the generated region.
 * @param text - current `tsconfig.base.json` contents.
 * @returns Specifiers mapped by hand.
 * @remarks 中文说明：功能说明：处理 handWrittenSpecifiers 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Set<string>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * handWrittenSpecifiers(text)，并按返回类型处理结果。
 */
function handWrittenSpecifiers(text: string): Set<string> {
  /**
   * 常量说明：begin 用于处理 begin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const begin = text.indexOf(BEGIN)
  /**
   * 常量说明：end 用于处理 end 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const end = text.indexOf(END)
  /**
   * 常量说明：outside 用于处理 outside 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const outside = begin < 0 || end < begin ? text : text.slice(0, begin) + text.slice(end)
  /**
   * 常量说明：keys 用于处理 keys 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const keys = new Set<string>()
  /**
   * 变量说明：match 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const match of outside.matchAll(/^\s*"(@deepseek-ai\/[^"]+)":/gm)) {
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = match[1]
    if (key !== undefined) keys.add(key)
  }
  return keys
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  /**
   * 常量说明：check 用于处理 check 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const check = process.argv.includes('--check')
  /**
   * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const current = readFileSync(CONFIG, 'utf8')
  /**
   * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const next = writeRegion(current, renderAliases(collectPackageAliases(), handWrittenSpecifiers(current)))
  /**
   * 常量说明：uncovered 用于处理 uncovered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const uncovered = uncoveredPackages(collectPackageNames(), mappedSpecifiers(next))
  if (uncovered.length > 0) {
    console.error(
      'gen-tsconfig-paths: no alias maps '
      + `${uncovered.join(', ')}; add a hand-written entry, because a package named after `
      + 'something other than its directory cannot be generated.',
    )
    process.exitCode = 1
  } else if (current === next) {
    console.log('gen-tsconfig-paths: tsconfig.base.json package aliases are current.')
  } else if (check) {
    console.error('gen-tsconfig-paths: tsconfig.base.json is stale; run `pnpm run gen-tsconfig-paths`.')
    process.exitCode = 1
  } else {
    writeFileSync(CONFIG, next)
    console.log('gen-tsconfig-paths: rewrote tsconfig.base.json package aliases.')
  }
}
