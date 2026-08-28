/**
 * Text utilities of the command table. Each one reads its operands as files
 * and falls back to standard input, the way its POSIX counterpart does.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/programs/text
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 text 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { describeFailure, resolveIn } from '../fs-access.ts'
import type { ShellFileSystem, ShellIo, ShellProgram, ShellState } from '../types.ts'
import { numberOption, parseOptions, toLines } from './options.ts'

/**
 * Read every operand as a file, reporting the ones that fail.
 * @param program - name used in diagnostics.
 * @param operands - paths to read; empty means standard input.
 * @param io - source of standard input and sink for diagnostics.
 * @param state - shell state supplying the working directory.
 * @param fs - the filesystem to read from.
 * @returns one entry per readable source and the status the program should report.
 * @remarks 中文说明：功能说明：读取 Inputs 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：program（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：operands（readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：io（ShellIo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fs（ShellFileSystem）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<{
 * sources: { name: string; text: string }[]; status: number }>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 readInputs(program, operands, io,
 * state, fs)，并按返回类型处理结果。
 */
async function readInputs(
  program: string,
  operands: readonly string[],
  io: ShellIo,
  state: ShellState,
  fs: ShellFileSystem,
): Promise<{ sources: { name: string; text: string }[]; status: number }> {
  if (operands.length === 0) return { sources: [{ name: '-', text: io.stdin }], status: 0 }
  /**
   * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sources: { name: string; text: string }[] = []
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  /**
   * 变量说明：operand 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const operand of operands) {
    if (operand === '-') {
      sources.push({ name: '-', text: io.stdin })
      continue
    }
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = resolveIn(state.cwd, operand)
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      sources.push({ name: operand, text: await fs.readText(path) })
    } catch (error) {
      io.err(`${describeFailure(program, operand, error)}\n`)
      status = 1
    }
  }
  return { sources, status }
}

/** Append a trailing newline unless the text already ends with one.
 * @remarks 中文说明：功能说明：处理 terminated 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 terminated(text)，并按返回类型处理结果。 */
function terminated(text: string): string {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`
}

/**
 * 常量说明：echo 用于处理 echo 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 echo 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 echo(argv, io)，并按返回类型处理结果。
 */
const echo: ShellProgram = (argv, io) => {
  /**
   * 常量说明：suppressNewline 用于处理 suppressNewline 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const suppressNewline = argv[1] === '-n'
  /**
   * 常量说明：words 用于处理 words 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const words = argv.slice(suppressNewline ? 2 : 1)
  io.out(`${words.join(' ')}${suppressNewline ? '' : '\n'}`)
  return 0
}

/**
 * 常量说明：printf 用于处理 printf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 printf 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 printf(argv, io)，并按返回类型处理结果。
 */
const printf: ShellProgram = (argv, io) => {
  /**
   * 常量说明：format 用于格式化 format 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const format = argv[1] ?? ''
  /**
   * 常量说明：operands 用于处理 operands 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const operands = argv.slice(2)
  /**
   * 变量说明：cursor 用于处理 cursor 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let cursor = 0
  // The conversions a shell script realistically uses; anything else is left
  // verbatim so the output shows what was not understood.
  /**
   * 常量说明：rendered 用于处理 rendered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：match（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(match)，并按返回类型处理结果。
   */
  const rendered = format.replace(/%[sdi%]/g, (match) => {
    if (match === '%%') return '%'
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = operands[cursor] ?? ''
    cursor += 1
    if (match === '%s') return value
    /**
     * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parsed = Number.parseInt(value, 10)
    return String(Number.isFinite(parsed) ? parsed : 0)
  })
  io.out(rendered.replace(/\\n/g, '\n').replace(/\\t/g, '\t'))
  return 0
}

/**
 * 常量说明：cat 用于处理 cat 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 cat 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cat(argv, io, state, fs)，并按返回类型处理结果。
 */
const cat: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 常量说明：sources、status 用于处理 sources、status 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { sources, status } = await readInputs('cat', options.operands, io, state, fs)
  /**
   * 变量说明：line 用于处理 line 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let line = 1
  /**
   * 变量说明：source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const source of sources) {
    if (!options.flags.has('n')) {
      io.out(source.text)
      continue
    }
    /**
     * 变量说明：content 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const content of toLines(source.text)) {
      io.out(`${String(line).padStart(6)}\t${content}\n`)
      line += 1
    }
  }
  return status
}

/**
 * 常量说明：head 用于处理 head 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 head 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 head(argv, io, state, fs)，并按返回类型处理结果。
 */
const head: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv, new Set(['n']))
  /**
   * 常量说明：count 用于处理 count 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const count = numberOption(options, 'n', 10)
  /**
   * 常量说明：sources、status 用于处理 sources、status 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { sources, status } = await readInputs('head', options.operands, io, state, fs)
  /**
   * 变量说明：index、source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [index, source] of sources.entries()) {
    if (sources.length > 1) io.out(`${index > 0 ? '\n' : ''}==> ${source.name} <==\n`)
    io.out(terminated(toLines(source.text).slice(0, count).join('\n')))
  }
  return status
}

/**
 * 常量说明：tail 用于处理 tail 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 tail 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 tail(argv, io, state, fs)，并按返回类型处理结果。
 */
const tail: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv, new Set(['n']))
  /**
   * 常量说明：count 用于处理 count 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const count = numberOption(options, 'n', 10)
  /**
   * 常量说明：sources、status 用于处理 sources、status 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { sources, status } = await readInputs('tail', options.operands, io, state, fs)
  /**
   * 变量说明：index、source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [index, source] of sources.entries()) {
    if (sources.length > 1) io.out(`${index > 0 ? '\n' : ''}==> ${source.name} <==\n`)
    io.out(terminated(toLines(source.text).slice(-count).join('\n')))
  }
  return status
}

/**
 * 常量说明：wc 用于处理 wc 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 wc 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 wc(argv, io, state, fs)，并按返回类型处理结果。
 */
const wc: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 常量说明：sources、status 用于处理 sources、status 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { sources, status } = await readInputs('wc', options.operands, io, state, fs)
  /**
   * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：flag（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(flag)，并按返回类型处理结果。
   */
  const selected = ['l', 'w', 'c'].filter(flag => options.flags.has(flag))
  /**
   * 常量说明：columns 用于处理 columns 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const columns = selected.length > 0 ? selected : ['l', 'w', 'c']
  /**
   * 变量说明：source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const source of sources) {
    /**
     * 常量说明：counts 用于处理 counts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：word（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(word)，并按返回类型处理结果。
     */
    const counts: Record<string, number> = {
      l: toLines(source.text).length,
      w: source.text.split(/\s+/).filter(word => word !== '').length,
      c: source.text.length,
    }
    /**
     * 常量说明：cells 用于处理 cells 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：column（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(column)，并按返回类型处理结果。
     */
    const cells = columns.map(column => String(counts[column] ?? 0).padStart(columns.length > 1 ? 8 : 1))
    io.out(`${cells.join(' ')}${source.name === '-' ? '' : ` ${source.name}`}\n`)
  }
  return status
}

/** Collect every file under one directory, for `grep -r`.
 * @remarks 中文说明：功能说明：处理 walkFiles 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：display（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：into（{ path:
 * string; display: string }[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fs（ShellFileSystem）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 walkFiles(path, display,
 * into, fs)，并按返回类型处理结果。 */
async function walkFiles(
  path: string,
  display: string,
  into: { path: string; display: string }[],
  fs: ShellFileSystem,
): Promise<void> {
  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const entry of await fs.list(path)) {
    /**
     * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const child = `${path.endsWith('/') ? path : `${path}/`}${entry.name}`
    /**
     * 常量说明：shown 用于处理 shown 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const shown = `${display.endsWith('/') ? display : `${display}/`}${entry.name}`
    if (entry.directory) await walkFiles(child, shown, into, fs)
    else into.push({ path: child, display: shown })
  }
}

/**
 * 常量说明：grep 用于处理 grep 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 grep 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 grep(argv, io, state, fs)，并按返回类型处理结果。
 */
const grep: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv, new Set(['e']))
  /**
   * 常量说明：pattern 用于处理 pattern 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pattern = options.values.get('e') ?? options.operands[0]
  /**
   * 常量说明：targets 用于处理 targets 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const targets = options.values.get('e') === undefined ? options.operands.slice(1) : options.operands
  if (pattern === undefined) {
    io.err('grep: no pattern given\n')
    return 2
  }
  // Patterns are JavaScript regular expressions; `-F` matches them literally.
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const source = options.flags.has('F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern
  /**
   * 变量说明：matcher 用于处理 matcher 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let matcher: RegExp
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    matcher = new RegExp(source, options.flags.has('i') ? 'i' : '')
  } catch (error) {
    io.err(`grep: invalid pattern: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  /**
   * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sources: { name: string; text: string }[] = []
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  if (targets.length === 0) {
    sources.push({ name: '', text: io.stdin })
  } else {
    /**
     * 变量说明：target 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const target of targets) {
      /**
       * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const path = resolveIn(state.cwd, target)
      /**
       * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const stats = await fs.stat(path)
      if (stats?.directory === true) {
        if (!options.flags.has('r') && !options.flags.has('R')) {
          io.err(`grep: ${target}: Is a directory\n`)
          status = Math.max(status, 2)
          continue
        }
        /**
         * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const files: { path: string; display: string }[] = []
        await walkFiles(path, target, files, fs)
        /**
         * 变量说明：file 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const file of files) sources.push({ name: file.display, text: await fs.readText(file.path) })
        continue
      }
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        sources.push({ name: target, text: await fs.readText(path) })
      } catch (error) {
        io.err(`${describeFailure('grep', target, error)}\n`)
        status = Math.max(status, 2)
      }
    }
  }

  /**
   * 常量说明：label 用于处理 label 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const label = sources.length > 1 || options.flags.has('H')
  /**
   * 变量说明：matched 用于处理 matched 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let matched = false
  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const entry of sources) {
    /**
     * 常量说明：hits 用于处理 hits 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：text（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(text, index)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
     */
    const hits = toLines(entry.text)
      .map((text, index) => ({ text, number: index + 1 }))
      .filter(line => matcher.test(line.text) !== options.flags.has('v'))
    if (hits.length > 0) matched = true
    if (options.flags.has('l')) {
      if (hits.length > 0) io.out(`${entry.name}\n`)
      continue
    }
    if (options.flags.has('c')) {
      io.out(`${label && entry.name !== '' ? `${entry.name}:` : ''}${String(hits.length)}\n`)
      continue
    }
    /**
     * 变量说明：hit 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const hit of hits) {
      /**
       * 常量说明：prefix 用于处理 prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const prefix = `${label && entry.name !== '' ? `${entry.name}:` : ''}${options.flags.has('n') ? `${String(hit.number)}:` : ''}`
      io.out(`${prefix}${hit.text}\n`)
    }
  }
  // `grep` reports "nothing matched" as status 1, distinct from an error.
  return status !== 0 ? status : matched ? 0 : 1
}

/**
 * 常量说明：sort 用于处理 sort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 sort 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sort(argv, io, state, fs)，并按返回类型处理结果。
 */
const sort: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 常量说明：sources、status 用于处理 sources、status 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { sources, status } = await readInputs('sort', options.operands, io, state, fs)
  /**
   * 变量说明：lines 用于处理 lines 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：source（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(source)，并按返回类型处理结果。
   */
  let lines = sources.flatMap(source => toLines(source.text))
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
   */
  lines = options.flags.has('n')
    ? [...lines].sort((left, right) => (Number.parseFloat(left) || 0) - (Number.parseFloat(right) || 0))
    : [...lines].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  if (options.flags.has('r')) lines.reverse()
  if (options.flags.has('u')) lines = [...new Set(lines)]
  io.out(terminated(lines.join('\n')))
  return status
}

/**
 * 常量说明：uniq 用于处理 uniq 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 uniq 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 uniq(argv, io, state, fs)，并按返回类型处理结果。
 */
const uniq: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 常量说明：sources、status 用于处理 sources、status 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { sources, status } = await readInputs('uniq', options.operands, io, state, fs)
  /**
   * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：source（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(source)，并按返回类型处理结果。
   */
  const lines = sources.flatMap(source => toLines(source.text))
  /**
   * 常量说明：groups 用于处理 groups 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const groups: { text: string; count: number }[] = []
  /**
   * 变量说明：line 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const line of lines) {
    /**
     * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const previous = groups[groups.length - 1]
    if (previous !== undefined && previous.text === line) previous.count += 1
    else groups.push({ text: line, count: 1 })
  }
  /**
   * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：group（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(group)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：group（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(group)，并按返回类型处理结果。
   */
  const selected = options.flags.has('d')
    ? groups.filter(group => group.count > 1)
    : options.flags.has('u') ? groups.filter(group => group.count === 1) : groups
  /**
   * 变量说明：group 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const group of selected) {
    io.out(`${options.flags.has('c') ? `${String(group.count).padStart(7)} ` : ''}${group.text}\n`)
  }
  return status
}

/**
 * 常量说明：cut 用于处理 cut 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 cut 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cut(argv, io, state, fs)，并按返回类型处理结果。
 */
const cut: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv, new Set(['d', 'f', 'c']))
  /**
   * 常量说明：delimiter 用于处理 delimiter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const delimiter = options.values.get('d') ?? '\t'
  /**
   * 常量说明：fields 用于处理 fields 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：field（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(field)，并按返回类型处理结果。
   */
  const fields = (options.values.get('f') ?? '').split(',').map(field => Number.parseInt(field, 10)).filter(Number.isFinite)
  /**
   * 常量说明：characters 用于处理 characters 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const characters = options.values.get('c')
  /**
   * 常量说明：sources、status 用于处理 sources、status 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { sources, status } = await readInputs('cut', options.operands, io, state, fs)
  if (fields.length === 0 && characters === undefined) {
    io.err('cut: expected -f or -c\n')
    return 2
  }
  /**
   * 变量说明：source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const source of sources) {
    /**
     * 变量说明：line 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const line of toLines(source.text)) {
      if (characters !== undefined) {
        /**
         * 常量说明：from、to 用于处理 from、to 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const [from, to] = characters.split('-')
        /**
         * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const start = Number.parseInt(from ?? '1', 10) || 1
        /**
         * 常量说明：end 用于处理 end 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const end = to === undefined || to === '' ? start : Number.parseInt(to, 10)
        io.out(`${line.slice(start - 1, end)}\n`)
        continue
      }
      /**
       * 常量说明：parts 用于处理 parts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const parts = line.split(delimiter)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：field（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(field)，并按返回类型处理结果。
       */
      io.out(`${fields.map(field => parts[field - 1] ?? '').join(delimiter)}\n`)
    }
  }
  return status
}

/** Expand one `tr` set: `a-z` becomes every character in that range.
 * @remarks 中文说明：功能说明：处理 characterSet 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：set（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string[]；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 characterSet(set)，并按返回类型处理结果。 */
function characterSet(set: string): string[] {
  /**
   * 常量说明：characters 用于处理 characters 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  // oxlint-disable-next-line typescript/no-misused-spread -- a `tr` set names characters, and code points are that unit.
  const characters = [...set]
  /**
   * 常量说明：expanded 用于处理 expanded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const expanded: string[] = []
  /**
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let index = 0; index < characters.length; index += 1) {
    /**
     * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const start = characters[index] as string
    /**
     * 常量说明：end 用于处理 end 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const end = characters[index + 2]
    if (characters[index + 1] === '-' && end !== undefined) {
      /**
       * 变量说明：code 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (let code = start.codePointAt(0) as number; code <= (end.codePointAt(0) as number); code += 1) {
        expanded.push(String.fromCodePoint(code))
      }
      index += 2
      continue
    }
    expanded.push(start)
  }
  return expanded
}

/**
 * 常量说明：tr 用于处理 tr 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 tr 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 tr(argv, io)，并按返回类型处理结果。
 */
const tr: ShellProgram = (argv, io) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 常量说明：fromSet、toSet 用于处理 fromSet、toSet 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [fromSet, toSet] = options.operands
  /**
   * 常量说明：from 用于处理 from 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const from = fromSet === undefined ? undefined : characterSet(fromSet).join('')
  /**
   * 常量说明：to 用于处理 to 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const to = toSet === undefined ? undefined : characterSet(toSet).join('')
  if (from === undefined) {
    io.err('tr: expected a source set\n')
    return 2
  }
  if (options.flags.has('d')) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：character（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(character)，并按返回类型处理结果。
     */
    // oxlint-disable-next-line typescript/no-misused-spread -- `tr` deletes per character, and code points are the unit it deletes.
    io.out([...io.stdin].filter(character => !from.includes(character)).join(''))
    return 0
  }
  if (to === undefined) {
    io.err('tr: expected a replacement set\n')
    return 2
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：character（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(character)，并按返回类型处理结果。
   */
  // oxlint-disable-next-line typescript/no-misused-spread -- `tr` translates per character, and code points are the unit it maps.
  io.out([...io.stdin].map((character) => {
    /**
     * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const index = from.indexOf(character)
    return index < 0 ? character : to[Math.min(index, to.length - 1)] as string
  }).join(''))
  return 0
}

/** `sed` accepts only the substitute command; anything else is reported, not guessed at.
 * @remarks 中文说明：常量说明：sed 用于处理 sed 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 sed 相关流程；使用场景由所在模块及调用位置决定。；参数说明：argv（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：io（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：state（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：fs（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 sed(argv, io,
 * state, fs)，并按返回类型处理结果。 */
const sed: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv, new Set(['e']))
  /**
   * 常量说明：script 用于处理 script 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const script = options.values.get('e') ?? options.operands[0]
  /**
   * 常量说明：targets 用于处理 targets 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const targets = options.values.get('e') === undefined ? options.operands.slice(1) : options.operands
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = /^s(.)(.*?[^\\])?\1(.*?)\1([gi]*)$/.exec(script ?? '')
  if (parsed === null) {
    io.err('sed: only substitution scripts (s/pattern/replacement/) run in the worker host\n')
    return 2
  }
  /**
   * 常量说明：pattern、replacement、modifiers 用于处理 pattern、replacement、modifiers
   * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const [, , pattern = '', replacement = '', modifiers = ''] = parsed
  /**
   * 变量说明：matcher 用于处理 matcher 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let matcher: RegExp
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    matcher = new RegExp(pattern, modifiers.includes('g') ? `g${modifiers.replace('g', '')}` : modifiers)
  } catch (error) {
    io.err(`sed: invalid pattern: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  /**
   * 常量说明：sources、status 用于处理 sources、status 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { sources, status } = await readInputs('sed', targets, io, state, fs)
  /**
   * 变量说明：source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const source of sources) {
    /**
     * 变量说明：line 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const line of toLines(source.text)) io.out(`${line.replace(matcher, replacement.replace(/\\(\d)/g, '$$$1'))}\n`)
  }
  return status
}

/**
 * 常量说明：tee 用于处理 tee 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 tee 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 tee(argv, io, state, fs)，并按返回类型处理结果。
 */
const tee: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  io.out(io.stdin)
  /**
   * 变量说明：operand 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const operand of options.operands) {
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      await fs.writeText(resolveIn(state.cwd, operand), io.stdin, options.flags.has('a'))
    } catch (error) {
      io.err(`${describeFailure('tee', operand, error)}\n`)
      return 1
    }
  }
  return 0
}

/** The text utilities, keyed by the name a command line uses.
 * @remarks 中文说明：常量说明：TEXT_PROGRAMS 用于处理 TEXT_PROGRAMS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TEXT_PROGRAMS: Readonly<Record<string, ShellProgram>> = {
  echo, printf, cat, head, tail, wc, grep, sort, uniq, cut, tr, sed, tee,
}
