/*
 * ================================ 文件注释 ================================
 * 【文件职责】跨域会话面：供兄弟域（如今是 workspaces）消费的契约接口，
 *   而不是 sessions 实现本身。
 * 【技术维度】结构化类型（structural typing）：SessionRuntime 可赋值给本
 *   接口，在装配层或测试注入真实服务处做编译期校验。
 * 【产品维度】把"兄弟域依赖会话服务的能力清单"显式化：拓宽本面即显式
 *   拓宽跨域依赖，防止兄弟域直接渗透进 sessions 实现细节。
 * 【逻辑维度】SessionsPortSummary 描述列表行的概要事实；SessionsPortList
 *   描述列表整体（id 数组、行映射、当前选中、就绪阶段）；SessionsPort
 *   提供只读列表快照 + create/open/clear 三个行为。
 * 【关键边界】list 是只读面（写操作留在 sessions 域内部）；open 要求
 *   id 必须存在于列表存储中。
 * 【新手阅读建议】对照 sessions/service.ts 看实现如何满足本接口。
 * ==========================================================================
 */
/**
 * Cross-domain sessions face: the contract surface sibling domains (today:
 * workspaces) consume instead of the sessions implementation. The sessions
 * domain satisfies it structurally — SessionRuntime is assignable, checked
 * wherever the assembly layer or a test injects the real service — so
 * widening this face is the explicit act of widening the inter-domain
 * dependency.
 */
/*
 * 跨域会话面：兄弟域（如今是 workspaces）消费的契约面，而非 sessions 实现。
 * sessions 域以结构化方式满足它——SessionRuntime 可赋值给本接口，装配层
 * 或测试注入真实服务处会做类型校验——因此拓宽本面就是显式拓宽跨域依赖。
 */

import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot } from './store.ts'

/** Session-list row facts sibling domains read: recency, blank-reuse eligibility, and its cwd canon. */
/* 兄弟域读取的会话列表行事实：最近活跃时间、空白复用资格、cwd 规范路径。 */
export interface SessionsPortSummary {
  id: SessionId
  /** Empty-log bit (blank sessions are reused by New Session instead of minting another). */
  /* 空日志标记：空白会话会被 New Session 复用，而不是再新建一个。 */
  blank: boolean
  cwd?: string
  updatedAt: number
}

/** Session-list facts sibling domains read: readiness, selection, and the row map. */
/* 兄弟域读取的会话列表整体事实：就绪状态、当前选中、行映射。 */
export interface SessionsPortList {
  ids: SessionId[]
  byId: Record<SessionId, SessionsPortSummary>
  current: SessionId | undefined
  phase: 'pending' | 'ready'
}

/** The sessions-service face injected into sibling domains. */
/* 注入兄弟域的会话服务面。 */
export interface SessionsPort {
  /** Observable list snapshot (read face only; writes stay inside the sessions domain). */
  /* 可观察的列表快照（只读面；写操作留在 sessions 域内部）。 */
  readonly list: ObservableSnapshot<SessionsPortList>
  /**
   * Create a session on the host.
   * @param opts - target workspace.
   * @returns the new session id.
   */
  /*
   * 在 Host 上创建一个会话。
   * @param opts 目标工作区。
   * @returns 新会话 id。
   */
  create(opts: { workspaceId: WorkspaceId }): Promise<SessionId>
  /**
   * Select a session as current.
   * @param id - session id (must exist in the list store).
   */
  /*
   * 把某个会话设为当前会话。
   * @param id 会话 id（必须存在于列表存储中）。
   */
  open(id: SessionId): void
  /** Clear the current selection into the no-session view state. */
  /* 清除当前选中，回到"无会话"视图状态。 */
  clear(): void
}
