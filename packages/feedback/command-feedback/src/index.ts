/**
 * Session feedback event plus the human-facing `/feedback` producer. Recording
 * appends one authoritative log-only event and does not start model work. The
 * append is eager but unflushed, so acknowledgement reports that the entry is
 * logged, not that it reached disk.
 * @module @deepseek-ai/dsh-command-feedback
 */
/*
 * 文件职责：实现反馈记录的 index.ts 模块。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证反馈记录在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：注册服务或命令，转换请求并记录结果。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionTelemetryBackend, SessionTelemetrySharingStatus } from '@deepseek-ai/dsh-session-telemetry'
import type { Session } from '@deepseek-ai/dsh-session'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'

/** 中文说明：模块局部值 name，由紧邻初始化决定。 */
export const name = 'command-feedback'
/** 中文说明：模块局部值 inject，由紧邻初始化决定。 */
export const inject = ['commands']

/** 中文说明：模块局部值 USAGE，由紧邻初始化决定。 */
const USAGE = 'Usage: /feedback <text>'

/** Fail closed when a future sharing status reaches the sentence switch. */
/* 中文说明：函数 assertNever 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
/* v8 ignore next 3 -- only the ignored default arm calls this; the closed union cannot reach it via the public API. */
function assertNever(value: never): never {
  throw new Error(`command-feedback: unsupported sharing status ${JSON.stringify(value)}`)
}

/** The acknowledgement's sharing sentence for a disclosed policy. */
/* 中文说明：函数 sharingSentence 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sharingSentence(sharing: SessionTelemetrySharingStatus): string {
  switch (sharing) {
    case 'full':
      return 'Session sharing is enabled.'
    case 'feedback-only':
      return 'Session sharing is feedback-gated; recording feedback uploads the session records not yet shared.'
    case 'disabled':
      return 'Session sharing is disabled.'
    /* v8 ignore next 2 -- the seam's closed union cannot reach the default; a future status must be given a sentence here. */
    default:
      return assertNever(sharing)
  }
}

/**
 * The sharing disclosure appended to the acknowledgement: the mounted
 * backend's disclosed policy, or a "not configured" notice when no backend
 * is mounted. Read through the plugin context so the command still works
 * when the telemetry service is absent.
 * @param telemetry - the mounted telemetry service, or undefined.
 * @returns one sentence describing this session's sharing policy.
 */
/* 中文说明：函数 sharingDisclosure 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sharingDisclosure(telemetry: SessionTelemetryBackend | undefined): string {
  if (telemetry === undefined) {
    return 'Session sharing is not configured.'
  }
  return sharingSentence(telemetry.sharing)
}

declare module '@deepseek-ai/dsh-session/types' {
  /** 中文说明：类型或类 SessionEventMap 约束扩展或反馈数据职责。 */
  interface SessionEventMap {
    /**
     * One recorded human remark about this session. Log-only and independent
     * of its trigger; it never enters model context or derived history.
     */
    'feedback/record': { text: string }
  }
}

/**
 * Record feedback independently of any UI trigger.
 * @param session - session the feedback describes.
 * @param text - human-authored feedback; surrounding whitespace is discarded.
 * @throws {TypeError} when the normalized text is empty.
 */
/*
 * 中文说明：函数 recordFeedback 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param session 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param text 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function recordFeedback(session: Session, text: string): void {
  /** 中文说明：模块局部值 normalized，由紧邻初始化决定。 */
  const normalized = text.trim()
  if (normalized.length === 0) throw new TypeError('feedback text must not be empty')
  session.append('feedback/record', { text: normalized })
}

/**
 * Validate, record, and acknowledge one feedback entry. Returning an error
 * leaves no `feedback/record` event.
 * @param invocation - receiving agent, raw command input, and UI cancellation.
 * @param ctx - plugin context used to read the optional telemetry service.
 * @returns an acknowledgement containing the receiving session and anonymous
 * user ids plus the session-sharing disclosure, or a usage error when no
 * feedback text was supplied.
 */
/* 中文说明：函数 executeFeedbackCommand 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function executeFeedbackCommand(invocation: CommandInvocation, ctx: Context): CommandResult {
  if (invocation.rawInput.trim().length === 0) {
    return { kind: 'error', text: `Feedback text is required. ${USAGE}` }
  }
  recordFeedback(invocation.agent.session, invocation.rawInput)
  /** 中文说明：模块局部值 telemetry，由紧邻初始化决定。 */
  const telemetry = ctx.get('sessionTelemetry')
  return {
    kind: 'success',
    text: `Feedback recorded for session ${invocation.agent.session.id}\nAnonymous user: ${getOrCreateAnonymousUserId()}. ${sharingDisclosure(telemetry)}`,
  }
}

/** Register the global `/feedback` command for every composed command adapter. */
/* 中文说明：函数 apply 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'feedback',
    description: 'record feedback about this session',
    input: { hint: '<text>' },
    recordInput: false,
    handler: invocation => executeFeedbackCommand(invocation, ctx),
  })
}
