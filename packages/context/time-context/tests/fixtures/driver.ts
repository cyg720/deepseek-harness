#!/usr/bin/env node
/** Test driver that sends two turns through one Headless Loader composition.
 * @remarks 文件说明：文件职责：验证 context/time-context 中 driver 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'

/**
 * 常量说明：configPath 用于处理 configPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const configPath = process.argv[2]
if (configPath === undefined) throw new Error('time-context driver requires a config path')

/**
 * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ctx = await boot('time-context-e2e', resolveConfigPath(configPath, undefined))
try {
  await runFixtureTurn(ctx, { task: 'first' })
  await runFixtureTurn(ctx, { task: 'second' })
} finally {
  await ctx.fiber.dispose()
}
