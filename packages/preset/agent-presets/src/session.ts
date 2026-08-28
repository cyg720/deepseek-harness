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
 * Reconstruction reads the `agentPreset` Session projection, never the header
 * alone.
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

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

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

const agentPresetSchema = z.union([z.string(), z.null()])

/** Current Session preset, initialized from its header and advanced by selection events. */
export const agentPresetProjectionDefinition = {
  key: 'agentPreset',
  stateSchema: agentPresetSchema,
  init: header => header.agentPreset ?? null,
  apply: (state, event) => event.type === 'agent-preset/selected'
    ? event.data.agentPreset
    : state,
  wire: { viewSchema: agentPresetSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'agentPreset', string | null>
