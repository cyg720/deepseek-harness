/*
 * ================================ 文件注释 ================================
 * 【文件职责】触发器检测的纯核心：从光标处向左扫描，在当前守卫等级下判定是否存在
 *             存活的触发字符，并应用词边界规则。
 * 【技术维度】零 React / DOM / Cordis；'@' 复用共享文件引用语法（支持带引号含空格的
 *             打开 token），'/' 接受标点边界并做 URL 豁免。
 * 【产品维度】输入框里敲 / 或 @ 时能否唤起菜单，以及唤起的查询词与位置判定。
 * 【逻辑维度】先走 '@' 的共享语法检测（activeAtToken）；未命中再向左扫描 '/'，
 *             逐字符做词边界判定（含 URL 豁免）。
 * 【关键边界】user@host 与 URL 中的 '/' 不触发；guard 等级（plain/claimed/frozen）
 *             决定哪些字符存活。
 * 【新手阅读建议】先看 boundaryOk 的边界规则，再看 detectTrigger 的双路径扫描。
 * ==========================================================================
 */
/**
 * Trigger detection pure core. Scans backward from
 * the caret for a live trigger char under the guard tier and applies the
 * word-boundary rules. Zero React / DOM / cordis.
 */
import { activeAtToken } from '@deepseek-ai/dsh-file-reference/grammar'
import type { TriggerChar } from '../types.ts'
import type { DetectTrigger } from './contract.ts'

const WORD_CHAR = /[\p{L}\p{N}_]/u
const WHITESPACE = /\s/u

/**
 * Word-boundary rule: a trigger char opens only at start-of-draft, after
 * whitespace (newlines included), or after punctuation. Two URL carve-outs
 * keep '/' dead inside URLs (both pinned by tests): '/' after a ':' that
 * itself follows a non-whitespace char (scheme separator, `https:/…`), and
 * '/' directly after another '/' (second slash of `//`).
 */
// 词边界规则：触发字符只在草稿开头、空白（含换行）后或标点后生效；
// 两个 URL 豁免让 '/' 在 URL 内不触发（方案分隔符 ':' 之后、以及 '//' 的第二个斜杠）。
function boundaryOk(draft: string, index: number, char: TriggerChar): boolean {
  if (index === 0) return true
  const prev = draft.charAt(index - 1)
  if (WHITESPACE.test(prev)) return true
  if (WORD_CHAR.test(prev)) return false
  if (char === '/') {
    if (prev === '/') return false
    if (prev === ':' && index >= 2 && !WHITESPACE.test(draft.charAt(index - 2))) return false
  }
  return true
}

/**
 * Detect a trigger token at the caret. `@` first uses the shared grammar,
 * including an open quoted token that may span whitespace. Slash detection
 * scans left to the first whitespace; slashes failing the word boundary are
 * treated as ordinary token chars and the scan continues (URL slashes).
 * Guard tiers: plain = both chars live; claimed = '/' fully suppressed,
 * '@' live; frozen = none.
 *
 * @param draft - Full draft text.
 * @param caret - Caret offset into `draft`.
 * @param guard - Availability tier derived from the input phase.
 * @returns The hit with `query` = trigger-to-caret slice and `span` =
 * `{start: triggerIndex, end: caret}`; `span.draftRev` is a placeholder `0`
 * — the calling shell stamps the real revision. Null when no trigger is
 * live at the caret.
 */
export const detectTrigger: DetectTrigger = (draft, caret, guard) => {
  if (guard.tier === 'frozen') return null
  const at = activeAtToken(draft, caret)
  if (at !== undefined) {
    const start = caret - at.prefix.length
    return {
      trigger: '@',
      query: at.query,
      quoted: at.quoted,
      position: draft.search(/\S/) === start ? 'leading' : 'inline',
      span: { start, end: caret, draftRev: 0 },
    }
  }
  for (let i = caret - 1; i >= 0; i--) {
    const ch = draft.charAt(i)
    if (WHITESPACE.test(ch)) return null
    if (ch !== '/') continue
    if (guard.tier === 'claimed') continue
    if (!boundaryOk(draft, i, ch)) continue
    return {
      trigger: ch,
      query: draft.slice(i + 1, caret),
      quoted: false,
      position: draft.search(/\S/) === i ? 'leading' : 'inline',
      span: { start: i, end: caret, draftRev: 0 },
    }
  }
  return null
}
