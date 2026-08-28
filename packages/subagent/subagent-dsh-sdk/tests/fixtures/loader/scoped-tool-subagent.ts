/** Mount the SDK delegation tool in each fixture Agent's scope.
 * @remarks 文件说明：文件职责：验证 subagent/subagent-dsh-sdk 中 scoped tool subagent
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import type { Config } from '@deepseek-ai/dsh-tool-subagent'

/**
 * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const name = 'scoped-tool-subagent'
/**
 * 常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const inject = ['agents', 'subagentModelSelection']

/**
 * Install the configured delegation tool before a published Agent starts its loop.
 * @param ctx - fixture Host context carrying Agent lifecycle events.
 * @param config - delegation-tool configuration forwarded into each Agent scope.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：config（Config）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx, config)，并按返回类型处理结果。
 */
export function apply(ctx: Context, config: Config): void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ agent }（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ agent })，并按返回类型处理结果。
   */
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.plugin(ToolSubagent, {
      provider: config.provider,
      modelSelectionSettings: true,
      ...(config.toolName === undefined ? {} : { toolName: config.toolName }),
      ...(config.enableRunInBackground === undefined
        ? {}
        : { enableRunInBackground: config.enableRunInBackground }),
      ...(config.backgroundMode === undefined ? {} : { backgroundMode: config.backgroundMode }),
      ...(config.agentOptions === undefined ? {} : { agentOptions: config.agentOptions }),
      ...(config.persona === undefined ? {} : { persona: config.persona }),
      ...(config.toolFilter === undefined ? {} : { toolFilter: config.toolFilter }),
      ...(config.maxDepth === undefined ? {} : { maxDepth: config.maxDepth }),
    })
  })
}
