/**
 * `node:fs/promises` face: the promise members of the VFS bridge, re-exported as
 * named bindings so `import { readFile } from 'node:fs/promises'` resolves. The
 * member set is checked against Node where it is built, on `promises` in
 * `../fs.ts`.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 promises 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { Dirent, promises } from '../fs.ts'

/** The promise members of the VFS bridge, as `node:fs/promises` names them.
 * @remarks 中文说明：常量说明：readFile、writeFile、appendFile、mkdir、mkdtemp、readdir、s
 * tat、lstat、realpath、rm、unlink、rename、access、chmod、cp、link、open、opendir、tr
 * uncate、watch、constants 用于读取 File、write File、append
 * File、mkdir、mkdtemp、readdir、stat、lstat、realpath、rm、unlink、rename、access、c
 * hmod、cp、link、open、opendir、truncate、watch、constants 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const {
  readFile, writeFile, appendFile, mkdir, mkdtemp, readdir, stat, lstat, realpath, rm, unlink,
  rename, access, chmod, cp, link, open, opendir, truncate, watch, constants,
} = promises

export { Dirent }

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

export default promises
