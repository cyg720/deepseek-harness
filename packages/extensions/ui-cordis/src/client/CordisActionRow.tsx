/** Localized cards for `cordis_stop` and `cordis_undefine`. */
/**
 * 文件职责：为 cordis_stop 和 cordis_undefine 工具调用渲染本地化操作卡片。
 * 技术维度：使用 React TSX、工具调用插槽属性、卡片模型和状态/操作图标。
 * 产品维度：让用户识别插件停止或移除结果、错误摘要、输出详情并可打开检查器。
 * 逻辑维度：从 block 派生 card，判断 remove，选择摘要；按状态渲染图标、标题、检查按钮和可选输出。
 * 关键边界：摘要优先错误、插件 id、调用 id；inspect 缺失时不显示按钮，output 为 null 时不渲染 pre。
 * 新手阅读建议：先看 card/remove/summary 三个变量，再跟踪嵌套状态图标和两个可选渲染分支。
 */

import {
  IconInspectOutline12, IconStopFill16, IconTrashOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { cordisActionCard } from './card-model.ts'
import css from './CordisRunRow.module.css'

/** Full action-card props composed by the keyed Tool slot. */
/** 键控工具插槽组合出的完整 Cordis 操作卡属性。 */
export type CordisActionRowProps = ToolCallViewProps & PropsLocale<'cordis'>

/** Render one Stop or Remove call with Cordis-owned localized copy. */
/**
 * 渲染停止或移除调用。
 * @param callId 调用 id。
 * @param toolName 工具名。
 * @param block 调用块。
 * @param inspect 可选检查动作。
 * @param t 翻译函数。
 * @returns 操作卡。
 * @example <CordisActionRow {...props} />。
 */
export function CordisActionRow({ callId, toolName, block, inspect, t }: CordisActionRowProps) {
  // 从工具块解析的展示模型，包含状态、摘要和输出。
  const card = cordisActionCard(block)
  // 是否为删除定义工具，而非停止工具。
  const remove = toolName === 'cordis_undefine'
  // 显示摘要，按错误、插件 id、调用 id 顺序回退。
  const summary = card.errorSummary ?? card.pluginId ?? callId

  return (
    <div className={css.card} data-tool={toolName} data-state={card.state}>
      <div className={css.row}>
        <span className={css.icon}>
          {card.state === 'error'
            ? <StateDot state="error" />
            : card.state === 'stopped'
              ? <StateDot state="warning" />
              : remove ? <IconTrashOutline16 size={14} /> : <IconStopFill16 size={14} />}
        </span>
        <span className={css.title}>{t(remove ? 'row.removeTitle' : 'row.stopTitle')}</span>
        <span className={css.separator} aria-hidden />
        <span className={card.errorSummary === null ? css.summary : css.error}>{summary}</span>
        {inspect !== undefined && (
          <button type="button" className={css.inspect} aria-label="Inspect" onClick={inspect}>
            <IconInspectOutline12 />
          </button>
        )}
      </div>
      {card.output !== null && <pre className={css.output}>{card.output}</pre>}
    </div>
  )
}
