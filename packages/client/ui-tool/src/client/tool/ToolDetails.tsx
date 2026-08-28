/** Card-aware output body for the selected Tool call in details. */
/*
 * 文件职责：实现工具调用的 ToolDetails 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示工具调用参数、结果和状态。
 * 逻辑维度：接收类型化数据，选择专用视图并渲染层级与详情。
 * 关键边界：组件不执行工具；未知或失败结果必须保留可诊断信息。
 * 新手阅读建议：先读 Props，再看视图选择、派生值和 JSX。
 */
import { DiffBlock, ReadBlock, SearchBlock, TerminalBlock, WebBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolDetailsProps } from '../contract/slots.ts'
import { diffCardModel } from './models/diff-card-model.ts'
import { readCardModel } from './models/read-card-model.ts'
import { searchCardModel } from './models/search-card-model.ts'
import {
  localizeTerminalCardModel, terminalBlockLabels, terminalCardModel,
} from './models/terminal-card-model.ts'
import {
  diffBlockLabels, readBlockLabels, searchBlockLabels, webBlockLabels,
} from './models/primitive-labels.ts'
import { resultText } from './models/tool-call-model.ts'
import { webCardModel } from './models/web-card-model.ts'
import css from './ToolDetails.module.css'

/**
 * Render the selected Tool call's structured output when its raw fields form a
 * supported root card, otherwise preserve the flattened result text.
 * @param props - selected call slice, workspace root, host home, and locale seat.
 * @returns the details output body.
 */
/* 中文说明：函数 ToolDetails 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function ToolDetails({
  block, cwd, useConnectionGeneration, t,
}: Pick<ToolDetailsProps, 'block' | 'cwd' | 'useConnectionGeneration' | 't'>) {
  const home = useConnectionGeneration(generation => generation?.host.home)
  const terminalModel = terminalCardModel(block, cwd)
  if (terminalModel !== null) {
    const terminal = localizeTerminalCardModel(terminalModel, t)
    return (
      <>
        {terminal.description !== undefined ? (
          <div className={css.description}>{terminal.description}</div>
        ) : null}
        <TerminalBlock {...terminal.card} labels={terminalBlockLabels(t)} className={css.cardBody} />
      </>
    )
  }
  /** 中文说明：视图局部值 read，由紧邻初始化决定。 */
  const read = readCardModel(block, cwd, home)
  if (read !== null) return <ReadBlock {...read} labels={readBlockLabels(t)} className={css.read} />
  const diff = diffCardModel(block)
  if (diff !== null) return <DiffBlock {...diff.card} labels={diffBlockLabels(t)} className={css.cardBody} />
  const search = searchCardModel(block)
  if (search !== null) {
    return (
      <>
        <SearchBlock {...search.card} labels={searchBlockLabels(t)} className={css.cardBody} />
        {search.recovery !== undefined ? <div className={css.recovery}>{search.recovery}</div> : null}
      </>
    )
  }
  /** 中文说明：视图局部值 web，由紧邻初始化决定。 */
  const web = webCardModel(block)
  if (web !== null) {
    /** 中文说明：视图局部值 body，由紧邻初始化决定。 */
    const body = 'kind' in block ? resultText(block) : ''
    return (
      <>
        <WebBlock {...web} labels={webBlockLabels(t)} className={css.web} />
        {body !== '' ? <pre className={css.code}>{body}</pre> : null}
      </>
    )
  }
  if (!('kind' in block)) return <div className={css.empty}>{t('details.running')}</div>
  return (
    <pre className={css.code} data-error={block.isError || undefined}>
      {resultText(block)}
    </pre>
  )
}
