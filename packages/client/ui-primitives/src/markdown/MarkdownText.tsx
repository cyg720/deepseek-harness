/**
 * Untrusted assistant-Markdown renderer over the direct mdast pipeline:
 * `parse.ts` grammars, the incremental streaming parser, and `render.tsx`.
 * While a message streams, all but the trailing two blocks freeze as cached
 * React elements and only the source tail behind them re-parses per chunk,
 * so per-chunk work tracks the tail size instead of the whole reply. Frozen
 * blocks keep their source-offset keys when they cross the freeze boundary,
 * so React reconciles instead of remounting. Known deviation while
 * streaming: a reference-style link or footnote whose definition sits on the
 * other side of the freeze boundary renders literally until the settled
 * full parse self-heals it.
 */
/*
 * 文件职责：实现Markdown 与代码内容相关的 MarkdownText 基础组件。
 * 技术维度：React、TypeScript、CSS Modules 和浏览器 DOM API。
 * 产品维度：为上层产品界面提供一致的Markdown 与代码内容展示。
 * 逻辑维度：接收属性，派生展示结构并处理局部交互。
 * 关键边界：组件不拥有业务状态；不可信内容必须经过既有安全渲染路径。
 * 新手阅读建议：先读 Props，再看派生值、事件处理和 JSX。
 */

import { memo, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { IncrementalMarkdownParser } from './incremental.ts'
import { parseGfm, parseGfmWithMath } from './parse.ts'
import {
  collectReferenceTargets, createReferenceTargets, renderBlocks, renderFootnoteSection,
  wrapBlockChildren,
} from './render.tsx'
import type { MarkdownCodeLabels, MarkdownFileMentions, MarkdownRenderContext, ReferenceTargets } from './render.tsx'
import 'katex/dist/katex.min.css'
import css from './MarkdownText.module.css'

export type { MarkdownCodeLabels, MarkdownFileMentions } from './render.tsx'

/** One settled full render: parse with math, resolve references, append the footnote section. */
/* 中文说明：函数 renderSettled 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderSettled(
  text: string,
  codeLabels: MarkdownCodeLabels | undefined,
  fileMentions: MarkdownFileMentions | undefined,
): ReactNode[] {
  /** 中文说明：组件局部值 root，由紧邻初始化决定。 */
  const root = parseGfmWithMath(text)
  /** 中文说明：组件局部值 targets，由紧邻初始化决定。 */
  const targets = createReferenceTargets()
  collectReferenceTargets(root.children, targets)
  /** 中文说明：组件局部值 context，由紧邻初始化决定。 */
  const context: MarkdownRenderContext = {
    streaming: false,
    codeLabels,
    fileMentions,
    targets,
    footnoteOrder: [],
    footnoteCounts: new Map(),
  }
  /** 中文说明：组件局部值 blocks，由紧邻初始化决定。 */
  const blocks = wrapBlockChildren(
    renderBlocks(root.children.map((node, index) => ({ node, key: index })), context),
    false,
  )
  /** 中文说明：组件局部值 section，由紧邻初始化决定。 */
  const section = renderFootnoteSection(context)
  return section === null ? blocks : [...blocks, '\n', section]
}

/**
 * Streaming render state for one growing message: the incremental parser,
 * the frozen blocks' cached elements, and the reference/footnote state their
 * rendering consumed (footnote numbering assigned to frozen references is
 * final, so the tail continues from a copy of it each frame).
 */
/* 中文说明：类型或类 StreamingRenderer 约束基础组件的数据或职责。 */
class StreamingRenderer {
  private readonly parser = new IncrementalMarkdownParser(parseGfm)
  private generation = -1
  private frozenCount = 0
  private frozenElements: ReactNode[] = []
  private frozenTargets: ReferenceTargets = createReferenceTargets()
  private frozenFootnoteOrder: string[] = []
  private frozenFootnoteCounts = new Map<string, number>()
  private lastText: string | null = null
  private lastRendered: ReactNode[] = []

  /** @param codeLabels - Fence copy labels baked into cached elements; the owner replaces the renderer when they change. */
  constructor(private readonly codeLabels: MarkdownCodeLabels | undefined) {}

  /**
   * Render the current accumulated text. Idempotent per text value, so React
   * may re-execute the calling render freely.
   * @param text - The full accumulated markdown source.
   * @returns Frozen elements, re-rendered tail, and the footnote section.
   */
  render(text: string): ReactNode[] {
    if (text === this.lastText) return this.lastRendered
    /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
    const { frozen, tail, generation } = this.parser.update(text)
    if (generation !== this.generation) {
      this.generation = generation
      this.frozenCount = 0
      this.frozenElements = []
      this.frozenTargets = createReferenceTargets()
      this.frozenFootnoteOrder = []
      this.frozenFootnoteCounts = new Map()
    }
    /** 中文说明：组件局部值 newlyFrozen，由紧邻初始化决定。 */
    const newlyFrozen = frozen.slice(this.frozenCount)
    collectReferenceTargets(newlyFrozen.map(block => block.node), this.frozenTargets)
    // Targets visible this frame: everything frozen so far plus the current
    // tail parse — a newly frozen block's references resolved against the
    // same parse tree its definitions came from.
    /** 中文说明：组件局部值 frameTargets，由紧邻初始化决定。 */
    const frameTargets: ReferenceTargets = {
      definitions: new Map(this.frozenTargets.definitions),
      footnotes: new Map(this.frozenTargets.footnotes),
    }
    collectReferenceTargets(tail.map(block => block.node), frameTargets)
    if (newlyFrozen.length > 0) {
      /** 中文说明：组件局部值 frozenContext，由紧邻初始化决定。 */
      const frozenContext: MarkdownRenderContext = {
        streaming: true,
        codeLabels: this.codeLabels,
        fileMentions: undefined,
        targets: frameTargets,
        footnoteOrder: this.frozenFootnoteOrder,
        footnoteCounts: this.frozenFootnoteCounts,
      }
      // Separator newlines are cached alongside the elements so the
      // assembled children match the settled pipeline's block wrapping.
      /** 中文说明：组件局部值 batch，由紧邻初始化决定。 */
      const batch = [...this.frozenElements]
      /** 中文说明：组件局部值 element，由紧邻初始化决定。 */
      for (const element of renderBlocks(newlyFrozen, frozenContext)) {
        if (batch.length > 0) batch.push('\n')
        batch.push(element)
      }
      this.frozenElements = batch
      this.frozenCount = frozen.length
    }
    /** 中文说明：组件局部值 tailContext，由紧邻初始化决定。 */
    const tailContext: MarkdownRenderContext = {
      streaming: true,
      codeLabels: this.codeLabels,
      fileMentions: undefined,
      targets: frameTargets,
      footnoteOrder: [...this.frozenFootnoteOrder],
      footnoteCounts: new Map(this.frozenFootnoteCounts),
    }
    /** 中文说明：组件局部值 children，由紧邻初始化决定。 */
    const children = [...this.frozenElements]
    /** 中文说明：组件局部值 element，由紧邻初始化决定。 */
    for (const element of renderBlocks(tail, tailContext)) {
      if (children.length > 0) children.push('\n')
      children.push(element)
    }
    /** 中文说明：组件局部值 section，由紧邻初始化决定。 */
    const section = renderFootnoteSection(tailContext)
    if (section !== null) children.push('\n', section)
    this.lastText = text
    this.lastRendered = children
    return this.lastRendered
  }
}

/**
 * Render untrusted assistant-authored Markdown as semantic React elements.
 * @param props - Markdown source text preserved by the session projection;
 * `streaming` renders fences and TeX plain (highlighting and KaTeX land on
 * the finalize swap) and parses incrementally across chunks; `codeLabels`
 * forwards localized copy-button labels to fence CodeBlocks — pass a
 * reference-stable object (memoized per locale revision), because a new
 * identity discards the streaming render cache mid-message. `fileMentions`
 * links inline-code tokens its resolver recognizes as real files; this is
 * the single streaming gate — it applies to settled renders only, because a
 * streaming message's vocabulary is not final and frozen cached elements
 * must not bake in handlers that could go stale.
 * @returns A GFM document with TeX math rendered through KaTeX; raw HTML,
 * relative links, and unsafe protocols are disabled, while absolute HTTP(S)
 * images render directly.
 */
/* 中文说明：组件局部值 MarkdownText，由紧邻初始化决定。 */
export const MarkdownText = memo(function MarkdownText({ text, streaming = false, codeLabels, fileMentions }: {
  text: string
  streaming?: boolean
  codeLabels?: MarkdownCodeLabels | undefined
  fileMentions?: MarkdownFileMentions | undefined
}) {
  /** 中文说明：组件局部值 streamRef，由紧邻初始化决定。 */
  const streamRef = useRef<StreamingRenderer | null>(null)
  /** 中文说明：组件局部值 streamLabelsRef，由紧邻初始化决定。 */
  const streamLabelsRef = useRef<MarkdownCodeLabels | undefined>(codeLabels)
  /** 中文说明：组件局部值 children，由紧邻初始化决定。 */
  const children = useMemo(() => {
    if (!streaming) {
      streamRef.current = null
      return renderSettled(text, codeLabels, fileMentions)
    }
    if (streamRef.current === null || streamLabelsRef.current !== codeLabels) {
      streamRef.current = new StreamingRenderer(codeLabels)
      streamLabelsRef.current = codeLabels
    }
    return streamRef.current.render(text)
  }, [text, streaming, codeLabels, fileMentions])
  return <div className={css.markdown}>{children}</div>
})
