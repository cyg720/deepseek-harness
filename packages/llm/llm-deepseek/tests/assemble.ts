/**
 * Test helper: drive `ctx.llm.stream()` through a `BlockAssembler` and return
 * the assembled message + usage + finish reason. This exercises the same
 * streaming path production uses (the loop), rather than a service-level
 * one-shot convenience method.
 */
/**
 * 文件职责：把 DeepSeek 官方提供者的流式片段装配成测试可断言的完整结果。
 * 技术维度：使用异步迭代、BlockAssembler 和共享 LLM 类型复现生产代理循环的流处理。
 * 产品维度：让官方提供者测试统一检查消息、令牌用量、结束原因和可选重放状态。
 * 逻辑维度：创建装配器与默认请求，依次消费片段，再生成模型消息和存在的元数据。
 * 关键边界：默认 provider 为 deepseek-official 但允许覆盖；不存在的可选字段不得伪造。
 * 新手阅读建议：先认识返回接口，再沿 request、stream、push 和 assembler.message 顺序阅读。
 */

import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { FinishReason, GenerateOptions, Message, TokenUsage } from '@deepseek-ai/dsh-llm'

/** 流式请求装配后的测试结果。 */
export interface AssembledResult {
  // 所有流片段组成的完整模型消息。
  message: Message
  // 提供者报告的可选令牌用量；未报告时字段缺失。
  usage?: TokenUsage
  // 流结束原因；由最后的协议片段确定。
  finish: FinishReason
}

/**
 * 消费一次官方提供者 LLM 流并装配结果。
 * @param ctx 提供 llm.stream 的 Cordis 上下文。
 * @param options 生成选项，可选 provider 会覆盖默认值。
 * @returns 完整消息、可选用量和结束原因。
 * @example await assemble(ctx, { model: 'deepseek-chat', messages: [] })。
 */
export async function assemble(ctx: Context, options: Omit<GenerateOptions, 'provider'> & { provider?: string }): Promise<AssembledResult> {
  // 流装配器；集中保存内容块和结束元数据。
  const assembler = new BlockAssembler()
  // 实际请求；默认指向 deepseek-official，调用方选项最后展开并可覆盖。
  const request = { provider: 'deepseek-official', ...options }
  // 当前流片段；严格按异步迭代顺序加入装配器。
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
