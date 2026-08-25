/**
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹目标下"请求头"状态机：从 request/header 事件捕获每次请求的系统提示词
 *             与工具目录快照，并计算相对上次的变更（初始 / 仅系统 / 仅工具 / 系统+工具）。
 * 【技术维度】ConversationNodeDefinition 状态机（match / start / update / buildViewNode）；
 *             start 时对比前一个请求头快照，产出 RequestPromptChange。
 * 【产品维度】轨迹里每条系统提示词变更都能展示"变更前后"详情，辅助排查模型输入漂移。
 * 【逻辑维度】1) requestPrompt 提取快照；2) promptChange 计算变更；3) 定义状态机；
 *             4) 注册函数。
 * 【关键边界】只有 reason 为 'initial' 或确有 system/tools 变化时才记录 change；
 *             tools 对比用 JSON 序列化。
 * 【新手阅读建议】先看 promptChange 的四种变更类型判定。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeDefinition, ConversationPromptSnapshot,
  RequestPromptChange,
} from '@deepseek-ai/dsh-client-runtime/client'
import { trajectoryNode } from './trajectory-definition-common.ts'
import type { TrajectoryRequestHeaderState } from './trajectory-contract.ts'

function requestPrompt(match: ConversationMatch): ConversationPromptSnapshot {
  if (match.event.type !== 'request/header') {
    throw new Error('trajectory-request-header start requires request/header')
  }
  const header = match.event.data.header
  const tools: unknown = header.tools
  return {
    config: header.config,
    system: header.system ?? '',
    tools: Array.isArray(tools) ? tools as ConversationPromptSnapshot['tools'] : [],
  }
}

/**
 * 计算本次请求头相对上次提示词快照的变更；无变化（或首次且非 initial）返回 undefined。
 * @param previous - 上一次的提示词快照（可能没有）。
 * @param prompt - 本次请求头的提示词快照。
 * @param match - 当前请求头事件匹配。
 * @returns 变更描述；无变更时不记录。
 */
function promptChange(
  previous: ConversationPromptSnapshot | undefined,
  prompt: ConversationPromptSnapshot,
  match: ConversationMatch,
): RequestPromptChange | undefined {
  if (match.event.type !== 'request/header') return undefined
  if (previous === undefined && match.event.data.reason !== 'initial') return undefined
  const systemChanged = previous !== undefined && previous.system !== prompt.system
  const toolsChanged = previous !== undefined
    && JSON.stringify(previous.tools) !== JSON.stringify(prompt.tools)
  if (previous !== undefined && !systemChanged && !toolsChanged) return undefined
  return {
    seq: match.event.seq,
    time: match.event.time,
    kind: previous === undefined
      ? 'initial'
      : systemChanged && toolsChanged
        ? 'system-and-tools'
        : systemChanged ? 'system' : 'tools',
    ...(previous === undefined ? {} : { previous }),
  }
}

/** 轨迹请求头状态机：匹配 request/header，start 时计算提示词变更并产出视图节点。 */
const trajectoryRequestHeaderDefinition: ConversationNodeDefinition<TrajectoryRequestHeaderState> = {
  kind: 'trajectory-request-header',
  target: 'trajectory',
  match: event => event.type === 'request/header'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match, reader) => {
    const prompt = requestPrompt(match)
    const previous = reader.previous<TrajectoryRequestHeaderState>('trajectory-request-header')
      ?.state.prompt
    const change = promptChange(previous, prompt, match)
    return {
      seq: match.event.seq,
      time: match.event.time,
      prompt,
      location: match.location,
      ...(change === undefined ? {} : { change }),
    }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : trajectoryNode(context, context.state.seq, {
      kind: 'request-header',
      header: context.state,
    }),
}

/**
 * Register Trajectory request-header facts.
 *
 * @param ctx - Plugin context receiving the Definition.
 */
/*
 * 注册轨迹请求头事实状态机。
 * @param ctx - 接收该 Definition 的插件上下文。
 */
export function registerTrajectoryRequestHeaderDefinition(ctx: Context): void {
  ctx.conversationEvents.register(trajectoryRequestHeaderDefinition)
}
