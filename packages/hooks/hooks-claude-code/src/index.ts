/**
 * Bridge for unmodified Claude Code command hooks on harness interception
 * extension points. It supports SessionStart, prompt/tool pre/post, Stop, and subagent
 * start/stop. It owns Claude payloads, environment, substitution, and decision
 * mapping; shared execution and parsing live in `dsh-hook-protocol`.
 * `updatedInput` is logged and warned but not honored. Bespoke behavior should
 * use typed native plugins on the same extension points; see the
 * [hook-bridges Agent Note](../../../../.agents/notes/implemented/feature/2026-06-30-hook-bridges.md).
 * @module @deepseek-ai/dsh-hooks-claude-code
 */
/*
 * 文件职责：实现Claude Code Hook 桥的 index.ts 模块。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Claude Code Hook 桥可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：解析配置，匹配事件，执行处理器并合并输出。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

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
  /** 中文说明：类型或类 HookOutput 约束 Hook、守卫或目标数据职责。 */
  type HookOutput,
  /** 中文说明：类型或类 MatcherGroup 约束 Hook、守卫或目标数据职责。 */
  type MatcherGroup,
  /** 中文说明：类型或类 MergedHookOutcome 约束 Hook、守卫或目标数据职责。 */
  type MergedHookOutcome,
} from '@deepseek-ai/dsh-hook-protocol'
// Pulls in the declaration-merged subagent events and the identity pairing their
// start/end edges.
import type { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import { parseClaudeCodeConfig, type ClaudeCodeHookConfig } from './config.ts'

/** 中文说明：协议局部值 name，由紧邻初始化决定。 */
export const name = 'hooks-claude-code'
// `bash` is required to run hooks; the rest are read opportunistically via
// ctx.get so a deployment can load this bridge without every extension point present.
/** 中文说明：协议局部值 inject，由紧邻初始化决定。 */
export const inject = ['shell']

/** Plugin config: where the CC hook config lives + substitution roots. */
/* 中文说明：类型或类 Config 约束 Hook、守卫或目标数据职责。 */
export interface Config {
  /**
   * Path to a `hooks.json` or a settings file whose `hooks` key holds the config.
   * Process-level: read once at load, a relative path resolves against the process
   * launch cwd, so one config applies to the whole process.
   * TODO(per-session-hook-config): per-session discovery of a project-local
   * `hooks.json` from each `session/new.cwd`.
   */
  configPath: string
  /**
   * Replaces `${CLAUDE_PLUGIN_ROOT}` in command strings (the plugin's root dir).
   */
  pluginRoot?: string
  /**
   * Replaces `${CLAUDE_PROJECT_DIR}` in command strings AND is exported as the
   * `CLAUDE_PROJECT_DIR` env var for hook processes. When omitted, the env var
   * defaults per-run to the agent's session workspace (`session.header.cwd`, the
   * same dir the hook runs in) — Claude Code always exports this var, and common
   * unmodified hooks reference `$CLAUDE_PROJECT_DIR` for project-relative paths.
   */
  projectDir?: string
  /** Default per-hook timeout in ms when a hook sets none (CC default: 600000). */
  defaultTimeoutMs?: number
  /** Character cap for the `hook/result` event's persisted stderr summary. */
  stderrSummaryMaxChars?: number
}

/** 中文说明：协议局部值 Config，由紧邻初始化决定。 */
export const Config: z<Config> = z.object({
  configPath: z.string().required(),
  pluginRoot: z.string(),
  projectDir: z.string(),
  defaultTimeoutMs: z.number().default(DEFAULT_HOOK_TIMEOUT_MS),
  stderrSummaryMaxChars: z.number().default(DEFAULT_STDERR_SUMMARY_MAX_CHARS),
})

/** A stable per-handler id so an invoked/result pair correlates in the log. */
/* 中文说明：协议局部值 handlerCounter，由紧邻初始化决定。 */
let handlerCounter = 0
/** 中文说明：函数 nextHandlerId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function nextHandlerId(point: string): string {
  return `claude-code:${point}:${++handlerCounter}`
}

/** The `{kind:'plugin'}` source stamped on every context this bridge injects. */
/* 中文说明：协议局部值 PLUGIN_SOURCE，由紧邻初始化决定。 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'hooks-claude-code' }

/** The summary cap bounds a persisted event field — a positive integer or the slice misbehaves silently. */
/* 中文说明：函数 assertPositiveInteger 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`hooks-claude-code: ${name} must be a positive integer`)
  }
}

/** 中文说明：函数 apply 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function apply(ctx: Context, config: Config): void {
  // Validate before config parsing so a bad value cannot be hidden by its early return.
  /** 中文说明：协议局部值 stderrSummaryMaxChars，由紧邻初始化决定。 */
  const stderrSummaryMaxChars = config.stderrSummaryMaxChars ?? DEFAULT_STDERR_SUMMARY_MAX_CHARS
  assertPositiveInteger('stderrSummaryMaxChars', stderrSummaryMaxChars)
  /** 中文说明：协议局部值 defaultTimeoutMs，由紧邻初始化决定。 */
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS
  // Parse once at load. A read or parse failure logs and registers nothing.
  /** 中文说明：协议局部值 parsed，由紧邻初始化决定。 */
  let parsed: ClaudeCodeHookConfig = {}
  try {
    /** 中文说明：协议局部值 raw，由紧邻初始化决定。 */
    const raw: unknown = JSON.parse(readFileSync(config.configPath, 'utf8'))
    /** 中文说明：协议局部值 result，由紧邻初始化决定。 */
    const result = parseClaudeCodeConfig(raw, {
      ...config.pluginRoot !== undefined ? { pluginRoot: config.pluginRoot } : {},
      ...config.projectDir !== undefined ? { projectDir: config.projectDir } : {},
    })
    parsed = result.config
    /** 中文说明：协议局部值 s，由紧邻初始化决定。 */
    for (const s of result.skipped) {
      ctx.logger.warn(`hooks-claude-code: skipping unsupported "${s.type}" hook on ${s.event} (only command hooks run)`)
    }
  } catch (error: unknown) {
    ctx.logger.warn(`hooks-claude-code: could not load hook config "${config.configPath}": ${String(error)} — no hooks registered`)
    return
  }

  // Emit-shaped points run detached, so track their chains; disposal aborts
  // active hooks and drains continuations before resolving.
  /** 中文说明：协议局部值 detached，由紧邻初始化决定。 */
  const detached = createDetachedRuns()
  // Only the start edge guarantees registry access. Retain each local child
  // through its paired end so stop hooks keep the session workspace after the
  // handle unregisters the agent. Every retained entry relies on that paired
  // end; a producer that can omit it must provide another release edge.
  /** 中文说明：协议局部值 subagentChildren，由紧邻初始化决定。 */
  const subagentChildren = new Map<SubagentRunId, Agent>()
  ctx.effect(() => () => detached.drain(), 'hooks-claude-code: drain detached hook runs')

  /**
   * Run every command hook configured for `point` whose matcher selects
   * `matchQuery`, with the per-event `payload` on stdin, and fold the results.
   * Writes a `hook/invoked`/`hook/result` pair per hook when `opts.turn` names
   * an open turn. Detached lifecycle points omit the pair. Returns the merged outcome (a neutral,
   * already-most-restrictive view) for the caller to map onto its extension point
   * decision. `matchQuery` is the event's matcher subject (tool name, session
   * source, …); `''` for events that ignore matchers.
   */
  /* 中文说明：函数 runPoint 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  async function runPoint(
    point: string,
    matchQuery: string,
    payload: unknown,
    opts: { agent?: Agent; turn?: number; readonly signal: AbortSignal },
  ): Promise<MergedHookOutcome> {
    /** 中文说明：协议局部值 groups，由紧邻初始化决定。 */
    const groups: MatcherGroup[] = parsed[point] ?? []
    /** 中文说明：协议局部值 outputs，由紧邻初始化决定。 */
    const outputs: HookOutput[] = []
    // Run the hook in the agent's session workspace (the `session/new` cwd on the session
    // header), not the executor or entry-point process's launch dir.
    /** 中文说明：协议局部值 workdir，由紧邻初始化决定。 */
    const workdir = opts.agent?.session.header.cwd
    // CLAUDE_PROJECT_DIR: an explicit config value wins; otherwise default it to the session
    // workspace (the same dir the hook runs in).
    /** 中文说明：协议局部值 projectDir，由紧邻初始化决定。 */
    const projectDir = config.projectDir ?? workdir
    /** 中文说明：协议局部值 hookEnv，由紧邻初始化决定。 */
    const hookEnv = projectDir !== undefined ? { CLAUDE_PROJECT_DIR: projectDir } : undefined
    /** 中文说明：协议局部值 group，由紧邻初始化决定。 */
    for (const group of groups) {
      if (!matchesMatcher(group.matcher, matchQuery, 'claude-code')) continue
      /** 中文说明：协议局部值 hook，由紧邻初始化决定。 */
      for (const hook of group.hooks) {
        /** 中文说明：协议局部值 handlerId，由紧邻初始化决定。 */
        const handlerId = nextHandlerId(point)
        /** 中文说明：协议局部值 session，由紧邻初始化决定。 */
        const session = opts.agent?.session
        if (session && opts.turn !== undefined) {
          appendHookInvoked(session, {
            turn: opts.turn, point, dialect: 'claude-code', handlerId,
            ...group.matcher !== undefined ? { matcher: group.matcher } : {},
          })
        }
        /** 中文说明：协议局部值 { output, durationMs }，由紧邻初始化决定。 */
        const { output, durationMs } = await runHook(ctx.shell, hook, {
          payload,
          defaultTimeoutMs,
          ...hookEnv ? { env: hookEnv } : {},
          ...workdir !== undefined ? { cwd: workdir } : {},
          signal: opts.signal,
          trailingNewline: true,
          // Discard a `hookSpecificOutput` block whose `hookEventName` names a
          // different event than the one firing (the schemas key it by event).
          expectedEventName: point,
        }, () => performance.now())
        outputs.push(output)
        if (output.updatedInput !== undefined) {
          ctx.logger.warn(`hooks-claude-code: ${point} hook requested updatedInput, which is not yet honored (ignored)`)
        }
        if (output.systemMessage !== undefined) {
          ctx.logger.warn(`hooks-claude-code: ${point} hook emitted a systemMessage, which is not yet surfaced (ignored)`)
        }
        if (session && opts.turn !== undefined) {
          appendHookResult(session, { turn: opts.turn, point, handlerId, output, stderrSummaryMaxChars, durationMs })
        }
      }
    }
    return mergeHookOutputs(outputs)
  }

  // TODO(hook-continue-false): `merged.stop` is logged but needs a run-level halt mechanism.

  /** Build additional model context from hook output, or return undefined when empty. */
  /* 中文说明：函数 contextFrom 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function contextFrom(merged: MergedHookOutcome): UserMessage | undefined {
    if (merged.additionalContext.length === 0) return undefined
    /** 中文说明：协议局部值 content，由紧邻初始化决定。 */
    const content: ContentBlock[] = merged.additionalContext.map(text => ({ type: 'text', text }))
    return createUserMessage({ content, source: PLUGIN_SOURCE })
  }

  /** Prepend one context without flattening source fields or other downstream metadata. */
  /* 中文说明：函数 prependContext 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
    return [ours, ...theirs ?? []]
  }

  // SessionStart injects context when its detached hook resolves; a slow hook
  // may miss the first request.
  // TODO(session-start-gating): add a startup gate before promising first-turn delivery.
  ctx.on('agent/session-start', ({ agent, source }) => {
    detached.track(runPoint('SessionStart', source, sessionStartPayload(ctx, agent, source), { agent, signal: detached.signal })
      .then((merged) => {
        /** 中文说明：协议局部值 context，由紧邻初始化决定。 */
        const context = contextFrom(merged)
        if (context) agent.inject(context)
      })
      .catch((error: unknown) => {
        ctx.logger.warn(`hooks-claude-code: SessionStart hook failed: ${String(error)}`)
      }))
  })

  // --- UserPromptSubmit → PreStepDecision. The prompt text is the payload; no
  // matcher subject (CC ignores matchers for this event). ---
  ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next): Promise<PreStepDecision> => {
    if (messages.length === 0) return next()
    /** 中文说明：协议局部值 content，由紧邻初始化决定。 */
    const content = messages.flatMap(message => message.content)
    /** 中文说明：协议局部值 merged，由紧邻初始化决定。 */
    const merged = await runPoint('UserPromptSubmit', '', promptPayload(ctx, agent, content), { agent, turn, signal })
    if (merged.decision === 'deny') {
      return { kind: 'reject' }
    }
    // Delegate so later listeners may still rewrite or reject, then prepend our
    // context only to a downstream enter decision.
    /** 中文说明：协议局部值 downstream，由紧邻初始化决定。 */
    const downstream = await next()
    /** 中文说明：协议局部值 ours，由紧邻初始化决定。 */
    const ours = contextFrom(merged)
    if (!ours || downstream.kind !== 'enter') return downstream
    return {
      kind: 'enter',
      messages: [...downstream.messages, ours],
    }
  })

  // --- PreToolUse → PreToolDecision. Matcher subject is the tool name. ---
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    /** 中文说明：协议局部值 turn，由紧邻初始化决定。 */
    const turn = lastTurn(exec.agent)
    /** 中文说明：协议局部值 merged，由紧邻初始化决定。 */
    const merged = await runPoint('PreToolUse', exec.name, preToolPayload(ctx, exec), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    if (merged.decision === 'deny') return { kind: 'deny', reason: merged.reason ?? 'blocked by PreToolUse hook' }
    if (merged.decision === 'ask') return { kind: 'ask', ...merged.reason !== undefined ? { reason: merged.reason } : {} }
    return next()
  })

  // --- PostToolUse → PostToolDecision. Matcher subject is the tool name. ---
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    /** 中文说明：协议局部值 turn，由紧邻初始化决定。 */
    const turn = lastTurn(exec.agent)
    /** 中文说明：协议局部值 merged，由紧邻初始化决定。 */
    const merged = await runPoint('PostToolUse', exec.name, postToolPayload(ctx, exec, result), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    /** 中文说明：协议局部值 context，由紧邻初始化决定。 */
    const context = contextFrom(merged)
    if (merged.decision === 'deny') {
      return { kind: 'block', feedback: [{ type: 'text', text: merged.reason ?? 'blocked by PostToolUse hook' }], ...context ? { additionalContexts: [context] } : {} }
    }
    // Our hooks did not block. DELEGATE so a later listener can still block/replace,
    // then fold our context onto its decision (a downstream block carries it too).
    /** 中文说明：协议局部值 downstream，由紧邻初始化决定。 */
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
  // TODO(stop-loop-guard): cap consecutive forced continuations; hooks must self-limit meanwhile.
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }): Promise<void> => {
    /** 中文说明：协议局部值 merged，由紧邻初始化决定。 */
    const merged = await runPoint('Stop', '', stopPayload(ctx, agent), { agent, turn, signal })
    if (merged.decision === 'deny') {
      // A blocking Stop hook forces continuation.
      /** 中文说明：协议局部值 text，由紧邻初始化决定。 */
      const text = merged.reason ?? 'continue: blocked by Stop hook'
      agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }))
    }
  })

  // SubagentStart may inject child context; SubagentStop only observes. Both
  // use the live child's workspace and the generic agent-type matcher subject.
  ctx.on('subagent/start', (info) => {
    /** 中文说明：协议局部值 child，由紧邻初始化决定。 */
    const child = ctx.get('agents')?.get(info.id)
    if (child !== undefined) subagentChildren.set(info.runId, child)
    detached.track(runPoint('SubagentStart', SUBAGENT_TYPE, subagentPayload(ctx, 'SubagentStart', info, child), { ...child ? { agent: child } : {}, signal: detached.signal })
      .then((merged) => {
        /** 中文说明：协议局部值 context，由紧邻初始化决定。 */
        const context = contextFrom(merged)
        if (context && child) child.inject(context)
      })
      .catch((error: unknown) => { ctx.logger.warn(`hooks-claude-code: SubagentStart hook failed: ${String(error)}`) }))
  })
  ctx.on('subagent/end', (info) => {
    /** 中文说明：协议局部值 child，由紧邻初始化决定。 */
    const child = subagentChildren.get(info.runId) ?? ctx.get('agents')?.get(info.id)
    subagentChildren.delete(info.runId)
    detached.track(runPoint('SubagentStop', SUBAGENT_TYPE, subagentPayload(ctx, 'SubagentStop', info, child), { ...child ? { agent: child } : {}, signal: detached.signal }))
  })
}

/**
 * The `agent_type` value the bridge reports for SubagentStart/Stop. The harness
 * subagent seam carries no per-kind label, so the bridge uses Claude Code's own
 * Task-tool default — a hooks.json with a default/`*`/empty `agent_type` matcher
 * fires; a config matching a specific kind (e.g. `code-reviewer`) does not.
 */
/* 中文说明：协议局部值 SUBAGENT_TYPE，由紧邻初始化决定。 */
const SUBAGENT_TYPE = 'general-purpose'

// --- Per-event stdin payloads (the CC DIALECT shape). Field names match CC's
// hook input schema; this is the part a bridge owns. ---

/** The last open turn number in the agent's log, or 0 without an agent. */
/* 中文说明：函数 lastTurn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function lastTurn(agent: Agent | undefined): number {
  if (!agent) return 0
  /** 中文说明：协议局部值 last，由紧邻初始化决定。 */
  const last = [...agent.session.events].findLast(e => e.type === 'turn/start')
  /* v8 ignore next -- agent-present callers are tool/stop extension points inside an open turn. */
  return last?.type === 'turn/start' ? last.data.turn : 0
}

/** Flatten content blocks to the text a hook payload carries (the common case). */
/* 中文说明：函数 blocksToText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function blocksToText(content: ContentBlock[]): string {
  return content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('')
}

/** 中文说明：函数 base 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function base(ctx: Context, agent: Agent | undefined, event: string): Record<string, unknown> {
  return {
    session_id: agent?.session.header.id ?? '',
    transcript_path: agent === undefined
      ? ''
      : ctx.get('sessionPersistence')?.locate(agent.session.header)?.path ?? '',
    cwd: agent?.session.header.cwd ?? process.cwd(),
    hook_event_name: event,
  }
}

/** 中文说明：函数 sessionStartPayload 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sessionStartPayload(ctx: Context, agent: Agent, source: string): Record<string, unknown> {
  return { ...base(ctx, agent, 'SessionStart'), source }
}
/** 中文说明：函数 promptPayload 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function promptPayload(ctx: Context, agent: Agent, content: ContentBlock[]): Record<string, unknown> {
  return { ...base(ctx, agent, 'UserPromptSubmit'), prompt: blocksToText(content) }
}
/** 中文说明：函数 preToolPayload 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function preToolPayload(ctx: Context, exec: ToolExecution): Record<string, unknown> {
  return { ...base(ctx, exec.agent, 'PreToolUse'), tool_name: exec.name, tool_input: exec.arguments, tool_use_id: exec.callId }
}
/** 中文说明：函数 postToolPayload 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function postToolPayload(ctx: Context, exec: ToolExecution, result: ToolExecutionResult): Record<string, unknown> {
  return { ...base(ctx, exec.agent, 'PostToolUse'), tool_name: exec.name, tool_input: exec.arguments, tool_use_id: exec.callId, tool_response: blocksToText(result.content) }
}
/** 中文说明：函数 stopPayload 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stopPayload(ctx: Context, agent: Agent): Record<string, unknown> {
  return { ...base(ctx, agent, 'Stop'), stop_hook_active: false }
}
/**
 * Build a SubagentStart/SubagentStop payload from the CC base (the child's
 * `session_id`/`cwd` when the child agent is available) plus the subagent-hook
 * fields. `agent_type` is the CC-default {@link SUBAGENT_TYPE}; `stop_hook_active`
 * is present on SubagentStop only (the loop-guard flag, always false).
 */
/* 中文说明：函数 subagentPayload 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function subagentPayload(ctx: Context, event: 'SubagentStart' | 'SubagentStop', info: { id: string }, child: Agent | undefined): Record<string, unknown> {
  return {
    ...base(ctx, child, event),
    agent_id: info.id,
    agent_type: SUBAGENT_TYPE,
    ...event === 'SubagentStop' ? { stop_hook_active: false } : {},
  }
}
