/** Fail-closed composition of bilingual pairing records during Git merges. */
/**
 * 文件职责：实现 translation-pairing-merge.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  GIT_COMMAND_MAX_BUFFER,
  gitBlobHash,
  gitMergeInputPaths,
  readGitIndexBlob,
  runGit,
  storeGitBlob,
} from './translation-pairing-git.ts'
import {
  isTranslationScopeFile,
  languageSwitcherTargets,
  parseTranslationMarkdown,
  parseTranslationPairingManifest,
  requiresSourceLanguageSwitcher,
  translationPairSourcePredicate,
  translationStructureDiff,
  translationStructureSignature,
} from './translation-pairing.ts'
import {
  hasLanguageSwitcher,
  translationLinkLocaleViolations,
} from './translation-links.ts'
import {
  parseTranslationPairingRecord,
  renderTranslationPairingRecord,
  translationPairPathsFromMeta,
  /** 中文说明：type TranslationPairPaths 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
  type TranslationPairPaths,
  /** 中文说明：type TranslationPairingRecord 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
  type TranslationPairingRecord,
} from './translation-pairing-record.ts'

/** 中文说明：常量 UNMERGED_ENTRY 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const UNMERGED_ENTRY = /^(\d+) ([0-9a-f]+) ([123])\t([\s\S]+)$/

/** A mechanically composed record and the exact merged owner contents it names. */
/** 中文说明：interface TranslationPairingMergeResult 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface TranslationPairingMergeResult extends TranslationPairingRecord {
  /** Canonical generated sidecar text. */
  record: string
  /** Clean three-way merge of the English owner. */
  sourceContent: Buffer
  /** Clean three-way merge of the Simplified Chinese owner. */
  zhContent: Buffer
}

/** 中文说明：interface UnmergedStages 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface UnmergedStages {
  ancestor?: string
  current?: string
  other?: string
}

/** 中文说明：函数 readGitBlob 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readGitBlob(root: string, objectId: string, owner: string): Buffer {
  /** 中文说明：变量 content 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const content = runGit(root, ['cat-file', 'blob', objectId], `reading ${owner} blob ${objectId}`)
  if (gitBlobHash(content) !== objectId) {
    throw new Error(`${owner} record names ${objectId}, which is not its SHA-1 git blob hash`)
  }
  return content
}

/** 中文说明：函数 readMergeDefault 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readMergeDefault(root: string): string | undefined {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync('git', ['-C', root, 'config', '--get', 'merge.default'], {
    maxBuffer: GIT_COMMAND_MAX_BUFFER,
  })
  if (result.error) {
    throw new Error(`reading merge.default failed: ${result.error.message}`, { cause: result.error })
  }
  if (result.status === 1) return undefined
  if (result.status !== 0) {
    throw new Error(
      `reading merge.default failed with status ${String(result.status)}: ${result.stderr.toString('utf8').trim()}`,
    )
  }
  return result.stdout.toString('utf8').trim()
}

/** 中文说明：函数 assertDefaultTextMerge 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function assertDefaultTextMerge(root: string, paths: TranslationPairPaths): void {
  /** 中文说明：变量 output 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const output = runGit(
    root,
    ['check-attr', '-z', 'merge', '--', paths.source, paths.zh],
    'checking bilingual owner merge attributes',
  ).toString('utf8')
  /** 中文说明：变量 fields 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fields = output.split('\0')
  fields.pop()
  /** 中文说明：变量 mergeDefault 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let mergeDefault: string | undefined
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < fields.length; index += 3) {
    /** 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = fields[index]
    /** 中文说明：变量 value 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value = fields[index + 2]
    if (path === undefined || value === undefined) {
      throw new Error('git check-attr returned a malformed result')
    }
    if (!['unspecified', 'set', 'text'].includes(value)) {
      throw new Error(`${path} uses merge=${value}; the pairing driver only composes Git's default text merge`)
    }
    if (value === 'unspecified') {
      mergeDefault ??= readMergeDefault(root)
      if (mergeDefault !== undefined && mergeDefault !== 'text') {
        throw new Error(
          `${path} inherits merge.default=${mergeDefault}; the pairing driver only composes Git's default text merge`,
        )
      }
    }
  }
}

/** 中文说明：函数 runTextMerge 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function runTextMerge(
  root: string,
  label: string,
  ancestor: Buffer | string,
  current: Buffer | string,
  other: Buffer | string,
): { output: Buffer; status: number | null } {
  /** 中文说明：变量 temporary 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-translation-pairing-merge-'))
  try {
    /** 中文说明：变量 ancestorPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ancestorPath = join(temporary, 'ancestor')
    /** 中文说明：变量 currentPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const currentPath = join(temporary, 'current')
    /** 中文说明：变量 otherPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const otherPath = join(temporary, 'other')
    writeFileSync(ancestorPath, ancestor)
    writeFileSync(currentPath, current)
    writeFileSync(otherPath, other)
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = spawnSync('git', [
      '-C', root,
      'merge-file', '-p',
      '-L', `${label}:current`,
      '-L', `${label}:ancestor`,
      '-L', `${label}:other`,
      currentPath, ancestorPath, otherPath,
    ], { maxBuffer: GIT_COMMAND_MAX_BUFFER })
    if (result.error) {
      throw new Error(`merging ${label} failed: ${result.error.message}`, { cause: result.error })
    }
    return { output: result.stdout, status: result.status }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

/** 中文说明：函数 mergeBlobTriplet 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function mergeBlobTriplet(
  root: string,
  owner: string,
  ancestor: Buffer,
  current: Buffer,
  other: Buffer,
): Buffer {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = runTextMerge(root, owner, ancestor, current, other)
  if (result.status !== 0) {
    /** 中文说明：变量 kind 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const kind = result.status !== null && result.status > 0 && result.status <= 127
      ? 'has content conflicts'
      : `failed with status ${String(result.status)}`
    throw new Error(`${owner} ${kind}`)
  }
  return result.output
}

/** 中文说明：函数 loadRecordOwners 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function loadRecordOwners(
  root: string,
  label: string,
  content: string,
  paths: TranslationPairPaths,
): { source: Buffer; zh: Buffer } {
  /** 中文说明：变量 record 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const record = parseTranslationPairingRecord(content, paths)
  if (record === undefined) throw new Error(`${label} ${paths.meta} is not a valid two-hash pairing record`)
  return {
    source: readGitBlob(root, record.sourceHash, `${label} ${paths.source}`),
    zh: readGitBlob(root, record.zhHash, `${label} ${paths.zh}`),
  }
}

/** 中文说明：函数 assertMergedPairStructure 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function assertMergedPairStructure(
  root: string,
  paths: TranslationPairPaths,
  source: Buffer,
  zh: Buffer,
  isTranslationPairSource: (sourcePath: string) => boolean,
): void {
  /** 中文说明：变量 sourceText 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceText = source.toString('utf8')
  /** 中文说明：变量 zhText 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zhText = zh.toString('utf8')
  /** 中文说明：变量 sourceTree 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceTree = parseTranslationMarkdown(sourceText)
  /** 中文说明：变量 zhTree 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zhTree = parseTranslationMarkdown(zhText)
  /** 中文说明：变量 indexFiles 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const indexFiles = gitMergeInputPaths(root)
  /** 中文说明：函数值 repositoryFileExists 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const repositoryFileExists = (path: string): boolean => indexFiles.has(path)
  /** 中文说明：变量 sourceSwitcherTargets 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceSwitcherTargets = languageSwitcherTargets(paths.source)
  /** 中文说明：变量 zhSwitcherTargets 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zhSwitcherTargets = languageSwitcherTargets(paths.zh)
  if (requiresSourceLanguageSwitcher(paths.source)
    && !hasLanguageSwitcher(sourceTree, sourceText, zhSwitcherTargets)) {
    throw new Error(`${paths.source} clean merge lost its language-switcher link to ${basename(paths.zh)}`)
  }
  if (!hasLanguageSwitcher(zhTree, zhText, sourceSwitcherTargets)) {
    throw new Error(`${paths.zh} clean merge lost its language-switcher link to ${basename(paths.source)}`)
  }
  /** 中文说明：变量 localeViolations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const localeViolations = [
    ...translationLinkLocaleViolations(sourceText, {
      repoRoot: root,
      sourcePath: paths.source,
      isTranslationPairSource,
      repositoryFileExists,
    }, zhSwitcherTargets),
    ...translationLinkLocaleViolations(zhText, {
      repoRoot: root,
      sourcePath: paths.zh,
      isTranslationPairSource,
      repositoryFileExists,
    }, sourceSwitcherTargets),
  ]
  if (localeViolations.length > 0) {
    /** 中文说明：变量 violation 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const violation = localeViolations[0]
    if (violation === undefined) throw new Error('translation locale violation disappeared')
    throw new Error(`${violation.sourcePath}:${violation.line} clean merge uses ${JSON.stringify(violation.url)}; expected ${JSON.stringify(violation.expectedUrl)}`)
  }
  /** 中文说明：变量 divergences 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const divergences = translationStructureDiff(
    translationStructureSignature(sourceTree, zhSwitcherTargets, {
      repoRoot: root,
      sourcePath: paths.source,
      isTranslationPairSource,
      repositoryFileExists,
      markdown: sourceText,
    }),
    translationStructureSignature(zhTree, sourceSwitcherTargets, {
      repoRoot: root,
      sourcePath: paths.zh,
      isTranslationPairSource,
      repositoryFileExists,
      markdown: zhText,
    }),
  )
  if (divergences.length > 0) {
    throw new Error(`${paths.source} and ${paths.zh} clean merges diverge structurally: ${divergences.join('; ')}`)
  }
}

/** 中文说明：函数 normalizeMetaPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function normalizeMetaPath(root: string, meta: string): string {
  if (isAbsolute(meta)) throw new Error(`pairing record must be repository-relative: ${JSON.stringify(meta)}`)
  /** 中文说明：变量 repositoryRelative 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const repositoryRelative = relative(resolve(root), resolve(root, meta))
  if (repositoryRelative === '' || repositoryRelative === '..' || repositoryRelative.startsWith(`..${sep}`)) {
    throw new Error(`pairing record escapes the repository: ${JSON.stringify(meta)}`)
  }
  return repositoryRelative.split(sep).join('/')
}

/**
 * Compose one generated sidecar from the ancestor, current, and other records.
 *
 * Each input record is already a confirmation of its two owner blobs. The
 * result exists only when Git's default text merge succeeds independently for
 * both languages and the composed documents retain the pairing structure.
 *
 * @param root - Repository root containing the referenced Git objects.
 * @param metaPath - Repository-relative sidecar path.
 * @param ancestorRecord - Common-ancestor sidecar text.
 * @param currentRecord - Current-side sidecar text.
 * @param otherRecord - Other-side sidecar text.
 * @returns The canonical record and exact merged owner contents.
 * @throws Error when the input is not mechanically composable.
 */
/** 中文说明：函数 mergeTranslationPairingRecords 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function mergeTranslationPairingRecords(
  root: string,
  metaPath: string,
  ancestorRecord: string,
  currentRecord: string,
  otherRecord: string,
  isTranslationPairSource: (sourcePath: string) => boolean,
): TranslationPairingMergeResult {
  /** 中文说明：变量 normalizedMeta 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normalizedMeta = normalizeMetaPath(root, metaPath)
  if (!isTranslationScopeFile(normalizedMeta)) {
    throw new Error(`${normalizedMeta} is outside the active bilingual documentation corpus`)
  }
  /** 中文说明：变量 paths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const paths = translationPairPathsFromMeta(normalizedMeta)
  if (!isTranslationPairSource(paths.source)) {
    throw new Error(`${normalizedMeta} is excluded from the active bilingual documentation corpus`)
  }
  assertDefaultTextMerge(root, paths)
  /** 中文说明：变量 ancestor 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ancestor = loadRecordOwners(root, 'ancestor', ancestorRecord, paths)
  /** 中文说明：变量 current 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const current = loadRecordOwners(root, 'current', currentRecord, paths)
  /** 中文说明：变量 other 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const other = loadRecordOwners(root, 'other', otherRecord, paths)
  /** 中文说明：变量 sourceContent 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceContent = mergeBlobTriplet(root, paths.source, ancestor.source, current.source, other.source)
  /** 中文说明：变量 zhContent 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zhContent = mergeBlobTriplet(root, paths.zh, ancestor.zh, current.zh, other.zh)
  assertMergedPairStructure(root, paths, sourceContent, zhContent, isTranslationPairSource)
  /** 中文说明：变量 sourceHash 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceHash = storeGitBlob(root, sourceContent)
  /** 中文说明：变量 zhHash 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zhHash = storeGitBlob(root, zhContent)
  return {
    record: renderTranslationPairingRecord(paths, { sourceHash, zhHash }),
    sourceContent,
    sourceHash,
    zhContent,
    zhHash,
  }
}

/** Read the repository manifest and return its active bilingual-source predicate. */
/** 中文说明：函数 repositoryTranslationPairSource 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function repositoryTranslationPairSource(root: string): (sourcePath: string) => boolean {
  /** 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const path = 'scripts/translation-pairing.manifest.json'
  /** 中文说明：变量 content 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const content = readGitIndexBlob(root, path)?.content ?? readFileSync(join(root, path))
  /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifest = parseTranslationPairingManifest(
    content.toString('utf8'),
  )
  return translationPairSourcePredicate(manifest)
}

/** 中文说明：函数 unmergedSidecars 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function unmergedSidecars(root: string): Map<string, UnmergedStages> {
  /** 中文说明：变量 output 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const output = runGit(root, ['ls-files', '--unmerged', '-z'], 'listing unresolved merge entries').toString('utf8')
  /** 中文说明：变量 records 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const records = new Map<string, UnmergedStages>()
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const entry of output.split('\0')) {
    if (entry === '') continue
    /** 中文说明：变量 match 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const match = UNMERGED_ENTRY.exec(entry)
    if (!match?.[2] || !match[3] || match[4] === undefined) {
      throw new Error(`git ls-files returned a malformed unmerged entry: ${JSON.stringify(entry)}`)
    }
    /** 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = match[4]
    if (!path.endsWith('.i18n.yaml')) continue
    /** 中文说明：变量 stages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stages = records.get(path) ?? {}
    /** 中文说明：变量 field 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const field = match[3] === '1' ? 'ancestor' : match[3] === '2' ? 'current' : 'other'
    stages[field] = match[2]
    records.set(path, stages)
  }
  return records
}

/** 中文说明：函数 assertUneditedSidecar 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function assertUneditedSidecar(
  root: string,
  metaPath: string,
  ancestorRecord: string,
  currentRecord: string,
  otherRecord: string,
): void {
  /** 中文说明：变量 worktreeRecord 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const worktreeRecord = readFileSync(join(root, metaPath), 'utf8')
  if (worktreeRecord === currentRecord || worktreeRecord === otherRecord) return
  /** 中文说明：变量 textMerge 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const textMerge = runTextMerge(root, metaPath, ancestorRecord, currentRecord, otherRecord)
  if (textMerge.status === 0 && textMerge.output.toString('utf8') === worktreeRecord) return
  /** 中文说明：变量 stageDataLines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stageDataLines = [currentRecord, otherRecord]
    .flatMap(record => record.split(/\r?\n/))
    .filter(line => line !== '' && !line.startsWith('#'))
  /** 中文说明：变量 hasUneditedConflict 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const hasUneditedConflict = worktreeRecord.includes('<<<<<<<')
    && worktreeRecord.includes('=======')
    && worktreeRecord.includes('>>>>>>>')
    && stageDataLines.every(line => worktreeRecord.includes(line))
  if (!hasUneditedConflict) {
    throw new Error(`${metaPath} has edited conflict content; refusing to overwrite manual work`)
  }
}

/**
 * Resolve every mechanically composable `.i18n.yaml` conflict in the index.
 *
 * The command first proves that Git's already-staged owner merges match the
 * independently composed contents, then writes and stages all sidecars as one
 * batch. Other conflicts remain untouched; after staging the safe records, an
 * aggregate error reports any pairing conflicts that still need manual work.
 *
 * @param root - Repository root with an in-progress merge-like operation.
 * @returns Repository-relative sidecar paths resolved and staged.
 */
/** 中文说明：函数 resolveTranslationPairingConflicts 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function resolveTranslationPairingConflicts(
  root: string,
  isTranslationPairSource: (sourcePath: string) => boolean,
): string[] {
  /** 中文说明：变量 resolutions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const resolutions: { path: string; record: string }[] = []
  /** 中文说明：变量 failures 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const failures: { path: string; reason: string }[] = []
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const [metaPath, stages] of [...unmergedSidecars(root)].sort(([left], [right]) => left.localeCompare(right))) {
    try {
      if (stages.ancestor === undefined || stages.current === undefined || stages.other === undefined) {
        throw new Error('is an add/delete or incomplete-stage conflict and requires manual resolution')
      }
      /** 中文说明：变量 ancestorRecord 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ancestorRecord = readGitBlob(root, stages.ancestor, `ancestor ${metaPath}`).toString('utf8')
      /** 中文说明：变量 currentRecord 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const currentRecord = readGitBlob(root, stages.current, `current ${metaPath}`).toString('utf8')
      /** 中文说明：变量 otherRecord 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const otherRecord = readGitBlob(root, stages.other, `other ${metaPath}`).toString('utf8')
      assertUneditedSidecar(root, metaPath, ancestorRecord, currentRecord, otherRecord)
      /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = mergeTranslationPairingRecords(
        root,
        metaPath,
        ancestorRecord,
        currentRecord,
        otherRecord,
        isTranslationPairSource,
      )
      /** 中文说明：变量 paths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const paths = translationPairPathsFromMeta(metaPath)
      if (readGitIndexBlob(root, paths.source)?.objectId !== result.sourceHash) {
        throw new Error(`${paths.source} staged merge does not match the pairing driver's clean merge`)
      }
      if (readGitIndexBlob(root, paths.zh)?.objectId !== result.zhHash) {
        throw new Error(`${paths.zh} staged merge does not match the pairing driver's clean merge`)
      }
      /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
      for (const [path, expected] of [[paths.source, result.sourceHash], [paths.zh, result.zhHash]] as const) {
        if (gitBlobHash(readFileSync(join(root, path))) !== expected) {
          throw new Error(`${path} has unstaged content; refusing to confirm bytes outside the merge result`)
        }
      }
      resolutions.push({ path: metaPath, record: result.record })
    } catch (error) {
      failures.push({ path: metaPath, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const resolution of resolutions) writeFileSync(join(root, resolution.path), resolution.record)
  if (resolutions.length > 0) {
    runGit(root, ['add', '--', ...resolutions.map(resolution => resolution.path)], 'staging resolved pairing records')
  }
  if (failures.length > 0) {
    /** 中文说明：变量 resolved 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = resolutions.length === 0
      ? ''
      : `resolved and staged ${resolutions.map(resolution => resolution.path).join(', ')}; `
    throw new Error(
      `${resolved}left ${String(failures.length)} pairing conflict(s) unresolved:\n`
      + failures.map(failure => `- ${failure.path}: ${failure.reason}`).join('\n'),
    )
  }
  return resolutions.map(resolution => resolution.path)
}
