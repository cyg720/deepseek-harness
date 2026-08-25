import type { ObservableSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionLogDownloadState } from './controller.ts'
import { NS } from './locales.ts'

/** Browser operations and state injected into the Session Header contribution. */
/* 中文：注入会话标题栏贡献的浏览器下载状态与操作。 */
export interface SessionLogDownloadDialogInjected {
  /** 按会话保存下载状态的响应式快照。 */
  hooks: { sessionLogDownload: ObservableSnapshot<SessionLogDownloadState> }
  /** 请求导出指定会话；Promise 在请求流程完成后结算。 */
  request: (sessionId: SessionId) => Promise<void>
  /** 关闭指定会话的导出结果对话框。 */
  dismiss: (sessionId: SessionId) => void
}

/** 会话运行时、导出文案与下载控制器注入面组成的组件属性。 */
export type SessionLogDownloadDialogProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionLogDownloadDialogInjected>

/**
 * Modal shared by the Session Header button and this browser's `/export` command.
 * @param props - Session runtime, bound controller state, actions, and localized copy.
 * @returns the modal portal contribution.
 */
/* 中文：渲染会话导出状态模态框；props 提供会话、快照、关闭动作和翻译，返回 Modal 贡献。 */
export function SessionLogDownloadDialog({
  sessionId, useSessionLogDownload, dismiss, t,
}: SessionLogDownloadDialogProps) {
  /** 当前会话对应的下载条目；尚未请求时为 undefined。 */
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])

  /** 当前下载状态，例如 downloading、success 或 error。 */
  const status = entry?.status
  /** 对话框是否由控制器标记为打开。 */
  const open = entry?.open === true
  /** 失败时的详细或后备错误文案；其他状态为 null。 */
  const error = status === 'error' ? entry?.error || t('dialog.commandFailed') : null
  /** 根据下载状态选择的本地化标题。 */
  const title = status === 'downloading'
    ? t('dialog.preparingTitle')
    : status === 'success' ? t('dialog.successTitle') : t('dialog.errorTitle')
  /** 根据下载状态选择的本地化说明，失败时优先展示具体错误。 */
  const description = status === 'downloading'
    ? t('dialog.preparingDescription')
    : status === 'success' ? t('dialog.successDescription') : error ?? t('dialog.commandFailed')

  return (
    <Modal
      open={open}
      onClose={() => { dismiss(sessionId) }}
      title={title}
      description={description}
      closeLabel={t('dialog.close')}
      footer={<Button variant="primary" onClick={() => { dismiss(sessionId) }}>{t('dialog.close')}</Button>}
    />
  )
}
/**
 * 中文说明：
 * - 文件职责：渲染会话日志下载过程的准备中、成功或失败模态框。
 * - 技术维度：使用 React、外部 ObservableSnapshot、插槽依赖注入、国际化与 Modal 门户。
 * - 产品维度：向用户反馈导出会话日志的进度和结果，并提供统一关闭入口。
 * - 逻辑维度：按 sessionId 读取状态，计算 open/error/title/description，再组装模态框。
 * - 关键边界：没有当前会话条目时保持关闭；本组件不发起下载，只消费控制器状态并 dismiss。
 * - 新手阅读建议：先看 Injected 中状态与动作，再沿 entry、status 到最终 Modal 属性阅读。
 */
