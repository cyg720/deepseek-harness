/** Client Session object layer, Agent scopes, and Remote lifecycle wiring. */

/*
 * 文件说明：文件职责：实现 api/session-controller 中 index 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent/types'
import { createSessionControlStream } from './transport.ts'
import { ClientSessions } from './sessions/service.ts'
import type { SessionRemotes } from './sessions/remotes.ts'
import type {} from '../remote-events.ts'

export {
  createSessionControlStream,
  SessionEventStream,
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
} from './transport.ts'
export type {
  ClientSessionPageRequest,
  SessionControlStream,
  SessionControlStreamOptions,
  SessionEventStreamOptions,
  SessionJournalChange,
  SessionRemote,
} from './transport.ts'
export { createScope, scopeOf } from './scope.ts'
export type { AgentContext, AgentScopeHandle } from './scope.ts'
export { SessionCreateError, SessionForkError } from './sessions/service.ts'
export type { SessionBinding, SessionListState, SessionSummary } from './sessions/service.ts'
export type {
  SessionListPhase,
  SessionListSnapshot,
  SessionSearchResultItem,
  SubagentCatalogSnapshot,
} from './sessions/manager.ts'
export type { Session } from './sessions/session.ts'
export type {
  ProjectionsBaseline,
  ProjectionValueStore,
  SessionProjectionMap,
  UseProjection,
} from './sessions/projection-store.ts'
export type {
  BeginSubmissionInput,
  ISession,
  PendingSubmissionRetirement,
  ProjectionsFace,
  SessionFace,
  SubmissionHandle,
} from './contract/session.ts'
export type { ISessions } from './contract/sessions.ts'
export { MutableSessionEventSource } from './contract/events.ts'
export type {
  SessionEventChange,
  SessionEventLike,
  SessionEventLikeEntry,
  SessionEventSource,
  SessionEventWindow,
  SessionLiveEventEntry,
} from './contract/events.ts'
export type {
  OpenState,
  PendingSubmission,
  PendingSubmissionImage,
  PendingSubmissionPlacement,
  PromptError,
  QueuedMessage,
  SessionSnapshot,
} from './contract/snapshot.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Client Session object layer and Agent scope owner. */
    sessions: import('./contract/sessions.ts').ISessions
  }
}

/** Required Remote and Context projection services. */
export const inject = [
  'typert',
  'remote',
  'remote.commands',
  'remote.session',
  'remote.subagents',
]

/**
 * Install Client Session state and its reconnecting control stream.
 * @param ctx - Client Cordis context.
 */
export function apply(ctx: Context): void {
  const remotes = ctx.remote as unknown as SessionRemotes
  const sessions = new ClientSessions(ctx, remotes)
  ctx.remote.$on('api-session/added', (summary) => { sessions.handleSessionAdded(summary) })
  ctx.remote.$on('api-session/removed', (sessionId) => { sessions.handleSessionRemoved(sessionId) })
  ctx.remote.$on('api-session/status', (sessionId, running) => {
    sessions.handleSessionStatus(sessionId, running)
  })
  ctx.remote.$on('api-session/activity', (sessionId, updatedAt) => {
    sessions.handleSessionActivity(sessionId, updatedAt)
  })
  ctx.remote.$on('api-session/error', (sessionId, message) => {
    sessions.handleSessionError(sessionId, message)
  })

  const control = createSessionControlStream(remotes, {
    accept: (frame) => { sessions.handleControlFrame(frame) },
    failed: (error) => { console.error('[session-controller] control stream failed:', error) },
  })
  control.start()
  ctx.on('connection/reset', () => { sessions.handleConnected() })
  if (ctx.remote.$host.home !== undefined) sessions.handleConnected()
  ctx.typert.contexts.registerClient('agent', {
    identity: candidate => sessions.scopeOf(candidate),
    resolve: sessionId => sessions.resolveAgentScope(sessionId),
  })
  ctx.effect(() => async () => { await control.dispose() }, 'session-controller.client.control')
}
