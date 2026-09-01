/** Browser stack parsing for realm-neutral Runtime and Console events.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 stack 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { RuntimeScriptKey } from '../../shared/cdp/ids.ts'
import type { RuntimeCallFrame, RuntimeStackTrace } from '../../shared/cdp/index.ts'

/** Resolve a browser stack-frame URL to a Client catalog script key. */
export type ClientScriptKeyResolver = (url: string) => RuntimeScriptKey | undefined

/**
 * Capture the caller stack of a wrapped Client Console method.
 * @param resolveScript - Resolver for Client catalog script keys.
 * @returns Parsed call frames when the browser supplies a stack.
 * @remarks 中文说明：功能说明：处理 captureClientConsoleStack 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：resolveScript（ClientScriptKeyResolver）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；返回值：RuntimeStackTrace | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 captureClientConsoleStack(resolveScript)，并按返回类型处理结果。
 */
export function captureClientConsoleStack(resolveScript: ClientScriptKeyResolver): RuntimeStackTrace | undefined {
  return parseClientStack(new Error().stack, resolveScript, 3)
}

/**
 * Parse the stack attached to an uncaught Client value when available.
 * @param value - Thrown or rejected value.
 * @param resolveScript - Resolver for Client catalog script keys.
 * @returns Parsed call frames when the value has a recognized stack string.
 * @remarks 中文说明：功能说明：处理 clientErrorStack 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：resolveScript（ClientScriptKeyResolver）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；返回值：RuntimeStackTrace | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 clientErrorStack(value, resolveScript)，并按返回类型处理结果。
 */
export function clientErrorStack(
  value: unknown,
  resolveScript: ClientScriptKeyResolver = () => undefined,
): RuntimeStackTrace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  /**
   * 变量说明：stack 用于处理 stack 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let stack: unknown
  try {
    stack = Reflect.get(value, 'stack') as unknown
  } catch {
    // A thrown proxy or stack getter cannot replace the original JavaScript exception.
    return undefined
  }
  return typeof stack === 'string' ? parseClientStack(stack, resolveScript, 0) : undefined
}

/**
 * Parse V8- and Firefox-style textual frames into the common stack model.
 * @param stack - Browser stack text.
 * @param resolveScript - Resolver for Client catalog script keys.
 * @param skipFrames - Parsed observer frames omitted from the result.
 * @returns Parsed call frames, or `undefined` when none remain.
 * @remarks 中文说明：功能说明：解析 Client Stack 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：stack（string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：resolveScript（ClientScriptKeyResolver）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；参数说明：skipFrames（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：RuntimeStackTrace | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 parseClientStack(stack, resolveScript, skipFrames)，
 * 并按返回类型处理结果。
 */
export function parseClientStack(
  stack: string | undefined,
  resolveScript: ClientScriptKeyResolver,
  skipFrames: number,
): RuntimeStackTrace | undefined {
  if (stack === undefined) return undefined
  /**
   * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const frames: RuntimeCallFrame[] = []
  /**
   * 变量说明：line 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const line of stack.split('\n')) {
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame = parseFrame(line, resolveScript)
    if (frame !== undefined) frames.push(frame)
  }
  /**
   * 常量说明：callFrames 用于处理 callFrames 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const callFrames = frames.slice(skipFrames)
  return callFrames.length === 0 ? undefined : { callFrames }
}

/**
 * 功能说明：解析 Frame 相关流程；使用场景由所在模块及调用位置决定。
 * @param line （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param resolveScript （ClientScriptKeyResolver）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns RuntimeCallFrame | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseFrame(line, resolveScript)，并按返回类型处理结果。
 */
function parseFrame(line: string, resolveScript: ClientScriptKeyResolver): RuntimeCallFrame | undefined {
  /**
   * 常量说明：chrome 用于处理 chrome 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chrome = /^\s*at\s+(?:(.*?)\s+\()?(.+):(\d+):(\d+)\)?$/u.exec(line)
  /**
   * 常量说明：firefox 用于处理 firefox 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const firefox = chrome === null ? /^(.*?)@(.+):(\d+):(\d+)$/u.exec(line) : null
  /**
   * 常量说明：match 用于处理 match 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const match = chrome ?? firefox
  if (match === null) return undefined
  /**
   * 常量说明：url 用于处理 url 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const url = match[2]
  /**
   * 常量说明：lineNumber 用于处理 lineNumber 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const lineNumber = Number(match[3]) - 1
  /**
   * 常量说明：columnNumber 用于处理 columnNumber 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const columnNumber = Number(match[4]) - 1
  if (url === undefined || !Number.isSafeInteger(lineNumber) || !Number.isSafeInteger(columnNumber)) return undefined
  /**
   * 常量说明：scriptKey 用于处理 scriptKey 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const scriptKey = resolveScript(url)
  return {
    functionName: match[1] ?? '',
    ...(scriptKey === undefined ? {} : { scriptKey }),
    url,
    lineNumber,
    columnNumber,
  }
}
