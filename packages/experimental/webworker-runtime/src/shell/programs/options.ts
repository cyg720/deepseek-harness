/**
 * Argument splitting shared by the command table: short flags (bundled or
 * separate), long flags, `--`, and the operands that follow.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/programs/options
 */

/** One parsed argv: which flags were given, and what is left to act on.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 options 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
export interface ParsedOptions {
  /** Every short letter and long name seen, without their dashes. */
  readonly flags: ReadonlySet<string>
  /** Values of flags that take one (`-n 5` and `--name=x` both land here). */
  readonly values: ReadonlyMap<string, string>
  /** Everything that is not a flag, in order. */
  readonly operands: readonly string[]
}

/**
 * Split one program's arguments.
 *
 * A short letter listed in `valued` consumes the rest of its token (`-n5`) or
 * the next argument (`-n 5`); every other letter is a plain flag, so `-rn`
 * sets both `r` and `n`.
 * @param argv - the program's argv, including its name at index 0.
 * @param valued - short letters that take a value.
 * @returns the flags, their values, and the operands.
 * @remarks 中文说明：功能说明：解析 Options 相关流程；使用场景由所在模块及调用位置决定。；参数说明：argv（readonly
 * string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：valued（ReadonlySet<string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ParsedOptions；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseOptions(argv, valued)，并按返回类型处理结果。
 */
export function parseOptions(argv: readonly string[], valued: ReadonlySet<string> = new Set()): ParsedOptions {
  /**
   * 常量说明：flags 用于处理 flags 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const flags = new Set<string>()
  /**
   * 常量说明：values 用于处理 values 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const values = new Map<string, string>()
  /**
   * 常量说明：operands 用于处理 operands 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const operands: string[] = []
  /**
   * 常量说明：rest 用于处理 rest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rest = argv.slice(1)
  /**
   * 变量说明：literal 用于处理 literal 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let literal = false
  /**
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let index = 0; index < rest.length; index += 1) {
    /**
     * 常量说明：argument 用于处理 argument 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const argument = rest[index] as string
    if (literal || argument === '-' || !argument.startsWith('-')) {
      operands.push(argument)
      continue
    }
    if (argument === '--') {
      literal = true
      continue
    }
    if (argument.startsWith('--')) {
      /**
       * 常量说明：name、value 用于处理 name、value 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const [name, value] = splitLong(argument.slice(2))
      flags.add(name)
      if (value !== undefined) values.set(name, value)
      continue
    }
    /**
     * 变量说明：cursor 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let cursor = 1; cursor < argument.length; cursor += 1) {
      /**
       * 常量说明：letter 用于处理 letter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const letter = argument[cursor] as string
      flags.add(letter)
      if (!valued.has(letter)) continue
      /**
       * 常量说明：inline 用于处理 inline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const inline = argument.slice(cursor + 1)
      if (inline !== '') {
        values.set(letter, inline)
      } else {
        index += 1
        values.set(letter, rest[index] ?? '')
      }
      break
    }
  }
  return { flags, values, operands }
}

/** Split `name=value`; a long flag without `=` has no value.
 * @remarks 中文说明：功能说明：处理 splitLong 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：[string, string |
 * undefined]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * splitLong(text)，并按返回类型处理结果。 */
function splitLong(text: string): [string, string | undefined] {
  /**
   * 常量说明：separator 用于处理 separator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const separator = text.indexOf('=')
  return separator < 0 ? [text, undefined] : [text.slice(0, separator), text.slice(separator + 1)]
}

/**
 * Read a numeric flag value.
 * @param options - the parsed options.
 * @param flag - the short letter to read.
 * @param fallback - value to use when the flag is absent or unparsable.
 * @returns the number the caller should use.
 * @remarks 中文说明：功能说明：处理 numberOption 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（ParsedOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 参数说明：flag（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fallback（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 numberOption(options,
 * flag, fallback)，并按返回类型处理结果。
 */
export function numberOption(options: ParsedOptions, flag: string, fallback: number): number {
  /**
   * 常量说明：raw 用于处理 raw 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const raw = options.values.get(flag)
  if (raw === undefined) return fallback
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Split text into lines for the line-oriented utilities.
 * @param text - the text to split.
 * @returns its lines, without the trailing empty line a final newline creates.
 * @remarks 中文说明：功能说明：处理 toLines 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string[]；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 toLines(text)，并按返回类型处理结果。
 */
export function toLines(text: string): string[] {
  if (text === '') return []
  /**
   * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}
