#!/usr/bin/env node
/** Inspect the public Codex provider composition without invoking the product.
 * @remarks 文件说明：文件职责：验证 subagent/subagent-codex 中 driver 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { boot, loadOverlayPatches, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'

/**
 * 常量说明：configPath 用于处理 configPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const configPath = process.argv[2]
/**
 * 常量说明：bundlePatchPath 用于处理 bundlePatchPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const bundlePatchPath = process.argv[3]
if (configPath === undefined || bundlePatchPath === undefined) {
  throw new Error('subagent-codex Loader composition driver requires config and Bundle patch paths')
}

/**
 * 变量说明：starts 用于处理 starts 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let starts = 0
/**
 * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：hostCtx（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(hostCtx)，并按返回类型处理结果。
 */
const ctx = await boot(
  'subagent-codex-loader-composition',
  resolveConfigPath(configPath, undefined),
  loadOverlayPatches('subagent-codex-loader-composition', bundlePatchPath),
  (hostCtx) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    hostCtx.on('subagent/start', () => {
      starts += 1
    })
  },
)

try {
  /**
   * 常量说明：providerNames 用于处理 providerNames 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const providerNames = ['codex', 'codex-primary', 'codex-secondary'] as const
  /**
   * 常量说明：toolNames 用于处理 toolNames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const toolNames = [
    'subagent_codex',
    'subagent_codex_primary',
    'subagent_codex_secondary',
  ] as const
  /**
   * 常量说明：providers 用于处理 providers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：providerName（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(providerName)，并按返回类型处理结果。
   */
  const providers = providerNames.map((providerName) => {
    /**
     * 常量说明：provider 用于处理 provider 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const provider = ctx.subagents.getProvider(providerName)
    if (provider === undefined) {
      throw new Error(`${providerName} provider was not registered`)
    }
    return {
      name: provider.name,
      capabilities: provider.capabilities,
      inheritsParentContext: provider.inheritsParentContext,
    }
  })
  /**
   * 常量说明：tools 用于处理 tools 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：toolName（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(toolName)，并按返回类型处理结果。
   */
  const tools = toolNames.map((toolName) => {
    /**
     * 常量说明：tool 用于处理 tool 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：schema（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(schema)，并按返回类型处理结果。
     */
    const tool = ctx.tools.schemas().find(schema => schema.name === toolName)
    if (tool === undefined) throw new Error(`${toolName} tool was not registered`)
    /**
     * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const properties = tool.parameters.properties
    if (
      typeof properties !== 'object'
      || properties === null
      || Array.isArray(properties)
    ) {
      throw new Error(`${toolName} has invalid parameter properties`)
    }
    return {
      name: tool.name,
      parameterNames: Object.keys(properties).sort(),
      required: tool.parameters.required,
    }
  })
  /**
   * 常量说明：jobTools 用于处理 jobTools 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：schema（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(schema)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
   */
  const jobTools = ctx.tools.schemas()
    .map(schema => schema.name)
    .filter(name => name === 'job_kill' || name === 'job_list' || name === 'job_output')
    .sort()

  process.stdout.write(`${JSON.stringify({
    providers: ctx.subagents.list(),
    providerDetails: providers,
    tools,
    jobTools,
    starts,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
