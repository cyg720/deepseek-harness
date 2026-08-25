/** Canonical paths, parsing, and rendering for bilingual pairing records. */
/**
 * 文件职责：实现 translation-pairing-record.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { basename } from 'node:path'

/** The three repository-relative paths that form one bilingual pair. */
/** 中文说明：interface TranslationPairPaths 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface TranslationPairPaths {
  /** English document path. */
  source: string
  /** Simplified Chinese document path. */
  zh: string
  /** Generated consistency-record path. */
  meta: string
}

/** The two content hashes recorded for a bilingual pair. */
/** 中文说明：interface TranslationPairingRecord 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface TranslationPairingRecord {
  /** Git blob hash of the English document. */
  sourceHash: string
  /** Git blob hash of the Simplified Chinese document. */
  zhHash: string
}

/** 中文说明：常量 META_LINE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const META_LINE = /^([^:#]+\.md): ([0-9a-f]{40})$/

/**
 * Derive the counterpart and consistency-record paths from an English document.
 *
 * @param source - Repository-relative English Markdown path.
 * @returns The complete three-path pair.
 */
/** 中文说明：函数 translationPairPaths 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function translationPairPaths(source: string): TranslationPairPaths {
  if (!source.endsWith('.md') || source.endsWith('.zh.md')) {
    throw new Error(`expected an English Markdown path, received ${JSON.stringify(source)}`)
  }
  return {
    source,
    zh: source.replace(/\.md$/, '.zh.md'),
    meta: source.replace(/\.md$/, '.i18n.yaml'),
  }
}

/**
 * Derive one pair from its consistency-record path.
 *
 * @param meta - Repository-relative `foo.i18n.yaml` path.
 * @returns The complete three-path pair.
 */
/** 中文说明：函数 translationPairPathsFromMeta 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function translationPairPathsFromMeta(meta: string): TranslationPairPaths {
  if (!meta.endsWith('.i18n.yaml')) {
    throw new Error(`expected a bilingual consistency-record path, received ${JSON.stringify(meta)}`)
  }
  return translationPairPaths(meta.replace(/\.i18n\.yaml$/, '.md'))
}

/**
 * Parse a consistency record for its expected sibling names.
 *
 * @param content - Complete sidecar text.
 * @param paths - Expected sibling paths.
 * @returns The two hashes, or `undefined` for malformed, duplicate, or unexpected keys.
 */
/** 中文说明：函数 parseTranslationPairingRecord 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function parseTranslationPairingRecord(
  content: string,
  paths: TranslationPairPaths,
): TranslationPairingRecord | undefined {
  /** 中文说明：变量 hashes 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const hashes = new Map<string, string>()
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    /** 中文说明：变量 match 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const match = META_LINE.exec(line)
    if (!match?.[1] || !match[2] || hashes.has(match[1])) return undefined
    hashes.set(match[1], match[2])
  }
  /** 中文说明：变量 sourceHash 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceHash = hashes.get(basename(paths.source))
  /** 中文说明：变量 zhHash 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zhHash = hashes.get(basename(paths.zh))
  if (hashes.size !== 2 || sourceHash === undefined || zhHash === undefined) return undefined
  return { sourceHash, zhHash }
}

/**
 * Render the canonical consistency record for a pair.
 *
 * @param paths - Pair paths written into the record and its recovery command.
 * @param record - Confirmed content hashes.
 * @returns Canonical YAML text with exactly one trailing newline.
 */
/** 中文说明：函数 renderTranslationPairingRecord 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function renderTranslationPairingRecord(
  paths: TranslationPairPaths,
  record: TranslationPairingRecord,
): string {
  return [
    '# Bilingual-pair consistency record (docs/i18n/README.md): the git blob hash of each',
    '# side as of the last confirmed-consistent state. Both languages carry equal authority;',
    '# after editing either side, bring the other along and re-record with:',
    `#   pnpm run verify-translation-pairing --write ${paths.source}`,
    `${basename(paths.source)}: ${record.sourceHash}`,
    `${basename(paths.zh)}: ${record.zhHash}`,
    '',
  ].join('\n')
}
