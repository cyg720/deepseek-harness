/**
 * @deepseek-ai/dsh-headless — one-shot direct Agent driver. The bundle patch
 * rides over dsh-base without Host, HTTP, or browser plugins; this runner
 * creates one Agent through the core registry, drives the task to quiescence,
 * streams provider reasoning to stderr, flushes its Session, prints the final
 * assistant text to stdout, and exits.
 *
 * @module @deepseek-ai/dsh-headless
 */
/*
 * 文件职责：实现headless Bundle的一次性代理驱动器，创建会话、执行单个任务、汇总最终文本、刷新并请求退出。
 * 技术维度：使用Cordis插件、代理注册表、持久Session事件和默认模型选择完成空闲到空闲的直接运行区间。
 * 产品维度：为脚本和CI提供无需HTTP或浏览器的单任务入口，并以stdout/stderr与退出码表达结果。
 * 逻辑维度：等待Loader树完整，创建带模型选择的代理，记录起始序号，发送用户消息，等待空闲，汇总并刷新会话。
 * 关键边界：每次只运行一个任务；仅输出最后已提交助手文本；异常或非正常轮次映射为失败退出。
 * 新手阅读建议：先看Config和RunOutcome，再读summarize如何过滤事件，最后跟踪run中的创建、等待、刷新和退出顺序。
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { assertNever, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
/* Cordis中注册的一次性运行器稳定插件名。 */
export const name = 'headless-runner'

/** Core services required before the one-shot turn can start. */
/* 单次轮次启动前必须就绪的默认模型、代理和会话服务。 */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the task resolved from this app's injected provider service. */
/* 由headless启动参数服务解析并注入的运行器配置。 */
export interface Config {
  /** The prompt text for the single run. */
  /* 本次唯一运行的提示文本。 */
  task: string
}

// Cordis用于验证任务文本存在的配置模式。
export const Config: z<Config> = z.object({
  task: z.string().required(),
})

/** Outcome of one owned run interval. */
/* 一个自有运行区间汇总出的最终文本和轮次结束原因。 */
interface RunOutcome {
  /** 最后一个非空已提交助手文本。 */
  text: string
  /** 区间内关联轮次的结束原因，未启动时为空。 */
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

/** Process-facing effects of one run: output streams plus the launcher's bounded exit request. */
/* 一次运行可用的输出流和启动器受控退出效果。 */
interface HeadlessIo {
  /** 成功答案写入的标准输出接口。 */
  stdout: { write(chunk: string): unknown }
  /** 失败诊断写入的标准错误接口。 */
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  /* 请求插件树释放后以指定状态码退出。 */
  exit(code: number): void
}

/** The process streams the runner writes to; tests substitute captures. */
/* 运行器使用的可替换进程输出流，测试会换成捕获器。 */
export const internals: { stdout: HeadlessIo['stdout']; stderr: HeadlessIo['stderr'] } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
/* 从起始事件序号后汇总最后助手文本和轮次结束原因。 */
function summarize(events: readonly SessionEvent[], firstSeq: number): RunOutcome {
  // 是否已经观察到当前自有区间的turn/start。
  let started = false
  // 最近一条非空已提交助手文本。
  let text = ''
  // 当前区间最后观察到的turn/end原因。
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      // 当前助手消息全部文本块按内容顺序连接的结果。
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/**
 * Project provider-reported reasoning from one owned run to stderr as it is
 * appended, while keeping final outcome derivation on the durable log.
 * @param ctx - plugin context carrying the Session event feed.
 * @param agent - the exact Agent whose reasoning belongs to this invocation.
 * @param stderr - progress output sink.
 * @returns a disposer that also terminates an unterminated reasoning line.
 */
function streamReasoning(
  ctx: Context,
  agent: Agent,
  stderr: HeadlessIo['stderr'],
): () => void {
  let started = false
  let open = false
  let endsWithNewline = true
  const close = (): void => {
    if (!open) return
    if (!endsWithNewline) stderr.write('\n')
    open = false
    endsWithNewline = true
  }
  const dispose = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type === 'turn/start') {
      close()
      started = true
      return
    }
    if (!started || event.type !== 'assistant/chunk') return
    const chunk = event.data.chunk
    switch (chunk.type) {
      case 'reasoning-delta':
        if (chunk.text === '') return
        if (!open) {
          stderr.write('dsh: reasoning:\n')
          open = true
        }
        stderr.write(chunk.text)
        endsWithNewline = chunk.text.endsWith('\n')
        return
      case 'block-start':
        if (chunk.blockType !== 'reasoning') close()
        return
      case 'block-end':
        if (chunk.block.type !== 'reasoning') close()
        return
      case 'usage':
        return
      case 'text-delta':
      case 'tool-call-delta':
      case 'finish':
        close()
        return
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        return assertNever(chunk, 'headless reasoning stream')
    }
  })
  return () => {
    dispose()
    close()
  }
}

/** Report an unexpected direct-driver failure and request a failing exit. */
/* 把意外驱动失败写入stderr，并请求退出码1。 */
function fail(io: HeadlessIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Run one task through a freshly created Agent and request process exit.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param task - one-shot task text.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, task: string, io: HeadlessIo): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  // 当前上下文可选的代理注册表。
  const agents = ctx.get('agents')
  // 当前部署的默认模型选择服务。
  const defaultModel = ctx.get('agentDefaultModel')
  // 当前上下文的会话注册表。
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  // 在代理创建时冻结的当前默认提供方与模型。
  const selection = defaultModel.currentSelection()
  // This bundle composes no preset roster, so the model-facing rows sit in the
  // host plane and the agent reads them from the global layer. A deployment
  // that DOES configure one has to join it here first
  // (@deepseek-ai/dsh-agent-presets README, "Composing a child agent").
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  const stopReasoning = streamReasoning(ctx, agent, io.stderr)
  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: task }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
  } finally {
    stopReasoning()
  }
  await sessions.flush(agent.session)
  const outcome = summarize(agent.session.events, firstSeq)
  io.stdout.write(outcome.text + '\n')
  if (outcome.reason?.kind === 'error') {
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
  }
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
}

/**
 * Mount the one-shot direct driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated task config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('headless-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: HeadlessIo = { stdout: internals.stdout, stderr: internals.stderr, exit }
  void run(ctx, config.task, io).catch((error: unknown) => { fail(io, error) })
}
