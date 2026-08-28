#!/usr/bin/env node
/**
 * Test driver: start a mock OTLP/HTTP collector, boot the telemetry Loader
 * composition against it, run one turn whose prompt carries a fixture
 * credential, then persist everything the collector captured to
 * `./otlp-captures.json` for the e2e's inspect step.
 * @remarks 文件说明：文件职责：验证 session/session-telemetry-otel 中 driver 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { recordFeedback } from '@deepseek-ai/dsh-command-feedback'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'

/**
 * 常量说明：configPath 用于处理 configPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const configPath = process.argv[2]
if (configPath === undefined) throw new Error('session-telemetry-otel driver requires a config path')

/**
 * 常量说明：captures 用于处理 captures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const captures: unknown[] = []
/**
 * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：response（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, response)，
 * 并按返回类型处理结果。
 */
const server = createServer((request, response) => {
  /**
   * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chunks: Buffer[] = []
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
   */
  request.on('data', chunk => chunks.push(chunk as Buffer))
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  request.on('end', () => {
    captures.push(JSON.parse(Buffer.concat(chunks).toString()))
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
  })
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
/**
 * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('collector has no port')
process.env.DSH_TELEMETRY_E2E_URL = `http://127.0.0.1:${address.port}/v1/logs`

/**
 * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ctx = await boot('telemetry-otel-e2e', resolveConfigPath(configPath, undefined))
try {
  // The fixture credential rides the model-visible user message; the exported
  // copy must scrub it while the canonical log keeps the original bytes.
  await runFixtureTurn(ctx, { task: 'prove telemetry with key sk-e2efixture1234567890' })
  /**
   * 常量说明：mode 用于处理 mode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const mode = process.env.DSH_TELEMETRY_E2E_MODE ?? 'FULL'
  if (mode !== 'FULL') {
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const [agent] = ctx.get('agents')?.roots() ?? []
    if (agent === undefined) throw new Error('session-telemetry-otel driver requires one root agent')
    recordFeedback(agent.session, 'fixture feedback')
    if (mode === 'FEEDBACK_ONLY') {
      await runFixtureTurn(ctx, { task: 'post-feedback private suffix' })
    }
  }
} finally {
  await ctx.fiber.dispose()
}
await writeFile('./otlp-captures.json', JSON.stringify(captures))
server.close()
server.closeAllConnections()
