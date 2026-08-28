/**
 * Virtual root of the worker host's in-memory filesystem. Kept
 * in one module so the process shim, the path/os shims, and the VFS image
 * collector cannot drift apart.
 */

/** Virtual filesystem root; `process.cwd()` and every absolute path start here.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 paths 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：DSH_ROOT 用于处理 DSH_ROOT 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const DSH_ROOT = '/dsh'

/** `$DSH_HOME`: durable-state directory inside the image.
 * @remarks 中文说明：常量说明：DSH_HOME 用于处理 DSH_HOME 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const DSH_HOME = `${DSH_ROOT}/home`

/** Flat, symlink-free package tree resolved by the worker module loader.
 * @remarks 中文说明：常量说明：DSH_NODE_MODULES 用于处理 DSH_NODE_MODULES 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const DSH_NODE_MODULES = `${DSH_ROOT}/node_modules`

/** Directory holding the composed cordis.yml and the agent-preset tree.
 * @remarks 中文说明：常量说明：DSH_CONFIG 用于处理 DSH_CONFIG 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const DSH_CONFIG = `${DSH_ROOT}/config`

/** Default (empty) workspace directory.
 * @remarks 中文说明：常量说明：DSH_WORKSPACE 用于处理 DSH_WORKSPACE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const DSH_WORKSPACE = `${DSH_ROOT}/workspace`

/** Temporary directory reported by `os.tmpdir()`.
 * @remarks 中文说明：常量说明：DSH_TMP 用于处理 DSH_TMP 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const DSH_TMP = `${DSH_ROOT}/tmp`
