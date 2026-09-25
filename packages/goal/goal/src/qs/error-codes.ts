/** 目标领域错误的跨端代码；Remote 只携带分类和消息，不传内部状态。 */
export type GoalErrorCode =
  | 'GOAL_AGENT_NOT_LIVE'
  | 'GOAL_NOT_FOUND'
  | 'GOAL_ALREADY_EXISTS'
  | 'GOAL_STALE_REVISION'
  | 'GOAL_INVALID_OBJECTIVE'
  | 'GOAL_INVALID_MAX_ROUNDS'
  | 'GOAL_INVALID_BLOCK_REASON'
  | 'GOAL_INVALID_EDIT'
  | 'GOAL_INVALID_TRANSITION'

type GoalRemoteErrors = Record<GoalErrorCode, Readonly<Record<string, never>>>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap extends GoalRemoteErrors {}
}
