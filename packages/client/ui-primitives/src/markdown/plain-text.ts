/*
 * ================================ 文件注释 ================================
 * 【文件职责】提供 markdown 到纯文本的"投影"函数 extractMarkdownPlainText：去掉展示性
 *             标记，生成紧凑摘要/标签用的纯文本。解析复用渲染器的流式 GFM 语法 parseGfm，
 *             保证"投影剥掉的正是渲染器会画出来的东西"。
 * 【技术维度】mdast 节点树手工遍历（inlineText / blockText 两个递归 switch），非正则解析；
 *             支持 all / first-line / first-paragraph 三种抽取边界。
 * 【产品维度】消息列表的摘要、复制纯文本、无障碍标签等场景需要不带 Markdown 符号的可读
 *             文本；原始 HTML 保持字面、链接保留标签文字、图片保留 alt、代码保留源码。
 * 【逻辑维度】1) 模式与选项类型；2) 轻量节点接口 MarkdownNode；3) inlineText 行内节点
 *             投影；4) blockText 块级节点投影；5) findFirstParagraph 找首个非空段落；
 *             6) fullText 整体规整；7) 导出函数按模式分发。
 * 【关键边界】tableRow 以制表符连接单元格、段落间以空行分隔；连续空行折叠为最多一个
 *             空行；未知节点类型回退为"压缩空白的行内文本"。
 * 【新手阅读建议】从 extractMarkdownPlainText 入口看三种 mode 的分发，再看 blockText 的
 *             每个 case 如何处理一种块。
 * ==========================================================================
 */
/**
 * Markdown-to-plain-text projection for compact summaries and labels.
 * Parsing shares the renderer's streaming GFM grammar ({@link parseGfm}), so
 * the projection strips exactly the markup the renderer would draw; raw HTML
 * stays literal, links keep their labels, images keep alt text, and code
 * keeps its source text.
 */

import { parseGfm } from './parse.ts'

/** Amount of parsed Markdown content returned by the extractor. */
// 抽取边界：all 返回整个文档，first-line 只返回首个非空行，first-paragraph 返回首个段落。
export type MarkdownPlainTextMode = 'all' | 'first-line' | 'first-paragraph'

/** Options for {@link extractMarkdownPlainText}. */
/*
 * extractMarkdownPlainText 的选项；当前只有 mode 一个字段。
 */
export interface MarkdownPlainTextOptions {
  /** Projection boundary; defaults to the complete document. */
  // 投影边界；缺省为完整文档（all）。
  mode?: MarkdownPlainTextMode
}

// 投影只关心的一小撮节点字段：类型、文本、alt 与子节点；结构与 mdast 兼容。
interface MarkdownNode {
  type: string
  value?: string
  alt?: string
  children?: MarkdownNode[]
}

/** 行内节点的纯文本投影：文本/代码取 value，图片取 alt，换行符转 \n，其余递归拼接子节点。 */
function inlineText(node: MarkdownNode): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'code':
      return node.value ?? ''
    case 'image':
    case 'imageReference':
      return node.alt ?? ''
    case 'break':
      return '\n'
    case 'html':
      return node.value ?? ''
    default:
      return node.children?.map(inlineText).join('') ?? ''
  }
}

/** 把一段行内文本里的连续空白压缩成单个空格并去掉首尾空白，用于段落/标题等紧凑场景。 */
function compactInline(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 块级节点的纯文本投影：按块类型决定行内/换行/连接规则。 */
function blockText(node: MarkdownNode): string {
  switch (node.type) {
    case 'root':
    case 'blockquote':
      return node.children?.map(blockText).filter(Boolean).join('\n\n') ?? ''
    case 'paragraph':
    case 'heading':
      return compactInline(inlineText(node))
    case 'code':
      return node.value?.trim() ?? ''
    case 'list':
      return node.children?.map(blockText).filter(Boolean).join('\n') ?? ''
    case 'listItem':
      return node.children?.map(blockText).filter(Boolean).join(' ') ?? ''
    case 'table':
      return node.children?.map(blockText).filter(Boolean).join('\n') ?? ''
    case 'tableRow':
      // 表格行内用制表符分隔单元格，便于后续按列对齐或再拆分。
      return node.children?.map(blockText).join('\t') ?? ''
    case 'tableCell':
      return compactInline(inlineText(node))
    case 'html':
      return node.value ?? ''
    case 'thematicBreak':
    case 'definition':
      // 分隔线与链接定义不产生可见文本。
      return ''
    default:
      return compactInline(inlineText(node))
  }
}

/** 深度优先找到首个非空段落文本；找不到返回 undefined（调用方再退回首个非空行）。 */
function findFirstParagraph(node: MarkdownNode): string | undefined {
  if (node.type === 'paragraph') {
    const text = compactInline(inlineText(node))
    if (text !== '') return text
  }
  for (const child of node.children ?? []) {
    const text = findFirstParagraph(child)
    if (text !== undefined) return text
  }
  return undefined
}

/** 整体规整：逐行去首尾空白，并把 3 个以上连续换行折叠成空行（段落分隔）。 */
function fullText(root: MarkdownNode): string {
  return blockText(root)
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Parse GFM Markdown, remove its presentation markup, and preserve raw HTML literally.
 * @param markdown - Markdown source.
 * @param options - Optional extraction boundary.
 * @returns Plain text for the whole document, first visible line, or first semantic paragraph.
 */
/*
 * 解析 GFM Markdown 并去掉展示性标记，原始 HTML 保持字面。
 * 使用示例：extractMarkdownPlainText(md, { mode: 'first-paragraph' }) 取消息摘要。
 * @param markdown - Markdown 源码。
 * @param options - 可选的抽取边界（mode）。
 * @returns 整个文档、首个可见行或首个语义段落的纯文本。
 */
export function extractMarkdownPlainText(
  markdown: string,
  options: MarkdownPlainTextOptions = {},
): string {
  const { mode = 'all' } = options
  const root = parseGfm(markdown) as MarkdownNode
  const all = fullText(root)
  switch (mode) {
    case 'all':
      return all
    case 'first-line':
      return all.split('\n').find(line => line !== '') ?? ''
    case 'first-paragraph':
      // 优先语义段落；找不到（如纯图片/代码块开头）时退回首个非空行。
      return findFirstParagraph(root) ?? all.split('\n').find(line => line !== '') ?? ''
  }
}
