/**
 * ================================ 文件注释 ================================
 * 【文件职责】原生目录选择的流程占用者：每次工作区孔位 open 时调用宿主原生选择器
 *             一次，并把唯一结果（路径/取消/失败）回传给所有者会话。
 * 【技术维度】React 无渲染组件：armed ref 保证一次 open 只弹一次选择器；
 *             outcome ref 保证回调总是走最新 props；alive ref 处理卸载
 *             （HMR 替换）时丢弃迟到结果。
 * 【产品维度】选择工作区目录时使用操作系统原生对话框。
 * 【逻辑维度】open 上升沿 → armed 置位 → pick() → 按 alive 判定 → onPicked/onCancel/onError。
 * 【关键边界】无渲染、无状态留存；宿主选择器无按请求取消，卸载后的答案落地即弃。
 * 【新手阅读建议】注意三个 ref 各自解决的问题：armed（防重复）、outcome（防陈旧）、alive（防卸载写入）。
 * ==========================================================================
 */
/**
 * The native picking occupant (package-internal; the `./client` surface
 * exposes only the Loader exports). Same-package tests exercise it directly
 * through this module.
 */
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
// Type-only: the owner contract of the directory-flow holes.
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'

/** Injected face: the wire call the flow drives (bound in apply's closure). */
export interface NativeFlowInjected {
  /** Ask the local Host to open its native single-directory chooser. */
  pick: () => Promise<string | null>
}

/**
 * Renderless flow occupant: each rising `open` edge runs exactly one pick and
 * reports exactly one outcome; the ref arms once per open so re-renders (and
 * an adoption keeping `open` true while `busy`) never launch a second
 * chooser. The owner withdrawing `open` re-arms the next request.
 * @param props - owner conversation plus the injected pick call.
 * @returns nothing — the native chooser renders on the host display.
 */
export function NativeDirectoryFlow(props: DirectoryFlowOwnerProps & NativeFlowInjected): ReactElement | null {
  const { open, pick } = props
  const armed = useRef(false)
  // Callbacks ride a ref so the settled pick reports through the owner's
  // latest handlers, not the ones captured when the chooser opened.
  const outcome = useRef(props)
  outcome.current = props
  // Unmount (HMR replacing the occupant) discards settlements wholesale: the
  // dead instance must neither adopt a path nor drive the owner's error
  // surface. The wire carries no per-request abort, so the host-side chooser
  // survives until answered — its answer just lands nowhere; the replacement
  // instance re-arms under the owner's still-open request. An injected-face
  // identity change alone (re-registration) keeps the pending settlement:
  // the chooser on the host display is still the same dialog.
  const alive = useRef(true)
  useEffect(() => {
    // StrictMode's development replay runs the cleanup once before the real
    // lifetime: re-arm on setup or every outcome would be discarded.
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    if (!open) {
      armed.current = false
      return
    }
    if (armed.current) return
    armed.current = true
    pick().then(
      (path) => {
        if (!alive.current) return
        if (path === null) outcome.current.onCancel(); else outcome.current.onPicked(path)
      },
      (reason: unknown) => {
        if (!alive.current) return
        outcome.current.onError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }, [open, pick])
  return null
}
