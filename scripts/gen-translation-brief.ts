/**
 * Print the minimal-update briefing for out-of-sync translation pairs:
 * `pnpm run gen-translation-brief [--apply] [pair paths...]`. With no
 * arguments it discovers every out-of-sync pair; with arguments (any file
 * of a pair) it briefs exactly those pairs and fails loud on in-sync,
 * incomplete, or out-of-scope requests. Each briefing maps the change at
 * the narrowest safe granularity — code-fence-only splice, changed
 * Markdown units, heading sections, whole document — and `--apply` writes
 * the computed counterpart for pairs whose change is code-fence-only.
 * The briefing rules live in `scripts/translation-brief.ts`; the
 * consuming workflow is `.agents/skills/dsh-translate-docs/SKILL.md`.
 */
/**
 * 文件职责：实现 gen-translation-brief.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import {
  isTranslationPairingManifestExcluded,
  isTranslationScopeFile,
  pairAnchorOfArgument,
  parseTranslationMarkdown,
  parseTranslationPairingManifest,
  TRANSLATION_SCOPE_GLOB_EXCLUDES,
  translationPairSourcePredicate,
  translationStructureDiff,
  translationStructureSignature,
} from './translation-pairing.ts'
import {
  changedSpanIndices,
  computeMechanicalUpdate,
  firstOccurrenceContext,
  markdownUnits,
  relevantTerminologyRows,
  renderTranslationBrief,
  sectionSpans,
  spansAligned,
  /** 中文说明：type BriefBundle 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
  type BriefBundle,
  /** 中文说明：type BriefDirection 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
  type BriefDirection,
  /** 中文说明：type BriefScope 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
  type BriefScope,
  /** 中文说明：type MarkdownSpan 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
  type MarkdownSpan,
} from './translation-brief.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const manifest = parseTranslationPairingManifest(readFileSync(join(root, 'scripts/translation-pairing.manifest.json'), 'utf8'))
/** 中文说明：变量 isTranslationPairSource 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const isTranslationPairSource = translationPairSourcePredicate(manifest)
/** 中文说明：变量 terminology 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const terminology = readFileSync(join(root, 'docs/i18n/terminology.md'), 'utf8')

/** 中文说明：函数 isExcluded 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isExcluded(file: string): boolean {
  return isTranslationPairingManifestExcluded(file, manifest)
}

/** Recorded hashes of one consistency record: basename → blob hash. */
/** 中文说明：函数 parseMeta 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parseMeta(content: string): Map<string, string> | undefined {
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out = new Map<string, string>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    /** 中文说明：变量 match 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const match = /^([^:#]+\.md): ([0-9a-f]{40})$/.exec(line)
    if (!match?.[1] || !match[2]) return undefined
    out.set(match[1], match[2])
  }
  return out
}

/** 中文说明：函数 git 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function git(args: string[], allowedExitCodes: number[] = [0]): string {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 })
  if (result.error) throw result.error
  if (!allowedExitCodes.includes(result.status ?? -1)) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

/** 中文说明：函数 blobText 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function blobText(hash: string): string {
  return git(['cat-file', '-p', hash])
}

/** Unified diff between two texts, headers stripped, via `git diff --no-index`. */
/** 中文说明：函数 diffTexts 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function diffTexts(before: string, after: string): string {
  /** 中文说明：变量 dir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = mkdtempSync(join(tmpdir(), 'translation-brief-'))
  try {
    writeFileSync(join(dir, 'last-confirmed.md'), before)
    writeFileSync(join(dir, 'current.md'), after)
    /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const raw = git(['diff', '--no-index', '--unified=2', join(dir, 'last-confirmed.md'), join(dir, 'current.md')], [0, 1])
    return raw.split('\n')
      .filter(line => !line.startsWith('diff --git') && !line.startsWith('index ') && !line.startsWith('--- ') && !line.startsWith('+++ '))
      .join('\n')
      .trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 中文说明：interface PairState 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface PairState {
  anchor: string
  zh: string
  meta: string
  enDrifted: boolean
  zhDrifted: boolean
  enLast: string
  zhLast: string
}

/** Load one pair's recorded and current state, or explain why it cannot be briefed. */
/** 中文说明：函数 loadPair 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function loadPair(anchor: string): PairState | string {
  /** 中文说明：变量 zh 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zh = anchor.replace(/\.md$/, '.zh.md')
  /** 中文说明：变量 meta 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const meta = anchor.replace(/\.md$/, '.i18n.yaml')
  if (!isTranslationScopeFile(anchor) || isExcluded(anchor)) {
    return `${anchor}: not an in-scope documentation pair (docs/i18n/README.md)`
  }
  /** 中文说明：函数值 missing 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const missing = [anchor, zh, meta].filter(file => !existsSync(join(root, file)))
  if (missing.length > 0) {
    return `${anchor}: incomplete pair (missing ${missing.join(', ')}) — a new counterpart is whole-document translation work, not a minimal update`
  }
  /** 中文说明：变量 record 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const record = parseMeta(readFileSync(join(root, meta), 'utf8'))
  /** 中文说明：变量 enRecorded 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const enRecorded = record?.get(basename(anchor))
  /** 中文说明：变量 zhRecorded 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zhRecorded = record?.get(basename(zh))
  if (record === undefined || enRecorded === undefined || zhRecorded === undefined) {
    return `${meta}: malformed consistency record`
  }
  /** 中文说明：变量 enCurrent 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const enCurrent = readFileSync(join(root, anchor), 'utf8')
  /** 中文说明：变量 zhCurrent 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zhCurrent = readFileSync(join(root, zh), 'utf8')
  /** 中文说明：变量 enLast 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const enLast = blobText(enRecorded)
  /** 中文说明：变量 zhLast 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zhLast = blobText(zhRecorded)
  return {
    anchor,
    zh,
    meta,
    enDrifted: enCurrent !== enLast,
    zhDrifted: zhCurrent !== zhLast,
    enLast,
    zhLast,
  }
}

/** Assemble bundles for the given changed + first-occurrence span indices. */
/** 中文说明：函数 bundlesFor 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function bundlesFor(
  indices: number[],
  extraIndices: number[],
  confirmed: MarkdownSpan[],
  current: MarkdownSpan[],
  counterpart: MarkdownSpan[],
): BriefBundle[] {
  /** 中文说明：变量 extras 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const extras = new Set(extraIndices)
  return [...new Set([...indices, ...extraIndices])].sort((left, right) => left - right).map((index) => {
    /** 中文说明：变量 confirmedSpan 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const confirmedSpan = confirmed[index]
    /** 中文说明：变量 currentSpan 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const currentSpan = current[index]
    /** 中文说明：变量 counterpartSpan 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const counterpartSpan = counterpart[index]
    if (confirmedSpan === undefined || currentSpan === undefined || counterpartSpan === undefined) {
      throw new Error(`gen-translation-brief: span ${index} is unmapped despite alignment`)
    }
    return {
      index,
      label: currentSpan.label,
      reason: extras.has(index) && confirmedSpan.text === currentSpan.text ? 'first-occurrence' as const : undefined,
      confirmedSourceText: confirmedSpan.text,
      currentSourceText: currentSpan.text,
      counterpartText: counterpartSpan.text,
      counterpartStartLine: counterpartSpan.startLine,
    }
  })
}

/** 中文说明：interface PlannedBrief 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface PlannedBrief {
  scope: BriefScope
  /** Old + new text of the changed spans, for terminology matching. */
  changedText: string
  /** Computed counterpart for a mechanical scope, for `--apply`. */
  mechanicalResult?: string | undefined
}

/** Choose the narrowest safely mapped granularity for one drifted side. */
/** 中文说明：函数 planScope 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function planScope(
  sourceLast: string,
  sourceCurrent: string,
  counterpartCurrent: string,
  direction: BriefDirection,
  bothDrifted: boolean,
): PlannedBrief {
  /** 中文说明：变量 wholeChangedText 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const wholeChangedText = `${sourceLast}\n${sourceCurrent}`
  if (bothDrifted) {
    return {
      scope: { kind: 'document', reason: 'BOTH sides changed since the pair was last confirmed consistent, so no side is a trustworthy mapping anchor; decide which side owns each divergence.' },
      changedText: wholeChangedText,
    }
  }
  /** 中文说明：变量 mechanical 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mechanical = computeMechanicalUpdate(sourceLast, sourceCurrent, counterpartCurrent)
  if (mechanical !== undefined) {
    return { scope: { kind: 'mechanical' }, changedText: wholeChangedText, mechanicalResult: mechanical }
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const [kind, spansOf] of [['units', markdownUnits], ['sections', sectionSpans]] as const) {
    /** 中文说明：变量 confirmed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const confirmed = spansOf(sourceLast)
    /** 中文说明：变量 current 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const current = spansOf(sourceCurrent)
    /** 中文说明：变量 counterpart 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const counterpart = spansOf(counterpartCurrent)
    if (!spansAligned(confirmed, current) || !spansAligned(confirmed, counterpart)) continue
    /** 中文说明：变量 changed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changed = changedSpanIndices(confirmed, current)
    if (changed.length === 0) continue
    /** 中文说明：函数值 changedText 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const changedText = changed.map(index => `${confirmed[index]?.text ?? ''}\n${current[index]?.text ?? ''}`).join('\n')
    /** 中文说明：变量 rows 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rows = relevantTerminologyRows(terminology, direction, changedText)
    /** 中文说明：变量 occurrence 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const occurrence = direction === 'en-to-zh'
      ? firstOccurrenceContext(sourceLast, sourceCurrent, confirmed, current, rows, new Set(changed))
      : { notes: [], extraSpanIndices: [] }
    return {
      scope: {
        kind,
        bundles: bundlesFor(changed, occurrence.extraSpanIndices, confirmed, current, counterpart),
        firstOccurrenceNotes: occurrence.notes,
      },
      changedText,
    }
  }
  return {
    scope: { kind: 'document', reason: 'Neither fine-grained units nor heading sections align one to one across the last-confirmed source, current source, and current counterpart.' },
    changedText: wholeChangedText,
  }
}

/** Validate a computed mechanical counterpart and write it. */
/** 中文说明：函数 applyMechanical 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function applyMechanical(counterpartPath: string, sourceCurrent: string, result: string): void {
  /** 中文说明：变量 counterpartBase 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const counterpartBase = basename(counterpartPath)
  /** 中文说明：变量 sourcePath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourcePath = counterpartPath.endsWith('.zh.md')
    ? counterpartPath.replace(/\.zh\.md$/, '.md')
    : counterpartPath.replace(/\.md$/, '.zh.md')
  /** 中文说明：变量 sourceBase 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceBase = counterpartBase.endsWith('.zh.md')
    ? counterpartBase.replace(/\.zh\.md$/, '.md')
    : counterpartBase.replace(/\.md$/, '.zh.md')
  /** 中文说明：变量 errors 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const errors = translationStructureDiff(
    translationStructureSignature(
      parseTranslationMarkdown(sourceCurrent),
      counterpartBase,
      { repoRoot: root, sourcePath, isTranslationPairSource, markdown: sourceCurrent },
    ),
    translationStructureSignature(
      parseTranslationMarkdown(result),
      sourceBase,
      { repoRoot: root, sourcePath: counterpartPath, isTranslationPairSource, markdown: result },
    ),
  )
  if (errors.length > 0) {
    throw new Error(`gen-translation-brief: computed mechanical update for ${counterpartPath} violates the pair structure: ${errors.join('; ')}`)
  }
  writeFileSync(join(root, counterpartPath), result)
  console.error(`gen-translation-brief: applied code-fence splice to ${counterpartPath}; review the diff, then record the pair.`)
}

/** Render (and under `--apply`, apply) the briefing for one drifted side. */
/** 中文说明：函数 briefDirection 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function briefDirection(pair: PairState, direction: BriefDirection, apply: boolean): string {
  /** 中文说明：变量 sourceIsEnglish 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceIsEnglish = direction === 'en-to-zh'
  /** 中文说明：变量 sourcePath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourcePath = sourceIsEnglish ? pair.anchor : pair.zh
  /** 中文说明：变量 counterpartPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const counterpartPath = sourceIsEnglish ? pair.zh : pair.anchor
  /** 中文说明：变量 sourceLast 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceLast = sourceIsEnglish ? pair.enLast : pair.zhLast
  /** 中文说明：变量 sourceCurrent 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceCurrent = readFileSync(join(root, sourcePath), 'utf8')
  /** 中文说明：变量 counterpartCurrent 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const counterpartCurrent = readFileSync(join(root, counterpartPath), 'utf8')
  /** 中文说明：变量 diff 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const diff = diffTexts(sourceLast, sourceCurrent)
  /** 中文说明：变量 planned 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const planned = planScope(sourceLast, sourceCurrent, counterpartCurrent, direction, pair.enDrifted && pair.zhDrifted)
  if (apply && planned.mechanicalResult !== undefined) {
    applyMechanical(counterpartPath, sourceCurrent, planned.mechanicalResult)
  }
  return renderTranslationBrief({
    sourcePath,
    counterpartPath,
    direction,
    diff,
    scope: planned.scope,
    terminology: relevantTerminologyRows(terminology, direction, planned.changedText),
  })
}

/** 中文说明：变量 argv 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const argv = process.argv.slice(2)
/** 中文说明：函数值 flags 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
const flags = argv.filter(argument => argument.startsWith('--'))
/** 中文说明：函数值 unknownFlags 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
const unknownFlags = flags.filter(flag => flag !== '--apply')
if (unknownFlags.length > 0) {
  console.error(`gen-translation-brief: unknown flag(s): ${unknownFlags.join(', ')} (only --apply is supported)`)
  process.exit(2)
}
/** 中文说明：变量 applyMode 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const applyMode = flags.includes('--apply')
/** 中文说明：函数值 requested 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
const requested = argv.filter(argument => !argument.startsWith('--')).map(pairAnchorOfArgument)

/** 中文说明：变量 anchors 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let anchors: string[]
if (requested.length > 0) {
  anchors = [...new Set(requested)].sort()
} else {
  /** 中文说明：变量 discovered 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const discovered = new Set<string>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const match of globSync('**/*.i18n.yaml', { cwd: root, exclude: TRANSLATION_SCOPE_GLOB_EXCLUDES })) {
    /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const normalized = match.split(sep).join('/')
    if (isTranslationScopeFile(normalized)) discovered.add(normalized.replace(/\.i18n\.yaml$/, '.md'))
  }
  anchors = [...discovered].sort()
}

/** 中文说明：变量 briefs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const briefs: string[] = []
/** 中文说明：变量 problems 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const problems: string[] = []
/** 中文说明：变量 skipped 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const skipped: string[] = []
/** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
for (const anchor of anchors) {
  /** 中文说明：变量 pair 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const pair = loadPair(anchor)
  if (typeof pair === 'string') {
    if (requested.length > 0) problems.push(pair)
    continue
  }
  if (!pair.enDrifted && !pair.zhDrifted) {
    if (requested.length > 0) skipped.push(`${anchor}: pair is consistent with its record — nothing to brief`)
    continue
  }
  if (pair.enDrifted) briefs.push(briefDirection(pair, 'en-to-zh', applyMode))
  if (pair.zhDrifted) briefs.push(briefDirection(pair, 'zh-to-en', applyMode))
}

if (problems.length > 0 || skipped.length > 0) {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const message of [...problems, ...skipped]) console.error(`gen-translation-brief: ${message}`)
  process.exit(2)
}
if (briefs.length === 0) {
  console.log('gen-translation-brief: every recorded pair matches its consistency record; nothing to brief.')
  process.exit(0)
}
console.log(briefs.join('\n\n---\n\n'))
