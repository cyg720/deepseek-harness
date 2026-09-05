/**
 * Direct mdast→React markdown renderer. Replaces the react-markdown /
 * remark-rehype pipeline with one switch over parsed nodes so streaming can
 * cache frozen blocks as React elements; the rendered DOM is pinned
 * byte-for-byte by `tests/fixtures/markdown-dom` and must not drift.
 *
 * Untrusted-output policy (unchanged from the replaced pipeline): link and
 * image destinations pass a protocol allowlist, images additionally require
 * absolute HTTP(S), raw HTML renders as literal text (no HTML enters the
 * DOM), and KaTeX runs without trusted commands. Fragment-anchor URLs fail
 * the allowlist, so footnote references and back-references render as plain
 * text rather than in-page links.
 *
 * Merge-extensible node unions fall through the documented default (render
 * nothing) rather than ending in assertNever: grammars registered elsewhere
 * may add node types this renderer has no mapping for.
 */

/*
 * 【文件职责】将 mdast 直接渲染为 React 节点并复用冻结流式块；
 * 链接和图片必须通过协议限制，原始 HTML 按文本显示。
 */

import { Fragment, createElement } from 'react'
import type { Key, ReactNode } from 'react'
import clsx from 'clsx'
import type * as Md from 'mdast'
import type {} from 'mdast-util-math'
import { normalizeUri } from 'micromark-util-sanitize-uri'
import { CodeBlock } from './CodeBlock.tsx'
import { renderTexToReact } from './katex.tsx'
import { LinkIcon, classifyLinkPath } from '../LinkIcon.tsx'
import type { PositionedBlock } from './incremental.ts'
import css from './MarkdownText.module.css'

/** Copy-button labels forwarded to fence CodeBlocks (this package is cordis-free, so copy arrives via props). */
/* 中文说明：类型或类 MarkdownCodeLabels 约束基础组件的数据或职责。 */
export interface MarkdownCodeLabels {
  /** Copy-button idle label. */
  copyLabel: string
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel: string
}

/** Localized chrome for a Markdown document. */
export interface MarkdownLabels {
  code: MarkdownCodeLabels
  footnotes: string
}

/** 中文说明：函数 sanitizeUrl 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sanitizeUrl(url: string): string {
  try {
    switch (new URL(url).protocol) {
      case 'http:':
      case 'https:':
      case 'mailto:':
        return url
      default:
        return ''
    }
  } catch {
    // Relative and otherwise unparsable destinations are disallowed alongside
    // disallowed protocols; new URL() has no other failure mode for strings.
    return ''
  }
}

/** 中文说明：函数 remoteImageUrl 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function remoteImageUrl(url: string): string | undefined {
  try {
    /** 中文说明：组件局部值 protocol，由紧邻初始化决定。 */
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' ? url : undefined
  } catch {
    // Same single failure mode as above: not an absolute URL.
    return undefined
  }
}

/** Link/image reference targets collected from a document (first definition per identifier wins, as in CommonMark). */
/* 中文说明：类型或类 ReferenceTargets 约束基础组件的数据或职责。 */
export interface ReferenceTargets {
  /** Link/image definitions keyed by upper-cased identifier. */
  definitions: Map<string, Md.Definition>
  /** Footnote definitions keyed by upper-cased identifier. */
  footnotes: Map<string, Md.FootnoteDefinition>
}

/**
 * Create an empty {@link ReferenceTargets}.
 * @returns Fresh empty maps.
 */
/* 中文说明：函数 createReferenceTargets 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function createReferenceTargets(): ReferenceTargets {
  return { definitions: new Map(), footnotes: new Map() }
}

/**
 * Record every definition and footnote definition under `nodes` into
 * `targets`, depth-first, keeping the first definition per identifier.
 * @param nodes - Subtrees to walk (top-level blocks or any nested children).
 * @param targets - Accumulator, typically shared across incremental segments.
 */
/* 中文说明：函数 collectReferenceTargets 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function collectReferenceTargets(
  nodes: readonly Md.RootContent[],
  targets: ReferenceTargets,
): void {
  /** 中文说明：组件局部值 node，由紧邻初始化决定。 */
  for (const node of nodes) {
    if (node.type === 'definition') {
      /** 中文说明：组件局部值 id，由紧邻初始化决定。 */
      const id = node.identifier.toUpperCase()
      if (!targets.definitions.has(id)) targets.definitions.set(id, node)
    } else if (node.type === 'footnoteDefinition') {
      /** 中文说明：组件局部值 id，由紧邻初始化决定。 */
      const id = node.identifier.toUpperCase()
      if (!targets.footnotes.has(id)) targets.footnotes.set(id, node)
    }
    if ('children' in node) collectReferenceTargets(node.children, targets)
  }
}

/**
 * File-mention affordance for inline code: the owner resolves an authored
 * token to the file it names, using its own vocabulary of real files — the
 * renderer never guesses at what looks like a path.
 */
/* 中文说明：类型或类 MarkdownFileMentions 约束基础组件的数据或职责。 */
export interface MarkdownFileMentions {
  /**
   * Resolve one inline-code token.
   * @param value - The authored token, exactly as written.
   * @returns The opener with its accessible label and full-path title, or
   * undefined when the token names no known file — it then stays inert code.
   */
  resolve(value: string): { open: () => void; label: string; title: string } | undefined
}

/**
 * One render pass's state: immutable options and targets plus the footnote
 * numbering accumulated in document order while references render.
 */
/* 中文说明：类型或类 MarkdownRenderContext 约束基础组件的数据或职责。 */
export interface MarkdownRenderContext {
  /** Streaming arm: fences highlight incrementally as they grow; TeX (including ```math fences) stays literal until the settled pass. */
  readonly streaming: boolean
  /** Localized fence copy-button labels. */
  readonly labels: MarkdownLabels
  /** Inside a blockquote's children: tables there always fill the quote's width. */
  readonly inBlockquote?: boolean
  /** Inline-code file mentions; absent wherever no opener vocabulary exists. */
  readonly fileMentions: MarkdownFileMentions | undefined
  /** Inside an anchor's children: interactive mentions must not nest there. */
  readonly inLink?: boolean
  /** Reference targets visible to this pass. */
  readonly targets: ReferenceTargets
  /** Footnote identifiers in first-reference order; a footnote's number is its 1-based index here. */
  readonly footnoteOrder: string[]
  /** References rendered per identifier; drives the section's back-reference count. */
  readonly footnoteCounts: Map<string, number>
}

/**
 * Render top-level blocks. Nodes that render nothing (definitions, unmapped
 * types) are dropped rather than kept as null placeholders, matching the
 * replaced pipeline's child lists so separator newlines land identically.
 * @param blocks - Blocks with their stream-stable render keys.
 * @param context - The pass state; footnote numbering mutates in document order.
 * @returns One React node per rendered block.
 */
/* 中文说明：函数 renderBlocks 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function renderBlocks(
  blocks: readonly PositionedBlock[],
  context: MarkdownRenderContext,
): ReactNode[] {
  return blocks
    .map(block => renderNode(block.node, block.key, context))
    .filter(element => element !== null)
}

/**
 * Interleave the newline text nodes the replaced pipeline emitted between
 * block-level children. They are invisible between elements but coalesce
 * into adjacent literal raw-HTML text, where the DOM parity fixtures pin
 * them.
 * @param elements - Rendered block children with empty renders already dropped.
 * @param edges - Also emit the leading and trailing newline (hast's loose wrap).
 * @returns The interleaved children.
 */
/* 中文说明：函数 wrapBlockChildren 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function wrapBlockChildren(elements: readonly ReactNode[], edges: boolean): ReactNode[] {
  /** 中文说明：组件局部值 wrapped，由紧邻初始化决定。 */
  const wrapped: ReactNode[] = []
  /** 中文说明：组件局部值 element，由紧邻初始化决定。 */
  for (const element of elements) {
    if (edges || wrapped.length > 0) wrapped.push('\n')
    wrapped.push(element)
  }
  if (edges && elements.length > 0) wrapped.push('\n')
  return wrapped
}

/**
 * A block child rendered for a parent that must tell paragraphs apart from
 * other blocks (list items unwrap them when tight; footnote bodies receive
 * their back-references inside the trailing paragraph).
 */
/* 中文说明：类型或类 BlockEntry 约束基础组件的数据或职责。 */
type BlockEntry = { paragraph: ReactNode[] } | { element: ReactNode }

/** Render container children into {@link BlockEntry} values, dropping empty renders. */
/* 中文说明：函数 renderBlockEntries 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderBlockEntries(
  blocks: readonly Md.RootContent[],
  context: MarkdownRenderContext,
): BlockEntry[] {
  /** 中文说明：组件局部值 entries，由紧邻初始化决定。 */
  const entries: BlockEntry[] = []
  /** 中文说明：组件局部值 [index，由紧邻初始化决定。 */
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'paragraph') {
      entries.push({ paragraph: renderChildren(block.children, context) })
    } else {
      /** 中文说明：组件局部值 element，由紧邻初始化决定。 */
      const element = renderNode(block, index, context)
      if (element !== null) entries.push({ element })
    }
  }
  return entries
}

/** 中文说明：函数 renderChildren 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderChildren(
  nodes: readonly Md.RootContent[],
  context: MarkdownRenderContext,
): ReactNode[] {
  return nodes.map((node, index) => renderNode(node, index, context))
}

/** 中文说明：函数 renderNode 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderNode(node: Md.RootContent, key: Key, context: MarkdownRenderContext): ReactNode {
  switch (node.type) {
    case 'text':
      return node.value
    case 'paragraph':
      return <p key={key}>{renderChildren(node.children, context)}</p>
    case 'heading':
      return createElement(`h${node.depth}`, { key }, ...renderChildren(node.children, context))
    case 'blockquote':
      return (
        <blockquote key={key}>
          {wrapBlockChildren(
            renderChildren(node.children, { ...context, inBlockquote: true }).filter(child => child !== null),
            true,
          )}
        </blockquote>
      )
    case 'thematicBreak':
      return <hr key={key} />
    case 'break':
      // The replaced pipeline emitted a newline text node after each <br>.
      return <Fragment key={key}><br />{'\n'}</Fragment>
    case 'strong':
      return <strong key={key}>{renderChildren(node.children, context)}</strong>
    case 'emphasis':
      return <em key={key}>{renderChildren(node.children, context)}</em>
    case 'delete':
      return <del key={key}>{renderChildren(node.children, context)}</del>
    case 'inlineCode': {
      // Parity with mdast-util-to-hast: inline code renders line endings as spaces.
      /** 中文说明：组件局部值 value，由紧邻初始化决定。 */
      const value = node.value.replace(/\r?\n|\r/g, ' ')
      // An inline-code token that is entirely an absolute HTTP(S) URL keeps
      // its code chrome and gains the same safe external anchor as a link;
      // commands, partial URLs, and other schemes stay inert. The value is
      // authored text, not a parsed destination, so no normalizeUri: port,
      // path, and query render unchanged.
      /** 中文说明：组件局部值 href，由紧邻初始化决定。 */
      const href = inlineCodeHttpUrl(value)
      if (href !== undefined) return <code key={key}>{renderSafeLink(href, [value], 'link')}</code>
      // A token the owner's file-mention vocabulary recognizes opens that
      // file; the resolver, not this renderer, decides what names a file.
      // Inside an anchor the token stays inert — a button cannot nest there.
      /** 中文说明：组件局部值 mention，由紧邻初始化决定。 */
      const mention = context.inLink === true ? undefined : context.fileMentions?.resolve(value)
      if (mention !== undefined) {
        return (
          <code key={key}>
            <button
              type="button"
              className={css.fileMention}
              title={mention.title}
              aria-label={mention.label}
              onClick={mention.open}
            >
              <LinkIcon kind={classifyLinkPath(value)} className={css.linkIcon} />
              {value}
            </button>
          </code>
        )
      }
      return <code key={key}>{value}</code>
    }
    case 'html':
      // No HTML parser enters the pipeline: raw HTML stays literal text.
      return node.value
    case 'code':
      return renderCode(node, key, context)
    case 'math':
      return <Fragment key={key}>{renderTexToReact(node.value, true)}</Fragment>
    case 'inlineMath':
      return <Fragment key={key}>{renderTexToReact(node.value, false)}</Fragment>
    case 'list':
      return renderList(node, key, context)
    case 'listItem':
      // Reachable only in hand-built trees: the grammar emits items inside lists.
      return renderListItem(node, listItemLoose(node), key, context)
    case 'table':
      return renderTable(node, key, context)
    case 'link':
      return renderAnchor(node.url, renderChildren(node.children, { ...context, inLink: true }), key, !anchorWrapsOnlyImages(node.children))
    case 'linkReference':
      return renderLinkReference(node, key, context)
    case 'image':
      return renderImage(node.url, node.alt ?? '', key)
    case 'imageReference':
      return renderImageReference(node, key, context)
    case 'footnoteReference':
      return renderFootnoteReference(node, key, context)
    case 'definition':
    case 'footnoteDefinition':
      // Targets render elsewhere: definitions resolve references in place;
      // footnote bodies render in the trailing section.
      return null
    default:
      // Documented default for the merge-extensible union: node types without
      // a mapping (tableRow/tableCell outside a table, frontmatter, future
      // grammar contributions) render nothing.
      return null
  }
}

/** 中文说明：函数 renderCode 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderCode(node: Md.Code, key: Key, context: MarkdownRenderContext): ReactNode {
  /** 中文说明：组件局部值 language，由紧邻初始化决定。 */
  const language = node.lang ?? undefined
  if (node.value === '') {
    // Parity: the replaced pipeline kept the stock <pre> for an empty fence.
    return (
      <pre key={key}>
        <code className={language === undefined ? undefined : `language-${language}`} />
      </pre>
    )
  }
  // The replaced pipeline recovered the grammar id from the hast class with
  // /language-([\w-]+)/, which truncates at the first non-word character.
  /** 中文说明：组件局部值 lang，由紧邻初始化决定。 */
  const lang = language === undefined ? undefined : /^[\w-]+/.exec(language)?.[0]
  if (!context.streaming && lang === 'math') {
    // ```math fences render as display TeX once settled (rehype-katex parity);
    // its text extraction saw the code block's trailing newline.
    return <Fragment key={key}>{renderTexToReact(`${node.value}\n`, true)}</Fragment>
  }
  return (
    <CodeBlock
      key={key}
      // The replaced hast pipeline appended one synthetic newline that
      // CodeBlock's display trim removes; feeding the bare value would make
      // that trim eat a REAL trailing blank line inside the fence instead.
      code={`${node.value}\n`}
      lang={lang}
      // Streaming keys are source offsets, stable while the fence grows, so
      // the CodeBlock instance (and its incremental highlight session)
      // survives every chunk. A fence whose info string is still mid-chunk
      // has no content yet and took the empty-fence arm above, so `lang`
      // here is final: it can never re-resolve to a different grammar.
      streaming={context.streaming}
      copyLabel={context.labels.code.copyLabel}
      copiedLabel={context.labels.code.copiedLabel}
    />
  )
}

/** A list is loose when it or any of its items is spread; every item then keeps its paragraphs. */
/* 中文说明：函数 listLoose 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function listLoose(list: Md.List): boolean {
  return (list.spread ?? false) || list.children.some(listItemLoose)
}

/** 中文说明：函数 listItemLoose 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function listItemLoose(item: Md.ListItem): boolean {
  return item.spread ?? item.children.length > 1
}

/** 中文说明：函数 renderList 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderList(node: Md.List, key: Key, context: MarkdownRenderContext): ReactNode {
  /** 中文说明：组件局部值 loose，由紧邻初始化决定。 */
  const loose = listLoose(node)
  /** 中文说明：组件局部值 properties，由紧邻初始化决定。 */
  const properties: { start?: number; className?: string } = {}
  if (typeof node.start === 'number' && node.start !== 1) properties.start = node.start
  if (node.children.some(item => typeof item.checked === 'boolean')) {
    properties.className = 'contains-task-list'
  }
  return createElement(
    node.ordered === true ? 'ol' : 'ul',
    { key, ...properties },
    ...node.children.map((item, index) => renderListItem(item, loose, index, context)),
  )
}

/** 中文说明：函数 renderListItem 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderListItem(
  item: Md.ListItem,
  loose: boolean,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  /** 中文说明：组件局部值 entries，由紧邻初始化决定。 */
  const entries = renderBlockEntries(item.children, context)
  /** 中文说明：组件局部值 task，由紧邻初始化决定。 */
  const task = typeof item.checked === 'boolean'
  if (task) {
    /** 中文说明：组件局部值 checkbox，由紧邻初始化决定。 */
    const checkbox = <input key="task-checkbox" type="checkbox" checked={item.checked === true} disabled />
    /** 中文说明：组件局部值 head，由紧邻初始化决定。 */
    const head = entries[0]
    if (head !== undefined && 'paragraph' in head) {
      head.paragraph = head.paragraph.length > 0 ? [checkbox, ' ', ...head.paragraph] : [checkbox]
    } else {
      entries.unshift({ paragraph: [checkbox] })
    }
  }
  // Newline placement and tight-paragraph unwrapping mirror
  // mdast-util-to-hast's list-item handler: a newline before every child
  // except a tight leading paragraph, and after a trailing non-paragraph
  // (or any trailing child when loose).
  /** 中文说明：组件局部值 parts，由紧邻初始化决定。 */
  const parts: ReactNode[] = []
  /** 中文说明：组件局部值 [index，由紧邻初始化决定。 */
  for (const [index, entry] of entries.entries()) {
    /** 中文说明：组件局部值 isParagraph，由紧邻初始化决定。 */
    const isParagraph = 'paragraph' in entry
    if (loose || index !== 0 || !isParagraph) parts.push('\n')
    if (!isParagraph) parts.push(entry.element)
    else if (loose) parts.push(<p key={`p-${index}`}>{entry.paragraph}</p>)
    else parts.push(<Fragment key={`p-${index}`}>{entry.paragraph}</Fragment>)
  }
  /** 中文说明：组件局部值 tail，由紧邻初始化决定。 */
  const tail = entries[entries.length - 1]
  if (tail !== undefined && (loose || !('paragraph' in tail))) parts.push('\n')
  return (
    <li key={key} className={task ? 'task-list-item' : undefined}>
      {parts}
    </li>
  )
}

/** 中文说明：函数 renderTable 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderTable(node: Md.Table, key: Key, context: MarkdownRenderContext): ReactNode {
  /** 中文说明：组件局部值 align，由紧邻初始化决定。 */
  const align = node.align ?? null
  /** 中文说明：组件局部值 [headRow, ...bodyRows]，由紧邻初始化决定。 */
  const [headRow, ...bodyRows] = node.children
  /** 中文说明：组件局部值 columns，由紧邻初始化决定。 */
  const columns = align === null ? headRow?.children.length ?? 0 : align.length
  // Four or more columns read as a comparison matrix: the block keeps the
  // table at natural width and exposes the stable `md-table-wide` hook so a
  // hosting layout (the chat transcript) can widen it past the message
  // column. Narrower tables — and any table inside a blockquote — fill the
  // column and wrap instead (deepsuite chat TableWrapper parity).
  /** 中文说明：组件局部值 wide，由紧邻初始化决定。 */
  const wide = columns >= 4 && context.inBlockquote !== true
  return (
    // Wide tables rest with overflow-x hidden (the hover-revealed bar in
    // MarkdownText.module.css), which drops Chromium's implicit scroller
    // focusability — the explicit tabindex keeps them keyboard-reachable,
    // and :focus-visible restores scrolling.
    <div
      key={key}
      className={clsx(css.tableScroll, wide ? 'md-table-wide' : css.tableFill)}
      tabIndex={wide ? 0 : undefined}
    >
      <table>
        {headRow !== undefined && <thead>{renderTableRow(headRow, 'th', align, 0, context)}</thead>}
        {bodyRows.length > 0 && (
          <tbody>
            {bodyRows.map((row, index) => renderTableRow(row, 'td', align, index + 1, context))}
          </tbody>
        )}
      </table>
    </div>
  )
}

/** 中文说明：函数 renderTableRow 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderTableRow(
  row: Md.TableRow,
  cellTag: 'th' | 'td',
  align: readonly Md.AlignType[] | null,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  // With column alignment present, every row renders exactly one cell per
  // column, padding or truncating the row (mdast-util-to-hast parity).
  /** 中文说明：组件局部值 length，由紧邻初始化决定。 */
  const length = align === null ? row.children.length : align.length
  /** 中文说明：组件局部值 cells，由紧邻初始化决定。 */
  const cells: ReactNode[] = []
  /** 中文说明：组件局部值 index，由紧邻初始化决定。 */
  for (let index = 0; index < length; index++) {
    /** 中文说明：组件局部值 cell，由紧邻初始化决定。 */
    const cell = row.children[index]
    /** 中文说明：组件局部值 alignValue，由紧邻初始化决定。 */
    const alignValue = align?.[index]
    cells.push(createElement(
      cellTag,
      // hast-util-to-jsx-runtime's default tableCellAlignToStyle turned the
      // deprecated align attribute into an inline style; keep that DOM.
      { key: index, style: alignValue == null ? undefined : { textAlign: alignValue } },
      ...(cell === undefined ? [] : renderChildren(cell.children, context)),
    ))
  }
  return <tr key={key}>{cells}</tr>
}

/**
 * True when an anchor's markdown children are all images, so the anchor is a
 * clickable picture (badge, thumbnail): the leading URL glyph would dangle
 * beside the image instead of leading link text, so those anchors skip it.
 */
function anchorWrapsOnlyImages(children: Md.PhrasingContent[]): boolean {
  return children.length > 0 && children.every(child => child.type === 'image' || child.type === 'imageReference')
}

/** Anchor over an already-authored href: allowlisted or unwrapped, external links get the safe attributes. */
function renderSafeLink(href: string, children: ReactNode[], key: Key, glyph = true): ReactNode {
  const safeHref = sanitizeUrl(href)
  if (safeHref === '') return <Fragment key={key}>{children}</Fragment>
  /** 中文说明：组件局部值 external，由紧邻初始化决定。 */
  const external = ['http:', 'https:'].includes(new URL(safeHref).protocol)
  return (
    <a
      key={key}
      href={safeHref}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {glyph && <LinkIcon kind="url" className={css.linkIcon} />}
      {children}
    </a>
  )
}

/** Anchor over a parsed markdown destination, which hast normalized before the allowlist saw it. */
function renderAnchor(url: string, children: ReactNode[], key: Key, glyph = true): ReactNode {
  return renderSafeLink(normalizeUri(url), children, key, glyph)
}

/**
 * The complete inline-code value when it is exactly an absolute HTTP(S) URL
 * (no surrounding whitespace); anything else stays inert code.
 */
/* 中文说明：函数 inlineCodeHttpUrl 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function inlineCodeHttpUrl(value: string): string | undefined {
  if (value.trim() !== value) return undefined
  try {
    /** 中文说明：组件局部值 protocol，由紧邻初始化决定。 */
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:' ? value : undefined
  } catch {
    // Not an absolute URL at all — the only way new URL() rejects a string.
    return undefined
  }
}

/** 中文说明：函数 renderImage 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderImage(url: string, alt: string, key: Key): ReactNode {
  /** 中文说明：组件局部值 imageSrc，由紧邻初始化决定。 */
  const imageSrc = remoteImageUrl(sanitizeUrl(normalizeUri(url)))
  if (imageSrc === undefined) {
    return <span key={key} className={css.imageAlt}>{alt}</span>
  }
  return (
    <img
      key={key}
      className={css.image}
      src={imageSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  )
}

/** The bracketed source text a reference reverts to when its definition is missing. */
/* 中文说明：函数 referenceSuffix 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function referenceSuffix(node: Md.LinkReference | Md.ImageReference): string {
  if (node.referenceType === 'collapsed') return '][]'
  if (node.referenceType === 'full') return `][${node.label ?? node.identifier}]`
  return ']'
}

/** 中文说明：函数 renderLinkReference 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderLinkReference(
  node: Md.LinkReference,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  /** 中文说明：组件局部值 definition，由紧邻初始化决定。 */
  const definition = context.targets.definitions.get(node.identifier.toUpperCase())
  if (definition === undefined) {
    // The grammar only emits references whose definitions exist somewhere in
    // the same parse, but incremental segments and hand-built trees may still
    // present unresolved ones: revert to the bracketed source text — which is
    // not an anchor, so mentions inside it stay live.
    return <Fragment key={key}>{'['}{renderChildren(node.children, context)}{referenceSuffix(node)}</Fragment>
  }
  const rendered = renderChildren(node.children, { ...context, inLink: true })
  return renderAnchor(definition.url, rendered, key, !anchorWrapsOnlyImages(node.children))
}

/** 中文说明：函数 renderImageReference 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderImageReference(
  node: Md.ImageReference,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  /** 中文说明：组件局部值 definition，由紧邻初始化决定。 */
  const definition = context.targets.definitions.get(node.identifier.toUpperCase())
  if (definition === undefined) return `![${node.alt ?? ''}${referenceSuffix(node)}`
  return renderImage(definition.url, node.alt ?? '', key)
}

/** 中文说明：函数 renderFootnoteReference 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderFootnoteReference(
  node: Md.FootnoteReference,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  /** 中文说明：组件局部值 id，由紧邻初始化决定。 */
  const id = node.identifier.toUpperCase()
  /** 中文说明：组件局部值 seen，由紧邻初始化决定。 */
  const seen = context.footnoteCounts.get(id)
  if (seen === undefined) context.footnoteOrder.push(id)
  context.footnoteCounts.set(id, (seen ?? 0) + 1)
  // The in-page anchor fails the protocol allowlist, so only the numbered
  // superscript renders (matching the replaced pipeline's unwrapped link).
  return <sup key={key}>{String(context.footnoteOrder.indexOf(id) + 1)}</sup>
}

/**
 * Render the trailing footnote section for every footnote referenced during
 * the pass, in first-reference order, with one plain-text back-reference
 * marker per rendered reference.
 * @param context - The pass state after all blocks rendered.
 * @returns The section, or null when no referenced footnote has a definition.
 */
/* 中文说明：函数 renderFootnoteSection 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function renderFootnoteSection(context: MarkdownRenderContext): ReactNode | null {
  /** 中文说明：组件局部值 items，由紧邻初始化决定。 */
  const items: ReactNode[] = []
  /** 中文说明：组件局部值 id，由紧邻初始化决定。 */
  for (const id of context.footnoteOrder) {
    /** 中文说明：组件局部值 definition，由紧邻初始化决定。 */
    const definition = context.targets.footnotes.get(id)
    if (definition === undefined) continue
    /** 中文说明：组件局部值 count，由紧邻初始化决定。 */
    const count = context.footnoteCounts.get(id) ?? 0
    /** 中文说明：组件局部值 backrefs，由紧邻初始化决定。 */
    const backrefs: ReactNode[] = []
    /** 中文说明：组件局部值 reference，由紧邻初始化决定。 */
    for (let reference = 1; reference <= count; reference++) {
      if (backrefs.length > 0) backrefs.push(' ')
      backrefs.push('↩')
      if (reference > 1) backrefs.push(<sup key={`re-${reference}`}>{String(reference)}</sup>)
    }
    /** 中文说明：组件局部值 entries，由紧邻初始化决定。 */
    const entries = renderBlockEntries(definition.children, context)
    /** 中文说明：组件局部值 tail，由紧邻初始化决定。 */
    const tail = entries[entries.length - 1]
    /** 中文说明：组件局部值 body，由紧邻初始化决定。 */
    const body: ReactNode[] = entries.map((entry, index) => (
      'paragraph' in entry
        ? (
          <p key={`p-${index}`}>
            {entry.paragraph}
            {entry === tail && <>{' '}{backrefs}</>}
          </p>
        )
        : entry.element
    ))
    // Without a trailing paragraph the back-references join the block list
    // itself (and pick up the wrap newlines), as in the replaced pipeline.
    if (tail === undefined || !('paragraph' in tail)) body.push(...backrefs)
    items.push(
      <li key={id} id={`user-content-fn-${normalizeUri(id.toLowerCase())}`}>
        {wrapBlockChildren(body, true)}
      </li>,
    )
  }
  if (items.length === 0) return null
  return (
    <section key="footnotes" data-footnotes className="footnotes">
      <h2 id="footnote-label" className="sr-only">{context.labels.footnotes}</h2>
      <ol>{items}</ol>
    </section>
  )
}
