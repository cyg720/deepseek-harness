/**
 * Browser stand-in for `node:module`. `createRequire` is unreachable in the
 * configured loader path and fails loud if that assumption changes.
 */
/*
 * 文件职责：为浏览器构建提供 `node:module` 的显式失败替身。
 * 技术维度：用永不返回的函数和 `never` 类型满足 vendored Loader 的静态引用。
 * 产品维度：避免 Node 专用模块混入 Web，同时在错误路径被触及时给出清晰诊断。
 * 逻辑维度：运行时 createRequire 直接抛错，类型专用 LoadHookContext 被擦除。
 * 关键边界：正常浏览器启动绝不能调用 createRequire；触发即说明加载路径回归。
 * 新手阅读建议：先区分值导入与类型导入，再查看构建配置如何把 node:module 指向这里。
 */

/** Fail if browser boot reaches Node's module loader. */
export const createRequire = (): never => {
  throw new Error('node:module is not available in the browser')
}

/** Type-only peer for the vendored loader. */
export type LoadHookContext = never
