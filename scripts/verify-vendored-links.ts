/**
 * Verify that pnpm-lock.yaml resolves every vendored package name to its
 * workspace `link:` — never a registry copy. `linkWorkspacePackages: true`
 * (pnpm-workspace.yaml) makes matching upstream semver ranges resolve to the
 * pinned vendored sources; a registry copy of the same name coexisting with
 * the vendored one silently forks the framework layer (vendor/README.md).
 */
/**
 * 文件职责：实现 verify-vendored-links.ts 覆盖的仓库一致性验证职责。
 * 技术维度：使用 TypeScript、Node.js 文件系统、类型检查或链接扫描。
 * 产品维度：保障类型与 vendored 文档链接保持正确。
 * 逻辑维度：扫描输入，比较预期关系，再报告违规并设置退出状态。
 * 关键边界：路径和源码文本不可信；任何不一致都必须显式失败。
 * 新手阅读建议：先看扫描范围，再读比较逻辑，最后关注诊断和退出码。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import * as yaml from 'js-yaml'

/** 中文说明：变量 root 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')

/** 中文说明：函数 vendoredNames 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function vendoredNames(): Promise<Set<string>> {
  /** 中文说明：变量 names 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const names = new Set<string>()
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const entry of await readdir(join(root, 'vendor'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    /** 中文说明：变量 manifest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let manifest: { name?: string }
    try {
      manifest = JSON.parse(await readFile(join(root, 'vendor', entry.name, 'package.json'), 'utf8')) as { name?: string }
    } catch {
      continue // not a package directory (e.g. vendor/README.md siblings)
    }
    if (manifest.name !== undefined) names.add(manifest.name)
  }
  return names
}

/** 中文说明：interface Lockfile 定义本模块所需的数据或行为，用于表达当前配置场景。 */
interface Lockfile {
  importers?: Record<string, Record<string, unknown>>
  packages?: Record<string, unknown>
  snapshots?: Record<string, unknown>
}

/** 中文说明：变量 names 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const names = await vendoredNames()
if (names.size === 0) throw new Error('verify-vendored-links: no vendored package manifests found under vendor/')
/** 中文说明：变量 lockfile 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const lockfile = yaml.load(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')) as Lockfile

/** 中文说明：变量 violations 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const violations: string[] = []

// Importer resolutions: every dependency entry naming a vendored package must
// resolve to a link:, or the build silently uses a registry copy.
/** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
for (const [importer, sections] of Object.entries(lockfile.importers ?? {})) {
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const [section, dependencies] of Object.entries(sections)) {
    if (typeof dependencies !== 'object' || dependencies === null) continue
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const [dependency, entry] of Object.entries(dependencies as Record<string, { version?: string }>)) {
      if (!names.has(dependency)) continue
      /** 中文说明：变量 version 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const version = entry.version ?? ''
      if (!version.startsWith('link:')) {
        violations.push(`${importer} ${section}.${dependency} resolves to ${JSON.stringify(version)} (expected link:)`)
      }
    }
  }
}

// Package/snapshot keys: a registry copy materializes as a `<name>@<version>`
// key; vendored names must never appear there at all.
/** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
for (const section of ['packages', 'snapshots'] as const) {
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const key of Object.keys(lockfile[section] ?? {})) {
    /** 中文说明：变量 atIndex 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const atIndex = key.lastIndexOf('@')
    if (atIndex <= 0) continue
    /** 中文说明：变量 packageName 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packageName = key.slice(0, atIndex)
    if (names.has(packageName)) violations.push(`${section} entry ${key} is a registry copy of a vendored package`)
  }
}

if (violations.length > 0) {
  console.error(`verify-vendored-links: ${String(violations.length)} lockfile resolution(s) bypass the vendored workspaces:`)
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}
console.log(`verify-vendored-links: all ${String(names.size)} vendored package names resolve to workspace links.`)
