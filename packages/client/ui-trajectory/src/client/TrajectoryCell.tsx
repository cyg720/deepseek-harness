// Legacy standalone trajectory cell retained for direct consumers and specs.
/**
 * 文件职责：实现运行轨迹的 TrajectoryCell 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示运行轨迹参数、结果和状态。
 * 逻辑维度：接收类型化数据，选择专用视图并渲染层级与详情。
 * 关键边界：组件不执行工具；未知或失败结果必须保留可诊断信息。
 * 新手阅读建议：先读 Props，再看视图选择、派生值和 JSX。
 */

import {
  formatElapsedSeconds,
  /** 中文说明：类型或类 TrajectoryCellKind 约束工具或轨迹数据职责。 */
  type TrajectoryCellKind,
  /** 中文说明：类型或类 TrajectoryCellProps 约束工具或轨迹数据职责。 */
  type TrajectoryCellProps,
} from './trajectory-record.ts'
import type { TrajectoryKey, TrajectoryTranslate } from './locales.ts'
import css from './TrajectoryCell.module.css'

export { formatElapsedSeconds }
export type {
  AssistantMetricDetail,
  TrajectoryCellKind,
  TrajectoryCellProps,
} from './trajectory-record.ts'

/** Display label per kind (matches the design tags). */
const KIND_LABEL_KEY: Record<TrajectoryCellKind, TrajectoryKey> = {
  system: 'kind.system',
  user: 'kind.user',
  context: 'kind.context',
  compacted: 'kind.compacted',
  message: 'kind.message',
  tool: 'kind.tool',
  subtool: 'kind.sub',
}

/** 中文说明：视图局部值 TAG_CLASS，由紧邻初始化决定。 */
const TAG_CLASS: Record<TrajectoryCellKind, string | undefined> = {
  system: css.tagSystem,
  user: css.tagUser,
  context: css.tagContext,
  compacted: css.tagSystem,
  message: css.tagMessage,
  tool: css.tagTool,
  subtool: css.tagSubtool,
}

/**
 * Render one trajectory step cell.
 * @param props - index, kind, text, time, and optional Message metrics.
 * @returns the cell element.
 */
/* 中文说明：函数 TrajectoryCell 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function TrajectoryCell({
  t,
  index,
  kind,
  text,
  inputDetail: _inputDetail,
  promptDetail: _promptDetail,
  previousPromptDetail: _previousPromptDetail,
  outputDetail: _outputDetail,
  thinkingDetail: _thinkingDetail,
  sourceBlocks: _sourceBlocks,
  outputBlocks: _outputBlocks,
  schemaDetail: _schemaDetail,
  assistantMetrics: _assistantMetrics,
  result: _result,
  callId: _callId,
  isError: _isError,
  timeSeconds,
  startedAt: _startedAt,
  input,
  output,
  think,
  selected = false,
  className,
  ...rest
}: TrajectoryCellProps & { t: TrajectoryTranslate }) {
  const rootClass = [
    css.root,
    selected ? css.selected : undefined,
    className,
  ].filter((c): c is string => c !== undefined).join(' ')
  /** 中文说明：视图局部值 showMetrics，由紧邻初始化决定。 */
  const showMetrics = kind === 'message'
  return (
    <div className={rootClass} data-kind={kind} data-selected={selected || undefined} {...rest}>
      <span className={css.index}>#{index}</span>
      <span className={css.tagSlot}>
        <span className={[css.tag, TAG_CLASS[kind]].filter((c): c is string => c !== undefined).join(' ')}>{t(KIND_LABEL_KEY[kind])}</span>
      </span>
      <span className={css.text}>{text}</span>
      <span className={css.trailing}>
        {showMetrics ? (
          <>
            <span className={css.metric}>{input ?? ''}</span>
            <span className={css.metric}>{output ?? ''}</span>
            <span className={css.metric}>{think ?? ''}</span>
          </>
        ) : null}
        <span className={css.time}>{formatElapsedSeconds(timeSeconds, t)}</span>
      </span>
    </div>
  )
}
