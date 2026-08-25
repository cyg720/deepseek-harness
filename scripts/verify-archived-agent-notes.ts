/** Verify and append-seal the frozen Agent Note archive. */
/**
 * 文件职责：实现 verify-archived-agent-notes.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AGENT_NOTE_CLASSES, agentNoteRoot } from './agent-note-tree.ts'
import {
  extendArchiveManifest,
  parseArchiveManifest,
  renderArchiveManifest,
  validateArchiveArtifacts,
  validateArchiveManifestExtension,
  /** 中文说明：type ArchiveManifest 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
  type ArchiveManifest,
} from './archived-agent-notes.ts'

/** 中文说明：变量 args 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const args = process.argv.slice(2)
/** 中文说明：变量 writeMode 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const writeMode = args.length === 1 && args[0] === '--write'
if (args.length > 0 && !writeMode) {
  console.error('verify-archived-agent-notes: usage: tsx scripts/verify-archived-agent-notes.ts [--write]')
  process.exit(1)
}

/** 中文说明：变量 archiveRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const archiveRoot = resolve(agentNoteRoot, 'archived')
/** 中文说明：变量 manifestPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const manifestPath = resolve(archiveRoot, 'manifest.json')
/** 中文说明：变量 repoRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repoRoot = resolve(agentNoteRoot, '../..')
/** 中文说明：变量 manifestRepoPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const manifestRepoPath = '.agents/notes/archived/manifest.json'
/** 中文说明：变量 errors 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const errors: string[] = []
/** 中文说明：变量 allowedRootFiles 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const allowedRootFiles = new Set(['AGENTS.md', 'manifest.json'])
/** 中文说明：变量 kinds 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const kinds = new Set<string>()

if (!existsSync(resolve(archiveRoot, 'AGENTS.md'))) errors.push('archived/AGENTS.md is required')
/** 中文说明：变量 artifacts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const artifacts = new Map<string, Buffer>()
/** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
for (const entry of readdirSync(archiveRoot, { withFileTypes: true })) {
  if (entry.isFile()) {
    if (!allowedRootFiles.has(entry.name)) errors.push(`archived/${entry.name}: unexpected root file`)
    continue
  }
  if (!entry.isDirectory()) {
    errors.push(`archived/${entry.name}: only regular files and kind directories are allowed`)
    continue
  }
  if (!(AGENT_NOTE_CLASSES as readonly string[]).includes(entry.name)) {
    errors.push(`archived/${entry.name}/: unknown Agent Note kind`)
    continue
  }
  kinds.add(entry.name)
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const child of readdirSync(resolve(archiveRoot, entry.name), { withFileTypes: true })) {
    /** 中文说明：变量 rel 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rel = `${entry.name}/${child.name}`
    if (!child.isFile()) {
      errors.push(`${rel}: archived kind directories contain regular files only`)
      continue
    }
    artifacts.set(rel, readFileSync(resolve(archiveRoot, rel)))
  }
}
/** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
for (const kind of AGENT_NOTE_CLASSES) {
  if (!kinds.has(kind)) errors.push(`archived/${kind}/: required kind directory is missing`)
}
errors.push(...validateArchiveArtifacts(artifacts))

/** 中文说明：函数 runGit 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function runGit(args: string[]): string {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git exited with status ${result.status}`)
  return result.stdout
}

/** 中文说明：函数 readBaselineManifest 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readBaselineManifest(ref: string): ArchiveManifest {
  runGit(['cat-file', '-e', `${ref}^{commit}`])
  /** 中文说明：变量 manifestEntry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifestEntry = runGit(['ls-tree', '--name-only', ref, '--', manifestRepoPath]).trim()
  if (manifestEntry === '') return { version: 1, files: {} }
  return parseArchiveManifest(runGit(['show', `${ref}:${manifestRepoPath}`]))
}

/** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let manifest: ArchiveManifest = { version: 1, files: {} }
if (existsSync(manifestPath)) {
  try {
    manifest = parseArchiveManifest(readFileSync(manifestPath, 'utf8'))
  } catch (error: unknown) {
    errors.push(`archived/manifest.json: ${error instanceof Error ? error.message : String(error)}`)
  }
} else if (!writeMode) {
  errors.push('archived/manifest.json is required; seal new artifacts with `pnpm run verify-archived-agent-notes --write`')
}

// CI supplies its trusted pre-change commit; local writes compare with committed HEAD.
/** 中文说明：变量 baselineRef 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const baselineRef = process.env.DSH_ARCHIVE_BASE_REF ?? 'HEAD'
try {
  /** 中文说明：变量 baseline 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const baseline = readBaselineManifest(baselineRef)
  errors.push(...validateArchiveManifestExtension(baseline, manifest))
} catch (error: unknown) {
  errors.push(`archived/manifest.json: cannot read baseline ${JSON.stringify(baselineRef)}: ${error instanceof Error ? error.message : String(error)}`)
}

/** 中文说明：变量 extended 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const extended = extendArchiveManifest(manifest, artifacts)
errors.push(...extended.errors)
if (!writeMode) {
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const path of extended.added) errors.push(`${path}: archived artifact is not sealed in manifest.json`)
}

if (errors.length > 0) {
  console.error('verify-archived-agent-notes: archive rules violated:')
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const error of errors) console.error(`  ${error}`)
  process.exit(1)
}

if (writeMode) {
  /** 中文说明：变量 rendered 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rendered = renderArchiveManifest(extended.files)
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== rendered) {
    writeFileSync(manifestPath, rendered)
  }
  console.log(`verify-archived-agent-notes: sealed ${extended.added.length} new artifact(s); existing seals unchanged.`)
} else {
  console.log(`verify-archived-agent-notes: ${artifacts.size} frozen artifact(s) checked across ${kinds.size} kind(s).`)
}
