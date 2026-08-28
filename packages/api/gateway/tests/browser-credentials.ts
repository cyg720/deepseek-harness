/**
 * 文件职责：验证 api/gateway 中 browser credentials 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Context } from '@deepseek-ai/cordis'

/** Provide an in-memory credential-record owner for a mounted Connection plugin.
 * @remarks 中文说明：功能说明：处理 provideBrowserCredentials 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * provideBrowserCredentials(ctx)，并按返回类型处理结果。 */
export function provideBrowserCredentials(ctx: Context): void {
  /**
   * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const records = new Map<unknown, unknown>()
  ctx.provide('credentials', {
    /**
     * 功能说明：处理 modifyRecord 相关流程；使用场景由所在模块及调用位置决定。
     * @param key （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param mutate （(current: unknown) => Promise<unknown>）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。
     * @returns Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 modifyRecord(key, mutate)，并按返回类型处理结果。
     */
    async modifyRecord(
      key: unknown,
      mutate: (current: unknown) => Promise<unknown>,
    ): Promise<unknown> {
      /**
       * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const current = records.get(key)
      /**
       * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const next = await mutate(current)
      if (next !== undefined) records.set(key, next)
      return next ?? current
    },
  } as never)
}
