/*
 * 【文件职责】按实际模型路由投影后的图片和文件表示计算表面 token，替代附件原始块的启发式价格。
 */

import type { ContentBlock, LlmImageRequestPricing } from '@deepseek-ai/dsh-llm'
import { estimateContent } from './estimate.ts'
import type { MeterSurfaceNode } from './surface-fold.ts'
import type { TokenSurfaceNode } from './types.ts'

type FileAttachmentRef = Extract<ContentBlock, { type: 'file' }>['attachment']

/** One surface priced for a request route: public nodes plus their total. */
export interface PricedSurface {
  /** Positional nodes carrying both the route price and the fixed-heuristic price. */
  readonly nodes: TokenSurfaceNode[]
  /** Sum of the route prices across the surface. */
  readonly surfaceTokens: number
}

/**
 * Price one ordered surface under its model-request attachment projection.
 * @param nodes - the fold's current or snapshotted surface, in model-visible order.
 * @param pricing - the routed model's image pricing, or undefined to keep the fixed heuristic.
 * @param fileText - exact file handle projection used by the mounted LLM service.
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
  fileText?: (ref: FileAttachmentRef) => string,
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
  const hasFiles = fileText !== undefined && nodes.some(node => node.files.length > 0)
  if ((pricing === undefined || images.length === 0) && !hasFiles) {
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
  const prices = pricing === undefined ? [] : pricing.priceImages(images)
  if (pricing !== undefined && prices.length !== images.length) {
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
    if (fileText !== undefined && node.files.length > 0) {
      tokens -= node.fileStructuralTokens
      for (const file of node.files) {
        tokens += estimateContent([{ type: 'text', text: fileText(file) }])
      }
    }
    if (pricing !== undefined && node.images.length > 0) {
      tokens -= node.imageStructuralTokens
      for (let occurrence = 0; occurrence < node.images.length; occurrence += 1) {
        /**
         * 常量说明：price 用于处理 price 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        // oxlint-disable-next-line typescript/no-non-null-assertion -- length equality is asserted above
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
