/**
 * Separate byte-identical Chinese Markdown code blocks from the primary checks
 * performed on their unsuffixed English siblings. The bilingual pairing gate
 * owns cross-language identity; source-oriented gates consume one copy.
 */
/*
 * 文件职责：实现 paired-markdown-derivatives.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

/** The result of separating canonical blocks from paired Chinese derivatives. */
/* 中文说明：interface MarkdownDerivativePartition 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface MarkdownDerivativePartition<T> {
  /** Blocks that still require the caller's owning check. */
  primary: T[]
  /** Chinese blocks covered by the byte-identical unsuffixed sequence. */
  derivatives: T[]
}

/** Return the unsuffixed sibling of a Chinese Markdown path. */
/* 中文说明：函数 unsuffixedSibling 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function unsuffixedSibling(doc: string): string | null {
  return doc.endsWith('.zh.md') ? `${doc.slice(0, -'.zh.md'.length)}.md` : null
}

/**
 * Partition complete byte-identical `.zh.md` block sequences from primary
 * blocks. A partial or reordered match stays primary so the caller fails
 * closed; the translation-pairing gate reports the cross-language mismatch.
 *
 * @param blocks - Blocks in repository scan order.
 * @param docOf - Repository-relative Markdown path owning a block.
 * @param fingerprintOf - Block kind/info string plus byte-exact body.
 * @returns Primary blocks and paired Chinese derivatives, preserving order.
 */
/* 中文说明：函数 partitionPairedMarkdownDerivatives 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function partitionPairedMarkdownDerivatives<T>(
  blocks: readonly T[],
  docOf: (block: T) => string,
  fingerprintOf: (block: T) => string,
): MarkdownDerivativePartition<T> {
  /** 中文说明：变量 byDoc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const byDoc = new Map<string, T[]>()
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const block of blocks) {
    /** 中文说明：变量 doc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const doc = docOf(block)
    /** 中文说明：变量 group 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const group = byDoc.get(doc)
    if (group) group.push(block)
    else byDoc.set(doc, [block])
  }

  /** 中文说明：变量 derivativeDocs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const derivativeDocs = new Set<string>()
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const [doc, candidates] of byDoc) {
    /** 中文说明：变量 sibling 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sibling = unsuffixedSibling(doc)
    if (sibling === null) continue
    /** 中文说明：变量 originals 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const originals = byDoc.get(sibling)
    if (originals === undefined || originals.length !== candidates.length) continue
    if (candidates.every((candidate, index) => {
      /** 中文说明：变量 original 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const original = originals[index]
      return original !== undefined && fingerprintOf(candidate) === fingerprintOf(original)
    })) {
      derivativeDocs.add(doc)
    }
  }

  /** 中文说明：变量 primary 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const primary: T[] = []
  /** 中文说明：变量 derivatives 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const derivatives: T[] = []
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const block of blocks) {
    (derivativeDocs.has(docOf(block)) ? derivatives : primary).push(block)
  }
  return { primary, derivatives }
}
