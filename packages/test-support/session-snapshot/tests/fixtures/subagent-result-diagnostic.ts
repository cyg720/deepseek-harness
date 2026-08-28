/** Deterministic provider for model-visible foreground and Job diagnostic snapshots.
 * @remarks 文件说明：文件职责：验证 test-support/session-snapshot 中 subagent result
 * diagnostic 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import {
  NO_START_CAPABILITIES,
  type ResolvedSubagentStartRequest,
  type SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'

/**
 * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const name = 'subagent-result-diagnostic'
/**
 * 常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const inject = ['subagents']

/**
 * 常量说明：RESULTS 用于处理 RESULTS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const RESULTS = [
  {
    id: '00000000-0000-4000-8000-0000000000d1',
    diagnostic: 'Product subagent failure (product: Claude Code; stage: query-run; category: limit)',
    output: [{ type: 'text' as const, text: 'partial assistant text' }],
  },
  {
    id: '00000000-0000-4000-8000-0000000000d2',
    diagnostic: 'Product subagent failure (product: Claude Code; stage: query-run; category: limit)',
    output: [],
  },
  {
    id: '00000000-0000-4000-8000-0000000000d3',
    diagnostic: 'Product subagent failure (product: Codex; stage: turn; category: transport; HTTP status: 503)',
    output: [{ type: 'text' as const, text: 'partial assistant text' }],
  },
  {
    id: '00000000-0000-4000-8000-0000000000d4',
    diagnostic: 'Product subagent failure (product: Codex; stage: turn; category: transport; HTTP status: 503)',
    output: [],
  },
] as const

/**
 * 类说明：DiagnosticProvider 用于集中封装 处理 DiagnosticProvider 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 test-support/session-snapshot 在对应插件或业务生命周期内创建和调用。
 */
class DiagnosticProvider implements SubagentProvider {
  /**
   * 常量说明：name 用于处理 name 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly name = 'snapshot-diagnostic'
  /**
   * 常量说明：capabilities 用于处理 capabilities 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly capabilities = NO_START_CAPABILITIES
  /**
   * 常量说明：inheritsParentContext 用于处理 inheritsParentContext 相关数据，作用于成员；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly inheritsParentContext = false
  /**
   * 变量说明：starts 用于处理 starts 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private starts = 0

  /**
   * 功能说明：启动 start 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （ResolvedSubagentStartRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 start(request)，并按返回类型处理结果。
   */
  async start(request: ResolvedSubagentStartRequest) {
    if (request.signal.aborted) {
      throw new Error('snapshot diagnostic provider start aborted')
    }
    /**
     * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const index = this.starts++
    /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fixture = RESULTS[index]
    if (fixture === undefined) {
      throw new Error('snapshot diagnostic provider expected exactly four starts')
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return {
      id: SessionId(fixture.id),
      localAgent: undefined,
      result: Promise.resolve({
        output: [...fixture.output],
        diagnostic: fixture.diagnostic,
        stopReason: 'error' as const,
      }),
      dispose: async () => {},
    }
  }
}

/** Register the fixed provider behind the public Codex-shaped snapshot tool.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。 */
export function apply(ctx: Context): void {
  ctx.subagents.registerProvider(new DiagnosticProvider())
}
