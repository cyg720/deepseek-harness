/**
 * ================================ 文件注释 ================================
 * 【文件职责】面向模型可见的引用封套（envelope）的标签安全 JSON 序列化：
 *             保证序列化结果中不出现能拼成 XML 开标签的 `<` 字符。
 * 【技术维度】JSON.stringify + 全局替换 `<` 为 \u003c（合法的 JSON 转义，
 *             解析结果与原值完全一致，但纯文本里拼不出 <tag> 这种 XML 结构）。
 * 【产品维度】被引用的会话内容是"不可信快照"，模型可能在其中夹带
 *             <system> 之类的 XML 指令；本函数把它降级为纯数据。
 * 【逻辑维度】序列化 → 类型守卫（非字符串说明不可序列化）→ 替换 `<`。
 * 【关键边界】只针对 `<`；`\u003c` 在 JSON.parse 后仍还原为 `<`，所以
 *             解析语义零损失，只有字面文本层面的标签注入被拦截。
 * 【新手阅读建议】与 uri.ts 里的规范校验对照：一个防编码混用，一个防标签注入。
 * ==========================================================================
 */

/** Tag-safe JSON serialization for the model-visible reference envelope. */

/**
 * Serialize JSON while preventing source data from spelling an XML-like opening tag.
 * @param value - JSON-compatible reference data.
 * @returns JSON whose parse result is unchanged and whose data contains no literal `<`.
 */
/**
 * 序列化 JSON，同时防止来源数据拼出类似 XML 的开标签。
 * 具体做法：把每个 `<` 替换为转义序列 \u003c，JSON 解析结果不变，
 * 但渲染后的纯文本中不可能出现 <tag> 结构。
 * @param value 待序列化的 JSON 兼容引用数据
 * @returns 解析结果不变、且不含字面 < 字符的 JSON 文本
 */
export function stringifyTagSafeJson(value: unknown): string {
  const serialized: unknown = JSON.stringify(value)
  if (typeof serialized !== 'string') throw new TypeError('session-reference data is not JSON-serializable')
  return serialized.replaceAll('<', '\\u003c')
}
