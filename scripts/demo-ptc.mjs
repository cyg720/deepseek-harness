/** Run one headless task through the shipped PTC mode composition. Requires a model credential.
 * @remarks 文件说明：文件职责：实现 仓库维护脚本 中 demo ptc 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 仓库维护脚本 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import { spawn } from 'node:child_process'

/**
 * 常量说明：task 用于处理 task 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const task = process.argv.slice(2).join(' ').trim()
  || 'Inspect this repository with PTC mode and report its top-level architecture.'

/**
 * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const child = spawn(process.execPath, [
  '--import',
  'tsx/esm',
  'apps/cli/src/bin.ts',
  '--profile',
  'headless',
  task,
], {
  stdio: 'inherit',
  env: { ...process.env, DSH_TOOLS_MODE: 'ptc' },
})
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code, signal)，并按返回类型处理结果。
 */
child.on('exit', (code, signal) => { process.exit(signal !== null ? 1 : code ?? 1) })
