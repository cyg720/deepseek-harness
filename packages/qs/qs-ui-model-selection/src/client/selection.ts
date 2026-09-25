/** 模型标识只作精确查找；推理强度从当前目录派生，不猜测供应商支持。 */
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'

/** 菜单键同时保留供应商及模型身份，不按分隔符拆解。 */
export interface ModelChoice {
  readonly id: string
  readonly label: string
  readonly provider: string
  readonly selection: ModelSelection
}
/**
 * 生成成功目录中的可选行，保留同一路由的明确推理强度。
 * @param state - 唯一官方目录快照。
 * @returns 两个呈现入口共用的选项。
 */
export function modelChoices(state: ModelDirectoryState): readonly ModelChoice[] {
  return state.groups.flatMap(group => group.models.map((model) => {
    const same = state.current?.provider === group.id && state.current.model === model.id
    const effort = same ? state.current?.reasoningEffort ?? model.reasoning?.defaultEffort : model.reasoning?.defaultEffort
    return {
      id: JSON.stringify([group.id, model.id]), label: model.name, provider: group.name,
      selection: { provider: group.id, model: model.id, ...(effort === undefined ? {} : { reasoningEffort: effort }) },
    }
  }))
}
/**
 * 从最新目录解析菜单选择；目录变化后失效的行不得发送。
 * @param state - 提交时的官方目录。
 * @param id - 当前选项的完整键。
 * @returns 当前仍有效的选择，或 undefined。
 */
export function selectionOf(state: ModelDirectoryState, id: string): ModelSelection | undefined {
  return modelChoices(state).find(row => row.id === id)?.selection
}
