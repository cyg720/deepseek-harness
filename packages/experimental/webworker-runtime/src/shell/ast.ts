/**
 * The parsed command line, as this shell names it.
 *
 * `@yarnpkg/parsers` re-exports only part of its grammar's type map from the
 * package root, and its `exports` field forbids reaching the grammar module
 * directly, so the three missing members are derived from the ones it does
 * publish. `CommandChain` is `Command` plus an optional pipeline link, which
 * makes it usable wherever a command node is expected.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/ast
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 ast 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import type { Argument, CommandChain } from '@yarnpkg/parsers'

export type { ArgumentSegment, ArithmeticExpression, CommandChain, CommandLine, ShellLine } from '@yarnpkg/parsers'

/** One command node: a program call, a subshell, a group, or bare assignments. */
export type Command = CommandChain

/** An argument that becomes argv fields. */
export type ValueArgument = Extract<Argument, { type: 'argument' }>

/** An argument that rewires a descriptor instead of becoming argv. */
export type RedirectArgument = Extract<Argument, { type: 'redirection' }>
