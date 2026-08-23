/**
 * ================================ 文件注释 ================================
 * 【文件职责】工作区指令内容标识（content identity）：为指令文本计算摘要，
 *             用于指令加载与会话状态中的重复抑制（duplicate suppression）。
 * 【技术维度】node:crypto 的 SHA-1；两个摘要函数分别用于"精确匹配"与
 *             "空白不敏感匹配"两种去重语义。
 * 【产品维度】同一目录下可能有 AGENTS.md 与 CLAUDE.md（或软链/字节复制的
 *             孪生文件）内容几乎相同：摘要让它们折叠成一次渲染，避免
 *             系统提示词里出现重复指令。
 * 【逻辑维度】1) instructionContentSha1：精确内容摘要；2)
 *             trimmedInstructionDigest：去首尾空白后的摘要（空白不敏感）。
 * 【关键边界】SHA-1 仅用于去重标识、不做安全用途；trim 只去首尾空白，
 *             内部空白差异仍视为不同内容。
 * 【新手阅读建议】先记两个摘要函数的语义差异，再看 config.ts 中如何使用。
 * ==========================================================================
 */

/**
 * Content identity for workspace instruction duplicate suppression.
 *
 * @module @deepseek-ai/dsh-agent-instructions/digest
 */

import { createHash } from 'node:crypto'

/**
 * Compute the content identity used across instruction loading and session state.
 * @param content - exact UTF-8 instruction text.
 * @returns lowercase SHA-1 digest in hexadecimal form.
 */
/**
 * 计算指令加载与会话状态共用的内容标识：精确内容的 SHA-1 摘要。
 * @param content 精确的 UTF-8 指令文本
 * @returns 十六进制小写形式的 SHA-1 摘要
 */
export function instructionContentSha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

/**
 * Compute the whitespace-insensitive identity used for per-directory duplicate
 * suppression. Leading and trailing whitespace is trimmed before hashing so a
 * symlinked or byte-copied sibling that differs only by surrounding whitespace
 * still collapses to a single rendered file.
 * @param content - exact UTF-8 instruction text.
 * @returns SHA-1 digest of the trimmed content.
 */
/**
 * 计算用于每目录重复抑制的空白不敏感标识：哈希前去掉首尾空白，
 * 使仅周边空白不同的软链/字节复制孪生文件仍折叠为单次渲染。
 * @param content 精确的 UTF-8 指令文本
 * @returns 裁剪后内容的 SHA-1 摘要
 */
export function trimmedInstructionDigest(content: string): string {
  return instructionContentSha1(content.trim())
}
