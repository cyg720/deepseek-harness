/**
 * 文件职责：验证 llm/llm-deepseek 中 request pricing spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import { offloadedImageText, requestImageHandleText, textOnlyImageText } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { deepSeekImageRequestPricing } from '../src/request-pricing.ts'
import { resolveAdapterOptions } from '../src/index.ts'
import type { Config } from '../src/index.ts'

/**
 * 常量说明：VISION_MODEL 用于处理 VISION_MODEL 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const VISION_MODEL = {
  id: 'vision',
  inputModalities: ['text', 'image'] as Array<'text' | 'image'>,
}

/**
 * 功能说明：处理 ref 相关流程；使用场景由所在模块及调用位置决定。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param width （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param height （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param bytes （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ImageAttachmentRef；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 ref(name, width, height, bytes)，并按返回类型处理结果。
 */
function ref(name: string, width: number, height: number, bytes = 1024): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${name.padEnd(8, '0')}`),
    mediaType: 'image/png',
    bytes,
    width,
    height,
    name,
  }
}

/**
 * 功能说明：处理 connection 相关流程；使用场景由所在模块及调用位置决定。
 * @param config （Omit<Config, 'models'>）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns ReturnType<typeof resolveAdapterOptions>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 connection(config)，并按返回类型处理结果。
 */
function connection(config: Omit<Config, 'models'> = {}): ReturnType<typeof resolveAdapterOptions> {
  return resolveAdapterOptions(Object.assign({ models: [VISION_MODEL] }, config))
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('DeepSeek request-image pricing', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('prices an uncatalogued model as its text-only substitution', () => {
    /**
     * 常量说明：image 用于处理 image 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const image = ref('photo', 1920, 1080)
    /**
     * 常量说明：prices 用于处理 prices 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prices = deepSeekImageRequestPricing(connection(), 'unlisted').priceImages([image])
    expect(prices).toEqual([{ visualTokens: 0, text: textOnlyImageText(image) }])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('prices a catalogued text-only model as its text-only substitution', () => {
    /**
     * 常量说明：image 用于处理 image 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const image = ref('photo', 1920, 1080)
    /**
     * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const options = resolveAdapterOptions({ models: [{ id: 'text-only' }] })
    /**
     * 常量说明：prices 用于处理 prices 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prices = deepSeekImageRequestPricing(options, 'text-only').priceImages([image])
    expect(prices).toEqual([{ visualTokens: 0, text: textOnlyImageText(image) }])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('prices a retained image by its projected request dimensions plus its handle text', () => {
    /**
     * 常量说明：image 用于处理 image 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const image = ref('photo', 1920, 1080)
    /**
     * 常量说明：prices 用于处理 prices 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prices = deepSeekImageRequestPricing(connection(), 'vision').priceImages([image])
    expect(prices).toEqual([{
      visualTokens: 369,
      text: requestImageHandleText(image, { width: 1066, height: 600 }),
    }])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('honors the low-detail pixel budget preset', () => {
    /**
     * 常量说明：image 用于处理 image 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const image = ref('photo', 4096, 4096)
    /**
     * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const options = resolveAdapterOptions({
      models: [{ ...VISION_MODEL, imagePixelBudget: 'low' as const }],
    })
    /**
     * 常量说明：prices 用于处理 prices 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prices = deepSeekImageRequestPricing(options, 'vision').priceImages([image])
    expect(prices[0]!.visualTokens).toBe(201)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('builds handle and placeholder text through the supplied access resolution', () => {
    /**
     * 常量说明：access 用于处理 access 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const access = { readonlyPath: '/world/attachments/photo.png' }
    /**
     * 常量说明：images 用于处理 images 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const images = [ref('first', 800, 800), ref('second', 800, 800)]
    /**
     * 常量说明：prices 用于处理 prices 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const prices = deepSeekImageRequestPricing(
      connection({ maxImagesPerRequest: 1, imageOffloadCountQuantum: 1 }),
      'vision',
      () => access,
    ).priceImages(images)
    expect(prices[0]).toEqual({ visualTokens: 0, text: offloadedImageText(images[0]!, access) })
    expect(prices[1]).toEqual({
      visualTokens: 349,
      text: requestImageHandleText(images[1]!, { width: 800, height: 800 }, access),
    })
    expect(prices[1]?.text).toContain('/world/attachments/photo.png')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('prices count-offloaded oldest occurrences as their placeholder text', () => {
    /**
     * 常量说明：images 用于处理 images 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const images = [ref('first', 800, 800), ref('second', 800, 800), ref('third', 800, 800)]
    /**
     * 常量说明：prices 用于处理 prices 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prices = deepSeekImageRequestPricing(
      connection({ maxImagesPerRequest: 2, imageOffloadCountQuantum: 1 }),
      'vision',
    ).priceImages(images)
    expect(prices).toEqual([
      { visualTokens: 0, text: offloadedImageText(images[0]!) },
      { visualTokens: 349, text: requestImageHandleText(images[1]!, { width: 800, height: 800 }) },
      { visualTokens: 349, text: requestImageHandleText(images[2]!, { width: 800, height: 800 }) },
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('caps each occurrence at the per-image byte target before the byte budget', () => {
    // Each 5 MiB source counts as the 1 MiB request target, so a 2 MiB budget
    // with a one-byte quantum removes exactly the oldest occurrence.
    /**
     * 常量说明：oversized 用于处理 oversized 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const oversized = 5 * 1024 * 1024
    /**
     * 常量说明：images 用于处理 images 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const images = [
      ref('first', 800, 800, oversized),
      ref('second', 800, 800, oversized),
      ref('third', 800, 800, oversized),
    ]
    /**
     * 常量说明：prices 用于处理 prices 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prices = deepSeekImageRequestPricing(
      connection({ maxRequestFilesBytes: 2 * 1024 * 1024, imageOffloadByteQuantum: 1 }),
      'vision',
    ).priceImages(images)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：price（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(price)，并按返回类型处理结果。
     */
    expect(prices.map(price => price.visualTokens)).toEqual([0, 349, 349])
    expect(prices[0]!.text).toBe(offloadedImageText(images[0]!))
  })
})
