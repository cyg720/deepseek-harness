/** 每次目录请求最多打开一个 OS 选择器；旧实例和旧请求的完成结果不可回传。 */
import { useEffect, useRef } from 'react'
import type { QsDirectoryFlowOwner } from '@deepseek-ai/dsh-qs-sessions/client'

/** 原生选择器只调用官方目录服务。 */
export interface NativeFlowInjected {
  /**
   * 打开 Host 原生单目录选择器。
   * @returns Host 目录路径，或取消时的 null。
   */
  readonly pick: () => Promise<string | null>
}

/**
 * 无 DOM 的原生选择流程，支持开发模式 effect 重放而不重复打开 OS 对话框。
 * @param props - 请求身份、官方 owner 回调及选择服务。
 * @returns 不渲染浏览器节点。
 */
export function NativeDirectoryFlow(props: QsDirectoryFlowOwner & NativeFlowInjected): null {
  const latest = useRef(props)
  latest.current = props
  const attempt = useRef<{ request: symbol; result: Promise<string | null> } | undefined>(undefined)
  const { open, request } = props
  useEffect(() => {
    if (!open) { attempt.current = undefined; return }
    // 采纳阶段重装呈现时，已有目录结果不能再次启动 OS 对话框。
    if (latest.current.busy) return
    if (attempt.current?.request !== request) {
      // 缓存的是本请求的实际调用；StrictMode 清理/重放只替换监听，不重复打开对话框。
      const pick = latest.current.pick
      attempt.current = { request, result: Promise.resolve().then(() => pick()) }
    }
    let active = true
    const live = (): boolean => active && latest.current.open && latest.current.request === request
    attempt.current.result.then((path) => {
      if (!live()) return
      if (path === null) latest.current.onCancel()
      else latest.current.onPicked(path)
    }, (error: unknown) => {
      if (live()) latest.current.onError(error instanceof Error ? error.message : String(error))
    })
    return () => { active = false }
  }, [open, request])
  return null
}
