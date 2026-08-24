/**
 * Browser stand-in for `node:module`. `createRequire` is unreachable in the
 * configured loader path and fails loud if that assumption changes.
 */
/**
 * 文件职责：为浏览器构建提供 `node:module` 的显式失败替身。
 * 技术维度：用永不返回的函数和 `never` 类型满足 vendored Loader 的静态引用。
 * 产品维度：避免 Node 专用模块混入 Web，同时在错误路径被触及时给出清晰诊断。
 * 逻辑维度：运行时 createRequire 直接抛错，类型专用 LoadHookContext 被擦除。
 * 关键边界：正常浏览器启动绝不能调用 createRequire；触发即说明加载路径回归。
 * 新手阅读建议：先区分值导入与类型导入，再查看构建配置如何把 node:module 指向这里。
 */

/** Throwing stand-in for node:module's createRequire (never reached in the browser boot). */
/**
 * 浏览器中的 createRequire 替身；无参数且始终抛错。
 * @returns 永不返回，返回类型为 never。
 * @example 任何 `createRequire()` 调用都会抛出“node:module 不可用于浏览器”。
 */
export const createRequire = (): never => {
  throw new Error('node:module is not available in the browser')
}

/** Erased type peer for the vendored loader's type-only LoadHookContext import. */
/** 仅供类型检查的空类型；编译后被擦除，不能构造或在运行时读取。 */
export type LoadHookContext = never
