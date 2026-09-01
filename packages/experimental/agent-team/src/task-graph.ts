/** Complete dependency validation for current Team task snapshots. */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】当前团队任务快照的完整依赖校验：替换一个候选快照后验证整个活跃
 *   任务图（缺失/重复/自引用/环）。
 * 【技术维度】两遍检查：先逐任务核对 blocker 存在与去重，再做 DFS 环检测
 *   （visiting/visited 两集合）；错误带稳定 violation 类别供命令层映射。
 * 【产品维度】保证持久化的任务依赖图始终合法（不变量的一部分）。
 * 【逻辑维度】TeamTaskGraphViolation → TeamTaskGraphError → assertTaskGraphCandidate。
 * 【新手阅读建议】先看第一遍的逐任务检查，再看第二遍的 DFS 环检测。
 * ==========================================================================
 */

import type { TeamTaskId, TeamTaskSnapshot } from './types.ts'

/** Task dependency relation rejected by the shared graph validator. */
export type TeamTaskGraphViolation = 'missing' | 'duplicate' | 'cycle'

/** Package-private task dependency failure retained for command error mapping. */
export class TeamTaskGraphError extends Error {
  /**
   * @param message - concrete invalid dependency relation.
   * @param violation - stable relation category used by Team commands.
   */
  constructor(message: string, readonly violation: TeamTaskGraphViolation) {
    super(message)
    this.name = 'TeamTaskGraphError'
  }
}

/**
 * Validate the complete active task graph after replacing one candidate snapshot.
 * @param current - current task snapshots before the candidate event.
 * @param candidate - new or next-revision task snapshot.
 * @throws {TeamTaskGraphError} when an active dependency is missing, duplicated, self-referential, or cyclic.
 */
export function assertTaskGraphCandidate(
  current: readonly TeamTaskSnapshot[],
  candidate: TeamTaskSnapshot,
): void {
  const tasks = new Map(current.map(task => [task.id, task]))
  tasks.set(candidate.id, candidate)

  for (const task of tasks.values()) {
    if (task.status === 'deleted') continue
    const seen = new Set<TeamTaskId>()
    for (const blockerId of task.blockedBy) {
      if (blockerId === task.id) {
        throw new TeamTaskGraphError(`team task "${task.id}" cannot block itself`, 'cycle')
      }
      if (seen.has(blockerId)) {
        throw new TeamTaskGraphError(`team task "${task.id}" repeats blocker "${blockerId}"`, 'duplicate')
      }
      const blocker = tasks.get(blockerId)
      if (blocker === undefined || blocker.status === 'deleted') {
        throw new TeamTaskGraphError(
          `blocker task "${blockerId}" for "${task.id}" is missing or deleted`,
          'missing',
        )
      }
      seen.add(blockerId)
    }
  }

  const visiting = new Set<TeamTaskId>()
  const visited = new Set<TeamTaskId>()
  const visit = (id: TeamTaskId): void => {
    if (visiting.has(id)) {
      throw new TeamTaskGraphError(`task dependency cycle includes "${id}"`, 'cycle')
    }
    if (visited.has(id)) return
    const task = tasks.get(id)
    if (task === undefined || task.status === 'deleted') return
    visiting.add(id)
    for (const blockerId of task.blockedBy) visit(blockerId)
    visiting.delete(id)
    visited.add(id)
  }
  for (const task of tasks.values()) visit(task.id)
}
