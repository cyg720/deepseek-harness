/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现模型侧持久化 `pwsh` 工具：基于 owner 隔离的 PTY 缝，让每个 agent 拥有
 * 一个跨调用保持状态的 PowerShell shell；是 tool-bash-persistent 的 PowerShell 对应物，
 * 共享会话注册表、轮询循环与重置契约（整文件刻意镜像，包在 jscpd:ignore 内）。
 * 【技术维度】PTY 会话 + 命令包装：nonce 标记包裹命令；与 bash 版的关键差异是自制
 * prompt 函数（PWSH_PROMPT_SETUP，输出 OSC 133 序列 + 退出码 + 固定提示符），使
 * "提示符再次出现"成为命令完成的判据（promptCompleted）；quoteForPwsh 用反引号转义
 * 以适配 PSReadLine 回显。
 * 【产品维度】Windows 上需要 shell 状态的任务（逐步构建、交互式配置）不再每次从零开始；
 * 输出按字符预算截断并提示模型用 Select-String 定位。
 * 【逻辑维度】persistentShells 维护 owner→会话注册表 → executeCommand 循环（发送 → 增量
 * → 检查完成标记/退出/超时/提示符回归）→ 结果渲染与重置。
 * 【关键边界】wrapper 必须保持单物理行（PSReadLine 会回显输入）；回显中的包装源码
 * （含两个 nonce）会在提取时被剥离；会话按 agent 隔离；TODO 标记提示超时消息提到 OOM
 * 但该信号并不能证明 OOM。
 * 【新手阅读建议】对照 tool-bash-persistent/index.ts 阅读找差异：prompt 机制、
 * 反引号转义、wrapper 回显剥离，其余逻辑几乎一致。
 * ==========================================================================
 */

/* jscpd:ignore-start -- deliberate mirror of tool-bash-persistent (persistent-pty note 2026-08-11-pwsh-persistent-pty):
   the PowerShell counterpart shares the session registry, polling loop, and reset contract by design. */
/**
 * Model-facing persistent `pwsh` tool over the owner-scoped PTY seam.
 * @module @deepseek-ai/dsh-tool-pwsh-persistent
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TerminalReadResult, TerminalSendResult, TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { defineTool } from '@deepseek-ai/dsh-tools'

// TODO: Replace the file-search advice; arbitrary command output need not come from a searchable file.
// 输出被截断时给模型的提示：建议用 Select-String 定位（遗留建议）。
const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with Select-String in order to find the line numbers of what you are looking for.</NOTE>'
// 输出开头被 scrollback 上限丢弃时的提示（以下文本是保留到的最早输出）。
const LOST_PREFIX_MESSAGE = '<response clipped><NOTE>The beginning of this command output was dropped by the terminal scrollback limit. The following text is the earliest retained output.</NOTE>\n'
// shell 被重置时给模型的提示：下次 pwsh 调用从工作区以全新目录与环境开始。
const SHELL_RESET_MESSAGE = 'The persistent pwsh shell was reset; the next pwsh call starts from the workspace with a fresh current directory and environment.'
// 自制提示符文本：promptCompleted 靠它判断命令是否已完成。
const SHELL_PROMPT = '__DSH_PERSISTENT_PWSH_PROMPT__ '
// deadline 的原因码：用来区分"本工具的超时"与上游取消。
const TIMEOUT_CODE = 'PERSISTENT_PWSH_TIMEOUT'
// One page is enough to find a just-emitted completion marker; the full
// scrollback is assembled only when a command settles or needs partial output.
// 一页就足够找到刚发出的完成标记；完整 scrollback 只在命令落定或需要部分输出时组装。
const SCROLLBACK_PAGE_LINES = 1_000
// 轮询间隔：命令未落定时每隔这么久重读一次终端。
const POLL_INTERVAL_MS = 25

// 工具的默认模型可见描述：强调状态（cwd 与导出变量）在同一 agent 的多次调用间保持。
const DEFAULT_DESCRIPTION = 'Run commands in a persistent PowerShell shell. State, including the current directory and exported environment variables, persists across calls for this agent.'

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
    start: `__DSH_PERSISTENT_PWSH_START_${nonce}__`,
    end: `__DSH_PERSISTENT_PWSH_END_${nonce}:`,
  }
}

/**
 * Escape a command body for embedding in the wrapper's double-quoted string.
 * Backtick escapes keep every character literal: backtick first so the
 * escapes this function inserts are never re-escaped, `$` so no expansion
 * happens at wrapper construction, and `\r\n`/ESC so multi-line commands and
 * raw control bytes ride one physical input line without PSReadLine mangling.
 * @param value - the model's PowerShell command text.
 * @returns the escaped double-quoted-string body.
 */
/**
 * 为嵌入包装器的双引号字符串转义命令体。反引号转义让每个字符保持字面：先转义反引号
 * 使本函数插入的转义不会再被二次转义；转义 $ 使包装构造时不做展开；\r\n 与 ESC 让
 * 多行命令和原始控制字节骑在单物理输入行上而不被 PSReadLine 弄乱。
 * @param value 模型的 PowerShell 命令文本
 * @returns 转义后的双引号字符串体
 */
function quoteForPwsh(value: string): string {
  return value
    .replaceAll('`', '``')
    .replaceAll('"', '`"')
    .replaceAll('$', '`$')
    .replaceAll('\r', '')
    .replaceAll('\n', '`n')
    .replaceAll('\x1b', '`e')
}

/**
 * 把命令包装为单物理行：打印 start 标记、清空 $LASTEXITCODE、用 Invoke-Expression 执行、
 * 按 $?/$LASTEXITCODE 计算退出码，再打印 end 标记加退出码。必须保持单行——PSReadLine
 * 会回显输入，折行会把回显拆开，导致提取时无法剥离。
 */
function wrapCommand(command: string, marker: CommandMarkers): string {
  // Keep the wrapper on one physical line: PSReadLine renders the echoed
  // input, and a wrapped line would split the echo the extraction strips.
  // The echoed END nonce can never fabricate completion because the status
  // regex needs digits immediately after it and the echo continues with
  // quote characters.
  // 保持包装在单物理行：PSReadLine 会渲染回显输入，折行会拆开提取要剥离的回显；
  // 回显中的 END nonce 不会伪造完成，因为状态正则要求其后紧跟数字而回显继续是引号字符。
  const body = quoteForPwsh(command)
  return `Write-Output '${marker.start}'; $LASTEXITCODE = $null; $__s = 1; try { Invoke-Expression "${body}"; $__ok = $? } catch { $__ok = $false }; if ($null -ne $LASTEXITCODE) { $__s = [int]$LASTEXITCODE } else { $__s = if ($__ok) { 0 } else { 1 } }; Write-Output ('${marker.end}' + $__s)`
}

/** 剥离文本末尾的提示符（可重复剥离多层；保留一个换行结尾）。 */
function stripPrompt(text: string): string {
  let result = text.replace(/\r?\n$/, '')
  while (result.endsWith(SHELL_PROMPT)) {
    result = result.slice(0, -SHELL_PROMPT.length)
  }
  return result.endsWith('\n') ? result.slice(0, -1) : result
}

/**
 * 从完整快照中提取一条命令的完整输出：定位 end 标记与紧随其后的退出码，再往前找
 * start 标记作为起点。PSReadLine 回显携带包装源码（含两个 nonce）出现在真实标记之前；
 * 以真实标记为锚可排除回显，再剥离 wrapper 字符串覆盖"真实 START 已滚出、提取回退到
 * 回显副本"的罕见情况。
 */
function commandOutput(
  snapshot: RetainedOutput,
  marker: CommandMarkers,
  wrapper: string,
): CapturedOutput | undefined {
  const text = snapshot.text
  const end = text.lastIndexOf(marker.end)
  const status = /^(\d+)\r?\n/.exec(text.slice(end + marker.end.length))?.[1]
  if (status === undefined) return undefined
  const startMarker = text.lastIndexOf(marker.start, end)
  const start = startMarker < 0 ? 0 : startMarker + marker.start.length
  let captured = text.slice(start, end)
  // The PSReadLine echo carries the wrapper source (including both marker
  // nonces) before the real markers; anchor on the real markers excludes it,
  // and stripping the wrapper covers the rare case where the real START
  // scrolled out and extraction fell back to the echoed copy.
  // PSReadLine 回显携带包装源码（含两个 nonce）在真实标记之前；以真实标记为锚可排除，
  // 剥离 wrapper 覆盖真实 START 滚出、提取回退到回显副本的罕见情况。
  captured = captured.replaceAll(wrapper, '')
  return {
    text: captured.replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
    incomplete: startMarker < 0,
    exitCode: Number(status),
  }
}

/** 判断一次发送的 viewport 是否以自制提示符结尾（命令已完成回到提示符）。 */
function promptCompleted(result: TerminalSendResult): boolean {
  return result.viewport.endsWith(SHELL_PROMPT)
    || result.viewport.endsWith(`${SHELL_PROMPT}\r\n`)
    || result.viewport.endsWith(`${SHELL_PROMPT}\n`)
}

/**
 * 提取部分输出：优先用快照中 start 标记之后的内容；快照里已无 start 时回退到 fallback，
 * 并剥离其中的提示符与 wrapper 回显，据 fallback 截断状态标记 incomplete。
 */
function partialOutput(
  snapshot: RetainedOutput,
  marker: CommandMarkers,
  wrapper: string,
  fallback: string,
  fallbackTruncated = false,
): CapturedOutput {
  const startMarker = snapshot.text.lastIndexOf(marker.start)
  if (startMarker >= 0) {
    return {
      text: stripPrompt(snapshot.text.slice(startMarker + marker.start.length).replace(/^\r?\n/, '')),
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
    text: stripPrompt(beforeEnd.replaceAll(SHELL_PROMPT, '').replaceAll(wrapper, '')),
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
 * 从滚动区按页向后组装完整输出（最早的页在最前），并汇总任一页的截断标志。
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
/**
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
  wrapped: string,
  fallback: string,
  fallbackTruncated: boolean,
  config: ResolvedConfig,
): Promise<string> {
  const snapshot = retainedScrollback(ctx, owner, id)
  await shells.reset(owner, 'persistent pwsh shell exited')
  return [
    renderShellExitStatus(
      renderCaptured(partialOutput(snapshot, marker, wrapped, fallback, fallbackTruncated), config.maxOutputChars),
      status.exitCode,
      status.signal,
    ),
    SHELL_RESET_MESSAGE,
  ].filter(part => part.length > 0).join('\n')
}

/**
 * The pwsh prompt function that overrides the backend bootstrap value with
 * this tool's own prompt. `[char]27`/`[char]7` build the OSC bytes at runtime
 * because raw ESC characters in submitted input are unreliable under
 * PSReadLine.
 */
/**
 * 覆盖后端引导提示符的自制 pwsh prompt 函数：`[char]27`/`[char]7` 在运行时拼出 OSC 字节
 * （直接提交原始 ESC 字符在 PSReadLine 下不可靠），输出 OSC 133 序列（含 $LASTEXITCODE）
 * 与固定提示符 SHELL_PROMPT，供 promptCompleted 判断命令完成。
 */
const PWSH_PROMPT_SETUP =
  "function prompt { [Console]::Write([char]27 + ']133;D;' + [int]$LASTEXITCODE + [char]7); '" + SHELL_PROMPT + "' }"

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
    lifecycle.abort(new Error('tool-pwsh-persistent disposed during shell creation'))
    await Promise.allSettled([...creating])
    const closing = [...live].map(async ([owner, id]) => { await close(owner, id, 'tool-pwsh-persistent disposed') })
    await Promise.all(closing)
    live.clear()
  }, 'tool-pwsh-persistent shell cleanup')

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
          }, 'tool-pwsh-persistent owner cache cleanup')
        }
        // 初始化时注入自制 prompt 函数（替换后端引导提示符）。
        const setup = ctx.terminals.startSend(owner, spawned.sessionId, {
          text: PWSH_PROMPT_SETUP,
          submit: true,
          signal: combinedSignal,
        })
        const result = await setup.done
        if (result.sessionStatus.kind === 'exited' || result.waitReason === 'timeout') {
          throw new Error('persistent pwsh shell did not accept initialization')
        }
        return spawned.sessionId
      } catch (error: unknown) {
        // 初始化失败时清理本次创建的会话，避免孤儿会话。
        await reset(owner, 'persistent pwsh initialization failed')
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
 * 依次检查：会话已退出、超时、上游中止、完成标记出现、会话状态退出、提示符回归——
 * 任一命中即返回渲染结果。
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
    // settle the previous send while its exit event is still in flight, and
    // the echoed wrapper can then carry a marker end without status digits);
    // re-observing status before the next send closes that gap.
    // 两次迭代之间 shell 可能翻转为 exited（快速 exit 会在退出事件仍在途时落定上次发送，
    // 且回显的 wrapper 可能携带无状态数字的 end 标记）；在下次发送前重读状态弥合窗口。
    const status = ctx.terminals.list(owner).find(session => session.sessionId === id)?.status
    if (status?.kind === 'exited') {
      return await respondToSessionExit(
        ctx, shells, owner, id, status, marker, wrapped, fallback, fallbackTruncated, config,
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
      await shells.reset(owner, 'persistent pwsh send failed')
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
        partialOutput(snapshot, marker, wrapped, fallback, fallbackTruncated),
        config.maxOutputChars,
      )
      await shells.reset(owner, 'persistent pwsh command timed out')
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
      await shells.reset(owner, 'persistent pwsh command aborted')
      commandDeadline.signal.throwIfAborted()
    }
    if (latest.text.includes(marker.end)) {
      // 完成标记出现：尝试提取完整输出（退出码紧随 end 标记）。
      const complete = commandOutput(retainedScrollback(ctx, owner, id, latest), marker, wrapped)
      if (complete !== undefined) return renderCaptured(complete, config.maxOutputChars)
    }
    if (result.sessionStatus.kind === 'exited') {
      return await respondToSessionExit(
        ctx, shells, owner, id, result.sessionStatus, marker, wrapped, fallback, fallbackTruncated, config,
      )
    }
    // 提示符回归：命令已完成（回到自制提示符），返回捕获内容。
    if (promptCompleted(result)) {
      const snapshot = retainedScrollback(ctx, owner, id, latest)
      return renderCaptured(
        partialOutput(snapshot, marker, wrapped, fallback, fallbackTruncated),
        config.maxOutputChars,
      )
    }
    await pause()
  }
}

/**
 * Register the model-facing persistent `pwsh` tool.
 * @param ctx - plugin context carrying tools and the owner-scoped PTY service.
 * @param config - selected PTY backend and command deadline.
 */
/**
 * 注册模型可见的持久化 `pwsh` 工具：维护 owner 级串行队列（同一 agent 的命令排队执行，
 * 避免并发写同一 PTY），工具参数只有 command 一个。
 * @param ctx 携带 tools 与 owner 级 PTY 服务的插件上下文
 * @param config 所选 PTY 后端与命令截止时间
 */
function registerPersistentPwsh(ctx: Context, config: ResolvedConfig): void {
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
    name: 'pwsh',
    description: config.description,
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'The PowerShell command to run. Relative path is preferred in the command.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (args.command.trim().length === 0) throw new Error('command must be a non-empty string')
      const owner = exec.agent
      if (owner === undefined) throw new Error('pwsh requires an owning agent session')
      return serialized(owner, async () => {
        exec.signal.throwIfAborted()
        return executeCommand(ctx, shells, owner, args.command, config, exec.signal)
      })
    },
    presentCall: args => ({ card: 'terminal', title: args.command }),
  }))
}

export const name = 'tool-pwsh-persistent'
export const inject = ['tools', 'terminals']

/** Configuration for the persistent pwsh tool. */
/** 持久化 pwsh 工具的配置。 */
export interface Config {
  /** PTY backend used for each owner-isolated persistent shell (default `shell`). */
  /** 每个 owner 隔离的持久 shell 使用的 PTY 后端（默认 shell）。 */
  backendType?: string
  /** Wall-clock limit for one command (default 300000). */
  /** 单命令的墙上时钟上限（默认 300000 毫秒）。 */
  timeoutMs?: number
  /** Maximum returned command-output characters before clipping (default 16000). */
  /** 返回命令输出的字符上限，超出裁剪（默认 16000）。 */
  maxOutputChars?: number
  /** Model-facing tool description; deployments may describe their environment. */
  /** 模型可见的工具描述；部署方可描述其环境。 */
  description?: string
}

/** Runtime configuration schema for the persistent pwsh tool. */
/** 持久化 pwsh 工具的运行时配置 schema。 */
export const Config: z<Config> = z.object({
  backendType: z.string().default('shell'),
  timeoutMs: z.number().default(300_000),
  maxOutputChars: z.number().default(16_000),
  description: z.string().default(DEFAULT_DESCRIPTION),
})

/** Register one owner-scoped persistent `pwsh` tool. */
/** 注册一个 owner 级持久化 `pwsh` 工具：校验配置并装配默认值后交给 registerPersistentPwsh。 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    backendType: config.backendType ?? 'shell',
    timeoutMs: config.timeoutMs ?? 300_000,
    maxOutputChars: config.maxOutputChars ?? 16_000,
    description: config.description ?? DEFAULT_DESCRIPTION,
  }
  if (resolved.backendType.trim().length === 0) {
    throw new Error('tool-pwsh-persistent: backendType must be non-empty')
  }
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
    throw new Error('tool-pwsh-persistent: timeoutMs must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxOutputChars) || resolved.maxOutputChars <= 0) {
    throw new Error('tool-pwsh-persistent: maxOutputChars must be a positive safe integer')
  }
  if (resolved.description.trim().length === 0) {
    throw new Error('tool-pwsh-persistent: description must be non-empty')
  }
  registerPersistentPwsh(ctx, resolved)
}

/* jscpd:ignore-end */
