/**
 * Test helper: drive `ctx.llm.stream()` through a `BlockAssembler` and return
 * the assembled message + usage + finish reason. This exercises the same
 * streaming path production uses (the loop), rather than a service-level
 * one-shot convenience method.
 */
/*
 * 文件职责：把 Pi AI 提供者的流式片段装配成测试可直接断言的完整结果。
 * 技术维度：使用异步迭代、BlockAssembler 和共享 LLM 消息与用量类型复现生产循环路径。
 * 产品维度：让提供者测试同时验证正文、用量、结束原因和可选重放状态。
 * 逻辑维度：创建装配器和默认请求，消费全部流片段，再从装配器生成消息及元数据。
 * 关键边界：调用方可覆盖默认 provider；usage 和 replayState 仅在实际存在时出现在结果中。
 * 新手阅读建议：先看 AssembledResult 的三个输出，再跟踪 request、chunk、assembler 到 return 的数据流。
 */

import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { FinishReason, GenerateOptions, Message, TokenUsage } from '@deepseek-ai/dsh-llm'

/** 流式请求装配后的测试结果。 */
export interface AssembledResult {
  // 完整模型消息；由所有已接收片段合并得到。
  message: Message
  // 可选令牌用量；提供者未报告时字段缺失。
  usage?: TokenUsage
  // 流最终结束原因；必须由装配器从结束片段确定。
  finish: FinishReason
}

/**
 * 消费一次 LLM 流并返回装配结果。
 * @param ctx 提供 llm.stream 的 Cordis 上下文。
 * @param options 除 provider 外的生成选项，也可显式覆盖默认提供者。
 * @returns 包含消息、可选用量和结束原因的 Promise。
 * @example await assemble(ctx, { model: 'model', messages: [] })。
 */
export async function assemble(ctx: Context, options: Omit<GenerateOptions, 'provider'> & { provider?: string }): Promise<AssembledResult> {
  // 流片段装配器；累计内容、用量、结束原因和可选重放状态。
  const assembler = new BlockAssembler()
  // 实际流请求；默认使用 deepseek，调用方 options 中的 provider 可覆盖它。
  const request = { provider: 'deepseek', ...options }
  // 当前异步流片段；按到达顺序推入同一个装配器。
  for await (const chunk of ctx.llm.stream(request)) assembler.push(chunk)
  return {
    message: assembler.message({
      kind: 'model',
      provider: request.provider,
      model: request.model,
      ...assembler.replayState === undefined ? {} : { replayState: assembler.replayState },
    }),
    ...assembler.usage !== undefined ? { usage: assembler.usage } : {},
    finish: assembler.finish,
  }
}
