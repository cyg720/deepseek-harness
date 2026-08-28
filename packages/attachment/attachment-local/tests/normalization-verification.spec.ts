/**
 * 文件职责：验证 attachment/attachment-local 中 normalization verification spec
 * 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 常量说明：control 用于处理 control 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const control = vi.hoisted(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ mismatch: false }))

vi.mock('../src/image.ts', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：importOriginal（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(importOriginal)，
 * 并按返回类型处理结果。
 */ async (importOriginal) => {
  /**
   * 常量说明：actual 用于处理 actual 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
    const actual = await importOriginal<typeof import('../src/image.ts')>()
    return {
      ...actual,
      /**
     * 功能说明：处理 detectImage 相关流程；使用场景由所在模块及调用位置决定。
     * @param data （Uint8Array）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<Awaited<ReturnType<typeof actual.detectImage>>>；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 detectImage(data)，并按返回类型处理结果。
     */
      async detectImage(data: Uint8Array): Promise<Awaited<ReturnType<typeof actual.detectImage>>> {
      /**
       * 常量说明：detected 用于处理 detected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const detected = await actual.detectImage(data)
        return control.mismatch ? { ...detected, width: detected.width + 1 } : detected
      },
    }
  })

import { normalizeImage } from '../src/normalization.ts'
import { detectImage } from '../src/image.ts'

afterEach(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    control.mismatch = false
  })

describe('normalization verification', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('rejects a normalized output whose decoded facts disagree with the encoder result', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const data = new Uint8Array(await sharp({
          create: { width: 10, height: 6, channels: 3, background: { r: 12, g: 200, b: 64 } },
        }).png().toBuffer())
        /**
     * 常量说明：detected 用于处理 detected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const detected = await detectImage(data)
        control.mismatch = true

        await expect(normalizeImage(data, detected, { maxPixels: 2048 * 2048, maxDimension: 5, maxBytes: 4 * 1024 * 1024 }))
          .rejects.toMatchObject({
            code: 'ATTACHMENT_WRITE_FAILED',
            message: 'Image normalization did not produce a single-frame 8-bit sRGB image with matching metadata.',
          })
      })
  })
