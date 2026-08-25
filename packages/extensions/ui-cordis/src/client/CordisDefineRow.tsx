/** Read-only `cordis_define` card with Host and Client source tabs. */
/*
 * 文件职责：实现Cordis 扩展界面的 CordisDefineRow.tsx 模块。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证Cordis 扩展界面在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：注册服务或命令，转换请求并记录结果。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */

import { useId, useState, type ReactNode } from 'react'
import {
  CodeBlock, DisclosureRow, IconCodeOutline16, IconInspectOutline12, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { cordisDefineCard, type CordisToolState } from './card-model.ts'
import type { CordisCardFace } from './slots.ts'
import { cordisVisibleStatus, type CordisVisibleStatus } from './status.ts'
import type { CordisKey } from './locales.ts'
import css from './CordisDefineRow.module.css'

/** Full card props composed by the keyed Tool slot. */
/* 中文说明：类型或类 CordisDefineRowProps 约束扩展或反馈数据职责。 */
export type CordisDefineRowProps = ToolCallViewProps & InjectFace<CordisCardFace> & PropsLocale<'cordis'>

/** 中文说明：类型或类 CardReading 约束扩展或反馈数据职责。 */
type CardReading = CordisVisibleStatus | 'removed'
/** 中文说明：类型或类 SourceTab 约束扩展或反馈数据职责。 */
type SourceTab = 'client' | 'host'

/** 中文说明：模块局部值 READING_LABELS，由紧邻初始化决定。 */
const READING_LABELS = {
  idle: 'status.idle',
  'client-pending': 'status.clientPending',
  running: 'status.running',
  removed: 'status.removed',
} as const satisfies Record<CardReading, CordisKey>

/** 中文说明：函数 stateStatus 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stateStatus(state: CordisToolState): CordisKey | null {
  switch (state) {
    case 'running': return 'a11y.defining'
    case 'error': return 'a11y.failed'
    case 'stopped': return 'a11y.stopped'
    default: return null
  }
}

/** 中文说明：函数 leadingFor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function leadingFor(state: CordisToolState): ReactNode {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconCodeOutline16 size={14} />
  }
}

/** Render one immutable Package definition. */
/* 中文说明：函数 CordisDefineRow 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function CordisDefineRow({
  callId, block, inspect, useInventory, useLoaded, t,
}: CordisDefineRowProps) {
  /** 中文说明：模块局部值 card，由紧邻初始化决定。 */
  const card = cordisDefineCard(block)
  /** 中文说明：模块局部值 inventory，由紧邻初始化决定。 */
  const inventory = useInventory(snapshot => snapshot)
  /** 中文说明：模块局部值 loaded，由紧邻初始化决定。 */
  const loaded = useLoaded(snapshot => snapshot)
  /** 中文说明：模块局部值 [expanded, setExpanded]，由紧邻初始化决定。 */
  const [expanded, setExpanded] = useState(false)
  /** 中文说明：模块局部值 解构结果，由紧邻初始化决定。 */
  const [selectedSource, setSelectedSource] = useState<SourceTab>(card.clientCode !== null ? 'client' : 'host')
  /** 中文说明：模块局部值 sourcePanelId，由紧邻初始化决定。 */
  const sourcePanelId = useId()

  /** 中文说明：模块局部值 row，由紧邻初始化决定。 */
  const row = card.pluginId === null
    ? undefined
    : inventory.rows.find(candidate => candidate.pluginId === card.pluginId)
  /** 中文说明：模块局部值 reading，由紧邻初始化决定。 */
  const reading: CardReading = card.pluginId !== null && inventory.removed.has(card.pluginId)
    ? 'removed'
    : row !== undefined && card.packageId !== null
      ? cordisVisibleStatus(row, card.packageId, loaded)
      : 'idle'
  /** 中文说明：模块局部值 name，由紧邻初始化决定。 */
  const name = card.name ?? callId
  /** 中文说明：模块局部值 expandable，由紧邻初始化决定。 */
  const expandable = card.hostCode !== null || card.clientCode !== null || card.output !== null
  /** 中文说明：模块局部值 open，由紧邻初始化决定。 */
  const open = expanded && expandable
  /** 中文说明：模块局部值 a11yState，由紧邻初始化决定。 */
  const a11yState = stateStatus(card.state)
  /** 中文说明：模块局部值 hasSource，由紧邻初始化决定。 */
  const hasSource = card.clientCode !== null || card.hostCode !== null
  /** 中文说明：模块局部值 activeSource，由紧邻初始化决定。 */
  const activeSource: SourceTab = selectedSource === 'client' && card.clientCode !== null
    ? 'client'
    : selectedSource === 'host' && card.hostCode !== null
      ? 'host'
      : card.clientCode !== null ? 'client' : 'host'
  /** 中文说明：模块局部值 activeCode，由紧邻初始化决定。 */
  const activeCode = activeSource === 'client' ? card.clientCode : card.hostCode

  return (
    <div
      className={css.card}
      data-tool="cordis_define"
      data-state={card.state}
      data-terminal={reading === 'removed' || undefined}
      data-cordis-plugin-id={card.pluginId ?? undefined}
      data-cordis-package-id={card.packageId ?? undefined}
      data-cordis-status={reading}
    >
      {a11yState !== null && <span className={css.visuallyHidden}>{t(a11yState)}</span>}
      <DisclosureRow
        rowClassName={css.row}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={leadingFor(card.state)}
        title={t('row.defineTitle')}
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={card.errorSummary === null ? css.name : css.errorSummary}>
              {card.errorSummary ?? name}
            </span>
            {card.errorSummary === null && (
              <span className={css.purpose}>{card.purpose ?? t('purpose.missing')}</span>
            )}
            {card.pluginId !== null && (
              <span className={css.readout}>
                <span className={css.statusLabel}>{t(READING_LABELS[reading])}</span>
              </span>
            )}
          </>
        )}
      >
        <div className={css.bodyWrap}>
          {hasSource && activeCode !== null && (
            <section className={css.sourceCard}>
              <div className={css.sourceTabs} role="tablist" aria-label={t('body.source')}>
                {(['client', 'host'] as const).map((source) => {
                  /** 中文说明：模块局部值 available，由紧邻初始化决定。 */
                  const available = source === 'client' ? card.clientCode !== null : card.hostCode !== null
                  return (
                    <button
                      key={source}
                      id={`${sourcePanelId}-${source}`}
                      type="button"
                      role="tab"
                      aria-controls={sourcePanelId}
                      aria-selected={activeSource === source}
                      className={activeSource === source ? `${css.sourceTab} ${css.sourceTabActive}` : css.sourceTab}
                      disabled={!available}
                      onClick={() => { setSelectedSource(source) }}
                    >
                      {t(source === 'client' ? 'body.clientCode' : 'body.hostCode')}
                    </button>
                  )
                })}
              </div>
              <div
                id={sourcePanelId}
                className={css.sourcePanel}
                role="tabpanel"
                aria-labelledby={`${sourcePanelId}-${activeSource}`}
              >
                <CodeBlock
                  code={activeCode}
                  lang="javascript"
                  copyLabel={t('body.copy')}
                  copiedLabel={t('body.copied')}
                  className={css.sourceCode}
                />
              </div>
            </section>
          )}
          {card.output !== null && (
            <section className={css.codeSection}>
              <div className={css.sectionLabel}>{t('body.output')}</div>
              <pre className={css.output} data-error={card.state === 'error' || undefined}>{card.output}</pre>
            </section>
          )}
          {card.pluginId !== null && <div className={css.panelHint}>{t('panel.hint')}</div>}
          {inspect !== undefined && (
            <button type="button" className={css.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              Inspect
            </button>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}
