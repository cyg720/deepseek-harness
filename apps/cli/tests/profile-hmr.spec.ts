/** Module-HMR ownership across the real shipped profile bundle layers.
 * @remarks 文件说明：文件职责：验证 apps/cli 中 profile hmr spec 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

/**
 * 常量说明：REPOSITORY_ROOT 用于处理 REPOSITORY_ROOT 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Load one shipped bundle patch through the same parser as profile boot.
 * @remarks 中文说明：功能说明：处理 bundle 相关流程；使用场景由所在模块及调用位置决定。；参数说明：name（'acp-app'
 * | 'base' | 'headless' | 'sdk-app' | 'sdk-minimal'…）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：PatchOptions[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 bundle(name)，并按返回类型处理结果。 */
function bundle(name: 'acp-app' | 'base' | 'headless' | 'sdk-app' | 'sdk-minimal' | 'web-app'): PatchOptions[] {
  return loadOverlayPatches('profile-hmr test', join(REPOSITORY_ROOT, 'packages', 'bundle', name, 'cordis.patch.yml'))
}

/** Resolve the effective HMR row after the supplied layers.
 * @remarks 中文说明：功能说明：处理 hmr 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：layers（PatchOptions[][]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * hmr(layers)，并按返回类型处理结果。 */
function hmr(layers: PatchOptions[][]) {
  /**
   * 常量说明：row 用于处理 row 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const row = composeEntries(layers).find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.id === 'hmr')
  if (row === undefined) throw new Error('the base bundle must insert the hmr row')
  return row
}

describe('profile module-HMR policy', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it.each(['web-app', 'headless', 'sdk-app', 'acp-app'] as const)(
      '%s inherits the disabled base row without a mode override',
      /*
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mode（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mode)，并按返回类型处理结果。
     */ (mode) => {
      /**
       * 常量说明：modePatches 用于处理 modePatches 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
        const modePatches = bundle(mode)
        expect(modePatches.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：patch（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(patch)，并按返回类型处理结果。
 */ patch => patch.id === 'hmr')).toBe(false)
        expect(hmr([bundle('base'), modePatches])).toMatchObject({
          disabled: true,
          config: { root: ['.'] },
        })
      },
    )

    it('requires an explicit later layer to enable source-module reload', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        expect(hmr([bundle('base'), [{ id: 'hmr', disabled: false }]])).toMatchObject({
          disabled: false,
          config: { root: ['.'] },
        })
      })

    it('keeps the standalone sdk-minimal tree free of module HMR', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        expect(composeEntries([bundle('sdk-minimal')]).find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */ entry => entry.id === 'hmr')).toBeUndefined()
      })
  })
