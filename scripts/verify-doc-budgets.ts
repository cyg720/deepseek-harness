/**
 * Enforce `wc -w`-style ceilings from `scripts/doc-budgets.manifest.json`.
 * Missing files and invalid ceilings fail; `--list` reports current usage.
 * Only listed standing docs are budgeted. Ceilings ratchet down with at least
 * 5% headroom; raising one requires the justification defined in
 * `docs/AGENTS.md`.
 */
/**
 * 文件职责：依据文档预算清单检查长期维护文档的词数上限，并提供当前用量列表。
 * 技术维度：使用 Node.js 文件系统、路径解析和命令行参数完成同步静态校验。
 * 产品维度：限制文档持续膨胀，使读者更容易找到重点并维持可维护的知识结构。
 * 逻辑维度：读取清单，逐项验证预算与文件，统计词数，最后输出列表或聚合失败信息。
 * 关键边界：词数采用空白分隔近似 wc -w；只检查清单列出的文档，预算必须为正整数。
 * 新手阅读建议：先看 countWords 的计数口径，再沿 manifest 循环理解三类失败条件。
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** 仓库根目录，所有清单路径都相对于此目录解析。 */
const root = resolve(import.meta.dirname, '..')

/** 文档预算清单的绝对路径。 */
const MANIFEST_PATH = resolve(root, 'scripts/doc-budgets.manifest.json')

/** `wc -w` equivalent: count whitespace-delimited tokens. */
/**
 * 按空白分隔统计文本中的非空词元，近似 wc -w。
 * @param text 待统计的完整文本。
 * @returns 非空白词元数量。
 * @example `countWords('one two') // 2`
 */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** 清单中的文档相对路径及其最大允许词数。 */
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, number>

/** 是否只打印当前预算用量而不执行超限失败。 */
const listOnly = process.argv.includes('--list')
/** 所有应导致进程失败的诊断信息。 */
const failures: string[] = []
/** 每个清单条目的可读用量行。 */
const rows: string[] = []

/** 逐项检查文档路径和对应的词数上限。 */
for (const [path, ceiling] of Object.entries(manifest)) {
  if (!Number.isInteger(ceiling) || ceiling <= 0) {
    rows.push(`BAD   ${'—'.padStart(6)} / ${String(ceiling).padEnd(6)} ${path}`)
    failures.push(`${path}: ceiling must be a positive integer, got ${ceiling}`)
    continue
  }
  /** 当前文档相对于仓库根目录解析出的绝对路径。 */
  const abs = resolve(root, path)
  if (!existsSync(abs)) {
    rows.push(`MISS  ${'—'.padStart(6)} / ${String(ceiling).padEnd(6)} ${path}`)
    failures.push(`${path}: budgeted file does not exist (renamed or deleted? update scripts/doc-budgets.manifest.json in the same change)`)
    continue
  }
  /** 当前文档按空白分隔统计出的词数。 */
  const words = countWords(readFileSync(abs, 'utf8'))
  rows.push(`${words <= ceiling ? 'ok  ' : 'OVER'}  ${String(words).padStart(6)} / ${String(ceiling).padEnd(6)} ${path}`)
  if (words > ceiling) {
    failures.push(`${path}: ${words} words exceeds the ${ceiling}-word ceiling — relocate or condense per docs/AGENTS.md (raising the ceiling requires justification in the PR)`)
  }
}

/** 列表模式用于观察用量，不因已有超限记录退出失败。 */
if (listOnly) {
  console.log(rows.join('\n'))
  process.exit(0)
}

/** 普通模式聚合报告全部问题，便于一次修正多个文档。 */
if (failures.length > 0) {
  console.error('verify-doc-budgets failed:\n')
  for (const failure of failures) console.error(`  ${failure}`)
  console.error('\nSee docs/AGENTS.md for the documentation standard and the relocation-first rule.')
  process.exit(1)
}

/** 所有清单项均有效且未超限时输出成功摘要。 */
console.log(`verify-doc-budgets: ${Object.keys(manifest).length} budgeted docs within ceiling.`)
