/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace) as 36px controls on the shell's shared
 * rail entry path, each requesting expansion through the owner share. Adding
 * is the header button's one action, so it raises the directory flow with no
 * menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them).
 */
/**
 * 文件职责：实现工作区浏览的 WorkspaceBrowser 组件。
 * 技术维度：React、TypeScript、Cordis 插槽、外部 Store 和 CSS Modules。
 * 产品维度：支持用户查看或操作工作区浏览。
 * 逻辑维度：读取状态，派生展示数据，处理操作并渲染界面。
 * 关键边界：异步状态、空状态、虚拟滚动和可访问性必须一致。
 * 新手阅读建议：先读 Props，再看状态选择、事件和 JSX。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconCloseFill14, IconPersonalizationOutline16,
  IconProjectAddOutline16, IconSearchOutline16, Menu, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionId, SessionListState, SessionSearchResultItem, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { SessionNode, SessionOrderBy } from './tree.ts'
import { deriveFlat, deriveGroups, deriveSearchResults, UNGROUPED_KEY } from './tree.ts'
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from './rows/Rows.tsx'
import { FLAT_SESSION_ORDER_KEY } from './stores.ts'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import css from './WorkspaceBrowser.module.css'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
/** 中文说明：组件局部值 EXPAND_SLIDE_MS，由紧邻初始化决定。 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
/** 中文说明：组件局部值 SEARCH_DEBOUNCE_MS，由紧邻初始化决定。 */
const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
/** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
const SEARCH_QUERY_MAX_CODE_UNITS = 500
/** Session rows visible per Workspace before the local overflow control. */
/** 中文说明：组件局部值 COLLAPSED_SESSION_LIMIT，由紧邻初始化决定。 */
const COLLAPSED_SESSION_LIMIT = 5

/** Keep controlled input and RPC payload inside the session.search wire contract. */
/** 中文说明：函数 sanitizeSearchQuery 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sanitizeSearchQuery(value: string): string {
  /** 中文说明：组件局部值 withoutNul，由紧邻初始化决定。 */
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  /** 中文说明：组件局部值 end，由紧邻初始化决定。 */
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  /** 中文说明：组件局部值 last，由紧邻初始化决定。 */
  const last = withoutNul.charCodeAt(end - 1)
  /** 中文说明：组件局部值 next，由紧邻初始化决定。 */
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/** Immutable membership toggle for the local expand-all array. */
/** 中文说明：函数 toggled 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function toggled(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key]
}

/**
 * Accept the native drag at document level while a row drag is active: row
 * hover still owns the insertion marker, and releasing outside the list must
 * not be rendered as a rejected drop before dragend commits that last marker.
 */
/** 中文说明：函数 useNativeDragAcceptance 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    /** 中文说明：组件局部值 acceptDrag，由紧邻初始化决定。 */
    const acceptDrag = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    /** 中文说明：组件局部值 acceptDrop，由紧邻初始化决定。 */
    const acceptDrop = (event: DragEvent): void => { event.preventDefault() }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}

/** Reconcile a stored view order with the Workspace's current session account. */
/** 中文说明：函数 reconciledSessionOrder 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function reconciledSessionOrder(sessionIds: readonly SessionId[], stored: readonly string[] | undefined): SessionId[] {
  if (stored === undefined) return [...sessionIds]
  /** 中文说明：组件局部值 byId，由紧邻初始化决定。 */
  const byId = new Map(sessionIds.map(id => [id as string, id]))
  /** 中文说明：组件局部值 ordered，由紧邻初始化决定。 */
  const ordered: SessionId[] = []
  /** 中文说明：组件局部值 included，由紧邻初始化决定。 */
  const included = new Set<string>()
  /** 中文说明：组件局部值 key，由紧邻初始化决定。 */
  for (const key of stored) {
    /** 中文说明：组件局部值 id，由紧邻初始化决定。 */
    const id = byId.get(key)
    if (id === undefined || included.has(key)) continue
    ordered.push(id)
    included.add(key)
  }
  /** 中文说明：组件局部值 id，由紧邻初始化决定。 */
  for (const id of sessionIds) {
    if (included.has(id)) continue
    ordered.push(id)
  }
  return ordered
}

/** Newest update first with stable Session identity as the tie-break. */
/** 中文说明：函数 compareSessionRecency 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function compareSessionRecency(a: SessionId, b: SessionId, byId: SessionListState['byId']): number {
  /** 中文说明：组件局部值 aUpdatedAt，由紧邻初始化决定。 */
  const aUpdatedAt = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY
  /** 中文说明：组件局部值 bUpdatedAt，由紧邻初始化决定。 */
  const bUpdatedAt = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY
  if (aUpdatedAt !== bUpdatedAt) return bUpdatedAt - aUpdatedAt
  return a < b ? -1 : 1
}

/** Reconcile one editable order account and apply its activity-promotion policy. */
/** 中文说明：函数 nextSessionOrderAccount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function nextSessionOrderAccount({
  sessionIds, previousOrder, previousUpdatedAt, list, orderBy, sortByRecency,
}: {
  sessionIds: readonly SessionId[]
  previousOrder: readonly string[] | undefined
  previousUpdatedAt: Readonly<Record<string, number>>
  list: SessionListState
  orderBy: SessionOrderBy
  sortByRecency: boolean
}): { order: SessionId[]; updatedAt: Record<string, number>; changed: boolean } {
  /** 中文说明：组件局部值 order，由紧邻初始化决定。 */
  let order = reconciledSessionOrder(sessionIds, previousOrder)
  if (sortByRecency) {
    order.sort((a, b) => compareSessionRecency(a, b, list.byId))
  } else if (orderBy === 'updated') {
    /** 中文说明：组件局部值 promoted，由紧邻初始化决定。 */
    const promoted = sessionIds
      .filter((id) => {
        /** 中文说明：组件局部值 session，由紧邻初始化决定。 */
        const session = list.byId[id]
        return session !== undefined
          && (previousUpdatedAt[id] === undefined || session.updatedAt > previousUpdatedAt[id])
      })
      .sort((a, b) => compareSessionRecency(a, b, list.byId))
    if (promoted.length > 0) {
      /** 中文说明：组件局部值 promotedIds，由紧邻初始化决定。 */
      const promotedIds = new Set(promoted)
      order = [...promoted, ...order.filter(id => !promotedIds.has(id))]
    }
  }
  /** 中文说明：组件局部值 updatedAt，由紧邻初始化决定。 */
  const updatedAt: Record<string, number> = {}
  /** 中文说明：组件局部值 id，由紧邻初始化决定。 */
  for (const id of sessionIds) {
    /** 中文说明：组件局部值 session，由紧邻初始化决定。 */
    const session = list.byId[id]
    if (session !== undefined) updatedAt[id] = session.updatedAt
  }
  /** 中文说明：组件局部值 orderChanged，由紧邻初始化决定。 */
  const orderChanged = previousOrder === undefined
    || order.length !== previousOrder.length
    || order.some((id, index) => id !== previousOrder[index])
  /** 中文说明：组件局部值 timestampsChanged，由紧邻初始化决定。 */
  const timestampsChanged = Object.keys(updatedAt).length !== Object.keys(previousUpdatedAt).length
    || Object.entries(updatedAt).some(([id, timestamp]) => previousUpdatedAt[id] !== timestamp)
  return { order, updatedAt, changed: orderChanged || timestampsChanged }
}

/** Grouping and ordering menu; own open state so it resets with the wide chrome. */
/** 中文说明：函数 ViewOptionsMenu 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }: {
  groupBy: 'workspace' | 'flat'
  orderBy: SessionOrderBy
  onGroupPick: (mode: 'workspace' | 'flat') => void
  onOrderPick: (mode: SessionOrderBy) => void
  t: WorkspaceBrowserProps['t']
}) {
  /** 中文说明：组件局部值 [open, setOpen]，由紧邻初始化决定。 */
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace') },
        { id: 'flat', label: t('groupBy.flat') },
        { type: 'separator' as const, id: 'order-by-separator' },
        { type: 'label' as const, id: 'order-by', text: t('orderBy.label') },
        { id: 'manual', label: t('orderBy.manual') },
        { id: 'updated', label: t('orderBy.updated') },
      ]}
      selectedIds={[groupBy, orderBy]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'flat') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        setOpen(false)
      }}
      align="end"
      dense
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal
      anchor={(
        <Tooltip label={t('viewOptions.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.wide)}
            aria-label={t('viewOptions.label')}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconPersonalizationOutline16 />
          </button>
        </Tooltip>
      )}
    />
  )
}

/** In-flight root-row drag: source identity plus the current insert marker. */
/** 中文说明：类型或类 DragState 约束模块数据或组件职责。 */
interface DragState {
  /** Workspace id, or {@link UNGROUPED_KEY} for the browser-local loose-session account. */
  accountKey: string
  sessionId: SessionNode['id']
  /** Row the marker sits on and which half (insert above/below it). */
  over: { id: SessionNode['id']; half: 'before' | 'after' } | null
}

/** In-flight Workspace-row drag: source identity plus the current marker. */
/** 中文说明：类型或类 WorkspaceDragState 约束模块数据或组件职责。 */
interface WorkspaceDragState {
  workspaceId: WorkspaceId
  over: { id: WorkspaceId; half: 'before' | 'after' } | null
}

/** Resolve an insertion side from the full rendered workspace group. */
/** 中文说明：函数 workspaceGroupHalf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function workspaceGroupHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  /** 中文说明：组件局部值 rect，由紧邻初始化决定。 */
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/** 中文说明：类型或类 SessionTreeProps 约束模块数据或组件职责。 */
type SessionTreeProps = Pick<
  WorkspaceBrowserProps,
  'useSessions' | 'startSession' | 'open' | 'forkSession'
  | 'insertWorkspaceBefore' | 'insertSessionBefore' | 't'
> & {
  /** Host account home for POSIX hover-path abbreviation. */
  home?: string | undefined
  workspaces: readonly WorkspaceView[]
  /** Explicit persisted zero-or-five-session state by Workspace group. */
  groupExpansion: Readonly<Record<string, boolean>>
  /** Persist one Workspace group's zero-or-five-session state. */
  setGroupExpanded: (key: string, expanded: boolean) => void
  /** Shared editable orders used by Workspace groups and the flat-list account. */
  sessionOrderByAccount: Readonly<Record<string, readonly string[]>>
  /** Last update timestamps observed for one-time recent-update promotions. */
  sessionUpdatedAtByAccount: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** Replace one shared order and its observed timestamps. */
  syncSessionOrderAccount: (accountKey: string, order: string[], updatedAt: Record<string, number>) => void
  /** Apply a drag to one shared order. */
  setSessionOrder: (accountKey: string, order: string[]) => void
  /** Registry-global archive set (hidden rows). */
  archivedSessionIds: readonly SessionNode['id'][]
  /** Open the browser-owned rename dialog for a real Workspace group. */
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned delete-confirmation dialog for a real Workspace group. */
  onDeleteRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned session rename dialog. */
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** Archive a session (row menu action; the row disappears on the state echo). */
  onSessionArchive: (sessionId: SessionNode['id']) => void
  /** Session order behavior: fixed after edits, or additionally promoted by user activity. */
  orderBy: SessionOrderBy
}

/** The scrolling session tree; unmounting drops the sessions subscription and expand-all state. */
/** 中文说明：函数 SessionTree 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function SessionTree({
  useSessions, startSession, open, forkSession, workspaces, archivedSessionIds,
  onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive,
  insertWorkspaceBefore, insertSessionBefore, orderBy,
  groupExpansion, setGroupExpanded,
  sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, home, t,
}: SessionTreeProps) {
  /** 中文说明：组件局部值 list，由紧邻初始化决定。 */
  const list = useSessions(s => s)
  /** 中文说明：组件局部值 current，由紧邻初始化决定。 */
  const current = list.current
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<string[]>([])
  // Transient drag marker state; the selected mode owns the resulting order.
  /** 中文说明：组件局部值 [drag, setDrag]，由紧邻初始化决定。 */
  const [drag, setDrag] = useState<DragState | null>(null)
  /** 中文说明：组件局部值 sessionDropCommitted，由紧邻初始化决定。 */
  const sessionDropCommitted = useRef(false)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [workspaceDrag, setWorkspaceDrag] = useState<WorkspaceDragState | null>(null)
  /** 中文说明：组件局部值 workspaceDropCommitted，由紧邻初始化决定。 */
  const workspaceDropCommitted = useRef(false)
  /** 中文说明：组件局部值 previousOrderBy，由紧邻初始化决定。 */
  const previousOrderBy = useRef(orderBy)
  /** 中文说明：组件局部值 nativeDragActive，由紧邻初始化决定。 */
  const nativeDragActive = drag !== null || workspaceDrag !== null
  useNativeDragAcceptance(nativeDragActive)
  /** 中文说明：组件局部值 currentGroup，由紧邻初始化决定。 */
  const currentGroup = current === undefined
    ? undefined
    : (workspaces.find(w => w.sessionIds.includes(current))?.workspaceId as string | undefined)
      ?? UNGROUPED_KEY
  useEffect(() => {
    if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup)) return
    setGroupExpanded(currentGroup, true)
  }, [current, currentGroup, setGroupExpanded, groupExpansion])
  /** 中文说明：组件局部值 expandedGroups，由紧邻初始化决定。 */
  const expandedGroups = useMemo(
    () => Object.entries(groupExpansion).filter(([, expanded]) => expanded).map(([key]) => key),
    [groupExpansion],
  )
  /** 中文说明：组件局部值 ungroupedSessionIds，由紧邻初始化决定。 */
  const ungroupedSessionIds = useMemo(() => {
    /** 中文说明：组件局部值 accounted，由紧邻初始化决定。 */
    const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
    return list.ids.filter(id => list.byId[id] !== undefined && !accounted.has(id))
  }, [list, workspaces])
  useEffect(() => {
    if (list.phase !== 'ready') return
    /** 中文说明：组件局部值 switchedToUpdated，由紧邻初始化决定。 */
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    previousOrderBy.current = orderBy
    /** 中文说明：组件局部值 accounts，由紧邻初始化决定。 */
    const accounts = [
      ...workspaces.map(workspace => ({
        key: workspace.workspaceId as string,
        sessionIds: workspace.sessionIds.filter(id => list.byId[id] !== undefined),
      })),
      { key: UNGROUPED_KEY, sessionIds: ungroupedSessionIds },
    ]
    /** 中文说明：组件局部值 {，由紧邻初始化决定。 */
    for (const { key, sessionIds } of accounts) {
      /** 中文说明：组件局部值 previousOrder，由紧邻初始化决定。 */
      const previousOrder = sessionOrderByAccount[key]
      /** 中文说明：组件局部值 previousUpdatedAt，由紧邻初始化决定。 */
      const previousUpdatedAt = sessionUpdatedAtByAccount[key] ?? {}
      /** 中文说明：组件局部值 next，由紧邻初始化决定。 */
      const next = nextSessionOrderAccount({
        sessionIds,
        previousOrder,
        previousUpdatedAt,
        list,
        orderBy,
        sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
      })
      if (next.changed) {
        syncSessionOrderAccount(key, next.order.map(id => id as string), next.updatedAt)
      }
    }
  }, [list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, ungroupedSessionIds, workspaces])
  /** 中文说明：组件局部值 orderedWorkspaces，由紧邻初始化决定。 */
  const orderedWorkspaces = useMemo(() => {
    return workspaces.map((workspace) => {
      /** 中文说明：组件局部值 stored，由紧邻初始化决定。 */
      const stored = sessionOrderByAccount[workspace.workspaceId as string]
      /** 中文说明：组件局部值 sessionIds，由紧邻初始化决定。 */
      const sessionIds = reconciledSessionOrder(workspace.sessionIds, stored)
      return { ...workspace, sessionIds }
    })
  }, [sessionOrderByAccount, workspaces])
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const orderedUngroupedSessionIds = useMemo(
    () => reconciledSessionOrder(ungroupedSessionIds, sessionOrderByAccount[UNGROUPED_KEY]),
    [sessionOrderByAccount, ungroupedSessionIds],
  )
  /** 中文说明：组件局部值 groups，由紧邻初始化决定。 */
  const groups = useMemo(
    () => deriveGroups(list, orderedWorkspaces, archivedSessionIds, {
      expandedGroups,
      ...(sessionOrderByAccount[UNGROUPED_KEY] === undefined
        ? {}
        : { ungroupedOrder: sessionOrderByAccount[UNGROUPED_KEY] }),
    }),
    [list, orderedWorkspaces, archivedSessionIds, expandedGroups, sessionOrderByAccount],
  )
  /** 中文说明：组件局部值 now，由紧邻初始化决定。 */
  const now = Date.now()
  /** 中文说明：组件局部值 commitSessionDrag，由紧邻初始化决定。 */
  const commitSessionDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (sessionDropCommitted.current) return
    sessionDropCommitted.current = true
    setDrag(null)
    /** 中文说明：组件局部值 group，由紧邻初始化决定。 */
    const group = groups.find(candidate => candidate.key === activeDrag.accountKey)
    if (group === undefined) return
    /** 中文说明：组件局部值 targetIndex，由紧邻初始化决定。 */
    const targetIndex = group.sessions.findIndex(session => session.id === over.id)
    if (targetIndex === -1) return
    /** 中文说明：组件局部值 anchor，由紧邻初始化决定。 */
    const anchor = over.half === 'before' ? over.id : group.sessions[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    /** 中文说明：组件局部值 sourceIndex，由紧邻初始化决定。 */
    const sourceIndex = group.sessions.findIndex(session => session.id === activeDrag.sessionId)
    /** 中文说明：组件局部值 anchorIndex，由紧邻初始化决定。 */
    const anchorIndex = anchor === undefined
      ? group.sessions.length
      : group.sessions.findIndex(session => session.id === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    /** 中文说明：组件局部值 accountSessionIds，由紧邻初始化决定。 */
    const accountSessionIds = activeDrag.accountKey === UNGROUPED_KEY
      ? orderedUngroupedSessionIds
      : orderedWorkspaces.find(workspace => workspace.workspaceId === activeDrag.accountKey)?.sessionIds
    if (accountSessionIds === undefined) return
    /** 中文说明：组件局部值 nextOrder，由紧邻初始化决定。 */
    const nextOrder = accountSessionIds.filter(id => id !== activeDrag.sessionId)
    /** 中文说明：组件局部值 insertAt，由紧邻初始化决定。 */
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    setSessionOrder(activeDrag.accountKey, nextOrder.map(id => id as string))
    if (orderBy === 'updated' || activeDrag.accountKey === UNGROUPED_KEY) return
    insertSessionBefore(activeDrag.accountKey as WorkspaceId, activeDrag.sessionId, anchor).catch((reason: unknown) => {
      console.warn('session reorder rejected:', reason)
    })
  }
  /** 中文说明：组件局部值 commitWorkspaceDrag，由紧邻初始化决定。 */
  const commitWorkspaceDrag = (
    activeDrag: WorkspaceDragState,
    over: NonNullable<WorkspaceDragState['over']>,
  ): void => {
    if (workspaceDropCommitted.current) return
    workspaceDropCommitted.current = true
    setWorkspaceDrag(null)
    /** 中文说明：组件局部值 rowIndex，由紧邻初始化决定。 */
    const rowIndex = workspaces.findIndex(workspace => workspace.workspaceId === over.id)
    if (rowIndex === -1) return
    /** 中文说明：组件局部值 anchor，由紧邻初始化决定。 */
    const anchor = over.half === 'before' ? over.id : workspaces[rowIndex + 1]?.workspaceId
    if (anchor === activeDrag.workspaceId) return
    /** 中文说明：组件局部值 sourceIndex，由紧邻初始化决定。 */
    const sourceIndex = workspaces.findIndex(workspace => workspace.workspaceId === activeDrag.workspaceId)
    /** 中文说明：组件局部值 anchorIndex，由紧邻初始化决定。 */
    const anchorIndex = anchor === undefined
      ? workspaces.length
      : workspaces.findIndex(workspace => workspace.workspaceId === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason: unknown) => {
      console.warn('workspace reorder rejected:', reason)
    })
  }
  /** 中文说明：组件局部值 workspaceDropAtListStart，由紧邻初始化决定。 */
  const workspaceDropAtListStart = groups[0]?.workspaceId !== undefined
    && workspaceDrag?.over?.id === groups[0].workspaceId
    && workspaceDrag.over.half === 'before'

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      {workspaceDropAtListStart && <span className={css.listTopDropIndicator} aria-hidden="true" />}
      <div
        className={clsx(css.list, workspaceDropAtListStart && css.listTopDropActive)}
        role="tree"
        aria-label={t('section.sessions')}
      >
        {groups.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {groups.map((group) => {
          /** 中文说明：组件局部值 workspaceId，由紧邻初始化决定。 */
          const workspaceId = group.workspaceId
          /** 中文说明：组件局部值 workspaceMarker，由紧邻初始化决定。 */
          const workspaceMarker = workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId
            ? workspaceDrag.over.half
            : null
          /** 中文说明：组件局部值 workspaceDragProps，由紧邻初始化决定。 */
          const workspaceDragProps = workspaceId === undefined ? undefined : {
            start: () => {
              workspaceDropCommitted.current = false
              setWorkspaceDrag({ workspaceId, over: null })
            },
            end: () => {
              if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) {
                commitWorkspaceDrag(workspaceDrag, workspaceDrag.over)
              } else {
                setWorkspaceDrag(null)
              }
              workspaceDropCommitted.current = false
            },
          }
          /** 中文说明：组件局部值 hoverWorkspace，由紧邻初始化决定。 */
          const hoverWorkspace = workspaceId === undefined
            ? undefined
            : (half: 'before' | 'after') => {
              setWorkspaceDrag(active => active === null
                ? active
                : { ...active, over: { id: workspaceId, half } })
            }
          /** 中文说明：组件局部值 dropWorkspace，由紧邻初始化决定。 */
          const dropWorkspace = workspaceId === undefined
            ? undefined
            : (half: 'before' | 'after') => {
              if (workspaceDrag === null) return
              commitWorkspaceDrag(workspaceDrag, { id: workspaceId, half })
            }
          return (
          // Group section: header row + expanded top-level session rows. The
          // inter-group breathing room is the section's own margin
          // (WorkspaceBrowser.module.css).
            <div
              key={group.key}
              className={clsx(
                css.groupSection,
                workspaceMarker === 'before' && css.workspaceDropBefore,
                workspaceMarker === 'after' && css.workspaceDropAfter,
              )}
              onDragOver={workspaceDrag === null || hoverWorkspace === undefined
                ? undefined
                : (e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  hoverWorkspace(workspaceGroupHalf(e))
                }}
              onDrop={workspaceDrag === null || dropWorkspace === undefined
                ? undefined
                : (e) => {
                  e.preventDefault()
                  dropWorkspace(workspaceGroupHalf(e))
                }}
            >
              <ProjectRowItem
                group={group}
                home={home}
                t={t}
                onToggle={() => {
                  if (group.expanded) {
                    setExpandedSessionGroups(keys => keys.filter(key => key !== group.key))
                  }
                  setGroupExpanded(group.key, !group.expanded)
                }}
                onCreate={() => {
                  if (group.workspaceId !== undefined) {
                    setGroupExpanded(group.key, true)
                    startSession(group.workspaceId)
                  }
                }}
                drag={workspaceDragProps}
                actions={group.workspaceId === undefined
                  ? undefined
                  : {
                    rename: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) onRenameRequest(group.workspaceId, group.label)
                    },
                    delete: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) onDeleteRequest(group.workspaceId, group.label)
                    },
                  }}
              />
              {(expandedSessionGroups.includes(group.key)
                ? group.sessions
                : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)
              ).map((node) => {
              // Session drag never leaves its group. Ungrouped writes only the
              // browser-local account; real Workspaces may also write Host order.
                /** 中文说明：组件局部值 sameGroupDrag，由紧邻初始化决定。 */
                const sameGroupDrag = drag !== null && drag.accountKey === group.key
                /** 中文说明：组件局部值 dragProps，由紧邻初始化决定。 */
                const dragProps = {
                  start: () => {
                    sessionDropCommitted.current = false
                    setDrag({ accountKey: group.key, sessionId: node.id, over: null })
                  },
                  active: sameGroupDrag,
                  marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
                  hover: (half: 'before' | 'after') => {
                  /* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
                    setDrag(d => (d === null ? d : { ...d, over: { id: node.id, half } }))
                  },
                  drop: (half: 'before' | 'after') => {
                  /* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
                    if (drag === null) return
                    commitSessionDrag(drag, { id: node.id, half })
                  },
                  end: () => {
                    if (drag?.over !== null && drag?.over !== undefined) commitSessionDrag(drag, drag.over)
                    else setDrag(null)
                    sessionDropCommitted.current = false
                  },
                }
                return (
                  <SessionNodeItem
                    key={node.id}
                    node={node}
                    currentId={current}
                    now={now}
                    onOpen={open}
                    onRename={onSessionRename}
                    onFork={forkSession}
                    onArchive={onSessionArchive}
                    drag={dragProps}
                    t={t}
                  />
                )
              })}
              {group.sessions.length > COLLAPSED_SESSION_LIMIT && (
                <button
                  type="button"
                  className={css.sessionOverflowButton}
                  aria-expanded={expandedSessionGroups.includes(group.key)}
                  onClick={() => { setExpandedSessionGroups(keys => toggled(keys, group.key)) }}
                >
                  {expandedSessionGroups.includes(group.key)
                    ? t('sessions.collapse')
                    : t('sessions.expand', { n: group.sessions.length - COLLAPSED_SESSION_LIMIT })}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/** The flat "In one list" body: every session is one draggable top-level row. */
/** 中文说明：函数 FlatList 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function FlatList({
  useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds,
  orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t,
}: Pick<
  SessionTreeProps,
  | 'useSessions'
  | 'open'
  | 'forkSession'
  | 'onSessionRename'
  | 'onSessionArchive'
  | 'archivedSessionIds'
  | 'orderBy'
  | 'sessionOrderByAccount'
  | 'sessionUpdatedAtByAccount'
  | 'syncSessionOrderAccount'
  | 'setSessionOrder'
  | 't'
>) {
  /** 中文说明：组件局部值 list，由紧邻初始化决定。 */
  const list = useSessions(s => s)
  /** 中文说明：组件局部值 baseRows，由紧邻初始化决定。 */
  const baseRows = useMemo(
    () => deriveFlat(list, archivedSessionIds),
    [list, archivedSessionIds],
  )
  /** 中文说明：组件局部值 sessionIds，由紧邻初始化决定。 */
  const sessionIds = useMemo(() => baseRows.map(row => row.id), [baseRows])
  /** 中文说明：组件局部值 previousOrderBy，由紧邻初始化决定。 */
  const previousOrderBy = useRef(orderBy)
  useEffect(() => {
    if (list.phase !== 'ready') return
    /** 中文说明：组件局部值 previousOrder，由紧邻初始化决定。 */
    const previousOrder = sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]
    /** 中文说明：组件局部值 previousUpdatedAt，由紧邻初始化决定。 */
    const previousUpdatedAt = sessionUpdatedAtByAccount[FLAT_SESSION_ORDER_KEY] ?? {}
    /** 中文说明：组件局部值 switchedToUpdated，由紧邻初始化决定。 */
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    previousOrderBy.current = orderBy
    /** 中文说明：组件局部值 next，由紧邻初始化决定。 */
    const next = nextSessionOrderAccount({
      sessionIds,
      previousOrder,
      previousUpdatedAt,
      list,
      orderBy,
      sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
    })
    if (next.changed) {
      syncSessionOrderAccount(FLAT_SESSION_ORDER_KEY, next.order.map(id => id as string), next.updatedAt)
    }
  }, [list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, sessionIds, syncSessionOrderAccount])
  /** 中文说明：组件局部值 rows，由紧邻初始化决定。 */
  const rows = useMemo(() => {
    /** 中文说明：组件局部值 byId，由紧邻初始化决定。 */
    const byId = new Map(baseRows.map(row => [row.id, row]))
    return reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY])
      .flatMap((id) => {
        /** 中文说明：组件局部值 row，由紧邻初始化决定。 */
        const row = byId.get(id)
        return row === undefined ? [] : [row]
      })
  }, [baseRows, sessionOrderByAccount, sessionIds])
  /** 中文说明：组件局部值 [drag, setDrag]，由紧邻初始化决定。 */
  const [drag, setDrag] = useState<DragState | null>(null)
  /** 中文说明：组件局部值 dropCommitted，由紧邻初始化决定。 */
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)
  /** 中文说明：组件局部值 commitDrag，由紧邻初始化决定。 */
  const commitDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    setDrag(null)
    /** 中文说明：组件局部值 targetIndex，由紧邻初始化决定。 */
    const targetIndex = rows.findIndex(row => row.id === over.id)
    if (targetIndex === -1) return
    /** 中文说明：组件局部值 anchor，由紧邻初始化决定。 */
    const anchor = over.half === 'before' ? over.id : rows[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    /** 中文说明：组件局部值 sourceIndex，由紧邻初始化决定。 */
    const sourceIndex = rows.findIndex(row => row.id === activeDrag.sessionId)
    /** 中文说明：组件局部值 anchorIndex，由紧邻初始化决定。 */
    const anchorIndex = anchor === undefined ? rows.length : rows.findIndex(row => row.id === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    /** 中文说明：组件局部值 nextOrder，由紧邻初始化决定。 */
    const nextOrder = rows.map(row => row.id).filter(id => id !== activeDrag.sessionId)
    /** 中文说明：组件局部值 insertAt，由紧邻初始化决定。 */
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map(id => id as string))
  }
  /** 中文说明：组件局部值 now，由紧邻初始化决定。 */
  const now = Date.now()
  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={clsx(css.list, css.flatList)} role="tree" aria-label={t('section.sessions')}>
        {rows.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {rows.map((node) => {
          /** 中文说明：组件局部值 active，由紧邻初始化决定。 */
          const active = drag !== null
          return (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={list.current}
              now={now}
              onOpen={open}
              onRename={onSessionRename}
              onFork={forkSession}
              onArchive={onSessionArchive}
              flat
              drag={{
                start: () => {
                  dropCommitted.current = false
                  setDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, over: null })
                },
                active,
                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                hover: (half) => {
                  setDrag(current => current === null ? current : { ...current, over: { id: node.id, half } })
                },
                drop: (half) => {
                  if (drag !== null) commitDrag(drag, { id: node.id, half })
                },
                end: () => {
                  if (drag?.over !== null && drag?.over !== undefined) commitDrag(drag, drag.over)
                  else setDrag(null)
                  dropCommitted.current = false
                },
              }}
              t={t}
            />
          )
        })}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/** 中文说明：类型或类 RemoteSearchState 约束模块数据或组件职责。 */
interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/** Flat search body: local metadata matches plus the current Host result page. */
/** 中文说明：函数 SearchResults 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function SearchResults({
  useSessions,
  open,
  workspaces,
  archivedSessionIds,
  query,
  remote,
  resultLimit,
  t,
}: Pick<SessionTreeProps, 'useSessions' | 'open' | 't'> & {
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionNode['id'][]
  query: string
  remote: RemoteSearchState
  resultLimit: number
}) {
  /** 中文说明：组件局部值 list，由紧邻初始化决定。 */
  const list = useSessions(s => s)
  /** 中文说明：组件局部值 currentRemote，由紧邻初始化决定。 */
  const currentRemote = remote.query === query
    ? remote
    : { query, status: 'loading' as const, items: [], hasMore: false }
  /** 中文说明：组件局部值 results，由紧邻初始化决定。 */
  const results = useMemo(
    () => deriveSearchResults(list, workspaces, query, archivedSessionIds, currentRemote, resultLimit),
    [list, workspaces, query, archivedSessionIds, currentRemote, resultLimit],
  )
  /** 中文说明：组件局部值 pending，由紧邻初始化决定。 */
  const pending = currentRemote.status === 'loading'
  /** 中文说明：组件局部值 failed，由紧邻初始化决定。 */
  const failed = currentRemote.status === 'error'

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list}>
        <div className={css.searchTree} role="tree" aria-label={t('search.results.aria')}>
          {results.items.map(result => (
            <SearchResultItem
              key={result.id}
              result={result}
              currentId={list.current}
              onOpen={open}
              t={t}
            />
          ))}
        </div>
        {pending && (
          <div className={css.searchStatus} role="status">{t('search.pending')}</div>
        )}
        {failed && (
          <div className={css.searchWarning} role="status">
            {t('search.unavailable')}
          </div>
        )}
        {!pending && results.items.length === 0 && (
          <div className={css.empty}>{t('search.noMatches')}</div>
        )}
        {results.hasMore && (
          <div className={css.searchStatus}>
            {t('search.hasMore', { n: resultLimit })}
          </div>
        )}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
/** 中文说明：函数 WorkspaceBrowser 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function WorkspaceBrowser({
  wide,
  expandSidebar,
  useSessions,
  useWorkspaces,
  useStore,
  actions,
  startSession,
  open,
  renameSession,
  forkSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  archiveSession,
  insertSessionBefore,
  createWorkspace,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  useHostDescription,
  renderSlot,
  t,
}: WorkspaceBrowserProps) {
  /** 中文说明：组件局部值 home，由紧邻初始化决定。 */
  const home = useHostDescription(description => description?.home)
  /** 中文说明：组件局部值 workspaces，由紧邻初始化决定。 */
  const workspaces = useWorkspaces(state => state.items)
  /** 中文说明：组件局部值 workspacePhase，由紧邻初始化决定。 */
  const workspacePhase = useWorkspaces(state => state.phase)
  /** 中文说明：组件局部值 archivedSessionIds，由紧邻初始化决定。 */
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  /** 中文说明：组件局部值 directoryFlowAvailable，由紧邻初始化决定。 */
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  /** 中文说明：组件局部值 groupBy，由紧邻初始化决定。 */
  const groupBy = useStore(s => s.groupBy)
  /** 中文说明：组件局部值 orderBy，由紧邻初始化决定。 */
  const orderBy = useStore(s => s.orderBy)
  /** 中文说明：组件局部值 groupExpansion，由紧邻初始化决定。 */
  const groupExpansion = useStore(s => s.groupExpansion)
  /** 中文说明：组件局部值 sessionOrderByAccount，由紧邻初始化决定。 */
  const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
  /** 中文说明：组件局部值 sessionUpdatedAtByAccount，由紧邻初始化决定。 */
  const sessionUpdatedAtByAccount = useStore(s => s.sessionUpdatedAtByAccount)
  /** 中文说明：组件局部值 currentBlankSessionId，由紧邻初始化决定。 */
  const currentBlankSessionId = useSessions((state) => {
    /** 中文说明：组件局部值 current，由紧邻初始化决定。 */
    const current = state.current
    return current !== undefined && state.byId[current]?.blank === true ? current : undefined
  })
  /** 中文说明：组件局部值 currentBlankAccount，由紧邻初始化决定。 */
  const currentBlankAccount = currentBlankSessionId === undefined
    ? undefined
    : (workspaces.find(workspace => workspace.sessionIds.includes(currentBlankSessionId))
      ?.workspaceId as string | undefined) ?? UNGROUPED_KEY
  /** 中文说明：组件局部值 promotedBlank，由紧邻初始化决定。 */
  const promotedBlank = useRef<{ sessionId: SessionId; accountKey: string } | undefined>(undefined)
  useEffect(() => {
    if (currentBlankSessionId === undefined || currentBlankAccount === undefined) {
      promotedBlank.current = undefined
      return
    }
    if (promotedBlank.current?.sessionId === currentBlankSessionId
      && promotedBlank.current.accountKey === currentBlankAccount) return
    promotedBlank.current = { sessionId: currentBlankSessionId, accountKey: currentBlankAccount }
    /** 中文说明：组件局部值 accountKey，由紧邻初始化决定。 */
    for (const accountKey of new Set([currentBlankAccount, FLAT_SESSION_ORDER_KEY])) {
      /** 中文说明：组件局部值 previous，由紧邻初始化决定。 */
      const previous = sessionOrderByAccount[accountKey] ?? []
      actions.setSessionOrder(accountKey, [
        currentBlankSessionId,
        ...previous.filter(id => id !== currentBlankSessionId),
      ])
    }
  }, [actions.setSessionOrder, currentBlankAccount, currentBlankSessionId, sessionOrderByAccount])
  useEffect(() => {
    if (workspacePhase !== 'ready') return
    actions.retainAccountKeys([
      UNGROUPED_KEY,
      FLAT_SESSION_ORDER_KEY,
      ...workspaces.map(workspace => workspace.workspaceId as string),
    ])
  }, [actions.retainAccountKeys, workspacePhase, workspaces])
  // The query outlives the tree and the input (both wide-only) so collapsing
  // does not silently drop an in-progress filter.
  /** 中文说明：组件局部值 [query, setQuery]，由紧邻初始化决定。 */
  const [query, setQuery] = useState('')
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [searchExpanded, setSearchExpanded] = useState(false)
  /** 中文说明：组件局部值 normalizedQuery，由紧邻初始化决定。 */
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [remoteSearch, setRemoteSearch] = useState<RemoteSearchState>({
    query: '',
    status: 'idle',
    items: [],
    hasMore: false,
  })
  /** 中文说明：组件局部值 searchRoot，由紧邻初始化决定。 */
  const searchRoot = useRef<HTMLDivElement | null>(null)
  /** 中文说明：组件局部值 searchInput，由紧邻初始化决定。 */
  const searchInput = useRef<HTMLInputElement | null>(null)
  // Section-header ＋ opens the picker menu (same popover in wide and rail
  // states; the menu anchors on this button).
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  /** 中文说明：组件局部值 wsPlusRef，由紧邻初始化决定。 */
  const wsPlusRef = useRef<HTMLButtonElement>(null)
  /** 中文说明：组件局部值 composingRef，由紧邻初始化决定。 */
  const composingRef = useRef(false)

  // Rail search = expand + land in the search box: the flag arms before the
  // expand request; once the shell flips wide the input mounts and takes focus.
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [searchOnExpand, setSearchOnExpand] = useState(false)
  useEffect(() => {
    if (wide && searchOnExpand) {
      /** 中文说明：组件局部值 timer，由紧邻初始化决定。 */
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
  }, [wide, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    searchInput.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded, searchOnExpand])

  // Outside-click dismissal stays off while the rail gesture is in flight
  // (searchOnExpand): the rail click flips the shell wide and mounts this
  // listener during its own dispatch, then keeps bubbling to document with
  // the now-unmounted rail button as its target — outside searchRoot, so the
  // listener would dismiss the search that click just opened.
  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    /** 中文说明：组件局部值 onClick，由紧邻初始化决定。 */
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    /** 中文说明：组件局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    setRemoteSearch({
      query: normalizedQuery,
      status: 'loading',
      items: [],
      hasMore: false,
    })
    /** 中文说明：组件局部值 timer，由紧邻初始化决定。 */
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'ready',
          items: result.items,
          hasMore: result.hasMore,
        })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'error',
          items: [],
          hasMore: false,
        })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  // Rename dialog (browser-owned so it outlives row unmounts during collapse).
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: WorkspaceId; currentTitle: string } | null>(null)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [renameDraft, setRenameDraft] = useState('')
  /** 中文说明：组件局部值 [renaming, setRenaming]，由紧邻初始化决定。 */
  const [renaming, setRenaming] = useState(false)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [renameError, setRenameError] = useState<string | null>(null)
  /** 中文说明：组件局部值 renameTrimmed，由紧邻初始化决定。 */
  const renameTrimmed = renameDraft.trim()
  /** 中文说明：组件局部值 renameDuplicate，由紧邻初始化决定。 */
  const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
    && workspaces.some(w => w.title === renameTrimmed)
  /** 中文说明：组件局部值 renameBlocked，由紧邻初始化决定。 */
  const renameBlocked = renaming || renameTrimmed === ''
    || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate
  /** 中文说明：组件局部值 closeRename，由紧邻初始化决定。 */
  const closeRename = () => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }
  /** 中文说明：组件局部值 confirmRename，由紧邻初始化决定。 */
  const confirmRename = () => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Session rename dialog (same browser-owned pattern as workspace rename;
  // sessions have no client-side name-conflict rule — the host normalizes).
  // Unlike workspace rename, an unchanged title is NOT blocked: confirming
  // the current automatic title is the gesture that pins it.
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ sessionId: SessionNode['id']; currentTitle: string } | null>(null)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [sessionRenaming, setSessionRenaming] = useState(false)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [sessionRenameError, setSessionRenameError] = useState<string | null>(null)
  /** 中文说明：组件局部值 sessionRenameTrimmed，由紧邻初始化决定。 */
  const sessionRenameTrimmed = sessionRenameDraft.trim()
  /** 中文说明：组件局部值 sessionRenameBlocked，由紧邻初始化决定。 */
  const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null
  /** 中文说明：组件局部值 closeSessionRename，由紧邻初始化决定。 */
  const closeSessionRename = () => {
    if (sessionRenaming) return
    setSessionRenameTarget(null)
    setSessionRenameError(null)
  }
  /** 中文说明：组件局部值 confirmSessionRename，由紧邻初始化决定。 */
  const confirmSessionRename = () => {
    if (sessionRenameBlocked) return
    setSessionRenaming(true)
    setSessionRenameError(null)
    renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
      setSessionRenaming(false)
      setSessionRenameTarget(null)
    }).catch((reason: unknown) => {
      setSessionRenaming(false)
      setSessionRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  /** 中文说明：组件局部值 onSessionRename，由紧邻初始化决定。 */
  const onSessionRename = (sessionId: SessionNode['id'], currentTitle: string) => {
    setSessionRenameTarget({ sessionId, currentTitle })
    setSessionRenameDraft(currentTitle)
    setSessionRenameError(null)
  }

  // Archive is dialog-free: not destructive (the log and the accounting slot
  // remain), so the menu action commits directly; the row disappears when the
  // archive-set echo lands. Failures are non-fatal console diagnostics, the
  // same posture as reorder rejections.
  /** 中文说明：组件局部值 onSessionArchive，由紧邻初始化决定。 */
  const onSessionArchive = (sessionId: SessionNode['id']) => {
    archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected:', reason)
    })
  }

  // Delete dialog is separate from the row so a successful removal can
  // unmount that row without tearing down the in-flight confirmation state.
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [deleteTarget, setDeleteTarget] = useState<{ workspaceId: WorkspaceId; title: string } | null>(null)
  /** 中文说明：组件局部值 [deleting, setDeleting]，由紧邻初始化决定。 */
  const [deleting, setDeleting] = useState(false)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (deleteCommittedId === null
      || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    setDeleteTarget(null)
  }, [deleteCommittedId, workspaces])
  /** 中文说明：组件局部值 closeDelete，由紧邻初始化决定。 */
  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  /** 中文说明：组件局部值 confirmDelete，由紧邻初始化决定。 */
  const confirmDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)
    deleteWorkspace(deleteTarget.workspaceId).then(() => {
      // Keep the confirmation pending until this component has rendered the
      // committed list projection without the deleted id. Closing earlier
      // exposes one stale React frame to the next Create Workspace gesture.
      setDeleteCommittedId(deleteTarget.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && (
          <span className={clsx(css.sectionLabel, css.wide, searchExpanded && css.sectionLabelHidden)}>
            {groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
          </span>
        )}
        {wide && (
          <div className={clsx(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
            <div
              ref={searchRoot}
              className={clsx(css.search, searchExpanded && css.searchExpanded)}
              onClick={() => {
                setWsPickerOpen(false)
                setSearchExpanded(true)
                searchInput.current?.focus()
              }}
            >
              <Tooltip label={t('search')} side="bottom" delayMs={500} disabled={searchExpanded}>
                <button
                  type="button"
                  className={css.searchButton}
                  aria-label={t('search.sessions.aria')}
                  aria-expanded={searchExpanded}
                  onClick={() => {
                    setWsPickerOpen(false)
                    setSearchExpanded(true)
                  }}
                >
                  <IconSearchOutline16 size={searchExpanded ? 11 : 14} />
                </button>
              </Tooltip>
              <input
                ref={searchInput}
                className={css.searchInput}
                type="text"
                placeholder={t('search.placeholder')}
                maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                value={query}
                tabIndex={searchExpanded ? 0 : -1}
                onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  setQuery('')
                  setSearchExpanded(false)
                }}
              />
              {searchExpanded && (
                <button
                  type="button"
                  className={css.clearButton}
                  aria-label={t('search.clear')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuery('')
                    setSearchExpanded(false)
                  }}
                >
                  <IconCloseFill14 />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={clsx(css.headerActions, wide && searchExpanded && css.headerActionsHidden)}>
          {wide && (
            <ViewOptionsMenu
              groupBy={groupBy}
              orderBy={orderBy}
              onGroupPick={(mode) => { actions.setGroupBy(mode) }}
              onOrderPick={(mode) => { actions.setOrderBy(mode) }}
              t={t}
            />
          )}
          {/* Adding is the button's one action, so a composition with no
              picking affordance has nothing to offer here: the region hides the
              button rather than leaving a dead one in the header. */}
          {directoryFlowAvailable && (
            <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
              <button
                ref={wsPlusRef}
                type="button"
                className={css.iconButton}
                aria-label={t('workspace.add')}
                onClick={() => {
                  setWsPickerOpen(v => !v)
                }}
              >
                <IconProjectAddOutline16 size={wide ? 16 : 18} />
              </button>
            </Tooltip>
          )}
        </div>
        {/* Add flow + its error dialog (same package — direct composition). */}
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
          addOnly
          side="right"
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            startSession(workspaceId)
          }}
          onClose={() => { setWsPickerOpen(false) }}
        />
      </div>

      {/* The collapsed rail keeps search as its own 36px control. */}
      {!wide && <div className={css.search}>
        <Tooltip label={t('search')}>
          <button
            type="button"
            className={css.searchButton}
            aria-label={t('search.sessions.aria')}
            onClick={() => {
              setSearchExpanded(true)
              setSearchOnExpand(true)
              expandSidebar()
            }}
          >
            <IconSearchOutline16 size={18} />
          </button>
        </Tooltip>
      </div>}

      {/* Always-mounted seat keeps the region's flex slot while the list
          itself is wide-only. */}
      <div className={css.listArea}>
        {wide && (normalizedQuery !== ''
          ? (
            <SearchResults
              useSessions={useSessions}
              open={open}
              workspaces={workspaces}
              archivedSessionIds={archivedSessionIds}
              query={normalizedQuery}
              remote={remoteSearch}
              resultLimit={searchResultLimit}
              t={t}
            />
          )
          : groupBy === 'flat'
            ? (
              <FlatList
                useSessions={useSessions} open={open} forkSession={forkSession}
                onSessionRename={onSessionRename} onSessionArchive={onSessionArchive}
                archivedSessionIds={archivedSessionIds}
                orderBy={orderBy}
                sessionOrderByAccount={sessionOrderByAccount}
                sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
                syncSessionOrderAccount={actions.syncSessionOrderAccount}
                setSessionOrder={actions.setSessionOrder}
                t={t}
              />
            )
            : (
              <SessionTree
                useSessions={useSessions}
                onSessionRename={onSessionRename}
                onSessionArchive={onSessionArchive}
                forkSession={forkSession}
                workspaces={workspaces}
                groupExpansion={groupExpansion}
                setGroupExpanded={actions.setGroupExpanded}
                sessionOrderByAccount={sessionOrderByAccount}
                sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
                syncSessionOrderAccount={actions.syncSessionOrderAccount}
                setSessionOrder={actions.setSessionOrder}
                archivedSessionIds={archivedSessionIds}
                startSession={startSession}
                open={open}
                insertWorkspaceBefore={insertWorkspaceBefore}
                insertSessionBefore={insertSessionBefore}
                orderBy={orderBy}
                home={home}
                t={t}
                onRenameRequest={(workspaceId, currentTitle) => {
                  setRenameTarget({ workspaceId, currentTitle })
                  setRenameDraft(currentTitle)
                  setRenameError(null)
                }}
                onDeleteRequest={(workspaceId, title) => {
                  setDeleteTarget({ workspaceId, title })
                  setDeleteError(null)
                }}
              />
            ))}
      </div>

      <Modal
        open={renameTarget !== null}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
          autoFocus
          disabled={renaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setRenameDraft(e.target.value); setRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmRename()
            }
          }}
        />
        {renameDuplicate && (
          <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
        )}
        {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
      </Modal>

      <Modal
        open={sessionRenameTarget !== null}
        onClose={closeSessionRename}
        closeLabel={t('close')}
        title={t('rename.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={sessionRenaming} onClick={closeSessionRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={sessionRenameBlocked} onClick={confirmSessionRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={sessionRenameDraft}
          aria-label={t('field.sessionName')}
          autoFocus
          disabled={sessionRenaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setSessionRenameDraft(e.target.value); setSessionRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmSessionRename()
            }
          }}
        />
        {sessionRenameError !== null && <div className={css.renameError} role="alert">{sessionRenameError}</div>}
      </Modal>
      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t('delete.workspace')}
        {...deleteTarget === null
          ? {}
          : { description: t('delete.desc', { name: deleteTarget.title }) }}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {t('delete.workspace')}
            </Button>
          </>
        )}
      >
        {deleting && <div className={css.deleteStatus} role="status">{t('delete.pending')}</div>}
        {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
      </Modal>
    </div>
  )
}
