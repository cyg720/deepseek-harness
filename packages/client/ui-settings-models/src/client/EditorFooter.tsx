/**
 * The action row every provider card ends with: dismiss on the left, commit on
 * the right.
 *
 * The two cards commit different things — one creates a route, one edits an
 * existing profile — but the row itself carries no such knowledge. It renders
 * what it is handed, so the cards keep sole ownership of when a commit is
 * allowed and what the in-flight wording is.
 *
 * Cancel refuses input only while a commit is in flight, never because the card
 * is disabled: a card the deployment cannot write to must still be dismissable.
 *
 * @module dsh-client-ui-settings-models/client/EditorFooter
 */
/*
 * 中文说明：
 * - 文件职责：渲染模型提供者编辑卡片共用的取消与提交操作行。
 * - 技术维度：使用 React 函数组件、类型化本地化键和 CSS Modules。
 * - 产品维度：为创建路由和编辑配置提供一致操作，同时让不可写卡片仍可被关闭。
 * - 逻辑维度：读取翻译函数，左侧渲染取消按钮，右侧按 busy 切换提交文案并采用宿主判定的禁用状态。
 * - 关键边界：取消只在提交进行中禁用；submitDisabled 完全由拥有卡片计算，本组件不推断业务规则。
 * - 新手阅读建议：先看 busy 与 submitDisabled 的职责差异，再看两个按钮各自使用的回调和文案。
 */

import type { ReactNode } from 'react'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link EditorFooter}. */
/* 中文：编辑器底部操作行的本地化、状态和动作属性。 */
export interface EditorFooterProps {
  /** Localizer for the row's own labels. */
  /* 中文：把本地化键转换成显示文字的函数。 */
  t: (key: keyof typeof en) => string
  /** Whether a commit is in flight; holds Cancel and swaps the commit label. */
  /* 中文：提交是否进行中；会禁用取消并切换提交按钮文案。 */
  busy: boolean
  /** Whether the commit is refused, as judged by the owning card. */
  /* 中文：拥有卡片判定的提交禁用状态。 */
  submitDisabled: boolean
  /** Commit label while idle. */
  submitLabelKey: keyof typeof en
  /** Commit label while a commit is in flight. */
  submitBusyLabelKey: keyof typeof en
  /** Dismiss label; defaults to the settings editor copy. */
  cancelLabelKey?: keyof typeof en
  /** Dismiss the card without committing. */
  /* 中文：不提交并关闭卡片的回调。 */
  onCancel: () => void
  /** Run the card's commit. */
  /* 中文：执行拥有卡片提交逻辑的回调。 */
  onSubmit: () => void
}

/**
 * Render one provider card's action row.
 * @param props - the labels, commit gating, and handlers the owning card supplies.
 * @returns the cancel/commit row.
 */
/* 中文：渲染取消/提交操作行；props 提供门控、文案和回调，返回 ReactNode。示例：<EditorFooter {...props} />。 */
export function EditorFooter(props: EditorFooterProps): ReactNode {
  /** 当前本地化函数的便捷引用。 */
  const { t } = props
  return (
    <div className={styles['editorActions']}>
      <button
        type="button"
        className={styles['secondaryButton']}
        disabled={props.busy}
        onClick={props.onCancel}
      >
        {t(props.cancelLabelKey ?? 'cancel')}
      </button>
      <button
        type="button"
        className={styles['primaryButton']}
        disabled={props.submitDisabled}
        onClick={props.onSubmit}
      >
        {props.busy ? t(props.submitBusyLabelKey) : t(props.submitLabelKey)}
      </button>
    </div>
  )
}
