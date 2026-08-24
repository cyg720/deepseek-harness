// ChatView: the default conversation view — one stable keyed parent list over
// final business Nodes, plus paging, pending steering and bottom-follow.
// Each row dispatches through 'conversation.chat.node'; ui-tool owns the
// tool-call renderer and its recursive root/subcall composition. A Host
// open-path refusal from the injected opener is an in-page dialog here.
//
// Scroll: when nested under `[data-conversation-scroll]` (active conversation
// column), that host is the scrollport and this view is flow content; when
// mounted alone (unit tests), `.scroll` owns overflow. Bottom-follow and
// prepend anchoring always target the resolved scrollport.
//
// Render economics: order changes only when rows enter, leave or move. Each
// ChatNodeSeat subscribes to one Node key, so Assistant deltas and Tool
// lifecycle updates replace only their own row without remounting it.
/**
 * 文件职责：实现会话聊天界面的 ChatView 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示并操作会话聊天相关状态。
 * 逻辑维度：读取属性与状态，派生展示数据并响应交互。
 * 关键边界：异步状态、可访问性标签和空数据分支必须保持一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconChevronDownOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps, RenderMessageImages } from '../contract/slots.ts'
import { PendingSteeringBubble } from './MessageItem.tsx'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { formatRunDuration } from './message-chrome.ts'
import css from './ChatView.module.css'

/** 中文说明：当前组件的局部值 FOLLOW_THRESHOLD，由紧邻初始化决定。 */
const FOLLOW_THRESHOLD = 24

/** Active column host when present; otherwise the view-local scroller. */
/** 中文说明：函数 scrollerOf 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function scrollerOf(from: HTMLElement): HTMLElement {
  return (from.closest('[data-conversation-scroll]')) ?? from
}

/** 中文说明：类型或类 PagingAnchor 约束本文件的数据或组件职责。 */
interface PagingAnchor {
  /** Stable node/call identity, independent of boundary-spanning group keys. */
  key: string
  /** Row top relative to the scrollport after the latest user scroll. */
  top: number
}

/** Find an already-rendered settled row without interpolating a selector. */
/** 中文说明：函数 anchorElement 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  /** 中文说明：当前组件的局部值 row，由紧邻初始化决定。 */
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** Row position in scrollport coordinates (viewport-independent). */
/** 中文说明：函数 flowTop 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
/** 中文说明：函数 pagingAnchor 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  /** 中文说明：当前组件的局部值 viewport，由紧邻初始化决定。 */
  const viewport = scrollport.getBoundingClientRect()
  /** 中文说明：当前组件的局部值 composer，由紧邻初始化决定。 */
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  /** 中文说明：当前组件的局部值 visibleBottom，由紧邻初始化决定。 */
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // Scroll events are hot: hit-test a few points through the stretched flow
  // rows before considering the full mounted set. The fallback keeps jsdom
  // and pre-layout states deterministic; a virtualizer naturally bounds it.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    /** 中文说明：当前组件的局部值 content，由紧邻初始化决定。 */
    const content = list.getBoundingClientRect()
    /** 中文说明：当前组件的局部值 left，由紧邻初始化决定。 */
    const left = Math.max(viewport.left, content.left)
    /** 中文说明：当前组件的局部值 right，由紧邻初始化决定。 */
    const right = Math.min(viewport.right, content.right)
    /** 中文说明：当前组件的局部值 x，由紧邻初始化决定。 */
    const x = left + Math.max(0, right - left) / 2
    /** 中文说明：当前组件的局部值 height，由紧邻初始化决定。 */
    const height = visibleBottom - viewport.top
    /** 中文说明：当前组件的局部值 points，由紧邻初始化决定。 */
    const points = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)]
    /** 中文说明：当前组件的局部值 offset，由紧邻初始化决定。 */
    for (const offset of points) {
      /** 中文说明：当前组件的局部值 element，由紧邻初始化决定。 */
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        /** 中文说明：当前组件的局部值 row，由紧邻初始化决定。 */
        const row = element instanceof HTMLElement
          ? element.closest<HTMLElement>('[data-chat-anchor-key]')
          : null
        if (row !== null && list.contains(row)) return row
      }
    }
  }
  /** 中文说明：当前组件的局部值 rows，由紧邻初始化决定。 */
  const rows = [...list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
  /** 中文说明：当前组件的局部值 visibleRows，由紧邻初始化决定。 */
  const visibleRows = rows.filter((row) => {
    /** 中文说明：当前组件的局部值 rect，由紧邻初始化决定。 */
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return visibleRows[0] ?? rows[0] ?? null
}

/** 中文说明：类型或类 ChatScrollPosition 约束本文件的数据或组件职责。 */
type ChatScrollPosition = NonNullable<ReturnType<ChatViewSlotProps['chatScroll']['read']>>

/** Capture a reflow-resistant reader position from the current rendered window. */
/** 中文说明：函数 scrollPosition 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): ChatScrollPosition | null {
  /** 中文说明：当前组件的局部值 row，由紧邻初始化决定。 */
  const row = pagingAnchor(list, scrollport)
  /** 中文说明：当前组件的局部值 anchorKey，由紧邻初始化决定。 */
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

/** Host/OS refusal text for the file-open dialog; empty throws keep a locale fallback. */
/** 中文说明：函数 openFailureMessage 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function openFailureMessage(error: unknown, fallback: string): string {
  /** 中文说明：当前组件的局部值 message，由紧邻初始化决定。 */
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? fallback : message
}

/** ProducedFiles opens the session workspace as `.`. */
/** 中文说明：函数 isFolderOpenPath 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function isFolderOpenPath(path: string): boolean {
  return path === '.'
}

/** 中文说明：函数 runningTurnStartTime 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  /** 中文说明：当前组件的局部值 latest，由紧邻初始化决定。 */
  let latest: number | null = null
  /** 中文说明：当前组件的局部值 turn，由紧邻初始化决定。 */
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
}

/** Turn-level model activity label retained across first-token, tool, and streaming phases. */
/** 中文说明：函数 TurnStatus 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function TurnStatus({ startTime, t }: {
  /** The running turn's logged `turn/start` time; null falls back to mount
   *  time when that boundary is outside the window. */
  startTime: number | null
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}) {
  /** 中文说明：当前组件的局部值 [mountedAt]，由紧邻初始化决定。 */
  const [mountedAt] = useState(() => Date.now())
  // Anchored to turn/start so a mid-turn reload keeps the real
  // elapsed time and the final footer's Ran-for label matches this clock.
  /** 中文说明：当前组件的局部值 anchor，由紧邻初始化决定。 */
  const anchor = startTime ?? mountedAt
  /** 中文说明：当前组件的局部值 [elapsedMs, setElapsedMs]，由紧邻初始化决定。 */
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor))
  useEffect(() => {
    /** 中文说明：当前组件的局部值 tick，由紧邻初始化决定。 */
    const tick = (): void => {
      setElapsedMs(Math.max(0, Date.now() - anchor))
    }
    tick()
    /** 中文说明：当前组件的局部值 id，由紧邻初始化决定。 */
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [anchor])
  // Short turns keep the plain label; the clock only appears once the turn
  // has clearly been running for a while.
  /** 中文说明：当前组件的局部值 showClock，由紧邻初始化决定。 */
  const showClock = elapsedMs >= 15_000
  return (
    <div className={css.turnStatus} role="status" aria-live="polite">
      Deep diving...
      {showClock && (
        <span className={css.turnStatusClock} aria-hidden>
          {formatRunDuration(elapsedMs, t)}
        </span>
      )}
    </div>
  )
}

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
/** 中文说明：函数 ChatView 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function ChatView({
  useSession, useSessions, useStore, renderSlot, sessionId, openFile, loadOlder, loadImage, inspectCall, chatScroll, forkAt,
  fileMentions, t,
}: ChatViewSlotProps) {
  /** 中文说明：当前组件的局部值 order，由紧邻初始化决定。 */
  const order = useSession(s => s.chat.order)
  /** 中文说明：当前组件的局部值 nodeStore，由紧邻初始化决定。 */
  const nodeStore = useSession(s => s.chat.nodes)
  /** 中文说明：当前组件的局部值 timeline，由紧邻初始化决定。 */
  const timeline = useSession(s => s.chat.timeline)
  /** 中文说明：当前组件的局部值 inbox，由紧邻初始化决定。 */
  const inbox = useSession(s => s.queue)
  // Workspace root off the session list row: path summaries display relative to it.
  /** 中文说明：当前组件的局部值 cwd，由紧邻初始化决定。 */
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  /** 中文说明：当前组件的局部值 running，由紧邻初始化决定。 */
  const running = useSession(s => s.running)
  /** 中文说明：当前组件的局部值 openState，由紧邻初始化决定。 */
  const openState = useSession(s => s.openState)
  /** 中文说明：当前组件的局部值 openError，由紧邻初始化决定。 */
  const openError = useSession(s => s.openError)
  /** 中文说明：当前组件的局部值 hasMore，由紧邻初始化决定。 */
  const hasMore = useSession(s => s.hasMore)
  /** 中文说明：当前组件的局部值 loadingOlder，由紧邻初始化决定。 */
  const loadingOlder = useSession(s => s.loadingOlder)
  /** 中文说明：当前组件的局部值 selectedCallId，由紧邻初始化决定。 */
  const selectedCallId = useStore(s => s.selection?.callId)
  /** 中文说明：当前组件的局部值 解构结果，由紧邻初始化决定。 */
  const [fileOpenError, setFileOpenError] = useState<{ path: string; message: string } | null>(null)
  /** 中文说明：当前组件的局部值 解构结果，由紧邻初始化决定。 */
  const [fileOpenBusy, setFileOpenBusy] = useState(false)
  // Close/retry must ignore a settlement that started before the latest
  // gesture; otherwise a cancelled in-flight refusal reopens the dialog.
  /** 中文说明：当前组件的局部值 fileOpenRequest，由紧邻初始化决定。 */
  const fileOpenRequest = useRef(0)

  /** 中文说明：当前组件的局部值 requestOpenFile，由紧邻初始化决定。 */
  const requestOpenFile = useCallback((path: string) => {
    /** 中文说明：当前组件的局部值 id，由紧邻初始化决定。 */
    const id = ++fileOpenRequest.current
    setFileOpenBusy(true)
    void openFile(path).then(
      () => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError(null)
        setFileOpenBusy(false)
      },
      (error: unknown) => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError({
          path,
          message: openFailureMessage(
            error,
            t(isFolderOpenPath(path) ? 'fileOpen.folderUnknown' : 'fileOpen.unknown'),
          ),
        })
        setFileOpenBusy(false)
      },
    )
  }, [openFile, t])

  /** 中文说明：当前组件的局部值 closeFileOpenError，由紧邻初始化决定。 */
  const closeFileOpenError = useCallback(() => {
    fileOpenRequest.current += 1
    setFileOpenError(null)
    setFileOpenBusy(false)
  }, [])

  /** 中文说明：当前组件的局部值 pendingSteering，由紧邻初始化决定。 */
  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  /** 中文说明：当前组件的局部值 renderMessageImages，由紧邻初始化决定。 */
  const renderMessageImages = useCallback<RenderMessageImages>(
    owner => renderSlot('conversation.message.images', { ...owner, loadImage }),
    [loadImage, renderSlot],
  )
  /** 中文说明：当前组件的局部值 runningTurnStart，由紧邻初始化决定。 */
  const runningTurnStart = useMemo(() => runningTurnStartTime(timeline), [timeline])

  /** 中文说明：当前组件的局部值 listRef，由紧邻初始化决定。 */
  const listRef = useRef<HTMLDivElement | null>(null)
  /** 中文说明：当前组件的局部值 columnRef，由紧邻初始化决定。 */
  const columnRef = useRef<HTMLDivElement | null>(null)
  /** 中文说明：当前组件的局部值 atBottomRef，由紧邻初始化决定。 */
  const atBottomRef = useRef(true)
  /** 中文说明：当前组件的局部值 [atBottom, setAtBottom]，由紧邻初始化决定。 */
  const [atBottom, setAtBottom] = useState(true)
  /** Last position delivered or written on the main thread. */
  /** 中文说明：当前组件的局部值 observedTopRef，由紧邻初始化决定。 */
  const observedTopRef = useRef(0)
  /** Paging anchor: semantic row/position at click, updated by reader scrolls
   * while the request is pending and restored after the prepend lands. */
  /** 中文说明：当前组件的局部值 anchorRef，由紧邻初始化决定。 */
  const anchorRef = useRef<PagingAnchor | null>(null)
  /** 中文说明：当前组件的局部值 firstSeqRef，由紧邻初始化决定。 */
  const firstSeqRef = useRef<number | null>(null)
  /** 中文说明：当前组件的局部值 openedRef，由紧邻初始化决定。 */
  const openedRef = useRef(false)
  /** 中文说明：当前组件的局部值 lastKeyRef，由紧邻初始化决定。 */
  const lastKeyRef = useRef<string | null>(null)
  /** 中文说明：当前组件的局部值 lastSteeringIdRef，由紧邻初始化决定。 */
  const lastSteeringIdRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves, never on a
   *  scroll-driven at-bottom chrome re-render (which would snap inertial
   *  scrolls the rest of the way to the floor). */
  /** 中文说明：当前组件的局部值 followSigRef，由紧邻初始化决定。 */
  const followSigRef = useRef<string | null>(null)

  /** 中文说明：当前组件的局部值 firstKey，由紧邻初始化决定。 */
  const firstKey = order[0]
  /** 中文说明：当前组件的局部值 firstSeq，由紧邻初始化决定。 */
  const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
  /** 中文说明：当前组件的局部值 lastKey，由紧邻初始化决定。 */
  const lastKey = order.at(-1) ?? null
  /** 中文说明：当前组件的局部值 lastNode，由紧邻初始化决定。 */
  const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey)
  /** 中文说明：当前组件的局部值 lastSteeringId，由紧邻初始化决定。 */
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
  /** 中文说明：当前组件的局部值 followSig，由紧邻初始化决定。 */
  const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}`

  /** 中文说明：当前组件的局部值 toBottom，由紧邻初始化决定。 */
  const toBottom = (el: HTMLElement): void => {
    anchorRef.current = null
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    atBottomRef.current = true
    setAtBottom(true)
    chatScroll.save(null)
  }

  useLayoutEffect(() => {
    /** 中文说明：当前组件的局部值 local，由紧邻初始化决定。 */
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    /** 中文说明：当前组件的局部值 el，由紧邻初始化决定。 */
    const el = scrollerOf(local)
    // Open completed: jump to the bottom once — unless a scroll position
    // survives from a previous mount (view-tab switch away and back), which
    // is restored instead of snapping the reader back to the floor.
    if (openState === 'open' && !openedRef.current) {
      openedRef.current = true
      /** 中文说明：当前组件的局部值 saved，由紧邻初始化决定。 */
      const saved = chatScroll.read()
      if (saved === null) {
        toBottom(el)
      } else {
        el.scrollTop = saved.scrollTop
        /** 中文说明：当前组件的局部值 row，由紧邻初始化决定。 */
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        observedTopRef.current = el.scrollTop
        /** 中文说明：当前组件的局部值 isAtBottom，由紧邻初始化决定。 */
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
        /** 中文说明：当前组件的局部值 normalized，由紧邻初始化决定。 */
        const normalized = isAtBottom ? null : scrollPosition(local, el)
        if (isAtBottom) chatScroll.save(null)
        else if (normalized !== null) chatScroll.save(normalized)
      }
      firstSeqRef.current = firstSeq
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    // Prepend (head seq decreased): preserve the same settled row at the
    // position established by the reader's latest scroll. This excludes
    // unrelated tail/composer growth while the request was in flight.
    if (anchorRef.current !== null && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
      /** 中文说明：当前组件的局部值 anchor，由紧邻初始化决定。 */
      const anchor = anchorRef.current
      anchorRef.current = null
      /** 中文说明：当前组件的局部值 row，由紧邻初始化决定。 */
      const row = anchorElement(local, anchor.key)
      if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
      observedTopRef.current = el.scrollTop
      firstSeqRef.current = firstSeq
      /* v8 ignore next -- ?? arm: a prepend adds nodes, so the flow list here is never empty. */
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    firstSeqRef.current = firstSeq
    // Own words must be visible: a new trailing user node force-scrolls
    // (send lives in the composer, so arrival is detected here, not armed there).
    /** 中文说明：当前组件的局部值 appendedUser，由紧邻初始化决定。 */
    const appendedUser = lastKey !== lastKeyRef.current && lastNode?.kind === 'user'
    /** 中文说明：当前组件的局部值 appendedSteering，由紧邻初始化决定。 */
    const appendedSteering = lastSteeringId !== null && lastSteeringId !== lastSteeringIdRef.current
    /** 中文说明：当前组件的局部值 tipMoved，由紧邻初始化决定。 */
    const tipMoved = followSigRef.current !== followSig
    lastKeyRef.current = lastKey
    lastSteeringIdRef.current = lastSteeringId
    followSigRef.current = followSig
    // Follow new flow content while pinned; do NOT re-pin on every render
    // merely because atBottomRef is true (scroll threshold → setState → snap).
    if (appendedUser || appendedSteering || (tipMoved && atBottomRef.current)) toBottom(el)
  })

  /** 中文说明：当前组件的局部值 onScrollRef，由紧邻初始化决定。 */
  const onScrollRef = useRef(() => {})
  onScrollRef.current = () => {
    /** 中文说明：当前组件的局部值 local，由紧邻初始化决定。 */
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    /** 中文说明：当前组件的局部值 el，由紧邻初始化决定。 */
    const el = scrollerOf(local)
    // Only reader input may make raw scroll geometry change follow ownership:
    // a delivered position that deviates from the observed-top ledger (every
    // programmatic write records itself there synchronously). This covers
    // wheel, touch, scrollbar, and keyboard alike without naming devices.
    // Browser shrink-clamps land exactly on the floor min and delayed
    // programmatic deliveries land on the ledger itself, so both preserve
    // the current ownership state.
    /** 中文说明：当前组件的局部值 floor，由紧邻初始化决定。 */
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    /** 中文说明：当前组件的局部值 movedByReader，由紧邻初始化决定。 */
    const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5
    /** 中文说明：当前组件的局部值 isAtBottom，由紧邻初始化决定。 */
    const isAtBottom = movedByReader
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
      : atBottomRef.current
    if (!movedByReader && isAtBottom) {
      toBottom(el)
      return
    }
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    /** 中文说明：当前组件的局部值 position，由紧邻初始化决定。 */
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) {
      anchorRef.current = null
    } else if (anchorRef.current !== null && position !== null) {
      anchorRef.current = { key: position.anchorKey, top: position.anchorTop }
    }
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
    observedTopRef.current = el.scrollTop
  }

  // Bind the scroll listener on the resolved scrollport once per mount;
  // reader-input attribution rides the observed-top ledger, not per-device
  // input listeners.
  useEffect(() => {
    /** 中文说明：当前组件的局部值 local，由紧邻初始化决定。 */
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
    if (local === null) return
    /** 中文说明：当前组件的局部值 el，由紧邻初始化决定。 */
    const el = scrollerOf(local)
    /** 中文说明：当前组件的局部值 onScroll，由紧邻初始化决定。 */
    const onScroll = (): void => { onScrollRef.current() }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists.
  /** 中文说明：当前组件的局部值 followRef，由紧邻初始化决定。 */
  const followRef = useRef<(() => void) | null>(null)
  followRef.current = () => {
    /** 中文说明：当前组件的局部值 local，由紧邻初始化决定。 */
    const local = listRef.current
    if (local !== null && atBottomRef.current) {
      /** 中文说明：当前组件的局部值 el，由紧邻初始化决定。 */
      const el = scrollerOf(local)
      el.scrollTop = el.scrollHeight
      observedTopRef.current = el.scrollTop
      chatScroll.save(null)
    }
  }
  // Streaming, tool disclosures, and other flow changes resize the column;
  // the sticky composer resizes outside it. This observer owns ChatView's
  // dynamic-height follow decisions and writes only while the reader is pinned.
  useEffect(() => {
    /** 中文说明：当前组件的局部值 column，由紧邻初始化决定。 */
    const column = columnRef.current
    /** 中文说明：当前组件的局部值 local，由紧邻初始化决定。 */
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    /** 中文说明：当前组件的局部值 scrollport，由紧邻初始化决定。 */
    const scrollport = scrollerOf(local)
    /** 中文说明：当前组件的局部值 composer，由紧邻初始化决定。 */
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    /** 中文说明：当前组件的局部值 observer，由紧邻初始化决定。 */
    const observer = new ResizeObserver(() => { followRef.current?.() })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  // A failed/empty page leaves the head unchanged. Once the request leaves
  // its busy state there is no future prepend for the saved anchor to own.
  useEffect(() => {
    if (!loadingOlder) anchorRef.current = null
  }, [loadingOlder])

  /** 中文说明：当前组件的局部值 loadOlderAnchored，由紧邻初始化决定。 */
  const loadOlderAnchored = (): void => {
    /** 中文说明：当前组件的局部值 local，由紧邻初始化决定。 */
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
    if (local !== null) {
      /** 中文说明：当前组件的局部值 el，由紧邻初始化决定。 */
      const el = scrollerOf(local)
      /** 中文说明：当前组件的局部值 row，由紧邻初始化决定。 */
      const row = pagingAnchor(local, el)
      if (row !== null && row.dataset.chatAnchorKey !== undefined) {
        anchorRef.current = {
          key: row.dataset.chatAnchorKey,
          top: flowTop(row, el),
        }
      }
    }
    loadOlder()
  }

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll}>
        <div ref={columnRef} className={css.column} data-chat-flow="">
          {openState === 'loading' && <div className={css.hint}>{t('chat.loadingHistory')}</div>}
          {openState === 'error' && openError !== null && (
            <div className={css.openError}>
              {t('chat.loadError', { message: openError.message, code: openError.code })}
            </div>
          )}
          {hasMore && (
            <div className={css.older}>
              <button type="button" disabled={loadingOlder} onClick={loadOlderAnchored}>
                {loadingOlder ? t('loading') : t('chat.loadOlder')}
              </button>
            </div>
          )}
          {order.map(nodeKey => (
            <ChatNodeSeat
              key={nodeKey}
              nodeKey={nodeKey}
              useSession={useSession}
              selectedCallId={selectedCallId}
              cwd={cwd}
              openFile={requestOpenFile}
              inspectCall={inspectCall}
              forkAt={forkAt}
              renderMessageImages={renderMessageImages}
              fileMentions={fileMentions}
              renderSlot={renderSlot}
              t={t}
            />
          ))}
          {/* No pending placeholders: questions (ui-user-questions) and approvals
              (ApprovalPanel) both take over the composer, so a flow card would
              double-render the same wait. */}
          {/* Turn-level loading signal: rides the whole running turn (first-token
              wait, tool execution, streaming) so it never flickers per step. */}
          {running && <TurnStatus startTime={runningTurnStart} t={t} />}
          {pendingSteering.map(item => (
            <PendingSteeringBubble
              key={item.id}
              content={item.content}
              renderMessageImages={renderMessageImages}
              t={t}
            />
          ))}
        </div>
        {!atBottom && (
          <div className={css.toBottomSlot}>
            <button
              type="button"
              className={css.toBottom}
              aria-label={t('chat.toBottom')}
              onClick={() => {
                /** 中文说明：当前组件的局部值 local，由紧邻初始化决定。 */
                const local = listRef.current
                /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
                if (local !== null) toBottom(scrollerOf(local))
              }}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        )}
      </div>
      {fileOpenError !== null && (
        <FileOpenErrorDialog
          path={fileOpenError.path}
          message={fileOpenError.message}
          busy={fileOpenBusy}
          onClose={closeFileOpenError}
          onRetry={() => { requestOpenFile(fileOpenError.path) }}
          t={t}
        />
      )}
    </div>
  )
}

/** In-page Host open-path refusal: the wire reason plus a retry of the same path. */
/** 中文说明：函数 FileOpenErrorDialog 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function FileOpenErrorDialog({
  path, message, busy, onClose, onRetry, t,
}: {
  path: string
  message: string
  busy: boolean
  onClose: () => void
  onRetry: () => void
  t: ChatViewSlotProps['t']
}) {
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t(isFolderOpenPath(path) ? 'fileOpen.folderTitle' : 'fileOpen.title')}
      description={message}
      footer={(
        <>
          <Button variant="outline" className={css.modalAction} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" className={css.modalAction} disabled={busy} onClick={onRetry}>{t('retry')}</Button>
        </>
      )}
    />
  )
}
