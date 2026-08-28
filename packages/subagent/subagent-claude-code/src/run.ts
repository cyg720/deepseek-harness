/**
 * One-shot Claude Code lifecycle: invoke the official Agent SDK, place its
 * real CLI process under the shared subprocess owner, map only strict SDK
 * success to completion, and dispose to whole-tree quiescence.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code/run
 */
/*
 * 文件职责：实现 run.ts 覆盖的子代理进程与协议行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的子代理进程与协议能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */

import { randomUUID } from 'node:crypto'
import {
  query as officialQuery,
  /** 中文说明：type Options 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type Options,
  /** 中文说明：type Query 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type Query,
  /** 中文说明：type SDKMessage 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SDKMessage,
  /** 中文说明：type SDKResultMessage 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SDKResultMessage,
  /** 中文说明：type SpawnOptions 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  settleRunResult,
  subprocessRunHandle,
  /** 中文说明：type SubagentResult 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SubagentResult,
  /** 中文说明：type SubagentRun 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SubagentRun,
  /** 中文说明：type SubagentStartRequest 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SubagentStartRequest,
  /** 中文说明：type SubagentStopReason 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import {
  scrubbedParentEnv,
  /** 中文说明：type SubprocessHandle 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SubprocessHandle,
  /** 中文说明：type SubprocessOutcome 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SubprocessOutcome,
  /** 中文说明：type SubprocessSpawnSpec 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import {
  claudeSpawnSpec,
  ManagedClaudeCodeProcess,
} from './process.ts'

/** Default POSIX grace between subprocess termination tiers. */
/* 中文说明：常量 DEFAULT_DISPOSE_GRACE_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** Claude Code permission modes that cannot wait for a human response. */
/* 中文说明：常量 CLAUDE_CODE_PERMISSION_MODES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const CLAUDE_CODE_PERMISSION_MODES = [
  'dontAsk',
  'acceptEdits',
  'auto',
  'plan',
  'bypassPermissions',
] as const satisfies readonly NonNullable<Options['permissionMode']>[]

/** Profile-selectable non-interactive Claude Code permission mode. */
/* 中文说明：type ClaudeCodePermissionMode 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
export type ClaudeCodePermissionMode = typeof CLAUDE_CODE_PERMISSION_MODES[number]

/** Safe default for unattended Claude Code runs. */
/* 中文说明：常量 DEFAULT_CLAUDE_CODE_PERMISSION_MODE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const DEFAULT_CLAUDE_CODE_PERMISSION_MODE: ClaudeCodePermissionMode = 'dontAsk'

/** 中文说明：常量 SUPPORTED_UNATTENDED_DIALOG_KINDS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SUPPORTED_UNATTENDED_DIALOG_KINDS = [
  'refusal_fallback_prompt',
] satisfies NonNullable<Options['supportedDialogKinds']>

type ClaudeCodeFailureStage =
  | 'query-start'
  | 'query-run'
  | 'process'
  | 'teardown'

/** 中文说明：type ClaudeCodeFailureCategory 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
type ClaudeCodeFailureCategory =
  | 'limit'
  | 'product-error'
  | 'invalid-result'
  | 'process'
  | 'unknown'

/** 中文说明：interface ClaudeCodeFailureFacts 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
interface ClaudeCodeFailureFacts {
  readonly stage: ClaudeCodeFailureStage
  readonly category: ClaudeCodeFailureCategory
  readonly outcome?: SubprocessOutcome | undefined
}

/** 中文说明：函数 failureDiagnostic 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function failureDiagnostic(facts: ClaudeCodeFailureFacts): string {
  /** 中文说明：变量 fields 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fields = [
    'product: Claude Code',
    `stage: ${facts.stage}`,
    `category: ${facts.category}`,
  ]
  /** 中文说明：变量 exitCode 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const exitCode = facts.outcome?.exitCode
  if (exitCode !== null && exitCode !== undefined) {
    fields.push(`exit code: ${exitCode}`)
  }
  /** 中文说明：变量 signal 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const signal = facts.outcome?.signal
  if (signal !== null && signal !== undefined) {
    fields.push(`signal: ${signal}`)
  }
  return `Product subagent failure (${fields.join('; ')})`
}

/** 中文说明：class ClaudeCodeFailure 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
class ClaudeCodeFailure extends Error {
  constructor(
    readonly facts: ClaudeCodeFailureFacts,
    cause?: unknown,
  ) {
    super(
      `subagent-claude-code: ${failureDiagnostic(facts)}`,
      cause === undefined ? undefined : { cause },
    )
    this.name = 'ClaudeCodeFailure'
  }
}

/** 中文说明：函数 sdkFailureCategory 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function sdkFailureCategory(
  subtype: string,
): ClaudeCodeFailureCategory {
  switch (subtype) {
    case 'error_max_turns':
    case 'error_max_budget_usd':
    case 'error_max_structured_output_retries':
      return 'limit'
    case 'error_during_execution':
      return 'product-error'
    default:
      return 'unknown'
  }
}

/**
 * Hide an unpublished product startup failure behind fixed safe facts.
 * @param cause - original host-side failure retained only on the Error cause chain.
 * @returns a rejection safe to expose through the subagent start boundary.
 */
/*
 * 中文说明：函数 claudeCodeStartupFailure 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param cause 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function claudeCodeStartupFailure(cause: unknown): Error {
  return new ClaudeCodeFailure({
    stage: 'query-start',
    category: 'unknown',
  }, cause)
}

/** 中文说明：函数 unattendedDiagnostic 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function unattendedDiagnostic(
  mode: ClaudeCodePermissionMode,
  request: 'tool permission' | 'MCP elicitation' | 'user dialog',
  decision: 'denied' | 'declined' | 'cancelled',
  reason: string,
): string {
  return `Claude Code unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`
}

/* jscpd:ignore-start -- sibling providers intentionally keep product-private
 * run inputs and error normalization instead of adding a shared lifecycle owner. */
/** Fully resolved inputs for one official Claude Agent SDK query. */
/* 中文说明：interface ClaudeCodeRunSpec 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
export interface ClaudeCodeRunSpec {
  /** Parent Session workspace supplied to the SDK and real CLI. */
  readonly cwd: string
  /** Profile-selected native model; omitted to preserve Claude settings. */
  readonly model?: string
  /** Profile-selected native non-interactive permission mode. */
  readonly permissionMode: ClaudeCodePermissionMode
  /** Explicit deployment/test environment layered after shared scrubbing. */
  readonly env: Record<string, string>
  /** Subprocess termination grace passed to the shared process-tree owner. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Host diagnostic sink for a product failure kept outside model-visible text. */
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/** 中文说明：函数 thrown 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function thrown(value: unknown): Error {
  /* v8 ignore next -- typed SDK and subprocess failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/** Read live request cancellation across awaited startup cleanup. */
/* 中文说明：函数 isAborted 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/* jscpd:ignore-end */

/**
 * Validate and preserve the one-shot task before crossing the SDK boundary.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the exact text sequence as one SDK prompt.
 */
/*
 * 中文说明：函数 textTask 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param prompt 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function textTask(prompt: readonly ContentBlock[]): string {
  if (prompt.length === 0) {
    throw new Error('subagent-claude-code: the one-shot task must contain only text blocks')
  }
  /** 中文说明：变量 texts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const texts: string[] = []
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-claude-code: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error('subagent-claude-code: the one-shot task must not be empty')
  }
  return texts.join('')
}

/**
 * Strictly derive the only SDK result that can complete a shared run.
 * @param message - an official discriminated result union.
 * @returns exact final text for a successful, non-error result.
 */
/*
 * 中文说明：函数 successfulResult 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param message 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function successfulResult(message: SDKResultMessage): string {
  if (message.subtype !== 'success') {
    /** 中文说明：变量 category 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const category = sdkFailureCategory(message.subtype)
    /** 中文说明：变量 detail 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const detail = category === 'unknown'
      ? undefined
      : message.errors.join('; ')
    throw new ClaudeCodeFailure(
      { stage: 'query-run', category },
      detail === undefined || detail.length === 0
        ? undefined
        : new Error(detail),
    )
  }
  if (message.is_error || message.result.trim().length === 0) {
    throw new ClaudeCodeFailure({
      stage: 'query-run',
      category: 'invalid-result',
    })
  }
  return message.result
}

/**
 * Consume the complete SDK stream and require one strict success plus normal
 * iterator completion.
 * @param query - published official SDK query.
 * @param onPermissionDenied - records a safe fact when the SDK reports native denial.
 * @param onResult - records that the SDK supplied a terminal result message.
 * @returns the completed shared result.
 */
/*
 * 中文说明：函数 consumeClaudeQuery 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param query 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param onPermissionDenied 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param onResult 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function consumeClaudeQuery(
  query: AsyncIterable<SDKMessage>,
  onPermissionDenied?: () => void,
  onResult?: () => void,
): Promise<SubagentResult> {
  /** 中文说明：变量 answer 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let answer: string | undefined
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for await (const message of query) {
    if (message.type === 'system' && message.subtype === 'permission_denied') {
      onPermissionDenied?.()
      continue
    }
    if (message.type !== 'result') continue
    onResult?.()
    answer = successfulResult(message)
  }
  if (answer === undefined) {
    throw new ClaudeCodeFailure({
      stage: 'query-run',
      category: 'invalid-result',
    })
  }
  return {
    output: [{ type: 'text', text: answer }],
    stopReason: 'completed',
  }
}

/**
 * Close the official query, terminate the managed process tree, and wait for
 * the subprocess owner to prove it is gone.
 * @param query - official SDK query, when creation reached that point.
 * @param child - live shared-service handle that owns the CLI process tree;
 * spawn-failed handles settle at the startup boundary instead.
 */
/*
 * 中文说明：函数 disposeClaudeCodeChild 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param query 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param child 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export async function disposeClaudeCodeChild(
  query: Pick<Query, 'close'> | undefined,
  child: SubprocessHandle,
): Promise<void> {
  /** 中文说明：变量 failures 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const failures: Error[] = []
  try {
    query?.close()
  } catch (error: unknown) {
    failures.push(thrown(error))
  }

  child.terminate()
  try {
    await child.waitForExit()
  } catch (error: unknown) {
    failures.push(thrown(error))
  }
  /** 中文说明：变量 outcome 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const outcome = await child.done

  /** 中文说明：变量 firstFailure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const firstFailure = failures[0]
  if (firstFailure !== undefined) {
    /** 中文说明：变量 facts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const facts = {
      stage: 'teardown',
      category: 'unknown',
      outcome,
    } as const
    /** 中文说明：变量 cause 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cause = failures.length === 1
      ? firstFailure
      : new AggregateError(failures, 'Claude Code teardown failures')
    throw new ClaudeCodeFailure(facts, cause)
  }
}

/**
 * Build the fixed official SDK options for one one-shot provider run.
 * @param spec - Workspace, environment, process service, and disposal policy.
 * @param controller - per-run cancellation owner.
 * @param capture - receives the shared child and SDK-facing process synchronously.
 * @param captureDiagnostic - receives safe facts from unattended interaction callbacks.
 * @returns options that inherit native settings while disabling persistence and user questions.
 */
/*
 * 中文说明：函数 claudeQueryOptions 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param spec 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param controller 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param capture 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param captureDiagnostic 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function claudeQueryOptions(
  spec: ClaudeCodeRunSpec,
  controller: AbortController,
  capture: (
    child: SubprocessHandle,
    process: ManagedClaudeCodeProcess,
  ) => void,
  captureDiagnostic: (diagnostic: string) => void,
): Options {
  return {
    abortController: controller,
    cwd: spec.cwd,
    ...spec.model === undefined ? {} : { model: spec.model },
    env: { ...scrubbedParentEnv(), ...spec.env },
    persistSession: false,
    disallowedTools: spec.permissionMode === 'plan'
      ? ['AskUserQuestion', 'ExitPlanMode']
      : ['AskUserQuestion'],
    permissionMode: spec.permissionMode,
    ...spec.permissionMode === 'bypassPermissions'
      ? { allowDangerouslySkipPermissions: true }
      : {
        canUseTool: () => {
          captureDiagnostic(unattendedDiagnostic(
            spec.permissionMode,
            'tool permission',
            'denied',
            'the provider does not request human approval',
          ))
          return Promise.resolve({
            behavior: 'deny' as const,
            message: 'This unattended Claude Code subagent cannot request human approval.',
          })
        },
      },
    onElicitation: () => {
      captureDiagnostic(unattendedDiagnostic(
        spec.permissionMode,
        'MCP elicitation',
        'declined',
        'the provider does not collect interactive MCP input',
      ))
      return Promise.resolve({ action: 'decline' })
    },
    onUserDialog: () => {
      captureDiagnostic(unattendedDiagnostic(
        spec.permissionMode,
        'user dialog',
        'cancelled',
        'the provider does not render blocking dialogs',
      ))
      return Promise.resolve({ behavior: 'cancelled' as const })
    },
    supportedDialogKinds: SUPPORTED_UNATTENDED_DIALOG_KINDS,
    spawnClaudeCodeProcess: (options: SpawnOptions) => {
      /** 中文说明：变量 child 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const child = spec.spawn(claudeSpawnSpec(options, spec.disposeGraceMs))
      /** 中文说明：变量 process 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const process = new ManagedClaudeCodeProcess(child)
      capture(child, process)
      return process
    },
  }
}

/**
 * Start one official Claude Agent SDK query and publish its one-shot run.
 * @param request - resolved shared subagent request.
 * @param spec - Workspace, environment, process service, and diagnostic policy.
 * @returns the published run after both Query and real CLI handle exist.
 */
/*
 * 中文说明：函数 startClaudeCodeRun 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param request 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param spec 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function startClaudeCodeRun(
  request: SubagentStartRequest,
  spec: ClaudeCodeRunSpec,
): Promise<SubagentRun> {
  /** 中文说明：变量 prompt 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const prompt = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-claude-code: request was aborted before SDK startup')
  }

  /** 中文说明：变量 controller 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const controller = new AbortController()
  /** 中文说明：函数值 requestCancel 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const requestCancel = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(new Error('subagent-claude-code: run cancelled locally'))
    }
  }
  /** 中文说明：函数值 onAbort 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })
  /** 中文说明：函数值 reportFailure 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const reportFailure = (error: Error): void => {
    try {
      spec.onError?.(error, 'error')
    } catch {
      // Host diagnostic logging cannot replace the product failure.
    }
  }

  /** 中文说明：变量 child 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let child: SubprocessHandle | undefined
  /** 中文说明：变量 query 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let query: Query | undefined
  /** 中文说明：变量 managedProcess 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let managedProcess: ManagedClaudeCodeProcess | undefined
  /** 中文说明：变量 diagnostic 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let diagnostic: string | undefined
  /** 中文说明：函数值 capturePermissionDiagnostic 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const capturePermissionDiagnostic = (value: string): void => {
    diagnostic = value
  }
  /** 中文说明：函数值 prependFailureDiagnostic 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const prependFailureDiagnostic = (facts: ClaudeCodeFailureFacts): void => {
    /** 中文说明：变量 failure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = failureDiagnostic(facts)
    diagnostic = diagnostic === undefined
      ? failure
      : `${failure}\n${diagnostic}`
  }
  /** 中文说明：变量 captureChild 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const captureChild = (
    captured: SubprocessHandle,
    process: ManagedClaudeCodeProcess,
  ): void => {
    child = captured
    managedProcess = process
  }
  try {
    query = officialQuery({
      prompt,
      options: claudeQueryOptions(
        spec,
        controller,
        captureChild,
        capturePermissionDiagnostic,
      ),
    })
    if (child === undefined || child.pid <= 0) {
      throw new Error(
        'subagent-claude-code: official SDK did not publish a controllable Claude Code process',
      )
    }
    if (controller.signal.aborted) {
      throw new Error('subagent-claude-code: request was aborted before SDK startup')
    }
  } catch (error: unknown) {
    request.signal.removeEventListener('abort', onAbort)
    /** 中文说明：变量 cancelledBeforeCleanup 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelledBeforeCleanup = controller.signal.aborted
    // Let child.done publish a concurrently observed exit before classification.
    await Promise.resolve()
    /** 中文说明：变量 startupOutcome 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const startupOutcome = managedProcess?.outcome
    /** 中文说明：变量 startupFacts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const startupFacts = {
      stage: 'query-start',
      category: 'unknown',
      outcome: startupOutcome,
    } as const
    /** 中文说明：函数值 startupFailure 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const startupFailure = (cause: unknown = error): ClaudeCodeFailure => new ClaudeCodeFailure(
      startupFacts,
      thrown(cause),
    )
    requestCancel()
    if (child !== undefined && child.pid <= 0) {
      /** 中文说明：变量 closeError 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let closeError: Error | undefined
      try {
        query?.close()
      } catch (disposeError: unknown) {
        closeError = thrown(disposeError)
      }

      /** 中文说明：变量 spawnError 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let spawnError = thrown(error)
      try {
        await child.done
      } catch (childError: unknown) {
        spawnError = thrown(childError)
      }

      if (closeError !== undefined) {
        /** 中文说明：变量 failure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const failure = startupFailure(spawnError)
        /** 中文说明：变量 cleanupFailure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const cleanupFailure = new ClaudeCodeFailure({
          stage: 'teardown',
          category: 'unknown',
        }, closeError)
        /** 中文说明：变量 aggregate 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const aggregate = new AggregateError(
          [failure, cleanupFailure],
          `${failure.message}; ${cleanupFailure.message}`,
        )
        reportFailure(aggregate)
        throw aggregate
      }
      if (cancelledBeforeCleanup || isAborted(request.signal)) {
        throw new Error('subagent-claude-code: request was aborted before SDK startup')
      }
      /** 中文说明：变量 failure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const failure = startupFailure(spawnError)
      reportFailure(failure)
      throw failure
    }
    if (child !== undefined) {
      try {
        await disposeClaudeCodeChild(query, child)
      } catch (disposeError: unknown) {
        /** 中文说明：变量 failure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const failure = startupFailure()
        /** 中文说明：变量 cleanupFailure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const cleanupFailure = thrown(disposeError)
        /** 中文说明：变量 aggregate 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const aggregate = new AggregateError(
          [failure, cleanupFailure],
          `${failure.message}; ${cleanupFailure.message}`,
        )
        reportFailure(aggregate)
        throw aggregate
      }
    } else if (query !== undefined) {
      try {
        query.close()
      } catch (disposeError: unknown) {
        /** 中文说明：变量 failure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const failure = startupFailure()
        /** 中文说明：变量 cleanupFailure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const cleanupFailure = new ClaudeCodeFailure({
          stage: 'teardown',
          category: 'unknown',
        }, thrown(disposeError))
        /** 中文说明：变量 aggregate 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const aggregate = new AggregateError(
          [failure, cleanupFailure],
          `${failure.message}; ${cleanupFailure.message}`,
        )
        reportFailure(aggregate)
        throw aggregate
      }
    }
    if (cancelledBeforeCleanup || isAborted(request.signal)) {
      throw new Error('subagent-claude-code: request was aborted before SDK startup')
    }
    /** 中文说明：变量 failure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = startupFailure()
    reportFailure(failure)
    throw failure
  }

  /** 中文说明：变量 publishedQuery 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const publishedQuery = query
  /** 中文说明：变量 publishedChild 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const publishedChild = child
  /** 中文说明：变量 receivedResult 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let receivedResult = false
  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = settleRunResult({
    attempt: async () => {
      try {
        return await consumeClaudeQuery(publishedQuery, () => {
          capturePermissionDiagnostic(unattendedDiagnostic(
            spec.permissionMode,
            'tool permission',
            'denied',
            'Claude Code denied the request before an interactive prompt',
          ))
        }, () => {
          receivedResult = true
        })
      } catch (error: unknown) {
        /** 中文说明：变量 processOutcome 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const processOutcome = managedProcess?.outcome
        /** 中文说明：变量 facts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        let facts: ClaudeCodeFailureFacts
        if (error instanceof ClaudeCodeFailure) {
          facts = { ...error.facts, outcome: processOutcome }
        } else if (processOutcome !== undefined && !receivedResult) {
          facts = {
            stage: 'process',
            category: 'process',
            outcome: processOutcome,
          }
        } else {
          facts = {
            stage: 'query-run',
            category: 'unknown',
            outcome: processOutcome,
          }
        }
        prependFailureDiagnostic(facts)
        // Keep the SDK category and cause; the diagnostic adds later process facts.
        throw error instanceof ClaudeCodeFailure
          ? error
          : new ClaudeCodeFailure(facts, thrown(error))
      }
    },
    collectOutput: () => [],
    collectDiagnostic: () => diagnostic,
    cancelled: () => controller.signal.aborted,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  })

  return subprocessRunHandle({
    id: SessionId(randomUUID()),
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: async () => {
      try {
        await disposeClaudeCodeChild(publishedQuery, publishedChild)
      } catch (error: unknown) {
        /** 中文说明：变量 failure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const failure = thrown(error)
        reportFailure(failure)
        throw failure
      }
    },
  })
}
