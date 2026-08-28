/** Pure web-card derivation from raw web result metadata. @module
 * @remarks 文件说明：文件职责：实现 client/ui-tool 中 web card model 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-tool
 * 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import type { WebBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from './tool-call-model.ts'
import { parsedToolCall } from './raw-tool-call.ts'

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** Web-card data owned by the presenter; render sites add localized labels and classes. */
export type WebCardModelProps = DistributiveOmit<WebBlockProps, 'labels' | 'className'>

/**
 * 功能说明：处理 validWebCall 相关流程；使用场景由所在模块及调用位置决定。
 * @param block （ToolCallBlock）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 'web_search' | 'web_fetch' | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 validWebCall(block)，并按返回类型处理结果。
 */
function validWebCall(block: ToolCallBlock): 'web_search' | 'web_fetch' | null {
  /**
   * 常量说明：call 用于处理 call 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const call = parsedToolCall(block)
  if (call === null) return null
  if (call.name === 'web_search') {
    /**
     * 常量说明：queries 用于处理 queries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { queries } = call.args
    if (!Array.isArray(queries) || queries.length === 0) return null
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：query（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(query)，并按返回类型处理结果。
     */
    return queries.every(query => typeof query === 'string' && query.trim() !== '') ? call.name : null
  }
  if (call.name === 'web_fetch') {
    /**
     * 常量说明：url 用于处理 url 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { url } = call.args
    return typeof url === 'string' && url.trim() !== '' ? call.name : null
  }
  return null
}

interface WebSource {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

/**
 * 功能说明：处理 webSources 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns WebSource[] | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 webSources(value)，并按返回类型处理结果。
 */
function webSources(value: unknown): WebSource[] | null {
  if (!Array.isArray(value)) return null
  /**
   * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sources: WebSource[] = []
  /**
   * 变量说明：source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const source of value) {
    if (typeof source !== 'object' || source === null || Array.isArray(source)) return null
    /**
     * 常量说明：url、title、snippet、publishedAt 用于处理 url、title、snippet、publishedAt
     * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { url, title, snippet, publishedAt } = source as Record<string, unknown>
    if (typeof url !== 'string') return null
    if (title !== undefined && typeof title !== 'string') return null
    if (snippet !== undefined && typeof snippet !== 'string') return null
    if (publishedAt !== undefined && typeof publishedAt !== 'string') return null
    sources.push({
      url,
      ...title === undefined ? {} : { title },
      ...snippet === undefined ? {} : { snippet },
      ...publishedAt === undefined ? {} : { publishedAt },
    })
  }
  return sources
}

/**
 * Derive a settled root web-search or web-fetch card from persisted metadata.
 * @param block - running or settled Tool block.
 * @returns web-card props, or null for the generic path.
 * @remarks 中文说明：功能说明：处理 webCardModel 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：block（ToolCallBlock）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：WebCardModelProps | null；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 webCardModel(block)，并按返回类型处理结果。
 */
export function webCardModel(block: ToolCallBlock): WebCardModelProps | null {
  if (block.parentCallId !== undefined || !('kind' in block) || block.isError) return null
  /**
   * 常量说明：tool 用于处理 tool 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tool = validWebCall(block)
  if (tool === null || typeof block.meta !== 'object' || block.meta === null || Array.isArray(block.meta)) return null
  /**
   * 常量说明：meta 用于处理 meta 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const meta = block.meta as Record<string, unknown>
  if (typeof meta.truncated !== 'boolean') return null
  if (tool === 'web_search') {
    /**
     * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sources = webSources(meta.sources)
    if (sources === null || (meta.answer !== undefined && typeof meta.answer !== 'string')) return null
    return {
      kind: 'search',
      answer: meta.answer,
      sources,
      truncated: meta.truncated,
    }
  }
  if (typeof meta.url !== 'string') return null
  if (typeof meta.statusCode !== 'number' || !Number.isInteger(meta.statusCode)) return null
  return {
    kind: 'fetch',
    url: meta.url,
    statusCode: meta.statusCode,
    truncated: meta.truncated,
  }
}
