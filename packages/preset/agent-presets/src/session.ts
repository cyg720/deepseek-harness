/**
 * The session-log record of which preset a session actually runs.
 *
 * The creation header names the preset a session STARTED with, and it is
 * deep-frozen because that is a creation fact. A session may still change
 * preset while it is blank, and the effect of that change outlives the blank
 * window: the first turn — and every turn after it — runs under the newly
 * mounted composition. Recording the change is what keeps the log honest, and
 * it is required outright by the repo's model-visible ⟺ logged rule, since the
 * preset decides the tool schemas and prompt sections the model sees.
 *
 * Reconstruction reads {@link resolveSessionPreset}, never the header alone.
 * @module @deepseek-ai/dsh-agent-presets/session
 */
/*
 * 文件职责：记录并解析会话实际采用的代理预设，支持空白会话在创建后切换预设。
 * 技术维度：通过 TypeScript 声明合并扩展会话事件，并逆序扫描事件日志重建状态。
 * 产品维度：保证恢复或分叉会话时继续使用历史真正采用的工具与提示词组合。
 * 逻辑维度：声明预设选择事件，定义解析所需最小会话接口，再由最新选择回退到创建头。
 * 关键边界：创建头只表示初始预设；若发生切换，必须记录事件，且最后一条选择事件生效。
 * 新手阅读建议：先区分 header 的创建事实与 events 的后续变化，再看逆序循环的优先级。
 */

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'

/** 为会话事件映射补充创建后选择代理预设的日志事件。 */
declare module '@deepseek-ai/dsh-session/types' {
  /** 会话日志可识别的事件名称与数据映射。 */
  interface SessionEventMap {
    /**
     * The session's agent preset was chosen after creation, while the session
     * was still blank. Log-only: it records the composition later turns ran
     * under, so a resumed or forked session rebuilds the same one instead of
     * the header's creation-time value.
     */
    /* 会话仍为空白时选择的新预设，用于之后恢复相同的代理组合。 */
    'agent-preset/selected': { agentPreset: string }
  }
}

/** The minimum a caller must supply to resolve a session's preset. */
/* 调用方解析会话实际预设时必须提供的最小数据集合。 */
export interface PresetBearingSession {
  /** The session's creation header. */
  /* 会话创建头，包含创建时选择的预设。 */
  readonly header: SessionHeader
  /** The session's event log, oldest first. */
  /* 按时间从旧到新排列的会话事件日志。 */
  readonly events: readonly SessionEvent[]
}

/**
 * The preset a session actually runs, newest selection winning.
 *
 * The header supplies the creation-time value; every later selection is a
 * logged event, so the last one is the answer. Reading the header alone
 * rebuilds a switched session under the composition it was created with, not
 * the one its history was produced under.
 * @param session - the session's header and event log.
 * @returns the preset id, or `undefined` when the deployment composes none.
 */
/*
 * 解析会话实际运行的预设，优先采用日志中最后一次选择，否则使用创建头。
 * @param session 包含创建头和事件日志的最小会话对象。
 * @returns 预设编号；部署未组合预设时返回 undefined。
 * @example `resolveSessionPreset({ header, events })`
 */
export function resolveSessionPreset(session: PresetBearingSession): string | undefined {
  /** 从最后一个事件开始向前移动的索引，确保最新选择优先。 */
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    /** 当前索引对应的会话事件；稀疏数组位置可能为 undefined。 */
    const event = session.events[index]
    if (event?.type === 'agent-preset/selected') return event.data.agentPreset
  }
  return session.header.agentPreset
}
