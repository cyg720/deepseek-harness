/**
 * Test-only direct-agent turn driver shared by assembled Loader fixtures.
 * @module @deepseek-ai/dsh-loader-smoke/agent-turn
 */
/*
 * 文件职责：实现 agent-turn.ts 覆盖的快照与装载测试支持行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的快照与装载测试支持能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, expandAssistantStream, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Result envelope consumed only by snapshot and composition tests. */
/* 中文说明：interface FixtureTurnResult 定义本模块所需的数据或行为，用于表达快照与装载测试支持场景。 */
export interface FixtureTurnResult {
  readonly type: 'result'
  readonly sessionId: string
  readonly output: string
  readonly usage?: TokenUsage
}

/** Options for one fixture turn against exactly one configured root agent. */
/* 中文说明：interface FixtureTurnOptions 定义本模块所需的数据或行为，用于表达快照与装载测试支持场景。 */
export interface FixtureTurnOptions {
  readonly task: string
  readonly onEvent?: (sessionId: string, event: SessionEvent) => void
}

/** 中文说明：函数 addUsage 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function addUsage(total: TokenUsage | undefined, step: TokenUsage): TokenUsage {
  /** 中文说明：变量 next 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const next: TokenUsage = {
    inputTokens: (total?.inputTokens ?? 0) + step.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + step.outputTokens,
  }
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    if (total?.[key] !== undefined || step[key] !== undefined) next[key] = (total?.[key] ?? 0) + (step[key] ?? 0)
  }
  return next
}

/** 中文说明：函数 assistantText 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function assistantText(event: Extract<SessionEvent, { type: 'assistant/message' }>): string | undefined {
  /** 中文说明：函数值 blocks 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const blocks = event.data.message.content.filter(block => block.type === 'text')
  return blocks.length === 0 ? undefined : blocks.map(block => block.text).join('')
}

async function onlyRootAgent(ctx: Context): Promise<Agent> {
  const registry = ctx.get('agents')
  if (registry === undefined) throw new Error('fixture turn requires exactly one top-level agent, found 0')
  // Configured agents publish asynchronously (persistence create/resume runs
  // before publication), so a settled Loader does not imply a registered
  // agent yet; wait for the first publication instead of requiring it.
  if (registry.roots().length === 0) {
    await new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/created', () => {
        dispose()
        resolve()
      })
    })
  }
  const agents = registry.roots()
  const [agent] = agents
  if (agent === undefined || agents.length !== 1) {
    throw new Error(`fixture turn requires exactly one top-level agent, found ${agents.length}`)
  }
  return agent
}

/**
 * Drive one task from its durable inbox receipt through whole-agent idle.
 * @param ctx - settled Loader context with exactly one configured root agent.
 * @param options - task and optional canonical-event observer.
 * @returns the final assistant text and accumulated model usage.
 */
/*
 * 中文说明：函数 runFixtureTurn 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param ctx 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function runFixtureTurn(ctx: Context, options: FixtureTurnOptions): Promise<FixtureTurnResult> {
  const agent = await onlyRootAgent(ctx)
  await agent.whenIdle()

  /** 中文说明：变量 message 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const message = createUserMessage({
    content: [{ type: 'text', text: options.task }],
    source: { kind: 'user' },
  })
  /** 中文说明：变量 received 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let received = false
  /** 中文说明：变量 output 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let output = ''
  /** 中文说明：变量 usageByStep 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const usageByStep = new Map<string, TokenUsage>()
  /** 中文说明：函数值 disposeListener 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const disposeListener = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (!received) {
      if (event.type !== 'agent/inbox/spliced'
        || !event.data.inserted.some(inserted => inserted.id === message.id)) return
      received = true
    }
    options.onEvent?.(session.id, event)
    if (event.type === 'assistant/message') {
      output = assistantText(event) ?? output
      if (event.data.usage !== undefined) {
        usageByStep.set(`${event.data.turn}/${event.data.step}`, event.data.usage)
      }
    } else if (event.type === 'assistant/attempt') {
      const usage = expandAssistantStream(event.data.stream)
        .findLast(member => member.chunk.type === 'usage')?.chunk
      if (usage?.type === 'usage') {
        usageByStep.set(`${event.data.turn}/${event.data.step}`, usage.usage)
      }
    }
  })

  try {
    agent.followup(message)
    await agent.whenIdle()
  } finally {
    disposeListener()
  }
  await ctx.sessions.flush(agent.session)
  /** 中文说明：变量 usage 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const usage = [...usageByStep.values()].reduce<TokenUsage | undefined>(addUsage, undefined)
  return {
    type: 'result',
    sessionId: agent.session.id,
    output,
    ...usage === undefined ? {} : { usage },
  }
}
