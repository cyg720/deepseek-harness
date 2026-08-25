/**
 * 文件职责：在会话页头渲染日志下载入口，并挂载共享的下载结果对话框。
 * 技术维度：使用 React TSX、会话级状态选择器、CSS Module 和客户端图标组件。
 * 产品维度：让用户从当前会话直接导出日志，并看到下载进行中或结果反馈。
 * 逻辑维度：从属性提取会话与控制器，读取对应下载状态，禁用忙碌按钮并渲染对话框。
 * 关键边界：状态按字符串化 sessionId 索引；下载中不得重复提交请求。
 * 新手阅读建议：先看 props 类型来自 Dialog，再跟踪 entry、busy 和按钮 onClick 三者的关系。
 */
import type { ReactNode } from 'react'
import { IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import css from './HeaderAction.module.css'

/**
 * Render the Session Header export capsule and its shared result dialog.
 * @param props - Session runtime, download controller, and localized dialog copy.
 * @returns the persistent Header action and Session-scoped dialog.
 */
/*
 * 渲染会话日志下载页头操作。
 * @param props 会话标识、下载状态控制器和本地化对话框文案。
 * @returns 常驻页头按钮及会话范围的结果对话框。
 * @example <SessionLogDownloadHeaderAction {...props} />。
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadDialogProps): ReactNode {
  // 当前会话标识、状态 hook 和请求函数；均由下载对话框的公共属性提供。
  const { sessionId, useSessionLogDownload, request } = props
  // 当前会话的下载记录；尚未发起下载时为 undefined。
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])
  // 是否正在下载；只在状态严格等于 downloading 时禁用按钮。
  const busy = entry?.status === 'downloading'

  return (
    <>
      <button
        type="button"
        className={css.sessionLogButton}
        disabled={busy}
        aria-busy={busy}
        onClick={() => { void request(sessionId) }}
      >
        <span>Session log</span>
        <IconDownloadOutline16 size={12} />
      </button>
      <SessionLogDownloadDialog {...props} />
    </>
  )
}
