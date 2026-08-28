/**
 * Scripted fake ACP agent bin for `dsh-session-snapshot`'s ACP adapter specs. Speaks
 * newline-delimited JSON-RPC on stdio like the real `dsh-acp-agent` bin, but
 * every behavior — how prompts settle, whether session/new rejects, which
 * session logs get persisted, what filesystem noise to leave — comes from a
 * `behavior.json` sitting NEXT to the `$DSH_SNAPSHOT_FILE` fixture, so a spec
 * scripts a whole subprocess run from data. The specs launch it through the
 * REAL `runScenario` spawn path (tsx loader, temp cwd, env plumbing), so the
 * harness plumbing is exercised for real; only the agent behind the protocol
 * is scripted.
 *
 * The specs (not the golden tier) own this bin: it asserts nothing, echoes
 * observable facts into `session/update` text chunks (env probe, permission
 * outcome, seeded-workspace listing) for the spec to read off `rawStdout`, and
 * exits 0 on stdin EOF after writing the scripted logs — mirroring the real
 * bin's dispose-flush-exit shape.
 * @remarks 文件说明：文件职责：验证 test-support/session-snapshot 中 fake acp agent
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'

/** One scripted session log: a transcript path under the sessions root plus its JSONL lines. */
interface ScriptedLog {
  /** Path relative to `$DSH_SNAPSHOT_SESSIONS_ROOT`, e.g. `project/session/session.jsonl`. */
  file: string
  /**
   * The JSONL records. String templates `{{CWD}}` and `{{SID}}` are replaced
   * with the run's real cwd and the ACP session id this bin issued, so a
   * written log carries genuine volatile values for the normalizers to scrub.
   */
  lines: unknown[]
}

/** The whole scripted behavior for one run. Every field defaults to the least surprising choice. */
interface Behavior {
  /** Exit during startup after writing any configured stderr note. */
  failOnBoot?: boolean
  /** Reject every `session/new` (exercises the expect-error step without extra dirs). */
  rejectNewSession?: boolean
  /** Reject `session/new` only when `additionalDirectories` is non-empty (the real bridge's rule). */
  rejectExtraDirs?: boolean
  /** How `session/prompt` settles: a clean response, a JSON-RPC error, or a hang until `session/cancel`. */
  prompt?: 'respond' | 'error' | 'hang-until-cancel'
  /** Persist the scripted logs while handling cancellation, before stdin EOF. */
  persistLogsOnCancel?: boolean
  /** Before responding to a prompt, send a `session/request_permission` request and echo its outcome as a chunk. */
  permissionProbe?: boolean
  /** Echo the `DSH_SNAPSHOT_*` env the harness set as a chunk (spec-side env-plumbing assertions). */
  echoEnv?: boolean
  /** Echo the sorted cwd listing as a chunk (spec-side workspace-seeding assertions). */
  echoWorkspace?: boolean
  /** Write a line to stderr on boot (spec-side stderr-capture assertions). */
  stderrNote?: string
  /** Let a short-lived descendant retain stdio and emit one final ACP update plus stderr line after this parent exits. */
  lateInheritedOutput?: boolean
  /** Session logs to persist on stdin EOF and, when selected, on cancellation. */
  logs?: ScriptedLog[]
  /** Leave a stray FILE directly under the sessions root (harvest must skip it). */
  strayRootFile?: boolean
  /** Leave a stray non-transcript file inside a project directory (harvest must skip it). */
  strayBucketFile?: boolean
  /** Delete the sessions root entirely (harvest must yield no logs). */
  deleteSessionsRoot?: boolean
}

/**
 * 常量说明：sessionsRoot 用于处理 sessionsRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const sessionsRoot = process.env.DSH_SNAPSHOT_SESSIONS_ROOT ?? ''
/**
 * 常量说明：fixtureFile 用于处理 fixtureFile 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const fixtureFile = process.env.DSH_SNAPSHOT_FILE ?? ''
/**
 * 常量说明：behavior 用于处理 behavior 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const behavior: Behavior = fixtureFile === ''
  ? {}
  : JSON.parse(readFileSync(join(dirname(fixtureFile), 'behavior.json'), 'utf8')) as Behavior

if (behavior.stderrNote !== undefined) process.stderr.write(`${behavior.stderrNote}\n`)
if (behavior.failOnBoot === true) process.exit(7)

/**
 * 变量说明：nextOutboundId 用于处理 nextOutboundId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let nextOutboundId = 1000
/**
 * 变量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let sessionId = ''
/**
 * The cwd the client passed to `session/new` — used verbatim for `{{CWD}}`
 * substitution, mirroring the real bin (whose persisted header carries the
 * session cwd as given, NOT `process.cwd()`, which the OS realpaths — on
 * macOS `/var/folders/…` vs `/private/var/folders/…`).
 * @remarks 中文说明：变量说明：sessionCwd 用于处理 sessionCwd 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let sessionCwd = ''
/** The parked prompt request id while `hang-until-cancel` waits for the cancel notification.
 * @remarks 中文说明：变量说明：parkedPromptId 用于处理 parkedPromptId 相关数据，作用于当前作用域；
 * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
let parkedPromptId: number | string | null = null
/** The transient raw JSONL log that proves the parked turn started durably.
 * @remarks 中文说明：变量说明：parkedTurnLog 用于处理 parkedTurnLog 相关数据，作用于当前作用域；
 * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
let parkedTurnLog: string | undefined
/** Resolvers for outbound permission responses, keyed by request id.
 * @remarks 中文说明：常量说明：pendingOutbound 用于处理 pendingOutbound 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const pendingOutbound = new Map<number, (result: unknown) => void>()

/**
 * 功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。
 * @param frame （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 send(frame)，并按返回类型处理结果。
 */
function send(frame: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`)
}

/**
 * 功能说明：处理 respond 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （number | string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param result （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 respond(id, result)，并按返回类型处理结果。
 */
function respond(id: number | string, result: unknown): void {
  send({ id, result })
}

/**
 * 功能说明：处理 respondError 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （number | string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 respondError(id, message)，并按返回类型处理结果。
 */
function respondError(id: number | string, message: string): void {
  send({ id, error: { code: -32603, message } })
}

/**
 * 功能说明：处理 chunk 相关流程；使用场景由所在模块及调用位置决定。
 * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 chunk(text)，并按返回类型处理结果。
 */
function chunk(text: string): void {
  send({
    method: 'session/update',
    params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } },
  })
}

/** Substitute the `{{CWD}}`/`{{SID}}` templates through a scripted log record.
 * @remarks 中文说明：功能说明：处理 instantiate 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：unknown；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 instantiate(value)，
 * 并按返回类型处理结果。 */
function instantiate(value: unknown): unknown {
  if (typeof value === 'string') return value.split('{{CWD}}').join(sessionCwd).split('{{SID}}').join(sessionId)
  if (Array.isArray(value)) return value.map(instantiate)
  if (value !== null && typeof value === 'object') {
    /**
     * 常量说明：out 用于处理 out 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const out: Record<string, unknown> = {}
    /**
     * 变量说明：k、v 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [k, v] of Object.entries(value)) out[k] = instantiate(v)
    return out
  }
  return value
}

/** Persist an open turn so cancellation tests wait on agent state, not presentation output.
 * @remarks 中文说明：功能说明：处理 persistParkedTurnStart 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * persistParkedTurnStart()，并按返回类型处理结果。 */
function persistParkedTurnStart(): void {
  parkedTurnLog = join(sessionsRoot, 'ready', sessionId, 'session.jsonl')
  mkdirSync(dirname(parkedTurnLog), { recursive: true })
  writeFileSync(parkedTurnLog, [
    JSON.stringify({ type: 'session', version: 0, id: sessionId, createdAt: 1, cwd: sessionCwd, delegationDepth: 0 }),
    JSON.stringify({ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }),
    '',
  ].join('\n'))
}

/** Remove the transient open-turn log before publishing any scripted final logs.
 * @remarks 中文说明：功能说明：处理 clearParkedTurnStart 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * clearParkedTurnStart()，并按返回类型处理结果。 */
function clearParkedTurnStart(): void {
  if (parkedTurnLog === undefined) return
  rmSync(parkedTurnLog, { force: true })
  parkedTurnLog = undefined
}

/**
 * 功能说明：处理 Prompt 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （number | string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 handlePrompt(id)，并按返回类型处理结果。
 */
async function handlePrompt(id: number | string): Promise<void> {
  chunk('thinking about it')
  if (behavior.echoEnv === true) {
    chunk(`env:${JSON.stringify({
      mode: process.env.DSH_SNAPSHOT,
      override: process.env.DSH_SNAPSHOT_OVERRIDE ?? null,
      childFiles: process.env.DSH_SNAPSHOT_CHILD_FILES ?? null,
      spillRoot: process.env.DSH_SNAPSHOT_SPILL_ROOT ?? null,
      // Scenario-supplied deployment env (the `Scenario.env` layering hook).
      permissionMode: process.env.DSH_PERMISSION_MODE ?? null,
    })}`)
  }
  if (behavior.echoWorkspace === true) {
    chunk(`workspace:${readdirSync(process.cwd()).sort().join(',')}`)
  }
  if (behavior.permissionProbe === true) {
    /**
     * 常量说明：requestId 用于处理 requestId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const requestId = nextOutboundId++
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    const result = await new Promise<unknown>((resolve) => {
      pendingOutbound.set(requestId, resolve)
      send({
        id: requestId,
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: { toolCallId: 'call_fake_1' },
          options: [
            { optionId: 'opt-allow', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'opt-reject', name: 'Reject once', kind: 'reject_once' },
          ],
        },
      })
    })
    chunk(`permission:${JSON.stringify((result as { outcome?: unknown } | undefined)?.outcome ?? null)}`)
  }
  switch (behavior.prompt ?? 'respond') {
    case 'respond':
      respond(id, { stopReason: 'end_turn' })
      return
    case 'error':
      respondError(id, 'model exploded')
      return
    case 'hang-until-cancel':
      persistParkedTurnStart()
      parkedPromptId = id
      return
  }
}

/**
 * 功能说明：处理 Frame 相关流程；使用场景由所在模块及调用位置决定。
 * @param frame （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 handleFrame(frame)，并按返回类型处理结果。
 */
function handleFrame(frame: Record<string, unknown>): void {
  /**
   * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const id = frame.id as number | string | undefined
  /**
   * 常量说明：method 用于处理 method 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const method = frame.method as string | undefined
  /**
   * 常量说明：params 用于处理 params 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const params = (frame.params ?? {}) as Record<string, unknown>
  // A response to one of OUR outbound requests (the permission probe).
  if (method === undefined && id !== undefined && typeof id === 'number' && pendingOutbound.has(id)) {
    /**
     * 常量说明：resolve 用于解析 resolve 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const resolve = pendingOutbound.get(id) as (result: unknown) => void
    pendingOutbound.delete(id)
    resolve(frame.result)
    return
  }
  switch (method) {
    case 'initialize':
      respond(id as number | string, { protocolVersion: 1, agentCapabilities: { loadSession: false } })
      return
    case 'session/new': {
      /**
       * 常量说明：extra 用于处理 extra 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const extra = params.additionalDirectories as unknown[] | undefined
      if (behavior.rejectNewSession === true || (behavior.rejectExtraDirs === true && extra !== undefined && extra.length > 0)) {
        respondError(id as number | string, 'unsupported workspace scope')
        return
      }
      sessionId = randomUUID()
      sessionCwd = typeof params.cwd === 'string' ? params.cwd : process.cwd()
      respond(id as number | string, { sessionId })
      return
    }
    case 'session/prompt':
      void handlePrompt(id as number | string)
      return
    case 'session/cancel':
      if (parkedPromptId !== null) {
        /**
         * 常量说明：parked 用于处理 parked 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const parked = parkedPromptId
        parkedPromptId = null
        clearParkedTurnStart()
        if (behavior.persistLogsOnCancel === true) writeLogs()
        respond(parked, { stopReason: 'cancelled' })
      }
      return
    default:
      // Unknown method: a notification is ignored; a request gets an error so
      // the SDK never waits forever on a frame this fake doesn't model.
      if (id !== undefined) respondError(id, `unhandled method ${String(method)}`)
  }
}

/**
 * 功能说明：写入 Logs 相关流程；使用场景由所在模块及调用位置决定。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 writeLogs()，并按返回类型处理结果。
 */
function writeLogs(): void {
  /**
   * 变量说明：log 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const log of behavior.logs ?? []) {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = join(sessionsRoot, log.file)
    mkdirSync(dirname(target), { recursive: true })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：l（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(l)，并按返回类型处理结果。
     */
    writeFileSync(target, log.lines.map(l => JSON.stringify(instantiate(l))).join('\n') + '\n')
  }
}

/**
 * 功能说明：处理 flushLogsAndExit 相关流程；使用场景由所在模块及调用位置决定。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 flushLogsAndExit()，并按返回类型处理结果。
 */
function flushLogsAndExit(): void {
  clearParkedTurnStart()
  writeLogs()
  if (behavior.strayRootFile === true) writeFileSync(join(sessionsRoot, 'stray.txt'), 'not a bucket\n')
  if (behavior.strayBucketFile === true) {
    mkdirSync(join(sessionsRoot, 'bucket-noise'), { recursive: true })
    writeFileSync(join(sessionsRoot, 'bucket-noise', 'notes.txt'), 'not a session log\n')
  }
  if (behavior.deleteSessionsRoot === true) rmSync(sessionsRoot, { recursive: true, force: true })
  if (behavior.lateInheritedOutput === true) {
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame = JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'late inherited stdout' },
        },
      },
    })
    /**
     * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const code = [
      `setTimeout(() => process.stdout.write(${JSON.stringify(`${frame}\n`)}), 50)`,
      `setTimeout(() => process.stderr.write(${JSON.stringify('late inherited stderr\n')}), 75)`,
    ].join(';')
    spawn(process.execPath, ['-e', code], {
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    }).unref()
  }
  process.exit(0)
}

/**
 * 常量说明：rl 用于处理 rl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const rl = createInterface({ input: process.stdin })
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
 */
rl.on('line', (line) => {
  if (line.trim().length === 0) return
  handleFrame(JSON.parse(line) as Record<string, unknown>)
})
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
rl.on('close', () => { flushLogsAndExit() })
