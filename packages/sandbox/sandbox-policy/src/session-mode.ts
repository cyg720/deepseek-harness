/**
 * Per-session sandbox-mode override: the session log as the store. A runtime
 * switch (a UI policy control or test scenario) is recorded as one
 * `sandbox/mode` event on the session it applies to;
 * `effective = fold(events) ?? the deployment default`, so an override
 * survives restart by replay, two sessions can never see each other's state,
 * and there is no external config store. The event is log-only (the
 * `approval/*` precedent): the policy owner projects the fold into each model
 * request, while enforcing tools report operation-specific boundary markers.
 * EXECUTION honors the same fold through `ctx.sandboxPolicy.resolve()` — it
 * stamps the mode together with the calling session's workspace root onto each
 * capability call, weakest-precedence beneath an escalation grant.
 *
 * The override is policy state shared by every enforcing family (bash and
 * filesystem alike), so it lives here in the policy package rather than in any
 * one capability's seam.
 *
 * @module dsh-sandbox-policy/session-mode
 */
/**
 * 文件职责：实现 session-mode.ts 承担的沙箱策略或 Windows ACL 隔离职责。
 * 技术维度：使用 TypeScript、Windows 原生接口、访问控制列表和进程生命周期管理。
 * 产品维度：限制 Agent 子进程可访问的系统资源，降低误操作和凭据泄露风险。
 * 逻辑维度：解析策略，构造权限或原生调用，启动受限进程，并等待退出后清理。
 * 关键边界：原生句柄和权限失败必须显式处理；环境变量需净化；清理必须达到静止状态。
 * 新手阅读建议：先看公开配置和 Win32 类型，再读权限授予与启动，最后关注错误和清理。
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'

declare module '@deepseek-ai/dsh-session/types' {
  /** 中文说明：interface SessionEventMap 定义本模块所需的数据或行为，用于表达沙箱安全场景。 */
  interface SessionEventMap {
    /**
     * The session's sandbox mode was switched — log-only (like `approval/*`;
     * NOT a surface event, carries no `surfaceOp`): durable and replayable,
     * never in the model transcript. The LAST such event is the session's
     * override ({@link effectiveSandboxMode}). `source: 'delegation'` marks
     * an override seeded into a child; an absent source is a runtime switch.
     */
    'sandbox/mode': {
      mode: SandboxMode
      /** Marks an override seeded into a child at delegation. */
      source?: 'delegation'
    }
  }
}

/** Every {@link SandboxMode}, for option advertisement and runtime validation of untrusted mode strings. */
/* 中文说明：常量 SANDBOX_MODES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const SANDBOX_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']

/**
 * The session's sandbox-mode override: the last `sandbox/mode` event in the
 * log, or undefined when the session never switched (callers apply the
 * deployment default). The pure fold — resume needs no catch-up machinery
 * because replaying the log IS the state.
 * @param events - session events in log order (other event types are skipped).
 * @returns the mode of the last switch event, or undefined without one.
 */
/*
 * 中文说明：函数 effectiveSandboxMode 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param events 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function effectiveSandboxMode(events: readonly SessionEvent[]): SandboxMode | undefined {
  /** 中文说明：该循环依次处理权限或资源数据；循环变量仅在当前循环中有效。 */
  for (let index = events.length - 1; index >= 0; index -= 1) {
    /** 中文说明：变量 event 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const event = events[index] as SessionEvent
    if (event.type === 'sandbox/mode') return event.data.mode
  }
  return undefined
}

/**
 * THE write path for a session's sandbox-mode override: appends exactly one
 * `sandbox/mode` event — the switch IS its event; nothing mutates mode state
 * out of band. Takes effect on the session's next confined call (bash or fs)
 * — the consumers fold on every read.
 * @param session - the session the override belongs to.
 * @param mode - the mode every subsequent confined call in this session runs
 *   under (until the next switch).
 */
/*
 * 中文说明：函数 setSandboxMode 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param session 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param mode 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function setSandboxMode(session: Session, mode: SandboxMode): void {
  session.append('sandbox/mode', { mode })
}
