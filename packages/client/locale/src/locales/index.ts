/**
 * ================================ 文件注释 ================================
 * 【文件职责】common 命名空间的字典对出口：聚合 zh/en 字典与键联合类型。
 * 【技术维度】纯 re-export 桶；zh 是键集的事实源（中文优先仓库约定），
 *   en 对照它检查完整性——缺失或多余 en 键是编译错误。
 * 【产品维度】跨功能共享词汇（common 命名空间）供查找链在条目自身命名
 *   空间未命中后咨询。
 * 【逻辑维度】三个导出：zh/en 字典 + CommonKey 键类型。
 * 【关键边界】键集以 zh 为权威；en 用 satisfies 钉住键集。
 * 【新手阅读建议】对照 zh.ts 的 satisfies 契约理解。
 * ==========================================================================
 */
/**
 * The common-namespace dictionary pair. zh is the source of truth for the
 * key set (Chinese-first repo convention); en is checked complete against it
 * — a missing or extra en key is a compile error.
 */
/**
 * common 命名空间的字典对。zh 是键集的事实源（中文优先仓库约定）；en
 * 对照它检查完整性——缺失或多余 en 键是编译错误。
 */
export { zh } from './zh.ts'
export { en } from './en.ts'
export type { CommonKey } from './zh.ts'
