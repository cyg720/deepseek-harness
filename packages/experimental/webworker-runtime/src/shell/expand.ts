/**
 * Word expansion: one parsed argument becomes the zero or more fields a
 * program receives in its argv. Covers the segment kinds the grammar produces
 * — literal text, variables (with `:-` / `:+` forms), command substitution,
 * arithmetic, and globs matched against the VFS.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/expand
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 expand 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import picomatch from 'picomatch'
import type { ArgumentSegment, ArithmeticExpression, ShellLine, ValueArgument } from './ast.ts'
import { resolve } from '../module-system/posix-path.ts'
import type { ShellFileSystem, ShellState } from './types.ts'

/** Characters that make the grammar treat a whole word as a glob pattern.
 * @remarks 中文说明：常量说明：GLOB_PATTERN 用于处理 GLOB_PATTERN 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const GLOB_PATTERN = /[*?]|\[[^\]]*\]/

/**
 * Whether one word is a glob the shell should match against the filesystem.
 * Handed to `parseShell`, which decides between a `text` and a `glob` segment.
 * @param word - the word exactly as it was written.
 * @returns true when the word contains a wildcard.
 * @remarks 中文说明：功能说明：判断是否为 Glob Pattern 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：word（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isGlobPattern(word)，并按返回类型处理结果。
 */
export function isGlobPattern(word: string): boolean {
  return GLOB_PATTERN.test(word)
}

/**
 * Read one variable the way `$name` does.
 *
 * Shell variables shadow the environment (an assignment without `export` is
 * only visible to this shell), and the specials report what a shell without
 * job control or positional parameters can honestly report.
 * @param state - the shell state to read.
 * @param name - variable name, or one of `?`, `$`, `#`, `@`, `*`, `0`.
 * @returns the value, or undefined when the variable is unset.
 * @remarks 中文说明：功能说明：读取 Variable 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string | undefined；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 readVariable(state, name)，
 * 并按返回类型处理结果。
 */
export function readVariable(state: ShellState, name: string): string | undefined {
  switch (name) {
    case '?': return String(state.lastStatus)
    // The worker host runs the whole tree as pid 1; `$$` reports it verbatim.
    case '$': return '1'
    case '0': return 'bash'
    // No positional parameters reach a `bash -c` command line here.
    case '#': return '0'
    case '@': case '*': return ''
    default: return state.variables[name] ?? state.environment[name]
  }
}

/** Evaluate `$(( … ))`.
 * @remarks 中文说明：功能说明：处理 arithmetic 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：expression（ArithmeticExpression）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：state（ShellState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 arithmetic(expression,
 * state)，并按返回类型处理结果。 */
function arithmetic(expression: ArithmeticExpression, state: ShellState): number {
  switch (expression.type) {
    case 'number': return expression.value
    case 'variable': return Number.parseInt(readVariable(state, expression.name) ?? '0', 10) || 0
    case 'addition': return arithmetic(expression.left, state) + arithmetic(expression.right, state)
    case 'subtraction': return arithmetic(expression.left, state) - arithmetic(expression.right, state)
    case 'multiplication': return arithmetic(expression.left, state) * arithmetic(expression.right, state)
    case 'division': return Math.trunc(arithmetic(expression.left, state) / arithmetic(expression.right, state))
  }
}

/**
 * Expand one glob against the filesystem, one path segment at a time.
 *
 * Matches keep the pattern's own spelling: a relative pattern yields relative
 * paths, so `ls *.ts` prints what the model typed.
 * @param pattern - the glob as written.
 * @param cwd - directory a relative pattern starts from.
 * @param fs - the filesystem to match against.
 * @returns sorted matches, or an empty array when nothing matches.
 * @remarks 中文说明：功能说明：处理 expandGlob 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：pattern（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：cwd（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fs（ShellFileSystem）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<string[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * expandGlob(pattern, cwd, fs)，并按返回类型处理结果。
 */
export async function expandGlob(pattern: string, cwd: string, fs: ShellFileSystem): Promise<string[]> {
  /**
   * 常量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const absolute = pattern.startsWith('/')
  /**
   * 常量说明：segments 用于处理 segments 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：segment（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(segment)，并按返回类型处理结果。
   */
  const segments = pattern.split('/').filter(segment => segment !== '')
  // A glob walks paths that may not exist or may not be directories; both
  // simply contribute no matches, so listing failures are absorbed here.
  /**
   * 常量说明：safeList 用于处理 safeList 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 safeList 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @returns Promise<{ name: string; directory: boolean }[]>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 safeList(path)，并按返回类型处理结果。
   */
  const safeList = async (path: string): Promise<{ name: string; directory: boolean }[]> => {
    try {
      return await fs.list(path)
    } catch {
      return []
    }
  }
  // Each frontier entry pairs the directory to search with the prefix that
  // reproduces the caller's spelling for anything found under it.
  /**
   * 变量说明：frontier 用于处理 frontier 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let frontier: { path: string; display: string }[] = [{ path: absolute ? '/' : cwd, display: absolute ? '/' : '' }]
  /**
   * 变量说明：index、segment 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [index, segment] of segments.entries()) {
    /**
     * 常量说明：last 用于处理 last 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const last = index === segments.length - 1
    /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const next: { path: string; display: string }[] = []
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of frontier) {
      if (segment === '**') {
        // `**` stands for this directory and every directory below it.
        /**
         * 常量说明：stack 用于处理 stack 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const stack = [entry]
        while (stack.length > 0) {
          /**
           * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const current = stack.pop() as { path: string; display: string }
          next.push(current)
          /**
           * 变量说明：child 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
           */
          for (const child of await safeList(current.path)) {
            if (child.directory) {
              stack.push({ path: resolve(current.path, child.name), display: `${current.display}${child.name}/` })
            }
          }
        }
        continue
      }
      if (!isGlobPattern(segment)) {
        /**
         * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const path = resolve(entry.path, segment)
        if (await fs.stat(path) === undefined) continue
        next.push({ path, display: `${entry.display}${segment}${last ? '' : '/'}` })
        continue
      }
      /**
       * 常量说明：matches 用于处理 matches 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const matches = picomatch(segment, { dot: segment.startsWith('.') })
      /**
       * 变量说明：child 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const child of await safeList(entry.path)) {
        if (!matches(child.name)) continue
        if (!last && !child.directory) continue
        next.push({ path: resolve(entry.path, child.name), display: `${entry.display}${child.name}${last ? '' : '/'}` })
      }
    }
    frontier = next
  }
  // A `**` frontier carries trailing separators from its own expansion; the
  // shell reports directory matches without one.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：match（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(match)，并按返回类型处理结果。
   */
  return [...new Set(frontier.map(entry => entry.display.replace(/\/$/, '')))].filter(match => match !== '').sort()
}

/**
 * Everything expansion needs that the argument itself cannot supply: how to
 * run a command substitution, and the state variables resolve against.
 */
export interface ExpansionContext {
  state: ShellState
  /** The filesystem globs match against. */
  fs: ShellFileSystem
  /**
   * Run one nested command line and return its standard output.
   * @param shell - the parsed line inside `$( … )`.
   * @returns the captured output, with trailing newlines already stripped.
   * @remarks 中文说明：功能说明：处理 substitute 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：shell（ShellLine）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<string>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 substitute(shell)，
   * 并按返回类型处理结果。
   */
  substitute(shell: ShellLine): Promise<string>
}

/**
 * Expand one argument into fields.
 *
 * Unquoted expansions split on whitespace the way a shell does, so
 * `cat $FILES` with two names runs `cat` with two arguments while
 * `cat "$FILES"` runs it with one.
 * @param argument - the parsed argument.
 * @param context - substitution hook and shell state.
 * @returns the fields this argument contributes to argv.
 * @remarks 中文说明：功能说明：处理 expandArgument 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：argument（ValueArgument）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：context（ExpansionContext）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<string[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * expandArgument(argument, context)，并按返回类型处理结果。
 */
export async function expandArgument(argument: ValueArgument, context: ExpansionContext): Promise<string[]> {
  /**
   * 常量说明：fields 用于处理 fields 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fields: string[] = []
  // `undefined` means "no field started yet": an unset unquoted variable must
  // contribute nothing rather than an empty argument.
  /**
   * 变量说明：current 用于处理 current 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let current: string | undefined

  /**
   * 常量说明：append 用于处理 append 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 append 相关流程；使用场景由所在模块及调用位置决定。
   * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 append(text)，并按返回类型处理结果。
   */
  const append = (text: string): void => { current = (current ?? '') + text }
  /**
   * 常量说明：appendSplit 用于处理 appendSplit 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 appendSplit 相关流程；使用场景由所在模块及调用位置决定。
   * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 appendSplit(text)，并按返回类型处理结果。
   */
  const appendSplit = (text: string): void => {
    /**
     * 常量说明：parts 用于处理 parts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parts = text.split(/\s+/)
    /**
     * 变量说明：index、part 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [index, part] of parts.entries()) {
      if (index > 0) {
        if (current !== undefined) fields.push(current)
        current = undefined
      }
      if (part !== '') append(part)
    }
  }

  /**
   * 变量说明：segment 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const segment of argument.segments) {
    switch (segment.type) {
      case 'text':
        append(segment.text)
        break
      case 'arithmetic':
        append(String(arithmetic(segment.arithmetic, context.state)))
        break
      case 'variable': {
        /**
         * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const value = await expandVariable(segment, context)
        if (segment.quoted) append(value)
        else appendSplit(value)
        break
      }
      case 'shell': {
        /**
         * 常量说明：output 用于处理 output 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const output = await context.substitute(segment.shell)
        if (segment.quoted) append(output)
        else appendSplit(output)
        break
      }
      case 'glob': {
        /**
         * 常量说明：matches 用于处理 matches 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const matches = await expandGlob(segment.pattern, context.state.cwd, context.fs)
        if (matches.length === 0) {
          // No match: a POSIX shell passes the pattern through unchanged.
          append(segment.pattern)
          break
        }
        /**
         * 变量说明：index、match 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const [index, match] of matches.entries()) {
          if (index > 0) {
            fields.push(current as string)
            current = undefined
          }
          append(match)
        }
        break
      }
    }
  }
  if (current !== undefined) fields.push(current)
  return fields
}

/** Resolve one `${name}` segment, including its `:-` and `:+` alternatives.
 * @remarks 中文说明：功能说明：处理 expandVariable 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：segment（Extract<ArgumentSegment, { type: 'variable' }>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：context（ExpansionContext）：提供当前 Cordis 插件上下文与已声明服务；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 expandVariable(segment, context)，并按返回类型处理结果。 */
async function expandVariable(
  segment: Extract<ArgumentSegment, { type: 'variable' }>,
  context: ExpansionContext,
): Promise<string> {
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = readVariable(context.state, segment.name)
  /**
   * 常量说明：set 用于设置 set 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const set = value !== undefined && value !== ''
  if (!set && segment.defaultValue !== undefined) return await joinArguments(segment.defaultValue, context)
  if (set && segment.alternativeValue !== undefined) return await joinArguments(segment.alternativeValue, context)
  return value ?? ''
}

/** Expand a `:-` / `:+` operand, which is itself a list of arguments.
 * @remarks 中文说明：功能说明：处理 joinArguments 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：operand（ValueArgument[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：context（ExpansionContext）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * joinArguments(operand, context)，并按返回类型处理结果。 */
async function joinArguments(operand: ValueArgument[], context: ExpansionContext): Promise<string> {
  /**
   * 常量说明：parts 用于处理 parts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parts: string[] = []
  /**
   * 变量说明：argument 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const argument of operand) parts.push(...await expandArgument(argument, context))
  return parts.join(' ')
}
