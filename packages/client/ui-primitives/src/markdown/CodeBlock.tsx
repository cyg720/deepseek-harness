// CodeBlock: one code surface for every consumer — markdown fences, the
// run_code program body, and the details panel's raw args/output — with
// shiki highlighting for the registered grammars and an identical-geometry
// plain fallback for everything else. Chrome (language banner + copy) matches
// deepsuite `@deepseek/md` code blocks; token colors stay on `--shiki-*`.
/**
 * 文件职责：实现Markdown 与代码内容相关的 CodeBlock 基础组件。
 * 技术维度：React、TypeScript、CSS Modules 和浏览器 DOM API。
 * 产品维度：为上层产品界面提供一致的Markdown 与代码内容展示。
 * 逻辑维度：接收属性，派生展示结构并处理局部交互。
 * 关键边界：组件不拥有业务状态；不可信内容必须经过既有安全渲染路径。
 * 新手阅读建议：先读 Props，再看派生值、事件处理和 JSX。
 */

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { writeClipboard } from '../clipboard.ts'
import { grammarLoadCount, highlightToHtml, subscribeGrammarLoaded } from './highlight.ts'
import css from './CodeBlock.module.css'

/** 中文说明：类型或类 CodeBlockProps 约束基础组件的数据或职责。 */
export interface CodeBlockProps {
  /** The source text, rendered verbatim (trailing newline trimmed for display). */
  code: string
  /** Grammar hint (markdown fence info string or a fixed caller id); unknown = plain. */
  lang?: string | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /** Copy-button idle label; the owner passes localized copy (this package is cordis-free, so copy arrives via props). */
  copyLabel?: string | undefined
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel?: string | undefined
}

/** 中文说明：函数 CodeBlock 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function CodeBlock({ code, lang, className, copyLabel = '复制', copiedLabel = '复制成功' }: CodeBlockProps) {
  /** 中文说明：组件局部值 trimmed，由紧邻初始化决定。 */
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code
  // Re-render when a lazy grammar finishes loading, so a fence that showed plain
  // text while its language's grammar imported picks up highlighting. The
  // snapshot value is opaque; only its change across renders drives the memo.
  /** 中文说明：组件局部值 loaded，由紧邻初始化决定。 */
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  /** 中文说明：组件局部值 html，由紧邻初始化决定。 */
  const html = useMemo(() => highlightToHtml(trimmed, lang), [trimmed, lang, loaded])
  /** 中文说明：组件局部值 rootRef，由紧邻初始化决定。 */
  const rootRef = useRef<HTMLDivElement>(null)
  /** 中文说明：组件局部值 [copied, setCopied]，由紧邻初始化决定。 */
  const [copied, setCopied] = useState(false)

  /** 中文说明：组件局部值 onCopy，由紧邻初始化决定。 */
  const onCopy = useCallback(() => {
    if (copied) return
    /* v8 ignore next -- both arms always mount a <pre>; trimmed is the
       typed fallback if the DOM shape ever diverges. */
    /** 中文说明：组件局部值 text，由紧邻初始化决定。 */
    const text = rootRef.current?.querySelector('pre')?.textContent ?? trimmed
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, trimmed])

  /** 中文说明：组件局部值 body，由紧邻初始化决定。 */
  const body = html === undefined
    ? (
      <pre className={css.plain}><code>{trimmed}</code></pre>
    )
    : (
  // shiki's output is a static span tree it generated from `code` (no user
  // HTML passes through), the sanctioned innerHTML consumption path per
  // shiki's own docs.
      <div dangerouslySetInnerHTML={{ __html: html }} />
    )

  return (
    <div ref={rootRef} className={clsx(css.block, 'md-code-block', className)}>
      <div className={css.bannerWrap}>
        <div className={css.banner}>
          <div className={css.infostring}>{lang ?? ''}</div>
          <div className={css.action}>
            <button type="button" className={css.copyButton} onClick={onCopy}>
              {copied ? copiedLabel : copyLabel}
            </button>
          </div>
        </div>
      </div>
      {body}
    </div>
  )
}
