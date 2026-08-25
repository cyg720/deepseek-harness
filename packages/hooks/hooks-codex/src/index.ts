/**
 * Bridge for unmodified Codex command hooks on harness interception points. It
 * supports five points (SessionStart, prompt/tool pre/post, Stop), regex-only
 * matchers, snake_case payloads without a trailing newline, no hook environment
 * or command substitution, and no pre-tool approval or rewrite path; only
 * blocking decisions are honored. Shared execution and parsing live in
 * `dsh-hook-protocol`; see the
 * [hook-bridges Agent Note](../../../../.agents/notes/implemented/feature/2026-06-30-hook-bridges.md).
 * @module @deepseek-ai/dsh-hooks-codex
 */
/*
 * 文件职责：实现Codex Hook 桥的 index.ts 模块。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：适配外部事件，调用宿主能力并返回结构化结果。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

// Each dialect bridge keeps its complete dependency list visible at the entry
// point; a cross-package facade for imports alone would add indirection.
/* jscpd:ignore-start */
import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { PostToolDecision, PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  appendHookInvoked,
  appendHookResult,
  createDetachedRuns,
  DEFAULT_HOOK_TIMEOUT_MS,
  DEFAULT_STDERR_SUMMARY_MAX_CHARS,
  matchesMatcher,
  mergeHookOutputs,
  runHook,
  /** 中文说明：类型或类 HookOutput 约束 API、Hook 或目录数据职责。 */
  type HookOutput,
  /** 中文说明：类型或类 MatcherGroup 约束 API、Hook 或目录数据职责。 */
  type MatcherGroup,
  /** 中文说明：类型或类 MergedHookOutcome 约束 API、Hook 或目录数据职责。 */
  type MergedHookOutcome,
} from '@deepseek-ai/dsh-hook-protocol'
import { parseCodexConfig, type CodexHookConfig } from './config.ts'
/* jscpd:ignore-end */

/** 中文说明：宿主局部值 name，由紧邻初始化决定。 */
export const name = 'hooks-codex'
/** 中文说明：宿主局部值 inject，由紧邻初始化决定。 */
export const inject = ['shell']

/** Plugin config: where the Codex hooks.json lives + the model name for payloads. */
/* 中文说明：类型或类 Config 约束 API、Hook 或目录数据职责。 */
export interface Config {
  /**
   * Path to a Codex `hooks.json`. Process-level: read once at load, a relative
   * path resolves against the process launch cwd.
   * TODO(per-session-hook-config): per-session project-local discovery from each
   * `session/new.cwd`.
   */
  configPath: string
  /** The model name stamped on every payload (Codex includes `model` on each event). */
  model?: string
  /** Default per-hook timeout in ms when a hook sets none (Codex default: 600000). */
  defaultTimeoutMs?: number
  /** Character cap for the `hook/result` event's persisted stderr summary. */
  stderrSummaryMaxChars?: number
}

/** 中文说明：宿主局部值 Config，由紧邻初始化决定。 */
export const Config: z<Config> = z.object({
  configPath: z.string().required(),
  model: z.string().default(''),
  defaultTimeoutMs: z.number().default(DEFAULT_HOOK_TIMEOUT_MS),
  stderrSummaryMaxChars: z.number().default(DEFAULT_STDERR_SUMMARY_MAX_CHARS),
})

/** 中文说明：宿主局部值 handlerCounter，由紧邻初始化决定。 */
let handlerCounter = 0
/** 中文说明：函数 nextHandlerId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function nextHandlerId(point: string): string {
  return `codex:${point}:${++handlerCounter}`
}

/** 中文说明：宿主局部值 PLUGIN_SOURCE，由紧邻初始化决定。 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'hooks-codex' }

/** The summary cap bounds a persisted event field — a positive integer or the slice misbehaves silently. */
/* 中文说明：函数 assertPositiveInteger 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`hooks-codex: ${name} must be a positive integer`)
  }
}

/** 中文说明：函数 apply 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function apply(ctx: Context, config: Config): void {
  // Validate before config parsing so a bad value cannot be hidden by its early return.
  /** 中文说明：宿主局部值 stderrSummaryMaxChars，由紧邻初始化决定。 */
  const stderrSummaryMaxChars = config.stderrSummaryMaxChars ?? DEFAULT_STDERR_SUMMARY_MAX_CHARS
  assertPositiveInteger('stderrSummaryMaxChars', stderrSummaryMaxChars)
  /** 中文说明：宿主局部值 defaultTimeoutMs，由紧邻初始化决定。 */
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS
  /** 中文说明：宿主局部值 parsed，由紧邻初始化决定。 */
  let parsed: CodexHookConfig = {}
  try {
    /** 中文说明：宿主局部值 raw，由紧邻初始化决定。 */
    const raw: unknown = JSON.parse(readFileSync(config.configPath, 'utf8'))
    /** 中文说明：宿主局部值 result，由紧邻初始化决定。 */
    const result = parseCodexConfig(raw)
    parsed = result.config
    /** 中文说明：宿主局部值 s，由紧邻初始化决定。 */
    for (const s of result.skipped) {
      ctx.logger.warn(`hooks-codex: skipping ${s.reason} on ${s.event} (only sync command hooks run)`)
    }
  } catch (error: unknown) {
    ctx.logger.warn(`hooks-codex: could not load hook config "${config.configPath}": ${String(error)} — no hooks registered`)
    return
  }

  /** 中文说明：宿主局部值 model，由紧邻初始化决定。 */
  const model = config.model ?? ''

  // SessionStart is the one emit-shaped (detached) point Codex has: track its
  // run chains so disposal aborts a still-running hook process and drains the
  // continuation (docs/defensive-patterns.md: dispose must reach quiescence).
  /** 中文说明：宿主局部值 detached，由紧邻初始化决定。 */
  const detached = createDetachedRuns()
  ctx.effect(() => () => detached.drain(), 'hooks-codex: drain detached hook runs')

  /**
   * Run and fold one configured Codex hook point.
   *
   * A supplied turn records the hook invocation/result pair inside that open turn.
   * Detached lifecycle points omit it.
   */
  /* 中文说明：函数 runPoint 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  async function runPoint(
    point: string,
    matchQuery: string,
    payload: unknown,
    opts: {
      agent?: Agent
      turn?: number
      readonly signal: AbortSignal
      plainStdoutAsContext?: boolean
    },
  ): Promise<MergedHookOutcome> {
    /** 中文说明：宿主局部值 groups，由紧邻初始化决定。 */
    const groups: MatcherGroup[] = parsed[point] ?? []
    /** 中文说明：宿主局部值 outputs，由紧邻初始化决定。 */
    const outputs: HookOutput[] = []
    // Run hooks in the agent's session workspace so relative paths address the
    // user's project rather than the server launch directory.
    /** 中文说明：宿主局部值 workdir，由紧邻初始化决定。 */
    const workdir = opts.agent?.session.header.cwd
    /** 中文说明：宿主局部值 group，由紧邻初始化决定。 */
    for (const group of groups) {
      // Codex always interprets matchers as regexes; it has no literal fast path.
      if (!matchesMatcher(group.matcher, matchQuery, 'codex')) continue
      /** 中文说明：宿主局部值 hook，由紧邻初始化决定。 */
      for (const hook of group.hooks) {
        /** 中文说明：宿主局部值 handlerId，由紧邻初始化决定。 */
        const handlerId = nextHandlerId(point)
        /** 中文说明：宿主局部值 session，由紧邻初始化决定。 */
        const session = opts.agent?.session
        if (session && opts.turn !== undefined) {
          appendHookInvoked(session, {
            turn: opts.turn, point, dialect: 'codex', handlerId,
            ...group.matcher !== undefined ? { matcher: group.matcher } : {},
          })
        }
        /** 中文说明：宿主局部值 { output, durationMs }，由紧邻初始化决定。 */
        const { output, durationMs } = await runHook(ctx.shell, hook, {
          payload,
          defaultTimeoutMs,
          ...workdir !== undefined ? { cwd: workdir } : {},
          signal: opts.signal,
          trailingNewline: false, // Codex writes stdin without a trailing newline.
          // Discard a `hookSpecificOutput` block naming a different event.
          expectedEventName: point,
        }, () => performance.now())
        // Clean plain stdout becomes context only when no structured context
        // exists; nonzero output and raw JSON never leak as prose.
        if (opts.plainStdoutAsContext === true && output.exitCode === 0
          && output.additionalContext === undefined
          && output.stdout.length > 0 && !output.stdout.startsWith('{')) {
          output.additionalContext = output.stdout
        }
        outputs.push(output)
        // Execution and decision mapping remain in each bridge so dialect
        // differences stay explicit at their owning extension point.
        /* jscpd:ignore-start */
        if (output.systemMessage !== undefined) {
          ctx.logger.warn(`hooks-codex: ${point} hook emitted a systemMessage, which is not yet surfaced (ignored)`)
        }
        if (session && opts.turn !== undefined) {
          appendHookResult(session, { turn: opts.turn, point, handlerId, output, stderrSummaryMaxChars, durationMs })
        }
      }
    }
    return mergeHookOutputs(outputs)
  }

  // TODO(hook-continue-false): `merged.stop` is logged but needs a run-level halt mechanism.

  /** 中文说明：函数 contextFrom 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function contextFrom(merged: MergedHookOutcome): UserMessage | undefined {
    if (merged.additionalContext.length === 0) return undefined
    /** 中文说明：宿主局部值 content，由紧邻初始化决定。 */
    const content: ContentBlock[] = merged.additionalContext.map(text => ({ type: 'text', text }))
    return createUserMessage({ content, source: PLUGIN_SOURCE })
  }

  /** Prepend one context without flattening source fields or other downstream metadata. */
  /* 中文说明：函数 prependContext 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
    return [ours, ...theirs ?? []]
  }

  // SessionStart injects plain stdout when its detached hook resolves; a slow
  // hook may miss the first request.
  // TODO(session-start-gating): add a startup gate before promising first-turn delivery.
  ctx.on('agent/session-start', ({ agent, source }) => {
    detached.track(runPoint('SessionStart', source, { ...base(ctx, agent, 'SessionStart', model), source }, { agent, plainStdoutAsContext: true, signal: detached.signal })
      .then((merged) => {
        /** 中文说明：宿主局部值 context，由紧邻初始化决定。 */
        const context = contextFrom(merged)
        if (context) agent.inject(context)
      })
      .catch((error: unknown) => { ctx.logger.warn(`hooks-codex: SessionStart hook failed: ${String(error)}`) }))
    /* jscpd:ignore-end */
  })

  // UserPromptSubmit → PreStepDecision. Codex supports reject, not rewrite or ask.
  ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next): Promise<PreStepDecision> => {
    if (messages.length === 0) return next()
    /** 中文说明：宿主局部值 payload，由紧邻初始化决定。 */
    const payload = {
      ...base(ctx, agent, 'UserPromptSubmit', model),
      turn_id: String(turn),
      prompt: blocksToText(messages.flatMap(message => message.content)),
    }
    /** 中文说明：宿主局部值 merged，由紧邻初始化决定。 */
    const merged = await runPoint('UserPromptSubmit', '', payload, {
      agent, turn, plainStdoutAsContext: true, signal,
    })
    /* jscpd:ignore-start */
    if (merged.decision === 'deny') {
      return { kind: 'reject' }
    }
    // Context alone is not a veto: DELEGATE so a later pre-step listener can
    // still reject/rewrite, then fold our context onto its decision.
    /** 中文说明：宿主局部值 downstream，由紧邻初始化决定。 */
    const downstream = await next()
    /** 中文说明：宿主局部值 ours，由紧邻初始化决定。 */
    const ours = contextFrom(merged)
    if (!ours || downstream.kind !== 'enter') return downstream
    return {
      kind: 'enter',
      messages: [...downstream.messages, ours],
    }
  })

  // PreToolUse → PreToolDecision. Codex blocks only (no allow/ask honored).
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    /** 中文说明：宿主局部值 turn，由紧邻初始化决定。 */
    const turn = lastTurn(exec.agent)
    /** 中文说明：宿主局部值 merged，由紧邻初始化决定。 */
    const merged = await runPoint('PreToolUse', exec.name, preToolPayload(ctx, exec, model), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    /* jscpd:ignore-end */
    if (merged.decision === 'deny') return { kind: 'deny', reason: merged.reason ?? 'blocked by PreToolUse hook' }
    return next()
  })

  // PostToolUse → PostToolDecision (block with feedback, or attach context).
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    /** 中文说明：宿主局部值 turn，由紧邻初始化决定。 */
    const turn = lastTurn(exec.agent)
    /* jscpd:ignore-start */
    /** 中文说明：宿主局部值 merged，由紧邻初始化决定。 */
    const merged = await runPoint('PostToolUse', exec.name, postToolPayload(ctx, exec, result, model), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    /** 中文说明：宿主局部值 context，由紧邻初始化决定。 */
    const context = contextFrom(merged)
    if (merged.decision === 'deny') {
      return { kind: 'block', feedback: [{ type: 'text', text: merged.reason ?? 'blocked by PostToolUse hook' }], ...context ? { additionalContexts: [context] } : {} }
    }
    // Context alone is not a veto: DELEGATE, then fold our context onto the
    // downstream decision (a downstream block carries it too).
    /** 中文说明：宿主局部值 downstream，由紧邻初始化决定。 */
    const downstream = await next()
    if (!context) return downstream
    if (downstream.kind === 'block') {
      return { ...downstream, additionalContexts: prependContext(context, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(context, downstream.additionalContexts),
    }
  })

  // A blocking Stop hook steers at the stopping boundary, which makes the
  // machine observe pending input and run another step.
  // TODO(stop-loop-guard): Codex supplies `stop_hook_active` so a Stop hook can
  // avoid continuing the same turn indefinitely. It is always false here, so an
  // unconditionally blocking hook force-continues every step until it self-limits.
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }): Promise<void> => {
    /** 中文说明：宿主局部值 merged，由紧邻初始化决定。 */
    const merged = await runPoint('Stop', '', { ...turnBase(ctx, agent, 'Stop', model), stop_hook_active: false, last_assistant_message: null }, { agent, turn, signal })
    /* jscpd:ignore-end */
    if (merged.decision === 'deny') {
      // A blocking Stop hook forces continuation; a block with no reason (exit 2,
      // empty stderr) still forces it — fall back to a generic steering line
      // rather than letting the turn stop.
      /** 中文说明：宿主局部值 text，由紧邻初始化决定。 */
      const text = merged.reason ?? 'continue: blocked by Stop hook'
      agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }))
    }
  })
}

// --- Codex DIALECT payloads: snake_case, model on every event, turn_id on
// turn-scoped events. ---

// These small payload helpers intentionally remain next to the dialect shape;
// sharing them would pull bridge-only agent/LLM dependencies into hook-protocol.
/* jscpd:ignore-start */
/** 中文说明：函数 lastTurn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function lastTurn(agent: Agent | undefined): number {
  if (!agent) return 0
  /** 中文说明：宿主局部值 last，由紧邻初始化决定。 */
  const last = [...agent.session.events].findLast(e => e.type === 'turn/start')
  /* v8 ignore next -- agent-present turnBase callers are tool/stop extension points inside an open turn. */
  return last?.type === 'turn/start' ? last.data.turn : 0
}

/** 中文说明：函数 blocksToText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function blocksToText(content: ContentBlock[]): string {
  return content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('')
}
/* jscpd:ignore-end */

/** Base fields on every Codex payload (no turn_id). */
/* 中文说明：函数 base 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function base(ctx: Context, agent: Agent | undefined, event: string, model: string): Record<string, unknown> {
  return {
    session_id: agent?.session.header.id ?? '',
    transcript_path: agent === undefined
      ? null
      : ctx.get('sessionPersistence')?.locate(agent.session.header)?.path ?? null,
    cwd: agent?.session.header.cwd ?? process.cwd(),
    hook_event_name: event,
    model,
    permission_mode: 'default',
  }
}

/** Base + turn_id, for the turn-scoped events (PreToolUse/PostToolUse/UserPromptSubmit/Stop). */
/* 中文说明：函数 turnBase 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function turnBase(ctx: Context, agent: Agent | undefined, event: string, model: string): Record<string, unknown> {
  return { ...base(ctx, agent, event, model), turn_id: String(lastTurn(agent)) }
}

/** Extract a `command` string from a tool call's parsed arguments, else ''. */
/* 中文说明：函数 commandOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function commandOf(args: unknown): string {
  if (typeof args === 'object' && args !== null && 'command' in args) {
    /** 中文说明：宿主局部值 command，由紧邻初始化决定。 */
    const command: unknown = args.command
    if (typeof command === 'string') return command
  }
  return ''
}

/** 中文说明：函数 preToolPayload 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function preToolPayload(ctx: Context, exec: ToolExecution, model: string): Record<string, unknown> {
  // `tool_name` is the REAL tool name (matching the `exec.name` matcher subject);
  // a hardcoded constant would disagree with what the matcher tests and make a
  // config's tool matcher never fire. `tool_input` keeps Codex's `{ command }`
  // shape (its shell payload), derived from the call's `command` arg when present.
  return { ...turnBase(ctx, exec.agent, 'PreToolUse', model), tool_name: exec.name, tool_input: { command: commandOf(exec.arguments) }, tool_use_id: exec.callId }
}

/** 中文说明：函数 postToolPayload 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function postToolPayload(ctx: Context, exec: ToolExecution, result: ToolExecutionResult, model: string): Record<string, unknown> {
  return { ...turnBase(ctx, exec.agent, 'PostToolUse', model), tool_name: exec.name, tool_input: { command: commandOf(exec.arguments) }, tool_use_id: exec.callId, tool_response: blocksToText(result.content) }
}
