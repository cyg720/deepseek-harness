/**
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹记录的单行预览文本生成：截断源码后再投影成纯文本，限制输出长度。
 * 【技术维度】复用 ui-primitives 的 extractMarkdownPlainText；源码与输出分别设上限
 *             （2048 与 512 字符），任一层被截断就补省略号。
 * 【产品维度】轨迹列表里每条记录显示紧凑摘要，不因整段 Markdown 而拖慢渲染。
 * 【关键边界】输入是不可信文本（消息 / 推理 / 载荷 / 结果），先截断避免解析超长文档；
 *             只有真的被截断才追加省略号。
 * 【新手阅读建议】注意"先截断再投影"的顺序：先保源码长度，再保输出长度。
 * ==========================================================================
 */
/** Bounded Markdown-to-text projection shared by trajectory consumers. */

import { extractMarkdownPlainText } from '@deepseek-ai/dsh-client-ui-primitives'

// 参与投影的源码上限（字符）：防止解析超长文档。
const PREVIEW_SOURCE_CHARACTERS = 2_048
// 投影输出的上限（字符）：保证列表摘要紧凑。
const PREVIEW_OUTPUT_CHARACTERS = 512

/**
 * Build a bounded one-line preview without parsing the complete Markdown document.
 * @param text - Untrusted message, reasoning, payload, or result text.
 * @returns A compact preview capped independently from the retained source.
 */
/**
 * 生成有界单行预览，不解析完整 Markdown 文档。
 * 使用示例：cell.text = trajectoryPreviewText(rawMarkdown)。
 * @param text - 不可信的消息 / 推理 / 载荷 / 结果文本。
 * @returns 紧凑预览；任一层被截断时以省略号结尾。
 */
export function trajectoryPreviewText(text: string): string {
  const source = text.slice(0, PREVIEW_SOURCE_CHARACTERS)
  const compact = extractMarkdownPlainText(source).replace(/\s+/g, ' ').trim()
  const preview = compact.slice(0, PREVIEW_OUTPUT_CHARACTERS).trimEnd()
  return source.length < text.length || preview.length < compact.length
    ? `${preview}…`
    : preview
}
