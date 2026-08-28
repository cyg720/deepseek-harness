/** Pure search-card derivation from raw grep/glob result metadata. @module
 * @remarks 文件说明：文件职责：实现 client/ui-tool 中 search card model 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-tool
 * 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import type { SearchBlockProps, SearchFileGroup } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from './tool-call-model.ts'
import { parsedToolCall } from './raw-tool-call.ts'

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** The {@link SearchBlockProps} union minus each render site's own fields. */
type SearchBlockModelProps = DistributiveOmit<SearchBlockProps, 'labels' | 'maxLines' | 'className'>

/** Result rows retained in a Chat card before its middle collapses.
 * @remarks 中文说明：常量说明：CHAT_SEARCH_MAX_LINES 用于处理 CHAT_SEARCH_MAX_LINES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const CHAT_SEARCH_MAX_LINES = 8

/** Search-card props plus an optional locator for a capped full result. */
export interface SearchCardModel {
  /** Props consumed by {@link SearchBlock}. */
  card: SearchBlockModelProps
  /** Raw result text containing the full-result locator for a capped search. */
  recovery: string | undefined
}

/**
 * 功能说明：处理 validSearchCall 相关流程；使用场景由所在模块及调用位置决定。
 * @param block （ToolCallBlock）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 'grep' | 'glob' | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 validSearchCall(block)，并按返回类型处理结果。
 */
function validSearchCall(block: ToolCallBlock): 'grep' | 'glob' | null {
  /**
   * 常量说明：call 用于处理 call 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const call = parsedToolCall(block)
  if (call === null) return null
  /**
   * 常量说明：pattern、path 用于处理 pattern、path 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { pattern, path } = call.args
  if (typeof pattern !== 'string') return null
  if (call.name === 'grep' && pattern === '') return null
  if (call.name === 'glob' && pattern.trim() === '') return null
  if (call.name !== 'grep' && call.name !== 'glob') return null
  if (path !== undefined && (typeof path !== 'string' || path.trim() === '')) return null
  if (call.name === 'grep') {
    /**
     * 常量说明：include 用于处理 include 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { include } = call.args
    if (include !== undefined && (typeof include !== 'string' || !validInclude(include))) return null
  }
  return call.name
}

/**
 * 功能说明：处理 validInclude 相关流程；使用场景由所在模块及调用位置决定。
 * @param include （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 validInclude(include)，并按返回类型处理结果。
 */
function validInclude(include: string): boolean {
  if (include.trim() === '' || include.startsWith('!')) return false
  /**
   * 变量说明：braceDepth 用于处理 braceDepth 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let braceDepth = 0
  /**
   * 变量说明：character 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const character of include) {
    if (character === '{') braceDepth += 1
    else if (character === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (character === ',' && braceDepth === 0) return false
  }
  return true
}

/**
 * 功能说明：处理 searchFiles 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SearchFileGroup[] | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 searchFiles(value)，并按返回类型处理结果。
 */
function searchFiles(value: unknown): SearchFileGroup[] | null {
  if (!Array.isArray(value)) return null
  /**
   * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const files: SearchFileGroup[] = []
  /**
   * 变量说明：file 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const file of value) {
    if (typeof file !== 'object' || file === null || Array.isArray(file)) return null
    /**
     * 常量说明：path、matches 用于处理 path、matches 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { path, matches } = file as Record<string, unknown>
    if (typeof path !== 'string' || !Array.isArray(matches)) return null
    /**
     * 常量说明：narrowed 用于处理 narrowed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const narrowed: { lineNumber: number; line: string }[] = []
    /**
     * 变量说明：match 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const match of matches) {
      if (typeof match !== 'object' || match === null || Array.isArray(match)) return null
      /**
       * 常量说明：lineNumber、line 用于处理 lineNumber、line 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const { lineNumber, line } = match as Record<string, unknown>
      if (typeof lineNumber !== 'number' || !Number.isInteger(lineNumber) || lineNumber < 1) return null
      if (typeof line !== 'string') return null
      narrowed.push({ lineNumber, line })
    }
    files.push({ path, matches: narrowed })
  }
  return files
}

/**
 * 功能说明：处理 flattenContent 相关流程；使用场景由所在模块及调用位置决定。
 * @param content （readonly { type: string; text?: string }[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 flattenContent(content)，并按返回类型处理结果。
 */
function flattenContent(content: readonly { type: string; text?: string }[]): string | undefined {
  /**
   * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：block is { type: 'text';
   * text: string }；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，
   * 并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  const text = content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
  return text === '' ? undefined : text
}

/**
 * Derive a settled root grep/glob card from persisted metadata.
 * @param block - running or settled Tool block.
 * @returns search-card props, or null for the generic path.
 * @remarks 中文说明：功能说明：处理 searchCardModel 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：block（ToolCallBlock）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SearchCardModel | null；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 searchCardModel(block)，并按返回类型处理结果。
 */
export function searchCardModel(block: ToolCallBlock): SearchCardModel | null {
  if (block.parentCallId !== undefined || !('kind' in block) || block.isError) return null
  /**
   * 常量说明：tool 用于处理 tool 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tool = validSearchCall(block)
  if (tool === null) return null
  if (typeof block.meta !== 'object' || block.meta === null || Array.isArray(block.meta)) return null
  /**
   * 常量说明：meta 用于处理 meta 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const meta = block.meta as Record<string, unknown>
  if (typeof meta.truncated !== 'boolean') return null
  if (typeof meta.total !== 'number' || !Number.isInteger(meta.total) || meta.total < 0) return null
  /**
   * 常量说明：common 用于处理 common 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const common = { truncated: meta.truncated, total: meta.total }
  /**
   * 常量说明：recovery 用于处理 recovery 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const recovery = meta.truncated ? flattenContent(block.content) : undefined
  if (tool === 'grep') {
    if (meta.shape !== 'matches') return null
    /**
     * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const files = searchFiles(meta.files)
    return files === null ? null : { recovery, card: { kind: 'matches', files, ...common } }
  }
  if (meta.shape !== 'paths' || !Array.isArray(meta.paths)) return null
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：path is string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
   */
  if (!meta.paths.every((path): path is string => typeof path === 'string')) return null
  return { recovery, card: { kind: 'paths', paths: [...meta.paths], ...common } }
}
