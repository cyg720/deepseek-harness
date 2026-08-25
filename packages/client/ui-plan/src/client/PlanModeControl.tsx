/**
 * 文件职责：实现计划模式的 PlanModeControl 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：支持用户查看或调整计划模式。
 * 逻辑维度：读取服务状态，派生展示值并处理交互。
 * 关键边界：加载、禁用、错误和可访问性状态必须一致。
 * 新手阅读建议：先读 Props，再看状态、effect 与 JSX。
 */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the input.plan seat and
// its {locked} owner share).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PlanChipInjected } from './index.ts'
import css from './PlanModeControl.module.css'

/** Full plan-seat component props: runtime share (standard kit + locked owner prop) & injected share & the locale seat. */
/* 中文说明：类型或类 PlanChipProps 约束本文件数据或组件职责。 */
export type PlanChipProps =
  PropsRuntime<'conversation.input.plan'> & InjectFace<PlanChipInjected> & PropsLocale<'plan'>

/**
 * Plan-mode status over the host-computed `plan` projection. The chip renders
 * only while the effective target is plan mode (`pending ? !active : active`
 * — a folded host value, not client optimism) and executes /plan off.
 */
/* 中文说明：函数 PlanChip 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function PlanChip({ useProjection, locked, exitPlanMode, t }: PlanChipProps) {
  /** 中文说明：组件局部值 plan，由紧邻初始化决定。 */
  const plan = useProjection('plan')
  /** 中文说明：组件局部值 [leaving, setLeaving]，由紧邻初始化决定。 */
  const [leaving, setLeaving] = useState(false)
  /** 中文说明：组件局部值 [error, setError]，由紧邻初始化决定。 */
  const [error, setError] = useState<string | null>(null)
  /** 中文说明：组件局部值 aliveRef，由紧邻初始化决定。 */
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  if (plan === undefined) return null
  /** 中文说明：组件局部值 target，由紧邻初始化决定。 */
  const target = plan.pending ? !plan.active : plan.active
  if (!target) return null

  /** 中文说明：组件局部值 off，由紧邻初始化决定。 */
  const off = (): void => {
    // No leaving/locked guard: both disable the button, so no click arrives.
    setLeaving(true)
    setError(null)
    void exitPlanMode().then((failure) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={css.chip}
        aria-label={t('chip.on.aria')}
        title={t('chip.on.title')}
        disabled={locked || leaving}
        onClick={off}
      >
        {/* Design literal, not copy: the chip wordmark stays 'Plan' in every locale. */}
        Plan
        <span className={css.close} aria-hidden>
          <IconCloseFill14 size={12} />
        </span>
      </button>
      {/* Failure copy stays English (error-surface policy: not localized). */}
      {error !== null && <span className={css.error} role="status" title={error}>failed to exit plan mode</span>}
    </span>
  )
}
