/**
 * 文件职责：验证 session/session-checkpoint-policy 中 crash child 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { writeFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ToolCallId, type GenerateOptions, LlmAdapter, type StreamChunk  } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as checkpointPolicy from '../../src/index.ts'

/**
 * 功能说明：处理 waitForCrash 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<never>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 waitForCrash()，并按返回类型处理结果。
 */
function waitForCrash(): Promise<never> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return new Promise(() => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
setInterval(() => {}, 60_000) })
}

/**
 * 常量说明：mode、root、marker 用于处理 mode、root、marker 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const [mode, root, marker] = process.argv.slice(2)
if ((mode !== 'request' && mode !== 'tool') || root === undefined || marker === undefined) {
  throw new Error('usage: crash-child.ts <request|tool> <persistence-root> <marker>')
}
/**
 * 常量说明：persistenceRoot 用于处理 persistenceRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const persistenceRoot = root
/**
 * 常量说明：failpoint 用于处理 failpoint 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const failpoint = marker

/**
 * 类说明：CrashAdapter 用于集中封装 处理 CrashAdapter 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 session/session-checkpoint-policy 在对应插件或业务生命周期内创建和调用。
 */
class CrashAdapter extends LlmAdapter {
  /**
   * 功能说明：处理 stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param _options （GenerateOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<StreamChunk>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stream(_options)，并按返回类型处理结果。
   */
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (mode === 'request') {
      await writeFile(failpoint, 'request-dispatched')
      await waitForCrash()
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: ToolCallId('crash-call'), name: 'crash_tool', arguments: '{}' },
    }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

/**
 * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ctx = new Context()
await mountAgentLoopTestDependencies(ctx)
await ctx.plugin(AgentLoop, { agents: [] })
await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
await ctx.plugin(checkpointPolicy)
ctx.llm.registerAdapter(['crash'], new CrashAdapter())
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
ctx.tools.register({
  name: 'crash_tool',
  description: 'records an external effect and never returns',
  parameters: {},
  output: { schema: { type: 'null' }, render: () => [] },
  /**
   * 功能说明：执行 execute 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 execute()，并按返回类型处理结果。
   */
  async execute() {
    await writeFile(failpoint, 'tool-side-effect')
    return waitForCrash()
  },
})

/**
 * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const handle = await ctx.agents.create({
  sessionId: SessionId('semantic-checkpoint-crash'),
  agentOptions: { provider: 'crash', model: 'crash' },
})
handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'exercise the crash boundary' }], source: { kind: 'user' } }))
await waitForCrash()
