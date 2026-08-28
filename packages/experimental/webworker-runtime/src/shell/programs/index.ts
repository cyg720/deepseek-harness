/**
 * The command table: every program name this shell can run. A browser worker
 * spawns no processes, so this table IS the machine's `/bin` — a name that is
 * not here reports `command not found`, exactly as a real shell would for a
 * binary that is not installed.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/programs
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 index 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import type { ShellProgram } from '../types.ts'
import { BUILTIN_PROGRAMS } from './builtins.ts'
import { FILE_PROGRAMS } from './files.ts'
import { TEXT_PROGRAMS } from './text.ts'

/**
 * 变量说明：table 用于处理 table 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let table: Map<string, ShellProgram> | undefined

/**
 * The standard command table, built once and shared by every command line.
 * @returns the program table, keyed by command name.
 * @remarks 中文说明：功能说明：处理 standardPrograms 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：ReadonlyMap<string, ShellProgram>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 standardPrograms()，并按返回类型处理结果。
 */
export function standardPrograms(): ReadonlyMap<string, ShellProgram> {
  table ??= new Map<string, ShellProgram>([
    ...Object.entries(BUILTIN_PROGRAMS),
    ...Object.entries(FILE_PROGRAMS),
    ...Object.entries(TEXT_PROGRAMS),
    ['which', which],
  ])
  return table
}

/** Reports which of the requested names this shell can run.
 * @remarks 中文说明：常量说明：which 用于处理 which 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 which 相关流程；使用场景由所在模块及调用位置决定。；参数说明：argv（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：io（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 which(argv, io)，
 * 并按返回类型处理结果。 */
const which: ShellProgram = (argv, io) => {
  /**
   * 常量说明：known 用于处理 known 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const known = standardPrograms()
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  /**
   * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const name of argv.slice(1)) {
    // Every program is built into the shell, so a known name reports itself
    // instead of a path that would not exist in the VFS.
    if (known.has(name)) {
      io.out(`${name}: shell built-in command\n`)
      continue
    }
    io.err(`which: no ${name} in the worker host command table\n`)
    status = 1
  }
  return status
}
