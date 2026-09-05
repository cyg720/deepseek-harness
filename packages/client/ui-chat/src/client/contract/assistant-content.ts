/*
 * 【文件职责】判断助手块是否包含面向用户的回复内容，区分正文、推理和工具调用协议材料。
 */

import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Test whether Assistant blocks contain a user-facing reply rather than only
 * reasoning or Tool-call protocol material.
 * @param blocks - Assistant content blocks.
 * @returns whether the blocks contain visible reply content.
 * @remarks 中文说明：功能说明：判断是否包含 Assistant Reply Content 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：blocks（readonly AssistantBlock[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * hasAssistantReplyContent(blocks)，并按返回类型处理结果。
 */
export function hasAssistantReplyContent(blocks: readonly AssistantBlock[]): boolean {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  return blocks.some((block) => {
    if (block.kind === 'reasoning' || block.kind === 'tool-call') return false
    if (block.kind === 'text') return block.text.trim() !== ''
    return true
  })
}
