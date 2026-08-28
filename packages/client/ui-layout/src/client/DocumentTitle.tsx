/**
 * 文件职责：把当前会话持久标题投影到浏览器标签页，并在卸载时恢复产品标题。
 * 技术维度：使用 React useEffect、环境变量和无界面函数组件同步 document.title。
 * 产品维度：让用户在多个浏览器标签中识别当前会话，同时保留构建选择的产品名称。
 * 逻辑维度：解析产品标题，副作用根据可选会话标题写入文档标题，清理函数恢复产品标题。
 * 关键边界：仅能在浏览器文档环境运行；环境变量为空字符串时仍会覆盖默认标题。
 * 新手阅读建议：先看 productTitle 的回退规则，再看 effect 写入与清理如何成对出现。
 */
import { useEffect } from 'react'

/** Props for the browser title projection. */
/* 浏览器标题投影属性，只包含当前选中会话的可选持久标题。 */
export interface DocumentTitleProps {
  /** Durable title of the selected session, or undefined for the product title. */
  /* 当前会话持久标题；undefined 时仅显示产品标题。 */
  title?: string
  /** Build-configured or localized product title. */
  productTitle: string
}

/**
 * Project the selected durable session title into the browser title and
 * restore the build-selected product title when unmounted.
 * @param props - Selected session title projection.
 * @returns No rendered content.
 */
export function DocumentTitle({ title, productTitle }: DocumentTitleProps): null {
  useEffect(() => {
    document.title = title === undefined ? productTitle : `${title} — ${productTitle}`
    // 清理函数：卸载或依赖变化前恢复纯产品标题，避免旧会话标题残留。
    return () => { document.title = productTitle }
  }, [productTitle, title])
  return null
}
