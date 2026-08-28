/**
 * 文件职责：验证 subprocess/win32-process 中 quote spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import { buildCommandLine, quoteArg } from '../src/process.ts'

/**
 * 常量说明：isWin32 用于判断是否为 Win32 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const isWin32 = process.platform === 'win32'

/**
 * 常量说明：cases 用于处理 cases 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const cases: Array<[string, string]> = [
  ['', '""'],
  ['a', 'a'],
  ['a b', '"a b"'],
  ['a"b', '"a\\"b"'],
  ['a\\b', 'a\\b'],
  ['a b\\', '"a b\\\\"'],
  ['a b\\\\', '"a b\\\\\\\\"'],
  ['a\\\\"b', '"a\\\\\\\\\\"b"'],
]

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('quoteArg', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：input（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：expected（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(input, expected)，
   * 并按返回类型处理结果。
   */
  it.each(cases)('quotes %j as %j', (input, expected) => {
    expect(quoteArg(input)).toBe(expected)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('builds one CreateProcess command line without shell interpretation', () => {
    expect(buildCommandLine('C:\\Program Files\\tool.exe', ['a b', 'c'])).toBe(
      '"C:\\Program Files\\tool.exe" "a b" c',
    )
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe.skipIf(!isWin32)('CommandLineToArgvW round-trip', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('parses the shared command line back to the original argv', async () => {
    /**
     * 常量说明：koffi 用于处理 koffi 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { default: koffi } = await import('koffi')
    /**
     * 常量说明：PVOID 用于处理 PVOID 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const PVOID = koffi.pointer('void')
    /**
     * 常量说明：shell32 用于处理 shell32 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const shell32 = koffi.load('shell32.dll')
    /**
     * 常量说明：kernel32 用于处理 kernel32 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const kernel32 = koffi.load('kernel32.dll')
    /**
     * 常量说明：commandLineToArgvW 用于处理 commandLineToArgvW 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const commandLineToArgvW = shell32.func(
      '__stdcall',
      'CommandLineToArgvW',
      PVOID,
      ['str16', koffi.pointer('int')],
    )
    /**
     * 常量说明：lstrcpynW 用于处理 lstrcpynW 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const lstrcpynW = kernel32.func('__stdcall', 'lstrcpynW', PVOID, [PVOID, PVOID, 'int'])
    /**
     * 常量说明：lstrlenW 用于处理 lstrlenW 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const lstrlenW = kernel32.func('__stdcall', 'lstrlenW', 'int', [PVOID])
    /**
     * 常量说明：localFree 用于处理 localFree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const localFree = kernel32.func('__stdcall', 'LocalFree', PVOID, [PVOID])
    /**
     * 常量说明：parse 用于解析 parse 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：解析 parse 相关流程；使用场景由所在模块及调用位置决定。
     * @param commandLine （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 parse(commandLine)，并按返回类型处理结果。
     */
    const parse = (commandLine: string): string[] => {
      /**
       * 常量说明：countSlot 用于处理 countSlot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const countSlot = koffi.alloc('int', 1) as unknown
      /**
       * 常量说明：argvBlock 用于处理 argvBlock 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const argvBlock = commandLineToArgvW(commandLine, countSlot) as unknown
      try {
        if (argvBlock === null) throw new Error('CommandLineToArgvW returned NULL')
        /**
         * 常量说明：count 用于处理 count 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const count = koffi.decode(countSlot, 0, 'int') as number
        /**
         * 常量说明：table 用于处理 table 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const table = Buffer.from(koffi.view(argvBlock, count * 8))
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_, index)，并按返回类型处理结果。
         */
        return Array.from({ length: count }, (_, index) => {
          /**
           * 常量说明：stringAddress 用于处理 stringAddress 相关数据，作用于当前作用域；初始化后不可重新赋值，
           * 但对象内部是否可变仍由其类型决定。
           */
          const stringAddress = table.readBigUInt64LE(index * 8)
          /**
           * 常量说明：copied 用于处理 copied 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const copied = Buffer.alloc(2048)
          lstrcpynW(copied, stringAddress, copied.length / 2)
          /**
           * 常量说明：length 用于处理 length 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const length = lstrlenW(copied) as number
          return copied.subarray(0, length * 2).toString('utf16le')
        })
      } finally {
        localFree(argvBlock)
      }
    }
    /**
     * 常量说明：argv 用于处理 argv 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const argv = ['', 'a', 'a b', 'a"b', 'a\\b', 'a b\\', 'a b\\\\', 'a\\\\"b']
    expect(parse(buildCommandLine('prog.exe', argv))).toEqual(['prog.exe', ...argv])
  })
})
