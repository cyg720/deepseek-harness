/**
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹目标下"assistant 步骤生命周期"状态机：累积流式块（文本 / 推理 / 工具
 *             调用 / 用量），在步骤结束时产出最终 assistant 节点与请求（含 TTFT、用量、
 *             重试信息），并处理中断与回合结束事件。
 * 【技术维度】ConversationNodeDefinition 状态机（match / start / update / publication /
 *             buildViewNode）；按 chunk 类型增量更新块数组；publication 控制流式发布
 *             频率（usage/finish 不发布、其余按 animation-frame）。
 * 【产品维度】轨迹中每条 assistant 回复展示流式内容、首 token 时间、token 用量与
 *             重试 / 中断状态。
 * 【逻辑维度】1) 状态与工具接口；2) updateChunk 按块类型累积；3) closedBoundary /
 *             fallbackState / finalNode / assistantRequest 组装；4) 状态机定义；
 *             5) 回合结束状态机；6) 注册函数。
 * 【关键边界】块数组按 chunk.index 定位；firstVisibleSeq / firstTokenTime 只记首次；
 *             llm/retry 会重置状态但保留首 token 时间与用量。
 * 【新手阅读建议】先看 updateChunk 对五种 chunk 的处理，再看 finalNode 的两种收尾路径。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  AssistantBlock, AssistantMessageNode, ConversationLocation, ConversationMatch,
  ConversationNodeContext, ConversationNodeDefinition, PartialAssistant, RequestView,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  displayFailureMessage, emptyAssistantBlock, isTokenDelta, toAssistantBlock,
  toAssistantBlocks,
} from '@deepseek-ai/dsh-client-runtime/client'
import { trajectoryNode } from './trajectory-definition-common.ts'

/* jscpd:ignore-start -- Target-owned Definitions intentionally keep their event
 * state machines independent; see ../../../../../.agents/notes/implemented/
 * architecture/2026-08-09-client-conversation-node-assembly.md. */
// token 用量（可选字段缺省为 0 处理）。
interface UsageValue {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}

// LLM 重试信息：失败消息、重试次数、上限与延迟。
interface RetryValue {
  readonly message: string
  readonly retry: number
  readonly maxRetries?: number
  readonly delayMs: number
}

// assistant 步骤状态：回合 / 步骤 / 起止时间、块数组、可见内容与首 token 时机、最终匹配、
// 用量与重试、步骤结束匹配。
interface AssistantState {
  readonly turn: number
  readonly step: number
  readonly startSeq: number
  readonly startTime: number
  readonly started: boolean
  readonly sawChunk: boolean
  readonly blocks: readonly (AssistantBlock | undefined)[]
  readonly firstVisibleSeq: number | undefined
  readonly firstVisibleTime: number | undefined
  readonly firstTokenTime: number | undefined
  readonly final: ConversationMatch | undefined
  readonly usage: UsageValue | undefined
  readonly retry: RetryValue | undefined
  readonly stepEnd: ConversationMatch | undefined
}

// 初始状态工厂：全部计时与累积字段归零。
function initialState(
  turn: number,
  step: number,
  startSeq: number,
  startTime: number,
  started: boolean,
): AssistantState {
  return {
    turn,
    step,
    startSeq,
    startTime,
    started,
    sawChunk: false,
    blocks: [],
    firstVisibleSeq: undefined,
    firstVisibleTime: undefined,
    firstTokenTime: undefined,
    final: undefined,
    usage: undefined,
    retry: undefined,
    stepEnd: undefined,
  }
}

function compactBlocks(blocks: readonly (AssistantBlock | undefined)[]): AssistantBlock[] {
  return blocks.filter((block): block is AssistantBlock => block !== undefined)
}

function hasVisibleContent(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'tool-call') return false
    if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
    return true
  })
}

function hasInterruptionEvidence(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
    return true
  })
}

function addUsage(current: UsageValue | undefined, next: UsageValue): UsageValue {
  return {
    inputTokens: (current?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + next.outputTokens,
    ...(current?.cacheReadTokens === undefined && next.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: (current?.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0) }),
    ...(current?.cacheWriteTokens === undefined && next.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: (current?.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0) }),
    ...(current?.reasoningTokens === undefined && next.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: (current?.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0) }),
  }
}

function updateChunk(state: AssistantState, match: ConversationMatch): AssistantState {
  if (match.event.type !== 'assistant/chunk') return state
  const chunk = match.event.data.chunk
  if (chunk.type === 'usage') {
    return { ...state, sawChunk: true, usage: addUsage(state.usage, chunk.usage) }
  }
  const blocks = [...state.blocks]
  switch (chunk.type) {
    case 'block-start':
      blocks[chunk.index] = emptyAssistantBlock(chunk.blockType)
      break
    case 'text-delta': {
      const previous = blocks[chunk.index]
      blocks[chunk.index] = {
        kind: 'text',
        text: (previous?.kind === 'text' ? previous.text : '') + chunk.text,
      }
      break
    }
    case 'reasoning-delta': {
      const previous = blocks[chunk.index]
      blocks[chunk.index] = {
        kind: 'reasoning',
        text: (previous?.kind === 'reasoning' ? previous.text : '') + chunk.text,
      }
      break
    }
    case 'tool-call-delta': {
      const previous = blocks[chunk.index]
      const base = previous?.kind === 'tool-call'
        ? previous
        : { kind: 'tool-call' as const, callId: '', name: '', argsRaw: '' }
      blocks[chunk.index] = {
        kind: 'tool-call',
        callId: base.callId || String(chunk.id),
        name: chunk.name ?? base.name,
        argsRaw: base.argsRaw + chunk.argumentsDelta,
      }
      break
    }
    case 'block-end':
      blocks[chunk.index] = toAssistantBlock(chunk.block)
      break
    default:
      return { ...state, sawChunk: true }
  }
  const visible = hasVisibleContent(compactBlocks(blocks))
  return {
    ...state,
    sawChunk: true,
    blocks,
    ...(visible && state.firstVisibleSeq === undefined
      ? { firstVisibleSeq: match.event.seq, firstVisibleTime: match.event.time }
      : {}),
    ...(isTokenDelta(chunk) && state.firstTokenTime === undefined
      ? { firstTokenTime: match.event.time }
      : {}),
  }
}

function closedBoundary(
  context: ConversationNodeContext<AssistantState>,
): { seq: number; time: number } | undefined {
  if (context.state?.stepEnd?.event.type === 'step/end') return context.state.stepEnd.event
  const location: ConversationLocation | undefined = context.start?.location
    ?? context.matches.at(-1)?.location
  if (location?.kind === 'step' && location.step.status === 'closed') return location.step.end
  if ((location?.kind === 'step' || location?.kind === 'turn')
    && location.turn.status === 'closed') return location.turn.end
  return undefined
}

function fallbackState(context: ConversationNodeContext<AssistantState>): AssistantState | undefined {
  let state: AssistantState | undefined
  for (const match of context.matches) {
    const event = match.event
    if (event.type === 'assistant/chunk') {
      state ??= initialState(event.data.turn, event.data.step, event.seq, event.time, false)
      state = updateChunk(state, match)
    } else if (event.type === 'assistant/message') {
      state ??= initialState(event.data.turn, event.data.step, event.seq, event.time, false)
      state = {
        ...state,
        blocks: toAssistantBlocks(event.data.message.content),
        final: match,
        usage: state.usage ?? event.data.usage,
      }
    } else if (event.type === 'step/end' && state !== undefined) {
      state = { ...state, stepEnd: match }
    }
  }
  return state
}

/** 组装最终 assistant 节点：有 assistant/message 则用其内容；否则若步骤/回合已闭合且
 *  有中断证据，合成"被打断"节点（seq 取边界前 0.9 以排到边界之前）。 */
function finalNode(
  state: AssistantState,
  context: ConversationNodeContext<AssistantState>,
): AssistantMessageNode | undefined {
  const final = state.final
  if (final?.event.type === 'assistant/message') {
    const event = final.event
    return {
      kind: 'assistant',
      seq: event.seq,
      messageId: event.data.message.id,
      time: event.time,
      turn: state.turn,
      step: state.step,
      blocks: toAssistantBlocks(event.data.message.content),
      usage: event.data.usage,
      provenance: {
        provider: event.data.message.source.provider,
        model: event.data.message.source.model,
      },
      timing: {
        stepStartTime: state.started ? state.startTime : null,
        firstTokenTime: state.firstTokenTime ?? null,
        completedTime: event.time,
      },
      ...(event.data.interrupted === true ? { interrupted: true } : {}),
    }
  }
  const boundary = closedBoundary(context)
  const blocks = compactBlocks(state.blocks)
  if (boundary === undefined || !hasInterruptionEvidence(blocks)) return undefined
  return {
    kind: 'assistant',
    seq: boundary.seq - 0.9,
    time: boundary.time,
    turn: state.turn,
    step: state.step,
    blocks,
    interrupted: true,
  }
}

function assistantRequest(
  state: AssistantState,
  node: AssistantMessageNode | undefined,
  boundary: { seq: number; time: number } | undefined,
): Extract<RequestView, { purpose: 'assistant' }> | undefined {
  if (!state.started) return undefined
  const status = node !== undefined && node.interrupted !== true
    ? 'complete'
    : state.retry !== undefined || boundary !== undefined ? 'error' : 'running'
  return {
    purpose: 'assistant',
    startSeq: state.startSeq,
    turn: state.turn,
    step: state.step,
    startedAt: state.startTime,
    completedAt: node?.time ?? boundary?.time ?? null,
    status,
    ...(state.retry === undefined
      ? {}
      : {
        error: state.retry.message,
        retry: state.retry.retry,
        ...(state.retry.maxRetries === undefined ? {} : { maxRetries: state.retry.maxRetries }),
        retryDelayMs: state.retry.delayMs,
      }),
    ...(node?.messageId === undefined
      ? {}
      : {
        resultSeq: node.seq,
        ...(node.provenance === undefined ? {} : { provenance: node.provenance }),
      }),
    ...(state.usage === undefined ? {} : { usage: state.usage }),
  }
}

/** Trajectory-owned Assistant streaming, settlement, and request lifecycle. */
/* 轨迹拥有的 assistant 流式 / 定格 / 请求生命周期状态机。 */
const trajectoryAssistantDefinition: ConversationNodeDefinition<AssistantState> = {
  kind: 'trajectory-assistant-step',
  target: 'trajectory',
  match: (event) => {
    if (event.type === 'step/start') {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
    }
    if (event.type === 'assistant/chunk'
      || event.type === 'assistant/message'
      || event.type === 'llm/retry'
      || event.type === 'step/end') {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'step/start') {
      throw new Error('trajectory-assistant-step start requires step/start')
    }
    return initialState(
      match.event.data.turn,
      match.event.data.step,
      match.event.seq,
      match.event.time,
      true,
    )
  },
  update: (context, match) => {
    if (match.event.type === 'assistant/chunk') return updateChunk(context.state, match)
    if (match.event.type === 'assistant/message') {
      return {
        ...context.state,
        blocks: toAssistantBlocks(match.event.data.message.content),
        final: match,
        usage: context.state.usage ?? match.event.data.usage,
      }
    }
    if (match.event.type === 'step/end') return { ...context.state, stepEnd: match }
    if (match.event.type !== 'llm/retry') return context.state
    const data = match.event.data
    return {
      ...initialState(
        context.state.turn,
        context.state.step,
        context.state.startSeq,
        context.state.startTime,
        true,
      ),
      firstTokenTime: context.state.firstTokenTime,
      usage: context.state.usage,
      retry: {
        message: displayFailureMessage(data.failure),
        retry: data.retry,
        ...(data.mode === 'normal' ? { maxRetries: data.maxRetries } : {}),
        delayMs: data.delayMs,
      },
    }
  },
  publication: (match) => {
    if (match.event.type === 'step/start') return 'none'
    if (match.event.type !== 'assistant/chunk') return 'immediate'
    const type = match.event.data.chunk.type
    return type === 'usage' || type === 'finish' ? 'none' : 'animation-frame'
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context)
    if (state === undefined) return null
    const node = finalNode(state, context)
    const boundary = closedBoundary(context)
    const partial: PartialAssistant | null = node === undefined && boundary === undefined && state.sawChunk
      ? { turn: state.turn, step: state.step, blocks: compactBlocks(state.blocks) }
      : null
    const request = assistantRequest(state, node, boundary)
    if (node === undefined && partial === null && request === undefined) return null
    return trajectoryNode(context, state.startSeq, {
      kind: 'assistant',
      ...(node === undefined ? {} : { node }),
      partial,
      ...(request === undefined ? {} : { request }),
    })
  },
}

interface TurnEndState {
  readonly turn: number
  readonly seq: number
  readonly time: number
  readonly error?: string
}

const trajectoryTurnEndDefinition: ConversationNodeDefinition<TurnEndState> = {
  kind: 'trajectory-turn-end',
  target: 'trajectory',
  match: event => event.type === 'turn/end'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'turn/end') {
      throw new Error('trajectory-turn-end start requires turn/end')
    }
    const reason = match.event.data.reason
    return {
      turn: match.event.data.turn,
      seq: match.event.seq,
      time: match.event.time,
      ...(reason.kind === 'error' ? { error: displayFailureMessage(reason.error) } : {}),
    }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : trajectoryNode(context, context.state.seq, {
      kind: 'turn-end',
      turn: context.state.turn,
      time: context.state.time,
      ...(context.state.error === undefined ? {} : { error: context.state.error }),
    }),
}
/* jscpd:ignore-end */

/**
 * Register the Trajectory Assistant lifecycle.
 *
 * @param ctx - Plugin context receiving the Definitions.
 */
export function registerTrajectoryAssistantDefinition(ctx: Context): void {
  ctx.conversationEvents.register(trajectoryAssistantDefinition)
  ctx.conversationEvents.register(trajectoryTurnEndDefinition)
}
