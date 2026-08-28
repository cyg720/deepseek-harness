/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现 bash 工具的模型侧消费者（Consumer）：注册名为 `bash` 的工具，把模型
 * 参数翻译成 ctx.shell 的请求并执行，负责参数校验、工作目录解析、沙箱升级审批、
 * 后台任务登记（ctx.jobs）与结果/展示规范化。
 * 【技术维度】defineTool + ctx.tools.register 注册；execute 内先审批后执行（升级流程委托
 * approveEscalation）；后台路径经 ctx.jobs.start 登记，工具调用信号在返回 job id 后不再
 * 驱动取消；输出 schema 用 oneOf 区分后台/前台两种形状；presentCall/presentResult 把
 * 前台调用画成 terminal 卡片、后台画成 generic 卡片。
 * 【产品维度】模型执行 bash 命令的入口：既有前台（等结果）也有后台（长任务先拿 job id），
 * 沙箱拒绝时引导模型同轮用 sandbox_permissions 发起审批升级；描述文本引导模型检查
 * [exit code: N] 标记、使用受管 DSH_* 环境事实。
 * 【逻辑维度】validateBashArgs 校验参数 → resolveSandboxPolicy 取会话策略 → 可选
 * approveBashEscalation 审批升级 → resolveWorkdir 解析工作目录 → 前台/后台分流执行 →
 * canonicalBashResult / renderResult 规范化输出。
 * 【关键边界】执行策略（部署级）应放 tools/pre-execute 与沙箱执行器（见 TODO 标记）；
 * 未宣传沙箱能力时 sandbox_permissions 字段不注册但仍需守卫（schema 只校验已宣传的键）。
 * 【新手阅读建议】先看 apply 里工具注册的参数与输出 schema，再沿 execute 走一遍
 * 前台路径，最后看后台路径如何与 ctx.jobs 协作。
 * ==========================================================================
 */

/**
 * Model-facing Consumer of the `ctx.shell` capability seam. Background calls
 * register process handles with `ctx.jobs`; their work uses job cancellation
 * rather than the tool-call signal after an id is returned.
 *
 * TODO(permissions): deployment policy belongs in `tools/pre-execute` and
 * sandboxing executors; see docs/architecture.md § Where new behavior goes.
 * @module @deepseek-ai/dsh-tool-bash
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { defineTool, TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, TerminalCallView, ToolExecution, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-shell-env'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { ESCALATION_TARGETS, approveEscalation, canonicalPath, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { DSH_ENV_PREFIX } from '@deepseek-ai/dsh-shell'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import { processOutcome } from './background.ts'
import { parseExitStatus, renderProcessRead, renderResult } from './render.ts'

export const name = 'tool-bash'
export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv']

/** Configuration for the bash tool. */
/* bash 工具的配置。 */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  /* 是否暴露 run_in_background 参数（默认 true）；禁用时相关调用也会被拒绝。 */
  enableRunInBackground?: boolean
}

/** Runtime configuration schema for the bash tool plugin. */
/* bash 工具插件的运行时配置 schema。 */
export const Config: z<Config> = z.object({
  enableRunInBackground: z.boolean().default(true),
})

/** Parsed tool args; execute validates value constraints absent from ParameterSchemaSpec. */
/* 解析后的工具参数；execute 负责校验 ParameterSchemaSpec 表达不了的取值约束。 */
interface BashToolArgs {
  command: string
  description: string
  timeoutMs?: number
  workdir?: string
  run_in_background?: boolean
  sandbox_permissions?: string
  justification?: string
}

/**
 * 校验工具参数的基本约束：命令/描述非空、超时为正数，并复用一个共享规则校验
 * sandbox_permissions 与 justification 的配对关系。
 */
function validateBashArgs(args: BashToolArgs): void {
  if (args.command.trim().length === 0) {
    throw new Error('invalid command: expected a non-empty string')
  }
  if (args.description.trim().length === 0) {
    throw new Error('invalid description: expected a non-empty string')
  }
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(args.timeoutMs)}`)
  }
  // The escalation pairing (sandbox_permissions ⇔ justification, non-empty) is
  // the shared rule both enforcing families validate identically.
  // 升级配对规则（sandbox_permissions 与 justification 成对且非空）是两个强制族共用的共享规则。
  validateEscalationArgs(args.sandbox_permissions, args.justification)
}

/**
 * 组装工具的模型可见描述：讲解前台/后台用法、DSH_* 环境事实、沙箱拒绝语义；
 * 当组合体宣传升级能力时，追加一段同轮升级的完整指引（何时可以、何时禁止）。
 */
function bashDescription(backgroundEnabled: boolean, escalationModes: readonly SandboxMode[]): string {
  const background = backgroundEnabled
    ? 'Set `run_in_background: true` for long-running commands: the call returns a job id immediately; read its output with `job_output` and stop it with `job_kill`.'
    : 'Background execution is not available; long-running commands must finish within the timeout.'
  const base = 'Execute a bash command (`bash -c`) and return its stdout/stderr. '
    + 'Each call runs in a fresh shell: no state (cwd, variables, functions) persists between calls — '
    + 'pass `workdir` instead of using `cd`. Non-zero exits are reported as `[exit code: N]`. '
    + `Current harness environment facts are exposed through managed \`$${DSH_ENV_PREFIX}*\` variables; inspect them when needed. `
    + 'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way. '
    + 'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. '
    + background
  if (escalationModes.length === 0) return base
  return base + ' Attempting a command the sandbox may deny is safe and expected: run it and read the '
    + 'marker rather than assuming the denial. When a command is denied and a wider mode would let it '
    + 'succeed, escalate immediately in the same turn — the one sanctioned exception to a denial: retry '
    + 'the exact same command once with `sandbox_permissions` (the narrowest wider mode that suffices) '
    + 'plus a one-sentence `justification`. Do not detour through chat to ask permission first — the '
    + 'approval prompt raised by that retry is how the user consents. If the session states approval '
    + 'prompts are disabled, there is no exception: a denial is final — do not set `sandbox_permissions`. '
    + 'Never escalate speculatively: ground the request in a real denial — normally the one this command '
    + 'just hit; escalating up front is fine only when this session already denied the same access. '
    + 'A rejected escalation is final for that command — stop and explain, never work around '
    + 'it — but it does not forbid attempting or escalating other commands later.'
}

/**
 * Present foreground calls as terminals and background starts as generic cards.
 * The command remains the title on both paths; foreground cwd is passed through
 * for the bridge to resolve, while background descriptions remain card content.
 */
/*
 * 前台调用展示为 terminal 卡片，后台启动展示为 generic 卡片。两种路径都以命令为标题；
 * 前台 cwd 透传给桥接层解析，后台描述作为卡片内容保留。
 */
type BashCallArgs = { command: string; description: string; workdir?: string; run_in_background?: boolean }

function presentBashCall(args: BashCallArgs): GenericCallView | TerminalCallView {
  if (args.run_in_background === true) {
    return {
      card: 'generic',
      title: args.command,
      kind: 'execute',
      rawInput: args.command,
      content: [{ type: 'text', text: args.description }],
    }
  }
  return {
    card: 'terminal',
    title: args.command,
    description: args.description,
    ...args.workdir !== undefined ? { cwd: args.workdir } : {},
  }
}

/**
 * Present completed foreground output as a terminal; background acknowledgements
 * and execution errors use generic fenced output without an exit-status pill.
 */
/*
 * 已完成的前台输出展示为 terminal 卡片；后台确认与执行错误用 generic 围栏输出，
 * 不带退出状态徽章。
 */
function presentBashResult(args: unknown, result: ToolResult): ToolResultView | undefined {
  const block = result.content.length === 1 ? result.content[0] : undefined
  if (block === undefined || block.type !== 'text') return undefined
  const raw = block.text
  const isBackground = typeof args === 'object' && args !== null && (args as { run_in_background?: unknown }).run_in_background === true
  // Background acknowledgements and errors have no terminal exit status.
  // 后台确认与错误没有终端退出状态。
  if (isBackground || result.isError) {
    return { card: 'generic', content: [{ type: 'text', text: `\`\`\`console\n${raw.replace(/\n+$/, '')}\n\`\`\`` }] }
  }
  // The exit marker becomes the card's exit pill, so it leaves the output body.
  // 退出标记成为卡片的退出徽章，因此从输出正文中剥离。
  const { body, ...exit } = parseExitStatus(raw)
  return { card: 'terminal', output: body, ...exit }
}

/**
 * Resolve an explicit workdir first, making a relative one session-workspace-relative;
 * otherwise use the filesystem identity of the session cwd and leave executor
 * defaulting as the fallback. A resolved sandbox-policy root wins so workdir
 * and confinement use the exact same per-call identity.
 */
/*
 * 解析显式 workdir：相对路径按会话工作区解析；未指定时使用会话 cwd 的文件系统身份，
 * 把执行器默认值作为兜底。已解析的沙箱策略根目录优先，这样工作目录与隔离范围
 * 使用完全相同的按调用身份。
 */
function resolveWorkdir(
  modelWorkdir: string | undefined,
  exec: { agent?: Agent },
  policyWorkspaceRoot?: string,
): string | undefined {
  const headerCwd = exec.agent?.session.header.cwd
  const sessionCwd = policyWorkspaceRoot ?? (headerCwd === undefined ? undefined : canonicalPath(headerCwd))
  if (modelWorkdir === undefined) return sessionCwd
  if (sessionCwd !== undefined && !isAbsolute(modelWorkdir)) {
    return resolvePath(sessionCwd, modelWorkdir)
  }
  return modelWorkdir
}

/** Detach the executor DTO from readonly Service Definition types into plain JSON data. */
/* 把执行器 DTO 从只读的 Service Definition 类型剥离为普通 JSON 数据（序列化前清理）。 */
function canonicalBashResult(result: ShellRunResult) {
  const output = (stream: ShellRunResult['stdout']) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {},
  })
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    stdout: output(result.stdout),
    stderr: output(result.stderr),
    ...result.sandbox !== undefined ? {
      sandbox: {
        mode: result.sandbox.mode,
        denied: result.sandbox.denied,
        ...result.sandbox.enforcement !== undefined ? { enforcement: result.sandbox.enforcement } : {},
        ...result.sandbox.runnerFailed !== undefined ? { runnerFailed: result.sandbox.runnerFailed } : {},
      },
    } : {},
  }
}

/** Canonical background-handle properties shared by the bash output union. */
/* bash 输出联合类型中共享的规范化后台句柄属性（kind 恒为 background，带 jobId）。 */
const BACKGROUND_OUTPUT_PROPERTIES = {
  kind: { type: 'string', required: true, const: 'background' },
  jobId: { type: 'string', required: true },
} as const

export function apply(ctx: Context, config: Config = {}): void {
  // 依配置决定是否启用后台；再依据所挂执行器是否沙箱化决定是否宣传升级字段。
  const backgroundEnabled = config.enableRunInBackground ?? true
  const defaultMode = ctx.shell.sandboxMode
  const escalationModes: readonly SandboxMode[] = defaultMode === undefined ? [] : ESCALATION_TARGETS
  const sandboxPolicy: SandboxPolicyService | undefined = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (defaultMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('tool-bash: the mounted bash executor confines but ctx.sandboxPolicy is missing')
  }
  /** Resolve the complete standing policy for this call when a confining executor is mounted. */
  /* 当挂载了受限执行器时，为本次调用解析完整的常驻策略（无 agent 时传空会话）。 */
  const resolveSandboxPolicy = (exec: ToolExecution): SandboxExecutionPolicy | undefined =>
    sandboxPolicy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })

  /**
   * Resolve a sandbox-escalation request through `ctx.approval` BEFORE
   * anything executes, delegating the shared fail-closed sequence (strict
   * widening, channel resolution, outcome mapping) to
   * {@link approveEscalation}. This tool contributes only the composition
   * guard (the fields are unadvertised without a sandboxing executor, yet
   * schema validation checks advertised keys only, so an unadvertised
   * `sandbox_permissions` still reaches execute) and the approval
   * ingredients. The shared policy resolver is required whenever the executor
   * advertises confinement, so a split composition fails at tool-plugin load.
   */
  /*
   * 在任何执行发生之前，经 ctx.approval 处理沙箱升级请求，把共享的"失败即关闭"序列
   * （严格加宽、渠道解析、结果映射）委托给 approveEscalation。本工具只贡献组合体守卫
   * （无沙箱执行器时这些字段不宣传，但 schema 只校验已宣传的键，未宣传的
   * sandbox_permissions 仍会到达 execute，故须在此拦截）与审批所需素材。
   * 执行器宣传隔离时必须有共享策略解析器，否则拆分的组合体在工具插件加载时就失败。
   */
  const approveBashEscalation = (
    mode: string,
    justification: string,
    exec: ToolExecution,
    standingPolicy: SandboxExecutionPolicy | undefined,
  ): Promise<SandboxMode> => {
    if (escalationModes.length === 0) {
      throw new Error('sandbox_permissions is not available in this composition (no sandboxing executor to escalate)')
    }
    // 以常驻策略的当前模式作为"有效模式"（升级基准）。
    const effectiveMode = (standingPolicy as SandboxExecutionPolicy).mode
    return approveEscalation(
      { requestedMode: mode, justification, effectiveMode, subject: 'command' },
      {
        approver: ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        toolName: 'bash',
        signal: exec.signal,
      },
    )
  }

  // Cross-call guidance belongs in the prompt rather than one-call schema prose.
  // 跨调用的行为指引放进系统提示词，而不是每次调用的 schema 描述里。
  ctx.systemPrompt.section({
    name: 'tool:bash',
    order: FIRST_PARTY_SECTION_ORDER.TOOL_BASH,
    text: 'Check the [exit code: N] marker on every bash result; investigate failures before moving on.',
  })

  // 注册 bash 工具：参数 schema 按"是否宣传后台/升级"条件展开，输出用 oneOf 区分形状。
  ctx.tools.register(defineTool({
    name: 'bash',
    description: bashDescription(backgroundEnabled, escalationModes),
    parameters: {
      command: { type: 'string', required: true, description: 'The bash command to execute.' },
      description: {
        type: 'string',
        required: true,
        description: 'Clear, concise description of what this command does in active voice, '
          + '5-10 words (shown in the UI). Examples: "ls" → "List files in current directory"; '
          + '"git status" → "Show working tree status"; "npm install" → "Install package dependencies".',
      },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.' },
      workdir: { type: 'string', description: 'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.' },
      ...backgroundEnabled ? {
        run_in_background: { type: 'boolean' as const, description: 'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.' },
      } : {},
      ...escalationModes.length > 0 ? {
        sandbox_permissions: {
          type: 'string' as const,
          enum: [...escalationModes],
          description: 'The wider sandbox mode this command needs. Only valid as a one-shot retry of a command the sandbox just denied; requires justification and user approval.',
        },
        justification: {
          type: 'string' as const,
          description: 'Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access.',
        },
      } : {},
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: BACKGROUND_OUTPUT_PROPERTIES,
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
              signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              timedOut: { type: 'boolean', required: true },
              aborted: { type: 'boolean', required: true },
              timeoutMs: { type: 'number', required: true },
              stdout: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  text: { type: 'string', required: true },
                  truncated: { type: 'boolean', required: true },
                  spillPath: { type: 'string' },
                },
              },
              stderr: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  text: { type: 'string', required: true },
                  truncated: { type: 'boolean', required: true },
                  spillPath: { type: 'string' },
                },
              },
              sandbox: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  mode: { type: 'string', required: true },
                  denied: { type: 'boolean', required: true },
                  enforcement: { type: 'string' },
                  runnerFailed: { type: 'boolean' },
                },
              },
            },
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background job ${value.jobId}`
          : renderResult(value as { kind: 'foreground' } & ShellRunResult, escalationModes),
      }],
    },
    async execute(args: BashToolArgs, exec) {
      validateBashArgs(args)
      // Description is display metadata; workdir defaults to the caller's session.
      // description 只是展示元数据；workdir 缺省取调用方会话。
      const standingPolicy = resolveSandboxPolicy(exec)
      // 仅当模型同时给出 sandbox_permissions 与 justification 时才进入审批流程。
      const approvedMode = args.sandbox_permissions !== undefined && args.justification !== undefined
        ? await approveBashEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy)
        : undefined
      // 审批通过后把升级模式盖到策略上，构成本次调用的最终沙箱策略。
      const policy = approvedMode === undefined
        ? standingPolicy
        : { ...(standingPolicy as SandboxExecutionPolicy), mode: approvedMode }
      const workdir = resolveWorkdir(args.workdir, exec, standingPolicy?.workspaceRoot)
      // 收集本次调用的受管 DSH_* 环境快照（来自 ctx.shellEnv）。
      const dshEnv = ctx.shellEnv.collect(exec)
      const request = {
        command: args.command,
        ...workdir !== undefined ? { workdir } : {},
        ...args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {},
        dshEnv,
        ...policy !== undefined ? { sandboxPolicy: policy } : {},
      }
      if (args.run_in_background === true) {
        // Undeclared keys are allowed, so schema omission also needs enforcement.
        // schema 允许未声明键通过，因此这里还要显式强制"已禁用则拒绝"。
        if (!backgroundEnabled) {
          throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
        }
        const jobs = ctx.get('jobs')
        if (jobs === undefined) {
          throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
        }
        // The caller owns cancellation until ctx.jobs commits detached ownership.
        // 在 ctx.jobs 接管脱离式所有权之前，取消仍归调用方所有。
        if (exec.signal.aborted) {
          const error = new HarnessError('tool call aborted', TOOL_ABORTED)
          error.name = 'AbortError'
          throw error
        }
        // Task preflight finishes before the starter can spawn a process.
        // 任务预检（上面的守卫）全部通过后，stater 才能去 spawn 进程。
        const id = jobs.start({
          kind: 'bash',
          label: args.command,
          ...exec.agent ? { owner: exec.agent } : {},
          run: () => {
            // 后台执行：由 ctx.shell.start 启动，取消/完成/读取都映射为通用任务接口。
            const proc = ctx.shell.start(ctx.shell.resolve(request))
            return {
              cancel: () => void proc.kill(),
              done: proc.done.then(() => processOutcome(proc)),
              readOutput: () => renderProcessRead(proc.readOutput(), proc.sandbox, escalationModes),
            }
          },
        })
        return { kind: 'background' as const, jobId: id }
      }
      // 前台执行：携带调用方信号，run 完成后若被 abort 则抛标准工具中止错误。
      const result = await ctx.shell.run(ctx.shell.resolve({
        ...request,
        signal: exec.signal,
      }))
      if (result.aborted) {
        const error = new HarnessError('tool call aborted', TOOL_ABORTED)
        error.name = 'AbortError'
        throw error
      }
      return { kind: 'foreground' as const, ...canonicalBashResult(result) }
    },
    presentCall: presentBashCall,
    presentResult: presentBashResult,
  }))
}
