/** Product-wide, versioned internal-testing notice. */
/*
 * 文件职责：实现模型设置的 WelcomeNotice 组件。
 * 技术维度：React、TypeScript、受控表单、Cordis 插槽和 CSS Modules。
 * 产品维度：帮助用户查看和调整模型设置。
 * 逻辑维度：读取状态，编辑草稿，调用保存或发现操作并展示结果。
 * 关键边界：界面可见信息不代表授权；密钥只显示配置状态，不显示原值。
 * 新手阅读建议：先读 Props 和状态类型，再看事件处理与 JSX。
 */

import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WelcomeNoticeState, WelcomeNoticeStore } from './welcome-store.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import css from './WelcomeNotice.module.css'

/** Registration-side dependencies of {@link WelcomeNotice}. */
/* 中文说明：类型或类 WelcomeNoticeInjected 约束设置数据或组件职责。 */
export interface WelcomeNoticeInjected {
  hooks: {
    /** Durable or process-local acknowledgement state. */
    welcome: SnapshotStore<WelcomeNoticeState>
  }
  /** Welcome acknowledgement controller. */
  controller: WelcomeNoticeStore
  /** Onboarding copy. */
  t: (key: keyof typeof en) => string
}

/** Coordinator owner props plus this step's injected face. */
/* 中文说明：类型或类 WelcomeNoticeProps 约束设置数据或组件职责。 */
export type WelcomeNoticeProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<WelcomeNoticeInjected>

/**
 * Render the current notice until its exact copy version is acknowledged.
 * @param props - settings-shell owner state and welcome dependencies.
 * @returns the welcome modal or null while the step decides not to show.
 */
/* 中文说明：函数 WelcomeNotice 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
export function WelcomeNotice(props: WelcomeNoticeProps): ReactNode {
  /** 中文说明：设置局部值 解构结果，由紧邻初始化决定。 */
  const { complete, controller, useWelcome, t } = props
  /** 中文说明：设置局部值 state，由紧邻初始化决定。 */
  const state = useWelcome(snapshot => snapshot)
  /** 中文说明：设置局部值 finished，由紧邻初始化决定。 */
  const finished = useRef(false)
  /** 中文说明：设置局部值 finish，由紧邻初始化决定。 */
  const finish = useCallback((): void => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (state.acknowledged) finish()
  }, [finish, state.acknowledged])

  if (state.status === 'idle' || state.status === 'loading' || state.acknowledged) return null

  /** 中文说明：设置局部值 acknowledge，由紧邻初始化决定。 */
  const acknowledge = async (): Promise<void> => {
    if (await controller.acknowledge()) finish()
  }
  /** 中文说明：设置局部值 paragraphs，由紧邻初始化决定。 */
  const paragraphs = t('welcomeBody').split('\n\n')

  return (
    <OnboardingModal title={t('welcomeTitle')} focusTitle>
      <div className={css.copy}>
        {paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </div>
      {state.error === null ? null : <p className={css.error} role="alert">{t('welcomeError')}</p>}
      <div className={css.actions}>
        <Button
          variant="primary"
          className={css.primary}
          disabled={state.status === 'saving'}
          onClick={() => { void acknowledge() }}
        >
          {t('welcomeContinue')}
        </Button>
      </div>
    </OnboardingModal>
  )
}
