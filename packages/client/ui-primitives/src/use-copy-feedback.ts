/**
 * ================================ 文件注释 ================================
 * 【文件职责】提供 useCopyFeedback Hook：把文本写入剪贴板，并在成功后短暂点亮 copied 标志，
 *             供调用方渲染"复制成功"提示。被 TerminalBlock、SearchBlock 等块状组件共用。
 * 【技术维度】React Hook（useState + useCallback）；异步调用 writeClipboard()，成功后用
 *             setTimeout 在 1000ms 后自动熄灭标志。
 * 【产品维度】用户在查看终端输出、搜索结果时一键复制；界面需要明确反馈"已复制"，
 *             避免用户以为没点中而重复点击。
 * 【逻辑维度】1) 定义 COPIED_FEEDBACK_MS 时长常量；2) 定义 CopyFeedback 返回值接口；
 *             3) useCopyFeedback 维护 copied 状态并返回 onCopy 处理器。
 * 【关键边界】copied 为 true 期间 onCopy 直接忽略新请求（防重复触发）；写入被宿主拒绝
 *             （返回 false）时不点亮标志，绝不对用户谎报复制成功。
 * 【新手阅读建议】重点看 onCopy 内部"防重入 + 异步回调 + 定时复位"的三步流程。
 * ==========================================================================
 */
// The copy-to-clipboard-with-feedback hook shared by the block primitives
// (TerminalBlock, SearchBlock): write the given text, and on success flip a
// transient `copied` flag that the caller renders as a "复制成功" label for one
// second. A refused write leaves the flag untouched, so the control never claims
// a copy the host declined.
// 本文件实现 useCopyFeedback：写入剪贴板，成功时短暂点亮 copied 标志供界面显示
// "复制成功"；写入被宿主拒绝时不点亮，绝不谎报成功。

import { useCallback, useState } from 'react'
import { writeClipboard } from './clipboard.ts'

/** How long the `copied` flag stays true after a successful write, in ms. */
// 复制成功反馈的持续时间：标志点亮 1000ms 后自动熄灭。
const COPIED_FEEDBACK_MS = 1000

/** The copy-feedback hook's return: the transient flag and the copy handler. */
/**
 * useCopyFeedback 的返回值：瞬时标志 copied 与复制处理器 onCopy。
 */
export interface CopyFeedback {
  /** True for {@link COPIED_FEEDBACK_MS} after a successful write; render the success label off it. */
  // 写入成功后为 true 并持续 COPIED_FEEDBACK_MS；界面据此渲染"复制成功"。
  copied: boolean
  /** Copy the hook's text; no-op while `copied` is still true, silent on a refused write. */
  // 执行复制；copied 仍为 true 时忽略调用（防重复触发），写入被拒时静默失败。
  onCopy: () => void
}

/**
 * Copy `text` to the clipboard with one-second success feedback.
 * @param text - the text to write on copy.
 * @returns the `copied` flag and the `onCopy` handler.
 */
/**
 * 将 text 写入剪贴板并附带一秒成功反馈。
 * 使用示例：const { copied, onCopy } = useCopyFeedback(logText)；<button onClick={onCopy}>。
 * @param text - 点击复制时写入剪贴板的文本。
 * @returns copied 标志与 onCopy 处理器。
 */
export function useCopyFeedback(text: string): CopyFeedback {
  const [copied, setCopied] = useState(false)
  // onCopy 依赖 copied 与 text；copied 为 true 时直接忽略，避免反馈期间重复复制。
  const onCopy = useCallback(() => {
    if (copied) return
    // 异步写入：ok 为 false（权限被拒等）时不点亮标志。
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      // 定时复位，让"已复制"提示自动消失。
      window.setTimeout(() => { setCopied(false) }, COPIED_FEEDBACK_MS)
    })
  }, [copied, text])
  return { copied, onCopy }
}
