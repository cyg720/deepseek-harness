/*
 * ================================ 文件注释 ================================
 * 【文件职责】浏览式目录选择的流程占用者：把工作区目录流程孔位的"所有者会话"
 *             适配到应用内浏览对话框上——确认目录即选定路径，关闭即取消。
 * 【技术维度】React 组件包装：createElement 装配 DirectoryBrowser；
 *             注入面（BrowseFlowInjected）由 apply 闭包绑定线缆调用与文案。
 * 【产品维度】选择工作区目录时的应用内浏览对话框。
 * 【逻辑维度】BrowseDirectoryFlow 把 owner 会话的 onPicked/onCancel 映射为
 *             对话框的 onOpen/onClose，浏览失败留在对话框自己的告警面里。
 * 【关键边界】包内私有模块（./client 只暴露 Loader 导出）；不驱动 owner 的 onError。
 * 【新手阅读建议】结合 ui-workspace 的孔位契约与 DirectoryBrowser.tsx 阅读。
 * ==========================================================================
 */
/**
 * The browse picking occupant (package-internal; the `./client` surface
 * exposes only the Loader exports). Same-package tests exercise it directly
 * through this module.
 */
import { createElement } from 'react'
import type { ReactElement } from 'react'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the owner contract of the directory-flow holes.
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { DirectoryBrowser } from './DirectoryBrowser.tsx'

/** Injected face: the browse wire calls and copy the dialog drives (bound in apply's closure). */
export interface BrowseFlowInjected {
  /** List one directory level (absent path = the Host home directory); the signal aborts a superseded scan. */
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  /** Create one child directory under an existing parent. */
  createDirectory: (path: string, name: string) => Promise<string>
  /** Localized dialog copy (this package's namespace). */
  t: Translate
}

/**
 * Flow occupant: adapts the hole's owner conversation onto the browser
 * dialog — a confirmed directory is the picked path, dismissal is the
 * cancellation. Browse failures (unreadable targets, create conflicts) stay
 * inside the dialog's own alert surfaces, so the owner's `onError` arm is
 * never driven by this occupant.
 * @param props - owner conversation plus the injected browse face.
 * @returns the dialog element (renders nothing while closed).
 */
export function BrowseDirectoryFlow(props: DirectoryFlowOwnerProps & BrowseFlowInjected): ReactElement {
  return createElement(DirectoryBrowser, {
    open: props.open,
    busy: props.busy,
    listDirectory: props.listDirectory,
    createDirectory: props.createDirectory,
    t: props.t,
    onOpen: props.onPicked,
    onClose: props.onCancel,
  })
}
