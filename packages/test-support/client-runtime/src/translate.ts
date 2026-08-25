/**
 * Test double of the locale lookup chain: a translate stub over plain
 * dictionaries, mirroring LocaleRuntime's resolution order (first dictionary
 * that owns the key wins, then the key itself stays visible) and its
 * `{name}` template interpolation. Specs stub the framework-injected `t`
 * seat with `makeTranslate(zh, commonZh)` instead of re-implementing the
 * chain per suite.
 */
/*
 * 文件职责：提供客户端测试使用的轻量翻译函数替身。
 * 技术维度：使用普通字典、按序查找和正则替换模拟 LocaleRuntime 的键解析与模板插值。
 * 产品维度：让界面测试使用接近真实本地化行为的文案，而不必启动完整客户端运行时。
 * 逻辑维度：按字典顺序寻找首个键值，未命中保留键名，再用 params 替换 {name} 占位符。
 * 关键边界：只支持单词字符占位符；缺失参数保留原占位符，字典顺序决定覆盖优先级。
 * 新手阅读建议：先看 dicts 的优先顺序，再跟踪 template、hit 和 replace 回调的变化。
 */

/**
 * Build a translate stub resolving through `dicts` in order (namespace
 * first, then the shared common vocabulary), falling back to the key.
 * @param dicts - dictionaries consulted in order.
 * @returns the translate function (assignable to any `XxxProps['t']` seat).
 */
/*
 * 构造按序查字典的翻译替身。
 * @param dicts 依次查询的只读字典，前面的字典优先。
 * @returns 接收键和可选参数的翻译函数。
 * @example makeTranslate({ hello: '你好，{name}' })('hello', { name: '小明' })。
 */
export function makeTranslate(
  ...dicts: readonly Record<string, string>[]
): (key: string, params?: Record<string, unknown>) => string {
  // 返回的翻译函数；key 是文案键，params 是可选模板参数，最终返回可显示字符串。
  return (key, params) => {
    // 当前模板；未命中任何字典时保持原始键，便于测试发现缺失翻译。
    let template = key
    // 当前候选字典；按调用 makeTranslate 时给出的顺序访问。
    for (const dict of dicts) {
      // 当前字典中的键值；undefined 表示该字典不提供此翻译。
      const hit = dict[key]
      if (hit !== undefined) {
        template = hit
        break
      }
    }
    if (!params) return template
    // 正则回调参数 match 是完整占位符，name 是花括号内名称；存在参数时转成字符串，否则保留 match。
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}
