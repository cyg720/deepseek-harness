/**
 * The `Branded<B>` nominal-typing primitive — a type-only utility (no runtime
 * code, no harness-package dependency) shared by every package that owns a
 * cross-boundary id.
 *
 * A brand makes structurally-identical strings non-interchangeable at the type
 * level: a `SessionId` cannot be passed where a `ToolCallId` is expected, even
 * though both are plain strings at runtime. Construction goes through a per-id
 * factory in the OWNING package (a plain cast inside — zero runtime cost);
 * comparison, logging, and serialization all behave as ordinary strings.
 *
 * Policy: a package brands the ids it owns — `ToolCallId` in dsh-llm (tool-call
 * correlation), the shared agent/session `SessionId` in dsh-session, and
 * `JobId` in dsh-jobs. Branding is for ids that cross package boundaries and
 * could plausibly be confused; not every string needs a brand.
 * This package owns ONLY the primitive — no concrete id, no runtime code beyond
 * the (erased) type — so the brand vocabulary stays dependency-free and a
 * package can brand its ids without depending on an unrelated capability
 * package.
 *
 * @module @deepseek-ai/dsh-brand
 */
/*
 * 文件职责：提供跨包标识使用的纯类型品牌工具 Branded。
 * 技术维度：使用 unique symbol 与交叉类型实现零运行时开销的 TypeScript 名义类型。
 * 产品维度：防止会话、调用、任务等外观相同的字符串标识在二次开发中被意外混用。
 * 逻辑维度：声明模块私有品牌键，再导出把字符串和只读品牌字段结合的泛型类型。
 * 关键边界：品牌只在编译期存在，不能替代外部输入验证；具体标识由拥有它的包定义工厂。
 * 新手阅读建议：先理解普通字符串为何可互换，再看 BRAND 如何让不同泛型参数互不兼容。
 */

// 模块私有的唯一符号类型键；只参与类型检查，不会生成可用的运行时标识。
declare const BRAND: unique symbol

/** A string carrying a compile-time-only brand `B`. */
/* 带编译期品牌 B 的字符串；B 应是拥有该标识的稳定名称。 */
export type Branded<B extends string> = string & { readonly [BRAND]: B }
