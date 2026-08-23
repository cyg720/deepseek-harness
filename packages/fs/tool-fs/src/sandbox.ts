/**
 * ================================ 文件注释 ================================
 * 【文件职责】write/edit 两个工具共享的"沙箱升级 API"：按调用策略解析、升级字段的
 * 广告、拒绝标记映射——词汇与"失败即关闭"的批准序列全部委托给 dsh-sandbox
 * （dsh-tool-bash 用同一套），因此 bash 与 fs 的升级行为完全一致。
 * 【技术维度】FsSandboxController 按插件加载一次（依据 ctx.fs.sandboxMode 判断
 * 是否挂了限制性后端），供两个变更工具共享：schemaFields 生成升级参数 schema；
 * resolvePolicy 先校验升级参数配对，再解析会话常驻策略，若带升级参数则经
 * ctx.approval 走一次"严格更宽"的批准；mapError 把 FS_SANDBOX_DENIED 映射成
 * 带 [sandbox: …] 标记与升级提示的 FsError（保留结构化 code）。
 * 【产品维度】模型被沙箱拒绝时获得与 bash 一致的拒绝标记 + 单次升级路径，
 * 用户体验统一；拒绝只发生在进程内围栏（精确知道拒绝原因）。
 * 【逻辑维度】按出现顺序：FsEscalationArgs/EscalationSchemaFields（升级参数类型）→
 * FsSandboxController（escalationModes/policy 字段、constructor、schemaFields、
 * resolvePolicy、mapError）。
 * 【关键边界】限制性后端必须配有 ctx.sandboxPolicy（缺失即构造期报错）；升级只在
 * 有围栏后端时可用（否则参数直接报错）；mapError 只重写 FS_SANDBOX_DENIED（普通
 * Error 会丢失 code，ToolRuntime 只对 HarnessError 填充 result.error）。
 * 【新手阅读建议】先看 constructor 理解能力事实（escalationModes 怎么来的），
 * 再看 resolvePolicy 的批准链（常驻 → 升级），最后看 mapError 的标记映射。
 * ==========================================================================
 */
/**
 * The sandbox-escalation API shared by the `write` and `edit` tools: the
 * per-call policy resolution, the advertised escalation fields, and the denial-marker
 * mapping — all delegating the vocabulary and the fail-closed approval
 * sequence to `@deepseek-ai/dsh-sandbox` (the same pieces `@deepseek-ai/dsh-tool-bash`
 * uses), so bash and fs escalate identically. Built ONCE per plugin from
 * `ctx.fs.sandboxMode` (the capability fact — is a confining backend mounted?)
 * and shared by both mutating tools.
 *
 * @module @deepseek-ai/dsh-tool-fs/sandbox
 */
/**
 * 模块总览：本文件是 write/edit 与沙箱策略之间的"升级桥"。它复用 dsh-sandbox 的
 * 词汇与批准序列，保证文件操作与 bash 命令的沙箱体验一致。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { ESCALATION_TARGETS, approveEscalation, escalationHintMarker, sandboxDenialMarker, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { FsError } from '@deepseek-ai/dsh-fs'

/** The two escalation arguments a mutating tool may carry (advertised only under a confining backend). */
/**
 * 变更工具可能携带的两个升级参数（只在有围栏后端时才被广告给模型）。
 */
export interface FsEscalationArgs {
  sandbox_permissions?: string
  justification?: string
}

/** The schema fields for the escalation arguments, spread into a tool's `parameters` when a confining backend is mounted. */
/**
 * 升级参数的 schema 字段：有围栏后端时展开进工具的 parameters。
 */
export interface EscalationSchemaFields {
  sandbox_permissions: { type: 'string'; enum: string[]; description: string }
  justification: { type: 'string'; description: string }
}

/**
 * The filesystem escalation API: advertisement gating, per-call policy
 * resolution, the one-approved wider retry, and denial-marker mapping. A pure
 * product of `ctx` at plugin apply time.
 */
/**
 * 文件系统升级 API：广告门控、按调用策略解析、一次"经批准的更宽重试"、拒绝标记
 * 映射。是插件 apply 时刻 ctx 的纯函数产物。
 */
export class FsSandboxController {
  /** The escalation targets this composition advertises (`[]` when no confining backend is mounted). */
  /** 本组装广告的升级目标（未挂限制性后端时为空数组）。 */
  readonly escalationModes: readonly SandboxMode[]
  /** Shared per-session policy resolver, required by a confining backend. */
  /** 共享的按会话策略解析器（限制性后端必需）。 */
  private readonly policy: SandboxPolicyService | undefined

  constructor(private readonly ctx: Context) {
    // 能力事实：ctx.fs.sandboxMode 有值说明挂了限制性后端（可以升级），否则无升级。
    const defaultMode = ctx.fs.sandboxMode
    this.escalationModes = defaultMode === undefined ? [] : ESCALATION_TARGETS
    this.policy = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
    // 有围栏后端但缺 sandboxPolicy：fail fast（升级与按调用策略都无法工作）。
    if (defaultMode !== undefined && this.policy === undefined) {
      throw new Error('tool-fs: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
  }

  /**
   * The escalation schema fields for a mutating tool's `parameters`. Call it
   * only under a confining backend (guard on {@link escalationModes}); the
   * enum pins the closed target vocabulary, the strict-wider check happens per
   * call at execution.
   * @returns the two escalation parameter specs.
   */
  /**
   * 变更工具 parameters 里的升级 schema 字段。只在有围栏后端时调用（用
   * escalationModes 守卫）；enum 钉住闭合的目标词汇，"严格更宽"的检查在执行的
   * 每个调用时进行。
   * @returns 两个升级参数的规格。
   */
  schemaFields(): EscalationSchemaFields {
    return {
      sandbox_permissions: {
        type: 'string',
        enum: [...this.escalationModes],
        description: 'The wider sandbox mode this file operation needs. Only valid as a one-shot retry '
          + 'of an operation the sandbox just denied; requires justification and user approval.',
      },
      justification: {
        type: 'string',
        description: 'Required with sandbox_permissions: one sentence for the user explaining '
          + 'why this exact file operation needs the wider access.',
      },
    }
  }

  /**
   * The policy to stamp onto this mutation: an approved escalation grant (a
   * strictly wider retry resolved through `ctx.approval` before anything
   * executes), else the session's standing mode. The calling session's cwd is
   * always carried as the workspace root. Validates the escalation argument
   * pairing first.
   * @param toolName - the mutating tool's name, for the approval audit trail.
   * @param args - the call's escalation arguments.
   * @param exec - the tool-execution context (agent, callId, signal).
   * @returns the policy to pass to the mutation, or undefined for an
   *   unsandboxed backend.
   */
  /**
   * 要盖到本次变更上的策略：经批准的升级授权（严格更宽的重试，在一切执行之前经
   * ctx.approval 解析），否则是会话的常驻模式。调用会话的 cwd 始终作为工作区根
   * 携带。先校验升级参数的配对。
   * @param toolName 变更工具名（用于批准的审计轨迹）。
   * @param args 本次调用的升级参数。
   * @param exec 工具执行上下文（agent、callId、signal）。
   * @returns 传给变更的策略；无围栏后端时为 undefined。
   */
  async resolvePolicy(toolName: string, args: FsEscalationArgs, exec: ToolExecution): Promise<SandboxExecutionPolicy | undefined> {
    validateEscalationArgs(args.sandbox_permissions, args.justification)
    const standingPolicy = this.policy?.resolve({ ...exec.agent ? { session: exec.agent.session } : {} })
    if (args.sandbox_permissions === undefined || args.justification === undefined) {
      return standingPolicy
    }
    // 无围栏后端却带升级参数：本组装不可升级，直接报错。
    if (this.escalationModes.length === 0) {
      throw new Error('sandbox_permissions is not available in this composition (no sandboxing filesystem to escalate)')
    }
    const policy = standingPolicy as SandboxExecutionPolicy
    // 批准序列（失败即关闭）：请求模式必须是"当前模式 + 一个闭合目标"，经用户批准。
    const approvedMode = await approveEscalation(
      { requestedMode: args.sandbox_permissions, justification: args.justification, effectiveMode: policy.mode, subject: 'operation' },
      {
        approver: this.ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        toolName,
        signal: exec.signal,
      },
    )
    return { ...policy, mode: approvedMode }
  }

  /**
   * Map a thrown provider error for the model: a `FS_SANDBOX_DENIED` becomes a
   * `FsError` whose text is the shared `[sandbox: …]` denial marker plus the
   * same-turn escalation hint, so a policy denial reads identically to bash's
   * WHILE keeping the structured `FS_SANDBOX_DENIED` code — `ToolRuntime`
   * populates `result.error` only for `HarnessError` instances, so a plain
   * `Error` would strip the code retry/observers key off. Any other error
   * passes through unchanged. A `FS_SANDBOX_DENIED` only arises under a
   * confining backend, which always advertises the escalation fields, so the
   * hint always applies here.
   * @param error - the error thrown by the mutation.
   * @param policy - the policy stamped onto the call (names the mode in the marker).
   * @returns the error to throw — the marker `FsError` for a sandbox denial, else the original.
   */
  /**
   * 为模型映射提供者抛出的错误：FS_SANDBOX_DENIED 变成文本为共享 [sandbox: …] 拒绝
   * 标记 + 同轮升级提示的 FsError——策略拒绝读起来与 bash 完全一致，同时保留结构化
   * FS_SANDBOX_DENIED code。原因：ToolRuntime 只对 HarnessError 实例填充
   * result.error，普通 Error 会被剥掉 code（重试/观察者会失去关键信息）。
   * 其它错误原样穿透。FS_SANDBOX_DENIED 只会在有围栏后端下出现，而它总是广告
   * 升级字段，所以这里提示总是适用。
   * @param error 变更抛出的错误。
   * @param policy 盖在调用上的策略（标记里点名模式）。
   * @returns 要抛的错误——沙箱拒绝时是带标记的 FsError，否则是原错误。
   */
  mapError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown {
    if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
    // A FS_SANDBOX_DENIED only arises under a confining backend, whose tool
    // path always resolves a policy before mutation.
    // 中文说明：FS_SANDBOX_DENIED 只会在有围栏后端下出现，而它的工具路径在变更前
    // 总是先解析策略，所以 policy 必然存在。
    const mode = (policy as SandboxExecutionPolicy).mode
    return new FsError(`${sandboxDenialMarker(mode)}\n${escalationHintMarker('operation')}`, 'FS_SANDBOX_DENIED', { cause: error })
  }
}
