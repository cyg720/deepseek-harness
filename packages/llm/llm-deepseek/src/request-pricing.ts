/**
 * Provider-side request-image pricing for DeepSeek routes: reproduces the
 * adapter's deterministic request projection (per-model pixel budget,
 * oldest-first offload under the raw-byte and count budgets) and prices every
 * retained image with the published v4 vision-token accounting. Consumed
 * synchronously by the token meter through `LlmAdapter.imageRequestPricing`;
 * provider usage remains the authoritative anchor for completed requests.
 *
 * @module dsh-llm-deepseek/request-pricing
 * @remarks 文件说明：文件职责：实现 llm/llm-deepseek 中 request pricing 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 llm/llm-deepseek
 * 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { offloadedImageText, offloadedImagePrefixCount, requestImageHandleText, textOnlyImageText } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentAccessResolver, LlmImageRequestPrice, LlmImageRequestPricing } from '@deepseek-ai/dsh-llm'
import { requestImageDimensions } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageRequestPolicy } from '@deepseek-ai/dsh-attachment'
import { deepSeekImageTokens } from './image-tokens.ts'
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions } from './adapter.ts'

/** Default bound on accumulated file-referenced image bytes per request.
 * @remarks 中文说明：常量说明：DEFAULT_MAX_REQUEST_FILES_BYTES 用于处理
 * DEFAULT_MAX_REQUEST_FILES_BYTES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const DEFAULT_MAX_REQUEST_FILES_BYTES = 128 * 1024 * 1024
/** Provider request image-count limit.
 * @remarks 中文说明：常量说明：DEFAULT_MAX_IMAGES_PER_REQUEST 用于处理
 * DEFAULT_MAX_IMAGES_PER_REQUEST 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const DEFAULT_MAX_IMAGES_PER_REQUEST = 600
/** Total-pixel budget matching DeepSeek's normal vision projection.
 * @remarks 中文说明：常量说明：DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET 用于处理
 * DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 640_000
/** Total-pixel budget matching provider low-detail image input.
 * @remarks 中文说明：常量说明：DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET 用于处理
 * DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET = 512 * 512
/** Encoded-byte target for one deterministic model-request image; the smallest quality-ladder output is used when no quality fits.
 * @remarks 中文说明：常量说明：DEFAULT_REQUEST_IMAGE_MAX_BYTES 用于处理
 * DEFAULT_REQUEST_IMAGE_MAX_BYTES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

/**
 * Resolve the request-image budgets owned by one DeepSeek model route.
 * @param model - Advertised model route and its optional image overrides.
 * @returns Complete pixel and encoded-byte budgets.
 * @internal
 * @remarks 中文说明：功能说明：解析 Request Image Policy 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：model（DeepSeekCatalogModel）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ImageRequestPolicy；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * resolveRequestImagePolicy(model)，并按返回类型处理结果。
 */
export function resolveRequestImagePolicy(model: DeepSeekCatalogModel): ImageRequestPolicy {
  /**
   * 常量说明：maxPixels 用于处理 maxPixels 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const maxPixels = model.imagePixelBudget === 'low'
    ? DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET
    : model.imagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET
  return {
    maxPixels,
    maxBytes: model.imageMaxBytes === undefined
      ? DEFAULT_REQUEST_IMAGE_MAX_BYTES
      : model.imageMaxBytes,
  }
}

/**
 * Price one occurrence a text-only route substitutes with deterministic text,
 * reproducing the `projectImagesForTextModel` substitution `LlmRuntime`
 * applies before dispatching to a route without the `image` modality.
 * @remarks 中文说明：功能说明：处理 textOnlyPrice 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ref（ImageAttachmentRef）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：LlmImageRequestPrice；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * textOnlyPrice(ref)，并按返回类型处理结果。
 */
function textOnlyPrice(ref: ImageAttachmentRef): LlmImageRequestPrice {
  return { visualTokens: 0, text: textOnlyImageText(ref) }
}

/**
 * Build the request-image pricing for one DeepSeek route from a validated
 * connection snapshot. Uncatalogued and text-only models price every
 * occurrence as its deterministic text substitution; image-capable models
 * reproduce the adapter's first-stage oldest-first offload from durable byte
 * lengths and price retained images by their projected request dimensions,
 * with each occurrence's handle or placeholder text built through the same
 * access resolution the serializer uses. The base64 fallback's tighter inline
 * budget is not reproduced, so a fallback request can only cost less than
 * this estimate; access paths resolve at pricing time, so a path that changes
 * before the request only shifts the text price by its own length.
 * @param connection - validated connection facts of the pricing resolution.
 * @param model - exact model id named by the request header.
 * @param resolveAccess - current execution-world access resolution shared with request serialization.
 * @returns synchronous per-occurrence pricing for the route.
 * @remarks 中文说明：功能说明：处理 deepSeekImageRequestPricing 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：connection（DeepSeekConnectionOptions）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：model（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：resolveAccess（ImageAttachmentAccessResolver）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：LlmImageRequestPricing；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 deepSeekImageRequestPricing(connection, model,
 * resolveAccess)，并按返回类型处理结果。
 */
export function deepSeekImageRequestPricing(
  connection: DeepSeekConnectionOptions,
  model: string,
  resolveAccess?: ImageAttachmentAccessResolver,
): LlmImageRequestPricing {
  /**
   * 常量说明：catalogModel 用于处理 catalogModel 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  const catalogModel = connection.models.find(entry => entry.id === model)
  if (catalogModel?.inputModalities?.includes('image') !== true) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：images（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(images)，并按返回类型处理结果。
     */
    return { priceImages: images => images.map(textOnlyPrice) }
  }
  /**
   * 常量说明：policy 用于处理 policy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const policy = resolveRequestImagePolicy(catalogModel)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：images（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(images)，并按返回类型处理结果。
   */
  return {
    priceImages: (images) => {
      /**
       * 常量说明：offloaded 用于处理 offloaded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ref（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ref)，并按返回类型处理结果。
       */
      const offloaded = offloadedImagePrefixCount(
        images.map(ref => Math.min(ref.bytes, policy.maxBytes)),
        {
          maxBytes: connection.maxRequestFilesBytes,
          maxImages: connection.maxImagesPerRequest,
          byteQuantum: connection.imageOffloadByteQuantum,
          countQuantum: connection.imageOffloadCountQuantum,
        },
      )
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ref（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ref, index)，并按返回类型处理结果。
       */
      return images.map((ref, index) => {
        if (index < offloaded) {
          return { visualTokens: 0, text: offloadedImageText(ref, resolveAccess?.(ref)) }
        }
        /**
         * 常量说明：dimensions 用于处理 dimensions 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const dimensions = requestImageDimensions(ref.width, ref.height, policy.maxPixels)
        return {
          visualTokens: deepSeekImageTokens(dimensions.width, dimensions.height),
          text: requestImageHandleText(ref, dimensions, resolveAccess?.(ref)),
        }
      })
    },
  }
}
