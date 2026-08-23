/**
 * ================================ 文件注释 ================================
 * 【文件职责】flattenLineage：把会话概要列表展平成带谱系缩进的扁平行列表，
 *   供会话列表 UI 渲染（纯函数）。
 * 【技术维度】纯函数：输入顺序权威；按 parentSessionId 构建子表，深度优先
 *   遍历输出，带 visited 集合做环软失败处理。
 * 【产品维度】会话列表按父子层级缩进展示子代理会话；孤儿（父缺失）降级为
 *   根级展示，环成员降级为根，绝不让任何条目丢失。
 * 【逻辑维度】byId 建索引；children/roots 分组；walk 深度优先输出行；
 *   最后把不可达的环成员作为根输出。
 * 【关键边界】本投影绝不按可变时间戳重排序（顺序以输入为准）；completed
 *   由管理器提供、缺省 false；depth 从根 0 起，UI 乘以缩进宽度。
 * 【新手阅读建议】注意输出行字段与输入概要字段的对应关系。
 * ==========================================================================
 */
// flattenLineage: summaries -> flat list with lineage indentation (pure function).
// The input order is authoritative; lineage only makes each child adjacent to its parent.
// Orphaned lineage degrades to root level; cycles fail soft and emit as roots.
// flattenLineage：会话概要 -> 带谱系缩进的扁平列表（纯函数）。
// 输入顺序是权威的；谱系只让每个子项紧挨其父项。孤儿谱系降级为根级；
// 环软失败并以根节点形式输出。

import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'
import type { PendingInteractionStatus } from './pending.ts'

/** Host list summary enriched with the latest mux-projected durable title. */
/** 补充了最新 mux 投影持久标题的 Host 列表概要。 */
export interface TitledSessionSummary extends SessionSummary {
  title?: string
  /** Current host-computed projection values for list consumers. */
  /** 供列表消费方使用的当前 Host 计算投影值。 */
  projectionValues?: Readonly<Partial<SessionProjectionMap>>
}

/** One flattened session-list row with lineage depth and live pending interaction. */
/** 一行带谱系深度与实时待处理交互的扁平会话列表行。 */
export interface SessionListEntry {
  sessionId: SessionId
  title?: string
  updatedAt: number
  running: boolean
  /** Empty-log bit mirrored from the summary; lists hide blank sessions (filtering stays with the consumer). */
  /** 从概要镜像的空日志位；列表隐藏空白会话（过滤留在消费方）。 */
  blank: boolean
  parentSessionId?: SessionId
  /** Coarse durable origin for navigation filtering; not a continuation capability. */
  /** 供导航过滤使用的粗粒度持久来源；不是续接能力。 */
  origin?: 'subagent'
  cwd?: string
  /** Agent preset the session's agent was composed from (summary passthrough). */
  /** 会话 agent 组合时使用的 agent preset（概要直通）。 */
  agentPreset?: string
  /** Current host-computed projection values for list consumers. */
  /** 供列表消费方使用的当前 Host 计算投影值。 */
  projectionValues?: Readonly<Partial<SessionProjectionMap>>
  /** User interaction currently blocking this session, derived from live mux frames. */
  /** 当前阻塞本会话的用户交互，由实时 mux 帧推导。 */
  pendingInteraction?: PendingInteractionStatus
  /** Finished running while not selected and not yet opened — the sidebar's green "done" reminder (clears on select or the next run). */
  /** 未选中且未打开时已运行完成——侧边栏的绿色"完成"提醒（选中或下次运行时清除）。 */
  completed: boolean
  /** Lineage indent depth: root = 0; the UI just multiplies by the indent width. */
  /** 谱系缩进深度：根为 0；UI 直接乘以缩进宽度。 */
  depth: number
}

/**
 * Summaries -> flat list with lineage indentation. Root and sibling order
 * follows the established input order; this projection never re-sorts a
 * hydrated list from mutable timestamps.
 * @param summaries - the host's session.list items.
 * @param pendingInteractions - current manager-owned interaction status by session.
 * @param completed - sessions with a pending completion reminder (manager-owned live fact; absent = false).
 * @returns display rows in render order.
 */
/**
 * 会话概要 -> 带谱系缩进的扁平列表。根与兄弟的顺序遵循已建立的输入顺序；
 * 本投影绝不用可变时间戳重排已水合（hydrated）的列表。
 * @param summaries Host 的 session.list 项。
 * @param pendingInteractions 管理器按会话持有的当前交互状态。
 * @param completed 有待处理完成提醒的会话（管理器持有的实时事实；缺省 false）。
 * @returns 按渲染顺序排列的展示行。
 */
export function flattenLineage(
  summaries: readonly TitledSessionSummary[],
  pendingInteractions?: ReadonlyMap<SessionId, PendingInteractionStatus>,
  completed?: ReadonlySet<SessionId>,
): SessionListEntry[] {
  const byId = new Map<SessionId, TitledSessionSummary>() // id -> 概要索引，用于判断父是否存在
  for (const s of summaries) byId.set(s.sessionId, s)

  const children = new Map<SessionId, TitledSessionSummary[]>() // 父 id -> 子概要列表
  const roots: TitledSessionSummary[] = [] // 无父（或父缺失）的根概要
  for (const s of summaries) {
    if (s.parentSessionId !== undefined && byId.has(s.parentSessionId)) {
      const list = children.get(s.parentSessionId) ?? []
      list.push(s)
      children.set(s.parentSessionId, list)
    } else {
      roots.push(s) // root, or an orphan whose parent is absent from summaries (degrade to root, never drop)
      // 根节点，或其父不在概要中（降级为根，绝不丢弃）
    }
  }

  const out: SessionListEntry[] = []
  const visited = new Set<SessionId>() // 环检测：已访问过的 id
  const walk = (s: TitledSessionSummary, depth: number): void => {
    if (visited.has(s.sessionId)) {
      console.warn(`[web-runtime] lineage cycle at ${s.sessionId}; emitting as root`)
      return
    }
    visited.add(s.sessionId)
    const pendingInteraction = pendingInteractions?.get(s.sessionId)
    out.push({
      ...s,
      ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
      completed: completed?.has(s.sessionId) ?? false,
      depth,
    })
    const kids = children.get(s.sessionId)
    if (kids === undefined) return
    for (const kid of kids) walk(kid, depth + 1) // 子节点深度 +1
  }
  for (const root of roots) walk(root, 0)
  // Cycle members (unreachable from any root): emit as roots so no entry is lost.
  // 环成员（从任何根不可达）：作为根输出，保证没有条目丢失。
  for (const s of summaries) {
    if (!visited.has(s.sessionId)) walk(s, 0)
  }
  return out
}
