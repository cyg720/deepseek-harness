/** `cordis_run` card and the host seat for Package-owned interactive UI. */
/*
 * 文件职责：实现Cordis 扩展界面的 CordisRunRow.tsx 模块。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证Cordis 扩展界面在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：注册服务或命令，转换请求并记录结果。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */

import { useEffect } from 'react'
import {
  IconCodeOutline16, IconInspectOutline12, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { cordisRunCard } from './card-model.ts'
import { cordisToolViewKey } from './run-card-index.ts'
import type { CordisRunCardFace } from './slots.ts'
import { cordisVisibleStatus, type CordisVisibleStatus } from './status.ts'
import type { CordisKey } from './locales.ts'
import css from './CordisRunRow.module.css'

/** Full Run-card props including its declared Package business-view child slot. */
/* 中文说明：类型或类 CordisRunRowProps 约束扩展或反馈数据职责。 */
export type CordisRunRowProps = ToolCallViewProps
  & InjectFace<CordisRunCardFace>
  & PropsRenderSlots<'tool.view.cordis'>
  & PropsLocale<'cordis'>

/** 中文说明：类型或类 RunReading 约束扩展或反馈数据职责。 */
type RunReading = CordisVisibleStatus | 'awaiting-approval' | 'failed' | 'removed' | 'superseded'

/** 中文说明：模块局部值 READING_LABELS，由紧邻初始化决定。 */
const READING_LABELS = {
  idle: 'status.idle',
  'awaiting-approval': 'status.awaitingApproval',
  failed: 'status.failed',
  'client-pending': 'status.clientPending',
  running: 'status.running',
  removed: 'status.removed',
  superseded: 'status.superseded',
} as const satisfies Record<RunReading, CordisKey>

/** Render one activation result and, when eligible, its Package-owned view. */
/* 中文说明：函数 CordisRunRow 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function CordisRunRow({
  callId, block, inspect, renderSlot, useInventory, useLoaded, useRunCards, useActiveRuns,
  onObserveRunCard, t,
}: CordisRunRowProps) {
  /** 中文说明：模块局部值 card，由紧邻初始化决定。 */
  const card = cordisRunCard(block)
  /** 中文说明：模块局部值 inventory，由紧邻初始化决定。 */
  const inventory = useInventory(snapshot => snapshot)
  /** 中文说明：模块局部值 loaded，由紧邻初始化决定。 */
  const loaded = useLoaded(snapshot => snapshot)
  /** 中文说明：模块局部值 latest，由紧邻初始化决定。 */
  const latest = useRunCards(snapshot => snapshot)
  /** 中文说明：模块局部值 activeRuns，由紧邻初始化决定。 */
  const activeRuns = useActiveRuns(snapshot => snapshot)
  /** 中文说明：模块局部值 key，由紧邻初始化决定。 */
  const key = card.state === 'ok'
    && card.pluginId !== null
    && card.packageId !== null
    && card.pluginRunId !== null
    && card.seq !== null
    ? cordisToolViewKey(card.pluginId, card.packageId)
    : null
  useEffect(() => {
    if (key === null || card.seq === null || card.pluginRunId === null) return
    onObserveRunCard({ key, callId, seq: card.seq, pluginRunId: card.pluginRunId })
  }, [callId, card.pluginRunId, card.seq, key, onObserveRunCard])

  /** 中文说明：模块局部值 row，由紧邻初始化决定。 */
  const row = card.pluginId === null
    ? undefined
    : inventory.rows.find(candidate => candidate.pluginId === card.pluginId)
  /** 中文说明：模块局部值 pointer，由紧邻初始化决定。 */
  const pointer = key === null ? undefined : latest.get(key)
  /** 中文说明：模块局部值 superseded，由紧邻初始化决定。 */
  const superseded = pointer !== undefined && pointer.callId !== callId && pointer.seq >= (card.seq ?? -1)
  /** 中文说明：模块局部值 activity，由紧邻初始化决定。 */
  const activity = card.pluginId === null ? undefined : activeRuns.get(card.pluginId)
  /** 中文说明：模块局部值 attempt，由紧邻初始化决定。 */
  const attempt = card.pluginRunId !== null && row?.latestRun?.pluginRunId === card.pluginRunId
    ? row.latestRun
    : undefined
  /** 中文说明：模块局部值 awaitingApproval，由紧邻初始化决定。 */
  const awaitingApproval = attempt?.status === 'awaiting-approval' || (card.packageId !== null
    && activity?.phase === 'awaiting-approval'
    && activity.packageId === card.packageId
    && (card.mode === null || activity.mode === card.mode))
  /** 中文说明：模块局部值 reading，由紧邻初始化决定。 */
  const reading: RunReading = card.pluginId !== null && inventory.removed.has(card.pluginId)
    ? 'removed'
    : superseded
      ? 'superseded'
      : awaitingApproval
        ? 'awaiting-approval'
        : attempt?.status === 'failed'
          ? 'failed'
          : row !== undefined && card.packageId !== null
            ? cordisVisibleStatus(row, card.packageId, loaded)
            : 'idle'
  /** 中文说明：模块局部值 status，由紧邻初始化决定。 */
  const status = t(READING_LABELS[reading])
  /** 中文说明：模块局部值 summary，由紧邻初始化决定。 */
  const summary = card.errorSummary
    ?? (card.pluginId === null ? callId : `${card.pluginId}${card.packageId === null ? '' : ` · ${card.packageId}`}`)
  /** 中文说明：模块局部值 showBusiness，由紧邻初始化决定。 */
  const showBusiness = reading === 'running' && key !== null

  return (
    <div
      className={css.card}
      data-tool="cordis_run"
      data-state={card.state}
      data-cordis-plugin-id={card.pluginId ?? undefined}
      data-cordis-package-id={card.packageId ?? undefined}
      data-cordis-run-id={card.pluginRunId ?? undefined}
      data-cordis-status={reading}
    >
      <div className={css.row}>
        <span className={css.icon}>
          {card.state === 'error'
            ? <StateDot state="error" />
            : card.state === 'stopped'
              ? <StateDot state="warning" />
              : <IconCodeOutline16 size={14} />}
        </span>
        <span className={css.title}>{t(card.mode === 'update' ? 'row.updateTitle' : 'row.runTitle')}</span>
        <span className={css.separator} aria-hidden />
        <span className={card.errorSummary === null ? css.summary : css.error}>{summary}</span>
        <span className={css.status}>{status}</span>
        {inspect !== undefined && (
          <button type="button" className={css.inspect} aria-label={t('action.inspect')} onClick={inspect}>
            <IconInspectOutline12 />
          </button>
        )}
      </div>
      {reading === 'removed' && <div className={css.message}>{t('run.removed')}</div>}
      {reading === 'superseded' && <div className={css.message}>{t('run.superseded')}</div>}
      {reading === 'failed' && attempt?.error !== undefined && (
        <div className={css.message}>{attempt.error.message}</div>
      )}
      {showBusiness && card.pluginId !== null && card.packageId !== null && card.pluginRunId !== null && (
        <div className={css.business} data-cordis-business-view={key}>
          {renderSlot('tool.view.cordis', {
            pluginId: card.pluginId,
            packageId: card.packageId,
            pluginRunId: card.pluginRunId,
          }, {
            entryKey: key,
            fallback: card.output === null ? null : <pre className={css.output}>{card.output}</pre>,
          })}
        </div>
      )}
      {!showBusiness && reading !== 'removed' && reading !== 'superseded' && card.output !== null && (
        <pre className={css.output}>{card.output}</pre>
      )}
    </div>
  )
}
