/**
 * Names of external npm packages the worker replaces wholesale. Kept in a module
 * with no imports so both consumers can read it: the runtime builtin table
 * (`./builtins.ts`) and the build-time VFS image collector, which must leave
 * these packages out of the image entirely — the loader answers them from the
 * bundle before it ever reaches `node_modules`.
 */

/** External packages served from the worker bundle instead of the VFS.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 replaced
 * externals 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM
 * 模块、严格类型约束与 Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness
 * 的 experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：REPLACED_EXTERNAL_PACKAGES 用于处理
 * REPLACED_EXTERNAL_PACKAGES 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const REPLACED_EXTERNAL_PACKAGES: readonly string[] = [
  '@earendil-works/pi-ai',
  '@vscode/ripgrep',
  'koffi',
  'node-pty',
  'sharp',
  'ws',
]
