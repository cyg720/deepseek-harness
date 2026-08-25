/**
 * One-shot Codex child lifecycle: spawn the real app-server through the
 * subprocess seam, publish only after initialization and ephemeral thread
 * creation, flatten post-publication failures, and dispose to whole-tree
 * quiescence.
 *
 * @module @deepseek-ai/dsh-subagent-codex/run
 */
/**
 * 文件职责：实现 run.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  settleRunResult,
  subprocessRunHandle,
  /** 中文说明：type SubagentResult 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type SubagentResult,
  /** 中文说明：type SubagentRun 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type SubagentRun,
  /** 中文说明：type SubagentStartRequest 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type SubagentStartRequest,
  /** 中文说明：type SubagentStopReason 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import {
  CodexAppServerWire,
  /** 中文说明：type CodexWireFailureFacts 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type CodexWireFailureFacts,
} from './wire.ts'

/** Default POSIX grace between subprocess termination tiers. */
/** 中文说明：常量 DEFAULT_DISPOSE_GRACE_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** 中文说明：interface CodexPackageManifest 定义本模块所需的数据或行为，用于表达子代理场景。 */
interface CodexPackageManifest {
  readonly bin: {
    readonly codex: string
  }
}

/** 中文说明：变量 codexPackageJsonPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const codexPackageJsonPath = createRequire(import.meta.url).resolve('@openai/codex/package.json')
/** 中文说明：变量 codexPackageManifest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const codexPackageManifest = JSON.parse(
  readFileSync(codexPackageJsonPath, 'utf8'),
) as CodexPackageManifest

/** Absolute package-local JavaScript wrapper selected by the package manifest. */
/** 中文说明：常量 CODEX_PACKAGE_BIN 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CODEX_PACKAGE_BIN = resolve(
  dirname(codexPackageJsonPath),
  codexPackageManifest.bin.codex,
)

/** Profile-selectable non-interactive Codex permission mode. */
/** 中文说明：type CodexPermissionMode 定义本模块所需的数据或行为，用于表达子代理场景。 */
export type CodexPermissionMode =
  | 'never'
  | 'approve-for-me'
  | 'dangerously-bypass-approvals-and-sandbox'

/** Native non-interactive Codex modes mapped to official `thread/start` fields. */
/** 中文说明：常量 CODEX_PERMISSION_MODES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const CODEX_PERMISSION_MODES = [
  'never',
  'approve-for-me',
  'dangerously-bypass-approvals-and-sandbox',
] as const satisfies readonly CodexPermissionMode[]

/** Safe default for unattended Codex runs. */
/** 中文说明：常量 DEFAULT_CODEX_PERMISSION_MODE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const DEFAULT_CODEX_PERMISSION_MODE: CodexPermissionMode = 'never'

/** 中文说明：type CodexFailureStage 定义本模块所需的数据或行为，用于表达子代理场景。 */
type CodexFailureStage =
  | 'initialize'
  | 'thread-start'
  | CodexWireFailureFacts['stage']
  | 'process'
  | 'teardown'

/** 中文说明：interface CodexFailureFacts 定义本模块所需的数据或行为，用于表达子代理场景。 */
interface CodexFailureFacts {
  readonly stage: CodexFailureStage
  readonly category: string
  readonly httpStatus?: number | undefined
  readonly outcome?: SubprocessOutcome | undefined
}

/** 中文说明：函数 failureDiagnostic 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function failureDiagnostic(facts: CodexFailureFacts): string {
  /** 中文说明：变量 fields 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fields = [
    'product: Codex',
    `stage: ${facts.stage}`,
    `category: ${facts.category}`,
  ]
  if (facts.httpStatus !== undefined) {
    fields.push(`HTTP status: ${facts.httpStatus}`)
  }
  /** 中文说明：变量 processFields 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const processFields = [
    ['exit code', facts.outcome?.exitCode],
    ['signal', facts.outcome?.signal],
  ] as const
  /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
  for (const [label, value] of processFields) {
    if (value !== null && value !== undefined) fields.push(`${label}: ${value}`)
  }
  return `Product subagent failure (${fields.join('; ')})`
}

/** 中文说明：class CodexRunFailure 定义本模块所需的数据或行为，用于表达子代理场景。 */
class CodexRunFailure extends Error {
  constructor(
    readonly facts: CodexFailureFacts,
    cause?: unknown,
  ) {
    super(
      `subagent-codex: ${failureDiagnostic(facts)}`,
      cause === undefined ? undefined : { cause },
    )
    this.name = 'CodexRunFailure'
  }
}

/**
 * Hide an unpublished Host failure behind fixed safe startup facts.
 * @param cause Original Host failure retained for internal diagnostics.
 * @returns A startup failure whose message contains only fixed safe facts.
 */
/** 中文说明：函数 codexStartupFailure 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function codexStartupFailure(cause: unknown): Error {
  return new CodexRunFailure({
    stage: 'initialize',
    category: 'unknown',
  }, cause)
}

/**
 * Fixed package-local app-server command, independent of the host `PATH`.
 * @returns Node, the official wrapper, and the fixed app-server arguments.
 */
/** 中文说明：函数 codexAppServerArgv 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function codexAppServerArgv(): string[] {
  return [process.execPath, CODEX_PACKAGE_BIN, 'app-server', '--stdio']
}

/** Fully resolved inputs for one Codex app-server run. */
/** 中文说明：interface CodexRunSpec 定义本模块所需的数据或行为，用于表达子代理场景。 */
export interface CodexRunSpec {
  /** Parent Session workspace, also supplied to `thread/start`. */
  readonly cwd: string
  /** Profile-selected native non-interactive permission mode. */
  readonly permissionMode: CodexPermissionMode
  /** Explicit deployment/test environment layered after the shared scrub. */
  readonly env: Record<string, string>
  /** Subprocess termination grace passed to the shared process-tree owner. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Diagnostic sink for a post-publication error flattened into a result. */
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/** 中文说明：函数 thrown 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function thrown(value: unknown): Error {
  /* v8 ignore next -- typed subprocess/wire failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Validate and preserve the one-shot task before crossing the process boundary.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the exact non-empty text block sequence.
 */
/** 中文说明：函数 textTask 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function textTask(prompt: readonly ContentBlock[]): string[] {
  if (prompt.length === 0) {
    throw new Error('subagent-codex: the one-shot task must contain only text blocks')
  }
  /** 中文说明：变量 texts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const texts: string[] = []
  /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-codex: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error('subagent-codex: the one-shot task must not be empty')
  }
  return texts
}

/**
 * Close the private wire, terminate the managed process tree, and wait for the
 * subprocess owner to prove it is gone.
 * @param wire - private app-server protocol connection.
 * @param child - shared-service handle that owns the process tree.
 */
/** 中文说明：函数 disposeCodexChild 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export async function disposeCodexChild(
  wire: CodexAppServerWire,
  child: SubprocessHandle,
): Promise<void> {
  wire.close()

  if (child.pid > 0) {
    /** 中文说明：变量 outcome 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let outcome: SubprocessOutcome | undefined
    void child.done.then(
      (value) => { outcome = value },
      /* v8 ignore next -- a positive pid excludes spawn-level done rejection. */
      () => {},
    )
    try {
      child.stdin?.end()
    } catch {
      // A concurrently closed stdin does not change tree ownership below.
    }
    child.terminate()
    try {
      await child.waitForExit()
    } catch (error: unknown) {
      throw new CodexRunFailure({
        stage: 'teardown',
        category: 'unknown',
        outcome,
      }, thrown(error))
    }
    await child.done
  } else {
    await child.done.catch(() => {})
  }
}

/**
 * Start the real `codex app-server --stdio` child and publish its one-shot run.
 * @param request - resolved shared subagent request.
 * @param spec - Workspace, environment, process service, and diagnostic policy.
 * @returns the published run after initialization and ephemeral thread creation.
 */
/** 中文说明：函数 startCodexRun 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export async function startCodexRun(
  request: SubagentStartRequest,
  spec: CodexRunSpec,
): Promise<SubagentRun> {
  /** 中文说明：变量 texts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const texts = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-codex: request was aborted before app-server startup')
  }

  /** 中文说明：变量 child 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let child: SubprocessHandle
  try {
    child = spec.spawn({
      argv: codexAppServerArgv(),
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: spec.disposeGraceMs,
      env: spec.env,
    })
  } catch (error: unknown) {
    throw new CodexRunFailure({
      stage: 'initialize',
      category: 'unknown',
    }, thrown(error))
  }

  /** 中文说明：变量 wire 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const wire = new CodexAppServerWire(
    child.stdout as NonNullable<SubprocessHandle['stdout']>,
    child.stdin as NonNullable<SubprocessHandle['stdin']>,
    spec.permissionMode,
  )
  /** 中文说明：函数值 onStderr 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const onStderr = (chunk: Buffer | string): void => {
    /** 中文说明：变量 bytes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    wire.observeStderr(bytes.toString())
    try {
      // Synchronous fd forwarding preserves byte order without owning a
      // backpressure queue. A slow host sink can block this event-loop turn.
      writeFileSync(process.stderr.fd, bytes)
    } catch {
      // Host stderr is an observation sink, not a child-run failure authority.
    }
  }
  /** 中文说明：函数值 onStderrError 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const onStderrError = (): void => {
    // Stderr observation is auxiliary. JSON-RPC and child.done remain the
    // only terminal authorities if the diagnostic stream itself fails.
  }
  child.stderr?.on('data', onStderr)
  child.stderr?.on('error', onStderrError)
  /** 中文说明：函数值 disposeProcess 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const disposeProcess = async (): Promise<void> => {
    try {
      await disposeCodexChild(wire, child)
      // Let stderr already queued by the process close reach both bounded
      // diagnostic consumers before their listeners are detached.
      await new Promise<void>((resolve) => { setImmediate(resolve) })
    } finally {
      child.stderr?.off('data', onStderr)
      child.stderr?.off('error', onStderrError)
    }
  }

  /** 中文说明：变量 processFailureFacts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let processFailureFacts: CodexFailureFacts | undefined
  /** 中文说明：变量 processFailure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const processFailure: Promise<never> = child.done.then<never>(
    (outcome) => {
      processFailureFacts = {
        stage: 'process',
        category: 'process-exit',
        outcome,
      }
      throw new CodexRunFailure(processFailureFacts)
    },
    (error: unknown) => {
      processFailureFacts = {
        stage: 'process',
        category: 'unknown',
      }
      throw new CodexRunFailure(processFailureFacts, thrown(error))
    },
  )
  // A normal post-result dispose also closes the process. Keep its expected
  // late rejection observed when the terminal result settles first.
  processFailure.catch(() => {})

  /** 中文说明：变量 runAbort 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const runAbort = new AbortController()
  /** 中文说明：函数值 requestCancel 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const requestCancel = (): void => {
    if (runAbort.signal.aborted) return
    runAbort.abort(new Error('subagent-codex: run cancelled locally'))
    wire.interrupt()
  }
  /** 中文说明：函数值 onAbort 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  /** 中文说明：变量 startupStage 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let startupStage: 'initialize' | 'thread-start' = 'initialize'
  try {
    wire.start()
    await Promise.race([wire.initialize(request.signal), processFailure])
    startupStage = 'thread-start'
    await Promise.race([wire.startThread(spec.cwd, request.signal), processFailure])
  } catch (error: unknown) {
    request.signal.removeEventListener('abort', onAbort)
    /** 中文说明：变量 cancelledBeforeCleanup 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelledBeforeCleanup = runAbort.signal.aborted
    if (!(error instanceof CodexRunFailure) && !cancelledBeforeCleanup) {
      // Node reports stdout EOF before the child close that owns its outcome.
      // Let an already-exiting process publish those facts before rollback.
      await new Promise<void>((resolve) => { setImmediate(resolve) })
    }
    /** 中文说明：变量 failure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new CodexRunFailure({
      stage: startupStage,
      category: 'unknown',
      outcome: error instanceof CodexRunFailure
        ? error.facts.outcome
        : processFailureFacts?.outcome,
    }, thrown(error))
    try {
      await disposeProcess()
    } catch (disposeError: unknown) {
      /** 中文说明：变量 cleanupFailure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const cleanupFailure = thrown(disposeError)
      throw new AggregateError(
        [failure, cleanupFailure],
        `${failure.message}; ${cleanupFailure.message}`,
      )
    }
    if (cancelledBeforeCleanup) {
      throw new Error('subagent-codex: request was aborted before run publication')
    }
    try {
      request.signal.throwIfAborted()
    } catch {
      throw new Error('subagent-codex: request was aborted before run publication')
    }
    throw failure
  }

  /** 中文说明：函数值 collectOutput 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const collectOutput = (): ContentBlock[] => wire.collectOutput()
  /** 中文说明：变量 diagnostic 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let diagnostic: string | undefined
  /** 中文说明：函数值 recordFailureDiagnostic 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const recordFailureDiagnostic = (facts: CodexFailureFacts): string => {
    /** 中文说明：变量 failure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = failureDiagnostic(facts)
    /** 中文说明：变量 permission 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const permission = wire.collectDiagnostic()
    diagnostic = permission === undefined
      ? failure
      : `${failure}\n${permission}`
    return diagnostic
  }
  /** 中文说明：函数值 withProcessOutcome 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const withProcessOutcome = (facts: CodexFailureFacts): CodexFailureFacts => {
    /** 中文说明：变量 outcome 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcome = processFailureFacts?.outcome
    return outcome === undefined
      ? facts
      : { ...facts, outcome }
  }
  /** 中文说明：变量 publishedProcessFailure 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const publishedProcessFailure = processFailure.catch(
    async (error: unknown): Promise<never> => {
      // Frames already queued by the exiting app-server remain authoritative.
      // One I/O turn lets them settle before process exit ends the run.
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      throw error
    },
  )
  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result: Promise<SubagentResult> = settleRunResult({
    attempt: async () => {
      try {
        /** 中文说明：变量 terminal 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const terminal = await Promise.race([
          wire.runTurn(texts, runAbort.signal),
          publishedProcessFailure,
        ])
        if (terminal.stopReason === 'completed') return terminal
        // Let stderr already queued with the terminal frame contribute its
        // fixed permission fact before the non-completed result is snapshotted.
        await new Promise<void>((resolve) => { setImmediate(resolve) })
        /** 中文说明：变量 facts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const facts = withProcessOutcome(wire.collectFailure())
        return { ...terminal, diagnostic: recordFailureDiagnostic(facts) }
      } catch (error: unknown) {
        // Give stderr data already queued in Node one turn to reach the wire
        // before settlement snapshots the diagnostic.
        await new Promise<void>((resolve) => { setImmediate(resolve) })
        /** 中文说明：变量 endedBeforeTerminal 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const endedBeforeTerminal = wire.endedBeforeTerminal()
        if (
          endedBeforeTerminal
          && processFailureFacts === undefined
          && !runAbort.signal.aborted
        ) {
          try {
            /** 中文说明：变量 exited 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const exited = await child.waitForExit(
              AbortSignal.timeout(Math.ceil(spec.disposeGraceMs)),
            )
            if (exited) await child.done
          } catch {
            // The wire failure remains authoritative when exit observation fails.
          }
        }
        /** 中文说明：变量 facts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const facts = error instanceof CodexRunFailure
          ? error.facts
          : endedBeforeTerminal && processFailureFacts !== undefined
            ? processFailureFacts
            : withProcessOutcome(wire.collectFailure())
        recordFailureDiagnostic(facts)
        throw error instanceof CodexRunFailure
          ? error
          : new CodexRunFailure(facts, thrown(error))
      }
    },
    collectOutput,
    collectDiagnostic: () => diagnostic,
    cancelled: () => runAbort.signal.aborted,
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
    teardown: disposeProcess,
  })
}
