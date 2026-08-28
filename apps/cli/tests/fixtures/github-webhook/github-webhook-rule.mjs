/**
 * 文件职责：验证 apps/cli 中 github webhook rule 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import z from '@deepseek-ai/schemastery'
import { WebhookRuleId } from '@deepseek-ai/dsh-webhook'

/**
 * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const name = 'github-webhook-real-e2e-rule'
/**
 * 常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const inject = ['webhookRuntime']

/**
 * 常量说明：Config 用于处理 Config 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const Config = z.object({
  source: z.string().required(),
  repository: z.string().required(),
  workspacePath: z.string().required(),
  marker: z.string().required(),
  agentPreset: z.string().required(),
  permissionPreset: z.string().required(),
})

/**
 * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （由 TypeScript 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；
 * 必须满足声明的类型及调用时序要求。
 * @param config （由 TypeScript 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 apply(ctx, config)，并按返回类型处理结果。
 */
export function apply(ctx, config) {
  ctx.effect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ctx.webhookRuntime.register({
    id: WebhookRuleId('github-real-e2e'),
    kind: 'github',

    /**
     * 功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。
     * @param delivery （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param signal （由 TypeScript 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 run(delivery, signal)，并按返回类型处理结果。
     */
    run(delivery, signal) {
      if (delivery.source !== config.source) return null
      if (delivery.event.name !== 'pull_request') return null
      /**
       * 常量说明：payload 用于处理 payload 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const { payload } = delivery.event
      if (payload.action !== 'ready_for_review') return null
      if (payload.repository?.full_name !== config.repository) return null
      signal.throwIfAborted()

      return {
        workspacePath: config.workspacePath,
        title: 'GitHub webhook real e2e',
        prompt: `Reply with exactly ${config.marker} and no other text. Do not call tools.`,
        agentPreset: config.agentPreset,
        permissionPreset: config.permissionPreset,
      }
    },
  }))
}
