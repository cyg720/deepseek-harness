/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现模型侧持久化 `bash` 工具：基于 owner 隔离的 PTY 缝（ctx.terminals），
 * 让每个 agent 拥有一个跨调用保持状态的 bash shell（cwd、导出变量都延续）。
 * 【技术维度】PTY 会话 + 命令包装：用随机 nonce 标记（start/end）包裹每条命令，轮询
 * scrollback 提取命令输出；deadline 融合超时与取消；同 agent 的命令经队列串行化；
 * shell 退出/超时/中止时重置会话并告知模型下次从新会话开始。
 * 【产品维度】需要 shell 状态的任务（如逐步构建、交互式配置）不再每次从零开始；
 * 输出按字符预算截断并提示模型用 grep 定位，避免撑爆上下文。
 * 【逻辑维度】persistentShells 维护 owner→会话注册表与生命周期 → executeCommand 循环
 * （发送命令 → 读取增量 → 检查完成标记/退出/超时/stdin_read）→ 结果渲染与重置。
 * 【关键边界】命令必须包装成单物理行（避免 PS2 提示泄漏）；wrapper 输出经 PSReadLine
 * 回显剥离；会话按 agent 隔离并由 ctx.terminals 管理进程树；TODO 标记提示超时消息
 * 同时提到 OOM 但该信号并不能证明 OOM。
 * 【新手阅读建议】先看 persistentShells 的注册表（pending/live/creating 三张表），再看
 * executeCommand 的主循环，最后看 commandOutput/partialOutput 如何从 scrollback 提取文本。
 * ==========================================================================
 */

/**
 * Model-facing persistent `bash` tool over the owner-scoped PTY seam.
 * @module @deepseek-ai/dsh-tool-bash-persistent
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TerminalReadResult, TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { defineTool } from '@deepseek-ai/dsh-tools'

// TODO: Replace the file-search advice; arbitrary command output need not come from a searchable file.
// 输出被截断时给模型的提示：建议用 grep 在文件里定位，而不是直接重试整个命令（遗留建议）。
const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>'
// 输出开头被 scrollback 上限丢弃时的提示（以下文本是保留到的最早输出）。
const LOST_PREFIX_MESSAGE = '<response clipped><NOTE>The beginning of this command output was dropped by the terminal scrollback limit. The following text is the earliest retained output.</NOTE>\n'
// shell 被重置时给模型的提示：下次 bash 调用从工作区以全新目录与环境开始。
const SHELL_RESET_MESSAGE = 'The persistent bash shell was reset; the next bash call starts from the workspace with a fresh current directory and environment.'
// deadline 的原因码：用来区分"本工具的超时"与上游取消。
const TIMEOUT_CODE = 'PERSISTENT_BASH_TIMEOUT'
// One page is enough to find a just-emitted completion marker; the full
// scrollback is assembled only when a command settles or needs partial output.
// 一页就足够找到刚发出的完成标记；完整 scrollback 只在命令落定或需要部分输出时组装。
const SCROLLBACK_PAGE_LINES = 1_000
// 轮询间隔：命令未落定时每隔这么久重读一次终端。
const POLL_INTERVAL_MS = 25

// 工具的默认模型可见描述：强调状态（cwd 与导出变量）在同一 agent 的多次调用间保持。
const DEFAULT_DESCRIPTION = 'Run commands in a persistent bash shell. State, including the current directory and exported environment variables, persists across calls for this agent.'

/** 解析后的配置：后端类型、单命令截止时间、输出字符上限与工具描述。 */
interface ResolvedConfig {
  backendType: string
  timeoutMs: number
  maxOutputChars: number
  description: string
}

/** 包裹命令用的随机开始/结束标记（nonce），用于从输出流中定位命令边界。 */
interface CommandMarkers {
  start: string
  end: string
}

/** 从终端保留下的输出快照：文本 + 是否被截断。 */
interface RetainedOutput {
  text: string
  truncated: boolean
}

/** 从快照中捕获到的命令输出：文本 + 是否不完整 + 可选退出码。 */
interface CapturedOutput {
  text: string
  incomplete: boolean
  exitCode?: number
}

/** owner 级持久 shell 注册表：按 agent 获取/重置会话。 */
interface PersistentShells {
  get(owner: Agent, signal: AbortSignal): Promise<TerminalSessionId>
  reset(owner: Agent, reason: string): Promise<void>
}

/** 按字符预算截断内容；incomplete 为真时即使未超预算也追加截断提示。 */
function maybeTruncate(content: string, maxOutputChars: number, incomplete = false): string {
  if (content.length <= maxOutputChars && !incomplete) return content
  return content.length <= maxOutputChars
    ? content + TRUNCATED_MESSAGE
    : content.slice(0, maxOutputChars) + TRUNCATED_MESSAGE
}

/** 生成一对随机 nonce 标记，每条命令独一无二，避免旧输出被误认作本次命令的边界。 */
function markers(): CommandMarkers {
  const nonce = randomUUID()
  return {
    start: `__DSH_PERSISTENT_BASH_START_${nonce}__`,
    end: `__DSH_PERSISTENT_BASH_END_${nonce}:`,
  }
}

/** 用 bash 的 $'...' 语法转义字符串（反斜杠、单引号、回车、换行都按字面处理）。 */
function quoteForBash(value: string): string {
  return `$'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')}'`
}

/**
 * 把命令包装为单物理行：先打印 start 标记，eval 命令，保存退出码，再打印 end 标记
 * 加退出码。必须保持单行——交互式 bash 对内嵌换行会先打印 PS2 续行提示，把终端提示
 * 与标记源码泄漏进模型可见结果。
 */
function wrapCommand(command: string, marker: CommandMarkers): string {
  // Keep the wrapper on one physical line. An interactive bash prints PS2 for
  // embedded newlines before executing the buffer, which would leak terminal
  // prompts and marker source text into the model-facing result.
  // 保持包装在单物理行：交互式 bash 对内嵌换行会先打印 PS2，把终端提示与标记源码
  // 泄漏进模型可见结果。
  return `printf '%s\\n' ${quoteForBash(marker.start)}; eval -- ${quoteForBash(command)}; __dsh_persistent_bash_status=$?; printf '%s%s\\n' ${quoteForBash(marker.end)} "$__dsh_persistent_bash_status"`
}

/** 去掉结尾的一个换行（\n 或 \r\n）。 */
function trimTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, '')
}

/**
 * 从完整快照中提取一条命令的完整输出：定位 end 标记与紧随其后的退出码，再往前找
 * start 标记作为起点；start 已滚出滚动区时标记 incomplete 并从开头截取。
 */
function commandOutput(
  snapshot: RetainedOutput,
  marker: CommandMarkers,
): CapturedOutput | undefined {
  const text = snapshot.text
  const end = text.lastIndexOf(marker.end)
  const status = /^(\d+)\r?\n/.exec(text.slice(end + marker.end.length))?.[1]
  if (status === undefined) return undefined
  const startMarker = text.lastIndexOf(marker.start, end)
  const start = startMarker < 0 ? 0 : startMarker + marker.start.length
  return {
    text: trimTrailingNewline(text.slice(start, end).replace(/^\r?\n/, '')),
    incomplete: startMarker < 0,
    exitCode: Number(status),
  }
}

/**
 * 提取部分输出：优先用快照中 start 标记之后的内容；快照里已无 start（被挤出滚动区）
 * 时回退到 fallback（增量累加或 viewport），并据 fallback 截断状态标记 incomplete。
 */
function partialOutput(
  snapshot: RetainedOutput,
  marker: CommandMarkers,
  fallback: string,
  fallbackTruncated = false,
): CapturedOutput {
  const startMarker = snapshot.text.lastIndexOf(marker.start)
  if (startMarker >= 0) {
    return {
      text: trimTrailingNewline(snapshot.text.slice(startMarker + marker.start.length).replace(/^\r?\n/, '')),
      incomplete: false,
    }
  }
  const fallbackStart = fallback.lastIndexOf(marker.start)
  const afterStart = fallbackStart < 0
    ? fallback
    : fallback.slice(fallbackStart + marker.start.length).replace(/^\r?\n/, '')
  const fallbackEnd = afterStart.lastIndexOf(marker.end)
  const beforeEnd = fallbackEnd < 0 ? afterStart : afterStart.slice(0, fallbackEnd)
  return {
    text: trimTrailingNewline(beforeEnd),
    incomplete: fallbackTruncated || fallbackStart < 0,
  }
}

/** 轮询休眠：等待一个 POLL_INTERVAL_MS。 */
async function pause(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
}

/** 计算下一页读取偏移；当前页没有更多内容或行号未前进时返回 undefined。 */
function nextScrollbackOffset(page: TerminalReadResult, offset: number): number | undefined {
  if (page.text.length === 0 || page.lineEnd <= offset) return undefined
  return page.lineEnd
}

/**
 * 从滚动区按页向后组装完整输出（最早的页在最前），并汇总任一页的截断标志；
 * 只读最新一页通常足够判断命令是否完成，完整组装仅用于落定与部分输出场景。
 */
function retainedScrollback(
  ctx: Context,
  owner: Agent,
  id: TerminalSessionId,
  latest = ctx.terminals.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES }),
): RetainedOutput {
  const pages: string[] = latest.text.length === 0 ? [] : [latest.text]
  let offset = latest.lineEnd
  let truncated = latest.truncated
  while (true) {
    if (offset >= latest.totalLines) break
    const page = ctx.terminals.read(owner, id, { offset, count: SCROLLBACK_PAGE_LINES })
    truncated ||= page.truncated
    if (page.text.length > 0) pages.unshift(page.text)
    const next = nextScrollbackOffset(page, offset)
    if (next === undefined || next >= page.totalLines) break
    offset = next
  }
  return { text: pages.join('\n'), truncated }
}

/** 渲染捕获输出：截断处理 + 丢失开头提示 + 非零退出码标记。 */
function renderCaptured(output: CapturedOutput, maxOutputChars: number): string {
  const rendered = maybeTruncate(output.text, maxOutputChars, output.incomplete)
  const withPrefix = output.incomplete && output.text.length > 0
    ? LOST_PREFIX_MESSAGE + rendered
    : rendered
  const marker = output.exitCode !== undefined && output.exitCode !== 0
    ? `[exit code: ${output.exitCode}]`
    : undefined
  return appendStatusMarker(withPrefix, marker)
}

/** 在内容末尾追加状态标记（marker 为 undefined 时原样返回；空内容时只返回标记）。 */
function appendStatusMarker(content: string, marker: string | undefined): string {
  if (marker === undefined) return content
  return content.length === 0 ? marker : `${content}\n${marker}`
}

/** 渲染 shell 会话退出状态：被信号杀死 / 带退出码退出 / 仅退出。 */
function renderShellExitStatus(
  content: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): string {
  const marker = signal !== null
    ? `[shell killed by signal: ${signal}]`
    : exitCode !== null
      ? `[shell exited: code ${exitCode}]`
      : '[shell exited]'
  return appendStatusMarker(content, marker)
}

/**
 * Render the exited-session result, reset the owner's shell, and reset the
 * message that tells the model the next call starts fresh.
 * @param shells - the owner-scoped registry to reset.
 * @param status - the exited session status (exit code and signal).
 * @returns the complete model-facing result.
 */
/*
 * 渲染"会话已退出"的结果：取回快照 → 重置该 owner 的 shell → 拼装部分输出、
 * 会话退出标记与重置提示。
 * @param shells 待重置的 owner 级注册表
 * @param status 已退出会话的状态（退出码与信号）
 * @returns 完整的模型可见结果
 */
async function respondToSessionExit(
  ctx: Context,
  shells: PersistentShells,
  owner: Agent,
  id: TerminalSessionId,
  status: { exitCode: number | null; signal: NodeJS.Signals | null },
  marker: CommandMarkers,
  fallback: string,
  fallbackTruncated: boolean,
  config: ResolvedConfig,
): Promise<string> {
  const snapshot = retainedScrollback(ctx, owner, id)
  await shells.reset(owner, 'persistent bash shell exited')
  return [
    renderShellExitStatus(
      renderCaptured(partialOutput(snapshot, marker, fallback, fallbackTruncated), config.maxOutputChars),
      status.exitCode,
      status.signal,
    ),
    SHELL_RESET_MESSAGE,
  ].filter(part => part.length > 0).join('\n')
}

/**
 * 构建 owner 级持久 shell 注册表：pending 缓存"正在创建"的会话 promise，live 保存存活
 * 会话，creating 跟踪所有创建中的 promise（拆解时等待）；组合体拆解与 owner 销毁时
 * 都会清理缓存与会话。
 */
function persistentShells(ctx: Context, config: ResolvedConfig): PersistentShells {
  const pending = new WeakMap<Agent, Promise<TerminalSessionId>>()
  const live = new Map<Agent, TerminalSessionId>()
  const creating = new Set<Promise<TerminalSessionId>>()
  const ownerCleanupInstalled = new WeakSet<Agent>()
  const lifecycle = new AbortController()

  // 会话仍存在时才 kill（避免误杀已被其它路径关闭的会话）。
  const close = async (owner: Agent, id: TerminalSessionId, reason: string): Promise<void> => {
    if (!ctx.terminals.list(owner).some(snapshot => snapshot.sessionId === id)) return
    await ctx.terminals.kill(owner, id, reason)
  }

  // 组合体拆解：中止创建、等创建结束、关闭所有存活会话。
  ctx.effect(() => async () => {
    lifecycle.abort(new Error('tool-bash-persistent disposed during shell creation'))
    await Promise.allSettled([...creating])
    const closing = [...live].map(async ([owner, id]) => { await close(owner, id, 'tool-bash-persistent disposed') })
    await Promise.all(closing)
    live.clear()
  }, 'tool-bash-persistent shell cleanup')

  // 重置：清除缓存并关闭该 owner 的会话（reason 会传给终端记录）。
  const reset = async (owner: Agent, reason: string): Promise<void> => {
    pending.delete(owner)
    const id = live.get(owner)
    live.delete(owner)
    if (id !== undefined) await close(owner, id, reason)
  }

  // 获取会话：已有创建中的 promise 则复用（同 owner 并发请求合并为一次创建）。
  const get = (owner: Agent, signal: AbortSignal): Promise<TerminalSessionId> => {
    const existing = pending.get(owner)
    if (existing !== undefined) return existing
    // 调用方信号与组合体生命周期信号合并：任一中止都会取消创建。
    const combinedSignal = AbortSignal.any([signal, lifecycle.signal])
    const creation = (async () => {
      try {
        const cwd = owner.session.header.cwd
        const spawned = await ctx.terminals.spawn(owner, {
          type: config.backendType,
          ...cwd === undefined ? {} : { cwd },
        }, combinedSignal)
        live.set(owner, spawned.sessionId)
        // 首次为某 owner 创建时，挂接 owner 上下文销毁时的缓存清理。
        if (!ownerCleanupInstalled.has(owner)) {
          ownerCleanupInstalled.add(owner)
          owner.ctx.effect(() => () => {
            pending.delete(owner)
            live.delete(owner)
          }, 'tool-bash-persistent owner cache cleanup')
        }
        // Echo suppression only: the prompt stays the backend's own, so the
        // backend's prompt-based readiness detection keeps working.
        // 只关闭命令回显：提示符仍是后端自己的，因此后端的"按提示符判断就绪"仍有效。
        const setup = ctx.terminals.startSend(owner, spawned.sessionId, {
          text: 'stty -echo',
          submit: true,
          signal: combinedSignal,
        })
        const result = await setup.done
        if (result.sessionStatus.kind === 'exited' || result.waitReason === 'timeout') {
          throw new Error('persistent bash shell did not accept initialization')
        }
        return spawned.sessionId
      } catch (error: unknown) {
        // 初始化失败时清理本次创建的会话，避免孤儿会话。
        await reset(owner, 'persistent bash initialization failed')
        throw error
      }
    })()
    const tracked = creation.finally(() => {
      creating.delete(tracked)
    })
    creating.add(tracked)
    pending.set(owner, tracked)
    return tracked
  }

  return { get, reset }
}

/**
 * 执行一条命令的主循环：创建/复用会话 → 包装命令并发送 → 轮询读取增量与最新页 →
 * 依次检查：会话已退出、超时、上游中止、完成标记出现、会话状态退出、shell 再次读取
 * stdin（如 exec/中断/交互子进程）——任一命中即返回渲染结果。
 */
async function executeCommand(
  ctx: Context,
  shells: PersistentShells,
  owner: Agent,
  command: string,
  config: ResolvedConfig,
  upstream: AbortSignal,
): Promise<string> {
  // 融合"命令超时 + 上游取消"的截止时间。
  using commandDeadline = deadline(upstream, config.timeoutMs, TIMEOUT_CODE)
  const id = await shells.get(owner, commandDeadline.signal)
  const marker = markers()
  const wrapped = wrapCommand(command, marker)
  let first = true
  // fallback：发送产生的增量累加或 viewport，用于 start 标记滚出滚动区后的部分输出。
  let fallback = ''
  let fallbackTruncated = false

  while (true) {
    // The shell may flip to exited between iterations (a fast `exit` can
    // settle the previous send while its exit event is still in flight);
    // re-observing status before the next send closes that gap.
    // 两次迭代之间 shell 可能翻转为 exited（快速 exit 会在退出事件仍在途时落定上次发送）；
    // 在下次发送前重读状态可以弥合这个窗口。
    const status = ctx.terminals.list(owner).find(session => session.sessionId === id)?.status
    if (status?.kind === 'exited') {
      return await respondToSessionExit(
        ctx, shells, owner, id, status, marker, fallback, fallbackTruncated, config,
      )
    }
    let operation
    let result
    try {
      // 首次发送带包装命令并按回车；之后只发空提交（让 shell 继续处理或超时）。
      operation = ctx.terminals.startSend(owner, id, {
        text: first ? wrapped : '',
        submit: first,
        signal: commandDeadline.signal,
      })
      first = false
      result = await operation.done
    } catch (error: unknown) {
      // 发送失败（如会话不可用）时重置，避免留下损坏的会话。
      await shells.reset(owner, 'persistent bash send failed')
      throw error
    }
    // 收集本次发送的增量输出，累积为 fallback（供部分输出提取）。
    const incremental = operation.readOutput()
    fallback = incremental.delta.length > 0 ? fallback + incremental.delta : result.viewport
    fallbackTruncated ||= incremental.truncated || result.truncated
    const latest = ctx.terminals.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES })
    const timedOut = timeoutOf(commandDeadline.signal, TIMEOUT_CODE)
    if (timedOut !== undefined) {
      // 超时：返回部分输出并重置 shell（后续调用从新会话开始）。
      const snapshot = retainedScrollback(ctx, owner, id, latest)
      const partial = renderCaptured(
        partialOutput(snapshot, marker, fallback, fallbackTruncated),
        config.maxOutputChars,
      )
      await shells.reset(owner, 'persistent bash command timed out')
      return [
        // TODO: Report a timeout only; this signal does not establish an OOM.
        // TODO: 只报告超时；该信号并不能证明发生了 OOM。
        `Your command timed out after ${Math.round(timedOut.timeoutMs / 1000)} seconds or experienced an OOM error. Below is partial output:`,
        partial,
        SHELL_RESET_MESSAGE,
      ].join('\n')
    }
    if (commandDeadline.signal.aborted) {
      // 上游中止：重置后以标准中止错误向上抛。
      await shells.reset(owner, 'persistent bash command aborted')
      commandDeadline.signal.throwIfAborted()
    }
    if (latest.text.includes(marker.end)) {
      // 完成标记出现：尝试提取完整输出（退出码紧随 end 标记）。
      const complete = commandOutput(retainedScrollback(ctx, owner, id, latest), marker)
      if (complete !== undefined) return renderCaptured(complete, config.maxOutputChars)
    }
    if (result.sessionStatus.kind === 'exited') {
      return await respondToSessionExit(
        ctx, shells, owner, id, result.sessionStatus, marker, fallback, fallbackTruncated, config,
      )
    }
    // The shell reads stdin again (its prompt, or a foreground child's own
    // read) without having printed the end marker — e.g. `exec`, an interrupt,
    // or an interactive child. Return what was captured instead of spinning
    // until the command deadline.
    // shell 再次读取 stdin（自己的提示符，或前台子进程自己读）却没打印 end 标记——
    // 例如 exec、中断或交互式子进程。此时返回已捕获内容，而不是空转到命令截止。
    if (result.waitReason === 'stdin_read') {
      const snapshot = retainedScrollback(ctx, owner, id, latest)
      return renderCaptured(
        partialOutput(snapshot, marker, fallback, fallbackTruncated),
        config.maxOutputChars,
      )
    }
    await pause()
  }
}

/**
 * Register the model-facing persistent `bash` tool.
 * @param ctx - plugin context carrying tools and the owner-scoped PTY service.
 * @param config - selected PTY backend and command deadline.
 */
/*
 * 注册模型可见的持久化 `bash` 工具：维护 owner 级串行队列（同一 agent 的命令排队执行，
 * 避免并发写同一 PTY），工具参数只有 command 一个。
 * @param ctx 携带 tools 与 owner 级 PTY 服务的插件上下文
 * @param config 所选 PTY 后端与命令截止时间
 */
function registerPersistentBash(ctx: Context, config: ResolvedConfig): void {
  const shells = persistentShells(ctx, config)
  // 每个 owner 一条串行队列：前一个操作完成后才运行下一个。
  const queues = new WeakMap<Agent, Promise<void>>()

  const serialized = async <T>(owner: Agent, operation: () => Promise<T>): Promise<T> => {
    const prior = queues.get(owner) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    queues.set(owner, tail)
    try {
      return await run
    } finally {
      if (queues.get(owner) === tail) queues.delete(owner)
    }
  }

  ctx.tools.register(defineTool({
    name: 'bash',
    description: config.description,
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'The bash command to run. Relative path is preferred in the command.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (args.command.trim().length === 0) throw new Error('command must be a non-empty string')
      const owner = exec.agent
      if (owner === undefined) throw new Error('bash requires an owning agent session')
      return serialized(owner, async () => {
        exec.signal.throwIfAborted()
        return executeCommand(ctx, shells, owner, args.command, config, exec.signal)
      })
    },
    presentCall: args => ({ card: 'terminal', title: args.command }),
  }))
}

export const name = 'tool-bash-persistent'
export const inject = ['tools', 'terminals']

/** Configuration for the persistent Bash tool. */
/* 持久化 bash 工具的配置。 */
export interface Config {
  /** PTY backend used for each owner-isolated persistent shell (default `shell`). */
  /* 每个 owner 隔离的持久 shell 使用的 PTY 后端（默认 shell）。 */
  backendType?: string
  /** Wall-clock limit for one command (default 300000). */
  /* 单命令的墙上时钟上限（默认 300000 毫秒）。 */
  timeoutMs?: number
  /** Maximum returned command-output characters before clipping (default 16000). */
  /* 返回命令输出的字符上限，超出裁剪（默认 16000）。 */
  maxOutputChars?: number
  /** Model-facing tool description; deployments may describe their environment. */
  /* 模型可见的工具描述；部署方可描述其环境。 */
  description?: string
}

/** Runtime configuration schema for the persistent Bash tool. */
/* 持久化 bash 工具的运行时配置 schema。 */
export const Config: z<Config> = z.object({
  backendType: z.string().default('shell'),
  timeoutMs: z.number().default(300_000),
  maxOutputChars: z.number().default(16_000),
  description: z.string().default(DEFAULT_DESCRIPTION),
})

/** Register one owner-scoped persistent `bash` tool. */
/* 注册一个 owner 级持久化 `bash` 工具：校验配置并装配默认值后交给 registerPersistentBash。 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    backendType: config.backendType ?? 'shell',
    timeoutMs: config.timeoutMs ?? 300_000,
    maxOutputChars: config.maxOutputChars ?? 16_000,
    description: config.description ?? DEFAULT_DESCRIPTION,
  }
  if (resolved.backendType.trim().length === 0) {
    throw new Error('tool-bash-persistent: backendType must be non-empty')
  }
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
    throw new Error('tool-bash-persistent: timeoutMs must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxOutputChars) || resolved.maxOutputChars <= 0) {
    throw new Error('tool-bash-persistent: maxOutputChars must be a positive safe integer')
  }
  if (resolved.description.trim().length === 0) {
    throw new Error('tool-bash-persistent: description must be non-empty')
  }
  registerPersistentBash(ctx, resolved)
}
