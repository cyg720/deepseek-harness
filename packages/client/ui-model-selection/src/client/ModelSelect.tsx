/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own list — the provider-grouped model list over
 * the shared directory, and the effort levels. The trigger (313:14108's
 * ToggleButton) shows both: model name + effort in the caption tone.
 * Data and submission ride the SAME per-session ModelDirectory as the
 * /model popup; exact-model reasoning metadata and the selected effort come
 * from the Host rather than a client-owned vocabulary. A rejected selection
 * announces through the shared transient Toast anchored to the composer
 * card; the in-menu strip with Retry remains the catalog-load surface.
 */
/**
 * 文件职责：实现模型选择的 ModelSelect 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：支持用户查看或调整模型选择。
 * 逻辑维度：读取服务状态，派生展示值并处理交互。
 * 关键边界：加载、禁用、错误和可访问性状态必须一致。
 * 新手阅读建议：先读 Props，再看状态、effect 与 JSX。
 */
import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  /** 中文说明：类型或类 KeyboardEvent 约束本文件数据或组件职责。 */
  type KeyboardEvent, type FocusEvent,
} from 'react'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconWarningOutline16, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
/** 中文说明：类型或类 Pane 约束本文件数据或组件职责。 */
type Pane = 'root' | 'model' | 'effort'

/** One dynamic effort row; undefined means preserve the provider default. */
/** 中文说明：类型或类 EffortChoice 约束本文件数据或组件职责。 */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
/** 中文说明：函数 ModelSelect 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  /** 中文说明：组件局部值 state，由紧邻初始化决定。 */
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  /** 中文说明：组件局部值 [open, setOpen]，由紧邻初始化决定。 */
  const [open, setOpen] = useState(false)
  /** 中文说明：组件局部值 [pane, setPane]，由紧邻初始化决定。 */
  const [pane, setPane] = useState<Pane>('root')
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  /** 中文说明：组件局部值 lastActionRef，由紧邻初始化决定。 */
  const lastActionRef = useRef<'load' | 'select'>('load')
  /** 中文说明：组件局部值 [toast, setToast]，由紧邻初始化决定。 */
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  /** 中文说明：组件局部值 toastSeq，由紧邻初始化决定。 */
  const toastSeq = useRef(0)
  /** 中文说明：组件局部值 rootRef，由紧邻初始化决定。 */
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** 中文说明：组件局部值 triggerRef，由紧邻初始化决定。 */
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  /** 中文说明：组件局部值 itemRefs，由紧邻初始化决定。 */
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  /** 中文说明：组件局部值 id，由紧邻初始化决定。 */
  const id = useId()

  /** 中文说明：组件局部值 choices，由紧邻初始化决定。 */
  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  /** 中文说明：组件局部值 selectedIndex，由紧邻初始化决定。 */
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
  /** 中文说明：组件局部值 currentChoice，由紧邻初始化决定。 */
  const currentChoice = choices[selectedIndex]
  /** 中文说明：组件局部值 reasoning，由紧邻初始化决定。 */
  const reasoning = currentChoice?.model.reasoning
  /** 中文说明：组件局部值 effectiveEffort，由紧邻初始化决定。 */
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  /** 中文说明：组件局部值 effortLabel，由紧邻初始化决定。 */
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  /** 中文说明：组件局部值 effortChoices，由紧邻初始化决定。 */
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      })),
    ], [reasoning, t])
  /** 中文说明：组件局部值 busy，由紧邻初始化决定。 */
  const busy = state.status === 'selecting'

  /** 中文说明：组件局部值 reload，由紧邻初始化决定。 */
  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (available) {
      lastActionRef.current = 'load'
      load()
    }
  }, [available, load])

  useEffect(() => {
    if (!open) return
    /** 中文说明：组件局部值 closeOutside，由紧邻初始化决定。 */
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  if (!available) return null

  /** 中文说明：组件局部值 show，由紧邻初始化决定。 */
  const show = (): void => {
    setPane('root')
    setOpen(true)
    reload()
  }

  /** 中文说明：组件局部值 close，由紧邻初始化决定。 */
  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  /** 中文说明：组件局部值 moveFocus，由紧邻初始化决定。 */
  const moveFocus = (offset: number): void => {
    /** 中文说明：组件局部值 items，由紧邻初始化决定。 */
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    /** 中文说明：组件局部值 active，由紧邻初始化决定。 */
    const active = items.findIndex(item => item === document.activeElement)
    /** 中文说明：组件局部值 next，由紧邻初始化决定。 */
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  /** 中文说明：组件局部值 onRootKeyDown，由紧邻初始化决定。 */
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  /** 中文说明：组件局部值 onBlur，由紧邻初始化决定。 */
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  /** 中文说明：组件局部值 settleSelection，由紧邻初始化决定。 */
  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    /** 中文说明：组件局部值 message，由紧邻初始化决定。 */
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  /** 中文说明：组件局部值 choose，由紧邻初始化决定。 */
  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  /** 中文说明：组件局部值 chooseEffort，由紧邻初始化决定。 */
  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    /** 中文说明：组件局部值 selection，由紧邻初始化决定。 */
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  /** 中文说明：组件局部值 modelLabel，由紧邻初始化决定。 */
  const modelLabel = currentChoice?.model.name ?? t('trigger.fallback')
  /** 中文说明：组件局部值 triggerLabel，由紧邻初始化决定。 */
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  /** 中文说明：组件局部值 triggerAria，由紧邻初始化决定。 */
  const triggerAria = currentChoice === undefined
    ? t('trigger.selectAria')
    : effortLabel === undefined
      ? t('trigger.aria', { model: modelLabel })
      : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  itemRefs.current = []
  /** 中文说明：组件局部值 itemIndex，由紧邻初始化决定。 */
  let itemIndex = 0
  /** 中文说明：组件局部值 itemRef，由紧邻初始化决定。 */
  const itemRef = () => {
    /** 中文说明：组件局部值 at，由紧邻初始化决定。 */
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.menu}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('model') }}>
                <span className={css.cellLabel}>{t('menu.model')}</span>
                <span className={css.cellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.cellChevron} />
              </button>
              {reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}>
                  <span className={css.cellLabel}>{t('menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'model' && (
            <>
              {state.status === 'loading' && (
                <div className={css.status}>{t('status.loading')}</div>
              )}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              )}
              {state.failures.map(failure => (
                <div className={css.warning} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              ))}
              <div className={clsx(css.groups, 'scrollable')}>
                {state.groups.map((group) => {
                  /** 中文说明：组件局部值 headingId，由紧邻初始化决定。 */
                  const headingId = `${id}-${group.id}`
                  return (
                    <section role="group" aria-labelledby={headingId} className={css.group} key={group.id}>
                      <div className={css.groupTitle} id={headingId}>{group.name}</div>
                      {group.models.map((model) => {
                        /** 中文说明：组件局部值 selected，由紧邻初始化决定。 */
                        const selected = state.current?.provider === group.id && state.current.model === model.id
                        return (
                          <button
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={clsx(css.option, selected && css.selected)}
                            key={model.id}
                            title={model.name}
                            disabled={busy}
                            onClick={() => { choose({ provider: group.id, model: model.id }) }}
                          >
                            <span className={css.optionCopy}>
                              <span className={css.modelName}>{model.name}</span>
                              {model.description !== undefined && (
                                <span className={css.description}>{model.description}</span>
                              )}
                            </span>
                            <span className={css.check}>
                              {selected ? <IconCheckOutline16 /> : null}
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  )
                })}
              </div>
              {state.status === 'ready' && choices.length === 0 && (
                <div className={css.empty}>{t('empty.models')}</div>
              )}
            </>
          )}

          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
                </div>
              )}
              {effortChoices.length === 0
                ? <div className={css.empty}>{t('empty.efforts')}</div>
                : effortChoices.map(level => (
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={effectiveEffort === level.effort}
                    className={clsx(css.option, effectiveEffort === level.effort && css.selected)}
                    key={level.key}
                    disabled={busy}
                    onClick={() => { chooseEffort(level.effort) }}
                  >
                    <span className={css.optionCopy}>
                      <span className={css.modelName}>{level.label}</span>
                      {level.description !== undefined && (
                        <span className={css.description}>{level.description}</span>
                      )}
                    </span>
                    <span className={css.check}>
                      {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                    </span>
                  </button>
                ))}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
