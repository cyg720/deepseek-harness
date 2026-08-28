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
  ConversationNodeDefinition, RequestPromptInspector,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { trajectoryNode } from './trajectory-definition-common.ts'
import type { TrajectoryRequestHeaderState } from './trajectory-contract.ts'

/**
 * Request-header fact Definition for the Trajectory target.
 * @param inspect - the shared prompt interpretation, supplied by the
 * uiConversation service (a client bundle cannot value-import it).
 * @returns the Trajectory request-header Definition.
 */
function trajectoryRequestHeaderDefinition(inspect: RequestPromptInspector): ConversationNodeDefinition<TrajectoryRequestHeaderState> {
  return {
    kind: 'trajectory-request-header',
    target: 'trajectory',
    match: event => event.type === 'request/header'
      ? { id: String(event.seq), role: 'start' }
      : null,
    start: (_context, match, reader) => {
      if (match.event.type !== 'request/header') {
        throw new Error('trajectory-request-header start requires request/header')
      }
      const previous = reader.previous<TrajectoryRequestHeaderState>('trajectory-request-header')
        ?.state.prompt
      const { prompt, change } = inspect(previous, match.event)
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
  ctx.uiConversation.events.register(trajectoryRequestHeaderDefinition(
    (previous, event) => ctx.uiConversation.inspectRequestPrompt(previous, event),
  ))
}
