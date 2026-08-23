/**
 * ================================ 文件注释 ================================
 * 【文件职责】可选的请求准备期 tmux 位置上下文插件：向合格步骤追加一条持久化、
 *             带来源归属的上下文，命名本 agent 进程所在的 tmux 会话/窗口/窗格
 *             以及窗格的窗格树布局。
 * 【技术维度】每回合只拉取一次状态（step === 1），通过 ctx.shell 执行器跑
 *             tmux display-message；用 pane_tty 与进程控制终端比对来确认
 *             "真的在 tmux 里"；状态变化才重新注入，refreshIntervalMs 做下限节流。
 * 【产品维度】用户在 tmux 里跑多个任务窗格时，模型需要知道"自己在哪个窗格"，
 *             才能正确理解窗口标题、布局等与位置相关的用户话语。
 * 【逻辑维度】1) 配置与 tmux 字段常量；2) queryTmuxLocation：拼装只读 shell
 *             脚本查询位置（含 tty 校验）；3) 状态渲染与变更抑制；4) apply：
 *             pre-step 时查位置，状态或节流条件满足才注入。
 * 【关键边界】缺失 tmux 环境、仅继承的环境、缺 ctx.shell 或查询失败都是
 *             静默无操作而非错误；执行器拒绝被捕获并记录为警告，回合继续。
 * 【新手阅读建议】先读英文模块注释理解设计动机（尤其 tty 校验），再读
 *                 queryTmuxLocation 的 shell 脚本，最后看 apply 的注入条件。
 * ==========================================================================
 */

/**
 * Opt-in request-preparation tmux-location context. Eligible step attempts
 * append durable, source-attributed context naming the tmux session, window,
 * and pane this agent process runs in, plus the window's pane-tree layout.
 *
 * The plugin pulls state once per turn, for the first request (`step === 1`), by
 * running one `tmux display-message` through the `ctx.shell` executor service. It
 * confirms this process genuinely runs inside the pane `$TMUX_PANE` names by
 * matching the pane's `#{pane_tty}` against this process's controlling terminal,
 * so a terminal that merely inherited `$TMUX`/`$TMUX_PANE` from a tmux ancestor
 * (e.g. a VS Code integrated terminal) reads as "not in tmux". It re-injects
 * only when the rendered tmux state changes since the last injection (a moved,
 * renamed, or re-laid-out pane), with an optional `refreshIntervalMs` floor
 * between injections. Absent tmux environment, an inherited-only environment,
 * absent `ctx.shell`, or a failed query is a no-op, never an error: an executor
 * rejection is contained and logged as a warning so the turn continues.
 *
 * @module @deepseek-ai/dsh-tmux-context
 */

import type { Context, LoggerService } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ShellExecutor, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Cordis plugin name used by loader diagnostics. */
/** Cordis 插件名：加载器诊断与消息来源归属都用它。 */
export const name = 'tmux-context'

/** The agent registry that owns pre-step processing. */
/** 依赖注入声明：需要 agents 服务（agent 生命周期与 pre-step 处理）。 */
export const inject = ['agents']

/** Per-turn tmux-location scheduling. Invalid values fail plugin load. */
/** 每回合 tmux 位置注入的调度配置；非法值会导致插件加载失败。 */
export interface Config {
  /** Minimum milliseconds between durable injections in one session. Omit or set to 0 to inject on every eligible change. */
  /** 同一会话内两次持久化注入的最小间隔毫秒数；省略或 0 表示每次状态变化都注入。 */
  refreshIntervalMs?: number
}

/** Schemastery validation for {@link Config}. */
/** Config 的 schemastery 校验模式。 */
export const Config: z<Config> = z.object({
  refreshIntervalMs: z.number(),
})

/**
 * Tab-separated tmux format fields, in query order. Layout (`window_layout`)
 * is the pane-tree description; pane/window pixel sizes are intentionally
 * excluded (own location and layout only, per the package scope).
 */
/**
 * 制表符分隔的 tmux 格式字段（查询顺序）。window_layout 是窗格树描述；
 * 窗格/窗口的像素尺寸被刻意排除（按包范围只关心自身位置与布局）。
 */
const TMUX_FIELDS = [
  '#{session_name}',
  '#{window_index}',
  '#{window_name}',
  '#{pane_index}',
  '#{pane_id}',
  '#{window_active}',
  '#{pane_active}',
  '#{window_layout}',
] as const

/** Structured tmux location parsed from one `display-message` reading. */
/** 从一次 display-message 读取解析出的结构化 tmux 位置。 */
interface TmuxLocation {
  sessionName: string
  windowIndex: string
  windowName: string
  paneIndex: string
  paneId: string
  windowActive: string
  paneActive: string
  windowLayout: string
}

/** Prefix marking the volatile turn/step preamble line of a rendered reading. */
/** 渲染读取文本的易变"回合"前缀：tmux location (turn N):。 */
const READING_PREFIX = 'tmux location (turn '

/**
 * Field separator between tmux format fields. tmux does not interpret C escapes
 * in a format, so the literal two-character sequence `\t` is emitted verbatim
 * and split back out here; this avoids embedding raw whitespace in the command.
 */
/**
 * tmux 格式字段间的分隔符。tmux 不解释格式中的 C 转义，因此把字面的
 * 双字符序列 \t 原样放进命令，之后再按它切分；这样避免在命令里嵌入
 * 真实空白。
 */
const FIELD_SEP = '\\t'

/**
 * Read this process's tmux location through the bash seam, or `undefined` when
 * this process is not genuinely running inside a tmux pane or the query fails.
 *
 * `$TMUX_PANE` alone is insufficient: a terminal launched from a tmux shell
 * (e.g. VS Code's integrated terminal, a desktop launcher) inherits `$TMUX` and
 * `$TMUX_PANE` from that ancestor, so the variables are present even though this
 * process does not live in that pane. The command therefore also compares the
 * pane's `#{pane_tty}` against this process's own controlling terminal
 * (`ps -o tty=` for {@link processId}); a genuine pane owns this process's tty,
 * an inherited environment names some other pane's tty. Fields are emitted only
 * on a match, so an inherited environment reads as "not in tmux" and injects
 * nothing.
 *
 * The location is optional context, so an executor rejection is a failed query,
 * not a turn failure: `resolve()` may reject the command on policy grounds and
 * `run()` only promises to resolve for nonzero exits, timeouts, and aborts, so
 * both are contained and reported as a warning.
 *
 * @param bash - The executor service used to run the read-only tmux/ps commands.
 * @param logger - receives a warning when the executor rejects the query.
 * @param processId - this agent process's pid, whose controlling tty must match the pane.
 * @param signal - abort signal forwarded to the executor.
 * @returns the parsed location, or `undefined` when not in a real pane or on any failure.
 */
/**
 * 通过 bash 执行器读取本进程的 tmux 位置；不在真实 tmux 窗格内或查询失败时
 * 返回 undefined。单靠 $TMUX_PANE 不够：从 tmux shell 启动的终端（如 VS Code
 * 集成终端）会继承这两个变量，但进程并不在那个窗格里。因此脚本还会把窗格的
 * pane_tty 与进程控制终端比对：真窗格拥有本进程的 tty，继承环境指向别处。
 * 位置是可选上下文，执行器拒绝只是查询失败而非回合失败，被捕获后记录警告。
 * @param bash 用于运行只读 tmux/ps 命令的执行器服务
 * @param logger 执行器拒绝查询时接收警告日志
 * @param processId 本 agent 进程的 pid，其控制 tty 必须与窗格匹配
 * @param signal 转发给执行器的取消信号
 * @returns 解析出的位置；不在真实窗格或任何失败时返回 undefined
 */
async function queryTmuxLocation(
  bash: ShellExecutor,
  logger: LoggerService,
  processId: number,
  signal: AbortSignal,
): Promise<TmuxLocation | undefined> {
  const format = TMUX_FIELDS.join(FIELD_SEP)
  // 脚本链：校验环境变量 → 取本进程 tty → 取窗格 tty → 比对 → 输出格式字段
  const command = [
    '[ -n "$TMUX_PANE" ] || exit 1',
    `self_tty=$(ps -o tty= -p ${processId} | tr -d ' ')`,
    '[ -n "$self_tty" ] || exit 1',
    'pane_tty=$(tmux display-message -t "$TMUX_PANE" -p \'#{pane_tty}\') || exit 1',
    '[ "$pane_tty" = "/dev/$self_tty" ] || exit 1',
    `exec tmux display-message -t "$TMUX_PANE" -p '${format}'`,
  ].join('\n')
  let result: ShellRunResult
  try {
    result = await bash.run(bash.resolve({ command, signal }))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`tmux location query failed: ${message}; injecting no location this turn`)
    return undefined
  }
  if (result.exitCode !== 0) return undefined
  // 输出按制表符切分，字段数必须与 TMUX_FIELDS 完全一致
  const line = result.stdout.text.split('\n', 1)[0] as string
  const parts = line.split(FIELD_SEP)
  if (parts.length !== TMUX_FIELDS.length) return undefined
  const [
    sessionName,
    windowIndex,
    windowName,
    paneIndex,
    paneId,
    windowActive,
    paneActive,
    windowLayout,
  ] = parts as [string, string, string, string, string, string, string, string]
  if (paneId.length === 0) return undefined
  return {
    sessionName,
    windowIndex,
    windowName,
    paneIndex,
    paneId,
    windowActive,
    paneActive,
    windowLayout,
  }
}

/**
 * Render the stable tmux state block: the part of a reading compared for
 * change suppression. It excludes the turn preamble so re-injection is driven
 * only by tmux state, not by loop position.
 */
/**
 * 渲染稳定的 tmux 状态块：这是读取文本中用于变更抑制比较的部分。
 * 刻意不含回合前缀，使"是否重新注入"只由 tmux 状态决定，与循环位置无关。
 */
function renderState(location: TmuxLocation): string {
  return `session ${location.sessionName}, `
    + `window ${location.windowIndex} ${JSON.stringify(location.windowName)}, `
    + `pane ${location.paneIndex} ${location.paneId}\n`
    + `window active=${location.windowActive}, pane active=${location.paneActive}, `
    + `layout ${location.windowLayout}`
}

/** Render the full durable reading, including the volatile turn preamble. */
/** 渲染完整的持久化读取文本（含易变的回合前缀 + 稳定状态块）。 */
function renderReading(location: TmuxLocation, turn: number): string {
  return `${READING_PREFIX}${turn}):\n${renderState(location)}`
}

/**
 * The stable state block of this plugin's latest durable injection, or
 * `undefined` when the session has none. Scans raw durable events so the
 * schedule survives compaction and resumed processes without process-local
 * cache state.
 */
/**
 * 本插件最近一次持久化注入的稳定状态块；会话里没有则为 undefined。
 * 扫描原始持久化事件，使节流判断在压缩与进程恢复后依然可靠，
 * 不依赖进程内的缓存状态。
 */
function latestInjectedState(agent: Agent): { state: string; time: number } | undefined {
  for (const event of [...agent.session.events].reverse()) {
    if (event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === name) {
      const [block] = event.data.content
      if (block?.type !== 'text') return undefined
      // 状态块 = 首行（回合前缀）之后的部分
      const newline = block.text.indexOf('\n')
      const state = newline === -1 ? '' : block.text.slice(newline + 1)
      return { state, time: event.time }
    }
  }
  return undefined
}

/** Reject refresh intervals that cannot represent an exact elapsed-millisecond threshold. */
/** 拒绝无法表示精确毫秒阈值的刷新间隔：必须是非负安全整数。 */
function validateRefreshInterval(refreshIntervalMs: number | undefined): void {
  if (refreshIntervalMs !== undefined && (
    !Number.isSafeInteger(refreshIntervalMs)
    || refreshIntervalMs < 0
  )) {
    throw new TypeError(
      `tmux-context: refreshIntervalMs must be a non-negative safe integer, got ${String(refreshIntervalMs)}`,
    )
  }
}

/**
 * Register a prepended pre-step listener for the lifetime of `ctx`.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param config - durable refresh scheduling configuration.
 * @throws when the refresh interval is invalid.
 */
/**
 * 注册一个 prepend 的 pre-step 监听（随 ctx 生命周期一起卸载）：
 * 每个回合的第一步查询一次 tmux 位置，状态变化时在消息开头注入读取。
 * @param ctx 插件上下文；监听随其一起销毁
 * @param config 持久化刷新调度配置
 * @throws 刷新间隔非法时抛出
 */
export function apply(ctx: Context, config: Config): void {
  const refreshIntervalMs = config.refreshIntervalMs
  validateRefreshInterval(refreshIntervalMs)

  ctx.on('agent/pre-step', async (
    { agent, turn, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    // 仅每回合第一步尝试注入；被拒绝或已取消则原样放行
    if (decision.kind === 'reject' || signal.aborted || step !== 1) return decision
    const bash = ctx.get('shell')
    if (bash === undefined) return decision
    const previous = latestInjectedState(agent)
    // 节流：距上次注入不足 refreshIntervalMs 时跳过
    if (refreshIntervalMs !== undefined && refreshIntervalMs > 0 && previous !== undefined) {
      const now = Date.now()
      if (now >= previous.time && now - previous.time < refreshIntervalMs) return decision
    }
    const location = await queryTmuxLocation(bash, ctx.logger, process.pid, signal)
    if (location === undefined) return decision
    const state = renderState(location)
    // 变更抑制：tmux 状态与上次注入完全一致时不重复注入
    if (previous !== undefined && previous.state === state) return decision
    const text = renderReading(location, turn)
    return {
      kind: 'enter',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
        }),
        ...decision.messages,
      ],
    }
  }, { prepend: true })
}
