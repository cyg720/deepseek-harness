// ConnectionBanner: top strip surfacing connection loss. The atom is pure:
// the owner subscribes to connection state and passes `reconnecting` down.
// A null/connecting state upstream should stay quiet too — only an actual
// outage (reconnect backoff in progress) shows the strip.
// 文件职责：提供连接中断重试时显示的纯展示顶部横幅原子组件。
// 技术维度：使用 React 条件渲染、TypeScript 内联属性类型和 CSS Modules。
// 产品维度：连接实际断开并退避重连时及时告知用户，同时避免正常连接阶段产生干扰。
// 逻辑维度：reconnecting 为 false 时返回 null；为 true 时用传入或默认文案渲染横幅。
// 关键边界：组件不订阅连接状态，也不执行重连；本地化文案应由拥有状态的上层传入。
// 新手阅读建议：先看早返回条件，再理解默认 label 只在调用方未提供值时生效。

import css from './ConnectionBanner.module.css'

/**
 * Render the reconnecting banner.
 * @param props.reconnecting - true while the connection is in backoff/retry.
 * @param props.label - banner text; the owner passes localized copy (this
 * package is cordis-free, so copy arrives via props).
 * @returns the banner, or null when connected.
 */
/*
 * 在连接退避重试期间渲染提示横幅。
 * @param props - reconnecting 表示是否正在重连；label 是可选本地化提示文本。
 * @returns 重连时返回横幅元素，连接正常时返回 null。
 * @example <ConnectionBanner reconnecting label="正在重新连接" />
 */
export function ConnectionBanner({ reconnecting, label = '连接已断开，正在重连…' }: {
  // reconnecting：仅在实际断线后的退避或重试阶段为 true。
  reconnecting: boolean
  // label：横幅显示文本；undefined 时使用组件内置中文默认值。
  label?: string | undefined
}) {
  if (!reconnecting) return null
  return <div className={css.banner}>{label}</div>
}
