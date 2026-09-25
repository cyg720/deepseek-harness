import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
/** 转写阅读区按有效行注册分派；待回答卡片由 Stage 固定座位独立承载。 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { QsScrollPosition, QsTranscriptInjected } from './contract.ts'
import { canFoldProcess, isProcessMemberHidden, processFoldKey } from './process-fold.ts'
import { assistantStepData, rowKeyOf } from './adapter.ts'
import { useHistoryScroll } from './history-scroll.ts'
import { QsIcon } from './Icon.tsx'
import styles from './transcript.module.css'

/** 转写条目的完整 props。 */
export type QsTranscriptProps =
  PropsRuntime<'qs.stage.transcript'>
  & PropsRenderSlots<'qs.stage.transcript.row' | 'qs.conversation.message.images'>
  & InjectFace<QsTranscriptInjected>
  & PropsLocale<'qs-transcript'>

/** 行分派座席的输入：行键、订阅座席与父 entry 的 renderSlot 委托。 */
interface RowSeatProps {
  readonly useSearchableHidden: QsTranscriptProps['useSearchableHidden']
  readonly compactTranscript: boolean
  readonly renderMessageImages: RenderMessageImages
  readonly fileMentions: QsTranscriptProps['fileMentions']
  /** 与官方一致：尚有未加载历史时不折叠已有过程成员。 */
  readonly historyIncomplete: boolean
  readonly available: readonly string[]
  readonly nodeKey: string
  readonly useNode: QsTranscriptProps['useNode']
  readonly useProcess: QsTranscriptProps['useProcess']
  /** 会话授权的图片装载，随行 owner 输入下发。 */
  readonly loadImage: QsTranscriptProps['loadImage']
  /** 会话级过程折叠状态，随行 owner 输入下发。 */
  readonly fold: QsTranscriptProps['fold']
  /** 行 owner 输入用的会话身份。 */
  readonly sessionId: QsTranscriptProps['sessionId']
  readonly renderRow: PropsRenderSlots<'qs.stage.transcript.row'>['renderSlot']
}

/**
 * 单行分派座席。
 *
 * 先按行键订阅该行、读出 kind，再据此选用行组件——这是官方 ChatNodeSeat 的形状：
 * 每个 seat 自己调用一次绑定好的 keyed hook，因此 hook 调用次数与行数一一对应，
 * 不会在宿主里形成循环内的 hook 调用。已折叠的轮过程成员在此隐藏，最终答案行不是成员。
 * @param props - 行键、订阅座席与 renderSlot 委托。
 * @returns 该行的渲染结果。
 */
function QsRowSeat({
  available, nodeKey, useNode, useProcess, loadImage, fold, sessionId, renderRow,
  historyIncomplete, fileMentions, renderMessageImages, compactTranscript, useSearchableHidden,
}: RowSeatProps): ReactNode {
  const kind = useNode(nodeKey, node => node?.kind ?? '')
  const step = useNode(nodeKey, node => node === undefined ? undefined : assistantStepData(node)?.step)
  const anchorSeq = useNode(nodeKey, node => node?.anchorSeq ?? -1)
  const location = useNode(nodeKey, node => node?.location)
  const turnData = location?.kind === 'turn' || location?.kind === 'step' ? location.turn.data : undefined
  const process = useProcess(nodeKey, value => value)
  const foldKey = processFoldKey(sessionId, process?.spec.turn ?? 0, process?.spec.answerStep ?? null)
  // 订阅折叠状态：过程行的展开/收起要立即反映到成员行的显隐上。
  const subscribe = useCallback((listener: () => void) => fold.subscribe(listener), [fold])
  const foldOpen = useSyncExternalStore(subscribe, () => fold.isOpen(foldKey))
  const revealProcess = useCallback(() => { fold.set(foldKey, true) }, [fold, foldKey])
  const hidden = compactTranscript && isProcessMemberHidden({
    kind, anchorSeq, presentation: process, open: foldOpen, historyIncomplete,
  })
  // 保留成员挂载，让浏览器查找命中时通过官方机制展开所属轮。
  const searchable = useSearchableHidden(hidden, revealProcess)
  // 普通模式或过程尚未就绪时不提供无效控制行，成员内容保持可见。
  if (kind === 'turn-process' && (!compactTranscript || !canFoldProcess(process, historyIncomplete))) return null
  // 仅最终答案的内联推理随轮过程隐藏，正文与其他步骤保持原有呈现。
  const reasoningHidden = compactTranscript && canFoldProcess(process, historyIncomplete)
    && kind === 'assistant-step' && step === process.spec.answerStep
    && process.spec.inlineReasoning && !foldOpen
  return (
    <div ref={searchable} data-qs-process-member-hidden={hidden || undefined}>{renderRow(
      'qs.stage.transcript.row',
      { nodeKey, useNode, useProcess, loadImage, fold, fileMentions, renderMessageImages,
        reasoningHidden, revealProcess, useSearchableHidden },
      { entryKey: rowKeyOf(kind, available), hookContext: turnData },
    )}</div>
  )
}

/**
 * 渲染转写。
 * @param props - owner、子槽渲染器、inject 与 locale 四份共享面。
 * @returns 转写节点。
 */
export function Transcript(props: QsTranscriptProps): ReactNode {
  const {
    t, renderSlot, useChat, useSession, useSessionPendingInteraction,
    useNode, useProcess, sessionId, loadOlder, loadImage, fold, useQsHistory, retryHistory, readScroll, saveScroll,
  } = props
  const available = props.useQsRowKeys(keys => keys)
  const compactTranscript = props.useQsCompactTranscript(value => value)
  const order = useChat(s => s.order)
  const nodes = useChat(s => s.nodes)
  const ownMessage = useMemo(() => order.findLast((key) => {
    const kind = nodes.get(key)?.kind
    return kind === 'user' || kind === 'steering'
  }), [order, nodes])
  const steering = useSession(s => s.queue.findLast(item => item.placement === 'steering')?.id)
  const submission = useSession(s => s.pendingSubmissions.findLast(item => item.placement !== 'queued')?.requestId)
  const running = useSession(s => s.running)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const history = useQsHistory(s => s)
  const connected = props.useQsHistoryConnected(value => value)
  const pending = useSessionPendingInteraction(
    map => map.get(sessionId),
  )
  const renderMessageImages = useCallback<RenderMessageImages>(
    owner => renderSlot('qs.conversation.message.images', { ...owner, loadImage }), [renderSlot, loadImage],
  )
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const captureAnchor = useFollowLatest(
    scrollRef, order.at(-1), ownMessage, steering, submission, sessionId, readScroll, saveScroll, order[0],
  )

  useHistoryScroll({ sentinel: historyRef, sessionId, connected, openState, history, captureAnchor, loadOlder })

  return (
    <div className={styles.transcript} data-qs-transcript>
      <div ref={scrollRef} className={styles.scroll} data-qs-transcript-scroll>
        {openState === 'cold' || openState === 'loading' ? <p role="status">{t('history.opening')}</p> : null}
        {openState === 'error' ? <div role="alert">
          <p>{t('history.failed')} {openError?.message}</p>
          <button type="button" className="qs-text-button" onClick={retryHistory}>{t('history.retry')}</button>
        </div> : null}
        {/* 分页失败与初次打开失败分开，手动重试不强制重连或丢弃窗口。 */}
        {history.historyLoad.phase === 'failed' ? <p role="alert">{t('history.failed')}</p> : null}
        {/* 空页不代表历史结束；保留手动入口并解释自动加载暂停。 */}
        {history.hasMore && history.historyLoad.phase === 'succeeded' && !history.historyLoad.progressed
          ? <p role="status">{t('history.noProgress')}</p> : null}
        {history.hasMore ? (
          <div ref={historyRef} className={styles.history} data-qs-history-sentinel>
            <button
              type="button"
              className="qs-text-button"
              disabled={!connected || history.loadingOlder || openState !== 'open'}
              onClick={() => { captureAnchor(); loadOlder() }}
            >
              {t(history.loadingOlder ? 'history.loading' : history.historyLoad.phase === 'failed' ? 'history.retry' : 'history.loadMore')}
            </button>
          </div>
        ) : null}
        {order.length === 0 && openState === 'open' ? (
          <div className={styles.empty}>
            <strong>{t('empty.title')}</strong>
            <span>{t('empty.lead')}</span>
          </div>
        ) : null}
        <div data-qs-transcript-content>
          {order.map(nodeKey => (
            <div key={nodeKey} data-qs-node={nodeKey}><QsRowSeat
              key={nodeKey}
              available={available}
              useSearchableHidden={props.useSearchableHidden}
              compactTranscript={compactTranscript}
              historyIncomplete={history.hasMore}
              nodeKey={nodeKey}
              useNode={useNode}
              useProcess={useProcess}
              loadImage={loadImage} renderMessageImages={renderMessageImages}
              fileMentions={props.fileMentions}
              fold={fold}
              sessionId={sessionId}
              renderRow={renderSlot}
            /></div>
          ))}
        </div>
        {running || pending !== undefined ? (
          <div className={styles.pending} role="status">
            <i /><i /><i />
            {t('pending.label')}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 自动滚动：贴住最新，但用户上滚时不抢夺。
 *
 * 两点必须做对，否则跟随形同虚设：
 * 1. **滚动的不是本组件的 div**——`overflow-y: auto` 在 Stage 的外层容器上（标了
 *    `data-qs-scroll`），所以监听与设置 scrollTop 都要用那个祖先节点；
 * 2. **变化信号不能只看行数**——助手在同一行内持续输出时行数不变，必须用内容尺寸
 *    变化（ResizeObserver）作为"有新内容"的信号。
 *
 * 锚点保持：历史前插时不强制回到底部，只有"已在底部附近"才跟随。
 * @param ref - 转写根节点；实际滚动容器由它向上找。
 * @param tail - 当前窗口末尾的节点键，用于区分历史前插。
 * @param ownMessage - 最新用户消息或追加说明的节点键。
 * @param steering - 当前最新待提交追加说明的标识。
 * @param submission - 当前最新直接提交的标识，不包含排队消息。
 */
function useFollowLatest(
  ref: { readonly current: HTMLDivElement | null },
  tail: string | undefined,
  ownMessage: string | undefined,
  steering: string | undefined,
  submission: string | undefined,
  sessionId: string,
  readScroll: () => QsScrollPosition | undefined,
  saveScroll: (position: QsScrollPosition) => void,
  first: string | undefined,
): () => void {
  const followRef = useRef(true)
  const writtenTop = useRef<number | undefined>(undefined)
  const previous = useRef({ tail, ownMessage, steering, submission })
  const anchor = useRef<{ node: HTMLElement; offset: number } | undefined>(undefined)
  const latest = useRef({ readScroll, saveScroll })
  latest.current = { readScroll, saveScroll }
  const captureAnchor = useCallback((): void => {
    const scroller = ref.current?.closest<HTMLElement>('[data-qs-scroll]')
    if (scroller == null) return
    // 请求更早历史就是阅读历史的意图，短窗口也不能在前插后继续追随底部。
    followRef.current = false
    const top = scroller.getBoundingClientRect().top
    const node = [...scroller.querySelectorAll<HTMLElement>('[data-qs-node]')].find(item => item.getBoundingClientRect().bottom > top)
    anchor.current = node === undefined ? undefined : { node, offset: node.getBoundingClientRect().top - top }
  }, [ref])
  const restoreAnchor = (scroller: HTMLElement): boolean => {
    const held = anchor.current
    if (held === undefined || !held.node.isConnected) return false
    scroller.scrollTop += held.node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - held.offset
    writtenTop.current = scroller.scrollTop
    latest.current.saveScroll({ top: scroller.scrollTop, follow: followRef.current })
    return true
  }
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>('[data-qs-scroll]')
    if (scroller != null) restoreAnchor(scroller)
  }, [first, ref])

  useEffect(() => {
    const last = previous.current
    previous.current = { tail, ownMessage, steering, submission }
    const appended = (tail !== last.tail && ownMessage !== undefined && ownMessage !== last.ownMessage)
      || (steering !== undefined && steering !== last.steering)
      || (submission !== undefined && submission !== last.submission)
    if (!appended) return
    anchor.current = undefined
    followRef.current = true
    // 宿主或外部滚动容器缺失时，只更新跟随意图。
    const scroller = ref.current?.closest<HTMLElement>('[data-qs-scroll]')
    if (scroller != null) {
      scroller.scrollTop = scroller.scrollHeight
      writtenTop.current = scroller.scrollTop
    }
  }, [ref, tail, ownMessage, steering, submission])

  useEffect(() => {
    // 监听和尺寸观察需要宿主及滚动容器同时存在。
    const root = ref.current
    const scroller = root?.closest<HTMLElement>('[data-qs-scroll]')
    if (root === null || scroller == null) return
    // 锚点由本组件维护；浏览器原生补偿不能与前插补偿叠加，卸载时恢复原样。
    const originalAnchor = scroller.style.overflowAnchor
    scroller.style.overflowAnchor = 'none'
    const saved = latest.current.readScroll()
    const save = latest.current.saveScroll
    followRef.current = saved?.follow ?? true
    let restoreTop = saved !== undefined && !saved.follow ? saved.top : undefined

    const stick = (): void => {
      // 分页后的折叠、图片和工具详情可分帧改变尺寸，直到用户主动移动前保持同一阅读行。
      if (restoreAnchor(scroller)) return
      if (restoreTop !== undefined) {
        scroller.scrollTop = restoreTop
        writtenTop.current = scroller.scrollTop
        if (Math.abs(scroller.scrollTop - restoreTop) < 1) restoreTop = undefined
        return
      }
      if (!followRef.current) return
      scroller.scrollTop = scroller.scrollHeight
      writtenTop.current = scroller.scrollTop
      save({ top: scroller.scrollTop, follow: true })
    }
    const onScroll = (): void => {
      // A delayed event from our own scroll may arrive after content grows.
      if (scroller.scrollTop === writtenTop.current) return
      writtenTop.current = undefined
      anchor.current = undefined
      restoreTop = undefined
      followRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40
      save({ top: scroller.scrollTop, follow: followRef.current })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })

    // 行内增量不改变行数，所以用内容尺寸作为跟随信号。
    const observed = root
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(stick) : undefined
    observer?.observe(observed)
    stick()

    return () => {
      scroller.removeEventListener('scroll', onScroll)
      observer?.disconnect()
      scroller.style.overflowAnchor = originalAnchor
      anchor.current = undefined
    }
  }, [ref, sessionId])
  return captureAnchor
}

/** 图标占位保持导入稳定，供后续里程碑补充行内动作。 */
export const transcriptIcons = { spark: QsIcon }
