/**
 * 文件职责：验证 test-support/session-snapshot 中 workspace context compaction
 * 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'

/**
 * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const name = 'workspace-context-compaction'

/** Replace the visible workspace baseline after the first touch is fully projected.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。 */
export function apply(ctx: Context): void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：exec（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：result（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：next（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(exec, result, next)，
   * 并按返回类型处理结果。
   */
  ctx.on('tools/post-execute', async (exec, result, next) => {
    /**
     * 常量说明：downstream 用于处理 downstream 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const downstream = await next()
    if (result.isError
      || exec.agent === undefined
      || exec.name !== 'read'
      || typeof exec.arguments !== 'object'
      || exec.arguments === null
      || !('file_path' in exec.arguments)
      || exec.arguments.file_path !== 'nested/task.txt') return downstream
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = exec.agent
    /**
     * 常量说明：baseline 用于处理 baseline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：seq（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(seq)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const baseline = agent.session.surface.nodes
      .map(seq => agent.session.snapshotEvents()[seq])
      .find(event => event?.type === 'user/message'
        && event.data.source.kind === 'agent-instructions'
        && event.data.source.baseline === true)
    if (baseline === undefined) throw new Error('workspace baseline missing before snapshot compaction')
    const openTurn = agent.session.snapshotEvents().findLast(event => event.type === 'turn/start')
    if (openTurn?.type !== 'turn/start') throw new Error('workspace snapshot compaction has no open turn')
    const compactionId = CompactionId('workspace-context-fixture')
    const content = [{ type: 'text' as const, text: 'Earlier context was compacted for this snapshot.' }]
    agent.session.append('compaction/start', { compactionId, turn: openTurn.data.turn })
    agent.session.append('compaction/summary', {
      compactionId,
      summary: content,
      shadowedRange: { start: baseline.seq, end: baseline.seq },
      shadowedSeqs: [baseline.seq],
      shadowedTokenCount: 1,
      provider: 'snapshot',
      model: 'snapshot',
    })
    agent.session.append('user/message', createUserMessage({
      content,
      source: compactCheckpointSource(compactionId),
    }), {
      surfaceOp: { op: 'replace', start: baseline.seq, end: baseline.seq },
      sourceEventSeqs: [baseline.seq],
    })
    agent.session.append('compaction/end', { compactionId, turn: openTurn.data.turn })
    return downstream
  })
}
