/**
 * The ACP profile's command-line and stdin-lifetime provider. A successful
 * parse publishes {@link ACP_APP_STARTUP_SERVICE}; the ACP bridge waits for
 * that service, so help starts no transport.
 * @module @deepseek-ai/dsh-acp-app
 * @remarks 文件说明：文件职责：实现 bundle/acp-app 中 index 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 bundle/acp-app 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { exitOnStdinEnd, parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name.
 * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const name = 'acp-app-startup'

/** Launcher service required before this app can parse its invocation.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject = ['cmdlineArgs']

/** Service the ACP bridge row waits for before claiming stdio.
 * @remarks 中文说明：常量说明：ACP_APP_STARTUP_SERVICE 用于处理 ACP_APP_STARTUP_SERVICE
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const ACP_APP_STARTUP_SERVICE = 'acpAppStartup'

/**
 * Build this app's zero-option command and help.
 * @returns a fresh program for one invocation.
 * @remarks 中文说明：功能说明：处理 acpCommand 相关流程；使用场景由所在模块及调用位置决定。；返回值：Command；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 acpCommand()，并按返回类型处理结果。
 */
function acpCommand(): Command {
  return new Command()
    .name('dsh --profile acp')
    .description('Serve automation clients over Agent Client Protocol stdio.')
    .helpOption('-h, --help', 'show this help')
    .addHelpText('after', `
Example:
  dsh --profile acp     serve ACP until the client disconnects
`)
}

/**
 * Accept an ACP profile invocation, publish readiness, and bind EOF to the
 * launcher's bounded shutdown.
 * @param ctx - plugin context carrying command-line and exit launcher values.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。
 */
export function apply(ctx: Context): void {
  /**
   * 常量说明：program 用于处理 program 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const program = acpCommand()
  program.action(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
      exitOnStdinEnd(ctx, 'acp-app.stdin')
      ctx.provide(ACP_APP_STARTUP_SERVICE, { accepted: true })
    })
  parseCmdline(ctx, program)
}
