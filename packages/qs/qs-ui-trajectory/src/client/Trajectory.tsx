/** 按原型展示请求卡片，敏感上下文仅在用户主动展开后挂载。 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AssistantTiming, RequestView, RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { TrajectoryProps, TrajectoryReading } from './contract.ts'
import css from './trajectory.module.css'
import { Live } from './Live.tsx'
import { History } from './History.tsx'
import { RecordedContent } from './Content.tsx'
import { findFocus } from './focus.ts'

// usage 是持久化来源的 unknown 字段；缺失或非法计数保持“未记录”，不转换为零。
function tokenCount(usage: unknown, key: string): number | undefined {
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return undefined
  const value: unknown = Reflect.get(usage, key)
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const

function RequestCard({ request, timing, locate, reading, renderImages, t }: {
  request: RequestView
  reading: TrajectoryReading
  renderImages: RenderMessageImages
  timing: AssistantTiming | undefined
  locate: (() => void) | undefined
  t: TranslateNS<'qs-ui-trajectory'>
}) {
  const [expanded, setExpanded] = useState(() => reading.requests.has(request.startSeq))
  const prompt = request.purpose === 'assistant' ? request.prompt : undefined
  const firstToken = timing === undefined || timing.firstTokenTime === null || timing.stepStartTime === null
    ? undefined : timing.firstTokenTime - timing.stepStartTime
  const model = request.provenance?.model ?? request.requestConfig?.model ?? prompt?.config.model
  return <article tabIndex={-1} className={css.card} data-qs-trajectory-request={request.startSeq}>
    <header><h3>{t(request.purpose)}</h3><span>{t(request.status)}</span></header>
    <dl>
      <div><dt>{t('sequence')}</dt><dd>{request.startSeq}</dd></div>
      <div><dt>{t('turn')}</dt><dd>{request.turn ?? t('unknown')}</dd></div>
      <div><dt>{t('step')}</dt><dd>{request.step}</dd></div>
      <div><dt>{t('model')}</dt><dd>{model ?? t('unknown')}</dd></div>
      <div><dt>{t('duration')}</dt><dd>{request.completedAt === null ? t('unknown') : request.completedAt - request.startedAt}</dd></div>
      <div><dt>{t('firstToken')}</dt><dd>{firstToken ?? t('unknown')}</dd></div>
      {TOKEN_FIELDS.map(key => <div key={key}><dt>{t(key)}</dt><dd>{tokenCount(request.usage, key) ?? t('unknown')}</dd></div>)}
    </dl>
    <button type="button" disabled={locate === undefined} onClick={locate}>{t(locate === undefined ? 'locateUnavailable' : 'locateResult')}</button>
    <details open={expanded} onToggle={(event) => {
      const open = event.currentTarget.open
      setExpanded(open)
      if (open) reading.requests.add(request.startSeq)
      else reading.requests.delete(request.startSeq)
    }}>
      <summary>{t('details')}</summary>
      {expanded && <>
        {request.purpose === 'compaction' ? <>
          {request.summary !== undefined && <><h4>{t('compactionSummary')}</h4>
            <RecordedContent blocks={request.summary} t={t} renderImages={renderImages} /></>}
          {request.rawOutput !== undefined && <><h4>{t('rawOutput')}</h4>
            <RecordedContent blocks={request.rawOutput} t={t} renderImages={renderImages} /></>}
          {request.summary === undefined && request.rawOutput === undefined && <p>{t('missing')}</p>}
        </> : prompt === undefined ? <p>{t('missing')}</p> : <>
          <h4>{t('system')}</h4><pre>{prompt.system}</pre>
          <h4>{t('tools')}</h4><pre>{JSON.stringify(prompt.tools, null, 2)}</pre>
          <h4>{t('config')}</h4><pre>{JSON.stringify(prompt.config, null, 2)}</pre>
        </>}
        {request.errorCode !== undefined && <><h4>{t('failureCode')}</h4><pre>{request.errorCode}</pre></>}
        {request.errorCode === 'AUTH' ? <p>{t('authFailure')}</p>
          : request.error !== undefined && <><h4>{t('failureDetail')}</h4><pre>{request.error}</pre></>}
      </>}
    </details>
  </article>
}
/**
 * 渲染官方已加载请求及分页状态，不自行解析日志或发起模型调用。
 * @param props - 会话快照、请求源和官方加载命令。
 * @returns 奇术轨迹卡片。
 */
export function Trajectory({
  sessionId, useRequests, useNodes, usePartial, useRunningCalls, useConnected, useSession, loadOlder, loadImage,
  renderSlot, reading, viewRequest, completeViewRequest, t,
}: TrajectoryProps) {
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const scroll = root.current?.closest<HTMLElement>('[data-qs-scroll]')
    if (scroll == null) return
    // 展开状态在首帧还原后恢复位置；卸载只移除监听，不读取已被其他视图接管的滚动值。
    scroll.scrollTop = reading.scrollTop
    const save = (): void => { reading.scrollTop = scroll.scrollTop }
    scroll.addEventListener('scroll', save, { passive: true })
    return () => { scroll.removeEventListener('scroll', save) }
  }, [reading])
  const locate = (seq: number): void => {
    // 目标来自同一渲染帧的已加载历史；只在本会话根节点内查找，避免多座位相同序号串台。
    const record = (root.current as HTMLElement).querySelector(`[data-qs-trajectory-record="${seq}"]`) as HTMLDetailsElement
    record.open = true
    const summary = record.querySelector('summary') as HTMLElement
    summary.focus({ preventScroll: true })
    record.scrollIntoView({ block: 'nearest' })
  }
  const renderImages = useCallback<RenderMessageImages>(
    owner => renderSlot('qs.conversation.trajectory.images', { ...owner, loadImage }), [renderSlot, loadImage],
  )
  const requests = useRequests(value => value), connected = useConnected(value => value)
  const partial = usePartial(value => value), calls = useRunningCalls(value => value)
  const nodes = useNodes(value => value)
  const focusId = viewRequest?.view === 'trajectory' ? viewRequest.focus : undefined
  const focus = useMemo(() => focusId === undefined ? undefined : findFocus(nodes, calls, focusId), [nodes, calls, focusId])
  useEffect(() => {
    if (focus === undefined) return
    const container = root.current as HTMLElement
    // 调用 ID 是不透明字符串，用属性值比较而非拼接 CSS 选择器。
    const call = [...container.querySelectorAll<HTMLDetailsElement>('[data-qs-tool-call]')]
      .find(element => element.dataset.qsToolCall === focusId)
    const target = (call ?? container.querySelector(`[data-qs-trajectory-record="${focus.seq}"]`)) as HTMLDetailsElement
    const summary = target.querySelector('summary') as HTMLElement
    summary.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'nearest' })
    completeViewRequest()
  }, [focus, focusId, completeViewRequest])
  const turns = useMemo(() => {
    const firstRequest = new Map<number, number>()
    for (const request of requests) {
      // 手动压缩可能没有轮次；同轮的重试和后续步骤保留第一个真实请求作为入口。
      if (request.turn !== null && !firstRequest.has(request.turn)) firstRequest.set(request.turn, request.startSeq)
    }
    return firstRequest
  }, [requests])
  const resultNodes = useMemo(() => {
    const result = new Map<number, number>()
    for (const node of nodes) {
      if (node.kind === 'assistant') result.set(node.seq, node.seq)
      else if (node.kind === 'compaction' && node.summaryEventSeq !== null) result.set(node.summaryEventSeq, node.seq)
    }
    return result
  }, [nodes])
  // 只按结果序号关联时间，避免同一轮次/步骤的失败重试借用最终请求的首字时间。
  const timings = useMemo(() => {
    const result = new Map<number, AssistantTiming>()
    for (const node of nodes) if (node.kind === 'assistant' && node.timing !== undefined) result.set(node.seq, node.timing)
    return result
  }, [nodes])
  const more = useSession(value => value.hasMore), loading = useSession(value => value.loadingOlder)
  const failed = useSession(value => value.historyLoad.phase === 'failed')
  // 官方投影明确区分空页与历史末尾，视图只解释结果，不自行继续分页。
  const noProgress = useSession(value => value.hasMore && value.historyLoad.phase === 'succeeded' && !value.historyLoad.progressed)
  const [failure, setFailure] = useState(false)
  const load = async (): Promise<void> => {
    setFailure(false)
    // 分页拒绝只显示本地化提示，不把 Host 路径或诊断细节写入界面。
    try { await loadOlder() } catch { setFailure(true) }
  }
  return <section ref={root} className={css.root} aria-label={t('title')} data-qs-trajectory={sessionId}>
    <p className={css.notice}>{t('scope')}</p>
    {turns.size > 0 && <label className={css.turnNavigation}>{t('turnNavigation')}
      <select aria-label={t('turnNavigation')} value="" onChange={(event) => {
        const card = (root.current as HTMLElement).querySelector(`[data-qs-trajectory-request="${event.currentTarget.value}"]`) as HTMLElement
        card.focus({ preventScroll: true })
        card.scrollIntoView({ block: 'nearest' })
      }}>
        <option value="" disabled>{t('chooseTurn')}</option>
        {[...turns].map(([turn, seq]) => <option key={turn} value={seq}>{t('turn')} {turn}</option>)}
      </select>
    </label>}
    {focusId !== undefined && focus === undefined && <p role="status">{t('focusMissing')}</p>}
    {!connected && <p role="status">{t('offline')}</p>}
    {(failed || failure) && <p role="alert">{t('failed')}</p>}
    {noProgress && <p role="status">{t('noProgress')}</p>}
    {more && <button type="button" disabled={loading || !connected} onClick={() => { void load() }}>{t(loading ? 'loading' : 'older')}</button>}
    {requests.length === 0 ? <p>{t('empty')}</p> : requests.map((request) => {
      const seq = request.resultSeq === undefined ? undefined : resultNodes.get(request.resultSeq)
      return <RequestCard key={request.startSeq} request={request} reading={reading} renderImages={renderImages}
        timing={request.resultSeq === undefined ? undefined : timings.get(request.resultSeq)}
        locate={seq === undefined ? undefined : () => { locate(seq) }} t={t} />
    })}
    <Live focusPath={focus?.calls} partial={partial} calls={calls} t={t} renderImages={renderImages} />
    <History focusSeq={focus?.seq} focusPath={focus?.calls} nodes={nodes}
      expandedRecords={reading.records} t={t} renderImages={renderImages} />
  </section>
}
