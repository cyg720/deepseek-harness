/**
 * The SDK profile's command-line and stdin-lifetime provider. A successful
 * parse publishes {@link SDK_APP_STARTUP_SERVICE}; the JSON-RPC server waits
 * for that service, so help starts no transport.
 * @module @deepseek-ai/dsh-sdk-app
 * @remarks 文件说明：文件职责：实现 bundle/sdk-app 中 index 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 bundle/sdk-app 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { exitOnStdinEnd, parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name.
 * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const name = 'sdk-app-startup'

/** Launcher service required before this app can parse its invocation.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject = ['cmdlineArgs']

/** Service the JSON-RPC server row waits for before claiming stdio.
 * @remarks 中文说明：常量说明：SDK_APP_STARTUP_SERVICE 用于处理 SDK_APP_STARTUP_SERVICE
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const SDK_APP_STARTUP_SERVICE = 'sdkAppStartup'

/** SDK stdio startup configuration. */
export interface Config {
  /** Profile name rendered in help and diagnostics (default `sdk`). */
  profile?: string
}

/** Validate and default SDK stdio startup configuration.
 * @remarks 中文说明：常量说明：Config 用于处理 Config 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const Config: z<Config> = z.object({
  profile: z.string().default('sdk'),
})

/**
 * Build this app's zero-option command and help.
 * @param profile - selected profile name rendered in the command grammar.
 * @returns a fresh program for one invocation.
 * @remarks 中文说明：功能说明：处理 sdkCommand 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：profile（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：Command；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 sdkCommand(profile)，
 * 并按返回类型处理结果。
 */
function sdkCommand(profile: string): Command {
  return new Command()
    .name(`dsh --profile ${profile}`)
    .description('Serve DeepSeek Harness SDK clients over stdio JSON-RPC.')
    .helpOption('-h, --help', 'show this help')
    .addHelpText('after', `
Example:
  dsh --profile ${profile}     serve one SDK runtime until its client disconnects
`)
}

/**
 * Accept an SDK profile invocation, publish readiness, and bind EOF to the
 * launcher's bounded shutdown.
 * @param ctx - plugin context carrying command-line and exit launcher values.
 * @param config - selected profile identity for command help.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：config（Config）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx, config)，并按返回类型处理结果。
 */
export function apply(ctx: Context, config: Config = {}): void {
  /**
   * 常量说明：program 用于处理 program 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const program = sdkCommand(config.profile ?? 'sdk')
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  program.action(() => {
    exitOnStdinEnd(ctx, 'sdk-app.stdin')
    ctx.provide(SDK_APP_STARTUP_SERVICE, { accepted: true })
  })
  parseCmdline(ctx, program)
}
