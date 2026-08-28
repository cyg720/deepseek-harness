/**
 * Route-aware surface pricing: projects the fold's fixed-heuristic nodes onto
 * the routed model's request, replacing every image occurrence's structural
 * price with the route's declared visual tokens plus the model-visible text it
 * actually sends. Without declared pricing every node keeps its fixed
 * heuristic price, so provider-neutral behavior is unchanged.
 *
 * @module @deepseek-ai/dsh-token-meter/route-pricing
 * @remarks 文件说明：文件职责：实现 llm/token-meter 中 route pricing 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 llm/token-meter
 * 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import type { LlmImageRequestPricing } from '@deepseek-ai/dsh-llm'
import { estimateContent } from './estimate.ts'
import type { MeterSurfaceNode } from './surface-fold.ts'
import type { TokenSurfaceNode } from './types.ts'

/** One surface priced for a request route: public nodes plus their total. */
export interface PricedSurface {
  /** Positional nodes carrying both the route price and the fixed-heuristic price. */
  readonly nodes: TokenSurfaceNode[]
  /** Sum of the route prices across the surface. */
  readonly surfaceTokens: number
}

/**
 * Price one ordered surface under a route's request-image pricing.
 * @param nodes - the fold's current or snapshotted surface, in model-visible order.
 * @param pricing - the routed model's image pricing, or undefined to keep the fixed heuristic.
 * @returns detached public nodes and their route-priced total.
 * @throws when the pricing answers a different occurrence count than it was
 *   asked — misalignment would silently misprice nodes, so it must fail loud.
 * @remarks 中文说明：功能说明：处理 priceSurface 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：nodes（readonly MeterSurfaceNode[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：pricing（LlmImageRequestPricing | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：PricedSurface；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 priceSurface(nodes, pricing)，并按返回类型处理结果。
 */
export function priceSurface(
  nodes: readonly MeterSurfaceNode[],
  pricing: LlmImageRequestPricing | undefined,
): PricedSurface {
  /**
   * 常量说明：images 用于处理 images 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
   */
  const images = pricing === undefined ? [] : nodes.flatMap(node => node.images)
  if (pricing === undefined || images.length === 0) {
    /**
     * 变量说明：surfaceTokens 用于处理 surfaceTokens 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let surfaceTokens = 0
    /**
     * 常量说明：publicNodes 用于处理 publicNodes 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    const publicNodes = nodes.map((node) => {
      surfaceTokens += node.heuristicTokens
      return { seq: node.seq, tokens: node.heuristicTokens, heuristicTokens: node.heuristicTokens }
    })
    return { nodes: publicNodes, surfaceTokens }
  }
  /**
   * 常量说明：prices 用于处理 prices 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const prices = pricing.priceImages(images)
  if (prices.length !== images.length) {
    throw new Error(
      `token meter: route image pricing answered ${prices.length} prices for ${images.length} occurrences`,
    )
  }
  /**
   * 变量说明：cursor 用于处理 cursor 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let cursor = 0
  /**
   * 变量说明：surfaceTokens 用于处理 surfaceTokens 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let surfaceTokens = 0
  /**
   * 常量说明：publicNodes 用于处理 publicNodes 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
   */
  const publicNodes = nodes.map((node) => {
    /**
     * 变量说明：tokens 用于处理 tokens 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let tokens = node.heuristicTokens
    if (node.images.length > 0) {
      tokens = node.imageFreeTokens
      /**
       * 变量说明：occurrence 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (let occurrence = 0; occurrence < node.images.length; occurrence += 1) {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- length equality is asserted above
        /**
         * 常量说明：price 用于处理 price 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const price = prices[cursor]!
        cursor += 1
        tokens += price.visualTokens + estimateContent([{ type: 'text', text: price.text }])
      }
    }
    surfaceTokens += tokens
    return { seq: node.seq, tokens, heuristicTokens: node.heuristicTokens }
  })
  return { nodes: publicNodes, surfaceTokens }
}
