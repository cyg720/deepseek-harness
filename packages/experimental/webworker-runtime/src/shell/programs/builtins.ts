/**
 * Shell builtins: the programs that read or change the shell's own state
 * (directory, environment, exit status) rather than the filesystem.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/programs/builtins
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 builtins 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { readVariable } from '../expand.ts'
import { resolveIn } from '../fs-access.ts'
import type { ShellProgram, ShellStats } from '../types.ts'
import { parseOptions } from './options.ts'

/** Status a command reports when a signal ended it, as a shell renders `128 + SIGINT`.
 * @remarks 中文说明：常量说明：SIGNAL_EXIT_STATUS 用于处理 SIGNAL_EXIT_STATUS 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const SIGNAL_EXIT_STATUS = 130

/**
 * 常量说明：cd 用于处理 cd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 cd 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cd(argv, io, state, fs)，并按返回类型处理结果。
 */
const cd: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = argv[1] ?? state.environment['HOME'] ?? '/'
  /**
   * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const path = target === '-' ? state.variables['OLDPWD'] ?? state.cwd : resolveIn(state.cwd, target)
  /**
   * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stats = await fs.stat(path)
  if (stats === undefined) {
    io.err(`cd: ${target}: No such file or directory\n`)
    return 1
  }
  if (!stats.directory) {
    io.err(`cd: ${target}: Not a directory\n`)
    return 1
  }
  state.variables['OLDPWD'] = state.cwd
  state.cwd = path
  // `$PWD` is what scripts read back, so it has to follow the real directory.
  if ('PWD' in state.environment) state.environment['PWD'] = path
  return 0
}

/**
 * 常量说明：pwd 用于处理 pwd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 pwd 相关流程；使用场景由所在模块及调用位置决定。
 * @param _argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 pwd(_argv, io, state)，并按返回类型处理结果。
 */
const pwd: ShellProgram = (_argv, io, state) => {
  io.out(`${state.cwd}\n`)
  return 0
}

/**
 * 常量说明：exportProgram 用于处理 exportProgram 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 exportProgram 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 exportProgram(argv, io, state)，并按返回类型处理结果。
 */
const exportProgram: ShellProgram = (argv, io, state) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  if (options.operands.length === 0) {
    /**
     * 变量说明：name、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [name, value] of Object.entries(state.environment).sort()) io.out(`declare -x ${name}="${value}"\n`)
    return 0
  }
  /**
   * 变量说明：operand 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const operand of options.operands) {
    /**
     * 常量说明：separator 用于处理 separator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const separator = operand.indexOf('=')
    if (separator < 0) {
      // Exporting an existing shell variable moves it into the environment.
      state.environment[operand] = state.variables[operand] ?? state.environment[operand] ?? ''
      continue
    }
    state.environment[operand.slice(0, separator)] = operand.slice(separator + 1)
  }
  return 0
}

/**
 * 常量说明：unset 用于处理 unset 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 unset 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param _io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 unset(argv, _io, state)，并按返回类型处理结果。
 */
const unset: ShellProgram = (argv, _io, state) => {
  /**
   * 常量说明：removed 用于处理 removed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const removed = new Set(argv.slice(1))
  /**
   * 常量说明：without 用于处理 without 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 without 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （Record<string, string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Record<string, string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 without(source)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[name]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([name])，并按返回类型处理结果。
   */
  const without = (source: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(source).filter(([name]) => !removed.has(name)))
  state.environment = without(state.environment)
  state.variables = without(state.variables)
  return 0
}

/**
 * 常量说明：env 用于处理 env 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 env 相关流程；使用场景由所在模块及调用位置决定。
 * @param _argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 env(_argv, io, state)，并按返回类型处理结果。
 */
const env: ShellProgram = (_argv, io, state) => {
  /**
   * 变量说明：name、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [name, value] of Object.entries(state.environment).sort()) io.out(`${name}=${value}\n`)
  return 0
}

/**
 * 常量说明：exitProgram 用于处理 exitProgram 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 exitProgram 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param _io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 exitProgram(argv, _io, state)，并按返回类型处理结果。
 */
const exitProgram: ShellProgram = (argv, _io, state) => {
  /**
   * 常量说明：status 用于处理 status 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const status = argv[1] === undefined ? state.lastStatus : Number.parseInt(argv[1], 10) || 0
  state.exitRequested = status
  return status
}

/** `test` / `[`: the file and string predicates a generated command line uses.
 * @remarks 中文说明：常量说明：test 用于处理 test 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 test 相关流程；使用场景由所在模块及调用位置决定。；参数说明：argv（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：io（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：state（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：fs（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 test(argv, io,
 * state, fs)，并按返回类型处理结果。 */
const test: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：words 用于处理 words 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const words = argv[0] === '[' ? argv.slice(1, argv[argv.length - 1] === ']' ? -1 : undefined) : argv.slice(1)
  /**
   * 常量说明：status 用于处理 status 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 status 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 status(value)，并按返回类型处理结果。
   */
  const status = (value: boolean): number => value ? 0 : 1
  /**
   * 常量说明：statOf 用于处理 statOf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 statOf 相关流程；使用场景由所在模块及调用位置决定。
   * @param operand （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<ShellStats | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 statOf(operand)，并按返回类型处理结果。
   */
  const statOf = async (operand: string): Promise<ShellStats | undefined> => await fs.stat(resolveIn(state.cwd, operand))
  if (words.length === 1) return status((words[0] as string) !== '')
  if (words.length === 2) {
    /**
     * 常量说明：operator 用于处理 operator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const operator = words[0] as string
    /**
     * 常量说明：operand 用于处理 operand 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const operand = words[1] ?? ''
    switch (operator) {
      case '-e': return status(await statOf(operand) !== undefined)
      case '-f': return status((await statOf(operand))?.directory === false)
      case '-d': return status((await statOf(operand))?.directory === true)
      case '-s': return status(((await statOf(operand))?.size ?? 0) > 0)
      case '-r': case '-w': return status(await statOf(operand) !== undefined)
      case '-z': return status(operand === '')
      case '-n': return status(operand !== '')
      case '!': return status(operand === '')
      default:
        io.err(`test: ${operator}: unsupported unary operator\n`)
        return 2
    }
  }
  if (words.length === 3) {
    /**
     * 常量说明：left、operator、right 用于处理 left、operator、right 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const [left, operator, right] = words as [string, string, string]
    switch (operator) {
      case '=': case '==': return status(left === right)
      case '!=': return status(left !== right)
      case '-eq': return status(Number(left) === Number(right))
      case '-ne': return status(Number(left) !== Number(right))
      case '-lt': return status(Number(left) < Number(right))
      case '-le': return status(Number(left) <= Number(right))
      case '-gt': return status(Number(left) > Number(right))
      case '-ge': return status(Number(left) >= Number(right))
      default:
        io.err(`test: ${operator}: unsupported binary operator\n`)
        return 2
    }
  }
  io.err('test: unsupported expression\n')
  return 2
}

/**
 * 常量说明：sleep 用于处理 sleep 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 sleep 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sleep(argv, io, state)，并按返回类型处理结果。
 */
const sleep: ShellProgram = async (argv, io, state) => {
  /**
   * 常量说明：seconds 用于处理 seconds 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seconds = Number.parseFloat(argv[1] ?? '')
  if (!Number.isFinite(seconds) || seconds < 0) {
    io.err(`sleep: invalid time interval '${argv[1] ?? ''}'\n`)
    return 2
  }
  // A killed command must settle at once: waiting out the full interval would
  // keep the caller's process handle open long after its signal arrived.
  /**
   * 常量说明：killed 用于处理 killed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：settle（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(settle)，并按返回类型处理结果。
   */
  const killed = await new Promise<boolean>((settle) => {
    /**
     * 常量说明：timer 用于处理 timer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const timer = setTimeout(() => {
      state.signal?.removeEventListener('abort', onAbort)
      settle(false)
    }, seconds * 1000)
    /**
     * 功能说明：响应 Abort 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onAbort()，并按返回类型处理结果。
     */
    function onAbort(): void {
      clearTimeout(timer)
      settle(true)
    }
    if (state.signal?.aborted === true) onAbort()
    else state.signal?.addEventListener('abort', onAbort, { once: true })
  })
  return killed ? SIGNAL_EXIT_STATUS : 0
}

/**
 * 常量说明：date 用于处理 date 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 date 相关流程；使用场景由所在模块及调用位置决定。
 * @param _argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 date(_argv, io)，并按返回类型处理结果。
 */
const date: ShellProgram = (_argv, io) => {
  io.out(`${new Date().toISOString()}\n`)
  return 0
}

/**
 * 常量说明：seq 用于处理 seq 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 seq 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 seq(argv, io)，并按返回类型处理结果。
 */
const seq: ShellProgram = (argv, io) => {
  /**
   * 常量说明：numbers 用于处理 numbers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  const numbers = argv.slice(1).map(value => Number.parseInt(value, 10))
  /**
   * 常量说明：first、second、third 用于处理 first、second、third 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [first, second, third] = numbers
  /**
   * 常量说明：from 用于处理 from 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const from = numbers.length > 1 ? first as number : 1
  /**
   * 常量说明：step 用于处理 step 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const step = numbers.length > 2 ? second as number : 1
  /**
   * 常量说明：to 用于处理 to 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const to = numbers.length > 2 ? third as number : numbers.length > 1 ? second as number : first
  if (to === undefined || !Number.isFinite(to) || step === 0) {
    io.err('seq: expected numeric bounds\n')
    return 2
  }
  /**
   * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let value = from; step > 0 ? value <= to : value >= to; value += step) io.out(`${String(value)}\n`)
  return 0
}

/** `printenv NAME`, which scripts prefer over `echo $NAME` when the name is computed.
 * @remarks 中文说明：常量说明：printenv 用于处理 printenv 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 printenv 相关流程；使用场景由所在模块及调用位置决定。；参数说明：argv（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：io（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：state（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 printenv(argv,
 * io, state)，并按返回类型处理结果。 */
const printenv: ShellProgram = (argv, io, state) => {
  /**
   * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const name = argv[1]
  if (name === undefined) {
    /**
     * 变量说明：key、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [key, value] of Object.entries(state.environment).sort()) io.out(`${key}=${value}\n`)
    return 0
  }
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = readVariable(state, name)
  if (value === undefined) return 1
  io.out(`${value}\n`)
  return 0
}

/** The state builtins, keyed by the name a command line uses.
 * @remarks 中文说明：常量说明：BUILTIN_PROGRAMS 用于处理 BUILTIN_PROGRAMS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
export const BUILTIN_PROGRAMS: Readonly<Record<string, ShellProgram>> = {
  cd,
  pwd,
  export: exportProgram,
  unset,
  env,
  printenv,
  exit: exitProgram,
  test,
  '[': test,
  sleep,
  date,
  seq,
  'true': () => 0,
  'false': () => 1,
  ':': () => 0,
}
