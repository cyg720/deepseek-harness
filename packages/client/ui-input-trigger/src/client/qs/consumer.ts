/** 可见输入的来源策略；undefined sources 表示所选触发符的全部来源。 */
export interface InputTriggerConsumerPolicy {
  readonly triggers: readonly ('/' | '@')[]
  readonly sources?: readonly string[]
}
