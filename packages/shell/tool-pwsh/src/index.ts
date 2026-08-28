/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现 pwsh 工具的模型侧消费者（Consumer）：面向 Windows 组合体（ctx.shell 由
 * PowerShell 执行器支撑），注册名为 `pwsh` 的工具，行为逐调用镜像 dsh-tool-bash——
 * 前台/后台执行、受管 DSH_* 环境、按调用沙箱策略、拒绝渲染与同轮升级审批、标记/截断渲染。
 * 【技术维度】defineTool + ctx.tools.register；execute 先审批后执行（approveEscalation）；
 * 后台经 ctx.jobs.start 登记（JobKindMap 声明 pwsh 种类）；输出 schema 与 bash 版按契约对称
 * （一方消费者必须能接受另一方）；多个实现段因刻意镜像而分块包在 jscpd:ignore 内。
 * 【产品维度】Windows 上模型执行 PowerShell 命令的入口：原生 C:\... 路径与 $env:NAME 变量；
 * 前台完成调用展示为带退出状态徽章的 terminal 卡片；沙箱拒绝时引导同轮升级审批。
 * 【逻辑维度】validatePwshArgs 校验 → resolveSandboxPolicy 取策略 → 可选审批升级 →
 * resolveWorkdir 解析工作目录 → 前台/后台分流 → canonicalPwshResult / renderPwshResult 规范化。
 * 【关键边界】Windows 受限令牌沙箱下语言模式/命名管道行为的描述仅适用于 win32 组合体
 * （见函数内注释）；未宣传沙箱能力时 sandbox_permissions 仍可能到达 execute，须守卫。
 * 【新手阅读建议】先对照 dsh-tool-bash/index.ts 找共性，再重点看差异：declare module 的
 * job 种类、pwshDescription 的 Windows 专属段落、canonicalPwshResult 的形状。
 * ==========================================================================
 */

/**
 * Model-facing PowerShell Consumer of the `ctx.shell` capability seam. Intended for
 * Windows compositions where a PowerShell executor (e.g.
 * `@deepseek-ai/dsh-pwsh-local`) backs `ctx.shell`; the tool contract is
 * PowerShell-dialect: native `C:\...` paths and `$env:NAME` variables.
 *
 * Behavior mirrors `dsh-tool-bash` call-for-call: foreground and
 * `run_in_background` execution (background handles register with the
 * generic `ctx.jobs` runtime), the managed `DSH_*` environment through the
 * shared `shell-env` registry, the per-call sandbox policy resolution (the
 * calling session's mode and cwd travel to the confining executor), the
 * sandbox-denial rendering with the same-turn escalation surface
 * (`sandbox_permissions` + `justification` resolved through
 * `ctx.approval`), and the bash marker/truncation rendering story. UI
 * presentation mirrors the bash tool's too: a completed foreground call is
 * a terminal card with the parsed exit-status pill, using the shared
 * exit-status parse from `@deepseek-ai/dsh-shell`.
 *
 * @module @deepseek-ai/dsh-tool-pwsh
 */

import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, TerminalCallView, ToolExecution, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { ESCALATION_TARGETS, approveEscalation, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import { parseExitStatus } from '@deepseek-ai/dsh-shell'
import { processOutcome } from './background.ts'
import { renderPwshProcessRead, renderPwshResult } from './render.ts'
import type { RenderablePwshResult } from './render.ts'

declare module '@deepseek-ai/dsh-jobs' {
  // 把 'pwsh' 声明为合法的 job 种类（模块增强），后台任务登记时使用 kind: 'pwsh'。
  interface JobKindMap {
    pwsh: 'pwsh'
  }
}

export const name = 'tool-pwsh'
export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv']

/** Configuration for the pwsh tool. */
/* pwsh 工具的配置。 */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  /* 是否暴露 run_in_background 参数（默认 true）；禁用时相关调用也会被拒绝。 */
  enableRunInBackground?: boolean
}

/** Runtime configuration schema for the pwsh tool plugin. */
/* pwsh 工具插件的运行时配置 schema。 */
export const Config: z<Config> = z.object({
  enableRunInBackground: z.boolean().default(true),
})

/** Parsed tool args; execute validates value constraints absent from ParameterSchemaSpec. */
/* 解析后的工具参数；execute 负责校验 ParameterSchemaSpec 表达不了的取值约束。 */
interface PwshToolArgs {
  command: string
  description: string
  timeoutMs?: number
  workdir?: string
  run_in_background?: boolean
  sandbox_permissions?: string
  justification?: string
}

/** The canonical foreground result of one pwsh call (the `output.schema` value shape). */
/* 一次 pwsh 调用的规范化前台结果（与 output.schema 的值形状一致）。 */
interface PwshForegroundResult {
  kind: 'foreground'
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  aborted: boolean
  timeoutMs: number
  stdout: { text: string; truncated: boolean; spillPath?: string }
  stderr: { text: string; truncated: boolean; spillPath?: string }
  sandbox?: { mode: string; denied: boolean; enforcement?: string; runnerFailed?: boolean }
}

/**
 * 下面的校验函数与 execute 管道是 dsh-tool-bash 的最小镜像（pragma 豁免重复检测）。
 * 校验工具参数的基本约束：命令/描述非空、超时为正数，并复用共享规则校验
 * sandbox_permissions 与 justification 的配对。
 */
/* jscpd:ignore-start -- minimal mirror of dsh-tool-bash's validation and execute plumbing (Agent Note). */
function validatePwshArgs(args: PwshToolArgs): void {
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
/* jscpd:ignore-end */

/**
 * 组装工具的模型可见描述：讲解前台/后台用法、原生 Windows 路径与 $env:NAME 读取、
 * Windows 强制终止语义（无信号标记、裸 exit 1 视为中断），以及受限令牌沙箱下的
 * 语言模式/命名管道边界与同轮升级指引。
 */
function pwshDescription(backgroundEnabled: boolean, escalationModes: readonly SandboxMode[]): string {
  const background = backgroundEnabled
    ? 'Set `run_in_background: true` for long-running commands: the call returns a job id immediately; read its output with `job_output` and stop it with `job_kill`.'
    : 'Background execution is not available; long-running commands must finish within the timeout.'
  const base = 'Execute a PowerShell command (`pwsh -Command`) and return its stdout/stderr. '
    + 'Each call runs in a fresh pwsh process: no state (cwd, variables, functions) persists between calls — '
    + 'pass `workdir` instead of using `cd`. Paths use native Windows form (`C:\\...`); read environment '
    + 'variables with `$env:NAME`. Non-zero exits are reported as `[exit code: N]`. '
    + 'Current harness environment facts are exposed through managed `$env:DSH_*` variables; inspect them when needed. '
    + 'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way. '
    + 'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. '
    + 'On Windows a force-killed command settles as `[exit code: 1]` without a signal marker — treat it as an interruption, not a command failure. '
    + background
  if (escalationModes.length === 0) return base
  // The language-mode and named-pipe contracts below are Windows-restricted-token
  // behavior, but the gate is 'any confining executor is mounted'
  // (escalationModes non-empty). Every shipped composition pairing tool-pwsh
  // with a confining executor is win32-only, so the gate is equivalent. A POSIX
  // pwsh-sandbox composition must gate both sentences on the platform instead
  // (tracked in the pwsh-tool-and-executor Agent Note).
  return base + ' Under the Windows sandbox, read-only pwsh runs in PowerShell ConstrainedLanguage mode, while '
    + 'workspace-write stays in FullLanguage unless host policy says otherwise. In read-only, prefer cmdlets and core types (`[string]`, `[datetime]`, `[regex]`, `[guid]`); '
    + '.NET static calls (`[System.IO.*]::`, `[math]::`), `Add-Type`, COM objects, and reflection fail '
    + 'with "only core types" errors. `-f` formatting, property access, and core cmdlets work. '
    + 'In both confined modes, programs cannot open named pipes, so a command that captures another '
    + 'program\'s output through piped stdio (Node.js `child_process.spawn`/`exec` with the default '
    + '`stdio: \'pipe\'`) fails with EPERM, while `stdio: \'inherit\'` and `stdio: \'ignore\'` spawns '
    + 'work and PowerShell\'s own pipelines are unaffected. That EPERM is the documented boundary: '
    + 'do not retry the command another way — escalate the exact command once or restructure it to '
    + 'avoid capturing output. '
    + 'Attempting a command the sandbox may deny is safe and expected: run it and read the '
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
 * Resolve an explicit workdir first, making a relative one session-workspace-relative;
 * otherwise use the session header cwd and leave executor defaulting as the fallback.
 */
/*
 * 解析显式 workdir：相对路径按会话工作区解析；未指定时使用会话头 cwd，把执行器默认值
 * 作为兜底（pwsh 版没有沙箱策略根目录参与的版本，因为策略根由执行器侧处理）。
 */
function resolveWorkdir(modelWorkdir: string | undefined, exec: { agent?: Agent }): string | undefined {
  const headerCwd = exec.agent?.session.header.cwd
  if (modelWorkdir === undefined) return headerCwd
  if (headerCwd !== undefined && !isAbsolute(modelWorkdir)) {
    return resolvePath(headerCwd, modelWorkdir)
  }
  return modelWorkdir
}

/** Detach the executor DTO from readonly Service Definition types into plain JSON data. */
/* 把执行器 DTO 从只读的 Service Definition 类型剥离为普通 JSON 数据（序列化前清理）。 */
function canonicalPwshResult(result: ShellRunResult): PwshForegroundResult {
  const output = (stream: ShellRunResult['stdout']) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {},
  })
  return {
    kind: 'foreground',
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    /* jscpd:ignore-start -- the canonical projection and background-handle shape mirror dsh-tool-bash's by design (Agent Note). */
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

/** Canonical background-handle properties shared by the pwsh output union. */
/* pwsh 输出联合类型中共享的规范化后台句柄属性（kind 恒为 background，带 jobId）。 */
const BACKGROUND_OUTPUT_PROPERTIES = {
  kind: { type: 'string', required: true, const: 'background' },
  jobId: { type: 'string', required: true },
} as const
/* jscpd:ignore-end */

/**
 * 注册 pwsh 工具。下面的 apply 前奏与 bash 工具的 apply 前奏刻意镜像（pragma 豁免）：
 * 依配置决定是否启用后台，依据所挂执行器是否沙箱化决定是否宣传升级字段。
 */
/* jscpd:ignore-start -- deliberate mirror of dsh-tool-bash's apply() preamble (pwsh-tool-and-executor Agent Note). */
export function apply(ctx: Context, config: Config = {}): void {
  const backgroundEnabled = config.enableRunInBackground ?? true
  const defaultMode = ctx.shell.sandboxMode
  const escalationModes: readonly SandboxMode[] = defaultMode === undefined ? [] : ESCALATION_TARGETS
  const sandboxPolicy: SandboxPolicyService | undefined = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (defaultMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('tool-pwsh: the mounted bash executor confines but ctx.sandboxPolicy is missing')
  }
  /* jscpd:ignore-end */
  /** Resolve the complete standing policy for this call when a confining executor is mounted. */
  /* 当挂载了受限执行器时，为本次调用解析完整的常驻策略（无 agent 时传空会话）。 */
  const resolveSandboxPolicy = (exec: ToolExecution): SandboxExecutionPolicy | undefined =>
    sandboxPolicy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })

  /* jscpd:ignore-start -- deliberate mirror of dsh-tool-bash's escalation resolver (pwsh-tool-and-executor Agent Note). */
  /**
   * Resolve a sandbox-escalation request through `ctx.approval` BEFORE
   * anything executes, delegating the shared fail-closed sequence (strict
   * widening, channel resolution, outcome mapping) to
   * {@link approveEscalation}. This tool contributes only the composition
   * guard (the fields are unadvertised without a sandboxing executor, yet
   * schema validation checks advertised keys only, so an unadvertised
   * `sandbox_permissions` still reaches execute) and the approval
   * ingredients. The shared policy resolver is required whenever the
   * executor advertises confinement, so a split composition fails at
   * tool-plugin load.
   */
  /*
   * 在任何执行发生之前，经 ctx.approval 处理沙箱升级请求，把共享的"失败即关闭"序列
   * （严格加宽、渠道解析、结果映射）委托给 approveEscalation（与 bash 版镜像）。
   * 执行器宣传隔离时必须有共享策略解析器，否则拆分的组合体在工具插件加载时就失败。
   */
  const approvePwshEscalation = (
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
        toolName: 'pwsh',
        signal: exec.signal,
      },
    )
  }
  /* jscpd:ignore-end */

  // 跨调用指引放进系统提示词：强调 Windows 上被杀进程落定为裸 exit 1 的语义。
  ctx.systemPrompt.section({
    name: 'tool:pwsh',
    order: FIRST_PARTY_SECTION_ORDER.TOOL_PWSH,
    text: 'Non-zero exits are reported as `[exit code: N]` markers; investigate failures before moving on. '
      + 'On Windows a killed process settles as `[exit code: 1]` without a signal marker; treat a bare exit 1 after an interruption as a termination, not a command failure.',
  })

  ctx.tools.register(defineTool({
    name: 'pwsh',
    description: pwshDescription(backgroundEnabled, escalationModes),
    /* jscpd:ignore-start -- deliberate mirror of dsh-tool-bash's parameter surface (pwsh-tool-and-executor Agent Note). */
    parameters: {
      command: { type: 'string', required: true, description: 'The PowerShell command to execute.' },
      description: {
        type: 'string',
        required: true,
        description: 'Clear, concise description of what this command does in active voice, '
          + '5-10 words (shown in the UI). Examples: "ls" → "List files in current directory"; '
          + '"git status" → "Show working tree status"; "Get-Process" → "List running processes".',
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
    /* jscpd:ignore-end */
    output: {
      // The foreground result wire shape mirrors dsh-tool-bash's by contract —
      // consumers of one must accept the other (see the pwsh-tool-and-executor
      // Agent Note).
      // 前台结果的线上形状按契约与 dsh-tool-bash 镜像：一方的消费者必须能接受另一方。
      /* jscpd:ignore-start -- deliberate result-schema symmetry with dsh-tool-bash. */
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
      /* jscpd:ignore-end */
      /** 结果渲染：后台确认返回一行提示；前台结果交给 renderPwshResult 生成模型文本。 */
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background job ${value.jobId}`
          : renderPwshResult(value as RenderablePwshResult, escalationModes),
      }],
    },
    /**
     * execute 路径与 bash 工具的按设计镜像（pragma 豁免）：先校验与审批，再前台/后台分流。
     */
    /* jscpd:ignore-start -- the execute path mirrors dsh-tool-bash's by design (see the pwsh-tool-and-executor Agent Note). */
    async execute(args: PwshToolArgs, exec) {
      validatePwshArgs(args)
      // Description is display metadata; workdir defaults to the caller's session.
      // description 只是展示元数据；workdir 缺省取调用方会话。
      const standingPolicy = resolveSandboxPolicy(exec)
      // 仅当模型同时给出 sandbox_permissions 与 justification 时才进入审批流程。
      const approvedMode = args.sandbox_permissions !== undefined && args.justification !== undefined
        ? await approvePwshEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy)
        : undefined
      // 审批通过后把升级模式盖到策略上，构成本次调用的最终沙箱策略。
      const policy = approvedMode === undefined
        ? standingPolicy
        : { ...(standingPolicy as SandboxExecutionPolicy), mode: approvedMode }
      const workdir = resolveWorkdir(args.workdir, exec)
      // 收集本次调用的受管 DSH_* 环境快照（来自 ctx.shellEnv）。
      const request = {
        command: args.command,
        ...workdir !== undefined ? { workdir } : {},
        ...args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {},
        dshEnv: ctx.shellEnv.collect(exec),
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
        // 任务预检（上面的守卫）全部通过后，starter 才能去 spawn 进程。
        const id = jobs.start({
          kind: 'pwsh',
          label: args.command,
          ...exec.agent ? { owner: exec.agent } : {},
          run: () => {
            // 后台执行：由 ctx.shell.start 启动，取消/完成/读取都映射为通用任务接口。
            const proc = ctx.shell.start(ctx.shell.resolve(request))
            return {
              cancel: () => void proc.kill(),
              done: proc.done.then(() => processOutcome(proc)),
              readOutput: () => renderPwshProcessRead(proc.readOutput(), proc.sandbox, escalationModes),
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
      return canonicalPwshResult(result)
    },
    /* jscpd:ignore-end */
    /**
     * 调用卡片的呈现与 bash 工具按设计镜像：后台启动显示 generic 卡片，前台显示 terminal 卡片。
     */
    /* jscpd:ignore-start -- the background call card mirrors presentBashCall's by design (Agent Note). */
    presentCall: (args: PwshToolArgs): TerminalCallView | GenericCallView => {
      // Background acknowledgements carry no terminal exit status; the generic
      // card mirrors the bash tool's background presentation.
      // 后台确认没有终端退出状态；generic 卡片镜像 bash 工具的后台呈现。
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
    },
    /* jscpd:ignore-end */
    /**
     * 完成结果的呈现与 bash 工具按设计镜像：前台输出解析出退出徽章，其余用 generic 围栏。
     */
    /* jscpd:ignore-start -- the completed-result presentation mirrors presentBashResult's by design (Agent Note). */
    presentResult: (args: unknown, result: ToolResult): ToolResultView | undefined => {
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
    },
    /* jscpd:ignore-end */
  }))
}
