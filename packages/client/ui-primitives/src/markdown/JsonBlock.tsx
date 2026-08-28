// JsonBlock: collapsible JSON block (conversation side; independent from the RPC panel's PayloadJson to avoid cross-panel coupling).
/**
 * 文件职责：实现Markdown 与代码内容相关的 JsonBlock 基础组件。
 * 技术维度：React、TypeScript、CSS Modules 和浏览器 DOM API。
 * 产品维度：为上层产品界面提供一致的Markdown 与代码内容展示。
 * 逻辑维度：接收属性，派生展示结构并处理局部交互。
 * 关键边界：组件不拥有业务状态；不可信内容必须经过既有安全渲染路径。
 * 新手阅读建议：先读 Props，再看派生值、事件处理和 JSX。
 */

import { useMemo, useState } from 'react'
import css from './JsonBlock.module.css'

/** 中文说明：组件局部值 MAX_CHARS，由紧邻初始化决定。 */
const MAX_CHARS = 20_000

export function JsonBlock({ label, payload, defaultOpen = false, truncatedLabel }: {
  label: string
  payload: unknown
  defaultOpen?: boolean
  /** Footer appended when the body exceeds the char cap, given the full length (this package is cordis-free, so copy arrives via props). */
  truncatedLabel: (total: number) => string
}) {
  /** 中文说明：组件局部值 [open, setOpen]，由紧邻初始化决定。 */
  const [open, setOpen] = useState(defaultOpen)
  /** 中文说明：组件局部值 body，由紧邻初始化决定。 */
  const body = useMemo(() => {
    if (!open) return ''
    /** 中文说明：组件局部值 s: string，由紧邻初始化决定。 */
    let s: string
    try {
      // lib typing hides stringify's undefined arm (undefined/function/symbol payloads).
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      s = JSON.stringify(payload, null, 2) ?? String(payload)
    } catch {
      s = String(payload)
    }
    return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n${truncatedLabel(s.length)}` : s
  }, [open, payload, truncatedLabel])
  return (
    <div className={css.root}>
      <button type="button" className={css.toggle} onClick={() => { setOpen(v => !v) }}>
        {open ? '▾' : '▸'} {label}
      </button>
      {open && <pre className={css.body}>{body}</pre>}
    </div>
  )
}
