/**
 * Agent-presets settings section: the roster as cards, a copy dialog as the
 * only way a preset is created, and a read-only viewer over the shipped
 * compositions.
 *
 * The browser edits no composition text — a shipped preset opens read-only to
 * be READ (it is the known-good composition a copy starts from), and a custom
 * preset is edited in its own files, which is what the location action leads
 * to. Deleting a preset leaves running sessions alone: a composition is
 * mounted once at session creation and nothing re-reads the file.
 */
/**
 * 文件职责：实现预设界面的 AgentPresetSection 组件及交互。
 * 技术维度：React、TypeScript、Cordis 插槽、响应式快照和 CSS Modules。
 * 产品维度：帮助用户查看、选择或管理会话使用的代理预设。
 * 逻辑维度：读取注入状态，派生展示数据，响应操作并渲染组件树。
 * 关键边界：运行中会话的组成不可切换；异步操作和弹层必须随状态关闭。
 * 新手阅读建议：先读 Props 与注入接口，再看派生变量、effect 和 JSX。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconBrowseOutline16, IconCopyOutline16, IconFolderOpenOutline16, IconPlusOutline16, IconTrashOutline16, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { draftBlocker, type AgentPresetSectionState } from './section-store.ts'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'
import css from './AgentPresetSection.module.css'

/** Registration-side business face for the management section. */
/** 中文说明：类型 AgentPresetSectionInjected 约束本文件数据字段及允许取值。 */
export interface AgentPresetSectionInjected {
  /** 中文说明：成员 hooks 保存实例运行状态，取值由声明类型限定。 */
  hooks: {
    /** Page snapshot bound by the renderer as useAgentPresetSection. */
    agentPresetSection: SnapshotStore<AgentPresetSectionState>
  }
  /** Read the roster; called once when the section first renders. */
  /** 中文说明：成员 load 保存实例运行状态，取值由声明类型限定。 */
  load: () => Promise<void>
  /** Open one shipped preset's composition in the read-only viewer. */
  /** 中文说明：成员 view 保存实例运行状态，取值由声明类型限定。 */
  view: (id: string) => Promise<void>
  /** Close the read-only viewer. */
  /** 中文说明：成员 closeView 保存实例运行状态，取值由声明类型限定。 */
  closeView: () => void
  /** Open the copy dialog over one preset. */
  /** 中文说明：成员 beginCopy 保存实例运行状态，取值由声明类型限定。 */
  beginCopy: (from: string) => void
  /** Close the copy dialog, discarding the draft. */
  /** 中文说明：成员 cancelCopy 保存实例运行状态，取值由声明类型限定。 */
  cancelCopy: () => void
  /** Name the preset the copy creates. */
  /** 中文说明：成员 setCopyId 保存实例运行状态，取值由声明类型限定。 */
  setCopyId: (id: string) => void
  /** Name the copy's display name. */
  /** 中文说明：成员 setCopyName 保存实例运行状态，取值由声明类型限定。 */
  setCopyName: (name: string) => void
  /** Submit the copy. */
  /** 中文说明：成员 confirmCopy 保存实例运行状态，取值由声明类型限定。 */
  confirmCopy: () => Promise<void>
  /** Open one preset's directory, or reveal its path where there is no desktop. */
  /** 中文说明：成员 openLocation 保存实例运行状态，取值由声明类型限定。 */
  openLocation: (id: string) => Promise<void>
  /**
   * Stage the self-referential preset and start a new session on it — the
   * guided way to author a preset, beside copying. Absent when the surface
   * is composed without the conversation flow to land the session in.
   */
  /** 中文说明：成员 startCreatorDraft 保存实例运行状态，取值由声明类型限定。 */
  startCreatorDraft?: () => void
  /** Ask for delete confirmation, or dismiss it with null. */
  /** 中文说明：成员 confirmDelete 保存实例运行状态，取值由声明类型限定。 */
  confirmDelete: (id: string | null) => void
  /** Delete the preset awaiting confirmation. */
  /** 中文说明：成员 remove 保存实例运行状态，取值由声明类型限定。 */
  remove: () => Promise<void>
  /** Make one preset the default for sessions created later. */
  /** 中文说明：成员 makeDefault 保存实例运行状态，取值由声明类型限定。 */
  makeDefault: (id: string) => Promise<void>
}

/** Full component props. */
/** 中文说明：类型 AgentPresetSectionProps 约束本文件数据字段及允许取值。 */
export type AgentPresetSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetSectionInjected>

/** Copy-dialog sub-view props: the draft plus the actions that mutate it. */
/** 中文说明：类型 CopyDialogProps 约束本文件数据字段及允许取值。 */
interface CopyDialogProps {
  /** 中文说明：成员 state 保存实例运行状态，取值由声明类型限定。 */
  state: AgentPresetSectionState
  /** 中文说明：成员 t 保存实例运行状态，取值由声明类型限定。 */
  t: (key: AgentPresetSettingsKey) => string
  /** 中文说明：成员 actions 保存实例运行状态，取值由声明类型限定。 */
  actions: Pick<AgentPresetSectionInjected,
    'cancelCopy' | 'confirmCopy' | 'setCopyId' | 'setCopyName'>
}

/** 中文说明：函数 CopyDialog 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function CopyDialog({ state, t, actions }: CopyDialogProps): ReactNode {
  /** 中文说明：当前处理步骤的局部值 draft，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const draft = state.copy
  /** 中文说明：当前处理步骤的局部值 blocker，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const blocker = draft === null ? undefined : draftBlocker(draft, state.rows)
  /** 中文说明：当前传输或投影数据 message，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const message = draft === null ? null : draft.error ?? (blocker === undefined ? null : t(blocker))
  /** 中文说明：当前处理步骤的局部值 source，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const source = draft === null ? undefined : state.rows.find(row => row.id === draft.from)
  /** 中文说明：当前处理步骤的局部值 sourceTitle，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const sourceTitle = source === undefined ? draft?.fromTitle : presetDisplayText(source, t).name
  return (
    <Modal
      open={draft !== null}
      onClose={() => { actions.cancelCopy() }}
      title={draft === null ? t('copyTitle') : `${t('copyTitle')} · ${t('copyOf')} ${sourceTitle}`}
      closeLabel={t('close')}
      description={t('copyIntro')}
      className={css.dialog as string}
      footer={(
        <>
          <Button
            variant="outline"
            disabled={draft?.saving === true}
            onClick={() => { actions.cancelCopy() }}
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={draft === null || draft.saving || blocker !== undefined}
            onClick={() => { void actions.confirmCopy() }}
          >
            {draft?.saving === true ? t('creating') : t('create')}
          </Button>
        </>
      )}
    >
      {draft === null
        ? null
        : (
          <div className={css.dialogFields}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('presetId')}</span>
              <input
                className={css.input}
                value={draft.id}
                autoFocus
                spellCheck={false}
                placeholder={t('presetIdPlaceholder')}
                onChange={(event) => { actions.setCopyId(event.target.value) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('displayName')}</span>
              <input
                className={css.input}
                value={draft.name}
                spellCheck={false}
                placeholder={t('displayNamePlaceholder')}
                onChange={(event) => { actions.setCopyName(event.target.value) }}
              />
            </label>
            {message === null ? null : <p className={css.error} role="alert">{message}</p>}
          </div>
        )}
    </Modal>
  )
}

/**
 * Render one card's description, clamped by CSS and offered in full on hover.
 * The tooltip is attached only while the text is actually cut off, so a short
 * description does not answer a hover with a bubble repeating the card.
 * @param props.text - the description as rendered, already localized.
 * @returns the description element, tooltip-anchored while it overflows.
 */
/** 中文说明：函数 CardDescription 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function CardDescription({ text }: { text: string }): ReactNode {
  /** 中文说明：当前处理步骤的局部值 ref，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const ref = useRef<HTMLSpanElement | null>(null)
  /** 中文说明：当前处理步骤的局部值 [truncated, setTruncated]，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    /** 中文说明：当前处理步骤的局部值 el，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const el = ref.current
    /* v8 ignore next -- the ref is attached before layout effects run. */
    if (el === null) return
    /** 中文说明：当前处理步骤的局部值 measure，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const measure = () => { setTruncated(el.scrollHeight > el.clientHeight) }
    measure()
    // Card width follows the settings pane, which resizes with the window.
    if (typeof ResizeObserver === 'undefined') return
    /** 中文说明：当前处理步骤的局部值 observer，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [text])
  return (
    // Capped near the card's own width: the default half-viewport bubble would
    // spill a description out of the settings dialog and across the app behind it.
    <Tooltip label={text} side="bottom" delayMs={400} disabled={!truncated} maxWidth={360}>
      {/* The empty title stops the card body's native tooltip from climbing to
        this span: a cut-off description answers with one bubble, not two. */}
      <span ref={ref} className={css.cardDesc} title="">{text}</span>
    </Tooltip>
  )
}

/**
 * Render the Agent presets section content column.
 * @param props - composed slot props.
 * @returns the section, or null when the deployment composes no presets.
 */
/** 中文说明：函数 AgentPresetSection 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function AgentPresetSection(props: AgentPresetSectionProps): ReactNode {
  /** 中文说明：当前处理步骤的局部值 解构结果，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const { useAgentPresetSection, t, load } = props
  /** 中文说明：当前状态或快照 state，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const state = useAgentPresetSection(snapshot => snapshot)
  /** 中文说明：标识或顺序值 viewedId，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const viewedId = state.view?.id
  /** 中文说明：当前处理步骤的局部值 viewedRow，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const viewedRow = viewedId === undefined ? undefined : state.rows.find(row => row.id === viewedId)
  /** 中文说明：当前处理步骤的局部值 viewedTitle，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const viewedTitle = state.view === null
    ? ''
    : viewedRow === undefined ? state.view.title : presetDisplayText(viewedRow, t).name

  useEffect(() => {
    void load()
  }, [load])

  // A deployment that composes no presets has nothing to manage: every
  // session shares the host composition and the page would be an empty list.
  if (state.status === 'unavailable') return null
  if (state.status === 'error') {
    /** 中文说明：当前处理步骤的局部值 detail，取值由紧邻初始化决定，仅在当前作用域使用。 */
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const detail = state.error ?? ''
    return (
      <div className={css.section}>
        <p className={css.error} role="alert">{`${t('error')} ${detail}`}</p>
        <button type="button" className={css.secondaryButton} onClick={() => { void load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  /* The guided alternative to copying: the self-referential preset can
     read this very composition and author a new one in conversation.
     Offered only where that preset is actually on the roster and a
     session can be landed; without a writable root the draft could
     never be discovered, so the reason rides the disabled button. */
  /** 中文说明：当前处理步骤的局部值 creatorButton，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const creatorButton = props.startCreatorDraft !== undefined && state.rows.some(row => row.id === 'cordis')
    ? (
      <button
        type="button"
        className={css.creatorButton}
        disabled={!state.authorable}
        title={state.authorable ? undefined : t('duplicateUnavailable')}
        onClick={() => {
          props.startCreatorDraft?.()
          props.close()
        }}
      >
        {/* Same glyph as the Models page's add affordances. */}
        <IconPlusOutline16 size={14} />
        {t('creatorDraft')}
      </button>
    )
    : null

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('nav')}</h2>
      <p className={css.intro}>{t('sectionIntro')}</p>
      {state.error === null ? null : <p className={css.error} role="alert">{state.error}</p>}
      {([['system', t('builtInGroup')], ['user', t('customGroup')]] as const).map(([trust, heading]) => {
        /** 中文说明：当前处理步骤的局部值 group，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const group = state.rows
          .filter(row => row.trust === trust)
          .map(row => ({ row, text: presetDisplayText(row, t) }))
        // The custom group is where a preset of one's own will appear, so it
        // stays on screen even while empty: heading plus the creator entry.
        /** 中文说明：当前处理步骤的局部值 tail，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const tail = trust === 'user' ? creatorButton : null
        if (group.length === 0 && tail === null) return null
        return (
          <section key={trust} className={css.group}>
            <h3 className={css.groupHead}>{heading}</h3>
            {group.length === 0 ? null : (
              <ul className={css.cards}>
                {group.map(({ row, text }) => (
                  <li
                    key={row.id}
                    className={row.broken !== undefined
                      ? `${css.card} ${css.cardBroken}`
                      : row.isDefault ? `${css.card} ${css.cardActive}` : css.card}
                  >
                    {/* The card body IS the control: picking a preset is the
                      common act, so it should not hide behind a small button.
                      The action row sits outside it — nesting buttons is
                      invalid, and these act on the card rather than select it.
                      A broken preset cannot compose a session, so its body is
                      disabled and the card says why instead of offering it. */}
                    <button
                      type="button"
                      className={css.cardMain}
                      aria-pressed={row.isDefault}
                      disabled={row.isDefault || row.broken !== undefined}
                      // Without this the name is the whole card read aloud —
                      // title, badge, description, id.
                      aria-label={`${row.broken !== undefined ? t('brokenBadge') : row.isDefault ? t('inUse') : t('setDefault')}: ${text.name}`}
                      title={row.broken ?? (row.isDefault ? t('inUse') : t('setDefault'))}
                      onClick={() => { void props.makeDefault(row.id) }}
                    >
                      <span className={css.cardHead}>
                        <span className={css.cardName}>{text.name}</span>
                        {row.broken !== undefined
                          ? <span className={css.brokenBadge}>{t('brokenBadge')}</span>
                          : null}
                        <span className={css.badge}>
                          {row.trust === 'user' ? t('userTrust') : t('builtIn')}
                        </span>
                        {row.isDefault ? <span className={css.inUse}>{t('inUse')}</span> : null}
                      </span>
                      <CardDescription text={text.description ?? t('noDescription')} />
                      {row.broken === undefined
                        ? null
                        : <span className={css.cardBrokenReason} role="alert">{row.broken}</span>}
                      <code className={css.cardId}>{row.id}</code>
                    </button>
                    <div className={css.cardFoot}>
                      {/* Shipped presets are the compositions a copy starts
                        from, so READING one is the point; a custom preset is
                        edited in its files instead, which the location action
                        leads to. A broken shipped preset has no readable
                        composition to offer, so its viewer is withheld; a
                        broken custom one keeps the location action — the
                        files are where it gets fixed. */}
                      {row.trust === 'system'
                        ? row.broken === undefined
                          ? (
                            <button
                              type="button"
                              className={css.iconButton}
                              data-tip={t('view')}
                              aria-label={`${t('view')}: ${text.name}`}
                              onClick={() => { void props.view(row.id) }}
                            >
                              <IconBrowseOutline16 />
                            </button>
                          )
                          : null
                        : (
                          <button
                            type="button"
                            className={css.iconButton}
                            data-tip={state.hasDocument ? t('openLocation') : t('showLocation')}
                            aria-label={`${state.hasDocument ? t('openLocation') : t('showLocation')}: ${text.name}`}
                            onClick={() => { void props.openLocation(row.id) }}
                          >
                            <IconFolderOpenOutline16 />
                          </button>
                        )}
                      <button
                        type="button"
                        className={css.iconButton}
                        disabled={!state.authorable || row.broken !== undefined}
                        data-tip={row.broken !== undefined
                          ? t('brokenNoCopy')
                          : state.authorable ? t('duplicate') : t('duplicateUnavailable')}
                        aria-label={`${t('duplicate')}: ${text.name}`}
                        onClick={() => { props.beginCopy(row.id) }}
                      >
                        <IconCopyOutline16 />
                      </button>
                      {row.trust === 'user'
                        ? (
                          <button
                            type="button"
                            className={`${css.iconButton} ${css.iconDanger}`}
                            data-tip={t('delete')}
                            aria-label={`${t('delete')}: ${text.name}`}
                            onClick={() => { props.confirmDelete(row.id) }}
                          >
                            <IconTrashOutline16 />
                          </button>
                        )
                        : null}
                    </div>
                    {state.revealedPaths[row.id] === undefined
                      ? null
                      : (
                        <p className={css.revealedPath}>
                          <span className={css.revealedPathLabel}>{t('revealedPathLabel')}</span>
                          <code>{state.revealedPaths[row.id]}</code>
                        </p>
                      )}
                  </li>
                ))}
              </ul>
            )}
            {tail}
          </section>
        )
      })}
      <CopyDialog
        state={state}
        t={t}
        actions={{
          cancelCopy: props.cancelCopy,
          confirmCopy: props.confirmCopy,
          setCopyId: props.setCopyId,
          setCopyName: props.setCopyName,
        }}
      />
      <Modal
        open={state.view !== null}
        onClose={() => { props.closeView() }}
        title={state.view === null ? '' : `${t('view')} · ${viewedTitle}`}
        closeLabel={t('close')}
        description={t('composition')}
        className={css.dialog as string}
        footer={(
          <Button variant="outline" autoFocus onClick={() => { props.closeView() }}>
            {t('close')}
          </Button>
        )}
      >
        {state.view === null
          ? null
          : <pre className={css.viewerCode}>{state.view.content}</pre>}
      </Modal>
      <Modal
        open={state.pendingDelete !== null}
        onClose={() => { props.confirmDelete(null) }}
        title={t('deleteTitle')}
        closeLabel={t('close')}
        description={t('deleteDescription')}
        className={css.deleteDialog as string}
        footer={(
          <>
            <Button
              variant="outline"
              autoFocus
              disabled={state.deleting}
              onClick={() => { props.confirmDelete(null) }}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={css.deleteConfirm}
              disabled={state.deleting}
              onClick={() => { void props.remove() }}
            >
              {state.deleting ? t('deleting') : t('deleteConfirm')}
            </Button>
          </>
        )}
      />
    </div>
  )
}
