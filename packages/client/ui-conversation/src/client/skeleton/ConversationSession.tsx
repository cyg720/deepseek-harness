/** Strict per-session header/body content inserted into the resident conversation layout. */
/*
 * 文件职责：实现会话骨架中的 ConversationSession 组件。
 * 技术维度：React、TypeScript、Cordis 插槽、响应式状态和 CSS Modules。
 * 产品维度：支持用户查看和操作会话骨架。
 * 逻辑维度：读取属性与服务，派生显示状态，处理事件并渲染界面。
 * 关键边界：空状态、禁用状态、异步取消和可访问性属性必须一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */

import { useEffect, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import type { ViewTab } from '../contract/views.ts'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
/* 中文说明：类型或类 ConversationSessionProps 约束本文件的数据或组件职责。 */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
/* 中文说明：类型或类 ConversationSessionHeaderProps 约束本文件的数据或组件职责。 */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

/** 中文说明：类型或类 Breadcrumb 约束本文件的数据或组件职责。 */
interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

/** 中文说明：组件局部值 DEFAULT_VIEW_ID，取值由紧邻初始化决定。 */
const DEFAULT_VIEW_ID = 'chat'

/** Resolve by id and keep stale persisted selections on the stable Chat fallback. */
/* 中文说明：函数 resolveActiveView 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function resolveActiveView(tabs: readonly ViewTab[], selectedId: string | null): ViewTab | undefined {
  /** 中文说明：组件局部值 requestedId，取值由紧邻初始化决定。 */
  const requestedId = selectedId ?? DEFAULT_VIEW_ID
  return tabs.find(view => view.id === requestedId)
    ?? tabs.find(view => view.id === DEFAULT_VIEW_ID)
}

/** 中文说明：函数 deriveAncestry 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  /** 中文说明：组件局部值 chain，取值由紧邻初始化决定。 */
  const chain: Breadcrumb[] = []
  /** 中文说明：有序集合 seen，取值由紧邻初始化决定。 */
  const seen = new Set<SessionId>()
  /** 中文说明：组件局部值 cursor，取值由紧邻初始化决定。 */
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    /** 中文说明：组件局部值 summary，取值由紧邻初始化决定。 */
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

/** 中文说明：函数 equalBreadcrumbs 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      /** 中文说明：组件局部值 other，取值由紧邻初始化决定。 */
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or visible title and tabs.
 */
/* 中文说明：函数 ConversationSessionHeader 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useStore, actions,
  renderSlot, views, open, t,
}: ConversationSessionHeaderProps) {
  useSyncExternalStore(views.subscribe, views.version)
  /** 中文说明：组件局部值 tabs，取值由紧邻初始化决定。 */
  const tabs = views.list()
  /** 中文说明：组件局部值 selectedId，取值由紧邻初始化决定。 */
  const selectedId = useStore(s => s.view)
  /** 中文说明：组件局部值 active，取值由紧邻初始化决定。 */
  const active = resolveActiveView(tabs, selectedId)
  /** 中文说明：组件局部值 ancestry，取值由紧邻初始化决定。 */
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  /** 中文说明：组件局部值 composerPhase，取值由紧邻初始化决定。 */
  const composerPhase = useSession(s => s.composerPhase)
  /** 中文说明：组件局部值 blank，取值由紧邻初始化决定。 */
  const blank = useSession(s => s.blank)
  /** 中文说明：组件局部值 hideChrome，取值由紧邻初始化决定。 */
  const hideChrome = blank && composerPhase === 'blank'

  return (
    <header
      className={clsx(css.header, hideChrome && css.headerHidden)}
      aria-hidden={hideChrome || undefined}
    >
      {!hideChrome && (
        <>
          <div className={css.titleRow}>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  /** 中文说明：组件局部值 last，取值由紧邻初始化决定。 */
                  const last = index === ancestry.length - 1
                  /** 中文说明：组件局部值 title，取值由紧邻初始化决定。 */
                  const title = (
                    <button
                      type="button"
                      className={clsx(
                        css.crumb,
                        summary.subagent && css.crumbSubagent,
                        last && css.crumbCurrent,
                      )}
                      disabled={last}
                      onClick={() => { open(summary.id) }}
                    >
                      {summary.displayTitle}
                    </button>
                  )
                  /** 中文说明：组件局部值 lineage，取值由紧邻初始化决定。 */
                  const lineage = last || summary.subagent
                  /** 中文说明：组件局部值 lineageOwner，取值由紧邻初始化决定。 */
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className={css.headerUtilities}>
              {renderSlot('conversation.session.header.utilities', {})}
            </div>
          </div>
          {tabs.length > 1 && (
            <div className={css.tabs} role="tablist">
              {tabs.map(viewTab => (
                <button
                  key={viewTab.id}
                  type="button"
                  role="tab"
                  aria-selected={viewTab.id === active?.id}
                  className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
                  onClick={() => { actions.setView(viewTab.id) }}
                >
                  {viewTab.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </header>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
/* 中文说明：函数 ConversationSession 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
export function ConversationSession({
  sessionId, useSession, useInput, inputActions, useStore, actions,
  renderSlot, views, bindDraftMirror, releaseSessionImages,
}: ConversationSessionProps) {
  useSyncExternalStore(views.subscribe, views.version)
  /** 中文说明：组件局部值 tabs，取值由紧邻初始化决定。 */
  const tabs = views.list()
  /** 中文说明：组件局部值 selectedId，取值由紧邻初始化决定。 */
  const selectedId = useStore(s => s.view)
  /** 中文说明：组件局部值 active，取值由紧邻初始化决定。 */
  const active = resolveActiveView(tabs, selectedId)
  /** 中文说明：组件局部值 composerPhase，取值由紧邻初始化决定。 */
  const composerPhase = useSession(s => s.composerPhase)
  /** 中文说明：组件局部值 blank，取值由紧邻初始化决定。 */
  const blank = useSession(s => s.blank)
  /** 中文说明：状态快照 inputState，取值由紧邻初始化决定。 */
  const inputState = useInput(s => s)
  /** 中文说明：状态快照 storedDraft，取值由紧邻初始化决定。 */
  const storedDraft = useStore(s => s.draft)
  // `?? null`: persisted snapshots from before the inspect field rehydrate without it.
  /** 中文说明：组件局部值 inspect，取值由紧邻初始化决定。 */
  const inspect = useStore(s => s.inspect ?? null)

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    /** 中文说明：组件局部值 unmirror，取值由紧邻初始化决定。 */
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  useEffect(() => () => {
    releaseSessionImages(sessionId)
  }, [releaseSessionImages, sessionId])

  if (blank && composerPhase === 'blank') return null
  return (
    <div className={css.viewArea}>
      {active !== undefined && renderSlot('conversation.view', {
        inspect,
        onInspectDone: () => { actions.setInspect(null) },
      }, { only: active.id })}
    </div>
  )
}
