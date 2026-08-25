/** Session/workspace fixture shapes and snapshot defaults for the test runtime. */
/*
 * 文件职责：实现 fixtures.ts 覆盖的客户端运行时测试支持行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的客户端运行时测试支持能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */
import type {
  ConversationSnapshot, ISession, SessionId, SessionSummary, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Fixture overrides for the session behavior face: any subset of the
 * production ISession verbs (typed against it, so a face change surfaces
 * here at compile time), plus extra members feature-specific casts consume.
 * The open Record tail means a misnamed EXTRA member is not caught by the
 * compiler (it grafts as dead weight); the ISession verbs stay safe — a
 * misnamed verb leaves the fail-loud stub in place, which names itself at
 * the first call.
 */
/* 中文说明：type SessionBehaviorOverrides 定义本模块所需的数据或行为，用于表达客户端运行时测试支持场景。 */
export type SessionBehaviorOverrides = Partial<ISession> & Record<string, unknown>

/**
 * act-wrapped mutation runner shared by every runtime object: public mutators
 * funnel through it so tests never handle SlotCore microtask batching or
 * React act themselves.
 */
/* 中文说明：type Stabilizer 定义本模块所需的数据或行为，用于表达客户端运行时测试支持场景。 */
export type Stabilizer = (fn: () => void | Promise<void>) => Promise<void>

/**
 * Session fixture accepted by {@link TestSessions.add}: identity plus optional
 * snapshot/list-row overrides and the session behavior face the feature under
 * test actually calls (kept open — the runtime never fakes methods a test did
 * not supply, so an unstubbed call fails loud at the call site).
 */
/* 中文说明：interface SessionFixture 定义本模块所需的数据或行为，用于表达客户端运行时测试支持场景。 */
export interface SessionFixture {
  id: string
  /** Overrides merged over {@link conversationSnapshot} (sessionId comes from `id`). */
  snapshot?: Partial<Omit<ConversationSnapshot, 'sessionId'>>
  /** List-row overrides merged over the defaults derived from `id`. */
  summary?: Partial<Omit<SessionSummary, 'id'>>
  /** Session behavior face: exactly the methods the feature under test calls (ISession subset + extras). */
  session?: SessionBehaviorOverrides
}

/**
 * A complete quiescent conversation snapshot (open window, no traffic).
 * @param sessionId - owning session id.
 * @returns the snapshot; spread fixture overrides on top.
 */
/*
 * 中文说明：函数 conversationSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param sessionId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function conversationSnapshot(sessionId: SessionId): ConversationSnapshot {
  return {
    sessionId,
    views: EMPTY_CONVERSATION_VIEWS,
    chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
  }
}

/**
 * A ready workspace list with no workspaces (the shape WorkspaceRuntime
 * projects after both baselines land).
 * @returns the initial state of the test workspaces store.
 */
/*
 * 中文说明：函数 workspaceListState 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function workspaceListState(): WorkspaceListState {
  return {
    items: [],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: undefined,
  }
}
