/*
 * 【文件职责】将 goal 命令的持久运行记录投影为用户命令输入，独立于发送给模型的普通消息。
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type {} from '@deepseek-ai/dsh-commands/types'
import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The command name whose runs this projection owns. */
export const GOAL_COMMAND = 'goal'

/** Goal-owned human command input projected independently of model messages. */
// 目标命令输入投影数据：命令 id、可见文本与时间，独立于模型消息渲染。
export interface GoalCommandInputData {
  readonly commandId: CommandId
  readonly text: string
  readonly time: number
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Human-entered `/goal` command input. */
    'command-input': GoalCommandInputData
  }
}

interface GoalCommandInputState extends GoalCommandInputData {
  readonly seq: number
}

/**
 * Derive the visible command line from its structured durable run.
 * @param event - `/goal` command run.
 * @returns command text with trailing parser whitespace removed.
 */
export function goalCommandText(event: SessionEvent<'command/run'>): string {
  return `/${event.data.name}${(event.data.args ?? '').trimEnd()}`
}

/** Goal-owned command input projection; the generic command Definition retains the result row. */
// /goal 命令输入的会话节点定义：只匹配 goal 命令，结果为只读命令输入节点。
export const goalCommandInputDefinition: ConversationNodeDefinition<GoalCommandInputState> = {
  kind: 'goal-command-input',
  target: 'chat',
  match: event => event.type === 'command/run' && event.data.name === GOAL_COMMAND
    ? { id: String(event.data.commandId), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'command/run') {
      throw new Error('goal-command-input start requires command/run')
    }
    return {
      commandId: match.event.data.commandId,
      seq: match.event.seq,
      time: match.event.time,
      text: goalCommandText(match.event),
    }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'command-input',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq - 0.1,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: {
        commandId: context.state.commandId,
        text: context.state.text,
        time: context.state.time,
      },
    }
  },
}
