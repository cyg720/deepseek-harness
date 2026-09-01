/*
 * 文件职责：提供跨包标识使用的纯类型品牌工具 Branded。
 * 技术维度：使用 unique symbol 与交叉类型实现零运行时开销的 TypeScript 名义类型。
 * 产品维度：防止会话、调用、任务等外观相同的字符串标识在二次开发中被意外混用。
 * 逻辑维度：声明模块私有品牌键，再导出把字符串和只读品牌字段结合的泛型类型。
 * 关键边界：品牌只在编译期存在，不能替代外部输入验证；具体标识由拥有它的包定义工厂。
 * 新手阅读建议：先理解普通字符串为何可互换，再看 BRAND 如何让不同泛型参数互不兼容。
 */

/**
 * Duplicate-install-safe nominal string helpers.
 *
 * A brand makes structurally-identical strings non-interchangeable at the type
 * level: a `SessionId` cannot be passed where a `ToolCallId` is expected, even
 * though both are plain strings at runtime. Comparison, logging, and
 * serialization all behave as ordinary strings.
 *
 * This package owns no concrete id and keeps no runtime identity or mutable
 * state, so independently installed copies produce interchangeable values.
 *
 * @module @deepseek-ai/dsh-brand
 */

declare const BRAND: unique symbol

/** A string carrying a compile-time-only brand `B`. */
export type Branded<B extends string> = string & { readonly [BRAND]: B }

/**
 * Apply a compile-time string brand without changing the value.
 * @param value - string admitted by the domain that owns the target brand.
 * @returns the same string with the requested compile-time brand.
 */
export function brandString<T extends Branded<string>>(value: string | T): T {
  return value as T
}
