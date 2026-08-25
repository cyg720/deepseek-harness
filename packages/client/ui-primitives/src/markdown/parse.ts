/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义 markdown 渲染器两套 mdast 语法（grammar）：parseGfm 供流式增量渲染
 *             使用（不含数学公式，避免不完整的 TeX 在流式阶段闪烁 KaTeX 错误）；
 *             parseGfmWithMath 供"已定格"的完整渲染使用（追加 TeX 数学兼容扩展）。
 * 【技术维度】基于 unified 生态的 mdast-util-from-markdown + micromark 扩展
 *             （gfm、cjkFriendlyStrong、mathCompatibility、math）。
 * 【产品维度】AI 回复流式输出时按段落逐渐出现；数学公式只在内容完整后解析渲染，
 *             用户不会看到半截公式的报错闪烁。
 * 【逻辑维度】1) parseGfm：仅 GFM + CJK 加粗；2) parseGfmWithMath：再加 TeX 定界符
 *             兼容与标准 math 扩展，并把 math mdast 节点转换接入。
 * 【关键边界】两臂的差异只在于 TeX 定界符是否开启 $$ 块：流式时 $$ 是段落，
 *             定格后变成数学块（有意为之）；两臂内部对块边界的判断必须一致。
 * 【新手阅读建议】先理解"为什么有两套语法"（流式 vs 定格），再看两个函数各引了哪些扩展。
 * ==========================================================================
 */
/**
 * The markdown renderer's two mdast grammars, one per rendering arm. Each
 * arm is internally consistent — the incremental tail parses, the one-shot
 * parses, and the plain-text projection of a given grammar always agree on
 * where blocks start and end — and the settled grammar is the streaming one
 * plus the math extensions, so the arms differ only where TeX delimiters
 * begin a math construct (a `$$` block is a paragraph while streaming and a
 * math block once settled, by design).
 */

import type { Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { cjkFriendlyStrong } from './cjkFriendlyStrong.ts'
import { mathCompatibility } from './mathCompatibility.ts'

/**
 * Parse GFM markdown (the streaming arm's grammar: no math, so incomplete
 * TeX never flashes KaTeX errors mid-stream).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
/*
 * 解析 GFM markdown（流式臂语法：不含数学，未完成的 TeX 不会在流中触发 KaTeX 报错）。
 * 使用示例：const root = parseGfm(chunkText)；供增量解析器与纯文本投影共用。
 * @param text - Markdown 源码。
 * @returns mdast 根节点。
 */
export function parseGfm(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

/**
 * Parse GFM markdown plus TeX math with the compatibility delimiters
 * (the settled arm's grammar).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
/*
 * 解析"GFM + TeX 数学 + 兼容定界符"（定格臂语法，定界符细节见 mathCompatibility.ts）。
 * @param text - Markdown 源码。
 * @returns mdast 根节点。
 */
export function parseGfmWithMath(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong(), mathCompatibility(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
}
