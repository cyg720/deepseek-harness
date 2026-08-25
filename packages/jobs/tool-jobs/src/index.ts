/**
 * Model-facing `job_output`, `job_list`, and `job_kill` tools over
 * `ctx.jobs`. Loading the plugin attaches the controller required by
 * producers. It also delivers unreported completions to the owning agent:
 * injected into a busy owner's next step, or opening a turn on an idle one
 * under the default `wakeup` delivery, bounded per owner.
 * @module @deepseek-ai/dsh-tool-jobs
 */
/**
 * 文件职责：实现后台任务的 index.ts 模块。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证后台任务在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：注册能力，校验请求，更新状态并记录事件。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { boundContextSummary, createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { TextRetainer } from '@deepseek-ai/dsh-output-retention'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { JobId } from '@deepseek-ai/dsh-jobs'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** 中文说明：服务局部值 name，由紧邻初始化决定。 */
export const name = 'tool-jobs'
/** 中文说明：服务局部值 inject，由紧邻初始化决定。 */
export const inject = ['tools', 'jobs', 'systemPrompt']

/**
 * How an unreported completion reaches an owner that is already idle: `wakeup`
 * opens a turn for it, `quiet` leaves it pending until something else wakes the
 * owner. A busy owner is injected either way.
 */
/** 中文说明：类型或类 CompletionDelivery 约束宿主、交互或任务数据职责。 */
export type CompletionDelivery = 'quiet' | 'wakeup'

/** Configures bounded `job_output` waits and completion-notice delivery. */
/** 中文说明：类型或类 Config 约束宿主、交互或任务数据职责。 */
export interface Config {
  /** Wait duration applied when `job_output` sets `wait` without `timeout_ms` (default 30s). */
  waitTimeoutMs?: number
  /** Hard cap on any single wait; a larger model-supplied `timeout_ms` is clamped down to it (default 10min). */
  maxWaitTimeoutMs?: number
  /** Whether a completion opens a turn on an idle owner (default `wakeup`). */
  completionDelivery?: CompletionDelivery
  /**
   * Turns one owner may have opened by completion wakes before the next
   * notice degrades to injection, reset by any user-authored input (default 3).
   * Bounds the self-exciting chain where a woken turn starts the job whose
   * completion wakes it again.
   */
  maxConsecutiveWakes?: number
}

/** 中文说明：服务局部值 Config，由紧邻初始化决定。 */
export const Config: z<Config> = z.object({
  waitTimeoutMs: z.number().min(1).default(30_000),
  maxWaitTimeoutMs: z.number().min(1).default(600_000),
  completionDelivery: z.union(['quiet', 'wakeup'] as const).default('wakeup'),
  maxConsecutiveWakes: z.number().min(1).default(3),
})

/** Task state safe for model-authored programs; ownership/bookkeeping fields are omitted. */
/** 中文说明：类型或类 PublicJobSnapshot 约束宿主、交互或任务数据职责。 */
export interface PublicJobSnapshot {
  id: string
  kind: string
  label: string
  status: JobSnapshot['status']
  detail?: string
  startedAt: number
  finishedAt?: number
}

/** Shared schema for job-control outputs. */
/** 中文说明：服务局部值 PUBLIC_TASK_SCHEMA，由紧邻初始化决定。 */
const PUBLIC_TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    label: { type: 'string', required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['running', 'stopping', 'completed', 'killed', 'failed'],
    },
    detail: { type: 'string' },
    startedAt: { type: 'integer', required: true },
    finishedAt: { type: 'integer' },
  },
} as const

/** Remove job ownership and notification bookkeeping from a registry snapshot. */
/** 中文说明：函数 publicJob 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function publicJob(snapshot: JobSnapshot): PublicJobSnapshot {
  return {
    id: snapshot.id,
    kind: snapshot.kind,
    label: snapshot.label,
    status: snapshot.status,
    ...snapshot.detail !== undefined ? { detail: snapshot.detail } : {},
    startedAt: snapshot.startedAt,
    ...snapshot.finishedAt !== undefined ? { finishedAt: snapshot.finishedAt } : {},
  }
}

/**
 * Render generic status with optional producer detail.
 * @param snapshot - job state to render.
 * @returns a bracketed status line.
 */
/** 中文说明：函数 statusLine 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function statusLine(snapshot: Pick<JobSnapshot, 'status' | 'detail'>): string {
  return snapshot.detail !== undefined
    ? `[status: ${snapshot.status}, ${snapshot.detail}]`
    : `[status: ${snapshot.status}]`
}

/** 中文说明：服务局部值 encoder，由紧邻初始化决定。 */
const encoder = new TextEncoder()

/** 中文说明：函数 retainTail 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function retainTail(text: string, maxBytes: number): string {
  /** 中文说明：服务局部值 retainer，由紧邻初始化决定。 */
  const retainer = new TextRetainer({ kind: 'tail', maxBytes })
  retainer.push(text)
  return retainer.finish().text
}

/** 中文说明：函数 retainHead 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function retainHead(text: string, maxBytes: number): string {
  /** 中文说明：服务局部值 retainer，由紧邻初始化决定。 */
  const retainer = new TextRetainer({ kind: 'head', maxBytes })
  retainer.push(text)
  return retainer.finish().text
}

/** 中文说明：函数 fitWithSuffix 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function fitWithSuffix(
  content: string,
  suffix: string,
  maxBytes: number | undefined,
  omitted: string,
): string {
  /** 中文说明：服务局部值 complete，由紧邻初始化决定。 */
  const complete = `${content}${suffix}`
  if (maxBytes === undefined || encoder.encode(complete).byteLength <= maxBytes) return complete
  /** 中文说明：服务局部值 fixed，由紧邻初始化决定。 */
  const fixed = `${content.endsWith(omitted.trimStart()) ? '' : omitted}${suffix}`
  /** 中文说明：服务局部值 fixedBytes，由紧邻初始化决定。 */
  const fixedBytes = encoder.encode(fixed).byteLength
  if (fixedBytes >= maxBytes) return retainTail(fixed, maxBytes)
  return `${retainTail(content, maxBytes - fixedBytes)}${fixed}`
}

/**
 * One-line account of a settled job for the `notice` form's collapsed row.
 * @param snapshot - the settled job.
 * @returns its kind, label, and status, bounded like every notice summary.
 */
/** 中文说明：函数 completionSummary 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function completionSummary(snapshot: JobSnapshot): string {
  return boundContextSummary(`${snapshot.kind} ${snapshot.label} ${statusLine(snapshot)}`)
}

/** 中文说明：函数 fitCompletionNotice 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function fitCompletionNotice(snapshot: JobSnapshot): string {
  /** 中文说明：服务局部值 prefix，由紧邻初始化决定。 */
  const prefix = `background job ${snapshot.id}`
  /** 中文说明：服务局部值 detail，由紧邻初始化决定。 */
  const detail = ` (${snapshot.kind}: ${snapshot.label}) finished ${statusLine(snapshot)}`
  /** 中文说明：服务局部值 action，由紧邻初始化决定。 */
  const action = '\nDone; job_output.'
  /** 中文说明：服务局部值 complete，由紧邻初始化决定。 */
  const complete = `${prefix}${detail}. Read its output with job_output.`
  /** 中文说明：服务局部值 maxBytes，由紧邻初始化决定。 */
  const maxBytes = snapshot.outputLimitBytes
  if (maxBytes === undefined || encoder.encode(complete).byteLength <= maxBytes) return complete
  /** 中文说明：服务局部值 omitted，由紧邻初始化决定。 */
  const omitted = '\n[notice truncated]'
  /** 中文说明：服务局部值 fixed，由紧邻初始化决定。 */
  const fixed = `${prefix}${omitted}${action}`
  /** 中文说明：服务局部值 fixedBytes，由紧邻初始化决定。 */
  const fixedBytes = encoder.encode(fixed).byteLength
  if (fixedBytes <= maxBytes) {
    return fixedBytes === maxBytes
      ? fixed
      : `${prefix}${retainHead(detail, maxBytes - fixedBytes)}${omitted}${action}`
  }
  /** 中文说明：服务局部值 compact，由紧邻初始化决定。 */
  const compact = `${prefix}${action}`
  /** 中文说明：服务局部值 compactBytes，由紧邻初始化决定。 */
  const compactBytes = encoder.encode(compact).byteLength
  if (compactBytes <= maxBytes) return compact
  /** 中文说明：服务局部值 actionBytes，由紧邻初始化决定。 */
  const actionBytes = encoder.encode(action).byteLength
  if (actionBytes >= maxBytes) return retainTail(action, maxBytes)
  return `${retainHead(prefix, maxBytes - actionBytes)}${action}`
}

/** 中文说明：函数 rawSingleText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function rawSingleText(content: readonly ContentBlock[]): string | undefined {
  if (content.length !== 1) return undefined
  /** 中文说明：服务局部值 block，由紧邻初始化决定。 */
  const block = content[0]
  if (block?.type !== 'text') return undefined
  return block.text
}

/** 中文说明：函数 boundSingleText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function boundSingleText(content: readonly ContentBlock[], maxBytes: number): ContentBlock[] | undefined {
  /** 中文说明：服务局部值 text，由紧邻初始化决定。 */
  const text = rawSingleText(content)
  if (text === undefined) return undefined
  return [{
    type: 'text',
    text: fitWithSuffix(text, '', maxBytes, '\n[result truncated]'),
  }]
}

/** 中文说明：函数 visibleOutputLimit 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function visibleOutputLimit(ctx: Context, exec: ToolExecution): number | undefined {
  if (exec.name !== 'job_output' && exec.name !== 'job_kill') return undefined
  /** 中文说明：服务局部值 jobId，由紧邻初始化决定。 */
  const jobId = (exec.arguments as { job_id?: unknown } | null | undefined)?.job_id
  if (typeof jobId !== 'string' || jobId.length === 0) return undefined
  return ctx.jobs.list(exec.agent).find(snapshot => snapshot.id === jobId)?.outputLimitBytes
}

/** Validate the non-empty constraint that ParameterSchemaSpec cannot express. */
/** 中文说明：函数 validateJobId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateJobId(value: string): JobId {
  if (value.length === 0) {
    throw new Error(`invalid job_id: expected a non-empty string, got ${JSON.stringify(value)}`)
  }
  return JobId(value)
}

/** Pending presentation shared by the three generic job controls. */
/** 中文说明：函数 presentTaskCall 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function presentTaskCall(title: string, kind: 'read' | 'execute', rawInput?: string): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput !== undefined ? { rawInput } : {} }
}

/** 中文说明：函数 apply 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function apply(ctx: Context, config: Config): void {
  /** 中文说明：服务局部值 waitDefault，由紧邻初始化决定。 */
  const waitDefault = config.waitTimeoutMs ?? 30_000
  /** 中文说明：服务局部值 waitCap，由紧邻初始化决定。 */
  const waitCap = config.maxWaitTimeoutMs ?? 600_000
  /** 中文说明：服务局部值 delivery，由紧邻初始化决定。 */
  const delivery = config.completionDelivery ?? 'wakeup'
  /** 中文说明：服务局部值 wakeBudget，由紧邻初始化决定。 */
  const wakeBudget = config.maxConsecutiveWakes ?? 3

  // Turns this plugin opened on each owner since that owner last consumed
  // human input. Keyed by the exact Agent, so a same-session replacement
  // starts with a full budget.
  /** 中文说明：服务局部值 spentWakes，由紧邻初始化决定。 */
  const spentWakes = new WeakMap<Agent, number>()
  if (waitDefault > waitCap) {
    throw new Error(`tool-jobs: waitTimeoutMs (${waitDefault}) exceeds maxWaitTimeoutMs (${waitCap})`)
  }
  // A budget is a count of turns. `Infinity` would leave the runaway chain this
  // field exists to bound unbounded, and a fraction never names a turn at all.
  if (!Number.isSafeInteger(wakeBudget)) {
    throw new Error(`tool-jobs: maxConsecutiveWakes (${wakeBudget}) must be a whole number of turns`)
  }
  // Nothing spends the budget under quiet delivery, so nothing needs to refill it.
  if (delivery === 'wakeup') {
    ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      // Claiming is the point the human's input actually enters a step; a notice
      // this plugin itself queued must not refill the budget it just spent.
      if (message.source.kind === 'user') spentWakes.delete(agent)
    })
  }

  /** 中文说明：服务局部值 outputLimits，由紧邻初始化决定。 */
  const outputLimits = new WeakMap<ToolExecution, number>()
  ctx.on('tools/pre-execute', (exec, next) => {
    /** 中文说明：服务局部值 maxBytes，由紧邻初始化决定。 */
    const maxBytes = visibleOutputLimit(ctx, exec)
    if (maxBytes !== undefined) outputLimits.set(exec, maxBytes)
    return next()
  }, { prepend: true })
  /** 中文说明：服务局部值 finalizeTaskContent，由紧邻初始化决定。 */
  const finalizeTaskContent: NonNullable<ToolDefinition['finalizeContent']> = (exec, result) => {
    /** 中文说明：服务局部值 maxBytes，由紧邻初始化决定。 */
    const maxBytes = outputLimits.get(exec) ?? visibleOutputLimit(ctx, exec)
    outputLimits.delete(exec)
    if (maxBytes === undefined) return undefined
    if (exec.name === 'job_output' && !result.isError) {
      // This definition owns and schema-validates the canonical value. Preserve
      // its output/status split only while policy left the default rendering intact.
      /** 中文说明：服务局部值 value，由紧邻初始化决定。 */
      const value = result.value as unknown as { text: string; job: PublicJobSnapshot }
      /** 中文说明：服务局部值 body，由紧邻初始化决定。 */
      const body = value.text.length > 0 ? value.text : '(no new output)'
      /** 中文说明：服务局部值 content，由紧邻初始化决定。 */
      const content = body.endsWith('\n') ? body.slice(0, -1) : body
      /** 中文说明：服务局部值 suffix，由紧邻初始化决定。 */
      const suffix = `\n${statusLine(value.job)}`
      if (rawSingleText(result.content) === `${content}${suffix}`) {
        return [{
          type: 'text',
          text: fitWithSuffix(content, suffix, maxBytes, '\n[output truncated]'),
        }]
      }
    }
    return boundSingleText(result.content, maxBytes)
  }

  // Producers may start work only while a controller is attached.
  ctx.jobs.attachController('tool-jobs')

  // Cross-call guidance follows the bash section and precedes product sections.
  ctx.systemPrompt.section({
    name: 'tool:jobs',
    order: 106,
    text: 'Track every background job id you start. You are notified in-session when a job finishes — do not busy-poll or sleep on one; keep working on independent steps and do not duplicate a running job\'s work. Before giving a final answer, collect every still-relevant job with job_output (set wait: true only when you are genuinely blocked on it), and job_kill jobs that stopped mattering.',
  })

  // Use the exact lifecycle owner; reusable ids could resolve to a replacement.
  // A busy owner is injected: the notice waits in its next-step inbox, which
  // the turn cannot close over, so jobs settling together cost one step. An
  // idle owner is woken instead, because an unclaimed notice is a completion
  // the model never learns about. Either way, disposal before the claim
  // discards it with the owner, and teardown settlements arrive `reported`.
  //
  // The registry routes each settlement to the listeners its owner's scope
  // chain reaches, so a mount under one preset never sees another preset's
  // agents; this listener owns delivery, not the choice of whom to deliver to.
  ctx.jobs.onJobDone((snapshot, owner) => {
    if (snapshot.reported || owner === undefined) return
    /** 中文说明：服务局部值 message，由紧邻初始化决定。 */
    const message = createUserMessage({
      content: [{
        type: 'text',
        text: fitCompletionNotice(snapshot),
      }],
      source: {
        kind: 'plugin',
        plugin: 'tool-jobs',
        form: 'notice',
        summary: completionSummary(snapshot),
      },
    })
    /** 中文说明：服务局部值 spent，由紧邻初始化决定。 */
    const spent = spentWakes.get(owner) ?? 0
    if (delivery === 'wakeup' && owner.status === 'idle' && spent < wakeBudget) {
      spentWakes.set(owner, spent + 1)
      owner.followup(message)
      return
    }
    owner.inject(message)
  })

  ctx.tools.register(defineTool({
    name: 'job_output',
    description: 'Read a background job. Stream jobs return only output since the previous read; '
      + 'final-output jobs return their result after settlement. Every response ends with '
      + '`[status: ...]`. Reads are non-blocking unless `wait: true`, which waits up to the configured cap.',
    // A timed-out wait returns job state rather than a TOOL_TIMEOUT error, so
    // this tool owns its deadline instead of using ToolDefinition.timeoutMs.
    parameters: {
      job_id: { type: 'string', required: true, description: 'Job id returned by the tool that started the background work.' },
      wait: { type: 'boolean', description: 'Block until the job reaches a terminal status or the timeout expires. A timed-out wait returns [status: running] and leaves the job alive.' },
      timeout_ms: { type: 'number', description: 'Max wait in milliseconds (only meaningful with wait: true). Defaults to the configured wait timeout; capped by the configured maximum.' },
    },
    finalizeContent: finalizeTaskContent,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          job: { ...PUBLIC_TASK_SCHEMA, required: true },
        },
      },
      render: (_args, value) => {
        /** 中文说明：服务局部值 body，由紧邻初始化决定。 */
        const body = value.text.length > 0 ? value.text : '(no new output)'
        /** 中文说明：服务局部值 separator，由紧邻初始化决定。 */
        const separator = body.endsWith('\n') ? '' : '\n'
        return [{ type: 'text', text: `${body}${separator}${statusLine(value.job)}` }]
      },
    },
    async execute(args, exec) {
      /** 中文说明：服务局部值 id，由紧邻初始化决定。 */
      const id = validateJobId(args.job_id)
      if (args.wait === true) {
        /** 中文说明：服务局部值 timeout，由紧邻初始化决定。 */
        const timeout = Math.min(args.timeout_ms ?? waitDefault, waitCap)
        await ctx.jobs.wait(id, timeout, exec.agent, exec.signal)
      }
      /** 中文说明：服务局部值 read，由紧邻初始化决定。 */
      const read = ctx.jobs.read(id, exec.agent)
      return { text: read.text, job: publicJob(read.snapshot) }
    },
    presentCall: args => presentTaskCall(`Read output from background job ${args.job_id}`, 'read', args.job_id),
  }))

  ctx.tools.register(defineTool({
    name: 'job_list',
    description: 'List your background jobs (running and finished) with their ids, kinds, and statuses.',
    parameters: {},
    output: {
      schema: { type: 'array', items: PUBLIC_TASK_SCHEMA },
      render: (_args, jobs) => [{
        type: 'text',
        text: jobs.length === 0
          ? '(no background jobs)'
          : jobs.map(t => `${t.id} [${t.kind}] ${t.status} — ${t.label}`).join('\n'),
      }],
    },
    execute(_args, exec) {
      /** 中文说明：服务局部值 jobs，由紧邻初始化决定。 */
      const jobs = ctx.jobs.list(exec.agent)
      return Promise.resolve(jobs.map(publicJob))
    },
    presentCall: () => presentTaskCall('List background jobs', 'read'),
  }))

  ctx.tools.register(defineTool({
    name: 'job_kill',
    description: 'Request cancellation of a running background job by job id. Returns immediately; the job settles as killed once its work actually stops.',
    parameters: {
      job_id: { type: 'string', required: true, description: 'Job id returned by the tool that started the background work.' },
      reason: { type: 'string', description: 'Optional short reason, recorded in the log and forwarded to the job.' },
    },
    finalizeContent: finalizeTaskContent,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcome: {
            type: 'string',
            required: true,
            enum: ['cancellation-requested', 'already-finished'],
          },
          job: { ...PUBLIC_TASK_SCHEMA, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.outcome === 'already-finished'
          ? `job ${value.job.id} had already finished ${statusLine(value.job)}`
          : `requested cancellation of job ${value.job.id}`,
      }],
    },
    execute(args, exec) {
      /** 中文说明：服务局部值 id，由紧邻初始化决定。 */
      const id = validateJobId(args.job_id)
      /** 中文说明：服务局部值 result，由紧邻初始化决定。 */
      const result = ctx.jobs.kill(id, exec.agent, args.reason)
      // A snapshot describes current state without consuming pending output.
      /** 中文说明：服务局部值 snapshot，由紧邻初始化决定。 */
      const snapshot = publicJob(ctx.jobs.get(id, exec.agent))
      return Promise.resolve({
        outcome: result === 'already-finished' ? 'already-finished' as const : 'cancellation-requested' as const,
        job: snapshot,
      })
    },
    presentCall: args => presentTaskCall(`Kill background job ${args.job_id}`, 'execute', args.job_id),
  }))
}
