/** Agent-scoped serialization for Schedule reads and durable mutations. */
/*
 * 文件职责：按精确 Agent 串行执行计划任务读取和持久变更的完整事务。
 * 技术维度：使用 WeakMap 保存每个 Agent 的 Promise 尾链，并在 finally 中安全回收。
 * 产品维度：避免同一代理的提醒创建、读取或删除相互穿插而产生陈旧决定。
 * 逻辑维度：取得前序尾链，串接新操作，生成无论成败都会完成的尾 Promise，执行后只删除当前尾。
 * 关键边界：不同 Agent 可并行；operation 必须包含完整的前置刷新、折叠、变更和后置刷新。
 * 新手阅读建议：先把 tails 理解为每个 Agent 的排队尾巴，再跟踪 prior、run、tail 的关系。
 */

import type { Agent } from '@deepseek-ai/dsh-agent'

// tails：以 Agent 对象身份为键的事务尾 Promise；WeakMap 不阻止已释放 Agent 被回收。
const tails = new WeakMap<Agent, Promise<void>>()

/**
 * Run one complete Schedule transaction after its exact Agent's prior transaction.
 * @param agent - Exact Schedule owner and serialization key.
 * @param operation - Complete preflight, fold, mutation, and postflight operation.
 * @returns The operation result after exclusive execution.
 */
/*
 * 在同一 Agent 的前序计划事务完成后独占执行一个完整事务。
 * @param agent - 精确的计划任务所有者，也是串行队列键。
 * @param operation - 返回 Promise 的完整事务操作，成功值会原样返回。
 * @returns 等待独占执行后得到 operation 的结果；错误原样向调用方传播。
 * @example await runScheduleTransaction(agent, async () => updateSchedule())。
 */
export async function runScheduleTransaction<T>(agent: Agent, operation: () => Promise<T>): Promise<T> {
  // prior：当前 Agent 已排队的最后事务；首次调用时使用已完成 Promise。
  const prior = tails.get(agent) ?? Promise.resolve()
  // run：在 prior 完成后执行本次 operation，并保留其成功值或失败原因。
  const run = prior.then(operation)
  // tail：抹去本次结果和错误的完成信号，使后续事务即使在前次失败后也能继续排队。
  const tail = run.then(() => undefined, () => undefined)
  tails.set(agent, tail)
  try {
    return await run
  } finally {
    if (tails.get(agent) === tail) tails.delete(agent)
  }
}
