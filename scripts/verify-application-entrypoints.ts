/**
 * Enforce dsh profiles as the only supported Node application launcher.
 * Vendor CLIs, build tools, and test tools are explicit classifications
 * rather than implicit holes.
 * @remarks 文件说明：文件职责：实现 仓库维护脚本 中 verify application entrypoints 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 仓库维护脚本 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

type ManifestBin = string | Record<string, string>

interface PackageManifest {
  readonly bin?: unknown
}

interface RootManifest {
  readonly scripts?: Record<string, unknown>
}

interface DemoPolicy {
  readonly kind: 'dsh-direct' | 'dsh-wrapper'
  readonly wrapper?: string
}

/** Public product launcher plus the private build-only WebWorker packer.
 * @remarks 中文说明：常量说明：MANIFEST_BIN_ALLOWLIST 用于处理 MANIFEST_BIN_ALLOWLIST
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const MANIFEST_BIN_ALLOWLIST = new Map<string, ManifestBin>([
  ['apps/cli/package.json', { dsh: 'lib/bin.js' }],
  ['packages/experimental/webworker-packer/package.json', { 'dsh-pack-vfs-image': './bin.js' }],
])

/** Every executable in a Node application workspace has one explicit role.
 * @remarks 中文说明：常量说明：EXECUTABLE_SOURCE_ALLOWLIST 用于处理
 * EXECUTABLE_SOURCE_ALLOWLIST 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const EXECUTABLE_SOURCE_ALLOWLIST = new Map<string, string>([
  ['apps/cli/src/bin.ts', 'supported dsh application launcher'],
  ['packages/context/time-context/tests/fixtures/driver.ts', 'test-only subprocess driver'],
  ['packages/experimental/webworker-packer/bin.js', 'private build-only wrapper'],
  ['packages/experimental/webworker-packer/src/bin.ts', 'private build-only implementation'],
  ['packages/sdk/client/tests/fake-runtime.ts', 'test-only SDK runtime peer'],
  ['packages/session/session-telemetry-otel/tests/fixtures/driver.ts', 'test-only subprocess driver'],
  ['packages/shell/tool-pwsh/tests/fixtures/loader/driver.ts', 'test-only subprocess driver'],
  ['packages/subagent/subagent-acp/tests/fixtures/loader/driver.ts', 'test-only subprocess driver'],
  ['packages/subagent/subagent-claude-code/tests/fixtures/loader/driver.ts', 'test-only subprocess driver'],
  ['packages/subagent/subagent-codex/tests/fixtures/loader/driver.ts', 'test-only subprocess driver'],
  ['packages/subagent/subagent-dsh-sdk/tests/fixtures/loader/driver.ts', 'test-only subprocess driver'],
  ['packages/test-support/loader-smoke/tests/fixtures/headless-driver.ts', 'test-only subprocess driver'],
  ['packages/test-support/llm-mock-server/src/bin.ts', 'test-only model server'],
])

/** Root demos are application wrappers and therefore must visibly select dsh.
 * @remarks 中文说明：常量说明：ROOT_DEMO_POLICIES 用于处理 ROOT_DEMO_POLICIES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const ROOT_DEMO_POLICIES = new Map<string, DemoPolicy>([
  ['demo:ptc', { kind: 'dsh-wrapper', wrapper: 'scripts/demo-ptc.mjs' }],
  ['demo:inspector', { kind: 'dsh-direct' }],
])

/**
 * 常量说明：SOURCE_PATTERNS 用于处理 SOURCE_PATTERNS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SOURCE_PATTERNS = [
  '*.ts',
  '*.js',
  '*.mjs',
  '*.cjs',
  'apps/**/*.ts',
  'apps/**/*.js',
  'apps/**/*.mjs',
  'apps/**/*.cjs',
  'packages/**/*.ts',
  'packages/**/*.js',
  'packages/**/*.mjs',
  'packages/**/*.cjs',
]

/**
 * 常量说明：SOURCE_EXCLUDES 用于处理 SOURCE_EXCLUDES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SOURCE_EXCLUDES = [
  '**/node_modules/**',
  '**/lib/**',
  '**/dist/**',
  '**/coverage/**',
]

/** Convert a host path from glob output to the repository's slash form.
 * @remarks 中文说明：功能说明：处理 repositoryPath 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 repositoryPath(path)，
 * 并按返回类型处理结果。 */
function repositoryPath(path: string): string {
  return path.split(sep).join('/')
}

/** Stable comparison for string and object npm `bin` declarations.
 * @remarks 中文说明：功能说明：处理 normalizedBin 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string | undefined；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 normalizedBin(value)，
 * 并按返回类型处理结果。 */
function normalizedBin(value: unknown): string | undefined {
  if (typeof value === 'string') return JSON.stringify(value)
  if (!isRecord(value)) return undefined
  /**
   * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const entries = Object.entries(value)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[, target]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([, target])，并按返回类型处理结果。
   */
  if (!entries.every(([, target]) => typeof target === 'string')) return undefined
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[left]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：[right]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([left], [right])，
   * 并按返回类型处理结果。
   */
  return JSON.stringify(Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))))
}

/**
 * 功能说明：处理 manifestBinViolations 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 manifestBinViolations(root)，并按返回类型处理结果。
 */
function manifestBinViolations(root: string): string[] {
  /**
   * 常量说明：failures 用于处理 failures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const failures: string[] = []
  /**
   * 常量说明：manifests 用于处理 manifests 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const manifests = globSync(['apps/*/package.json', 'packages/*/*/package.json'], { cwd: root }).sort()
  /**
   * 变量说明：rawPath 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const rawPath of manifests) {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = repositoryPath(rawPath)
    /**
     * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as PackageManifest
    if (manifest.bin === undefined) continue
    /**
     * 常量说明：expected 用于处理 expected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const expected = MANIFEST_BIN_ALLOWLIST.get(path)
    if (expected === undefined) {
      failures.push(`${path}: package bin bypasses the dsh launcher; applications use apps/cli profiles`)
      continue
    }
    if (normalizedBin(manifest.bin) !== normalizedBin(expected)) {
      failures.push(`${path}: classified bin must remain ${JSON.stringify(expected)}, got ${JSON.stringify(manifest.bin)}`)
    }
  }
  return failures
}

/**
 * 功能说明：处理 executableSourceViolations 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 executableSourceViolations(root)，并按返回类型处理结果。
 */
function executableSourceViolations(root: string): string[] {
  /**
   * 常量说明：failures 用于处理 failures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const failures: string[] = []
  /**
   * 变量说明：rawPath 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const rawPath of globSync(SOURCE_PATTERNS, { cwd: root, exclude: SOURCE_EXCLUDES }).sort()) {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = repositoryPath(rawPath)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = readFileSync(resolve(root, path), 'utf8')
    if (!source.startsWith('#!')) continue
    if (!EXECUTABLE_SOURCE_ALLOWLIST.has(path)) {
      failures.push(`${path}: executable source has no application/build/test classification`)
    }
  }
  return failures
}

/**
 * 功能说明：处理 referencesDshCli 相关流程；使用场景由所在模块及调用位置决定。
 * @param source （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 referencesDshCli(source)，并按返回类型处理结果。
 */
function referencesDshCli(source: string): boolean {
  return source.includes('apps/cli/src/bin.ts')
}

/**
 * 功能说明：处理 referencesPackageEntry 相关流程；使用场景由所在模块及调用位置决定。
 * @param source （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 referencesPackageEntry(source)，并按返回类型处理结果。
 */
function referencesPackageEntry(source: string): boolean {
  return /packages\/[^/\s'"`]+\/[^/\s'"`]+\/(?:src|lib)\/[^\s'"`]+/.test(source)
}

/**
 * 功能说明：处理 rootDemoViolations 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rootDemoViolations(root)，并按返回类型处理结果。
 */
function rootDemoViolations(root: string): string[] {
  /**
   * 常量说明：manifestPath 用于处理 manifestPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const manifestPath = resolve(root, 'package.json')
  if (!existsSync(manifestPath)) return []
  /**
   * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RootManifest
  /**
   * 常量说明：failures 用于处理 failures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const failures: string[] = []
  /**
   * 变量说明：name、commandValue 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[left]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：[right]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([left], [right])，
   * 并按返回类型处理结果。
   */
  for (const [name, commandValue] of Object.entries(manifest.scripts ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (!name.startsWith('demo:')) continue
    /**
     * 常量说明：command 用于处理 command 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const command = typeof commandValue === 'string' ? commandValue : ''
    /**
     * 常量说明：policy 用于处理 policy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const policy = ROOT_DEMO_POLICIES.get(name)
    if (policy === undefined) {
      failures.push(`package.json scripts.${name}: demo launcher has no explicit dsh or in-process classification`)
      continue
    }
    if (policy.kind === 'dsh-direct') {
      if (!referencesDshCli(command)) failures.push(`package.json scripts.${name}: application demo must launch apps/cli/src/bin.ts`)
      if (referencesPackageEntry(command)) failures.push(`package.json scripts.${name}: application demo must not launch a package entry directly`)
      continue
    }
    /**
     * 常量说明：wrapper 用于处理 wrapper 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const wrapper = policy.wrapper
    if (wrapper === undefined || !command.includes(wrapper)) {
      failures.push(`package.json scripts.${name}: classified wrapper must be ${String(wrapper)}`)
      continue
    }
    /**
     * 常量说明：wrapperPath 用于处理 wrapperPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const wrapperPath = resolve(root, wrapper)
    if (!existsSync(wrapperPath)) {
      failures.push(`${wrapper}: classified demo wrapper is missing`)
      continue
    }
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = readFileSync(wrapperPath, 'utf8')
    if (!referencesDshCli(source)) failures.push(`${wrapper}: application demo wrapper must launch apps/cli/src/bin.ts`)
    if (referencesPackageEntry(source)) failures.push(`${wrapper}: application demo wrapper must not launch a package entry directly`)
  }
  return failures
}

/**
 * Find unsupported application entrypoints below a repository root.
 * @param root - repository or test-fixture root.
 * @returns deterministic path-qualified violations.
 * @remarks 中文说明：功能说明：处理 applicationEntrypointViolations 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：root（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：string[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * applicationEntrypointViolations(root)，并按返回类型处理结果。
 */
export function applicationEntrypointViolations(root: string): string[] {
  return [
    ...manifestBinViolations(root),
    ...executableSourceViolations(root),
    ...rootDemoViolations(root),
  ]
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = resolve(import.meta.dirname, '..')
  /**
   * 常量说明：failures 用于处理 failures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const failures = applicationEntrypointViolations(root)
  if (failures.length > 0) {
    console.error('verify-application-entrypoints: unsupported launcher(s):')
    /**
     * 变量说明：failure 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    console.log('verify-application-entrypoints: dsh is the only supported Node application launcher.')
  }
}
