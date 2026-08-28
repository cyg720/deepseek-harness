/**
 * Repository knowledge for the packer: where this tree's workspaces, profile
 * composition, and config trees are, and how to report a pack.
 *
 * The library half takes all of this as parameters. Keeping the lookup here is what
 * lets the same library pack a different tree, and what keeps `pack.ts` free of
 * assumptions about pnpm workspaces or the `dsh` CLI.
 * @module @deepseek-ai/dsh-experimental-webworker-packer/src/repository
 * @remarks 文件说明：文件职责：实现 experimental/webworker-packer 中 repository 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-packer 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { DSH_HOME_ENV } from '@deepseek-ai/dsh-home-paths'
import type { ConfigTree, ImageTree, PackResult } from './pack.ts'

/**
 * Repository directories scanned for workspace and vendored packages. The
 * image only ever materializes runtime packages, which live here. The Landlock
 * package family contributes its unchanged JavaScript entry from `native/`;
 * examples and python never occur on a roster's dependency chain.
 * @remarks 中文说明：常量说明：WORKSPACE_SCAN_ROOTS 用于处理 WORKSPACE_SCAN_ROOTS 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const WORKSPACE_SCAN_ROOTS = ['vendor', 'packages', 'native/landlock-run/packages', 'apps']

/** Composition entry point package: the `dsh` CLI, run from source.
 * @remarks 中文说明：常量说明：CLI_PACKAGE 用于处理 CLI_PACKAGE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const CLI_PACKAGE = 'apps/cli'

/** Composition entry point: the `dsh` CLI, run from source.
 * @remarks 中文说明：常量说明：CLI_ENTRY 用于处理 CLI_ENTRY 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const CLI_ENTRY = `${CLI_PACKAGE}/src/bin.ts`

/** Repository-owned deterministic filesystem content offered by the preview.
 * @remarks 中文说明：常量说明：PREVIEW_EXAMPLE_ROOT 用于处理 PREVIEW_EXAMPLE_ROOT 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const PREVIEW_EXAMPLE_ROOT = 'packages/experimental/webworker-runtime/tests/fixtures/vfs-example'

/** One built-in Preview source and the trees packed into its overlay. */
export interface PreviewFixture {
  /** URL/query-safe identifier. */
  readonly id: string
  /** User-facing chooser label. */
  readonly label: string
  /** User-facing chooser detail. */
  readonly description: string
  /** Opaque trees packed into this fixture's overlay archive. */
  readonly trees: readonly ImageTree[]
}

/**
 * Index every workspace and vendored package by name.
 * @param repoRoot - Absolute repository root.
 * @returns Package name to absolute directory.
 * @remarks 中文说明：功能说明：处理 indexWorkspacePackages 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：repoRoot（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Map<string,
 * string>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * indexWorkspacePackages(repoRoot)，并按返回类型处理结果。
 */
export function indexWorkspacePackages(repoRoot: string): Map<string, string> {
  /**
   * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const index = new Map<string, string>()
  /**
   * 常量说明：visit 用于处理 visit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 visit 相关流程；使用场景由所在模块及调用位置决定。
   * @param directory （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 visit(directory)，并按返回类型处理结果。
   */
  const visit = (directory: string): void => {
    /**
     * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      /**
       * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name
      if (typeof name === 'string') index.set(name, directory)
      // A package root owns its subtree; anything below (test fixtures,
      // nested manifests) is not a separate workspace package.
      return
    }
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      visit(join(directory, entry.name))
    }
  }
  /**
   * 变量说明：scanRoot 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const scanRoot of WORKSPACE_SCAN_ROOTS) {
    /**
     * 常量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const absolute = join(repoRoot, scanRoot)
    if (existsSync(absolute)) visit(absolute)
  }
  return index
}

/**
 * Compose one profile through the real CLI dump path, leaving `!!js`
 * unevaluated. The dump runs against a throwaway Harness home and default
 * layers only, so the image is the shipped profile: the machine's `$DSH_HOME`
 * — its profile manifest with locally installed bundles, and its patch files —
 * would otherwise leak this machine's plugins into the image and break the
 * same-tree-same-bytes guarantee.
 * @param repoRoot - Absolute repository root.
 * @param profile - Profile name to compose.
 * @returns The composed YAML.
 * @remarks 中文说明：功能说明：处理 composeProfile 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：repoRoot（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：profile（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 composeProfile(repoRoot,
 * profile)，并按返回类型处理结果。
 */
export function composeProfile(repoRoot: string, profile: string): string {
  /**
   * 常量说明：home 用于处理 home 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const home = mkdtempSync(join(tmpdir(), 'dsh-pack-home-'))
  try {
    return execFileSync(
      process.execPath,
      ['--import', 'tsx/esm', join(repoRoot, CLI_ENTRY), '--profile', profile, '--dump-default-config'],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, [DSH_HOME_ENV]: home } },
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

/** One `dsh.configTrees` declaration entry, validated field by field. */
interface ConfigTreeDeclaration {
  mount: string
  path: string
  scanRoster?: boolean
}

/**
 * Config trees the CLI package declares for deployment images
 * (`dsh.configTrees` in its package.json): `path` is relative to the CLI
 * package root, `mount` is the image path, `scanRoster` feeds the tree's yml
 * plugin rows into the pack roster. The CLI owns its config layout; this
 * reader follows the declaration instead of naming directories. A malformed
 * declaration refuses the pack.
 * @param repoRoot - Absolute repository root.
 * @returns Trees with absolute source directories.
 * @remarks 中文说明：功能说明：处理 configTrees 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：repoRoot（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：ConfigTree[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 configTrees(repoRoot)，
 * 并按返回类型处理结果。
 */
export function configTrees(repoRoot: string): ConfigTree[] {
  /**
   * 常量说明：packageDir 用于处理 packageDir 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const packageDir = join(repoRoot, CLI_PACKAGE)
  /**
   * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
    dsh?: { configTrees?: unknown }
  }
  /**
   * 常量说明：declared 用于处理 declared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const declared = manifest.dsh?.configTrees
  if (declared === undefined) return []
  if (!Array.isArray(declared)) {
    throw new Error(`vfs image: ${CLI_PACKAGE} dsh.configTrees must be an array`)
  }
  /**
   * 常量说明：mounts 用于处理 mounts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const mounts = new Set<string>()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry, index)，并按返回类型处理结果。
   */
  return declared.map((entry, index) => {
    /**
     * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tree = entry as Partial<ConfigTreeDeclaration> | null
    /**
     * 常量说明：at 用于处理 at 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const at = `${CLI_PACKAGE} dsh.configTrees[${String(index)}]`
    if (tree === null || typeof tree !== 'object'
      || typeof tree.mount !== 'string' || tree.mount === ''
      || typeof tree.path !== 'string' || tree.path === ''
      || (tree.scanRoster !== undefined && typeof tree.scanRoster !== 'boolean')) {
      throw new Error(`vfs image: ${at} must declare a string mount, a string path, and an optional boolean scanRoster`)
    }
    if (mounts.has(tree.mount)) {
      throw new Error(`vfs image: ${at} repeats mount ${JSON.stringify(tree.mount)}`)
    }
    mounts.add(tree.mount)
    return {
      mount: tree.mount,
      directory: join(packageDir, tree.path),
      ...tree.scanRoster === undefined ? {} : { scanRoster: tree.scanRoster },
    }
  })
}

/**
 * Built-in filesystem fixtures offered by the repository preview.
 * Session and Workspace semantics remain opaque here; the owning runtime tests
 * validate those files through their production readers.
 * @param repoRoot - Absolute repository root.
 * @returns Named chooser entries and their overlay trees.
 * @remarks 中文说明：功能说明：处理 previewFixtures 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：repoRoot（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：PreviewFixture[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 previewFixtures(repoRoot)，
 * 并按返回类型处理结果。
 */
export function previewFixtures(repoRoot: string): PreviewFixture[] {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = join(repoRoot, PREVIEW_EXAMPLE_ROOT)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mount（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mount)，并按返回类型处理结果。
   */
  return [{
    id: 'vfs-example',
    label: 'Built-in showcase',
    description: 'Sample workspace, tool cards, subagents, and paged history.',
    trees: ['home', 'workspace'].map(mount => ({ mount, directory: join(root, mount) })),
  }]
}

/**
 * Render one pack as the lines a build log should carry.
 *
 * Refusals and unresolved dependencies are the two states a reader must not miss, so
 * they are spelled out rather than counted.
 * @param result - What the pack produced.
 * @param repoRoot - Absolute repository root, for relative paths.
 * @param outputFile - Where the image was written.
 * @returns Lines to print.
 * @remarks 中文说明：功能说明：处理 describePack 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：result（PackResult）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：repoRoot（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：outputFile（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 describePack(result,
 * repoRoot, outputFile)，并按返回类型处理结果。
 */
export function describePack(result: PackResult, repoRoot: string, outputFile: string): string[] {
  /**
   * 常量说明：sizeOf 用于处理 sizeOf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 sizeOf 相关流程；使用场景由所在模块及调用位置决定。
   * @param prefix （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sizeOf(prefix)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[name]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([name])，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sum（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：[, bytes]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sum, [, bytes])，
   * 并按返回类型处理结果。
   */
  const sizeOf = (prefix: string): number => Object.entries(result.files)
    .filter(([name]) => name.startsWith(prefix))
    .reduce((sum, [, bytes]) => sum + bytes.byteLength, 0)
  /**
   * 常量说明：megabytes 用于处理 megabytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 megabytes 相关流程；使用场景由所在模块及调用位置决定。
   * @param bytes （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 megabytes(bytes)，并按返回类型处理结果。
   */
  const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MB`
  /**
   * 常量说明：workspaceCount 用于处理 workspaceCount 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const workspaceCount = result.workspacePackages
  /**
   * 常量说明：heaviest 用于处理 heaviest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[name, count]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([name, count])，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
   */
  const heaviest = [...result.packages.entries()]
    .map(([name, count]) => ({ name, count, bytes: sizeOf(`node_modules/${name}/`) }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 12)

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sum（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：bytes（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sum, bytes)，并按返回类型处理结果。
   */
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
  return [
    `vfs image: ${relative(repoRoot, outputFile)}`,
    `  roster entries      ${String(result.roster.length)}`,
    `  packages            ${String(result.packages.size)} (${String(workspaceCount)} workspace)`,
    `  files               ${String(Object.keys(result.files).length)}`,
    `  raw                 ${megabytes(Object.values(result.files).reduce((sum, bytes) => sum + bytes.byteLength, 0))}`,
    `  compressed          ${megabytes(result.image.byteLength)}`,
    `  config + presets    ${megabytes(sizeOf('config/'))}`,
    `  javascript entries  ${String(result.javascriptEntries)} (dropped ${String(result.executables.length)} executable scripts, ${String(result.pageBundles.length)} page bundles verbatim)`,
    `  wrapper contract    ${result.contract}`,
    `  transform           ${String(result.transform.rewritten)} of ${String(result.transform.visited)} reached entries rewritten, ${String(result.droppedJavascriptEntries)} unreachable dropped`,
    `  unresolved          ${String(result.unresolvedExternalRequests.length)} third-party request(s) left to fail loud at require time`,
    '  heaviest packages:',
    ...heaviest.map(entry => `    ${entry.bytes.toString().padStart(9)} B  ${entry.name} (${String(entry.count)} files)`),
    ...result.missing.length === 0
      ? []
      : ['  unresolved dependencies:', ...result.missing.map(entry => `    ${entry}`)],
    '',
  ]
}
