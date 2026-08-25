/**
 * Model-facing foreground Ralph loop over the workflow and subagent seams. A
 * fixed script starts one fresh structured-output child per round, carrying
 * only the immutable objective and the previous bounded handoff between them.
 * @module @deepseek-ai/dsh-tool-ralph
 */
/*
 * 文件职责：实现 index.ts 覆盖的Ralph 工作流行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的Ralph 工作流能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { WorkflowResult, WorkflowRun } from '@deepseek-ai/dsh-workflow'
// Declaration merge only: makes ctx.systemPrompt visible for section registration.
import type {} from '@deepseek-ai/dsh-system-prompt'

/** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'tool-ralph'
/** 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['tools', 'workflowEngine', 'subagents', 'systemPrompt']

/** Deployment policy for the fixed Ralph workflow. */
/* 中文说明：interface Config 定义本模块所需的数据或行为，用于表达Ralph 工作流场景。 */
export interface Config {
  /** Fresh structured-output provider used for every round (default `spawn`). */
  subagentProvider?: string
  /** Default and deployment ceiling for one call's round count (default 256). */
  maxRounds?: number
  /** Maximum serialized characters in one structured handoff (default 16384). */
  maxHandoffChars?: number
  /** Maximum characters in a successful parent-facing terminal text (default 16384). */
  maxResultChars?: number
}

/** Schemastery configuration for the Ralph tool. */
/* 中文说明：变量 Config 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const Config: z<Config> = z.object({
  subagentProvider: z.string().default('spawn'),
  maxRounds: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(256),
  maxHandoffChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16_384),
  maxResultChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16_384),
})

/** 中文说明：interface ResolvedConfig 定义本模块所需的数据或行为，用于表达Ralph 工作流场景。 */
interface ResolvedConfig {
  readonly subagentProvider: string
  readonly maxRounds: number
  readonly maxHandoffChars: number
  readonly maxResultChars: number
}

/** 中文说明：type RalphRoundStatus 定义本模块所需的数据或行为，用于表达Ralph 工作流场景。 */
type RalphRoundStatus = 'continue' | 'complete' | 'blocked'

/** 中文说明：interface RalphRoundReport 定义本模块所需的数据或行为，用于表达Ralph 工作流场景。 */
interface RalphRoundReport {
  readonly status: RalphRoundStatus
  readonly summary: string
  readonly evidence: string[]
  readonly nextSteps: string[]
  readonly blocker: string
}

/** 中文说明：type RalphRunStatus 定义本模块所需的数据或行为，用于表达Ralph 工作流场景。 */
type RalphRunStatus = 'complete' | 'blocked' | 'budget-limited'

/** 中文说明：interface RalphRunResult 定义本模块所需的数据或行为，用于表达Ralph 工作流场景。 */
interface RalphRunResult {
  readonly status: RalphRunStatus
  readonly roundsStarted: number
  readonly report: RalphRoundReport
}

/** 中文说明：interface RalphRoundFailure 定义本模块所需的数据或行为，用于表达Ralph 工作流场景。 */
interface RalphRoundFailure {
  readonly status: 'round-failed'
  readonly roundsStarted: number
  readonly lastReport?: RalphRoundReport
}

/** 中文说明：type RalphTerminalResult 定义本模块所需的数据或行为，用于表达Ralph 工作流场景。 */
type RalphTerminalResult = RalphRunResult | RalphRoundFailure

/** 中文说明：interface RalphCallArgs 定义本模块所需的数据或行为，用于表达Ralph 工作流场景。 */
interface RalphCallArgs {
  objective: string
  maxRounds?: number
}

/** 中文说明：常量 RALPH_META 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const RALPH_META = {
  name: 'ralph-loop',
  description: 'Iterate toward one objective with a fresh child and bounded structured handoff per round.',
  phases: [{ title: 'Fresh-agent rounds', detail: 'One clean child context per Ralph round.' }],
}

/**
 * Fixed, deployment-owned orchestration. The model supplies data only; it
 * cannot alter the loop, provider route, schema, or handoff validation.
 */
/* 中文说明：常量 RALPH_SCRIPT 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const RALPH_SCRIPT = String.raw`
const reportSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['continue', 'complete', 'blocked'] },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    nextSteps: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
  },
  required: ['status', 'summary', 'evidence', 'nextSteps', 'blocker'],
  additionalProperties: false,
}

function normalizedText(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

function normalizedList(value) {
  return Array.isArray(value) && value.every(normalizedText)
}

function validateReport(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Ralph child returned no structured round report')
  }
  if (!normalizedText(report.summary)) {
    throw new Error('Ralph round report summary must be non-empty and normalized')
  }
  if (!normalizedList(report.evidence) || !normalizedList(report.nextSteps)) {
    throw new Error('Ralph round report evidence and nextSteps must contain only non-empty normalized strings')
  }
  if (typeof report.blocker !== 'string' || report.blocker !== report.blocker.trim()) {
    throw new Error('Ralph round report blocker must be a normalized string')
  }
  switch (report.status) {
    case 'continue':
      if (report.nextSteps.length === 0 || report.blocker !== '') {
        throw new Error('a continuing Ralph report needs nextSteps and an empty blocker')
      }
      break
    case 'complete':
      if (report.evidence.length === 0 || report.nextSteps.length !== 0 || report.blocker !== '') {
        throw new Error('a complete Ralph report needs evidence, no nextSteps, and an empty blocker')
      }
      break
    case 'blocked':
      if (!normalizedText(report.blocker)) {
        throw new Error('a blocked Ralph report needs a concrete blocker')
      }
      break
    default:
      throw new Error('Ralph round report status is invalid')
  }
  const serialized = JSON.stringify(report)
  if (serialized.length > args.maxHandoffChars) {
    throw new Error('Ralph round report exceeds maxHandoffChars (' + serialized.length + ' > ' + args.maxHandoffChars + ')')
  }
  return report
}

let previous
phase('Fresh-agent rounds')
for (let round = 1; round <= args.maxRounds; round += 1) {
  const prior = previous === undefined ? '(none — this is the first round)' : JSON.stringify(previous)
  const prompt = [
    'You are one fresh worker in a foreground Ralph loop. You receive no parent conversation and no prior child session. Do not call the ralph tool: this round already is its worker.',
    'Immutable objective:\n' + args.objective,
    'Ralph round: ' + round + ' of ' + args.maxRounds + '.',
    'The shared workspace and its current working tree are the long-term memory and source of truth. Inspect them before acting, preserve existing work, perform concrete in-scope work, and verify what you change. Treat the previous report only as a bounded handoff; confirm it against the workspace.',
    'Previous structured handoff:\n' + prior,
    'Return one report with exact normalized strings. Use status continue with at least one nextSteps entry while useful work remains; complete only with concrete evidence and no nextSteps; blocked only when no meaningful progress is possible without human input or an external-state change. blocker must be empty unless blocked.',
  ].join('\n\n')
  const rawReport = await agent(prompt, {
    label: 'Ralph round ' + round,
    phase: 'Fresh-agent rounds',
    schema: reportSchema,
  })
  if (rawReport === null) {
    return { status: 'round-failed', roundsStarted: round, lastReport: previous ?? null }
  }
  const report = validateReport(rawReport)
  if (report.status === 'complete') return { status: 'complete', roundsStarted: round, report }
  if (report.status === 'blocked') return { status: 'blocked', roundsStarted: round, report }
  previous = report
}
return { status: 'budget-limited', roundsStarted: args.maxRounds, report: previous }
`

/** 中文说明：常量 DESCRIPTION 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DESCRIPTION = 'Run a foreground fresh-agent Ralph loop toward one immutable objective. '
  + 'Use only when the direct human explicitly asks for Ralph or fresh-agent iteration. Each round '
  + 'opens a new child with no parent conversation or prior child session; the shared workspace is '
  + 'long-term memory, and only a bounded structured report crosses rounds. The call returns when '
  + 'a worker reports completion or a concrete blocker, or at the round limit. Ordinary long-running same-session work '
  + 'belongs to goal tools.'

/** Validate defaults even when a caller invokes apply() without Loader normalization. */
/* 中文说明：函数 resolveConfig 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function resolveConfig(config: Config): ResolvedConfig {
  /** 中文说明：变量 subagentProvider 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const subagentProvider = config.subagentProvider ?? 'spawn'
  /** 中文说明：变量 maxRounds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const maxRounds = config.maxRounds ?? 256
  /** 中文说明：变量 maxHandoffChars 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const maxHandoffChars = config.maxHandoffChars ?? 16_384
  /** 中文说明：变量 maxResultChars 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const maxResultChars = config.maxResultChars ?? 16_384
  if (subagentProvider.length === 0 || subagentProvider !== subagentProvider.trim()) {
    throw new TypeError('subagentProvider must be a non-empty normalized string')
  }
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1) {
    throw new TypeError('maxRounds must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxHandoffChars) || maxHandoffChars < 1) {
    throw new TypeError('maxHandoffChars must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxResultChars) || maxResultChars < 1) {
    throw new TypeError('maxResultChars must be a positive safe integer')
  }
  return { subagentProvider, maxRounds, maxHandoffChars, maxResultChars }
}

/** Resolve one model-selected cap against the deployment ceiling. */
/* 中文说明：函数 resolveMaxRounds 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function resolveMaxRounds(requested: number | undefined, ceiling: number): number {
  /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value = requested ?? ceiling
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('Ralph maxRounds must be a positive safe integer')
  }
  if (value > ceiling) {
    throw new TypeError(`Ralph maxRounds ${value} exceeds the deployment ceiling ${ceiling}`)
  }
  return value
}

/** Require the configured route to mean a genuinely fresh structured child. */
/* 中文说明：函数 requireFreshProvider 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function requireFreshProvider(ctx: Context, name: string): SubagentProvider {
  /** 中文说明：变量 provider 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const provider = ctx.subagents.getProvider(name)
  if (provider === undefined) {
    throw new Error(`Ralph subagent provider "${name}" is not registered`)
  }
  if (!provider.capabilities.outputSchema) {
    throw new Error(`Ralph subagent provider "${name}" does not support structured output`)
  }
  if (provider.inheritsParentContext) {
    throw new Error(`Ralph subagent provider "${name}" inherits parent context; Ralph requires a fresh provider`)
  }
  return provider
}

/** 中文说明：函数 isRecord 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 中文说明：函数 normalizedText 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function normalizedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

/** 中文说明：函数 normalizedList 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function normalizedList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(normalizedText)
}

/** Defensively decode the fixed script's report across a provider boundary. */
/* 中文说明：函数 readReport 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function readReport(value: unknown, expectedStatus: RalphRoundStatus, maxChars: number): RalphRoundReport {
  if (!isRecord(value)
    || Object.keys(value).sort().join(',') !== 'blocker,evidence,nextSteps,status,summary'
    || value['status'] !== expectedStatus
    || !normalizedText(value['summary'])
    || !normalizedList(value['evidence'])
    || !normalizedList(value['nextSteps'])
    || typeof value['blocker'] !== 'string'
    || value['blocker'] !== value['blocker'].trim()) {
    throw new Error('Ralph workflow returned a malformed round report')
  }
  /** 中文说明：变量 report 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const report: RalphRoundReport = {
    status: expectedStatus,
    summary: value['summary'],
    evidence: value['evidence'],
    nextSteps: value['nextSteps'],
    blocker: value['blocker'],
  }
  if (expectedStatus === 'continue' && (report.nextSteps.length === 0 || report.blocker !== '')) {
    throw new Error('Ralph workflow returned an invalid continuing report')
  }
  if (expectedStatus === 'complete'
    && (report.evidence.length === 0 || report.nextSteps.length !== 0 || report.blocker !== '')) {
    throw new Error('Ralph workflow returned an invalid completion report')
  }
  if (expectedStatus === 'blocked' && !normalizedText(report.blocker)) {
    throw new Error('Ralph workflow returned an invalid blocked report')
  }
  /** 中文说明：变量 chars 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chars = JSON.stringify(report).length
  if (chars > maxChars) {
    throw new Error(`Ralph workflow returned an oversized handoff (${chars} > ${maxChars})`)
  }
  return report
}

/** Defensively decode the fixed script's terminal value. */
/* 中文说明：函数 readRunResult 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function readRunResult(value: unknown, maxRounds: number, maxHandoffChars: number): RalphTerminalResult {
  if (!isRecord(value)
    || typeof value['roundsStarted'] !== 'number'
    || !Number.isSafeInteger(value['roundsStarted'])
    || value['roundsStarted'] < 1
    || value['roundsStarted'] > maxRounds) {
    throw new Error('Ralph workflow returned a malformed terminal result')
  }
  /** 中文说明：变量 roundsStarted 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const roundsStarted = value['roundsStarted']
  switch (value['status']) {
    case 'complete':
      if (Object.keys(value).sort().join(',') !== 'report,roundsStarted,status') {
        throw new Error('Ralph workflow returned a malformed terminal result')
      }
      return { status: 'complete', roundsStarted, report: readReport(value['report'], 'complete', maxHandoffChars) }
    case 'blocked':
      if (Object.keys(value).sort().join(',') !== 'report,roundsStarted,status') {
        throw new Error('Ralph workflow returned a malformed terminal result')
      }
      return { status: 'blocked', roundsStarted, report: readReport(value['report'], 'blocked', maxHandoffChars) }
    case 'budget-limited':
      if (Object.keys(value).sort().join(',') !== 'report,roundsStarted,status') {
        throw new Error('Ralph workflow returned a malformed terminal result')
      }
      if (roundsStarted !== maxRounds) {
        throw new Error('Ralph workflow returned budget-limited before the round limit')
      }
      return { status: 'budget-limited', roundsStarted, report: readReport(value['report'], 'continue', maxHandoffChars) }
    case 'round-failed': {
      if (Object.keys(value).sort().join(',') !== 'lastReport,roundsStarted,status') {
        throw new Error('Ralph workflow returned a malformed terminal result')
      }
      if (roundsStarted === 1) {
        if (value['lastReport'] !== null) {
          throw new Error('Ralph workflow returned an invalid first-round failure')
        }
        return { status: 'round-failed', roundsStarted }
      }
      if (value['lastReport'] === null) {
        throw new Error('Ralph workflow returned a round failure without its last handoff')
      }
      return {
        status: 'round-failed',
        roundsStarted,
        lastReport: readReport(value['lastReport'], 'continue', maxHandoffChars),
      }
    }
    default:
      throw new Error('Ralph workflow returned an unknown terminal status')
  }
}

/** A non-clean workflow finish is an error, never a partial Ralph success. */
/* 中文说明：函数 stopReasonError 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function stopReasonError(result: WorkflowResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'cancelled':
      return `Ralph workflow was cancelled${result.error === undefined ? '' : ` (${result.error})`}`
    case 'error':
      return `Ralph workflow failed: ${result.error ?? 'unknown error'}`
    /* v8 ignore start -- WorkflowStopReason is closed; a future variant must fail loud here. */
    default:
      return `Ralph workflow ended abnormally (${String(result.stopReason satisfies never)})`
    /* v8 ignore stop */
  }
}

/** 中文说明：常量 TRUNCATION_NOTICE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TRUNCATION_NOTICE = '\n… [truncated]'

/** Bound complete parent-facing text, including its envelope and truncation marker. */
/* 中文说明：函数 boundResult 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function boundResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= TRUNCATION_NOTICE.length) return TRUNCATION_NOTICE.slice(0, maxChars)
  return `${text.slice(0, maxChars - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}`
}

/** Render the fixed terminal envelope without presenting self-report as certification. */
/* 中文说明：函数 renderResult 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function renderResult(result: RalphRunResult, maxChars: number): string {
  /** 中文说明：变量 rounds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rounds = `${result.roundsStarted} round${result.roundsStarted === 1 ? '' : 's'}`
  /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let text: string
  switch (result.status) {
    case 'complete':
      text = `Ralph worker reported completion after ${rounds}.\nFinal report:\n${JSON.stringify(result.report, null, 2)}`
      break
    case 'blocked':
      text = `Ralph worker reported a blocker after ${rounds}.\nFinal report:\n${JSON.stringify(result.report, null, 2)}`
      break
    case 'budget-limited':
      text = `Ralph reached its ${rounds} limit; the worker reported work remaining.\nFinal report:\n${JSON.stringify(result.report, null, 2)}`
      break
  }
  return boundResult(text, maxChars)
}

/** Canonical Ralph result fields shared by schema inference and rendering. */
/* 中文说明：常量 RALPH_OUTPUT_PROPERTIES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const RALPH_OUTPUT_PROPERTIES = {
  runId: { type: 'string', required: true },
  agentsStarted: { type: 'integer', required: true },
  result: { type: 'json', required: true },
} as const

/** Render an ordinary child failure with the most recent durable handoff. */
/* 中文说明：函数 renderRoundFailure 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function renderRoundFailure(result: RalphRoundFailure, maxChars: number): string {
  /** 中文说明：变量 header 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const header = `Ralph round ${result.roundsStarted} child failed before producing a structured report.`
  /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const text = result.lastReport === undefined
    ? `${header}\nNo previous handoff was available.`
    : `${header}\nLast successful handoff:\n${JSON.stringify(result.lastReport, null, 2)}`
  return boundResult(text, maxChars)
}

/** 中文说明：函数 presentCall 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function presentCall(args: RalphCallArgs): ToolCallView {
  return { card: 'generic', title: 'ralph', rawInput: args.objective }
}

/** 中文说明：函数 presentResult 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function presentResult(args: RalphCallArgs, result: { content: ContentBlock[]; isError: boolean }): ToolResultView {
  void args
  void result
  return { card: 'generic' }
}

/** Register the fixed Ralph tool and its explicit-ask usage policy. */
/* 中文说明：函数 apply 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function apply(ctx: Context, config: Config): void {
  /** 中文说明：变量 resolved 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({
    name: 'tool:ralph',
    order: 116,
    text: 'Use the ralph tool ONLY when the direct human explicitly asks for a Ralph loop or fresh-agent iterative execution. Each Ralph round starts a fresh child with no conversation seed and uses the shared workspace as durable memory. Completion and blockers are worker reports, not independent evaluation. Use same-session goal tools for ordinary long-running objectives, and plain subagents or workflows for bounded delegation and fan-out.',
  })
  ctx.tools.register(defineTool({
    name: 'ralph',
    description: DESCRIPTION,
    parameters: {
      objective: {
        type: 'string',
        required: true,
        description: 'The immutable completion objective for every fresh Ralph round.',
      },
      maxRounds: {
        type: 'number',
        description: 'Optional positive safe-integer round cap, bounded by the deployment ceiling.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: RALPH_OUTPUT_PROPERTIES,
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderResult(value.result as unknown as RalphRunResult, resolved.maxResultChars),
      }],
    },
    async execute(args, exec) {
      /** 中文说明：变量 parent 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error('Ralph tool requires a calling agent (exec.agent was undefined)')
      }
      /** 中文说明：变量 objective 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const objective = args.objective.trim()
      if (objective.length === 0) throw new Error('Ralph objective must be a non-empty string')
      /** 中文说明：变量 maxRounds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const maxRounds = resolveMaxRounds(args.maxRounds, resolved.maxRounds)
      void requireFreshProvider(ctx, resolved.subagentProvider)

      /** 中文说明：变量 run 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const run: WorkflowRun = ctx.workflowEngine.start({
        script: RALPH_SCRIPT,
        meta: RALPH_META,
        args: { objective, maxRounds, maxHandoffChars: resolved.maxHandoffChars },
        subagentProvider: resolved.subagentProvider,
        maxTotalAgents: maxRounds,
        parent,
        signal: exec.signal,
      })
      /** 中文说明：函数值 onAbort 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const onAbort = (): void => { run.cancel('parent step aborted') }
      exec.signal.addEventListener('abort', onAbort, { once: true })
      if (exec.signal.aborted) run.cancel('parent step aborted')

      try {
        /** 中文说明：变量 settled 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const settled = await run.result
        /** 中文说明：变量 error 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const error = stopReasonError(settled)
        if (error !== undefined) throw new Error(error)
        /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const value = readRunResult(settled.value, maxRounds, resolved.maxHandoffChars)
        if (value.status === 'round-failed') throw new Error(renderRoundFailure(value, resolved.maxResultChars))
        return {
          runId: run.id,
          agentsStarted: settled.agentsStarted,
          result: value as unknown as JsonValue,
        }
      } finally {
        exec.signal.removeEventListener('abort', onAbort)
        await run.dispose()
      }
    },
    presentCall,
    presentResult,
  }))
}
