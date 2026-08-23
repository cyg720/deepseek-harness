/**
 * ================================ 文件注释 ================================
 * 【文件职责】基于保留的会话列表镜像做纯函数式的子代理（subagent）谱系
 *   聚合：统计每个可能父会话下的子代理后代数量。
 * 【技术维度】纯函数：遍历所有会话概要，沿 parentId 链向上传播计数；
 *   带 seen 集合做环检测（失败软处理）。
 * 【产品维度】界面展示会话树/子代理层级时需要"该会话有多少子代理后代、
 *   其中几个正在运行"。
 * 【逻辑维度】对每个 subagent 来源的后代，沿"父链"逐级累加计数到每个
 *   可达祖先；孤儿 owner 在概要到达前只是无害的 Map 键。
 * 【关键边界】普通 fork（非 subagent 来源）会终止传播，使每个可见会话只
 *   拥有自己连续的 subagent 子树；环会软失败（seen 检测）。
 * 【新手阅读建议】结合 service.ts 的 SessionSummary 理解 origin/parentId。
 * ==========================================================================
 */
/**
 * Pure subagent-lineage aggregation over the retained session-list mirror.
 * Ordinary forks terminate propagation so each visible session owns only its
 * uninterrupted subagent subtree.
 * @module @deepseek-ai/dsh-client-runtime/client/sessions/subagent-lineage
 */
/**
 * 在保留的会话列表镜像上做纯函数式子代理谱系聚合：普通 fork 会终止传播，
 * 使每个可见会话只拥有自己连续（无中断）的 subagent 子树。
 */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionSummary } from './service.ts'

/** Descendant counts projected for one possible parent session. */
/** 为某一个可能的父会话投影的后代计数。 */
export interface SubagentDescendantSummary {
  /** All descendants connected through uninterrupted subagent-origin lineage. */
  /** 通过不间断的 subagent 来源谱系连接的全部后代数。 */
  readonly count: number
  /** Descendants whose exact session summary is currently running. */
  /** 其中概要显示"正在运行"的后代数。 */
  readonly runningCount: number
}

/**
 * Index every subagent descendant under each ancestor it reaches through an
 * uninterrupted subagent-origin chain. Cycles fail soft and orphan owners
 * remain harmless map keys until their summaries arrive.
 * @param summaries - retained session summaries keyed by id.
 * @returns descendant totals and running totals keyed by possible parent id.
 */
/**
 * 把每个 subagent 后代索引到它通过不间断 subagent 来源链可达的每个祖先
 * 之下。环会软失败；孤儿 owner 在它们的概要到达前只是无害的 Map 键。
 * @param summaries 按 id 键控的保留会话概要。
 * @returns 按可能父会话 id 键控的后代总数与运行中总数。
 */
export function indexSubagentDescendants(
  summaries: Readonly<Record<SessionId, SessionSummary>>,
): ReadonlyMap<SessionId, SubagentDescendantSummary> {
  const indexed = new Map<SessionId, { count: number; runningCount: number }>() // 父 id -> 聚合计数
  for (const descendant of Object.values(summaries)) {
    if (descendant.origin !== 'subagent') continue // 只统计 subagent 来源的后代
    const seen = new Set<SessionId>() // 环检测：同一后代沿链再次出现即停止
    let current: SessionSummary | undefined = descendant
    while (current?.origin === 'subagent' && current.parentId !== undefined
      && !seen.has(current.id)) {
      seen.add(current.id)
      const aggregate = indexed.get(current.parentId)
      if (aggregate === undefined) {
        indexed.set(current.parentId, {
          count: 1,
          runningCount: descendant.running ? 1 : 0,
        })
      } else {
        aggregate.count += 1
        if (descendant.running) aggregate.runningCount += 1
      }
      current = summaries[current.parentId] // 沿父链上溯
    }
  }
  return indexed
}
