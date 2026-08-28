/**
 * File and directory utilities of the command table, all of them over the
 * shell's filesystem. Listings print one entry per line: nothing here is ever
 * a terminal, so the column layout a real `ls` picks for a tty would only be
 * noise in a tool result.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/programs/files
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 files 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import picomatch from 'picomatch'
import { basename, dirname, resolve } from '../../module-system/posix-path.ts'
import { describeFailure, resolveIn } from '../fs-access.ts'
import type { ShellFileSystem, ShellProgram, ShellStats } from '../types.ts'
import { parseOptions } from './options.ts'

/** Format one entry the way `ls -l` does, with the facts the VFS actually holds.
 * @remarks 中文说明：功能说明：处理 longEntry 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：stats（ShellStats | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 longEntry(stats, name)，并按返回类型处理结果。 */
function longEntry(stats: ShellStats | undefined, name: string): string {
  /**
   * 常量说明：size 用于处理 size 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const size = String(stats?.size ?? 0).padStart(8)
  /**
   * 常量说明：modified 用于处理 modified 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const modified = new Date(stats?.mtimeMs ?? 0).toISOString().replace('T', ' ').slice(0, 16)
  return `${stats?.directory === true ? 'drwxr-xr-x' : '-rw-r--r--'} ${size} ${modified} ${name}`
}

/**
 * 常量说明：ls 用于处理 ls 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 ls 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 ls(argv, io, state, fs)，并按返回类型处理结果。
 */
const ls: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 常量说明：operands 用于处理 operands 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const operands = options.operands.length > 0 ? options.operands : ['.']
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  /**
   * 变量说明：index、operand 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [index, operand] of operands.entries()) {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = resolveIn(state.cwd, operand)
    /**
     * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stats = await fs.stat(path)
    if (stats === undefined) {
      io.err(`ls: ${operand}: No such file or directory\n`)
      status = 2
      continue
    }
    if (operands.length > 1) io.out(`${index > 0 ? '\n' : ''}${operand}:\n`)
    if (!stats.directory) {
      io.out(`${options.flags.has('l') ? longEntry(stats, operand) : operand}\n`)
      continue
    }
    /**
     * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
     */
    const entries = (await fs.list(path)).filter(entry => options.flags.has('a') || !entry.name.startsWith('.'))
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of entries) {
      /**
       * 常量说明：shown 用于处理 shown 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const shown = options.flags.has('l')
        ? longEntry(await fs.stat(resolve(path, entry.name)), entry.name)
        : entry.name
      io.out(`${shown}\n`)
    }
  }
  return status
}

/**
 * 常量说明：find 用于查找 find 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：查找 find 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 find(argv, io, state, fs)，并按返回类型处理结果。
 */
const find: ShellProgram = async (argv, io, state, fs) => {
  // `find` spells multi-letter predicates with one dash, which the shared
  // option parser would read as bundled short flags; this walk reads them.
  /**
   * 常量说明：roots 用于处理 roots 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const roots: string[] = []
  /**
   * 变量说明：namePattern 用于处理 namePattern 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let namePattern: string | undefined
  /**
   * 变量说明：kind 用于处理 kind 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let kind: string | undefined
  /**
   * 变量说明：maxDepth 用于处理 maxDepth 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let maxDepth = Number.POSITIVE_INFINITY
  /**
   * 常量说明：words 用于处理 words 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const words = argv.slice(1)
  /**
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let index = 0; index < words.length; index += 1) {
    /**
     * 常量说明：word 用于处理 word 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const word = words[index] as string
    if (word === '-name') { index += 1; namePattern = words[index]; continue }
    if (word === '-type') { index += 1; kind = words[index]; continue }
    if (word === '-maxdepth') { index += 1; maxDepth = Number.parseInt(words[index] ?? '', 10); continue }
    if (word.startsWith('-')) {
      io.err(`find: unsupported predicate ${word}\n`)
      return 2
    }
    roots.push(word)
  }
  /**
   * 常量说明：matches 用于处理 matches 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const matches = namePattern === undefined ? undefined : picomatch(namePattern, { dot: true })
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  /**
   * 常量说明：visit 用于处理 visit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 visit 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param display （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param depth （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 visit(path, display, depth)，并按返回类型处理结果。
   */
  const visit = async (path: string, display: string, depth: number): Promise<void> => {
    /**
     * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stats = await fs.stat(path)
    if (stats === undefined) {
      io.err(`find: ${display}: No such file or directory\n`)
      status = 1
      return
    }
    /**
     * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selected = (matches === undefined || matches(basename(display)))
      && (kind === undefined || (kind === 'd') === stats.directory)
    if (selected) io.out(`${display}\n`)
    if (!stats.directory || depth >= maxDepth) return
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of await fs.list(path)) {
      await visit(resolve(path, entry.name), `${display === '/' ? '' : display}/${entry.name}`, depth + 1)
    }
  }
  /**
   * 变量说明：root 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const root of roots.length > 0 ? roots : ['.']) await visit(resolveIn(state.cwd, root), root, 0)
  return status
}

/**
 * 常量说明：mkdir 用于处理 mkdir 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 mkdir 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 mkdir(argv, io, state, fs)，并按返回类型处理结果。
 */
const mkdir: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  /**
   * 变量说明：operand 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const operand of options.operands) {
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      await fs.mkdir(resolveIn(state.cwd, operand), options.flags.has('p'))
    } catch (error) {
      io.err(`${describeFailure('mkdir', operand, error)}\n`)
      status = 1
    }
  }
  return status
}

/**
 * 常量说明：rmdir 用于处理 rmdir 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 rmdir 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rmdir(argv, io, state, fs)，并按返回类型处理结果。
 */
const rmdir: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  /**
   * 变量说明：operand 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const operand of options.operands) {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = resolveIn(state.cwd, operand)
    if ((await fs.list(path)).length > 0) {
      io.err(`rmdir: ${operand}: Directory not empty\n`)
      status = 1
      continue
    }
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      await fs.remove(path, { recursive: true, force: false })
    } catch (error) {
      io.err(`${describeFailure('rmdir', operand, error)}\n`)
      status = 1
    }
  }
  return status
}

/**
 * 常量说明：rm 用于处理 rm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 rm 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rm(argv, io, state, fs)，并按返回类型处理结果。
 */
const rm: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 常量说明：recursive 用于处理 recursive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const recursive = options.flags.has('r') || options.flags.has('R')
  /**
   * 常量说明：force 用于处理 force 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const force = options.flags.has('f')
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  /**
   * 变量说明：operand 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const operand of options.operands) {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = resolveIn(state.cwd, operand)
    /**
     * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stats = await fs.stat(path)
    if (stats === undefined) {
      if (force) continue
      io.err(`rm: ${operand}: No such file or directory\n`)
      status = 1
      continue
    }
    if (stats.directory && !recursive) {
      io.err(`rm: ${operand}: Is a directory\n`)
      status = 1
      continue
    }
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      await fs.remove(path, { recursive, force })
    } catch (error) {
      io.err(`${describeFailure('rm', operand, error)}\n`)
      status = 1
    }
  }
  return status
}

/** Copy one file or one whole subtree.
 * @remarks 中文说明：功能说明：处理 copyTree 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：from（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：to（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fs（ShellFileSystem）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 copyTree(from, to, fs)，
 * 并按返回类型处理结果。 */
async function copyTree(from: string, to: string, fs: ShellFileSystem): Promise<void> {
  /**
   * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stats = await fs.stat(from)
  if (stats?.directory !== true) {
    await fs.writeText(to, await fs.readText(from))
    return
  }
  await fs.mkdir(to, true)
  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const entry of await fs.list(from)) await copyTree(resolve(from, entry.name), resolve(to, entry.name), fs)
}

/** Resolve the real destination of a copy or move: into a directory, or onto a path.
 * @remarks 中文说明：功能说明：处理 destinationFor 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：target（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：source（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fs（ShellFileSystem）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * destinationFor(target, source, fs)，并按返回类型处理结果。 */
async function destinationFor(target: string, source: string, fs: ShellFileSystem): Promise<string> {
  return (await fs.stat(target))?.directory === true ? resolve(target, basename(source)) : target
}

/**
 * 常量说明：cp 用于处理 cp 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 cp 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cp(argv, io, state, fs)，并按返回类型处理结果。
 */
const cp: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sources = options.operands.slice(0, -1)
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = options.operands[options.operands.length - 1]
  if (target === undefined || sources.length === 0) {
    io.err('cp: expected a source and a destination\n')
    return 2
  }
  /**
   * 常量说明：targetPath 用于处理 targetPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const targetPath = resolveIn(state.cwd, target)
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  /**
   * 变量说明：source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const source of sources) {
    /**
     * 常量说明：sourcePath 用于处理 sourcePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const sourcePath = resolveIn(state.cwd, source)
    /**
     * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stats = await fs.stat(sourcePath)
    if (stats === undefined) {
      io.err(`cp: ${source}: No such file or directory\n`)
      status = 1
      continue
    }
    if (stats.directory && !(options.flags.has('r') || options.flags.has('R'))) {
      io.err(`cp: ${source}: Is a directory\n`)
      status = 1
      continue
    }
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      await copyTree(sourcePath, await destinationFor(targetPath, source, fs), fs)
    } catch (error) {
      io.err(`${describeFailure('cp', source, error)}\n`)
      status = 1
    }
  }
  return status
}

/**
 * 常量说明：mv 用于处理 mv 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 mv 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 mv(argv, io, state, fs)，并按返回类型处理结果。
 */
const mv: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sources = options.operands.slice(0, -1)
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = options.operands[options.operands.length - 1]
  if (target === undefined || sources.length === 0) {
    io.err('mv: expected a source and a destination\n')
    return 2
  }
  /**
   * 常量说明：targetPath 用于处理 targetPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const targetPath = resolveIn(state.cwd, target)
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  /**
   * 变量说明：source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const source of sources) {
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      await fs.rename(resolveIn(state.cwd, source), await destinationFor(targetPath, source, fs))
    } catch (error) {
      io.err(`${describeFailure('mv', source, error)}\n`)
      status = 1
    }
  }
  return status
}

/**
 * 常量说明：touch 用于处理 touch 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 touch 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 touch(argv, io, state, fs)，并按返回类型处理结果。
 */
const touch: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  /**
   * 变量说明：operand 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const operand of options.operands) {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = resolveIn(state.cwd, operand)
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      // Rewriting the existing bytes is what advances the VFS timestamp.
      await fs.writeText(path, await fs.stat(path) === undefined ? '' : await fs.readText(path))
    } catch (error) {
      io.err(`${describeFailure('touch', operand, error)}\n`)
      status = 1
    }
  }
  return status
}

/**
 * 常量说明：stat 用于处理 stat 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 stat 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 stat(argv, io, state, fs)，并按返回类型处理结果。
 */
const stat: ShellProgram = async (argv, io, state, fs) => {
  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const options = parseOptions(argv)
  /**
   * 变量说明：status 用于处理 status 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let status = 0
  /**
   * 变量说明：operand 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const operand of options.operands) {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = resolveIn(state.cwd, operand)
    /**
     * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stats = await fs.stat(path)
    if (stats === undefined) {
      io.err(`stat: ${operand}: No such file or directory\n`)
      status = 1
      continue
    }
    io.out(`${path} ${stats.directory ? 'directory' : 'file'} ${String(stats.size)} ${new Date(stats.mtimeMs).toISOString()}\n`)
  }
  return status
}

/**
 * 常量说明：dirnameProgram 用于处理 dirnameProgram 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 dirnameProgram 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 dirnameProgram(argv, io)，并按返回类型处理结果。
 */
const dirnameProgram: ShellProgram = (argv, io) => {
  /**
   * 变量说明：operand 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const operand of argv.slice(1)) io.out(`${dirname(operand)}\n`)
  return argv.length > 1 ? 0 : 2
}

/**
 * 常量说明：basenameProgram 用于处理 basenameProgram 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 basenameProgram 相关流程；使用场景由所在模块及调用位置决定。
 * @param argv （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param io （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 basenameProgram(argv, io)，并按返回类型处理结果。
 */
const basenameProgram: ShellProgram = (argv, io) => {
  /**
   * 常量说明：path、suffix 用于处理 path、suffix 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [, path, suffix] = argv
  if (path === undefined) {
    io.err('basename: expected a path\n')
    return 2
  }
  io.out(`${basename(path, suffix)}\n`)
  return 0
}

/** Refuse a utility whose effect the VFS cannot represent at all.
 * @remarks 中文说明：常量说明：unavailable 用于处理 unavailable 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 unavailable 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：ShellProgram；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 unavailable(name)，
 * 并按返回类型处理结果。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_argv（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：io（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_argv, io)，并按返回类型处理结果。
 */
const unavailable = (name: string): ShellProgram => (_argv, io) => {
  io.err(`${name}: not available in the worker host\n`)
  return 127
}

/** The file utilities, keyed by the name a command line uses.
 * @remarks 中文说明：常量说明：FILE_PROGRAMS 用于处理 FILE_PROGRAMS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const FILE_PROGRAMS: Readonly<Record<string, ShellProgram>> = {
  ls,
  find,
  mkdir,
  rmdir,
  rm,
  cp,
  mv,
  touch,
  stat,
  dirname: dirnameProgram,
  basename: basenameProgram,
  // Symbolic links have no representation in the VFS; refusing is honest and
  // keeps a script from believing it created one.
  ln: unavailable('ln'),
  readlink: unavailable('readlink'),
}
