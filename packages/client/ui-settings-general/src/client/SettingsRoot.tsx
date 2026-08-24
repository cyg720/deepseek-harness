/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel (figma 501:29947, 1080x700) with the section nav rail. The shell is
 * a pure composition face — every piece of text (trigger label, panel title,
 * close label, sections) arrives from registrants through slots; accessible
 * names resolve to that content (trigger: its own text; dialog:
 * aria-labelledby the title node; close: visually-hidden slot text). Modal
 * open state and the active section id are component-local viewing state;
 * the onboarding coordinator mounts exactly one ordered registrant while the
 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs
 * to the step, so a mounted-but-deciding step paints nothing here.
 */
/**
 * 文件职责：实现通用设置的 SettingsRoot 模块。
 * 技术维度：React、TypeScript、Context、外部 Store 订阅和 Cordis 插槽。
 * 产品维度：为界面提供正确作用域的会话与插槽渲染。
 * 逻辑维度：绑定作用域，订阅状态，向子树提供值并清理。
 * 关键边界：不能跨会话复用旧授权或旧投影；卸载必须取消订阅。
 * 新手阅读建议：先读导出类型，再看 Provider/Hook 和清理逻辑。
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16, IconCloseOutline16, IconDataOutline16,
  IconPersonalizationOutline16, IconSettingsOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.module.css'

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
/** 中文说明：函数 navIcon 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function navIcon(id: string) {
  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  return <IconSettingsOutline16 className={css.navIcon} size={16} />
}

/** 中文说明：类型或类 PanelProps 约束模块数据或职责。 */
type PanelProps = {
  rows: readonly SettingsSectionRow[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  activeId: string | undefined
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * The modal layer: full-viewport mask + centered panel. Close paths: the
 * header button, a mask click, and document-level Escape (mounted only while
 * open, so the listener lifetime is the panel's).
 */
/** 中文说明：函数 SettingsPanel 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function SettingsPanel({ rows, renderSlot, activeId, onSelect, onClose }: PanelProps) {
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first row when the id is gone.
  /** 中文说明：模块局部值 active，由紧邻初始化决定。 */
  const active = rows.find(r => r.id === activeId)?.id ?? rows[0]?.id
  /** 中文说明：模块局部值 titleId，由紧邻初始化决定。 */
  const titleId = useId()

  useEffect(() => {
    /** 中文说明：模块局部值 onKeyDown，由紧邻初始化决定。 */
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  // Baseline focus management: entering the dialog lands on the close button.
  /** 中文说明：模块局部值 closeButton，由紧邻初始化决定。 */
  const closeButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { closeButton.current?.focus() }, [])

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <nav className={css.nav}>
          <div className={css.navTitle} id={titleId}>{renderSlot('settings.header', {})}</div>
          <div className={css.navList}>
            {rows.map(row => (
              <button
                key={row.id}
                type="button"
                className={clsx(css.navCell, row.id === active && css.active)}
                aria-current={row.id === active ? 'true' : undefined}
                onClick={() => { onSelect(row.id) }}
              >
                {navIcon(row.id)}
                <span className={css.navLabel}>{row.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className={css.content}>
          <div className={css.header}>
            <div className={css.actions}>{renderSlot('settings.action', {})}</div>
            <button ref={closeButton} type="button" className={css.close} onClick={onClose}>
              <IconCloseOutline16 size={14} />
              <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
            </button>
          </div>
          <div className={css.options}>
            {active !== undefined && renderSlot('settings.section', { close: onClose }, { only: active })}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
/** 中文说明：函数 SettingsRoot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  /** 中文说明：模块局部值 解构结果，由紧邻初始化决定。 */
  const { wide, useSections, useOnboardingSteps, useSessions, renderSlot } = props
  /** 中文说明：模块局部值 [open, setOpen]，由紧邻初始化决定。 */
  const [open, setOpen] = useState(false)
  /** 中文说明：模块局部值 [activeId, setActiveId]，由紧邻初始化决定。 */
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  /** 中文说明：模块局部值 解构结果，由紧邻初始化决定。 */
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  /** 中文说明：模块局部值 close，由紧邻初始化决定。 */
  const close = useCallback(() => {
    setOpen(false)
    setActiveId(undefined)
  }, [])
  /** 中文说明：模块局部值 openSection，由紧邻初始化决定。 */
  const openSection = useCallback((id: string) => {
    setActiveId(id)
    setOpen(true)
  }, [])

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  /** 中文说明：模块局部值 rows，由紧邻初始化决定。 */
  const rows = useSections(s => s)
  /** 中文说明：模块局部值 onboardingSteps，由紧邻初始化决定。 */
  const onboardingSteps = useOnboardingSteps(s => s)
  /** 中文说明：模块局部值 onboardingActive，由紧邻初始化决定。 */
  const onboardingActive = useSessions(state =>
    state.phase === 'ready'
    && (state.current === undefined || state.byId[state.current]?.blank === true))
  /** 中文说明：模块局部值 onboardingStep，由紧邻初始化决定。 */
  const onboardingStep = onboardingActive
    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  /** 中文说明：模块局部值 completeOnboardingStep，由紧邻初始化决定。 */
  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  return (
    <>
      <button
        type="button"
        className={clsx(css.trigger, !wide && css.rail)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(true) }}
      >
        {renderSlot('settings.trigger', { wide })}
      </button>
      {open && (
        <SettingsPanel
          rows={rows}
          renderSlot={renderSlot}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={close}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
