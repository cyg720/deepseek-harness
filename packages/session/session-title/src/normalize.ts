/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话标题文本的归一化与 UTF-8 安全截断：清洗控制序列、单行化、
 *   按字节预算截断（不切开码点）、确定性首条消息回退标题。
 * 【技术维度】五类控制/装饰序列正则剔除 + 空白折叠；逐码点累计 UTF-8 字节截断。
 * 【产品维度】保证终端安全的单行标题，且回退标题在预算内确定可复现。
 * 【逻辑维度】正则常量 → assertPositiveInteger → cleanTitleText → truncateTitleUtf8 →
 *   normalizeSessionTitle → fallbackSessionTitle。
 * 【关键边界】maxBytes/maxWords 必须是正整数；清洗后可能为空串（上层拒绝）。
 * 【新手阅读建议】先读 cleanTitleText 的清洗链，再看 truncateTitleUtf8 的码点截断。
 * ==========================================================================
 */

/** Title text normalization and UTF-8-safe truncation. */

/** Operating-system-command escape sequences, including unterminated tails. */
// 中文：五类需要从标题文本中剔除的控制/装饰序列：操作系统命令转义（含未终止尾巴）、
// CSI 转义（如 SGR 颜色码）、其余两字节 ESC 序列、非空白 C0/C1 控制字符、
// 以及可让显示标题产生误导的方向性/不可见控制符。
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu
/** Control-sequence-introducer escapes such as SGR color codes. */
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
/** Remaining two-byte ESC control sequences. */
const ESC_SEQUENCE = /\u001B[@-_]/gu
/** Non-whitespace C0/C1 control characters. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
/** Directional and invisible controls that can make a displayed title deceptive. */
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu

/** Reject an invalid public text limit. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

/** Remove controls and produce one trimmed, whitespace-normalized line. */
// 中文：剔除控制序列并产出"单行、空白归一、去首尾空格"的干净文本。
function cleanTitleText(input: string): string {
  return input
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Truncate a string to a UTF-8 byte budget without splitting a Unicode code point.
 * @param input - normalized title text.
 * @param maxBytes - positive UTF-8 byte budget.
 * @returns the longest leading code-point prefix within the budget.
 */
// 中文：按 UTF-8 字节预算截断且不切开任何 Unicode 码点：逐码点累加字节数，超预算即停。
export function truncateTitleUtf8(input: string, maxBytes: number): string {
  assertPositiveInteger('maxBytes', maxBytes)
  if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input
  let used = 0
  let output = ''
  for (const character of input) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

/**
 * Normalize one accepted session title and enforce its UTF-8 byte budget.
 * @param input - untrusted title text.
 * @param maxBytes - positive maximum encoded size.
 * @returns a terminal-safe one-line title, possibly empty after sanitization.
 */
// 中文：归一化一个被接受的会话标题并强制 UTF-8 字节预算：清洗 → 截断 → 去尾空格。
export function normalizeSessionTitle(input: string, maxBytes: number): string {
  return truncateTitleUtf8(cleanTitleText(input), maxBytes).trimEnd()
}

/**
 * Derive the deterministic first-prompt fallback.
 * @param input - text from the first eligible human message.
 * @param maxWords - positive whitespace-delimited word cap.
 * @param maxBytes - positive UTF-8 byte cap.
 * @returns the normalized leading words within both limits.
 */
export function fallbackSessionTitle(input: string, maxWords: number, maxBytes: number): string {
  assertPositiveInteger('maxWords', maxWords)
  const words = cleanTitleText(input).split(' ').filter(Boolean).slice(0, maxWords)
  return truncateTitleUtf8(words.join(' '), maxBytes).trimEnd()
}
