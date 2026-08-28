/**
 * 文件职责：验证 client/ui-trajectory 中 locale client 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en, zh, type TrajectoryTranslate } from '../src/client/locales.ts'

/**
 * 功能说明：处理 translator 相关流程；使用场景由所在模块及调用位置决定。
 * @param dictionary （Record<string, string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TrajectoryTranslate；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 translator(dictionary)，并按返回类型处理结果。
 */
function translator(dictionary: Record<string, string>): TrajectoryTranslate {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：params（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key, params)，并按返回类型处理结果。
   */
  return (key, params = {}) => {
    /**
     * 常量说明：template 用于处理 template 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const template = dictionary[key] ?? key
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_match（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：name（string）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(_match, name)，并按返回类型处理结果。
     */
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const value = params[name]
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : ''
    })
  }
}

/** English trajectory translator for component and pure-layout tests.
 * @remarks 中文说明：常量说明：t 用于处理 t 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const t = translator({ ...commonEn, ...en })

/** Chinese trajectory translator for real-view fixtures that open in Chinese.
 * @remarks 中文说明：常量说明：tZh 用于处理 tZh 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const tZh = translator({ ...commonZh, ...zh })
