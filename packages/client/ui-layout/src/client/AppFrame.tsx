/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
/*
 * 文件职责：实现应用布局的 AppFrame 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：支持用户查看或调整应用布局。
 * 逻辑维度：读取服务状态，派生展示值并处理交互。
 * 关键边界：加载、禁用、错误和可访问性状态必须一致。
 * 新手阅读建议：先读 Props，再看状态、effect 与 JSX。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
/* 中文说明：类型或类 AppFrameProps 约束本文件数据或组件职责。 */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>

/** Center column grid item (session-body building block). */
/* 中文说明：函数 CenterColumn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
/* 中文说明：函数 DetailsColumn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
/* 中文说明：函数 DragHandle 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function DragHandle(props: { side: 'sidebar' | 'details'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  /** 中文说明：组件局部值 [dragging, setDragging]，由紧邻初始化决定。 */
  const [dragging, setDragging] = useState(false)
  /** 中文说明：组件局部值 origin，由紧邻初始化决定。 */
  const origin = useRef(0)
  /** 中文说明：组件局部值 latest，由紧邻初始化决定。 */
  const latest = useRef(0)
  /** 中文说明：组件局部值 frame，由紧邻初始化决定。 */
  const frame = useRef<number | null>(null)
  /** 中文说明：组件局部值 callbacks，由紧邻初始化决定。 */
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  /** 中文说明：组件局部值 onPointerDown，由紧邻初始化决定。 */
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  /** 中文说明：组件局部值 onPointerMove，由紧邻初始化决定。 */
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  /** 中文说明：组件局部值 onPointerUp，由紧邻初始化决定。 */
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column frame (see module doc). */
/* 中文说明：函数 AppFrame 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
}: AppFrameProps) {
  /** 中文说明：组件局部值 panels，由紧邻初始化决定。 */
  const panels = useStore(s => s)
  /** 中文说明：组件局部值 detailsSession，由紧邻初始化决定。 */
  const detailsSession = useSessions((s) => {
    /** 中文说明：组件局部值 current，由紧邻初始化决定。 */
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  /** 中文说明：组件局部值 frameRef，由紧邻初始化决定。 */
  const frameRef = useRef<HTMLDivElement | null>(null)
  /** 中文说明：组件局部值 [viewport, setViewport]，由紧邻初始化决定。 */
  const [viewport, setViewport] = useState(() => window.innerWidth)

  /** 中文说明：组件局部值 lastSession，由紧邻初始化决定。 */
  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    /** 中文说明：组件局部值 el，由紧邻初始化决定。 */
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    /** 中文说明：组件局部值 raf，由紧邻初始化决定。 */
    let raf: number | null = null
    /** 中文说明：组件局部值 observer，由紧邻初始化决定。 */
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        /** 中文说明：组件局部值 width，由紧邻初始化决定。 */
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  /** 中文说明：组件局部值 narrow，由紧邻初始化决定。 */
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  /** 中文说明：组件局部值 sidebarCollapsed，由紧邻初始化决定。 */
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  /** 中文说明：组件局部值 sidebarPreference，由紧邻初始化决定。 */
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  /** 中文说明：组件局部值 cols，由紧邻初始化决定。 */
  const cols = computeColumns(viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details)
  /** 中文说明：组件局部值 colsRef，由紧邻初始化决定。 */
  const colsRef = useRef(cols)
  colsRef.current = cols

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  /** 中文说明：组件局部值 sidebarBase，由紧邻初始化决定。 */
  const sidebarBase = useRef(0)
  /** 中文说明：组件局部值 detailsBase，由紧邻初始化决定。 */
  const detailsBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  /** 中文说明：组件局部值 [dragging, setDragging]，由紧邻初始化决定。 */
  const [dragging, setDragging] = useState(false)
  /** 中文说明：组件局部值 onDragEnd，由紧邻初始化决定。 */
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  /** 中文说明：组件局部值 onSidebarStart，由紧邻初始化决定。 */
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  /** 中文说明：组件局部值 onDetailsStart，由紧邻初始化决定。 */
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  /** 中文说明：组件局部值 onSidebarDrag，由紧邻初始化决定。 */
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  /** 中文说明：组件局部值 onDetailsDrag，由紧邻初始化决定。 */
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-dragging={dragging || undefined}
    >
      <div className={css.sidebarCol}>
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). */}
        {renderSlot('sidebar', {
          collapsed: sidebarCollapsed,
          width: cols.sidebar,
        })}
      </div>
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; the strict details entry naturally renders
            empty while no session is current. */}
        <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
        <DetailsColumn>{renderSlot('details', {})}</DetailsColumn>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {cols.details > 0 && <DragHandle side="details" left={viewport - cols.details} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
    </div>
  )
}
