import type { AssistantBlock } from '../contract/snapshot.ts'

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
