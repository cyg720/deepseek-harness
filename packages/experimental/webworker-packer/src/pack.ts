/**
 * VFS image packer: turns one composed profile plus a package index into the single
 * gzip-compressed tar the browser runtime inflates and mounts as its filesystem.
 *
 * Nothing is compiled here. The image carries the repository's real build products,
 * so a preview deployment debugs exactly what the served deployment ships. What the
 * pass does add is the pack-time module transform and the manifest that records the
 * wrapper contract it was transformed against.
 *
 * This module holds no repository knowledge: paths, globs, and the composition come
 * in as parameters, so the same library packs a different tree by being called
 * differently. Locating those inputs is the CLI's job.
 * @module @deepseek-ai/dsh-experimental-webworker-packer/src/pack
 * @remarks 文件说明：文件职责：实现 experimental/webworker-packer 中 pack 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-packer 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

import {
  lowerModuleSource, MemoryVfs, packTar, WorkerModuleLoader,
  DEFAULT_ROOT, IMAGE_CONFIG_PATH, IMAGE_EMPTY_DIRECTORIES, IMAGE_MANIFEST_PATH,
  IMAGE_OVERLAY_DIRECTORIES,
} from '@deepseek-ai/dsh-experimental-webworker-runtime'
import picomatch from 'picomatch'
import yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { REPLACED_EXTERNAL_PACKAGES } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/node/external_packages/replaced-externals.ts'
import { MODULE_PROXIES, MODULE_PROXY_PREFIXES } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/module-proxies.ts'
import { WRAPPER_CONTRACT, type ImageFiles, type TransformOutcome } from './transform-image.ts'
import { EXCLUDE, EXCLUDE_WORKSPACE, IMAGE_ENTRY_SEEDS, PAGE_ASSETS } from './rules.ts'

export { DEFAULT_ROOT } from '@deepseek-ai/dsh-experimental-webworker-runtime'

/** Image path of the manifest; the layout contract's name, re-exported for callers.
 * @remarks 中文说明：常量说明：MANIFEST_PATH 用于处理 MANIFEST_PATH 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const MANIFEST_PATH: string = IMAGE_MANIFEST_PATH

/** Image path of the composed profile; the layout contract's name, re-exported for callers.
 * @remarks 中文说明：常量说明：CONFIG_PATH 用于处理 CONFIG_PATH 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const CONFIG_PATH: string = IMAGE_CONFIG_PATH

/**
 * Manifest field the runtime judges the image by: the wrapper contract every packed
 * body was emitted against. The runtime refuses an image whose value is not its own
 * contract, because those bodies assume different wrapper semantics.
 * @remarks 中文说明：常量说明：CONTRACT_FIELD 用于处理 CONTRACT_FIELD 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const CONTRACT_FIELD = 'lowered'

/** Exclude matcher over tree-root-relative paths ({@link EXCLUDE}).
 * @remarks 中文说明：常量说明：excluded 用于处理 excluded 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const excluded = picomatch([...EXCLUDE], { dot: true })

/** Workspace exclude matcher: {@link EXCLUDE} plus {@link EXCLUDE_WORKSPACE}.
 * @remarks 中文说明：常量说明：workspaceExcluded 用于处理 workspaceExcluded 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const workspaceExcluded = picomatch([...EXCLUDE, ...EXCLUDE_WORKSPACE], { dot: true })

/** Page-asset matcher over image paths ({@link PAGE_ASSETS}).
 * @remarks 中文说明：常量说明：pageAsset 用于处理 pageAsset 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const pageAsset = picomatch([...PAGE_ASSETS], { dot: true })

/** One directory tree to copy into the image at a caller-selected mount. */
export interface ImageTree {
  /** Image path to mount it at, relative to the virtual root. */
  readonly mount: string
  /** Absolute source directory. */
  readonly directory: string
}

/** One configuration tree whose plugin rows may extend the package roster. */
export interface ConfigTree extends ImageTree {
  /**
   * Whether plugin names inside its `.yml` files join the materialization closure.
   * An agent preset mounts plugins the base composition never lists, and creating a
   * session fails if any of them is missing from the image.
   */
  readonly scanRoster?: boolean
}

/** Everything the packer needs that it cannot know by itself. */
export interface PackOptions {
  /** Composed profile, `!!js` intact, as the CLI's `--dump-default-config` produced it. */
  readonly config: string
  /** Profile name, recorded in the manifest. */
  readonly profile: string
  /** Virtual root the image mounts under; defaults to {@link DEFAULT_ROOT}. */
  readonly root?: string
  /** Package name to absolute directory, for workspace and vendored packages. */
  readonly workspaces: ReadonlyMap<string, string>
  /** Directory Node-style dependency resolution walks up from for the roster. */
  readonly resolveFrom: string
  /** Config trees to copy in beside the composition. */
  readonly configTrees?: readonly ConfigTree[]
  /** Empty directories to create; defaults to `home/`, `workspace/`, `tmp/`. */
  readonly emptyDirectories?: readonly string[]
  /**
   * Extra sweep roots: image specifiers requested by code outside the image.
   * Defaults to the worker assembly's own entries.
   */
  readonly entries?: readonly string[]
}

/** What one pack produced, for the caller to report or assert on. */
export interface PackResult {
  /** The gzip-compressed tar archive to write; the runtime inflates it at mount. */
  readonly image: Uint8Array
  /** Every entry, before zipping; the manifest is already among them. */
  readonly files: ImageFiles
  /** Package name to how many files it contributed, in materialization order. */
  readonly packages: ReadonlyMap<string, number>
  /** How many of them came from the workspace rather than from `node_modules`. */
  readonly workspacePackages: number
  /** Roster package names the closure started from. */
  readonly roster: readonly string[]
  /** Dependencies that did not resolve; a non-empty list means an incomplete image. */
  readonly missing: readonly string[]
  /** Executable scripts dropped from the image. */
  readonly executables: readonly string[]
  /** Page bundles left out of the transform; like every JavaScript entry they carry the trailing debugger name. */
  readonly pageBundles: readonly string[]
  /** JavaScript entries the image carries. */
  readonly javascriptEntries: number
  /** JavaScript candidates no root reaches, dropped from the image. */
  readonly droppedJavascriptEntries: number
  /** Third-party requests that resolve nowhere; loud at require time if hit. */
  readonly unresolvedExternalRequests: readonly string[]
  /** What the pack-time transform did. */
  readonly transform: TransformOutcome
  /** Wrapper contract recorded in the manifest; every packed body meets it. */
  readonly contract: string
}

/** One deterministic data-overlay archive and its uncompressed entries. */
export interface PackOverlayResult {
  /** Gzip-compressed ustar bytes consumed by the Worker host. */
  readonly image: Uint8Array
  /** Every path in the overlay before compression. */
  readonly files: ImageFiles
}

/**
 * 常量说明：readJson 用于读取 Json 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：读取 Json 相关流程；使用场景由所在模块及调用位置决定。
 * @param file （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 readJson(file)，并按返回类型处理结果。
 */
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

/**
 * Package name of a module specifier.
 * @param specifier - Module specifier, possibly with a subpath.
 * @returns The package name (`@scope/pkg/sub` → `@scope/pkg`).
 * @remarks 中文说明：功能说明：处理 packageNameOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：specifier（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 packageNameOf(specifier)，
 * 并按返回类型处理结果。
 */
function packageNameOf(specifier: string): string {
  /**
   * 常量说明：first、second 用于处理 first、second 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [first = specifier, second = ''] = specifier.split('/')
  return first.startsWith('@') ? `${first}/${second}` : first
}

/**
 * Collect module-specifier `name` fields from parsed entry rows, recursively
 * through nested `config` row lists (groups). Builtin rows (`cordis:group`)
 * and preset metadata documents carry names that are not module specifiers;
 * only names with a scope or a path separator count.
 * @param rows - Parsed YAML value; anything but an entry array is ignored.
 * @param names - Package names collected so far.
 * @remarks 中文说明：功能说明：处理 moduleNamesOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：rows（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：names（Set<string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 moduleNamesOf(rows,
 * names)，并按返回类型处理结果。
 */
function moduleNamesOf(rows: unknown, names: Set<string>): void {
  if (!Array.isArray(rows)) return
  /**
   * 变量说明：row 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    /**
     * 常量说明：name、config 用于处理 name、config 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { name, config } = row as { name?: unknown; config?: unknown }
    if (typeof name === 'string' && (name.startsWith('@') || name.includes('/'))) {
      names.add(packageNameOf(name))
    }
    moduleNamesOf(config, names)
  }
}

/**
 * Package names the composition names.
 * @param config - Composed profile; `!!js` scalars parse under Include's dialect.
 * @returns Package names, deduplicated.
 * @remarks 中文说明：功能说明：处理 rosterOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：config（string）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：string[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 rosterOf(config)，
 * 并按返回类型处理结果。
 */
function rosterOf(config: string): string[] {
  /**
   * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const names = new Set<string>()
  moduleNamesOf(yaml.load(config, { schema: entryListSchema }), names)
  return [...names]
}

/**
 * Package names the compositions under one config tree name.
 * @param root - Directory to walk.
 * @returns Package names, deduplicated.
 * @remarks 中文说明：功能说明：处理 treeRosterOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：root（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string[]；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 treeRosterOf(root)，并按返回类型处理结果。
 */
function treeRosterOf(root: string): string[] {
  /**
   * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const names = new Set<string>()
  /**
   * 常量说明：walk 用于处理 walk 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 walk 相关流程；使用场景由所在模块及调用位置决定。
   * @param directory （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 walk(directory)，并按返回类型处理结果。
   */
  const walk = (directory: string): void => {
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      /**
       * 常量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(absolute)
        continue
      }
      if (!entry.name.endsWith('.yml') && !entry.name.endsWith('.yaml')) continue
      moduleNamesOf(yaml.load(readFileSync(absolute, 'utf8'), { schema: entryListSchema }), names)
    }
  }
  walk(root)
  return [...names]
}

/**
 * Resolve one dependency the way Node does: walk up from the importer.
 * @param fromDirectory - Directory to start at.
 * @param name - Package name.
 * @returns The real path of the package directory, or undefined.
 * @remarks 中文说明：功能说明：解析 Dependency 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：fromDirectory（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string | undefined；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * resolveDependency(fromDirectory, name)，并按返回类型处理结果。
 */
function resolveDependency(fromDirectory: string, name: string): string | undefined {
  /**
   * 变量说明：directory 用于处理 directory 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let directory = fromDirectory
  for (;;) {
    /**
     * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const candidate = join(directory, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/**
 * Collect files under one directory. Traversal mechanics live here — nested
 * package/config collection flattens nested `node_modules` and prunes dot
 * directories, while seed collection preserves every directory. Every file
 * judgement comes in through `keep` (the {@link EXCLUDE} tables and the npm
 * publish view, or an unconditional seed predicate).
 * @param root - Source directory.
 * @param into - Image entries to add to.
 * @param prefix - Image path prefix.
 * @param keep - Filter over root-relative paths.
 * @param preserveDirectories - Whether dot directories and nested `node_modules`
 *   are ordinary fixture content rather than package-manager residue.
 * @remarks 中文说明：功能说明：收集 Tree 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：root（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：into（ImageFiles）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：prefix（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：keep（(relativePath: string) => boolean）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：preserveDirectories（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 collectTree(root, into, prefix, keep,
 * preserveDirectories)，并按返回类型处理结果。
 */
function collectTree(
  root: string,
  into: ImageFiles,
  prefix: string,
  keep: (relativePath: string) => boolean,
  preserveDirectories = false,
): void {
  /**
   * 常量说明：walk 用于处理 walk 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 walk 相关流程；使用场景由所在模块及调用位置决定。
   * @param directory （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 walk(directory)，并按返回类型处理结果。
   */
  const walk = (directory: string): void => {
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!preserveDirectories && (entry.name === 'node_modules' || entry.name.startsWith('.'))) continue
        walk(join(directory, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      /**
       * 常量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const absolute = join(directory, entry.name)
      /**
       * 常量说明：relativePath 用于处理 relativePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const relativePath = relative(root, absolute).replaceAll('\\', '/')
      if (!keep(relativePath)) continue
      into[`${prefix}/${relativePath}`] = readFileSync(absolute)
    }
  }
  walk(root)
}

/**
 * Predicate for npm's `files` allowlist, with standard glob semantics
 * (picomatch). A pattern admits the path itself and everything under it, so a
 * bare directory name publishes its whole tree; `!` patterns subtract from the
 * admitted set; package.json is always published.
 * @param patterns - The package.json `files` array.
 * @returns Predicate over package-root-relative paths.
 * @remarks 中文说明：功能说明：处理 publishedFilter 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：patterns（readonly unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：(path: string) => boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 publishedFilter(patterns)，并按返回类型处理结果。
 */
function publishedFilter(patterns: readonly unknown[]): (path: string) => boolean {
  /**
   * 常量说明：strings 用于处理 strings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：pattern（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：pattern is string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(pattern)，并按返回类型处理结果。
   */
  const strings = patterns.filter((pattern): pattern is string => typeof pattern === 'string')
  /**
   * 常量说明：normalize 用于规范化 normalize 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：规范化 normalize 相关流程；使用场景由所在模块及调用位置决定。
   * @param pattern （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 normalize(pattern)，并按返回类型处理结果。
   */
  const normalize = (pattern: string): string => pattern.replace(/^\.\//, '').replace(/\/+$/, '')
  /**
   * 常量说明：widen 用于处理 widen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 widen 相关流程；使用场景由所在模块及调用位置决定。
   * @param pattern （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 widen(pattern)，并按返回类型处理结果。
   */
  const widen = (pattern: string): string[] => [pattern, `${pattern}/**`]
  /**
   * 常量说明：positive 用于处理 positive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：pattern（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(pattern)，并按返回类型处理结果。
   */
  const positive = strings.filter(pattern => !pattern.startsWith('!')).map(normalize).flatMap(widen)
  /**
   * 常量说明：negative 用于处理 negative 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：pattern（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(pattern)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：pattern（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(pattern)，并按返回类型处理结果。
   */
  const negative = strings.filter(pattern => pattern.startsWith('!')).map(pattern => normalize(pattern.slice(1))).flatMap(widen)
  /**
   * 常量说明：admits 用于处理 admits 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const admits = picomatch(positive, { dot: true })
  /**
   * 常量说明：denies 用于处理 denies 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const denies = negative.length > 0 ? picomatch(negative, { dot: true }) : (): boolean => false
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，
   * 并按返回类型处理结果。
   */
  return path => path === 'package.json' || (admits(path) && !denies(path))
}

/** What the reachability sweep kept, transformed, and dropped. */
interface SweepOutcome {
  readonly swept: ImageFiles
  readonly transform: TransformOutcome
  readonly javascriptEntries: number
  readonly droppedJavascriptEntries: number
  /** Third-party requests that resolve nowhere; loud at require time if hit. */
  readonly unresolvedExternalRequests: readonly string[]
}

/**
 * Keep only the JavaScript the worker can reach, transforming it on the way.
 *
 * Roots are the export faces of every materialized workspace and vendored
 * package — the harness addresses them by constructed name at runtime (Loader
 * rows, typert faces, delegating providers such as `-auto` pickers), so the
 * sweep prunes files only inside third-party packages — plus the worker
 * assembly's own image entries. Resolution runs the runtime loader's own
 * algorithm over the candidate set, so pack-time reachability and boot-time
 * resolution cannot drift, and a request that resolves nowhere — an undeclared
 * or missing dependency — fails the pack rather than the boot.
 *
 * Two entry classes stay out of the walk by rule: page assets
 * ({@link PAGE_ASSETS}) are evaluated by the page's module system, and
 * non-JavaScript entries always stay because data reads go through fs paths
 * this pass cannot see.
 * @param files - Candidate entries after the publish-view filter.
 * @param options - Pack options carrying the sweep roots.
 * @param rootPackages - Roster package names from the workspace.
 * @param root - Virtual root the candidates mount under.
 * @returns The final entries plus the sweep's counts.
 */
/** Trailing `sourceMappingURL` comment; the image carries no `.map` files.
 * @remarks 中文说明：常量说明：DANGLING_SOURCE_MAP 用于处理 DANGLING_SOURCE_MAP 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const DANGLING_SOURCE_MAP = /\n\/\/# sourceMappingURL=\S+\s*$/

/**
 * Name one JavaScript entry for the debugger: append the `sourceURL` magic
 * comment V8 stacks and DevTools read, so the entry shows under its
 * repository path instead of as an anonymous VM script (worker `new Function`
 * bodies) or blob entry (page bundles). A trailing `sourceMappingURL` comment
 * is stripped first — its `.map` never ships, and once the script has a name
 * the debugger would resolve the reference against it and report a load
 * failure per script. Only the final line is touched, so every other line
 * keeps its number; evaluation cost stays at pack time, where the names are
 * already deterministic.
 * @param bytes - Entry body as the image would otherwise hold it.
 * @param name - Debugger name for the entry.
 * @param decoder - Shared UTF-8 decoder.
 * @param encoder - Shared UTF-8 encoder.
 * @returns The named body.
 * @remarks 中文说明：功能说明：处理 nameForDebugger 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：bytes（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：decoder（TextDecoder）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：encoder（TextEncoder）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Uint8Array；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 nameForDebugger(bytes,
 * name, decoder, encoder)，并按返回类型处理结果。
 */
function nameForDebugger(bytes: Uint8Array, name: string, decoder: TextDecoder, encoder: TextEncoder): Uint8Array {
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const source = decoder.decode(bytes).replace(DANGLING_SOURCE_MAP, '\n')
  return encoder.encode(`${source}\n//# sourceURL=${name}`)
}

/**
 * Debugger names for image entries: a workspace or vendored package file is
 * named by its repository path (`packages/<group>/<pkg>/lib/index.js`), the
 * shape a reader navigates; an external package file keeps its image key —
 * it has no repository path, and its pnpm store path would name a hash.
 * @param workspaces - Package name → absolute repository directory.
 * @param resolveFrom - Repository root the names are relative to.
 * @returns Mapper from an image key to the entry's debugger name.
 * @remarks 中文说明：功能说明：处理 debuggerNamer 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：workspaces（ReadonlyMap<string, string>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：resolveFrom（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：(key: string) => string；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 debuggerNamer(workspaces, resolveFrom)，并按返回类型处理结果。
 */
function debuggerNamer(workspaces: ReadonlyMap<string, string>, resolveFrom: string): (key: string) => string {
  /**
   * 常量说明：repoDirs 用于处理 repoDirs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[name, directory]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([name, directory])，
   * 并按返回类型处理结果。
   */
  const repoDirs = new Map(
    [...workspaces].map(([name, directory]) => [name, relative(resolveFrom, directory).replaceAll('\\', '/')]),
  )
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(key)，并按返回类型处理结果。
   */
  return (key: string): string => {
    if (!key.startsWith('node_modules/')) return key
    /**
     * 常量说明：rest 用于处理 rest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rest = key.slice('node_modules/'.length)
    /**
     * 常量说明：segments 用于处理 segments 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const segments = rest.split('/')
    /**
     * 常量说明：packageName 用于处理 packageName 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const packageName = segments[0]?.startsWith('@') === true ? segments.slice(0, 2).join('/') : segments[0] ?? ''
    /**
     * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const directory = repoDirs.get(packageName)
    return directory === undefined ? key : `${directory}${rest.slice(packageName.length)}`
  }
}

/**
 * 功能说明：处理 sweepImage 相关流程；使用场景由所在模块及调用位置决定。
 * @param files （ImageFiles）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @param options （PackOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @param rootPackages （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param root （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SweepOutcome；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sweepImage(files, options, rootPackages, root)，
 * 并按返回类型处理结果。
 */
function sweepImage(
  files: ImageFiles,
  options: PackOptions,
  rootPackages: readonly string[],
  root: string,
): SweepOutcome {
  /**
   * 常量说明：decoder 用于处理 decoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const decoder = new TextDecoder()
  /**
   * 常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const encoder = new TextEncoder()
  /**
   * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const vfs = new MemoryVfs()
  /**
   * 变量说明：name、bytes 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith('/')) vfs.seedDirectory(`${root}/${name}`)
    else vfs.seed(`${root}/${name}`, bytes)
  }
  // The walk resolves static specifiers and never loads them, so one shared
  // factory stands for every replaced module.
  /**
   * 常量说明：stub 用于处理 stub 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 stub 相关流程；使用场景由所在模块及调用位置决定。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stub()，并按返回类型处理结果。
   */
  const stub = (): unknown => ({})
  /**
   * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
   */
  const loader = new WorkerModuleLoader({
    vfs,
    root,
    staticModules: Object.fromEntries(Object.keys(MODULE_PROXIES).map(name => [name, stub])),
    staticModulePrefixes: Object.fromEntries(Object.keys(MODULE_PROXY_PREFIXES).map(name => [name, stub])),
  })

  /**
   * 常量说明：queue 用于处理 queue 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：specifier（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(specifier)，并按返回类型处理结果。
   */
  const queue: { specifier: string; from: string; importer: string; meta?: boolean }[] = (options.entries ?? IMAGE_ENTRY_SEEDS)
    .map(specifier => ({ specifier, from: root, importer: 'worker assembly entry' }))
  /**
   * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const name of rootPackages) {
    /**
     * 常量说明：manifestBytes 用于处理 manifestBytes 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const manifestBytes = files[`node_modules/${name}/package.json`]
    if (manifestBytes === undefined) continue // materialize already reported it under `missing`
    /**
     * 变量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let manifest: { exports?: Record<string, unknown> }
    try {
      manifest = JSON.parse(decoder.decode(manifestBytes)) as typeof manifest
    } catch {
      continue
    }
    // Every non-wildcard face is a root; a face resolving onto a page asset is
    // kept untransformed below rather than excluded here.
    /**
     * 常量说明：subpaths 用于处理 subpaths 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
     */
    const subpaths = manifest.exports === undefined
      ? ['.']
      : Object.keys(manifest.exports).filter(key => key.startsWith('.') && !key.includes('*'))
    /**
     * 变量说明：subpath 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const subpath of subpaths) {
      queue.push({ specifier: subpath === '.' ? name : `${name}/${subpath.slice(2)}`, from: root, importer: `workspace face ${name}` })
    }
  }

  /**
   * 常量说明：reached 用于处理 reached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const reached = new Map<string, Uint8Array>()
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen = new Set<string>()
  /**
   * 常量说明：failures 用于处理 failures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const failures: string[] = []
  /**
   * 常量说明：tolerated 用于处理 tolerated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tolerated = new Set<string>()
  /**
   * 变量说明：visited 用于处理 visited 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let visited = 0
  /**
   * 变量说明：rewritten 用于处理 rewritten 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let rewritten = 0
  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
    /**
     * 常量说明：specifier、from、importer 用于处理 specifier、from、importer 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { specifier, from, importer } = entry
    /**
     * 变量说明：resolution 用于处理 resolution 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let resolution
    /**
     * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      resolution = loader.resolve(specifier, from)
    } catch (reason) {
      // Our own packages must declare what they request: an unresolvable
      // request from a workspace or vendored file, a roster face, or the
      // assembly entries is a pack defect. Third-party files keep the runtime
      // philosophy instead — platform-dispatch branches the worker never
      // evaluates may request node-only modules, and such a request fails loud
      // at require time if it ever runs.
      /**
       * 常量说明：external 用于处理 external 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const external = importer.startsWith('node_modules/') && !importer.startsWith('node_modules/@deepseek-ai/')
      // A meta-resolve request is a URL mapping, not a load: a missing target
      // is tolerable from any importer — the call throws if it ever runs.
      if (external || entry.meta === true) tolerated.add(`${importer}: "${specifier}"`)
      else failures.push(`${importer}: "${specifier}" — ${(reason as Error).message}`)
      continue
    }
    if (resolution.kind === 'static') continue
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = resolution.path
    if (seen.has(path)) continue
    seen.add(path)
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = path.slice(root.length + 1)
    /**
     * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bytes = files[key]
    if (bytes === undefined) continue
    if (!/\.[cm]?js$/.test(key) || pageAsset(key)) {
      reached.set(key, bytes)
      continue
    }
    visited += 1
    /**
     * 常量说明：code、lowered、moduleRequests、metaResolveRequests 用于处理
     * code、lowered、moduleRequests、metaResolveRequests 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { code, lowered, moduleRequests, metaResolveRequests } = lowerModuleSource({ filename: `/${key}`, source: decoder.decode(bytes) })
    if (lowered) rewritten += 1
    reached.set(key, lowered ? encoder.encode(code) : bytes)
    /**
     * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const directory = path.slice(0, path.lastIndexOf('/'))
    /**
     * 变量说明：request 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const request of moduleRequests) queue.push({ specifier: request, from: directory, importer: key })
    /**
     * 变量说明：request 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const request of metaResolveRequests) queue.push({ specifier: request, from: directory, importer: key, meta: true })
  }
  if (failures.length > 0) {
    throw new Error(
      `vfs image: ${String(failures.length)} unresolvable module request(s); `
      + 'an undeclared or missing dependency fails the pack rather than the boot:\n  '
      + failures.join('\n  '),
    )
  }

  /**
   * 常量说明：swept 用于处理 swept 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const swept: ImageFiles = {}
  /**
   * 常量说明：debuggerName 用于处理 debuggerName 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const debuggerName = debuggerNamer(options.workspaces, options.resolveFrom)
  /**
   * 变量说明：javascriptEntries 用于处理 javascriptEntries 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let javascriptEntries = 0
  /**
   * 变量说明：dropped 用于处理 dropped 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let dropped = 0
  /**
   * 变量说明：name、bytes 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [name, bytes] of Object.entries(files)) {
    /**
     * 常量说明：isJs 用于判断是否为 Js 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const isJs = /\.[cm]?js$/.test(name)
    if (!isJs || pageAsset(name)) {
      swept[name] = isJs ? nameForDebugger(bytes, debuggerName(name), decoder, encoder) : bytes
      if (isJs) javascriptEntries += 1
      continue
    }
    /**
     * 常量说明：kept 用于处理 kept 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const kept = reached.get(name)
    if (kept === undefined) {
      dropped += 1
      continue
    }
    swept[name] = nameForDebugger(kept, debuggerName(name), decoder, encoder)
    javascriptEntries += 1
  }
  return {
    swept,
    transform: { visited, rewritten },
    javascriptEntries,
    droppedJavascriptEntries: dropped,
    unresolvedExternalRequests: [...tolerated],
  }
}

/**
 * Drop executable scripts from the image.
 *
 * A shebang says "program", not "module": nothing in a browser can spawn one and no
 * consumer reads their bytes (the packages that expose a launcher path are replaced
 * by stubs that answer with a string). They are also the one place top-level `await`
 * appears in the closure, which a CommonJS body cannot express.
 * @param files - Image entries, mutated.
 * @returns The dropped entry names.
 * @remarks 中文说明：功能说明：处理 dropExecutables 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：files（ImageFiles）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 dropExecutables(files)，
 * 并按返回类型处理结果。
 */
function dropExecutables(files: ImageFiles): string[] {
  /**
   * 常量说明：decoder 用于处理 decoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const decoder = new TextDecoder()
  /**
   * 常量说明：dropped 用于处理 dropped 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const dropped: string[] = []
  /**
   * 变量说明：name、bytes 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [name, bytes] of Object.entries(files)) {
    if (!/\.[cm]?js$/.test(name)) continue
    if (decoder.decode(bytes.subarray(0, 2)) !== '#!') continue
    dropped.push(name)
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the image is a plain path map
    delete files[name]
  }
  return dropped
}

/**
 * Materialize the dependency closure of every roster package into the image.
 * @param roster - Package names to start from.
 * @param options - Pack options carrying the workspace index and resolution root.
 * @returns Image entries, per-package file counts, and unresolved dependencies.
 * @remarks 中文说明：功能说明：处理 materialize 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：roster（readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（PackOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：{ files:
 * ImageFiles; packages: Map<string, number>; missing: string[]…；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 materialize(roster,
 * options)，并按返回类型处理结果。
 */
function materialize(
  roster: readonly string[],
  options: PackOptions,
): { files: ImageFiles; packages: Map<string, number>; missing: string[] } {
  /**
   * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const files: ImageFiles = {}
  /**
   * 常量说明：packages 用于处理 packages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const packages = new Map<string, number>()
  /**
   * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const missing: string[] = []
  /**
   * 常量说明：replaced 用于处理 replaced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const replaced = new Set(REPLACED_EXTERNAL_PACKAGES)
  /**
   * 常量说明：queue 用于处理 queue 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
   */
  const queue: { name: string; from: string }[] = roster.map(name => ({ name, from: options.resolveFrom }))

  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
    /**
     * 常量说明：name、from 用于处理 name、from 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { name, from } = entry
    if (packages.has(name) || replaced.has(name)) continue
    /**
     * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const directory = options.workspaces.get(name) ?? resolveDependency(from, name)
    if (directory === undefined) {
      missing.push(`${name} (from ${relative(options.resolveFrom, from) || '.'})`)
      continue
    }
    /**
     * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const manifest = readJson(join(directory, 'package.json'))
    /**
     * 常量说明：prefix 用于处理 prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prefix = `node_modules/${name}`
    /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const before = Object.keys(files).length
    if (options.workspaces.has(name)) {
      // A workspace package ships the slice npm would publish — `files`
      // filters out build residue like the tsc mirror under lib/types/ —
      // minus the workspace exclude table (no sources, no dist: the page
      // serves its own assets).
      /**
       * 常量说明：published 用于处理 published 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const published = Array.isArray(manifest.files) ? publishedFilter(manifest.files) : undefined
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：relativePath（由 TypeScript
       * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
       * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(relativePath)，
       * 并按返回类型处理结果。
       */
      collectTree(directory, files, prefix, relativePath =>
        !workspaceExcluded(relativePath) && (published === undefined || published(relativePath)))
    } else {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：relativePath（由 TypeScript
       * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
       * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(relativePath)，
       * 并按返回类型处理结果。
       */
      collectTree(directory, files, prefix, relativePath => !excluded(relativePath))
    }
    packages.set(name, Object.keys(files).length - before)
    /**
     * 变量说明：field 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const field of ['dependencies', 'peerDependencies'] as const) {
      // npm semantics: a peer is provided by the consumer. For an external
      // package the consumer is the page (react behind the prebuilt client
      // bundles), so its peer edges never bind the worker. Workspace and
      // vendored packages declare real runtime seams as peers
      // (@deepseek-ai/cordis is a peerDependency of every harness package),
      // so their peer edges stay on the chain.
      if (field === 'peerDependencies' && !options.workspaces.has(name)) continue
      /**
       * 常量说明：dependencies 用于处理 dependencies 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const dependencies = manifest[field]
      if (typeof dependencies !== 'object' || dependencies === null) continue
      /**
       * 变量说明：dependency 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const dependency of Object.keys(dependencies)) queue.push({ name: dependency, from: directory })
    }
  }
  return { files, packages, missing }
}

/** Gzip header byte that records the packing platform; RFC 1952 §2.3.1 spells 255 "unknown".
 * @remarks 中文说明：常量说明：GZIP_OS_UNKNOWN 用于处理 GZIP_OS_UNKNOWN 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const GZIP_OS_UNKNOWN = 255

/** Offset of that byte in the gzip member header.
 * @remarks 中文说明：常量说明：GZIP_OS_OFFSET 用于处理 GZIP_OS_OFFSET 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const GZIP_OS_OFFSET = 9

/**
 * Compress the archive into one gzip member the same tree always produces
 * byte for byte.
 *
 * Two header fields would otherwise carry build facts: zlib writes no
 * modification time and no original file name for a buffer (`gzipSync` is handed
 * neither), and it fills the operating-system byte from the platform it was built
 * for, which would make the same tree pack differently on Linux and macOS. That
 * byte is overwritten with "unknown" — every gzip reader ignores it, and the
 * artifact stops depending on where it was packed.
 * @param archive - the ustar archive.
 * @returns the compressed image bytes.
 * @remarks 中文说明：功能说明：处理 compressImage 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：archive（Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Uint8Array；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 compressImage(archive)，
 * 并按返回类型处理结果。
 */
function compressImage(archive: Uint8Array): Uint8Array {
  /**
   * 常量说明：compressed 用于处理 compressed 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const compressed = gzipSync(archive, { level: 9 })
  compressed[GZIP_OS_OFFSET] = GZIP_OS_UNKNOWN
  return compressed
}

/**
 * Pack one VFS image.
 *
 * The manifest's claim is all-or-nothing: it names the one contract every packed body
 * was emitted against. A module the transform cannot express therefore fails the pack
 * rather than downgrading the image, because a mostly-transformed image boots into
 * errors far from their cause.
 * @param options - Composition, package index, and paths.
 * @returns The compressed image plus what went into it.
 * @throws When a config tree or workspace directory named in the options is missing,
 * because a silently thinner image fails much later and much less clearly.
 * @remarks 中文说明：功能说明：处理 packVfsImage 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（PackOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：PackResult；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 packVfsImage(options)，
 * 并按返回类型处理结果。
 */
export function packVfsImage(options: PackOptions): PackResult {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = options.root ?? DEFAULT_ROOT
  /**
   * 常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const encoder = new TextEncoder()
  /**
   * 常量说明：configTrees 用于处理 configTrees 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const configTrees = options.configTrees ?? []
  /**
   * 变量说明：tree 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const tree of configTrees) {
    if (!existsSync(tree.directory)) {
      throw new Error(`vfs image: config tree ${tree.mount} is missing at ${tree.directory}`)
    }
  }

  /**
   * 常量说明：roster 用于处理 roster 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：tree（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(tree)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：tree（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(tree)，并按返回类型处理结果。
   */
  const roster = [...new Set([
    ...rosterOf(options.config),
    ...configTrees.filter(tree => tree.scanRoster === true).flatMap(tree => treeRosterOf(tree.directory)),
  ])]
  /**
   * 常量说明：files、packages、missing 用于处理 files、packages、missing 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { files, packages, missing } = materialize(roster, options)

  files[CONFIG_PATH] = encoder.encode(options.config)
  /**
   * 变量说明：tree 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  /**
  * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：relativePath（由 TypeScript
  * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
  * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(relativePath)，
  * 并按返回类型处理结果。
  */
  for (const tree of configTrees) collectTree(tree.directory, files, tree.mount, relativePath => !excluded(relativePath))

  /**
   * 常量说明：executables 用于处理 executables 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const executables = dropExecutables(files)
  /**
   * 常量说明：rootPackages 用于处理 rootPackages 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
   */
  const rootPackages = [...packages.keys()].filter(name => options.workspaces.has(name))
  /**
   * 常量说明：swept、transform、javascriptEntries、droppedJavascriptEntries、unresolv
   * edExternalRequests 用于处理 swept、transform、javascriptEntries、droppedJavascr
   * iptEntries、unresolvedExternalRequests 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { swept, transform, javascriptEntries, droppedJavascriptEntries, unresolvedExternalRequests } =
    sweepImage(files, options, rootPackages, root)

  swept[MANIFEST_PATH] = encoder.encode(`${JSON.stringify({
    root,
    profile: options.profile,
    [CONTRACT_FIELD]: WRAPPER_CONTRACT,
    javascriptEntries,
    visitedEntries: transform.visited,
    rewrittenEntries: transform.rewritten,
  }, null, 2)}\n`)

  /**
   * 变量说明：directory 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const directory of options.emptyDirectories ?? IMAGE_EMPTY_DIRECTORIES) {
    swept[directory] = new Uint8Array(0)
  }

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
   */
  return {
    image: compressImage(packTar(swept)),
    files: swept,
    packages,
    workspacePackages: [...packages.keys()].filter(name => options.workspaces.has(name)).length,
    roster,
    missing,
    executables,
    pageBundles: Object.keys(swept).filter(name => pageAsset(name)),
    javascriptEntries,
    droppedJavascriptEntries,
    unresolvedExternalRequests,
    transform,
    contract: WRAPPER_CONTRACT,
  }
}

/**
 * Pack opaque data trees into one ordered VFS overlay.
 *
 * Overlay mounts are restricted to the runtime-owned data directories, so an
 * overlay cannot replace configuration, the lowering manifest, or modules.
 * Files bypass package excludes and module reachability processing; later
 * trees replace earlier files at the same path.
 * @param trees - Absolute source directories and their data-directory mounts.
 * @returns Deterministic compressed archive plus its uncompressed entries.
 * @remarks 中文说明：功能说明：处理 packVfsOverlay 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：trees（readonly ImageTree[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：PackOverlayResult；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * packVfsOverlay(trees)，并按返回类型处理结果。
 */
export function packVfsOverlay(trees: readonly ImageTree[]): PackOverlayResult {
  /**
   * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const files: ImageFiles = {}
  /**
   * 变量说明：tree 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const tree of trees) {
    if (!existsSync(tree.directory)) {
      throw new Error(`vfs overlay: tree ${tree.mount} is missing at ${tree.directory}`)
    }
    /**
     * 常量说明：mount 用于处理 mount 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mount = tree.mount.replace(/^\.\//, '').replace(/\/$/, '')
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = mount.split('/')[0]
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：segment（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(segment)，并按返回类型处理结果。
     */
    if (mount === '' || first === undefined || !IMAGE_OVERLAY_DIRECTORIES.includes(first)
      || mount.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(
        `vfs overlay: mount ${JSON.stringify(tree.mount)} must stay under ${IMAGE_OVERLAY_DIRECTORIES.join(' or ')}`,
      )
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    collectTree(tree.directory, files, mount, () => true, true)
  }
  return { image: compressImage(packTar(files)), files }
}
