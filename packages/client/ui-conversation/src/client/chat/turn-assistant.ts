/**
 * ================================ 文件注释 ================================
 * 【文件职责】从一次 Assistant 生命周期中收集可见正文文本。
 * 【技术维度】纯函数：把 assistant 内容块里的 text 块拼成一个字符串。
 * 【产品维度】消息行上"纯文本"的选中复制、摘要等场景需要不带其它块的正文。
 * 【逻辑维度】单函数实现。
 * 【关键边界】只取 kind === 'text' 的块，推理 / 工具调用块不计入。
 * 【新手阅读建议】一行函数，无需深究。
 * ==========================================================================
 */
import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Collect visible prose from one Assistant lifecycle.
 * @param blocks - Assistant content blocks.
 * @returns concatenated text blocks.
 */
/*
 * 从一次 Assistant 生命周期收集可见正文。
 * @param blocks - assistant 内容块。
 * @returns 拼接后的文本块。
 */
export function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('')
}
