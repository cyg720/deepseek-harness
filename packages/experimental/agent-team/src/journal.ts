/** Serialized Team transactions over the exact live Lead Session log. */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】团队事务的串行化与已提交事件发布：每个 Lead 日志上的读-查-写操作
 *   按根排队串行执行，追加并冲刷团队事件后通知等待者。
 * 【技术维度】tails Map 做每根尾链串行；appendAndFlush 把事件追加到 Lead 会话、
 *   冲刷到持久化、再同步通知（onCommit → TeamActivity.notify）。
 * 【产品维度】保证同根团队操作的事务顺序与持久化可见性。
 * 【逻辑维度】state → transact → appendAndFlush。
 * 【关键边界】团队事件绝不进入对话表面（局部收窄的 append 能力）。
 * 【新手阅读建议】先看 transact 的尾链串行，再看 appendAndFlush 的三步。
 * ==========================================================================
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEventMap, SessionId } from '@deepseek-ai/dsh-session'
import type { TeamEventType, TeamState } from './projection.ts'

type AppendTeamEvent = <T extends TeamEventType>(type: T, data: SessionEventMap[T]) => void
type MutableTeamEventType = 'team/member' | 'team/task' | 'team/message/queued' | 'team/message/delivered'

/** Owns per-Lead transaction order and committed Team event publication. */
export class TeamJournal {
  private readonly tails = new Map<SessionId, Promise<void>>()

  /**
   * @param ctx - Team service context with the injected Session service.
   * @param onCommit - synchronous notification after the Team event flush succeeds.
   */
  constructor(
    private readonly ctx: Context,
    private readonly onCommit: (root: Agent) => void,
  ) {}

  /**
   * Read authoritative Team state for one exact live Lead.
   * @param root - exact live Team Lead.
   * @returns current projected state selected by the Lead Team id.
   */
  state(root: Agent): TeamState {
    const projection = this.ctx.sessionProjections.stateOf(root.session, 'agentTeam')
    if (projection === undefined) throw new Error('Agent Teams projection is not registered')
    if (projection.failure !== undefined) throw new Error(projection.failure)
    return projection
  }

  /**
   * Serialize one Lead's asynchronous mutation operation.
   * @param rootId - Lead Session identity selecting the transaction queue.
   * @param operation - complete read-check-append operation.
   * @returns the operation result.
   */
  async transact<T>(rootId: SessionId, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(rootId) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.tails.set(rootId, tail)
    try {
      return await run
    } finally {
      if (this.tails.get(rootId) === tail) this.tails.delete(rootId)
    }
  }

  /**
   * Append and checkpoint one root-owned Team event before publication.
   * @param root - exact live Lead whose Session owns the event.
   * @param type - Team event discriminant.
   * @param data - payload correlated with the event type.
   */
  async appendAndFlush<T extends MutableTeamEventType>(
    root: Agent,
    type: T,
    data: SessionEventMap[T],
  ): Promise<void> {
    // Team events never enter the conversation surface. This narrower local
    // capability removes Session.append's conditional surface argument while
    // preserving the event-key/payload correlation.
    const append = root.session.append.bind(root.session) as unknown as AppendTeamEvent
    append(type, data)
    await this.ctx.sessions.flush(root.session)
    this.onCommit(root)
  }
}
