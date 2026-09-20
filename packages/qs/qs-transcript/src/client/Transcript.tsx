/**
 * 转写宿主。
 *
 * 订阅面：`useChat(s => s.order)` 只取稳定的行键顺序，**不**在流式增量上重转全量历史；
 * 每行的数据由行组件自己的 `useNode` 座席订阅（本 entry 的 keyedHooks 绑定结果），
 * 并经 `QsRowSeat` 显式传给行——"注册了子槽就自动获得 keyedHooks"不成立（见 R29）。
 *
 * 交互卡片位：在行列表末尾渲染 `qs.stage.interaction`（chain），先取当前 pending，
 * 再把选择器需要的每个字段显式传入（宿主不传字段卡片就永不出现，见 R27）。
 */
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { QsScrollPosition, QsTranscriptInjected } from './contract.ts'
import { rowKeyOf } from './adapter.ts'
import { QsIcon } from './Icon.tsx'
import styles from './transcript.module.css'

/** 转写条目的完整 props。 */
export type QsTranscriptProps =
  PropsRuntime<'qs.stage.transcript'>
  & PropsRenderSlots<'qs.stage.transcript.row' | 'qs.stage.interaction'>
  & InjectFace<QsTranscriptInjected>
  & PropsLocale<'qs-transcript'>

/** 行分派座席的输入：行键、订阅座席与父 entry 的 renderSlot 委托。 */
interface RowSeatProps {
  readonly nodeKey: string
  readonly useNode: QsTranscriptProps['useNode']
  readonly useProcess: QsTranscriptProps['useProcess']
  readonly renderRow: PropsRenderSlots<'qs.stage.transcript.row'>['renderSlot']
}

/**
 * 单行分派座席。
 *
 * 先按行键订阅该行、读出 kind，再据此选用行组件——这是官方 ChatNodeSeat 的形状：
 * 每个 seat 自己调用一次绑定好的 keyed hook，因此 hook 调用次数与行数一一对应，
 * 不会在宿主里形成循环内的 hook 调用。
 * @param props - 行键、订阅座席与 renderSlot 委托。
 * @returns 该行的渲染结果。
 */
function QsRowSeat({ nodeKey, useNode, useProcess, renderRow }: RowSeatProps): ReactNode {
  const kind = useNode(nodeKey, node => node?.kind ?? '')
  return <>{renderRow('qs.stage.transcript.row', { nodeKey, useNode, useProcess }, { entryKey: rowKeyOf(kind) })}</>
}

/**
 * 渲染转写。
 * @param props - owner、子槽渲染器、inject 与 locale 四份共享面。
 * @returns 转写节点。
 */
export function Transcript(props: QsTranscriptProps): ReactNode {
  const {
    t, renderSlot, renderSlotChain, useChat, useSession, useSessionPendingInteraction,
    useNode, useProcess, sessionId, loadOlder, useQsHistory, retryHistory, readScroll, saveScroll,
  } = props
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
  const pending = useSessionPendingInteraction(
    map => map.get(sessionId),
  )
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const captureAnchor = useFollowLatest(
    scrollRef, order.at(-1), ownMessage, steering, submission, sessionId, readScroll, saveScroll, order[0],
  )

  return (
    <div className={styles.transcript} data-qs-transcript>
      <div ref={scrollRef} className={styles.scroll} data-qs-transcript-scroll>
        {openState === 'cold' || openState === 'loading' ? <p role="status">{t('history.opening')}</p> : null}
        {openState === 'error' ? <div role="alert">
          <p>{t('history.failed')} {openError?.message}</p>
          <button type="button" className="qs-text-button" onClick={retryHistory}>{t('history.retry')}</button>
        </div> : null}
        {history.hasMore ? (
          <div className={styles.history}>
            <button
              type="button"
              className="qs-text-button"
              disabled={history.loadingOlder || openState !== 'open'}
              onClick={() => { captureAnchor(); loadOlder() }}
            >
              {t(history.loadingOlder ? 'history.loading' : 'history.loadMore')}
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
              nodeKey={nodeKey}
              useNode={useNode}
              useProcess={useProcess}
              renderRow={renderSlot}
            /></div>
          ))}
        </div>
        {renderSlotChain(
          'qs.stage.interaction',
          { sessionId, pendingInteraction: pending },
          { fallback: null },
        )}
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
  const captureAnchor = (): void => {
    const scroller = ref.current?.closest<HTMLElement>('[data-qs-scroll]')
    if (scroller == null) return
    const top = scroller.getBoundingClientRect().top
    const node = [...scroller.querySelectorAll<HTMLElement>('[data-qs-node]')].find(item => item.getBoundingClientRect().bottom > top)
    anchor.current = node === undefined ? undefined : { node, offset: node.getBoundingClientRect().top - top }
  }
  useLayoutEffect(() => {
    const held = anchor.current
    const scroller = ref.current?.closest<HTMLElement>('[data-qs-scroll]')
    if (held === undefined || scroller == null || !held.node.isConnected) return
    scroller.scrollTop += held.node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - held.offset
    writtenTop.current = scroller.scrollTop
    latest.current.saveScroll({ top: scroller.scrollTop, follow: followRef.current })
    anchor.current = undefined
  }, [first, ref])

  useEffect(() => {
    const last = previous.current
    previous.current = { tail, ownMessage, steering, submission }
    const appended = (tail !== last.tail && ownMessage !== undefined && ownMessage !== last.ownMessage)
      || (steering !== undefined && steering !== last.steering)
      || (submission !== undefined && submission !== last.submission)
    if (!appended) return
    followRef.current = true
    const scroller = ref.current === null ? null : scrollportOf(ref.current)
    if (scroller !== null) {
      scroller.scrollTop = scroller.scrollHeight
      writtenTop.current = scroller.scrollTop
    }
  }, [ref, tail, ownMessage, steering, submission])

  useEffect(() => {
    const root = ref.current
    if (root === null) return
    const scroller = scrollportOf(root)
    if (scroller === null) return
    const saved = latest.current.readScroll()
    const save = latest.current.saveScroll
    followRef.current = saved?.follow ?? true
    let restoreTop = saved !== undefined && !saved.follow ? saved.top : undefined

    const stick = (): void => {
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
    }
  }, [ref, sessionId])
  return captureAnchor
}

/**
 * 向上寻找真正的滚动容器。
 * @param node - 转写根节点。
 * @returns 最近的 `[data-qs-scroll]` 祖先；找不到时为 null。
 */
function scrollportOf(node: HTMLElement): HTMLElement | null {
  return node.closest<HTMLElement>('[data-qs-scroll]')
}

/** 图标占位保持导入稳定，供后续里程碑补充行内动作。 */
export const transcriptIcons = { spark: QsIcon }
