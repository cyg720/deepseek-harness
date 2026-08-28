/**
 * Generate `THIRD_PARTY_NOTICES.md` from the workspace manifests: every
 * external dependency named by a workspace `package.json`, the vendored-package
 * manifest in `vendor/README.md`, the Python `pyproject.toml` files, and the
 * pnpm patch list. License and repository metadata come from the installed
 * store, so the tree must be installed. `--check` verifies the committed
 * artifact. Tier policy and ownership live in
 * `.agents/notes/implemented/process/2026-07-30-generated-third-party-notices.md`.
 */
/*
 * 文件职责：实现 gen-third-party-notices.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { existsSync, globSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { parse as parseToml, type TomlTableWithoutBigInt, type TomlValueWithoutBigInt } from 'smol-toml'
import parseSpdx from 'spdx-expression-parse'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：常量 OUT 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OUT = 'THIRD_PARTY_NOTICES.md'

/** Dependency-declaration kinds a consumer resolves at runtime. */
/* 中文说明：常量 RUNTIME_KINDS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const RUNTIME_KINDS = ['dependencies', 'optionalDependencies'] as const
/** All manifest sections that name an external package this file must disclose. */
/* 中文说明：常量 ALL_KINDS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ALL_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

/**
 * Workspace areas that never reach a user: repository tooling and gates (the
 * root manifest), test infrastructure, the documentation site, and the native
 * launcher's build workspace. A runtime
 * declaration by anything outside these areas is a disclosure-relevant
 * runtime dependency because any plugin package can be mounted from a user's
 * `cordis.yml`.
 */
/* 中文说明：常量 DEV_ONLY_AREAS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEV_ONLY_AREAS = [
  'package.json',
  'packages/test-support/',
  'packages/test-support/client-runtime/',
  'website/',
  'native/',
] as const

/** First-party public native packages: reachable at runtime but not third-party. */
/* 中文说明：常量 FIRST_PARTY 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FIRST_PARTY = new Set([
  '@deepseek-ai/node-addon-landlock-run',
  '@deepseek-ai/node-addon-landlock-run-linux-arm64',
  '@deepseek-ai/node-addon-landlock-run-linux-x64',
])

/** Official SDK identity covered by the project's narrow owner authorization. */
/* 中文说明：常量 CLAUDE_AGENT_SDK_PACKAGE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const CLAUDE_AGENT_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'
/** 中文说明：常量 CLAUDE_PLATFORM_PACKAGE_PREFIX 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLAUDE_PLATFORM_PACKAGE_PREFIX = `${CLAUDE_AGENT_SDK_PACKAGE}-`
/** 中文说明：常量 CLAUDE_PLATFORM_DECLARED_LICENSE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLAUDE_PLATFORM_DECLARED_LICENSE = 'SEE LICENSE IN LICENSE.md'

/**
 * Whether a non-permissive runtime declaration has an identity-scoped owner
 * authorization. This does not reclassify its terms as permissive.
 * @param name - exact npm package identity.
 * @returns true only for the official Claude Agent SDK package.
 */
/* 中文说明：函数 isOwnerAuthorizedRuntime 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function isOwnerAuthorizedRuntime(name: string): boolean {
  return name === CLAUDE_AGENT_SDK_PACKAGE
}

/**
 * Metadata overrides where the installed manifest is wrong or unreachable.
 * Each entry documents why the store cannot answer.
 */
/* 中文说明：常量 OVERRIDES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OVERRIDES: Record<string, { license?: string; repo?: string }> = {
  // Rust workspaces publishing npm bins without `license` in package.json.
  'oxlint': { license: 'MIT', repo: 'https://github.com/oxc-project/oxc' },
  'oxlint-tsgolint': { license: 'MIT', repo: 'https://github.com/oxc-project/tsgolint' },
  // `license: SEE LICENSE IN LICENSE`: the servers repo is mid MIT→Apache-2.0
  // relicensing, so the effective terms are per-contribution.
  '@modelcontextprotocol/server-everything': { license: 'MIT / Apache-2.0', repo: 'https://github.com/modelcontextprotocol/servers' },
  '@modelcontextprotocol/server-filesystem': { license: 'MIT / Apache-2.0', repo: 'https://github.com/modelcontextprotocol/servers' },
  // No repository field in the published manifest.
  'node-addon-require-builtin': { repo: 'https://www.npmjs.com/package/node-addon-require-builtin' },
}

/**
 * Python dependencies are few and named directly in `pyproject.toml` files
 * without installed metadata to harvest, so license/repo are recorded here and
 * the generator fails when a manifest names a package this map misses.
 */
/* 中文说明：常量 PYTHON_METADATA 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PYTHON_METADATA: Record<string, { license: string; repo: string; role: string }> = {
  pydantic: { license: 'MIT', repo: 'https://github.com/pydantic/pydantic', role: 'runtime dependency of `deepseek-harness-sdk`' },
  hatchling: { license: 'MIT', repo: 'https://github.com/pypa/hatch', role: 'build backend' },
  pytest: { license: 'MIT', repo: 'https://github.com/pytest-dev/pytest', role: 'test-only' },
}

/** 中文说明：type PythonMetadata 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type PythonMetadata = typeof PYTHON_METADATA

/** Tools fetched by scripts at build time, keyed by the pin the script owns. */
/* 中文说明：常量 BUILD_TIME_TOOLS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const BUILD_TIME_TOOLS = [
  {
    name: '@yao-pkg/pkg',
    license: 'MIT',
    repo: 'https://github.com/yao-pkg/pkg',
    role: 'invoked by `scripts/build-exe-for-python-sdk.ts` to assemble the single-file SDK runtime executable',
    pinSource: 'scripts/build-exe-for-python-sdk.ts',
  },
]

/** The `package.json` fields this generator reads. */
/* 中文说明：interface Manifest 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface Manifest {
  name?: string
  version?: string
  private?: boolean
  license?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/** One disclosed external npm dependency. */
/* 中文说明：interface ExternalDep 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface ExternalDep {
  name: string
  license: string
  repo: string
  /** True when some shipped workspace consumer reaches it through runtime dependency edges. */
  runtime: boolean
}

/** Read and parse a workspace-relative `package.json`. */
/* 中文说明：函数 readManifest 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readManifest(rel: string): Manifest {
  return JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as Manifest
}

/**
 * Manifest globs, derived from the workspace declarations rather than listed
 * here, so a new member area (`tools/*`) is read the day it is declared.
 * @returns one glob per manifest-bearing location, repository-relative.
 */
/** 中文说明：函数 manifestPatterns 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function manifestPatterns(rootMembers: readonly string[]): string[] {
  return [
    'package.json',
    ...rootMembers.map(member => `${member}/package.json`),
  ]
}

/** The `packages:` member globs declared by one pnpm workspace file. */
/* 中文说明：函数 workspaceMembers 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function workspaceMembers(rel: string): string[] {
  /** 中文说明：变量 declared 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const declared = (yaml.load(readFileSync(resolve(root, rel), 'utf8')) as { packages?: unknown }).packages
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(`gen-third-party-notices: ${rel} declares no workspace members; the manifest set cannot be derived.`)
  }
  return declared.map(member => String(member))
}

/**
 * Every workspace manifest, keyed by repository-relative path, plus the set of
 * workspace package names. Paths are normalized to `/` at ingestion: Node's
 * `fs.globSync` returns OS-native separators, and the area matching in
 * `tierExternalDeps` compares `/`-suffixed prefixes, so Windows backslashes
 * would silently push dev-area manifests into the runtime tier.
 */
/* 中文说明：函数 loadWorkspaceManifests 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function loadWorkspaceManifests(): { manifests: Map<string, Manifest>; names: Set<string> } {
  /** 中文说明：变量 patterns 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const patterns = manifestPatterns(workspaceMembers('pnpm-workspace.yaml'))
  /** 中文说明：变量 manifests 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifests = new Map<string, Manifest>()
  /** 中文说明：变量 names 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const names = new Set<string>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const pattern of patterns) {
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const path of globSync(pattern, { cwd: root })) {
      /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const normalized = path.replaceAll('\\', '/')
      /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const manifest = readManifest(normalized)
      manifests.set(normalized, manifest)
      if (manifest.name !== undefined) names.add(manifest.name)
    }
  }
  if (manifests.size < 100) throw new Error(`gen-third-party-notices: only ${manifests.size} workspace manifests found; the glob set is stale.`)
  return { manifests, names }
}

/** 中文说明：type VirtualManifest 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type VirtualManifest = Manifest & {
  claudeCodeVersion?: string
  license?: string
  repository?: string | { url?: string }
  homepage?: string
}

/** One platform payload declared by the official Claude Agent SDK. */
/* 中文说明：interface ClaudePlatformPayload 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface ClaudePlatformPayload {
  readonly name: string
  readonly version: string
}

/** Current SDK and CLI distribution facts derived from the installed SDK manifest. */
/* 中文说明：interface ClaudeDistribution 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface ClaudeDistribution {
  readonly sdkVersion: string
  readonly claudeCodeVersion: string
  readonly payloads: ClaudePlatformPayload[]
}

/** 中文说明：函数 requiredManifestString 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function requiredManifestString(
  value: string | undefined,
  field: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`gen-third-party-notices: ${CLAUDE_AGENT_SDK_PACKAGE} has no ${field}.`)
  }
  return value
}

/**
 * Derive the official platform payload set without a version or platform
 * allowlist. Only identities in the SDK's own package namespace are covered.
 * @param manifest - installed official SDK manifest.
 * @returns current SDK, CLI, and optional platform payload facts.
 */
/* 中文说明：函数 claudeDistributionFromManifest 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function claudeDistributionFromManifest(
  manifest: VirtualManifest,
): ClaudeDistribution {
  if (manifest.name !== CLAUDE_AGENT_SDK_PACKAGE) {
    throw new Error(
      `gen-third-party-notices: expected ${CLAUDE_AGENT_SDK_PACKAGE} manifest, got ${JSON.stringify(manifest.name)}.`,
    )
  }
  /** 中文说明：变量 sdkVersion 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sdkVersion = requiredManifestString(manifest.version, 'version')
  /** 中文说明：变量 claudeCodeVersion 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const claudeCodeVersion = requiredManifestString(
    manifest.claudeCodeVersion,
    'claudeCodeVersion',
  )
  /** 中文说明：变量 entries 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries = Object.entries(manifest.optionalDependencies ?? {})
  if (entries.length === 0) {
    throw new Error(
      `gen-third-party-notices: ${CLAUDE_AGENT_SDK_PACKAGE} declares no optional platform payloads.`,
    )
  }
  /** 中文说明：函数值 payloads 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const payloads = entries.map(([name, version]) => {
    if (!name.startsWith(CLAUDE_PLATFORM_PACKAGE_PREFIX)) {
      throw new Error(
        `gen-third-party-notices: ${CLAUDE_AGENT_SDK_PACKAGE} optional dependency ${name} is outside its authorized platform-payload identity.`,
      )
    }
    return {
      name,
      version: requiredManifestString(version, `${name} optional dependency version`),
    }
  }).sort((left, right) => left.name.localeCompare(right.name))
  return { sdkVersion, claudeCodeVersion, payloads }
}

/**
 * Resolve one package's manifest inside a pnpm virtual store. The prefix scan
 * matches ordinary `@scope+name@version` directory names; pnpm 11 truncates
 * long names (a peer-suffixed name past the length limit becomes
 * `<prefix>_<hash>`), so a content scan falls back over the whole store when
 * the prefix misses.
 *
 * @param virtual - the `.pnpm` virtual store directory to scan.
 * @param name - the external package name, exactly as `node_modules` spells it.
 * @param expectedVersion - exact version required when the store retains more than one.
 * @returns the parsed manifest, or `undefined` when neither the prefix match
 *   nor the content scan finds the requested package version.
 */
export function virtualManifest(
  virtual: string,
  name: string,
  expectedVersion?: string,
): VirtualManifest | undefined {
  const prefix = `${name.replace('/', '+')}@`
  const entries = readdirSync(virtual)
  for (const entry of entries.filter(dir => dir.startsWith(prefix))) {
    const manifest = JSON.parse(readFileSync(resolve(virtual, entry, 'node_modules', name, 'package.json'), 'utf8')) as VirtualManifest
    if (expectedVersion === undefined || manifest.version === expectedVersion) return manifest
  }
  for (const dir of entries) {
    const candidate = resolve(virtual, dir, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as VirtualManifest
      if (expectedVersion === undefined || manifest.version === expectedVersion) return manifest
    }
  }
  return undefined
}

const workspaceLinkedManifestCache = new Map<string, VirtualManifest | undefined>()

/**
 * Resolve the package version selected for a declaring workspace instead of an
 * unrelated historical version that still occupies the shared virtual store.
 * @param name - external package identity.
 * @returns the first current workspace link for that package, when installed.
 */
function workspaceLinkedManifest(name: string): VirtualManifest | undefined {
  if (workspaceLinkedManifestCache.has(name)) return workspaceLinkedManifestCache.get(name)
  for (const [path, manifest] of loadWorkspaceManifests().manifests) {
    if (!ALL_KINDS.some(kind => name in (manifest[kind] ?? {}))) continue
    const linked = resolve(root, dirname(path), 'node_modules', name, 'package.json')
    if (!existsSync(linked)) continue
    const found = JSON.parse(readFileSync(linked, 'utf8')) as VirtualManifest
    workspaceLinkedManifestCache.set(name, found)
    return found
  }
  workspaceLinkedManifestCache.set(name, undefined)
  return undefined
}

/** Resolve one installed external package manifest from either pnpm store. */
function installedManifest(name: string, expectedVersion?: string): VirtualManifest | undefined {
  const linked = workspaceLinkedManifest(name)
  if (linked !== undefined && (expectedVersion === undefined || linked.version === expectedVersion)) return linked
  let manifest: (Manifest & { license?: string; repository?: string | { url?: string }; homepage?: string }) | undefined
  // Workspace-local link farms can expose a dependency that is not linked at
  // the repository root; both are backed by the root workspace's lockfile.
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const store of ['node_modules', 'native/landlock-run/node_modules']) {
    /** 中文说明：变量 direct 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const direct = resolve(root, store, name, 'package.json')
    if (existsSync(direct)) {
      const candidate = JSON.parse(readFileSync(direct, 'utf8')) as typeof manifest
      if (expectedVersion === undefined || candidate?.version === expectedVersion) {
        manifest = candidate
        break
      }
    }
    /** 中文说明：变量 virtual 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const virtual = resolve(root, store, '.pnpm')
    if (!existsSync(virtual)) continue
    manifest = virtualManifest(virtual, name, expectedVersion)
    if (manifest !== undefined) break
  }
  return manifest
}

/** License and repository URL for an installed external package, from the pnpm store. */
/* 中文说明：函数 installedMetadata 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function installedMetadata(name: string): { license: string; repo: string } {
  /** 中文说明：变量 override 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const override = OVERRIDES[name]
  /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifest = installedManifest(name)
  /** 中文说明：变量 license 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const license = override?.license ?? manifest?.license
  /** 中文说明：变量 rawRepo 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rawRepo = typeof manifest?.repository === 'string' ? manifest.repository : manifest?.repository?.url ?? manifest?.homepage
  /** 中文说明：变量 repo 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const repo = override?.repo ?? normalizeRepo(rawRepo)
  if (license === undefined || repo === undefined) {
    throw new Error(`gen-third-party-notices: cannot resolve ${license === undefined ? 'license' : 'repository'} for ${name}; run \`pnpm install\`, or add an OVERRIDES entry.`)
  }
  return { license, repo }
}

/** 中文说明：函数 collectClaudeDistribution 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectClaudeDistribution(): ClaudeDistribution {
  /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifest = installedManifest(CLAUDE_AGENT_SDK_PACKAGE)
  if (manifest === undefined) {
    throw new Error(
      `gen-third-party-notices: cannot resolve ${CLAUDE_AGENT_SDK_PACKAGE}; run \`pnpm install\`.`,
    )
  }
  /** 中文说明：变量 distribution 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const distribution = claudeDistributionFromManifest(manifest)
  /** 中文说明：变量 installedPayloads 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let installedPayloads = 0
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const payload of distribution.payloads) {
    const installed = installedManifest(payload.name, payload.version)
    if (installed === undefined) continue
    installedPayloads += 1
    if (
      installed.name !== payload.name
      || installed.version !== payload.version
      || installed.license !== CLAUDE_PLATFORM_DECLARED_LICENSE
    ) {
      throw new Error(
        `gen-third-party-notices: installed ${payload.name} does not match its SDK-declared version and ${CLAUDE_PLATFORM_DECLARED_LICENSE} license field.`,
      )
    }
  }
  if (installedPayloads === 0) {
    throw new Error(
      'gen-third-party-notices: no SDK-declared Claude platform payload is installed; install optional dependencies before regenerating.',
    )
  }
  return distribution
}

/** Normalize a manifest repository/homepage value to a browsable https URL. */
/* 中文说明：函数 normalizeRepo 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function normalizeRepo(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined
  /** 中文说明：变量 url 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let url = raw
    .replace(/^git\+ssh:\/\/git@/, 'https://')
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/')
    .replace(/\.git$/, '')
  if (!url.startsWith('http')) url = `https://github.com/${url}`
  return url
}

/**
 * External npm dependencies, tiered by which workspace area declares them at
 * runtime: a package is runtime when any manifest outside `DEV_ONLY_AREAS`
 * names it in `dependencies`/`optionalDependencies`. A package declared only
 * by tooling, test infrastructure, the website, or the demo leaves — whatever
 * the declaring section is called — is development-only.
 */
/* 中文说明：函数 collectNpmDeps 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectNpmDeps(): ExternalDep[] {
  const { manifests, names } = loadWorkspaceManifests()
  return [...tierExternalDeps(manifests, names)]
    .filter(([name]) => !FIRST_PARTY.has(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, runtime]) => ({ name, ...installedMetadata(name), runtime }))
}

/**
 * Tier every external dependency the workspace declares.
 * @param manifests - workspace manifests keyed by repository-relative path.
 * @param names - every workspace package name, which never counts as external.
 * @returns each external package mapped to whether it is a runtime dependency.
 */
/* 中文说明：函数 tierExternalDeps 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function tierExternalDeps(manifests: Map<string, Manifest>, names: Set<string>): Map<string, boolean> {
  /** 中文说明：变量 tiers 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tiers = new Map<string, boolean>()
  // `tsx` is runtime by fiat: the root source-run scripts execute through its ESM hook.
  tiers.set('tsx', true)
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const [path, manifest] of manifests) {
    /** 中文说明：函数值 devOnly 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const devOnly = DEV_ONLY_AREAS.some(area => (area.endsWith('/') ? path.startsWith(area) : path === area))
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const kind of ALL_KINDS) {
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const [dep, range] of Object.entries(manifest[kind] ?? {})) {
        if (names.has(dep) || range.startsWith('workspace:')) continue
        /** 中文说明：变量 runtime 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const runtime = !devOnly && (RUNTIME_KINDS as readonly string[]).includes(kind)
        tiers.set(dep, (tiers.get(dep) ?? false) || runtime)
      }
    }
  }
  return tiers
}

/** A vendored package row parsed out of the `vendor/README.md` manifest table. */
/* 中文说明：interface VendoredRow 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface VendoredRow {
  npmName: string
  /** The name this package carries upstream; MIT attribution names the fork's origin, not our scope. */
  upstreamName: string
  upstream: string
}

/**
 * Parse the vendored-package manifest table out of `vendor/README.md`.
 * @param text - the complete `vendor/README.md` contents.
 * @returns one row per manifest-table entry, in table order.
 */
/* 中文说明：函数 parseVendoredRows 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function parseVendoredRows(text: string): VendoredRow[] {
  /** 中文说明：变量 rows 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rows: VendoredRow[] = []
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const line of text.split('\n')) {
    /** 中文说明：变量 match 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const match = new RegExp(String.raw`^\| \x60\S+\/\x60 \| \x60([^\x60]+)\x60 \| \x60([^\x60]+)\x60 \| \S+ \| `
      + String.raw`(https:\/\/\S+?)(?: \([^)]*\))? \| \x60[0-9a-f]+\x60 \|$`).exec(line)
    if (match === null) continue
    const [, npmName, upstreamName, upstream] = match
    if (npmName === undefined || upstreamName === undefined || upstream === undefined) continue
    rows.push({ npmName, upstreamName, upstream })
  }
  return rows
}

/**
 * Parse the vendored manifest table and confirm it accounts for every vendored
 * directory. The `vendor/` tree — not the table — is the set that must be
 * disclosed, so a row that stops matching the table format is a hard error
 * rather than a package that quietly vanishes from the notices.
 */
/* 中文说明：函数 collectVendored 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectVendored(): VendoredRow[] {
  /** 中文说明：变量 rows 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rows = parseVendoredRows(readFileSync(resolve(root, 'vendor/README.md'), 'utf8'))
  /** 中文说明：变量 onDisk 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const onDisk = new Map<string, string>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const entry of readdirSync(resolve(root, 'vendor'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = readManifest(`vendor/${entry.name}/package.json`)
    if (manifest.name !== undefined) onDisk.set(manifest.name, entry.name)
  }

  /** 中文说明：函数值 parsed 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const parsed = new Set(rows.map(row => row.npmName))
  /** 中文说明：函数值 missing 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const missing = [...onDisk.keys()].filter(name => !parsed.has(name))
  if (missing.length > 0) {
    throw new Error(`gen-third-party-notices: vendor/README.md has no manifest-table row for ${missing.join(', ')}; its table format changed or the sync is incomplete.`)
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const row of rows) {
    /** 中文说明：变量 dir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = onDisk.get(row.npmName)
    if (dir === undefined) throw new Error(`gen-third-party-notices: vendored package ${row.npmName} from vendor/README.md has no vendor/ directory.`)
    /** 中文说明：变量 license 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const license = readManifest(`vendor/${dir}/package.json`).license
    if (license !== 'MIT') {
      throw new Error(`gen-third-party-notices: vendored ${row.npmName} declares license ${JSON.stringify(license)}; the vendored section assumes MIT throughout.`)
    }
  }
  return rows
}

/** Whether a parsed TOML value is a table rather than an array or scalar. */
/* 中文说明：函数 isTomlTable 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isTomlTable(value: TomlValueWithoutBigInt | undefined): value is TomlTableWithoutBigInt {
  return value !== undefined && typeof value === 'object' && !Array.isArray(value)
}

/** Parse one PEP 508 requirement string into its distribution name. */
/* 中文说明：函数 parsePythonRequirement 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parsePythonRequirement(requirement: string): string {
  /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const name = /^\s*([a-zA-Z][a-zA-Z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:[<>=!~;@].*)?$/.exec(requirement)?.[1]
  if (name === undefined) {
    throw new Error(`gen-third-party-notices: cannot read a distribution name from the requirement ${JSON.stringify(requirement)}.`)
  }
  return name
}

/** Add the string requirements from one parsed TOML array. */
/* 中文说明：函数 collectPythonRequirementArray 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectPythonRequirementArray(
  names: string[],
  value: TomlValueWithoutBigInt | undefined,
  location: string,
  allowGroupIncludes = false,
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw new Error(`gen-third-party-notices: ${location} must be an array.`)
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const item of value) {
    if (typeof item === 'string') {
      names.push(parsePythonRequirement(item))
      continue
    }
    if (allowGroupIncludes && isTomlTable(item) && typeof item['include-group'] === 'string' && Object.keys(item).length === 1) {
      continue
    }
    throw new Error(`gen-third-party-notices: ${location} contains an unsupported requirement entry.`)
  }
}

/** Read an optional TOML table and reject a present non-table value. */
/* 中文说明：函数 optionalTomlTable 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function optionalTomlTable(value: TomlValueWithoutBigInt | undefined, location: string): TomlTableWithoutBigInt | undefined {
  if (value === undefined || isTomlTable(value)) return value
  throw new Error(`gen-third-party-notices: ${location} must be a table.`)
}

/**
 * Parse a `pyproject.toml` project identity and every requirement it declares:
 * `requires` under
 * `[build-system]`, `dependencies` under `[project]`, and every key under
 * `[project.optional-dependencies]` and `[dependency-groups]`. A TOML parser
 * owns comments, quoted keys, escapes, and array boundaries; unsupported
 * requirement forms fail instead of disappearing from the notices.
 * @param text - the complete `pyproject.toml` contents.
 * @returns the local project name and declared requirement names.
 */
/* 中文说明：函数 parsePyproject 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parsePyproject(text: string): { projectName?: string; requirements: string[] } {
  /** 中文说明：变量 names 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const names: string[] = []
  /** 中文说明：变量 document 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const document = parseToml(text, { integersAsBigInt: false })
  /** 中文说明：变量 buildSystem 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const buildSystem = optionalTomlTable(document['build-system'], '[build-system]')
  /** 中文说明：变量 project 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const project = optionalTomlTable(document.project, '[project]')
  /** 中文说明：变量 projectName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const projectName = project?.name
  if (projectName !== undefined && typeof projectName !== 'string') {
    throw new Error('gen-third-party-notices: [project].name must be a string.')
  }
  collectPythonRequirementArray(names, buildSystem?.requires, '[build-system].requires')
  collectPythonRequirementArray(names, project?.dependencies, '[project].dependencies')

  /** 中文说明：变量 optional 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const optional = optionalTomlTable(project?.['optional-dependencies'], '[project.optional-dependencies]')
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const [group, requirements] of Object.entries(optional ?? {})) {
    collectPythonRequirementArray(names, requirements, `[project.optional-dependencies].${group}`)
  }

  /** 中文说明：变量 groups 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const groups = optionalTomlTable(document['dependency-groups'], '[dependency-groups]')
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const [group, requirements] of Object.entries(groups ?? {})) {
    collectPythonRequirementArray(names, requirements, `[dependency-groups].${group}`, true)
  }
  return projectName === undefined
    ? { requirements: names }
    : { projectName, requirements: names }
}

/**
 * Read every requirement name declared by one `pyproject.toml`.
 * @param text - the complete `pyproject.toml` contents.
 * @returns each declared requirement's distribution name, in file order.
 */
/* 中文说明：函数 parsePyprojectRequirements 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function parsePyprojectRequirements(text: string): string[] {
  return parsePyproject(text).requirements
}

/** Normalize a Python distribution name according to the packaging name rule. */
/* 中文说明：函数 normalizePythonDistributionName 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function normalizePythonDistributionName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

/**
 * Resolve external Python dependencies after excluding local project names.
 * @param pyprojects - complete local `pyproject.toml` contents.
 * @param metadata - disclosure metadata for every external dependency.
 * @returns disclosed dependencies in normalized name order.
 */
/* 中文说明：函数 collectPythonDependencies 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectPythonDependencies(
  pyprojects: string[],
  metadata: PythonMetadata = PYTHON_METADATA,
): { name: string; license: string; repo: string; role: string }[] {
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = pyprojects.map(parsePyproject)
  /** 中文说明：函数值 firstParty 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const firstParty = new Set(parsed.flatMap(({ projectName }) => (
    projectName === undefined ? [] : [normalizePythonDistributionName(projectName)]
  )))
  /** 中文说明：变量 found 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const found = new Set(parsed
    .flatMap(({ requirements }) => requirements.map(normalizePythonDistributionName))
    .filter(name => !firstParty.has(name)))
  return [...found].sort((a, b) => a.localeCompare(b)).map((name) => {
    /** 中文说明：变量 entry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry = metadata[name]
    if (entry === undefined) throw new Error(`gen-third-party-notices: python dependency ${name} is missing from PYTHON_METADATA.`)
    return { name, ...entry }
  })
}

/** Direct Python dependencies named by the `pyproject.toml` manifests under `python/`. */
/* 中文说明：函数 collectPython 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectPython(): { name: string; license: string; repo: string; role: string }[] {
  /** 中文说明：变量 manifests 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifests = globSync('python/*/pyproject.toml', { cwd: root })
  if (manifests.length === 0) throw new Error('gen-third-party-notices: no python/*/pyproject.toml found; the Python tree moved.')
  return collectPythonDependencies(manifests.map(path => readFileSync(resolve(root, path), 'utf8')))
}

/** pnpm-patched external packages, from `pnpm-workspace.yaml`. */
/* 中文说明：函数 collectPatched 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function collectPatched(): { spec: string; patch: string }[] {
  /** 中文说明：变量 workspace 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const workspace = yaml.load(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')) as { patchedDependencies?: Record<string, string> }
  return Object.entries(workspace.patchedDependencies ?? {}).map(([spec, patch]) => ({ spec, patch }))
}

/** Verify each build-time tool pin still appears in its owning script. */
/* 中文说明：函数 verifyBuildTimePins 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function verifyBuildTimePins(): void {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const tool of BUILD_TIME_TOOLS) {
    /** 中文说明：变量 text 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = readFileSync(resolve(root, tool.pinSource), 'utf8')
    if (!text.includes(tool.name)) {
      throw new Error(`gen-third-party-notices: ${tool.pinSource} no longer references ${tool.name}; update BUILD_TIME_TOOLS.`)
    }
  }
}

/** SPDX identifiers this project may ship without further review. */
/* 中文说明：常量 PERMISSIVE_LICENSES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PERMISSIVE_LICENSES = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0'])

/** Evaluate a parsed SPDX expression under the repository's license policy. */
/* 中文说明：函数 isPermissiveSpdx 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isPermissiveSpdx(expression: ReturnType<typeof parseSpdx>): boolean {
  if ('conjunction' in expression) {
    return expression.conjunction === 'and'
      ? isPermissiveSpdx(expression.left) && isPermissiveSpdx(expression.right)
      : isPermissiveSpdx(expression.left) || isPermissiveSpdx(expression.right)
  }
  return expression.plus !== true
    && expression.exception === undefined
    && PERMISSIVE_LICENSES.has(expression.license)
}

/**
 * Whether an SPDX expression grants terms this project may ship under.
 * `OR` needs one permissive alternative, because the consumer chooses; `AND`
 * needs all of them, because every obligation applies. Anything that is not a
 * recognized permissive identifier — copyleft, an exception clause, or a
 * license this list has never seen — evaluates to false, so an unfamiliar
 * expression fails closed rather than passing on a partial match.
 * @param license - the SPDX expression from the package manifest.
 * @returns true when the expression's obligations are all permissive.
 */
/* 中文说明：函数 isPermissive 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function isPermissive(license: string): boolean {
  // Some npm manifests use a slash for a choice despite SPDX requiring `OR`.
  /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normalized = license.replace(/\s*\/\s*/g, ' OR ').trim()
  try {
    return isPermissiveSpdx(parseSpdx(normalized))
  } catch {
    return false
  }
}

/**
 * Render the sentence that isolates non-permissive development tooling, or
 * nothing at all when every development dependency is permissive.
 * @param deps - development dependencies whose license is not permissive.
 * @returns the paragraph to place after the development table.
 */
/* 中文说明：函数 renderNonPermissiveNote 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function renderNonPermissiveNote(deps: ExternalDep[]): string {
  if (deps.length === 0) return ''
  /** 中文说明：函数值 named 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const named = deps.map(dep => `\`${dep.name}\` (${dep.license})`)
  /** 中文说明：变量 subject 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const subject = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
  return `\n${subject} ${named.length === 1 ? 'runs' : 'run'} only as development tooling; their code is not linked into or distributed with any DeepSeek Harness artifact.\n`
}

/** Render one npm dependency table. */
/* 中文说明：函数 renderNpmTable 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function renderNpmTable(deps: ExternalDep[]): string {
  /** 中文说明：变量 lines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = ['| Package | License |', '| --- | --- |']
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const dep of deps) lines.push(`| [\`${dep.name}\`](${dep.repo}) | ${dep.license} |`)
  return lines.join('\n')
}

/** 中文说明：函数 renderClaudeDistribution 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function renderClaudeDistribution(
  distribution: ClaudeDistribution | undefined,
): string {
  if (distribution === undefined) return ''
  /** 中文说明：函数值 rows 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const rows = distribution.payloads.map(payload =>
    `| [\`${payload.name}\`](https://www.npmjs.com/package/${payload.name}) | ${payload.version} | ${CLAUDE_PLATFORM_DECLARED_LICENSE} |`,
  )
  return `
## Official Claude Code platform payloads

The project owner authorizes distribution of every version of the official \`${CLAUDE_AGENT_SDK_PACKAGE}\` package and the official Claude Code CLI/platform payloads that each version declares through \`optionalDependencies\`. This identity-scoped authorization does not classify their declared terms as permissive and does not cover any unrelated runtime package; version, declared-license, and payload-set changes still require the ordinary dependency, lockfile, compatibility, terms, and notices review.

The installed SDK ${distribution.sdkVersion} declares the following optional platform packages. Each carries the official Claude Code ${distribution.claudeCodeVersion} executable; the package identities and versions come from the SDK manifest, while the declared license field is verified against the platform payload installed for the current host.

| Optional platform package | Version | Declared license |
| --- | --- | --- |
${rows.join('\n')}
`
}

/**
 * Render the complete notices document.
 * @returns the exact bytes `THIRD_PARTY_NOTICES.md` must hold.
 */
/* 中文说明：函数 render 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function render(): string {
  verifyBuildTimePins()
  /** 中文说明：变量 npm 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const npm = collectNpmDeps()
  /** 中文说明：函数值 runtimeDeps 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const runtimeDeps = npm.filter(dep => dep.runtime)
  /** 中文说明：函数值 devDeps 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const devDeps = npm.filter(dep => !dep.runtime)
  /** 中文说明：变量 vendored 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const vendored = collectVendored()
  /** 中文说明：变量 python 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const python = collectPython()
  /** 中文说明：变量 patched 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const patched = collectPatched()
  /** 中文说明：变量 claudeDistribution 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const claudeDistribution = runtimeDeps.some(
    dep => dep.name === CLAUDE_AGENT_SDK_PACKAGE,
  )
    ? collectClaudeDistribution()
    : undefined
  /** 中文说明：函数值 nonPermissiveDev 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const nonPermissiveDev = devDeps.filter(dep => !isPermissive(dep.license))
  // A copyleft license reaching a shipped surface is a distribution decision,
  // not a rendering detail; the notices cannot quietly absorb it.
  /** 中文说明：函数值 nonPermissiveRuntime 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const nonPermissiveRuntime = runtimeDeps.filter(dep =>
    !isPermissive(dep.license)
    && !isOwnerAuthorizedRuntime(dep.name),
  )
  if (nonPermissiveRuntime.length > 0) {
    throw new Error(`gen-third-party-notices: runtime ${nonPermissiveRuntime.map(dep => `${dep.name} (${dep.license})`).join(', ')} is not a permissive license; review the distribution terms and record the decision before regenerating.`)
  }
  /** 中文说明：函数值 patchedLines 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const patchedLines = patched.map(({ spec, patch }) => `- \`${spec}\` — [\`${patch}\`](${patch})`)

  return `<!-- Generated by scripts/gen-third-party-notices.ts — do not edit by hand.
     Run \`pnpm run gen-third-party-notices\` to regenerate. -->

# Third-Party Notices

DeepSeek Harness is licensed under [MIT](LICENSE). It depends on the third-party software listed below. Each project remains under its own license; nothing in this file changes those terms.

This file lists **direct** dependencies declared by the workspace and the explicitly disclosed official Claude Code platform payload closure. It is generated from the workspace manifests by \`scripts/gen-third-party-notices.ts\`: a pre-commit hook regenerates it whenever a staged file changes one of its inputs, and \`scripts/gen-third-party-notices.spec.ts\` asserts in the test lane that the committed bytes match. Deleting a manifest runs no hook, so that case is caught by the assertion instead. Run \`pnpm run verify-third-party-notices\` for the standalone check.

The complete npm transitive closure, including the Landlock launcher workspace, is recorded with exact pinned versions in [\`pnpm-lock.yaml\`](pnpm-lock.yaml) — inspect it with \`pnpm licenses list\`. The Python closure is recorded separately in [\`python/sdk/uv.lock\`](python/sdk/uv.lock).

## Vendored source (\`vendor/\`)

The Cordis framework and its foundation libraries are source-vendored into this repository rather than consumed from npm, and republished under the \`@deepseek-ai\` scope. All are MIT-licensed; each directory preserves its upstream \`LICENSE\` file. Exact upstream commits and local modifications are recorded in [\`vendor/README.md\`](vendor/README.md).

| Package | Upstream name | Upstream | License |
| --- | --- | --- | --- |
${vendored.map(row => `| \`${row.npmName}\` | \`${row.upstreamName}\` | [${row.upstream.replace('https://', '')}](${row.upstream}) | MIT |`).join('\n')}

## Runtime npm dependencies

External packages that a workspace package resolves at runtime. The tier covers every plugin a user can mount from \`cordis.yml\` — not only what the \`dsh\` CLI, Web UI, and Python SDK runtime load by default.

${renderNpmTable(runtimeDeps)}

pnpm applies local patches to the following packages at install time, so shipped artifacts carry modified copies; each patch file is the complete record of the modification:

${patchedLines.join('\n')}
${renderClaudeDistribution(claudeDistribution)}

## Development-only npm dependencies

External packages **directly declared** only by repository tooling, test infrastructure, the documentation site, the demo leaves, or the native launcher's build workspace. No shipped surface names them itself. A package here may still be pulled in transitively by a runtime dependency — \`pnpm-lock.yaml\` is the authority on the full closure — so this tier records who declares a package, not what a build ultimately bundles.

${renderNpmTable(devDeps)}
${renderNonPermissiveNote(nonPermissiveDev)}
## Python SDK dependencies (\`python/\`)

Direct dependencies of the \`pyproject.toml\` manifests, plus \`uv\` as the development workflow tool.

| Package | License | Role |
| --- | --- | --- |
${python.map(dep => `| [\`${dep.name}\`](${dep.repo}) | ${dep.license} | ${dep.role} |`).join('\n')}
| [\`uv\`](https://github.com/astral-sh/uv) | MIT / Apache-2.0 | development workflow tool |

## Fetched at build time

| Package | License | Role |
| --- | --- | --- |
${BUILD_TIME_TOOLS.map(tool => `| [\`${tool.name}\`](${tool.repo}) | ${tool.license} | ${tool.role} |`).join('\n')}

## First-party native packages

\`@deepseek-ai/node-addon-landlock-run\` (and its platform packages) is built and released from this repository under BSD 3-Clause. It is listed here for completeness; it is first-party, not third-party.
`
}

/** CLI entry: default writes the notices, `--check` fails if the committed copy
 * is stale. Guarded behind an entry-point check so importing this module for
 * tests neither regenerates the committed file nor calls process.exit. */
/* 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function main(): void {
  /** 中文说明：变量 content 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const content = render()
  if (process.argv.includes('--check')) {
    /** 中文说明：变量 committed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let committed: string | null = null
    try {
      committed = readFileSync(resolve(root, OUT), 'utf8')
    } catch {
      // Only ENOENT (not yet generated) is expected; a present-but-unreadable
      // file is not a state this repo produces, and the remedy is the same.
      committed = null
    }
    if (committed === content) {
      console.log(`gen-third-party-notices: ${OUT} is up to date.`)
      process.exit(0)
    }
    console.error(`gen-third-party-notices: ${OUT} is stale. Run \`pnpm run gen-third-party-notices\` and commit ${OUT}.`)
    process.exit(1)
  }

  writeFileSync(resolve(root, OUT), content)
  console.log(`gen-third-party-notices: wrote ${OUT}.`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  main()
}
