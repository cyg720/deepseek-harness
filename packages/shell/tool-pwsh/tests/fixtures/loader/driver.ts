#!/usr/bin/env node
/**
 * Test driver: boot the tool-pwsh Loader composition, execute one real
 * foreground and one real background pwsh command through the tool registry,
 * and persist the observed model-visible output to `./pwsh-loader-report.json`
 * for the package spec's inspect step.
 * @remarks 文件说明：文件职责：验证 shell/tool-pwsh 中 driver 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { writeFile } from 'node:fs/promises'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

/**
 * 常量说明：configPath 用于处理 configPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const configPath = process.argv[2]
if (configPath === undefined) throw new Error('tool-pwsh driver requires a config path')

/**
 * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ctx = await boot('tool-pwsh-loader-smoke', resolveConfigPath(configPath, undefined))
try {
  /**
   * 常量说明：schema 用于处理 schema 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：tool（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(tool)，并按返回类型处理结果。
   */
  const schema = ctx.tools.schemas().find(tool => tool.name === 'pwsh')
  if (schema === undefined) throw new Error('pwsh tool not registered by the composition')
  /**
   * 常量说明：prompt 用于处理 prompt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：section（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(section)，并按返回类型处理结果。
   */
  const prompt = (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:pwsh')

  /**
   * 常量说明：foreground 用于处理 foreground 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const foreground = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('loader-fg'),
    name: 'pwsh',
    arguments: { command: 'Write-Output loader-ok', description: 'loader foreground' },
  })
  /**
   * 常量说明：foregroundText 用于处理 foregroundText 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  const foregroundText = foreground.content.filter(block => block.type === 'text').map(block => block.text).join('')

  /**
   * 常量说明：background 用于处理 background 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const background = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('loader-bg'),
    name: 'pwsh',
    arguments: {
      command: 'Start-Sleep -Milliseconds 200; Write-Output loader-bg-ok',
      description: 'loader background',
      run_in_background: true,
    },
  })
  /**
   * 常量说明：jobId 用于处理 jobId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const jobId = (background.value as { jobId: string }).jobId

  // The output delta and the terminal status can land in separate reads
  // (Windows flushes the child pipe at exit), so accumulate both.
  /**
   * 变量说明：backgroundText 用于处理 backgroundText 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let backgroundText = ''
  /**
   * 常量说明：deadline 用于处理 deadline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    /**
     * 常量说明：read 用于读取 read 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const read = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('loader-bg-read'),
      name: 'job_output',
      arguments: { job_id: jobId },
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
     */
    backgroundText += read.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (backgroundText.includes('loader-bg-ok') && backgroundText.includes('[status: completed')) break
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  await writeFile('./pwsh-loader-report.json', JSON.stringify({
    schemaHasRunInBackground: Object.hasOwn(schema.parameters.properties as object, 'run_in_background'),
    promptHasMarkerSection: prompt?.text.includes('Non-zero exits are reported as `[exit code: N]` markers') === true,
    // Normalize PowerShell's platform line endings (CRLF on Windows, LF elsewhere).
    foregroundText: foregroundText.replace(/\r\n/g, '\n'),
    backgroundText: backgroundText.replace(/\r\n/g, '\n'),
  }))
} finally {
  await ctx.fiber.dispose()
}
