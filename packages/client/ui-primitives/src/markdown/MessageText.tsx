// MessageText is the literal-text primitive for user and steering content; assistant output uses MarkdownText.
/**
 * 文件职责：渲染用户消息和转向消息中的原样文本，助手输出改用 MarkdownText。
 * 技术维度：使用 React 函数组件与 CSS Modules，不进行 Markdown 解析。
 * 产品维度：确保用户输入按字面显示，避免把普通字符误当成富文本语法。
 * 逻辑维度：读取 `text` 属性，并放入带局部样式的单个 `div`。
 * 关键边界：组件不清洗或解析文本；上游负责提供可显示字符串。
 * 新手阅读建议：先比较 MessageText 与 MarkdownText，再看样式如何保留文本排版。
 */

import css from './MessageText.module.css'

/**
 * 渲染一段原样消息文本。
 * @param text 要显示的完整字符串，可为空，不会按 Markdown 解释。
 * @returns 包含文本和 `text` 局部类名的 React `div`。
 * @example `<MessageText text="用户输入" />`
 */
export function MessageText({ text }: { text: string }) {
  return <div className={css.text}>{text}</div>
}
