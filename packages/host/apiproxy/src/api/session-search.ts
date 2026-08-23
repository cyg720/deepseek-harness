/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话搜索的产品边界常量与截断工具：限制单次搜索结果数量、摘要
 * 长度，并提供按 Unicode 码点安全截断文本的函数。
 * 【技术维度】纯函数/常量模块，零依赖；截断按码点（for...of 迭代）而非 UTF-16
 * 代码单元，避免把代理对（emoji 等）切成孤代理位而损坏文本。
 * 【产品维度】搜索面板的结果数量与摘要长度都有上限，保证界面可用性与性能；
 * 侧边栏一次最多 20 条、摘要最长 240 个码点。
 * 【逻辑维度】两个上限常量 → truncateUnicodeCodePoints（足够短则原样返回，
 * 否则返回不超过上限的码点安全前缀）。
 * 【关键边界】maximum 必须非负（调用方保证）；返回值不保证恰好 maximum 个
 * 码点——遇到代理对时会在码点边界处截断。
 * 【新手阅读建议】只需理解两个常量何时被引用（api-proxy.ts 的 session.search）
 * 与截断函数的码点安全逻辑即可。
 * ==========================================================================
 */
/** Maximum number of sessions returned by one sidebar search. */
// 侧边栏单次搜索返回的最大会话数：结果列表的产品边界。
export const SESSION_SEARCH_RESULT_LIMIT = 20

/** Maximum snippet length in Unicode code points. */
// 搜索摘要的最大长度（按 Unicode 码点计）：超出部分被截断。
export const SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = 240

/**
 * Return the longest prefix containing at most `maximum` Unicode code points.
 * @param value - text to bound.
 * @param maximum - non-negative code-point limit.
 * @returns `value` unchanged when it fits, otherwise a code-point-safe prefix.
 */
// 返回不超过 maximum 个 Unicode 码点的最长前缀：文本本身足够短时原样返回，
// 否则在码点边界（不会切断 emoji 等代理对）处截断。
export function truncateUnicodeCodePoints(value: string, maximum: number): string {
  let count = 0
  let end = 0
  for (const codePoint of value) {
    if (count === maximum) return value.slice(0, end)
    count++
    end += codePoint.length
  }
  return value
}
