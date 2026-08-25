/**
 * Verify that the executable deploy manifest supplies every plugin referenced
 * by a shipped agent preset and every required workspace peer in its dependency
 * graph. With auto peer installation disabled, either omission can otherwise
 * fail only when Cordis loads the packaged plugin.
 */
/**
 * 文件职责：实现 verify-runtime-closure.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */
import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isCordisGroupEntry, loadCordisYaml } from './cordis-yaml.ts'

/** 中文说明：interface PackageManifest 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/** 中文说明：interface WorkspacePackage 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface WorkspacePackage {
  path: string
  manifest: PackageManifest
}

/** 中文说明：interface RuntimePlatform 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface RuntimePlatform {
  tag: string
  executable: string
}

/** 中文说明：type RuntimePlatformManifest 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
type RuntimePlatformManifest = Record<string, RuntimePlatform>

/** 中文说明：常量 AGENT_PRESET_GLOB 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const AGENT_PRESET_GLOB = 'apps/cli/config/agent-presets/*/agent.cordis.yml'

/** 中文说明：interface RuntimeClosureResult 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export interface RuntimeClosureResult {
  failures: string[]
  presetCount: number
  workspacePackageCount: number
}

/**
 * Check that the runtime manifest contains every shipped-preset plugin and workspace peer.
 * @param root repository root containing the runtime manifest and shipped presets.
 * @param manifestPath runtime manifest path relative to {@link root}.
 * @returns the discovered preset count, reachable workspace package count, and violations.
 */
/** 中文说明：函数 verifyRuntimeClosure 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export async function verifyRuntimeClosure(
  root: string,
  manifestPath = 'python/sdk-runtime/package.json',
): Promise<RuntimeClosureResult> {
  /** 中文说明：变量 runtimeManifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const runtimeManifest = await loadManifest(resolve(root, manifestPath))
  /** 中文说明：变量 runtimeName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const runtimeName = runtimeManifest.name ?? manifestPath
  /** 中文说明：变量 workspace 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const workspace = await loadWorkspacePackages(root)
  /** 中文说明：变量 runtimeDependencies 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const runtimeDependencies = runtimeManifest.dependencies ?? {}
  /** 中文说明：变量 platforms 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const platforms = await loadJson<RuntimePlatformManifest>(resolve(root, 'python/sdk-runtime/platforms.json'))
  /** 中文说明：变量 presetPaths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const presetPaths = globSync(AGENT_PRESET_GLOB, { cwd: root }).sort()
  /** 中文说明：变量 targets 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const targets = Object.keys(platforms).sort()
  /** 中文说明：变量 parents 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parents = new Map<string, string | undefined>()
  /** 中文说明：变量 queue 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const queue: string[] = []

  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const dependency of Object.keys(runtimeDependencies).sort()) {
    if (!workspace.has(dependency)) continue
    parents.set(dependency, undefined)
    queue.push(dependency)
  }

  /** 中文说明：变量 failures 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const failures: string[] = []
  if (presetPaths.length === 0) failures.push(`no agent presets matched ${AGENT_PRESET_GLOB}`)
  if (targets.length === 0) failures.push('python/sdk-runtime/platforms.json defines no runtime targets')
  failures.push(...await missingPresetPlugins(root, runtimeDependencies, presetPaths, targets))
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < queue.length; index += 1) {
    /** 中文说明：变量 packageName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packageName = queue[index]
    if (packageName === undefined) continue
    /** 中文说明：变量 current 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const current = workspace.get(packageName)
    if (current === undefined) continue
    /** 中文说明：变量 peers 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const peers = current.manifest.peerDependencies ?? {}
    /** 中文说明：变量 peerMeta 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const peerMeta = current.manifest.peerDependenciesMeta ?? {}
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const peer of Object.keys(peers).sort()) {
      if (!workspace.has(peer) || peerMeta[peer]?.optional === true) continue
      if (runtimeDependencies[peer]?.startsWith('workspace:') === true) continue
      failures.push(`${formatChain(runtimeName, packageName, parents)} -> ${peer}`)
    }
    /** 中文说明：变量 dependencies 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dependencies = {
      ...current.manifest.dependencies,
      ...current.manifest.optionalDependencies,
    }
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const dependency of Object.keys(dependencies).sort()) {
      if (!workspace.has(dependency) || parents.has(dependency)) continue
      parents.set(dependency, packageName)
      queue.push(dependency)
    }
  }

  return {
    failures,
    presetCount: presetPaths.length,
    workspacePackageCount: queue.length,
  }
}

if (import.meta.main) {
  /** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = resolve(import.meta.dirname, '..')
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { manifest: { type: 'string' } },
  })
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = await verifyRuntimeClosure(root, values.manifest)
  if (result.failures.length > 0) {
    console.error('verify-runtime-closure: preset plugins or required workspace peers are missing from python/sdk-runtime dependencies:')
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const failure of result.failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    console.log(
      `verify-runtime-closure: ${result.presetCount} agent presets and ${result.workspacePackageCount} workspace packages form a closed runtime dependency graph.`,
    )
  }
}

/** 中文说明：函数 missingPresetPlugins 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function missingPresetPlugins(
  root: string,
  runtimeDependencies: Readonly<Record<string, string>>,
  presetPaths: readonly string[],
  targets: readonly string[],
): Promise<string[]> {
  /** 中文说明：变量 missing 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const missing = new Map<string, Set<string>>()
  /** 中文说明：变量 failures 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const failures: string[] = []
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const presetPath of presetPaths) {
    /** 中文说明：变量 document 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const document = loadCordisYaml(await readFile(resolve(root, presetPath), 'utf8'))
    if (!Array.isArray(document)) {
      failures.push(`${presetPath}: preset root must be a Loader entry array`)
      continue
    }
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const target of targets) {
      /** 中文说明：变量 processPlatform 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const processPlatform = processPlatformForTarget(target)
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const plugin of activeBarePluginPackages(document, processPlatform)) {
        /** 中文说明：变量 version 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const version = runtimeDependencies[plugin]
        if (version?.startsWith('workspace:') === true) continue
        /** 中文说明：变量 preset 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const preset = basename(dirname(presetPath))
        /** 中文说明：变量 declaration 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const declaration = version === undefined
          ? ''
          : ` [runtime dependency is ${JSON.stringify(version)}; expected workspace:]`
        /** 中文说明：变量 key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const key = `${preset} preset -> ${plugin}${declaration}`
        /** 中文说明：变量 targets 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const targets = missing.get(key) ?? new Set<string>()
        targets.add(target)
        missing.set(key, targets)
      }
    }
  }
  failures.push(...[...missing.entries()].map(([chain, targets]) =>
    `${chain} (${[...targets].sort().join(', ')})`))
  return failures
}

/** 中文说明：函数 activeBarePluginPackages 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function activeBarePluginPackages(entries: unknown[], processPlatform: string): Set<string> {
  /** 中文说明：变量 packages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packages = new Set<string>()
  /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const visit = (value: unknown, parentDisabled: boolean): void => {
    if (!isRecord(value)) return
    /** 中文说明：变量 disabled 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disabled = parentDisabled || disabledOnPlatform(value.disabled, processPlatform)
    if (disabled) return
    if (typeof value.name === 'string') {
      /** 中文说明：变量 packageName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const packageName = barePackageName(value.name)
      if (packageName !== undefined) packages.add(packageName)
    }
    if (isCordisGroupEntry(value)) {
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const child of value.config) visit(child, disabled)
    }
  }
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const entry of entries) visit(entry, false)
  return packages
}

/** 中文说明：函数 disabledOnPlatform 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function disabledOnPlatform(value: unknown, processPlatform: string): boolean {
  if (typeof value === 'boolean') return value
  if (!isRecord(value) || typeof value.__jsExpr !== 'string') return false
  /** 中文说明：变量 match 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const match = /^process\.platform\s*(===|!==)\s*(['"])(win32|linux|darwin)\2$/.exec(value.__jsExpr.trim())
  if (match === null) return false
  const [, operator, , expected] = match
  return operator === '===' ? processPlatform === expected : processPlatform !== expected
}

/** 中文说明：函数 processPlatformForTarget 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function processPlatformForTarget(target: string): string {
  if (target.startsWith('linux-')) return 'linux'
  if (target.startsWith('macos-')) return 'darwin'
  throw new Error(`verify-runtime-closure: unsupported runtime target ${JSON.stringify(target)}`)
}

/** 中文说明：函数 barePackageName 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function barePackageName(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) return undefined
  /** 中文说明：变量 parts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined
  }
  return parts[0] || undefined
}

/** 中文说明：函数 isRecord 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 中文说明：函数 loadWorkspacePackages 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function loadWorkspacePackages(root: string): Promise<Map<string, WorkspacePackage>> {
  /** 中文说明：变量 paths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const paths = globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: root })
    .sort()
    .map(relative => resolve(root, relative))
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = new Map<string, WorkspacePackage>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const path of paths) {
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = await loadManifest(path)
    if (manifest.name !== undefined) result.set(manifest.name, { path, manifest })
  }
  return result
}

/** 中文说明：函数 loadManifest 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function loadManifest(path: string): Promise<PackageManifest> {
  return loadJson<PackageManifest>(path)
}

/** 中文说明：函数 loadJson 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

/** 中文说明：函数 formatChain 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function formatChain(
  runtimeName: string,
  packageName: string,
  parents: ReadonlyMap<string, string | undefined>,
): string {
  /** 中文说明：变量 chain 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chain = [packageName]
  /** 中文说明：变量 parent 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let parent = parents.get(packageName)
  while (parent !== undefined) {
    chain.unshift(parent)
    parent = parents.get(parent)
  }
  return [runtimeName, ...chain].join(' -> ')
}
