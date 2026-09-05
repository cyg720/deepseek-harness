/**
 * Validate Cordis Loader entry metadata and package resolution.
 *
 * The Loader interpolates a plugin entry's `config` (after declared injections
 * activate, against that plugin context) and the entry `disabled` field (at
 * every mount decision, against the loader context). Every other entry
 * metadata field stays static, so an expression there remains truthy data and
 * silently changes composition. Shipped and test-only dsh overlays resolve
 * named plugins from the CLI application's owning manifest; package-owned
 * Loader fixtures resolve from their package manifest.
 */
/*
 * 文件职责：实现 verify-cordis-config.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { Script } from 'node:vm'
import ts from 'typescript'
import { cordisConfigFiles } from './cordis-config-files.ts'
import { isCordisGroupEntry, isJsExpr, loadCordisYaml } from './cordis-yaml.ts'

/** 中文说明：interface PackageManifest 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}

/** 中文说明：interface PluginReference 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export interface PluginReference {
  file: string
  name: string
}

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
// These overlays are consumed by the built dsh app, so their bare specifiers
// resolve from apps/cli.
const appOverlayFiles = new Set([
  ...globSync('apps/cli/config/examples/**/*.yml', { cwd: root }),
])
/** 中文说明：变量 metadataFields 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const metadataFields = ['id', 'name', 'group', 'inject', 'intercept', 'isolate'] as const

/** The adaptive directory-picker chooser package (mounts a backend row at boot). */
/* 中文说明：常量 CHOOSER_PACKAGE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CHOOSER_PACKAGE = '@deepseek-ai/dsh-host-directory-picker-auto'

/**
 * The packages the chooser mounts by runtime string (mirror of its exported
 * `BACKEND_PACKAGES` and `SURFACE_PACKAGES`), invisible to yml-row scanning: a
 * composition mounting the chooser must resolve every one, or keyless Linux CI
 * (which only ever resolves `browse`) hides a dropped `-native` dependency
 * until a macOS boot.
 */
/* 中文说明：常量 CHOOSER_BACKEND_PACKAGES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CHOOSER_BACKEND_PACKAGES = [
  '@deepseek-ai/dsh-host-directory-picker-native',
  '@deepseek-ai/dsh-host-directory-picker-browse',
  '@deepseek-ai/dsh-client-ui-directory-picker-browse',
  '@deepseek-ai/dsh-client-ui-directory-picker-native',
]
/** 中文说明：变量 errors 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const errors: string[] = []
/** 中文说明：变量 pluginReferences 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const pluginReferences: PluginReference[] = []

if (import.meta.main) {
  /** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const files = cordisConfigFiles(root)

  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const file of files) {
    /** 中文说明：变量 document 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const document = loadCordisYaml(readFileSync(resolve(root, file), 'utf8'))
    if (!isUnknownArray(document)) {
      errors.push(`${file}: root must be a Loader entry array`)
      continue
    }
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (let index = 0; index < document.length; index++) {
      validateEntry(document[index], file, `[${index}]`)
    }
  }

  errors.push(...validateAppResolution())
  errors.push(...validatePackageTestResolution())
  errors.push(...packageTestFixtureDependencyErrors())
  errors.push(...validateSourcePlaneResolution())
  errors.push(...validatePresetPlaneSeparation())
  errors.push(...validateClientHalvesDeclared())

  if (errors.length > 0) {
    console.error('verify-cordis-config: invalid Loader metadata or plugin package resolution:')
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else {
    console.log(`verify-cordis-config: ${files.length} config files passed.`)
  }
}

/**
 * A browser plugin must declare the browser half it ships.
 *
 * The browser roster is discovered by scanning composed packages for a
 * `dsh.client` block, and the node half of a surface plugin is an empty
 * `apply`. A `packages/client` package that exports `./client` without that
 * block therefore composes, activates, and contributes nothing — its bundle is
 * never served and no error is raised anywhere. The mismatch is invisible in
 * the composition file, so it is checked against the manifests instead. Only
 * this group is checked: a Host package's `./client` export is the typed wire
 * face its browser consumers import, not a plugin the roster serves.
 * @returns one violation per client package whose `./client` export and
 * `dsh.client` declaration disagree.
 */
/* 中文说明：函数 validateClientHalvesDeclared 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function validateClientHalvesDeclared(): string[] {
  return globSync('packages/client/*/package.json', { cwd: root }).flatMap((manifestPath) => {
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = readManifest(manifestPath) as PackageManifest & {
      exports?: Record<string, unknown>
      dsh?: { client?: unknown }
    }
    /** 中文说明：变量 shipsClient 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shipsClient = manifest.exports !== undefined && Object.hasOwn(manifest.exports, './client')
    /** 中文说明：变量 declaresClient 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const declaresClient = manifest.dsh?.client !== undefined
    if (shipsClient === declaresClient) return []
    return [shipsClient
      ? `${manifestPath}: exports "./client" but declares no dsh.client, so its browser half is never served`
      : `${manifestPath}: declares dsh.client but exports no "./client" entry to serve`]
  })
}

/**
 * No shipped agent preset may repeat a row the host composition still runs.
 *
 * A preset contributes what ONE session adds to the host's registries. A row
 * active on both planes is therefore mounted twice — once per process and once
 * per session — and what that costs depends on what the row does: a provider
 * behind an `isolate` realm shadows the host's for its own consumers, so a host
 * contributor to that service reaches nobody; a row that registers into a host
 * singleton registers once per live session, so the second one collides.
 *
 * Both failure modes have occurred. A preset-local provider once shadowed the
 * host route that its consumer needed, and a host-registry contribution once
 * registered again for every live session until the second registration threw.
 * Neither changes a tool catalog, so no catalog assertion can see them — and the
 * shipped presets are near-copies of each other, so a fix applied to three of
 * four is the normal failure.
 * @returns one diagnostic per preset row that is also active on the host plane.
 */
/* 中文说明：函数 validatePresetPlaneSeparation 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function validatePresetPlaneSeparation(): string[] {
  /** 中文说明：变量 problems 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const problems: string[] = []
  // The shipped Web surface is two bundle patch layers over an empty root.
  /** 中文说明：变量 hostFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const hostFile = 'packages/bundle/base/cordis.patch.yml'
  /** 中文说明：变量 overlayFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const overlayFile = 'packages/bundle/web-app/cordis.patch.yml'
  /** 中文说明：变量 hostRows 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const hostRows = rowIds(hostFile)
  /** 中文说明：变量 overlay 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const overlay = loadEntries(overlayFile)
  /** 中文说明：变量 disabled 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const disabled = new Set<string>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const entry of overlay) {
    if (!isRecord(entry)) continue
    if (entry.disabled === true && typeof entry.id === 'string') disabled.add(entry.id)
  }
  // The overlay's own inserts are host-plane too; its disables take them back out.
  /** 中文说明：函数值 active 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const active = new Set([...hostRows, ...rowIds(overlayFile)].filter(id => !disabled.has(id)))
  for (const file of globSync('packages/preset/agent-presets/presets/*/agent.cordis.yml', { cwd: root })) {
    for (const id of rowIds(file)) {
      if (!active.has(id)) continue
      problems.push(
        `${file}: row "${id}" is also active in the host composition; `
        + 'a row belongs to exactly one plane',
      )
    }
  }
  return problems
}

/** Every entry of one config file, or an empty list when it is not an entry array. */
/* 中文说明：函数 loadEntries 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function loadEntries(file: string): unknown[] {
  /** 中文说明：变量 document 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const document = loadCordisYaml(readFileSync(resolve(root, file), 'utf8'))
  return isUnknownArray(document) ? document : []
}

/**
 * Row ids declared anywhere in one config file, including inside group `config`
 * lists — a preset nests most of its rows in `isolate` groups.
 * @param file - repository-relative config path.
 * @returns the declared ids.
 */
/* 中文说明：函数 rowIds 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function rowIds(file: string): Set<string> {
  /** 中文说明：变量 ids 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ids = new Set<string>()
  /** 中文说明：函数值 walk 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const walk = (value: unknown): void => {
    if (isUnknownArray(value)) {
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const item of value) walk(item)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.id === 'string' && typeof value.name === 'string') ids.add(value.id)
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const child of Object.values(value)) walk(child)
  }
  walk(loadEntries(file))
  return ids
}

/** 中文说明：函数 validateEntry 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function validateEntry(value: unknown, file: string, path: string): void {
  if (!isRecord(value)) {
    errors.push(`${file}${path}: entry must be an object`)
    return
  }
  recordPlugin(value, file)
  validateMetadata(value, file, path)
  if (isCordisGroupEntry(value)) {
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (let index = 0; index < value.config.length; index++) {
      validateEntry(value.config[index], file, `${path}.config[${index}]`)
    }
  }
  if (isUnknownArray(value.insert)) {
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (let index = 0; index < value.insert.length; index++) {
      validateEntry(value.insert[index], file, `${path}.insert[${index}]`)
    }
  }
  if (value.name !== '@deepseek-ai/cordis-plugin-include') return
  /** 中文说明：变量 config 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const config = value.config
  if (!isRecord(config) || !isUnknownArray(config.patches)) return
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < config.patches.length; index++) {
    /** 中文说明：变量 patch 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const patch = config.patches[index]
    /** 中文说明：变量 patchPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const patchPath = `${path}.config.patches[${index}]`
    if (!isRecord(patch)) continue
    recordPlugin(patch, file)
    validateMetadata(patch, file, patchPath)
    if (!isUnknownArray(patch.insert)) continue
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (let insertIndex = 0; insertIndex < patch.insert.length; insertIndex++) {
      validateEntry(patch.insert[insertIndex], file, `${patchPath}.insert[${insertIndex}]`)
    }
  }
}

/** 中文说明：函数 recordPlugin 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function recordPlugin(entry: Record<string, unknown>, file: string): void {
  if (typeof entry.name === 'string') pluginReferences.push({ file, name: entry.name })
}

function validateAppResolution(): string[] {
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  /** 中文说明：变量 bundleManifests 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bundleManifests = bundleManifestPaths()
  // App overlays (and any config left under apps/cli/config) resolve from the
  // dsh app's own dependency surface — the profile module fallback mirrors it.
  const appManifest = readManifest('apps/cli/package.json')
  const appDependencies = {
    ...appManifest.dependencies,
    // The fallback also links every in-box bundle's own dependencies
    // (healProfilesModuleFallback). Optional Profile bundles stay outside the
    // app installation until that Profile installs them.
    ...Object.fromEntries(globSync('packages/bundle/*/package.json', { cwd: root })
      .flatMap(file => Object.entries(readManifest(file).dependencies ?? {}))),
  }
  /** 中文说明：变量 shipped 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const shipped = new Set(globSync('*.cordis.yml', { cwd: resolve(root, 'apps/cli/config') })
    .map(file => `apps/cli/config/${file}`))
  /** 中文说明：函数值 appReferences 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const appReferences = pluginReferences.filter(reference => shipped.has(reference.file) || appOverlayFiles.has(reference.file))
  violations.push(...missingPluginDependencies(
    appReferences,
    appDependencies,
    'apps/cli/package.json dependencies or a bundle manifest',
  ))
  const appTestReferences = pluginReferences.filter(reference => reference.file.startsWith('apps/cli/tests/'))
  violations.push(...missingPluginDependencies(
    appTestReferences,
    { ...appManifest.dependencies, ...appManifest.devDependencies },
    'apps/cli/package.json dependencies or devDependencies',
  ))
  // Each bundle's patch rows must resolve from that bundle's own dependencies:
  // per-layer resolution anchors on the bundle package directory.
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const manifestPath of bundleManifests) {
    /** 中文说明：变量 bundleDir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bundleDir = manifestPath.replace(/\/package\.json$/, '')
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = readManifest(manifestPath)
    /** 中文说明：变量 patch 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const patch = manifest.dsh?.bundle?.patch
    if (typeof patch !== 'string') continue
    /** 中文说明：变量 patchFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const patchFile = relative(root, resolve(root, bundleDir, patch)).replaceAll('\\', '/')
    /** 中文说明：函数值 references 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const references = pluginReferences.filter(reference => reference.file === patchFile)
    violations.push(...bundlePluginDependencyErrors(manifestPath, manifest, references))
  }
  return violations
}

/**
 * Package-owned Loader fixtures resolve named plugins from their package's
 * dependency surface, not from a repository-level test umbrella.
 * @returns one violation per configured package absent from the owner manifest.
 */
function validatePackageTestResolution(): string[] {
  const referencesByManifest = new Map<string, PluginReference[]>()
  for (const reference of pluginReferences) {
    const manifestPath = packageTestManifestPath(reference.file)
    if (manifestPath === undefined) continue
    const references = referencesByManifest.get(manifestPath) ?? []
    references.push(reference)
    referencesByManifest.set(manifestPath, references)
  }
  return [...referencesByManifest].flatMap(([manifestPath, references]) =>
    packageTestPluginDependencyErrors(manifestPath, readManifest(manifestPath), references))
}

/**
 * Validate the named plugins one package-owned Loader fixture resolves.
 * Self-references use Node package self-resolution; every other package must
 * be an ordinary production or test dependency of the owner.
 * @param manifestPath Repository-relative owner manifest path.
 * @param manifest Parsed owner manifest.
 * @param references Named plugin references from owner-local test configs.
 * @returns Missing dependency diagnostics.
 */
export function packageTestPluginDependencyErrors(
  manifestPath: string,
  manifest: PackageManifest,
  references: readonly PluginReference[],
): string[] {
  return missingPluginDependencies(
    references.filter(reference => packageNameFromSpecifier(reference.name) !== manifest.name),
    { ...manifest.dependencies, ...manifest.devDependencies },
    `${manifestPath} dependencies or devDependencies`,
  )
}

/**
 * Validate imports made by fixture modules adjacent to package-owned Loader
 * configs. These files execute as plain Node/tsx children, so a stale root
 * `node_modules` link must not hide an undeclared dependency.
 * @param repoRoot Repository root to scan.
 * @returns Missing dependency diagnostics.
 */
export function packageTestFixtureDependencyErrors(repoRoot: string = root): string[] {
  const fixtureDirectories = new Set(cordisConfigFiles(repoRoot)
    .filter(file => packageTestManifestPath(file) !== undefined)
    .map(file => dirname(file).replaceAll('\\', '/')))
  if (fixtureDirectories.size === 0) {
    return ['package test fixture dependency scan found no package-owned Loader configs']
  }
  const referencesByManifest = new Map<string, PluginReference[]>()
  let fixtureModuleCount = 0
  for (const fixtureDirectory of fixtureDirectories) {
    const files = globSync([
      `${fixtureDirectory}/**/*.ts`,
      `${fixtureDirectory}/**/*.mjs`,
    ], { cwd: repoRoot })
    fixtureModuleCount += files.length
    for (const file of files) {
      const manifestPath = packageTestManifestPath(file)
      if (manifestPath === undefined) continue
      const references = referencesByManifest.get(manifestPath) ?? []
      const source = readFileSync(resolve(repoRoot, file), 'utf8')
      for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
        references.push({ file: file.replaceAll('\\', '/'), name: imported.fileName })
      }
      referencesByManifest.set(manifestPath, references)
    }
  }
  if (fixtureModuleCount === 0) {
    return ['package test fixture dependency scan found no fixture modules beside Loader configs']
  }
  return [...referencesByManifest].flatMap(([manifestPath, references]) =>
    packageTestPluginDependencyErrors(
      manifestPath,
      readManifest(manifestPath, repoRoot),
      references,
    ))
}

/** Owner manifest for a package-local test path. */
function packageTestManifestPath(file: string): string | undefined {
  const match = /^(packages\/[^/]+\/[^/]+)\/tests(?:\/|$)/.exec(file.replaceAll('\\', '/'))
  return match?.[1] === undefined ? undefined : `${match[1]}/package.json`
}

/**
 * Discover workspace Bundle packages from their manifest declaration.
 * @param repoRoot Repository root to scan.
 * @returns Sorted slash-normalized repository-relative package manifest paths.
 */
/* 中文说明：函数 bundleManifestPaths 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function bundleManifestPaths(repoRoot: string = root): string[] {
  return globSync('packages/*/*/package.json', { cwd: repoRoot })
    .filter(path => typeof readManifest(path, repoRoot).dsh?.bundle?.patch === 'string')
    .map(path => path.replaceAll('\\', '/'))
    .sort()
}

/**
 * Validate plugin packages referenced by one Bundle patch.
 * @param manifestPath Repository-relative Bundle manifest path.
 * @param manifest Parsed Bundle manifest.
 * @param references Plugin rows read from the Bundle package directory.
 * @returns Missing production dependency diagnostics.
 */
/* 中文说明：函数 bundlePluginDependencyErrors 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function bundlePluginDependencyErrors(
  manifestPath: string,
  manifest: PackageManifest,
  references: readonly PluginReference[],
): string[] {
  return missingPluginDependencies(
    // A Bundle may mount its own package (for example, its provider or runtime row).
    references.filter(reference => packageNameFromSpecifier(reference.name) !== manifest.name),
    manifest.dependencies ?? {},
    `${manifestPath} dependencies`,
  )
}

/**
 * Every configured specifier of a local workspace package must resolve through
 * the tsconfig `paths` facade to a `.ts`/`.tsx` source file. The `dsh` source
 * launch (tsx) and vitest resolve in the source plane; without a `paths` match
 * they fall back to package `exports`, which reach built `lib/` — present on a
 * built dev tree, absent on a clean one — so a missing mapping boots locally
 * yet breaks every clean checkout. Anything but a `.ts`/`.tsx` hit (a `.d.ts`
 * or `.js` under built `lib/`) is that artifact-plane fallback, not source.
 */
/* 中文说明：函数 validateSourcePlaneResolution 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function validateSourcePlaneResolution(): string[] {
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  /** 中文说明：变量 localPackages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const localPackages = localPackageDirectories()
  /** 中文说明：函数值 config 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const config = ts.readConfigFile(resolve(root, 'tsconfig.base.json'), path => ts.sys.readFile(path))
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  }
  const { options, errors: optionErrors } = ts.convertCompilerOptionsFromJson(
    (config.config as { compilerOptions?: unknown }).compilerOptions,
    root,
    'tsconfig.base.json',
  )
  if (optionErrors.length > 0) {
    throw new Error(optionErrors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }
  // convertCompilerOptionsFromJson leaves `pathsBasePath` unset, so relative
  // `paths` targets resolve against the host's current directory; anchor it to
  // the repository root to keep the gate cwd-independent.
  /** 中文说明：变量 host 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const host: ts.ModuleResolutionHost = {
    fileExists: path => ts.sys.fileExists(path),
    readFile: path => ts.sys.readFile(path),
    directoryExists: path => ts.sys.directoryExists(path),
    getCurrentDirectory: () => root,
  }
  /** 中文说明：变量 sourceExtensions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceExtensions = new Set<string>([ts.Extension.Ts, ts.Extension.Tsx])
  /** 中文说明：变量 containingFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const containingFile = resolve(root, 'scripts/verify-cordis-config.ts')
  /** 中文说明：变量 locationsBySpecifier 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const locationsBySpecifier = new Map<string, Set<string>>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const reference of pluginReferences) {
    /** 中文说明：变量 packageName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packageName = packageNameFromSpecifier(reference.name)
    if (packageName === undefined || !localPackages.has(packageName)) continue
    /** 中文说明：变量 locations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const locations = locationsBySpecifier.get(reference.name) ?? new Set<string>()
    locations.add(reference.file)
    locationsBySpecifier.set(reference.name, locations)
  }
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const [specifier, locations] of locationsBySpecifier) {
    /** 中文说明：变量 resolved 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = ts.resolveModuleName(specifier, containingFile, options, host).resolvedModule
    if (resolved !== undefined && sourceExtensions.has(resolved.extension)) continue
    violations.push(`${[...locations].join(', ')}: ${specifier} does not resolve to workspace source through tsconfig.base.json paths (add a mapping so the tsx source launch does not depend on built lib/)`)
  }
  return violations
}

/** 中文说明：函数 missingPluginDependencies 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function missingPluginDependencies(
  references: readonly PluginReference[],
  dependencies: Readonly<Record<string, string>>,
  dependencyOwner: string,
): string[] {
  /** 中文说明：变量 requiredPackages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const requiredPackages = new Map<string, Set<string>>()
  /** 中文说明：函数值 require 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const require = (packageName: string, file: string): void => {
    /** 中文说明：变量 locations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const locations = requiredPackages.get(packageName) ?? new Set<string>()
    locations.add(file)
    requiredPackages.set(packageName, locations)
  }
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const reference of references) {
    /** 中文说明：变量 packageName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packageName = packageNameFromSpecifier(reference.name)
    if (packageName === undefined) continue
    require(packageName, reference.file)
    if (packageName === CHOOSER_PACKAGE) {
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const backend of CHOOSER_BACKEND_PACKAGES) require(backend, reference.file)
    }
  }
  return [...requiredPackages].flatMap(([packageName, locations]) => packageName in dependencies
    ? []
    : `${[...locations].join(', ')}: ${packageName} must be declared in ${dependencyOwner}`)
}

/** 中文说明：函数 readManifest 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readManifest(path: string, repoRoot: string = root): PackageManifest {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as PackageManifest
}

/** 中文说明：函数 localPackageDirectories 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function localPackageDirectories(): Map<string, string> {
  /** 中文说明：变量 manifests 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifests = globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: root })
  /** 中文说明：变量 packages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packages = new Map<string, string>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const manifestPath of manifests) {
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = readManifest(manifestPath)
    if (manifest.name !== undefined) packages.set(manifest.name, resolve(root, dirname(manifestPath)))
  }
  return packages
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || /^[a-z][a-z+.-]*:/i.test(specifier)) return undefined
  /** 中文说明：变量 segments 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const segments = specifier.split('/')
  if (specifier.startsWith('@')) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined
  }
  return segments[0] || undefined
}

/** 中文说明：函数 validateMetadata 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function validateMetadata(entry: Record<string, unknown>, file: string, path: string): void {
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const problem of metadataExpressionErrors(entry, path)) {
    errors.push(`${file}${problem}`)
  }
}

/**
 * Expression-node diagnostics for one entry. `disabled` is the single
 * interpolated metadata field: its own `!!js` expression node is allowed and
 * must parse, while expressions nested below it stay truthy data; every other
 * metadata field must stay fully static.
 * @param entry - one loader entry (or patch row).
 * @param path - the entry's diagnostic path prefix.
 * @returns one diagnostic per offending expression.
 */
/* 中文说明：函数 metadataExpressionErrors 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function metadataExpressionErrors(entry: Record<string, unknown>, path: string): string[] {
  /** 中文说明：变量 problems 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const problems: string[] = []
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const field of metadataFields) {
    if (!(field in entry)) continue
    /** 中文说明：变量 expressionPaths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expressionPaths: string[] = []
    collectExpressionPaths(entry[field], `${path}.${field}`, expressionPaths)
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const expressionPath of expressionPaths) problems.push(`${expressionPath}: !!js is not interpolated here`)
  }
  /** 中文说明：变量 disabled 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const disabled = entry.disabled
  if (disabled !== undefined) {
    if (isJsExpr(disabled)) {
      /** 中文说明：变量 detail 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const detail = disabledExpressionProblem(disabled.__jsExpr)
      if (detail !== undefined) problems.push(`${path}.disabled${detail}`)
    } else {
      // A non-expression value gates on Boolean() at mount; an expression
      // nested anywhere below it never evaluates, so it must stay literal.
      /** 中文说明：变量 expressionPaths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const expressionPaths: string[] = []
      collectExpressionPaths(disabled, `${path}.disabled`, expressionPaths)
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const expressionPath of expressionPaths) problems.push(`${expressionPath}: !!js is not interpolated here`)
    }
  }
  return problems
}

/**
 * Parse-only validation of a `disabled` expression: the Loader evaluates it
 * at every mount decision, and a syntax error would fail the boot — rejecting
 * it here moves that failure to the earliest resolvable point.
 * @param expression - the `!!js` expression text.
 * @returns the diagnostic suffix, or `undefined` when the expression parses.
 */
/* 中文说明：函数 disabledExpressionProblem 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function disabledExpressionProblem(expression: string): string | undefined {
  try {
    // Compilation only — constructing a Script does not execute its source.
    new Script(`(${expression})`)
    return undefined
  } catch (error) {
    /** 中文说明：变量 detail 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const detail = error instanceof Error ? error.message : String(error)
    return `: disabled expression does not parse: ${detail}`
  }
}

/** 中文说明：函数 collectExpressionPaths 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectExpressionPaths(value: unknown, path: string, output: string[]): void {
  if (isJsExpr(value)) {
    output.push(path)
    return
  }
  if (isUnknownArray(value)) {
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (let index = 0; index < value.length; index++) collectExpressionPaths(value[index], `${path}[${index}]`, output)
    return
  }
  if (!isRecord(value)) return
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const [key, child] of Object.entries(value)) collectExpressionPaths(child, `${path}.${key}`, output)
}

/** 中文说明：函数 isRecord 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** 中文说明：函数 isUnknownArray 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}
