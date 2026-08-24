// Resident conversation skeleton. Hero chrome, composer positioning, the
// chain, AND the composer bar (session-maybe slot) stay mounted across
// no-session/session transitions — the bar renders inert via owner props.
/**
 * 文件职责：实现会话骨架中的 ConversationRoot 组件。
 * 技术维度：React、TypeScript、Cordis 插槽、响应式状态和 CSS Modules。
 * 产品维度：支持用户查看和操作会话骨架。
 * 逻辑维度：读取属性与服务，派生显示状态，处理事件并渲染界面。
 * 关键边界：空状态、禁用状态、异步取消和可访问性属性必须一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSlotProps, InputZone } from '../contract/slots.ts'
import { HeroGlow, HeroShell, WorkspaceChip, workspaceLabel } from './EmptyHero.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the slot contract. */
/** 中文说明：类型或类 ConversationRootProps 约束本文件的数据或组件职责。 */
export type ConversationRootProps = ConversationSlotProps

/** 中文说明：函数 ConversationRoot 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
export function ConversationRoot({
  sessionId, useSession, useSessions, useWorkspaces, useInput, useComposerBlock,
  renderSlot, renderSlotChain, selectWorkspace, t,
}: ConversationRootProps) {
  /** 中文说明：状态快照 openState，取值由紧邻初始化决定。 */
  const openState = useSession(s => s.openState)
  /** 中文说明：组件局部值 composerPhase，取值由紧邻初始化决定。 */
  const composerPhase = useSession(s => s.composerPhase)
  /** 中文说明：组件局部值 pending，取值由紧邻初始化决定。 */
  const pending = useSession(s => s.pending) ?? []
  /** 中文说明：组件局部值 session，取值由紧邻初始化决定。 */
  const session = useSession(s => s)
  /** 中文说明：状态快照 inputState，取值由紧邻初始化决定。 */
  const inputState = useInput(s => s)
  /** 中文说明：组件局部值 cwd，取值由紧邻初始化决定。 */
  const cwd = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.cwd)
  /** 中文说明：组件局部值 summaryBlank，取值由紧邻初始化决定。 */
  const summaryBlank = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.blank)
  /** 中文说明：组件局部值 workspaces，取值由紧邻初始化决定。 */
  const workspaces = useWorkspaces(s => s)
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  /** 中文说明：组件局部值 composerBlock，取值由紧邻初始化决定。 */
  const composerBlock = useComposerBlock(block => block)

  /** 中文说明：组件局部值 解构结果，取值由紧邻初始化决定。 */
  const [pickerOpen, setPickerOpen] = useState(false)
  /** 中文说明：组件局部值 解构结果，取值由紧邻初始化决定。 */
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<WorkspaceId | undefined>()
  /** 中文说明：组件局部值 pickerAnchor，取值由紧邻初始化决定。 */
  const pickerAnchor = useRef<HTMLButtonElement>(null)

  // Publishes the seat's live height as --dsh-composer-height on the scroll
  // body so floating controls (ChatView back-to-bottom) clear the composer as
  // it grows. Callback ref, not an effect; stable identity prevents observer
  // churn while the first blank session fills the resident body outlet.
  /** 中文说明：组件局部值 seatObserver，取值由紧邻初始化决定。 */
  const seatObserver = useRef<ResizeObserver | null>(null)
  /** 中文说明：组件局部值 seatResizeRef，取值由紧邻初始化决定。 */
  const seatResizeRef = useCallback((seat: HTMLDivElement | null): void => {
    seatObserver.current?.disconnect()
    seatObserver.current = null
    /** 中文说明：组件局部值 scroller，取值由紧邻初始化决定。 */
    const scroller = seat?.parentElement ?? null
    if (seat === null || scroller === null) return
    seatObserver.current = new ResizeObserver(() => {
      scroller.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`)
    })
    seatObserver.current.observe(seat)
  }, [])

  /** 中文说明：组件局部值 sessionWorkspace，取值由紧邻初始化决定。 */
  const sessionWorkspace = sessionId === undefined
    ? undefined
    : workspaces.items.find(workspace => workspace.sessionIds.includes(sessionId))
  /** 中文说明：组件局部值 pendingWorkspace，取值由紧邻初始化决定。 */
  const pendingWorkspace = workspaces.items.find(
    workspace => workspace.workspaceId === pendingWorkspaceId,
  )

  // Clear the pending pick once the session lands in it, or when the picked
  // workspace disappears from a ready list (deleted from the sidebar).
  useEffect(() => {
    if (pendingWorkspaceId === undefined) return
    if (sessionWorkspace?.workspaceId === pendingWorkspaceId
      || (workspaces.phase === 'ready' && pendingWorkspace === undefined)) {
      setPendingWorkspaceId(undefined)
    }
  }, [pendingWorkspaceId, sessionWorkspace?.workspaceId, workspaces.phase, pendingWorkspace])

  // While a session is still replaying (loading + blank) the hero/docked
  // choice is unknowable — render the composer hidden instead of flashing
  // the centered hero and snapping to the docked bar (or vice versa).
  // Exemption: a session the list summary already proves blank can only
  // land on the hero, so hiding would blank the column for the whole
  // history round-trip (the startup auto-selection flash) for nothing.
  // The exemption is deliberately open-state-wide, not loading-only: a
  // summary-blank session is the hero before its open starts (`cold`) and
  // after one fails (`error`) for the same reason — there is no history.
  /** 中文说明：组件局部值 settling，取值由紧邻初始化决定。 */
  const settling = sessionId !== undefined && composerPhase === 'blank' && openState === 'loading'
    && summaryBlank !== true
  /** 中文说明：组件局部值 hero，取值由紧邻初始化决定。 */
  const hero = sessionId === undefined
    || (composerPhase === 'blank' && (openState === 'open' || summaryBlank === true))
  /** 中文说明：组件局部值 zone，取值由紧邻初始化决定。 */
  const zone: InputZone | undefined =
    session === undefined || inputState === undefined ? undefined : { session, input: inputState }

  // The chip is a selector; label resolution walks the flow top-down:
  //   1. a just-picked workspace (pending) → its title;
  //   2. cold start, no session yet → placeholder ("Choose workspace");
  //   3. the blank session's workspace is in the list → its title;
  //   4. list still loading → cwd folder name bridges so the title does not
  //      flash on refresh (empty cwd → placeholder);
  //   5. list ready but no owning workspace (deleted from the sidebar) →
  //      placeholder, never the deleted folder's name via cwd.
  /** 中文说明：组件局部值 chipTitle，取值由紧邻初始化决定。 */
  const chipTitle = pendingWorkspace?.title
    ?? (sessionId === undefined
      ? undefined
      : sessionWorkspace?.title
        ?? (workspaces.phase === 'ready' || cwd === undefined || cwd === ''
          ? undefined
          : workspaceLabel(cwd)))

  /** 中文说明：当前数据 heroWorkspaceRow，取值由紧邻初始化决定。 */
  const heroWorkspaceRow = (
    <div className={css.heroWorkspaceRow}>
      <WorkspaceChip
        buttonRef={pickerAnchor}
        label={chipTitle}
        menuOpen={pickerOpen}
        onClick={() => { setPickerOpen(open => !open) }}
        t={t}
      />
      {renderSlot('conversation.hero.workspace', {
        open: pickerOpen,
        anchorRef: pickerAnchor,
        selectedId: pendingWorkspaceId ?? sessionWorkspace?.workspaceId,
        onPick: (workspaceId) => {
          setPickerOpen(false)
          setPendingWorkspaceId(workspaceId)
          void selectWorkspace(workspaceId).catch(() => {
            setPendingWorkspaceId(current => current === workspaceId ? undefined : current)
          })
        },
        onClose: () => { setPickerOpen(false) },
      })}
      {renderSlot('conversation.hero.agentPreset', {})}
    </div>
  )

  // The placeholder chip ("Choose workspace") and the Workspace-trigger input travel
  // together: no workspace picked yet (cold start, no session at all), or a
  // blank session whose workspace vanished (deleted from the sidebar). The
  // bar is ONE session-maybe slot rendered unconditionally — inert is a prop,
  // not a different tree, so the textarea DOM survives the transition.
  /** 中文说明：组件局部值 inert，取值由紧邻初始化决定。 */
  const inert = sessionId === undefined || (hero && chipTitle === undefined)
  // A raised block is the same inert posture with the blocker's own reason:
  // one disabled textarea, never a second tree. The no-workspace state wins
  // when both hold — picking a workspace is the earlier prerequisite.
  /** 中文说明：组件局部值 blocked，取值由紧邻初始化决定。 */
  const blocked = !inert && composerBlock !== undefined
  /** 中文说明：组件局部值 inputBar，取值由紧邻初始化决定。 */
  const inputBar = renderSlot('conversation.composer.bar', {
    variant: hero ? 'hero' : 'composer',
    ...(inert
      ? {
        disabled: true,
        placeholder: t('placeholder.workspace'),
        workspacePickerOpen: pickerOpen,
        onRequestWorkspace: () => { setPickerOpen(true) },
      }
      : blocked
        // `blocked`, not `disabled`: the bar refuses input either way, but a
        // block keeps the model seat live because choosing a model is how the
        // user clears it.
        ? { blocked: composerBlock, placeholder: composerBlock.reason }
        : hero ? { placeholder: t('placeholder.hero') } : {}),
    overlay: renderSlot('conversation.input.overlay', {}),
    leftItems: zone === undefined ? null : renderSlot('conversation.input.left', zone),
    rightItems: zone === undefined ? null : renderSlot('conversation.input.right', zone),
    // Stats band under the card, inside the bar's width column so both
    // share one constraint (composer.dock = stats-line family).
    footer: !hero && zone !== undefined ? renderSlot('conversation.composer.dock', zone) : null,
  })

  /** 中文说明：组件局部值 composerBar，取值由紧邻初始化决定。 */
  const composerBar = (
    <div className={clsx(css.composerStack, hero && css.composerHero)}>
      {hero && <HeroGlow className={css.heroGlow} />}
      {hero && <HeroShell t={t} renderSlot={renderSlot} />}
      {hero && heroWorkspaceRow}
      {zone !== undefined && renderSlot('conversation.input.dock', zone)}
      {inputBar}
    </div>
  )

  /** 中文说明：组件局部值 phase，取值由紧邻初始化决定。 */
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  /** 中文说明：组件局部值 composer，取值由紧邻初始化决定。 */
  const composer = renderSlotChain(
    'conversation.composer',
    { interactions: pending, session },
    { fallback: composerBar, overlay: true },
  )

  // Sticky wraps the whole chain output (fallback + elected overlay), not
  // only `.composerStack`: overlay:true renders those as siblings, and sticky
  // on the fallback alone would leave Question/Approval panels at the content
  // end off-screen when the user is not pinned to the floor.
  /** 中文说明：组件局部值 composerSeat，取值由紧邻初始化决定。 */
  const composerSeat = (
    <div ref={seatResizeRef} className={css.composerSeat} data-composer-seat="">
      {composer}
    </div>
  )

  return (
    <div className={css.root} data-phase={phase}>
      {renderSlot('conversation.session.header', {})}
      <div className={css.scrollBody} data-conversation-scroll="">
        {renderSlot('conversation.session', {})}
        {composerSeat}
      </div>
    </div>
  )
}
