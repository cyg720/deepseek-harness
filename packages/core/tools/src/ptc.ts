/**
 * PTC mode `run_code` transport. Programs call the registry's agent-visible
 * tools through nested executions scheduled under the native concurrency
 * contract; each sub-dispatch is logged for reconstruction, while only the
 * outer curated result enters model history.
 * @module @deepseek-ai/dsh-tools/src/ptc
 */

import { ToolCallId, createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { CodeBindingFunction, CodeRunResult, CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import { defineTool, parameterSchemaSpecToJsonSchema } from './schema.ts'
import { TOOL_RUNTIME_SCHEDULER } from './index.ts'
import type { PtcDispatchLog, ToolDefinition, ToolExecutionResult, ToolRuntime, ToolRunContext } from './index.ts'
import type {} from './types.ts'

/** The model-facing name of the PTC mode tool. */
export const RUN_CODE_NAME = 'run_code'

/** The `tools:sdk` section order, after per-tool guidance sections. */
export const SDK_SECTION_ORDER = FIRST_PARTY_SECTION_ORDER.TOOLS_SDK

/**
 * The language-specific `run_code` schema text: the tool `description` and its
 * `code` parameter description, kept together so a language's two model-facing
 * strings share one source of truth. Keyed by `CodeRuntime.language`, mirroring
 * `SDK_RENDERERS` in {@link ./index.ts}. The emitted flavor MUST match the
 * semantics the same language's SDK instructions promise, so the model never
 * receives a TypeScript schema beside a Python SDK (or vice versa).
 */
interface RunCodeFlavor {
  /** The tool `description` the model sees for this language. */
  /* 【中文】该语言下模型看到的 run_code 工具描述。 */
  readonly description: string
  /** The `code` parameter's description for this language. */
  /* 【中文】该语言下 code 参数的描述文本。 */
  readonly codeDescription: string
}

/**
 * The TypeScript flavor: the fallback for a schema read with no runtime
 * mounted ({@link resolveFlavor} owns which readers reach that). A real
 * assembly always resolves a runtime first, so the model never sees this
 * fallback outside its own language.
 */
const TYPESCRIPT_FLAVOR: RunCodeFlavor = {
  description:
    'Execute a TypeScript program against the available tools. Takes two required '
    + 'arguments: `code`, the BODY of an async function (erasable syntax only; top-level '
    + '`await` and `return` work), and `description`, a short summary of what the program '
    + 'does. Call tools as `await tools.name(args)` per the declarations in the system '
    + 'prompt. Only what you print or return is program output — curate it. Image-bearing '
    + 'subtool results are attached after the run.',
  codeDescription: 'The program: the body of an async TypeScript function.',
}

/**
 * The Python flavor: the body of an async function, top-level `await` and
 * `return`, answer via `print` and/or the returned value, matching
 * {@link ./py-types.ts}'s SDK instructions.
 */
const PYTHON_FLAVOR: RunCodeFlavor = {
  description:
    'Execute a Python program against the available tools. Takes two required '
    + 'arguments: `code`, the BODY of an async function (top-level `await` and `return` '
    + 'work), and `description`, a short summary of what the program does. Call tools as '
    + '`await tools.name(args)` per the declarations in the system prompt. Use '
    + '`print(...)` and/or `return <value>` for program output — curate it. Image-bearing '
    + 'subtool results are attached after the run.',
  codeDescription: 'The program: the body of an async Python function.',
}

/**
 * The languages PTC mode ships a presentation for. Both per-language tables —
 * {@link RUN_CODE_FLAVORS} here and `SDK_RENDERERS` in {@link ./index.ts} — are
 * checked against this union with `satisfies`, so a language added to one and
 * not the other fails `typecheck` instead of waiting for a runtime that reports
 * it. The tables stay declared `Record<string, …>` because `CodeRuntime.language`
 * is an unconstrained `string`: this union pins what the harness ships, while the
 * `Object.hasOwn` guards reject what a mounted runtime may report.
 */
/*
 * 【中文】Code Mode 目前支持的语言联合。两张按语言索引的表（本文件的
 *   RUN_CODE_FLAVORS 与 index.ts 的 SDK_RENDERERS）都用 satisfies 对齐这个联合，
 *   新增语言漏掉任何一张表都会在 typecheck 阶段报错。表本身声明为
 *   Record<string, …> 是因为 CodeRuntime.language 是无约束 string——由 Object.hasOwn
 *   守卫拒绝运行时报告的未知语言。
 */
export type CodeSdkLanguage = 'typescript' | 'python'

/** Per-language `run_code` schema flavors (see {@link RunCodeFlavor}); one entry per {@link CodeSdkLanguage}. */
/*
 * 【中文】按语言索引的 run_code 模式文本表；satisfies 保证每种支持语言都有条目。
 */
const RUN_CODE_FLAVORS: Record<string, RunCodeFlavor> = {
  typescript: TYPESCRIPT_FLAVOR,
  python: PYTHON_FLAVOR,
} satisfies Record<CodeSdkLanguage, RunCodeFlavor>

/**
 * The `description` parameter's model-facing description: language-independent
 * (the UI label contract is the same for every runtime), shared between the
 * static spec and the language-aware `parameters` getter so the two emissions
 * can never drift.
 */
const RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
  = 'Clear, concise description of what this program does in active voice, '
    + '5-10 words (shown in the UI). Examples: "Count TODO markers across packages"; '
    + '"Read failing test and its fixture"; "Rename config key in every cordis.yml".'

/**
 * Resolve the {@link RunCodeFlavor} for the loaded runtime's language, read at
 * schema-emission time so the model-visible `run_code` schema always matches
 * the SDK section's language. `peekRuntime` returns `undefined` only when no
 * runtime is mounted, which reaches this function through definition readers
 * and `schemas()` — the doc-catalog harvest is the only shipped one, and none
 * of them feeds a model, because `wireSchemas` calls `requireCodeRuntime`
 * before projecting — so that path degrades to {@link TYPESCRIPT_FLAVOR}. A
 * mounted runtime whose language has no flavor entry fails loud, exactly as
 * `requireCodeRuntime` rejects it at assembly. Keeping this table in step with
 * `SDK_RENDERERS` is the compiler's job ({@link CodeSdkLanguage}); what this
 * guard owns is the runtime-supplied language neither table knows, which never
 * yields a wrong-language schema for a real runtime.
 */
/*
 * 【中文】按已加载运行时的语言解析 run_code 的模式文本。无运行时挂载 → 降级为
 *   TypeScript 缺省（只有文档目录采集等不喂模型的读取路径会走到）；语言未知 →
 *   大声报错，绝不给真实运行时输出错误语言的 schema。
 * @param peekRuntime - 读取 ctx.codeRuntime 但不抛错的探测函数。
 * @returns 对应语言的描述与 code 参数描述。
 */
function resolveFlavor(peekRuntime: () => CodeRuntime | undefined): RunCodeFlavor {
  const runtime = peekRuntime()
  if (runtime === undefined) {
    // No runtime mounted: reached by definition readers and `schemas()`, of
    // which the doc-catalog harvest is the only shipped one. None feeds a
    // model — `wireSchemas` calls `requireCodeRuntime` before projecting, so
    // the assembly path never arrives here. Degrade to the TS default.
    return TYPESCRIPT_FLAVOR
  }
  // Own-property read: a language like `toString`/`constructor` would otherwise
  // resolve an inherited Object.prototype member as a flavor.
  const flavor = RUN_CODE_FLAVORS[runtime.language]
  if (!Object.hasOwn(RUN_CODE_FLAVORS, runtime.language) || flavor === undefined) {
    const known = Object.keys(RUN_CODE_FLAVORS).map(name => JSON.stringify(name)).join(', ')
    throw new Error(`dsh-tools: no run_code schema flavor registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`)
  }
  return flavor
}

/**
 * Thrown by `run_code` when the program run itself failed — a program
 * exception, a budget expiry, an abort, or substrate death. Extends
 * {@link HarnessError} (`code: 'CODE_RUN_FAILED'`); the registry's execution
 * pipeline converts it into a structured `isError` result whose text carries
 * the failure kind plus the captured logs, so the model can self-correct.
 */
export class CodeRunFailedError extends HarnessError {
  constructor(message: string) {
    super(message, 'CODE_RUN_FAILED')
    this.name = 'CodeRunFailedError'
  }
}

/**
 * Snapshot one binding call's argument as lossless JSON, then snapshot that
 * detached value again so dispatch and logging stay independent without
 * reintroducing structured-clone's platform-specific nesting limit.
 */
/*
 * 【中文】把绑定调用的一次参数做两次快照：先归一化为无损 JSON（作为真正下发执行的
 *   值），再对快照再快照一份（作为日志记录的独立副本）。两次分离保证执行与日志互不
 *   影响——工具若原地改参数，也不会让日志与实际收到的值脱节；同时绕开了
 *   structured-clone 的平台相关嵌套深度限制。
 * @param value - 程序传入的原始参数（任意形状）。
 * @returns dispatched（下发值）与 logged（独立日志副本）。
 */
function jsonNormalizeArgs(value: unknown): { dispatched: unknown; logged: unknown } {
  // 【中文】第一次快照：归一化 + 校验无损 JSON（失败即报错，模型可自纠）。
  let snapshot: JsonValue | undefined
  try {
    snapshot = snapshotJsonValue(value) as JsonValue | undefined
  } catch (error: unknown) {
    throw new Error(`tool arguments must be lossless JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (snapshot === undefined) {
    throw new Error('tool arguments must be lossless JSON (call the tool with an arguments object, e.g. `{}`)')
  }
  const logged = snapshotJsonValue(snapshot)
  /* v8 ignore next -- snapshot is already a detached lossless JSON value. */
  if (logged === undefined) {
    throw new Error('tool arguments could not be detached for durable logging')
  }
  return { dispatched: snapshot, logged }
}

/** Two-space JSON presentation, matching the existing shallow `run_code` text contract. */
/*
 * 【中文】JSON 展示的缩进单位：两个空格，与既有 run_code 文本契约保持一致。
 */
const JSON_INDENT = '  '

/**
 * ECMAScript caps `JSON.stringify`'s `space` string at ten characters. The
 * renderer also caps TOTAL indentation there, compacting deeper subtrees, so
 * formatted output remains linear in the canonical JSON size.
 */
const MAX_JSON_INDENT_CHARS = 10

/** A pending fragment in the iterative JSON presentation traversal. */
/*
 * 【中文】JSON 展示遍历的栈任务：text 直接输出；value 是待渲染值，depth 记层级、
 *   compact 标记"已超缩进上限，此后紧凑输出"。
 */
type JsonRenderTask =
  | { kind: 'text'; text: string }
  | { kind: 'value'; value: JsonValue; depth: number; compact: boolean }

/** Render one non-string JSON root without recursive traversal or unbounded indentation growth. */
/*
 * 【中文】把非字符串 JSON 值渲染为模型可读文本：显式栈遍历（无递归）；缩进总量封顶
 *   10 空格——更深的子树自动转紧凑模式，保证格式化输出对规范 JSON 大小保持线性。
 */
function renderJsonValue(value: Exclude<JsonValue, string>): string {
  // 【中文】chunks 收集片段；tasks 为待处理工作栈。
  const chunks: string[] = []
  const tasks: JsonRenderTask[] = [{ kind: 'value', value, depth: 0, compact: false }]
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (task.kind === 'text') {
      chunks.push(task.text)
      continue
    }

    const current = task.value
    if (current === null || typeof current === 'boolean' || typeof current === 'number') {
      chunks.push(String(current))
      continue
    }
    if (typeof current === 'string') {
      chunks.push(JSON.stringify(current))
      continue
    }

    const compact = task.compact || (task.depth + 1) * JSON_INDENT.length > MAX_JSON_INDENT_CHARS
    const childDepth = task.depth + 1
    if (Array.isArray(current)) {
      chunks.push('[')
      if (current.length === 0) {
        chunks.push(']')
        continue
      }
      tasks.push({ kind: 'text', text: compact ? ']' : `\n${JSON_INDENT.repeat(task.depth)}]` })
      for (let index = current.length - 1; index >= 0; index--) {
        const item = current[index]
        /* v8 ignore next -- canonical JsonValue arrays are dense. */
        if (item === undefined) throw new Error('cannot render a sparse JSON array')
        tasks.push({ kind: 'value', value: item, depth: childDepth, compact })
        tasks.push({
          kind: 'text',
          text: compact
            ? index === 0 ? '' : ','
            : `${index === 0 ? '\n' : ',\n'}${JSON_INDENT.repeat(childDepth)}`,
        })
      }
      continue
    }

    const keys = Object.keys(current)
    chunks.push('{')
    if (keys.length === 0) {
      chunks.push('}')
      continue
    }
    tasks.push({ kind: 'text', text: compact ? '}' : `\n${JSON_INDENT.repeat(task.depth)}}` })
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]
      /* v8 ignore next -- the loop is bounded by the captured key count. */
      if (key === undefined) throw new Error('cannot render a missing JSON object key')
      const item = current[key]
      /* v8 ignore next -- canonical JsonValue records contain no undefined properties. */
      if (item === undefined) throw new Error('cannot render an undefined JSON object property')
      tasks.push({ kind: 'value', value: item, depth: childDepth, compact })
      tasks.push({
        kind: 'text',
        text: compact
          ? `${index === 0 ? '' : ','}${JSON.stringify(key)}:`
          : `${index === 0 ? '\n' : ',\n'}${JSON_INDENT.repeat(childDepth)}${JSON.stringify(key)}: `,
      })
    }
  }
  return chunks.join('')
}

/** Render one present program completion value for the model-facing result text. */
/*
 * 【中文】渲染程序完成值：字符串原样输出，其余走格式化 JSON 渲染器。
 */
function renderValue(value: JsonValue): string {
  return typeof value === 'string' ? value : renderJsonValue(value)
}

/** Canonical value returned by the outer PTC mode transport. */
type RunCodeOutput = { logs: string[]; result?: JsonValue }

/**
 * Registry-private capabilities the bridge receives at construction — the
 * `requireRuntime` idiom: operations only the owning registry can mint stay
 * off its public service API and flow here as closures instead.
 */
export interface RunCodeBridgeOptions {
  /** Resolves `ctx.codeRuntime` or throws the loud misconfiguration error (shared with the registry's assembly-time checks). */
  /* 【中文】解析代码运行时，缺失时抛出可操作的误配置错误（与装配期检查共用）。 */
  requireRuntime: () => CodeRuntime
  /**
   * Reads `ctx.codeRuntime` without throwing: `undefined` when none is mounted.
   * Lets schema emission tell "no runtime" (degrade to TS; the readers that
   * reach it are {@link resolveFlavor}'s) apart from "unknown language" (fail
   * loud).
   */
  peekRuntime: () => CodeRuntime | undefined
  /** The run's overlap cap for parallel-classified sub-calls (the registry passes its validated `maxParallelSubCalls`). */
  maxParallel: number
  /** Runs the contained `tools/ptc-dispatch-log` waterfall over one settled sub-dispatch (the registry's private invoker). */
  shapeDispatchLog: (dispatch: PtcDispatchLog) => Promise<ContentBlock[]>
}

/**
 * Build the `run_code` {@link ToolDefinition}: required `code` and
 * `description` parameters, executed through the dispatch bridge described
 * above. The
 * registry reserves it as presentation infrastructure under non-native modes,
 * outside the filterable global/scoped capability layers.
 * @param registry - the owning registry (sub-calls go through its `execute`,
 *   bindings cover its registered tools).
 * @param options - the registry-private capabilities described above.
 * @returns the registry-ready definition.
 */
export function createRunCodeTool(registry: ToolRuntime, options: RunCodeBridgeOptions): ToolDefinition {
  const { requireRuntime, peekRuntime, maxParallel, shapeDispatchLog } = options
  // 【中文】用 defineTool 搭出 run_code 的外壳：静态参数 spec（code/description 两个
  //   必填字符串）负责参数校验；语言相关的描述/参数文本由下方 getter 延迟解析。
  const definition = defineTool({
    name: RUN_CODE_NAME,
    // The description and `code` parameter description are placeholders here:
    // the language-aware getters installed below replace both, resolving the
    // loaded runtime's flavor at schema-emission time so the schema the MODEL
    // sees matches the SDK section's language. Argument VALIDATION still keys
    // off this static spec (defineTool closes over it), which is language-
    // independent (one required string `code`).
    description: TYPESCRIPT_FLAVOR.description,
    parameters: {
      code: { type: 'string', required: true, description: TYPESCRIPT_FLAVOR.codeDescription },
      description: {
        type: 'string',
        required: true,
        description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          logs: { type: 'array', required: true, items: { type: 'string' } },
          result: { type: 'json' },
        },
      },
      render: (_args, value) => {
        const rendered = value.result === undefined ? '' : renderValue(value.result)
        const parts = [value.logs.join('\n'), rendered].filter(part => part.length > 0)
        return [{ type: 'text', text: parts.length > 0 ? parts.join('\n') : '(run_code completed with no output)' }]
      },
    },
    async execute(args, exec): Promise<RunCodeOutput> {
      // 【中文】一次 run_code 运行的完整生命周期：
      //   ① 建立运行级中止控制器（跟随外部信号进入，运行结束因任何原因落定时触发，
      //      在途子分派被中止、未启动的排队分派被放弃）；
      //   ② 构建单车道调度器：有序阶段（开始事件、pre-execute/guards、post-execute、
      //      落定事件）严格串行，只有 around-dispatch/工具体阶段并发；parallel 类调用
      //      最多 maxParallel 个重叠，exclusive 调用独占并形成屏障直到提交完成；
      //   ③ 为每个可见工具生成绑定函数，程序经 tools.name(args) 调用它们；
      //   ④ runtime.run 执行程序；finally 中先中止并排空全部分派再关闭回合。
      if (args.description.trim().length === 0) {
        throw new Error('invalid description: expected a non-empty string')
      }
      const runtime = requireRuntime()

      // The run-scoped abort: follows the outer signal in, and fires when the
      // run settles for ANY reason, so an in-flight sub-dispatch is aborted
      // (its executor kills on this signal) instead of orphaned, and
      // queued-unstarted dispatches are abandoned.
      const runController = new AbortController()
      const onOuterAbort = (): void => { runController.abort(exec.signal.reason) }
      exec.signal.addEventListener('abort', onOuterAbort, { once: true })

      // 【中文】已提交的分派计数：子调用 id `<parent>:code:<n>` 的序号来源。
      let dispatches = 0
      // The per-run scheduler uses the registry's staged interface and follows
      // the same concurrency rules as the native loop. It also follows the
      // native loop's SEQUENCING: every ordered stage (the dispatch-start
      // append, prepare = pre-execute/guards, finalize/finish = post-execute,
      // context deferral, the settle append) runs inside ONE driver lane, so
      // ordered policy stages never overlap each other and only the
      // around-dispatch/body stage runs concurrently. Starts are strictly
      // submission-ordered; results commit in submission order through the
      // head-of-line cursor. Consecutive parallel-classified calls overlap up
      // to maxParallel; an exclusive call waits for the pool to drain, runs
      // alone, and holds its barrier until its COMMIT (post-execute included)
      // completes, exactly like a native exclusive group. Classification is
      // re-read via executionMode() immediately before each start (a registry
      // mutation while queued can flip a call exclusive), matching the native
      // scheduler's lazy reclassification.
      interface PendingDispatch {
        /** Ordered stage: append the start event, await prepare (pre-execute/guards), launch the body into `flight`. */
        start(): Promise<void>
        classify(): 'parallel' | 'exclusive'
        abandon(): void
        /** Ordered stage: post-execute + context deferral + settle event, in submission order. */
        commit(): Promise<void>
        /** The launched around-dispatch/body stage; resolved until start() replaces it. */
        flight: Promise<void>
        /** True once the dispatch stage parked its outcome; the commit cursor waits on it. */
        settled: boolean
        /** The classification this entry started under; an exclusive holds its barrier through commit(). */
        mode?: 'parallel' | 'exclusive'
      }
      // 【中文】待启动队列（提交顺序）；inFlight 在飞的工具体 promise 集合。
      const pendingQueue: PendingDispatch[] = []
      const inFlight = new Set<Promise<void>>()
      /** Tracked settle-event side work (log-content listener + append), drained at run settlement. */
      // 【中文】落定事件的附属工作（日志内容监听 + 追加），运行收尾时统一排空——
      //   它们绝不能延迟程序拿值或占用分派槽位。
      const logWork = new Set<Promise<void>>()
      // 【中文】提交队列：按提交顺序等待 commit 的条目（头指针游标推进）。
      const commitQueue: PendingDispatch[] = []
      // 【中文】独占屏障状态：exclusive 调用从启动到提交完成期间为 true。
      let exclusiveActive = false
      let driving = false
      let driverRun: Promise<void> = Promise.resolve()
      let wake: (() => void) | undefined
      // 【中文】唤醒机制：wake 是当前睡眠等待的 resolve；wakeup 触发它让 drive 醒来重查状态。
      const wakeup = (): void => {
        const release = wake
        wake = undefined
        release?.()
      }
      /**
       * The single ordered lane. Each pass commits the head-of-line settled
       * dispatch (ordered post-execute), then starts the next queued entry if
       * its slot is free (ordered pre-execute), and otherwise sleeps until a
       * body settles or a new submission arrives. One run reaching the
       * empty-queues/empty-pool state is quiescence.
       */
      const drive = (): Promise<void> => {
        // 【中文】driving/driverRun：单例化——并发提交只共享同一条驱动循环。
        if (driving) return driverRun
        driving = true
        driverRun = (async () => {
          try {
            for (;;) {
              // Create the wakeup promise before inspecting state so a settle or submission arriving
              // between the checks and the await below cannot be lost.
              const signal = new Promise<void>((resolve) => { wake = resolve })
              const commitHead = commitQueue[0]
              if (commitHead !== undefined && commitHead.settled) {
                commitQueue.shift()
                await commitHead.commit()
                // The barrier covers post-execute: later starts wait for the
                // exclusive call's full pipeline, as under the native loop.
                if (commitHead.mode === 'exclusive') exclusiveActive = false
                continue
              }
              const head = pendingQueue[0]
              if (head !== undefined) {
                if (runController.signal.aborted) {
                  pendingQueue.shift()
                  head.abandon()
                  continue
                }
                // Reclassify at start time (fail-closed on registry changes).
                const mode = head.classify()
                const capacity = !exclusiveActive
                  && (mode === 'exclusive' ? inFlight.size === 0 : inFlight.size < maxParallel)
                if (capacity) {
                  if (mode === 'exclusive') exclusiveActive = true
                  head.mode = mode
                  pendingQueue.shift()
                  // Joined before start() so the commit cursor sees submission
                  // order; nothing commits it until `settled` flips.
                  commitQueue.push(head)
                  await head.start()
                  const flight: Promise<void> = head.flight.finally(() => {
                    inFlight.delete(flight)
                    wakeup()
                  })
                  inFlight.add(flight)
                  continue
                }
              }
              if (pendingQueue.length === 0 && commitQueue.length === 0 && inFlight.size === 0) return
              await signal
            }
          } finally {
            driving = false
            wake = undefined
          }
        })()
        return driverRun
      }
      /** Every dispatch settled AND committed; nothing can start (the run is aborted at call time). */
      /*
       * 【中文】排空所有子分派：驱动循环会放弃未启动的排队项、等完在飞池、按序跑完
       *   提交车道（含程序返回时已在进行的 commit）；随后排空全部日志附属工作，
       *   保证每个落定事件都写在开放的回合内。
       */
      const drainDispatches = async (): Promise<void> => {
        // The abort already fired: the driver abandons queued-unstarted
        // entries, awaits the live pool, and drains the ordered commit lane —
        // including a commit already in progress when the program returned.
        await drive()
        // Every settle event is appended inside the open run_code turn
        // (tasks self-remove on settlement).
        while (logWork.size > 0) await Promise.allSettled([...logWork])
      }

      // Read through a call, not a bare property: the abort state genuinely
      // changes across awaits, and a direct `.aborted` re-check after one
      // would be narrowed away by control flow analysis.
      const runOver = (): boolean => runController.signal.aborted

      /**
       * 【中文】绑定函数工厂：为工具名 name 生成程序可 await 的函数。每次调用：
       *   运行已结束 → 拒绝；参数两次快照归一化；生成子调用 id 并入队；经调度器的
       *   prepare/dispatch/finalize/finish 分阶段执行；落定时立即把值交给程序
       *   （日志追加是异步附属工作）；错误转成普通 Error 抛出（worker 侧包装为
       *   ToolCallError）。
       * @param name - 要绑定的工具名。
       * @returns 程序调用的异步绑定函数。
       */
      const binding = (name: string): CodeBindingFunction => async (rawArgs: unknown): Promise<JsonValue> => {
        if (runOver()) {
          throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} not dispatched`)
        }
        const normalized = jsonNormalizeArgs(rawArgs)
        const n = ++dispatches
        const subCallId = ToolCallId(`${String(exec.callId)}:code:${n}`)
        const input = {
          callId: subCallId,
          rootCallId: exec.rootCallId,
          name,
          arguments: normalized.dispatched,
          ...exec.agent ? { agent: exec.agent } : {},
          parent: exec.token,
          signal: runController.signal,
        }
        type DispatchOutcome = { isError: true; message: string } | { isError: false; value: JsonValue }
        // 【中文】经注册表的私有调度接口走完整流水线（pre/guards → body → post）。
        const scheduler = registry[TOOL_RUNTIME_SCHEDULER]
        // 【中文】outcome：子调用的最终结果；settle 在落定瞬间 resolve 给程序，
        //   日志追加则作为 logWork 附属任务异步进行。
        const outcome = await new Promise<DispatchOutcome>((resolve, reject) => {
          // 【中文】parked：dispatch 阶段停靠的结果，commit 按提交顺序消费它。
          // Set by the dispatch stage (or start() for a pre-settled result): what commit() finalizes in submission order.
          let parked:
            | { kind: 'post-result' | 'final-result'; exec: ToolRunContext; result: ToolExecutionResult }
            | undefined
          const settle = (result: ToolExecutionResult): void => {
            // The program gets its value NOW: the log-content listener (for
            // example, a spill backend) must never delay the binding or occupy
            // a dispatch slot. The event append is tracked side work; the run's
            // settlement drains logWork so every settle event is still appended
            // inside the open turn (shapeDispatchLog is contained, so this
            // chain cannot reject).
            resolve(result.isError
              ? { isError: true, message: result.error.message }
              : { isError: false, value: result.value })
            const agent = exec.agent
            if (agent === undefined) return
            const task: Promise<void> = (async () => {
              // The listener may replace the durable copy with a preview and
              // locator; the program's value and model-visible result are
              // untouched.
              const logged = await shapeDispatchLog({
                exec, agent, subCallId, name, isError: result.isError,
                // The registry deep-froze this projection at result
                // finalization; append snapshots the final copy again, so
                // the log stays detached.
                content: result.content,
              })
              agent.session.append('tool/code-dispatch', {
                rootCallId: exec.rootCallId,
                parentCallId: exec.callId,
                subCallId,
                name,
                // The SIBLING parse of the dispatched value: byte-identical JSON,
                // but a separate object — a tool mutating its args cannot desync
                // this record from what it actually received.
                arguments: normalized.logged,
                isError: result.isError,
                content: logged,
              })
            })().finally(() => { logWork.delete(task) })
            logWork.add(task)
          }
          pendingQueue.push({
            flight: Promise.resolve(),
            settled: false,
            // Re-read per driver pass against the same agent view the SDK
            // declared; fail-closed exclusive when undeclared/invalid.
            classify: () => registry.executionMode(input).kind,
            abandon: () => {
              reject(new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} tool call abandoned`))
            },
            async start(): Promise<void> {
              exec.agent?.session.append('tool/code-dispatch-start', {
                rootCallId: exec.rootCallId,
                parentCallId: exec.callId,
                subCallId,
                name,
                arguments: normalized.logged,
              })
              // Ordered prepare runs INSIDE the driver lane: the next entry's
              // pre-execute waits for this resolution, as under the native
              // scheduler. Only the launched body below overlaps.
              const prepared = await scheduler.prepare(input)
              if (prepared.kind === 'dispatch') {
                this.flight = scheduler.dispatch(prepared.exec).then((dispatchOutcome) => {
                  parked = { kind: dispatchOutcome.kind, exec: prepared.exec, result: dispatchOutcome.result }
                  this.settled = true
                })
                return
              }
              parked = { kind: prepared.kind, exec: prepared.exec, result: prepared.result }
              this.settled = true
            },
            async commit(): Promise<void> {
              /* v8 ignore next -- commit() runs only after `settled` flipped, which set parked. */
              if (parked === undefined) return
              const result = parked.kind === 'post-result'
                ? await scheduler.finalize(parked.exec, parked.result)
                : scheduler.finish(parked.exec, parked.result)
              if (!result.isError && result.content.some(block => block.type === 'image')) {
                exec.deferContext(createUserMessage({
                  content: result.content,
                  source: { kind: 'plugin', plugin: 'tools-code-mode' },
                }))
              }
              for (const context of result.additionalContexts ?? []) {
                exec.deferContext(context)
              }
              // The composite forwards `additionalContexts` above and
              // `concludesTurn` here from the nested result. Only a successful
              // nested result can carry the terminal marker
              // (ToolExecutionFailure types it never), so a policy-converted
              // failure cannot stop the turn through a recovering program.
              if (result.concludesTurn) exec.concludeTurn()
              settle(result)
              // Backpressure on pending event-append tasks: each task retains
              // a full result while a slow backend stores it, so the pool cap
              // bounds their count. Beyond the cap, the
              // ordered lane waits, so later sub-calls cannot start and
              // pending I/O/memory cannot grow without bound.
              while (logWork.size > maxParallel) await Promise.race(logWork)
            },
          })
          wakeup()
          void drive()
        })
        // A budget expiry or outer cancel that occurs while this call was in
        // flight already aborted the dispatch; stop the program now rather
        // than hand it a result from a run that is over.
        if (runOver()) {
          throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} result discarded`)
        }
        // The worker turns a binding rejection into ToolCallError and adds
        // only the binding name. Native content and internal error metadata
        // stay outside the program-facing failure contract.
        if (outcome.isError) throw new Error(outcome.message)
        return outcome.value
      }

      // Null-prototype + defineProperty, mirroring the worker-side namespace
      // build: a registered tool named `__proto__` must become an ordinary
      // own key (a plain-object assignment would hit the prototype setter,
      // silently dropping the binding), and the runtime host resolves
      // binding names as own properties only.
      // 【中文】绑定命名空间：null 原型 + defineProperty——名为 `__proto__` 的工具
      //   必须成为普通自有键（普通赋值会命中原型 setter 静默丢绑定），且运行时宿主
      //   只按自有属性解析绑定名。
      const functions: Record<string, CodeBindingFunction> = Object.create(null) as Record<string, CodeBindingFunction>
      // Enumerate the CALLING AGENT's visible set (scoped tools join,
      // restricted globals vanish) — the same view the SDK section declared,
      // so a program can bind exactly what its prompt promised; sub-dispatch
      // re-resolves per call through the same view (exec.agent threads down).
      // 【中文】枚举"调用代理的可见集合"（scoped 工具加入、被限制的全局工具消失）——
      //   与 SDK 段声明的视图完全一致；run_code 自身不绑定。
      for (const schema of registry.schemas(exec.agent)) {
        if (schema.name === RUN_CODE_NAME) continue
        Object.defineProperty(functions, schema.name, { enumerable: true, value: binding(schema.name) })
      }

      try {
        let result: CodeRunResult
        try {
          result = await runtime.run({
            program: args.code,
            bindings: [{
              global: 'tools',
              functions,
              errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
            }],
            signal: runController.signal,
          })
        } finally {
          // Abort sub-dispatches and drain every in-flight dispatch before
          // closing the turn (queued-unstarted ones are abandoned unlogged).
          // Binding failures remain observable through their individual promises.
          // 【中文】程序落定（无论成败）先中止并排空全部子分派，再关闭回合——
          //   保证每个落定事件都写在开放的 turn 里；未启动的排队项被静默放弃。
          runController.abort('run_code settled')
          await drainDispatches()
        }

        // 【中文】程序自身失败（异常/预算耗尽/中止/宿主死亡）：附上捕获日志抛出，
        //   注册表会转成结构化 isError 结果供模型自纠。
        if (result.error) {
          const logsText = result.logs.length > 0 ? `\nCaptured output:\n${result.logs.join('\n')}` : ''
          throw new CodeRunFailedError(`code run failed (${result.error.kind}): ${result.error.message}${logsText}`)
        }
        return {
          logs: result.logs,
          ...result.value !== undefined ? { result: result.value } : {},
        }
      } finally {
        exec.signal.removeEventListener('abort', onOuterAbort)
      }
    },
    // The model-authored description is the call's always-visible UI label
    // (the bash `description` precedent); the program itself rides rawInput.
    presentCall: args => ({
      card: 'generic',
      title: args.description,
      kind: 'execute',
      rawInput: args.code,
    }),
    // Deliberately no presentResult: the generic card fallback keeps this
    // title and reads durable result content without duplicating a large raw
    // result into the host view payload.
  })
  // Resolve the language flavor lazily, at the moment the registry projects the
  // schema (`schemaOf` destructures `description`/`parameters`). The definition
  // is minted once at registration, before a runtime is known; deferring here
  // is the least invasive point that still emits the loaded runtime's language.
  // 【中文】语言风味延迟到"注册表投影 schema 的那一刻"才解析（定义在注册时就已
  //   创建、早于运行时挂载），这是仍能输出正确语言的最小侵入点。
  Object.defineProperty(definition, 'description', {
    enumerable: true,
    get: () => resolveFlavor(peekRuntime).description,
  })
  Object.defineProperty(definition, 'parameters', {
    enumerable: true,
    // Recompile through the same spec→schema projection defineTool used, so
    // the emitted schema always matches the validated specification.
    get: () => parameterSchemaSpecToJsonSchema({
      code: { type: 'string', required: true, description: resolveFlavor(peekRuntime).codeDescription },
      description: { type: 'string', required: true, description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION },
    }) as unknown as Record<string, unknown>,
  })
  return definition
}
