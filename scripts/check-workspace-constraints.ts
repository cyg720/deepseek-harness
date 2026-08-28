/**
 * Workspace package invariant checks for package-manager-independent quality
 * gates.
 *
 * Run: `tsx scripts/check-workspace-constraints.ts`.
 */
/*
 * 文件职责：实现 check-workspace-constraints.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hasTypertRemoteNavigation, isForbiddenPublicationFile } from './publication-payload.ts'
import { collectProjectReferenceFaceViolations } from './project-reference-faces.ts'

/** 中文说明：变量 root 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
// vendor/* is single-level; packages/<group>/<pkg> nests one level deeper
// (the group dirs — core/llm/shell/… — are pure containers with no manifest).
/** 中文说明：变量 workspaceGlobs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const workspaceGlobs = [
  { dir: 'vendor', depth: 1 },
  { dir: 'packages', depth: 2 },
  { dir: 'native', depth: 1 },
  { dir: 'native/landlock-run/packages', depth: 1 },
  { dir: 'apps', depth: 1 },
] as const
/** 中文说明：变量 vendoredPackages 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const vendoredPackages = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/cosmokit',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-logger-console',
])
/** 中文说明：变量 publicLandlockPackages 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const publicLandlockPackages = new Set([
  '@deepseek-ai/node-addon-landlock-run',
  '@deepseek-ai/node-addon-landlock-run-linux-arm64',
  '@deepseek-ai/node-addon-landlock-run-linux-x64',
])
/** Deliberate source payloads whose exact bytes are part of the package's audit surface. */
/* 中文说明：变量 publicationSourceAllowlist 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const publicationSourceAllowlist: Readonly<Record<string, readonly string[]>> = {
  '@deepseek-ai/node-addon-landlock-run': ['src/main.c'],
}
/** 中文说明：变量 repositoryUrl 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repositoryUrl = 'git+https://github.com/deepseek-harness/deepseek-harness.git'
/**
 * Source home the published packages point consumers at. It differs from
 * {@link repositoryUrl}, which the Landlock packages keep because npm resolves
 * their trusted publishing against the repository that runs the workflow.
 */
/* 中文说明：变量 publishedRepositoryUrl 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const publishedRepositoryUrl = 'git+https://github.com/deepseek-ai/deepseek-harness.git'
/** Private packages that participate in workspace checks but not releases. */
/* 中文说明：变量 experimentalPackageDirectory 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const experimentalPackageDirectory = /^packages\/experimental\/[^/]+$/
/** npm namespace reserved for private experimental packages. */
/* 中文说明：变量 experimentalPackageNamePrefix 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const experimentalPackageNamePrefix = '@deepseek-ai/dsh-experimental-'
/** Directories whose packages this repository publishes: one release member each. */
/* 中文说明：变量 releaseMemberDirectory 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const releaseMemberDirectory = /^(?:packages\/(?!experimental\/)[^/]+\/[^/]+|apps\/[^/]+|vendor\/[^/]+)$/
const localArtifactDirs = new Set(['node_modules'])
/** 中文说明：变量 appPackageFiles 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const appPackageFiles: Readonly<Record<string, readonly string[]>> = {
  '@deepseek-ai/dsh': ['lib/*.js'],
  // Sourcemaps stay out by payload policy; the worker-preview surface
  // (dist/preview.html and dist/preview/) backs private experimental
  // packages and is not published.
  '@deepseek-ai/dsh-web-frontend': ['dist', '!dist/**/*.map', '!dist/preview.html', '!dist/preview'],
}

/** The subset of package.json fields this constraint check cares about. */
/* 中文说明：interface PackageManifest 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
export interface PackageManifest {
  name?: string
  version?: string
  private?: boolean
  type?: string
  main?: string
  types?: string
  bin?: string | Record<string, string>
  exports?: Record<
    string,
    | string
    | {
      types?: string
      default?: string
    }
    | null
    | undefined
  >
  files?: string[]
  publishConfig?: { access?: string }
  repository?: { type?: string; url?: string; directory?: string }
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dsh?: {
    bundle?: {
      patch?: string
    }
  }
}

/** One workspace manifest and its repo-relative path. */
/* 中文说明：interface WorkspaceManifest 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
export interface WorkspaceManifest {
  dir: string
  manifest: PackageManifest
}

/** 中文说明：函数 readJson 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

/** 中文说明：变量 rootManifest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const rootManifest = readJson(join(root, 'package.json'))
/** 中文说明：变量 repositoryVersion 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repositoryVersion = rootManifest.version
/** 中文说明：变量 landlockWorkspaceManifest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const landlockWorkspaceManifest = readJson(join(root, 'native/landlock-run/package.json'))
/** 中文说明：变量 landlockVersion 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const landlockVersion = landlockWorkspaceManifest.version

/** Repo-relative dirs holding a package.json, walked to the configured depth. */
/* 中文说明：函数 packageDirs 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function packageDirs(base: string, depth: number): string[] {
  if (depth === 1) {
    return readdirSync(join(root, base), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => !localArtifactDirs.has(entry.name))
      .filter(entry => existsSync(join(root, base, entry.name, 'package.json')))
      .map(entry => `${base}/${entry.name}`)
  }
  return readdirSync(join(root, base), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => !localArtifactDirs.has(entry.name))
    .flatMap(group => packageDirs(`${base}/${group.name}`, depth - 1))
}

/** 中文说明：函数 workspaceManifests 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function workspaceManifests(): WorkspaceManifest[] {
  /** 中文说明：变量 manifests 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifests: WorkspaceManifest[] = [
    { dir: '.', manifest: rootManifest },
  ]

  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const { dir: base, depth } of workspaceGlobs) {
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const dir of packageDirs(base, depth)) {
      manifests.push({ dir, manifest: readJson(join(root, dir, 'package.json')) })
    }
  }

  return manifests
}

/** 中文说明：变量 packageFileExtras 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packageFileExtras: Readonly<Record<string, readonly string[]>> = {
  // Statically linked client libraries keep their stylesheets next to the emitted
  // JavaScript, which imports them by relative path: the compile shell runs
  // them through its own CSS pipeline, so the sheets are published artifacts.
  // The glob covers whichever sheets a package emits; sourcemaps stay
  // unpublished, as everywhere else in the repository.
  '@deepseek-ai/dsh-client-ui-primitives': ['lib/**/*.css'],
  '@deepseek-ai/dsh-client-web': ['lib/**/*.css'],
  '@deepseek-ai/dsh-client-ui-theme': ['lib/styles'],
  // The CPython side ships as source .py files, published as-is rather than built.
  '@deepseek-ai/dsh-code-runtime-python': ['py/**/*.py'],
  // The shipped preset compositions travel inside the roster package.
  '@deepseek-ai/dsh-agent-presets': ['presets'],
  // The Web Host mounts the default-off settings owner independently of each
  // Agent-scoped delegation-tool instance.
  '@deepseek-ai/dsh-tool-subagent': ['lib/model-selection-settings.js'],
  // The argv-prefix runner entry ships beside the lib as its own bundle;
  // sandbox-local resolves it through the package's ./runner export. tsdown
  // also shares its generated FFI code through a hashed runtime chunk.
  '@deepseek-ai/dsh-sandbox-windows-acl': ['lib/runner.js', 'lib/types-*.js'],
  // SQLite loads its compression dictionary and every statement from immutable
  // package resources at runtime.
  '@deepseek-ai/dsh-session-persistence-sqlite': [
    'resources/zstd-dictionary.bin',
    'resources/sql/**/*.sql',
  ],
  '@deepseek-ai/dsh-skill-badge': ['assets'],
  // tsdown shares the repository/pack code between the lib entry and the bin
  // through a hashed chunk. The committed bin.js is the link target pnpm can
  // resolve at install time, before the build produces lib/bin.js.
  '@deepseek-ai/dsh-experimental-webworker-packer': ['bin.js', 'lib/repository-*.js'],
  '@deepseek-ai/dsh-subprocess-local': ['scripts/ensure-spawn-helper.mjs'],
}

/** 中文说明：函数 sameStringList 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function sameStringList(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return !!actual && actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

export function expectedDshPackageFiles(manifest: PackageManifest): readonly string[] {
  const declaredPatch = manifest.dsh?.bundle?.patch
  /** 中文说明：变量 bundleFiles 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bundleFiles = declaredPatch === undefined ? [] : [declaredPatch.replace(/^\.\//, '')]
  /** 中文说明：变量 extras 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const extras = [
    ...bundleFiles,
    ...(manifest.name ? packageFileExtras[manifest.name] ?? [] : []),
  ]
  return [
    'lib/index.js',
    // Every package publishes its invariant ownership companion as a separate
    // bundle; the package-invariant gate validates the companion itself.
    'lib/invariant.js',
    ...manifest.bin ? ['lib/bin.js'] : [],
    // Worker-thread packages ship a CJS worker entry; the browser worker
    // bundle is an ES module a page loads with `new Worker(type: 'module')`.
    // Keyed on the artifact path, like ./client below.
    ...exportDefault(manifest, './worker') === './lib/worker.cjs' ? ['lib/worker.cjs'] : [],
    ...exportDefault(manifest, './worker') === './lib/worker.js' ? ['lib/worker.js'] : [],
    // UI plugin packages ship their browser bundle beside the node lib
    // (single-artifact ruling: dist/ retired, ./client resolves lib/client.js).
    // Keyed on the artifact path, not the subpath name: a package's ./client is
    // a browser-safe source channel, not a bundle.
    ...exportDefault(manifest, './client') === './lib/client.js' ? ['lib/client.js'] : [],
    // runtime's shell-held loader subpath ships as its own bundle beside the client half.
    ...exportDefault(manifest, './loader') === './lib/loader.js' ? ['lib/loader.js'] : [],
    // A store subpath ships its own bundle (single-entry builds; no shared chunk).
    ...exportDefault(manifest, './store') === './lib/store/index.js' ? ['lib/store/index.js'] : [],
    // A surface bundle's startup row is its own bundle: the Loader imports it
    // as a row module, so it cannot ride inside the package entry.
    ...exportDefault(manifest, './startup') === './lib/startup.js' ? ['lib/startup.js'] : [],
    ...extras,
    // Subpaths whose runtime default is the tsc-emitted tree (lib/types/*.js —
    // browser-safe source channels rehomed off src so plain Node can import
    // them without type stripping) publish the emitted JS alongside the
    // declarations.
    ...usesEmittedTreeDefaults(manifest) ? ['lib/types/**/*.js'] : [],
    'lib/types/**/*.d.ts',
    ...hasExportPair(manifest, './typert', './lib/typert.host.d.ts', './lib/typert.host.js')
      ? ['lib/typert.host.js', 'lib/typert.host.d.ts']
      : [],
    ...hasExportPair(manifest, './client/typert', './lib/typert.client.d.ts', './lib/typert.client.js')
      ? ['lib/typert.client.js', 'lib/typert.client.d.ts']
      : [],
    ...hasTypertRemoteNavigation(manifest)
      ? ['lib/typert.remote-client.js', 'lib/typert.remote-client.d.ts']
      : [],
  ]
}

/** Whether one conditional export exactly names the generated runtime and declaration pair. */
/* 中文说明：函数 hasExportPair 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function hasExportPair(
  manifest: PackageManifest,
  subpath: string,
  types: string,
  runtime: string,
): boolean {
  /** 中文说明：变量 entry 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entry = manifest.exports?.[subpath]
  return typeof entry === 'object'
    && entry !== null
    && entry.types === types
    && entry.default === runtime
}

/** Runtime target of an export entry: conditional `default`, or the bare-string shorthand. */
/* 中文说明：函数 exportDefault 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function exportDefault(manifest: PackageManifest, subpath: string): string | undefined {
  /** 中文说明：变量 entry 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entry = manifest.exports?.[subpath]
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object' && entry !== null) return entry.default
  return undefined
}

/** Whether any export's runtime default points into the tsc-emitted lib/types tree. */
/* 中文说明：函数 usesEmittedTreeDefaults 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function usesEmittedTreeDefaults(manifest: PackageManifest): boolean {
  return Object.keys(manifest.exports ?? {}).some(subpath =>
    exportDefault(manifest, subpath)?.startsWith('./lib/types/') === true)
}

/** Experimental manifest requirements enforced independently from release metadata. */
/* 中文说明：函数 checkExperimentalManifest 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function checkExperimentalManifest({ dir, manifest }: WorkspaceManifest): string[] {
  if (!experimentalPackageDirectory.test(dir)) return []
  /** 中文说明：变量 label 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const label = manifest.name ?? dir
  /** 中文说明：变量 errors 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const errors: string[] = []
  if (manifest.name?.startsWith(experimentalPackageNamePrefix) !== true) {
    errors.push(`${label}: experimental package name must start with ${JSON.stringify(experimentalPackageNamePrefix)}`)
  }
  if (manifest.private !== true) errors.push(`${label}: experimental package must set "private": true`)
  if (manifest.publishConfig !== undefined) errors.push(`${label}: experimental package must omit publishConfig`)
  return errors
}

/**
 * Check one workspace manifest against publication and dsh-package policy.
 * @param workspace - package directory and parsed manifest.
 * @returns path-qualified policy violations.
 */
export function checkWorkspaceManifest({ dir, manifest }: WorkspaceManifest): string[] {
  const errors = checkExperimentalManifest({ dir, manifest })
  /** 中文说明：变量 label 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const label = manifest.name ?? dir
  /** 中文说明：变量 isLandlockPackageDir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const isLandlockPackageDir = dir.startsWith('native/landlock-run/packages/')
  /** 中文说明：变量 isPublicLandlockPackage 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const isPublicLandlockPackage = isLandlockPackageDir
    && manifest.name !== undefined
    && publicLandlockPackages.has(manifest.name)

  if (isPublicLandlockPackage) {
    if (manifest.private === true) {
      errors.push(`${label}: published Landlock package must not set "private": true`)
    }
    if (manifest.publishConfig?.access !== 'public') {
      errors.push(`${label}: published Landlock package must set publishConfig.access to "public"`)
    }
    /** 中文说明：变量 expectedDirectory 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expectedDirectory = dir
    if (manifest.repository?.type !== 'git'
      || manifest.repository.url !== repositoryUrl
      || manifest.repository.directory !== expectedDirectory) {
      errors.push(`${label}: published Landlock package repository must use ${repositoryUrl} with directory ${expectedDirectory} for trusted publishing`)
    }
  } else if (releaseMemberDirectory.test(dir)) {
    // Release members state that they are publishable: npm refuses a private
    // package, and the repository field is how a consumer finds the source of
    // the package it installed.
    //
    // Access is per release sequence, not per scope: the vendored framework and
    // the Landlock packages publish publicly because outside consumers install
    // them, while the dsh family stays restricted until its own sequence goes
    // public. A mixed scope is why no publish path passes `--access` — one flag
    // cannot serve both, so each packed manifest decides
    // ([rationale](../.agents/notes/implemented/process/2026-08-13-public-vendor-and-native-sequences.md)).
    if (manifest.private === true) {
      errors.push(`${label}: release member must not set "private": true`)
    }
    if (manifest.publishConfig?.access !== 'public') {
      errors.push(`${label}: release member must set publishConfig.access to "public"`)
    }
    if (manifest.repository?.type !== 'git'
      || manifest.repository.url !== publishedRepositoryUrl
      || manifest.repository.directory !== dir) {
      errors.push(`${label}: release member repository must use ${publishedRepositoryUrl} with directory ${dir}`)
    }
  } else if (!experimentalPackageDirectory.test(dir) && manifest.private !== true) {
    errors.push(`${label}: package.json must set "private": true`)
  }

  if (manifest.name && vendoredPackages.has(manifest.name)) {
    return errors
  }

  if (manifest.name?.startsWith('@deepseek-ai/')) {
    /** 中文说明：变量 allowedSources 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const allowedSources = publicationSourceAllowlist[manifest.name] ?? []
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const file of manifest.files ?? []) {
      if (isForbiddenPublicationFile(file) && !allowedSources.includes(file)) {
        errors.push(`${label}: package.json files must not publish ${JSON.stringify(file)}`)
      }
    }
  }

  if (dir.startsWith('apps/') && manifest.name?.startsWith('@deepseek-ai/')) {
    /** 中文说明：变量 expectedFiles 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expectedFiles = appPackageFiles[manifest.name]
    if (expectedFiles === undefined) {
      errors.push(`${label}: app package has no publication files policy`)
    } else if (!sameStringList(manifest.files, expectedFiles)) {
      errors.push(`${label}: package.json files must be ${JSON.stringify(expectedFiles)}`)
    }
  }

  if (isLandlockPackageDir) {
    if (!isPublicLandlockPackage) {
      errors.push(`${label}: unexpected package in the public Landlock package family`)
    }
    if (manifest.version !== landlockVersion) {
      errors.push(`${label}: package.json version must match Landlock workspace version ${landlockVersion ?? '(missing)'}`)
    }
  }

  if (dir.startsWith('packages/') && manifest.name?.startsWith('@deepseek-ai/dsh-')) {
    /** 中文说明：变量 peer 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const peer = manifest.peerDependencies?.['@deepseek-ai/cordis']
    /** 中文说明：变量 dev 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dev = manifest.devDependencies?.['@deepseek-ai/cordis']

    if (!peer) errors.push(`${label}: @deepseek-ai/cordis must be a peerDependency`)
    if (!dev) errors.push(`${label}: @deepseek-ai/cordis must also be a devDependency`)
    if (peer && dev && peer !== dev) {
      errors.push(`${label}: @deepseek-ai/cordis peer (${peer}) and dev (${dev}) ranges must match`)
    }
    if (manifest.version !== repositoryVersion) {
      errors.push(`${label}: package.json version must match root version ${repositoryVersion ?? '(missing)'}`)
    }
    if (manifest.type !== 'module') {
      errors.push(`${label}: package.json must set "type": "module"`)
    }
    if (manifest.main !== 'lib/index.js') {
      errors.push(`${label}: package.json must set "main": "lib/index.js"`)
    }
    if (manifest.types !== 'lib/types/index.d.ts') {
      errors.push(`${label}: package.json must set "types": "lib/types/index.d.ts"`)
    }
    /** 中文说明：变量 rootExport 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rootExport = manifest.exports?.['.']
    /** 中文说明：变量 rootEntry 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rootEntry = typeof rootExport === 'object' && rootExport !== null ? rootExport : undefined
    if (rootEntry?.types !== './lib/types/index.d.ts') {
      errors.push(`${label}: package.json exports["."].types must be "./lib/types/index.d.ts"`)
    }
    if (rootEntry?.default !== './lib/index.js') {
      errors.push(`${label}: package.json exports["."].default must be "./lib/index.js"`)
    }
    /** 中文说明：变量 invariantRaw 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invariantRaw = manifest.exports?.['./invariant']
    /** 中文说明：变量 invariantExport 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invariantExport = typeof invariantRaw === 'object' && invariantRaw !== null ? invariantRaw : undefined
    if (invariantExport?.types !== undefined && invariantExport.types !== './lib/types/invariant.d.ts') {
      errors.push(`${label}: package.json exports["./invariant"].types must be "./lib/types/invariant.d.ts"`)
    }
    if (invariantExport?.default !== undefined && invariantExport.default !== './lib/invariant.js') {
      errors.push(`${label}: package.json exports["./invariant"].default must be "./lib/invariant.js"`)
    }
    if (invariantExport && (invariantExport.types === undefined || invariantExport.default === undefined)) {
      errors.push(`${label}: package.json exports["./invariant"] must declare both types and default targets`)
    }
    /** 中文说明：变量 expectedFiles 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expectedFiles = expectedDshPackageFiles(manifest)
    if (!sameStringList(manifest.files, expectedFiles)) {
      errors.push(`${label}: package.json files must be ${JSON.stringify(expectedFiles)}`)
    }
  }

  return errors.map(error => `${relative(root, join(root, dir, 'package.json'))}: ${error}`)
}

/**
 * Enforce `packages/<group>/<pkg>`: groups are open-named containers without a
 * package.json, and packages may be neither flat nor more deeply nested.
 */
/* 中文说明：函数 checkHierarchyShape 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function checkHierarchyShape(): string[] {
  /** 中文说明：变量 errors 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const errors: string[] = []
  /** 中文说明：变量 packagesRoot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const packagesRoot = join(root, 'packages')
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const group of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    /** 中文说明：变量 groupRel 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const groupRel = join('packages', group.name)
    if (existsSync(join(packagesRoot, group.name, 'package.json'))) {
      errors.push(`${groupRel}: a group dir must not contain a package.json — packages live at packages/<group>/<pkg>, not directly under packages/`)
      continue
    }
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const pkg of readdirSync(join(packagesRoot, group.name), { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      if (localArtifactDirs.has(pkg.name)) continue
      /** 中文说明：变量 pkgRel 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const pkgRel = join(groupRel, pkg.name)
      if (!existsSync(join(packagesRoot, group.name, pkg.name, 'package.json'))) {
        errors.push(`${pkgRel}: expected a package here (no package.json found) — the hierarchy is exactly packages/<group>/<pkg>, no deeper nesting`)
      }
    }
  }
  return errors
}

/** 中文说明：函数 checkRepositoryVersion 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function checkRepositoryVersion(): string[] {
  // The root carries the dsh release family's version, so a prerelease such as
  // 0.0.1-rc.1 is a valid state between `release:dsh` and its publication.
  if (repositoryVersion && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(repositoryVersion)) return []
  return ['package.json: version must be X.Y.Z with an optional prerelease segment']
}

/** Dependency sections whose ranges reach a published tarball or a local install. */
/* 中文说明：变量 dependencySections 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
/** Dependency sections present in an installed runtime. */
/* 中文说明：变量 runtimeDependencySections 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const runtimeDependencySections = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const

/**
 * Prevent an official runtime from requiring a package its release omits.
 * @param manifests - release, private experimental, and deployment-root manifests.
 * @returns One error for each forbidden runtime dependency.
 */
/* 中文说明：函数 checkExperimentalDependencyIsolation 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function checkExperimentalDependencyIsolation(manifests: readonly WorkspaceManifest[]): string[] {
  /** 中文说明：变量 experimentalNames 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const experimentalNames = new Set(manifests
    .filter(entry => experimentalPackageDirectory.test(entry.dir))
    .map(entry => entry.manifest.name)
    .filter(name => name !== undefined))
  /** 中文说明：变量 errors 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const errors: string[] = []
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const { dir, manifest } of manifests) {
    if (!releaseMemberDirectory.test(dir) && dir !== 'python/sdk-runtime') continue
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const section of runtimeDependencySections) {
      /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
      for (const name of Object.keys(manifest[section] ?? {})) {
        if (!experimentalNames.has(name)) continue
        errors.push(`${manifest.name ?? dir}: ${section}.${name} must not reference an experimental package`)
      }
    }
  }
  return errors
}

/**
 * Require the `workspace:` protocol for every reference to a workspace member.
 *
 * A hand-written range says nothing about the version the workspace actually
 * carries, and `pnpm pack` leaves it alone: `^0.0.1` published from version
 * `0.0.2` names a version that does not exist. The protocol makes pack
 * substitute the member's real version, so no release step rewrites ranges.
 * @param manifests - every workspace manifest.
 * @returns One error per reference that names a workspace member without the protocol.
 */
/* 中文说明：函数 checkWorkspaceProtocol 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function checkWorkspaceProtocol(manifests: readonly WorkspaceManifest[]): string[] {
  /** 中文说明：函数值 members 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const members = new Set(manifests.map(entry => entry.manifest.name).filter(name => name !== undefined))
  /** 中文说明：变量 errors 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const errors: string[] = []
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const { dir, manifest } of manifests) {
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const section of dependencySections) {
      /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (!members.has(name) || range.startsWith('workspace:')) continue
        errors.push(`${manifest.name ?? dir}: ${section}.${name} must use the workspace: protocol, got ${range}`)
      }
    }
  }
  return errors
}

/** Run the repository constraint gate. */
/* 中文说明：函数 main 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function main(): void {
  /** 中文说明：变量 manifests 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifests = workspaceManifests()
  /** 中文说明：变量 dependencyManifests 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dependencyManifests = [
    ...manifests,
    { dir: 'python/sdk-runtime', manifest: readJson(join(root, 'python/sdk-runtime/package.json')) },
  ]
  /** 中文说明：变量 errors 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const errors = [
    ...checkRepositoryVersion(),
    ...manifests.flatMap(checkWorkspaceManifest),
    ...checkWorkspaceProtocol(manifests),
    ...checkExperimentalDependencyIsolation(dependencyManifests),
    ...checkHierarchyShape(),
    ...collectProjectReferenceFaceViolations(root),
  ]
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
