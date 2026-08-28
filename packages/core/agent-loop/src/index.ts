/*
 * ================================ 文件注释 ================================
 * 【文件职责】agent-loop 插件本体：AgentLoop 服务负责创建/恢复 ReactLoopAgent、把它们发布进 agents/sessions 注册表，并统一管理有序拆除（teardown）。
 * 【技术维度】Cordis Service 实现 AgentFactory 接口；用 ctx.effect 注册生命周期；配置经 schemastery schema 校验；支持 settings 动态修改并行上限；launcher 可预置会话身份。
 * 【产品维度】这是“配置文件里声明一个 agent”的落地实现：cordis.yml 里写 agents 列表即可在启动时自动创建或恢复会话，支持断点续跑（resume）。
 * 【逻辑维度】常量与工具函数（FactoryOwnership/raceAbort/校验）→ 类型与事件声明 → PreparedAgent 准备流程（prepare：创建、融合取消信号、反向拆除）
 * → 公开入口（create/createAgent/resume/resumeWith）。
 * 【关键边界】所有拆除路径必须幂等且共享同一 Promise；并发 create/resume 竞争同一身份时只有一处能发布；错误在 load 阶段必须响亮失败，绝不静默跳过。
 * 【新手阅读建议】先读 Config 与 AgentLoop 构造函数看配置如何驱动，再读 prepare() 理解“注册前先建好拆除逻辑”的思路，最后看 create/resume 两条入口。
 * ==========================================================================
 */
/**
 * Concrete agent-loop plugin: creates scoped ReactLoopAgents, publishes them
 * through the agent/session registries, and owns their ordered teardown.
 *
 * @module @deepseek-ai/dsh-agent-loop
 */

import { Context, FiberState, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentFactory,
  AgentHandle,
  AgentOptions,
  AgentSetup,
  CreateAgentOptions,
  ResumeAgentOptions,
  SessionStartSource,
} from '@deepseek-ai/dsh-agent'
import { errorChain, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SessionId, SessionPreparation } from '@deepseek-ai/dsh-session'
import type { Session, SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { ReactLoopAgent } from './agent.ts'
import { DEFAULT_MAX_PARALLEL_TOOL_CALLS } from './constants.ts'

/** Fiber states that cannot own or serve a new lifecycle. */
// 不能承载新生命周期的纤维状态集合：卸载中/已处置/已失败时不再接受新 agent。
const INACTIVE_STATES: ReadonlySet<FiberState> = new Set([
  FiberState.UNLOADING,
  FiberState.DISPOSED,
  FiberState.FAILED,
])

/** Factory-level ownership: live agent teardowns plus config startup work. */
// 工厂级所有权：跟踪所有在线 agent 的拆除器与配置启动任务，统一在工厂拆除时收尾。
class FactoryOwnership {
  // 是否仍接受新工作（dispose 后置 false）。
  private accepting = true
  // 工厂级拆除控制器：dispose 时 abort（原因“agent loop 未激活”），所有等待者即刻醒来。
  private readonly teardown = new AbortController()
  // 拆除完成承诺：waitWhileActive 与它赛跑，工厂一拆就不再等待。
  private readonly inactive = Promise.withResolvers<void>()
  // 在线 agent 的拆除器集合（factory dispose 时逐个执行）。
  private readonly liveAgents = new Set<() => Promise<void>>()
  // 配置启动任务集合（restore/resume 等在 agent 存在之前的异步工作）。
  private startupTasks = new Set<Promise<void>>()

  constructor(private readonly fiber: Context['fiber']) {}

  /** Aborts (reason: `agent loop is not active` error) when factory teardown begins. */
  // 拆除信号：工厂开始拆除即 abort，供 create/resume 的等待者感知。
  get signal(): AbortSignal {
    return this.teardown.signal
  }

  // 是否活跃：仍在接受且所在纤维状态可用。
  isActive(): boolean {
    return this.accepting && !INACTIVE_STATES.has(this.fiber.state)
  }

  /** Track one live agent's shared teardown until it has run. */
  // 登记一个在线 agent 的拆除器；返回注销函数（agent 自行拆除时调用）。
  track(dispose: () => Promise<void>): () => void {
    this.liveAgents.add(dispose)
    return () => { this.liveAgents.delete(dispose) }
  }

  /** Join config startup work that begins before an agent exists. */
  // 登记一段“agent 尚不存在时就开始”的配置启动任务，拆除时等待其结算。
  trackStartup(job: Promise<void>): void {
    this.startupTasks.add(job)
    const forget = () => { this.startupTasks.delete(job) }
    void job.then(forget, forget)
  }

  /** Join one public create/resume continuation; factory dispose awaits its settlement. */
  // 登记公开的 create/resume 延续：成败都算结算，工厂拆除要等它。
  trackWrapper(job: Promise<unknown>): void {
    this.trackStartup(job.then(() => undefined, () => undefined))
  }

  /** Resolve `task`, or stop waiting when factory teardown begins. */
  // 与工厂拆除赛跑：任务先完成则等它，工厂先拆除则立刻返回。
  async waitWhileActive(job: Promise<void>): Promise<void> {
    await Promise.race([job, this.inactive.promise])
  }

  // 工厂拆除：停止接受 → 触发 abort → 等待所有在线 agent 拆除器与启动任务结算。
  async dispose(): Promise<void> {
    this.accepting = false
    this.teardown.abort(new Error('agent loop is not active'))
    this.inactive.resolve()
    await Promise.all([
      ...[...this.liveAgents].map(dispose => dispose()),
      ...this.startupTasks,
    ])
  }
}

/** Await `operation`, or throw the signal's reason as soon as it aborts. */
// 与取消信号赛跑：operation 先结算则返回其值，信号先 abort 则抛信号原因。
async function raceAbort<T>(operation: PromiseLike<T> | T, signal: AbortSignal, id: SessionId): Promise<T> {
  // 把信号原因包装成错误（非 Error 原因也包装为带 cause 的 Error）。
  const toAbortError = (): Error => signal.reason instanceof Error
    ? signal.reason
    : new Error(`agent "${id}" creation aborted`, { cause: signal.reason })
  if (signal.aborted) throw toAbortError()
  const aborted = Promise.withResolvers<never>()
  const listener = (): void => { aborted.reject(toAbortError()) }
  signal.addEventListener('abort', listener, { once: true })
  try {
    return await Promise.race([Promise.resolve(operation), aborted.promise])
  } finally {
    signal.removeEventListener('abort', listener)
  }
}

/** Start an abortable operation and release a value that arrives after cancellation. */
// 启动一个可中止的操作；若取消后才返回结果，通过 releaseAbandoned 释放（例如丢弃迟到的会话准备）。
async function raceAbortCall<T>(
  operation: () => PromiseLike<T> | T,
  signal: AbortSignal,
  id: SessionId,
  releaseAbandoned?: (value: T) => void,
): Promise<T> {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error(`agent "${id}" creation aborted`, { cause: signal.reason })
  }
  const pending = Promise.resolve().then(operation)
  try {
    return await raceAbort(pending, signal, id)
  } catch (error: unknown) {
    // 操作因取消失败但结果仍会到达：交给 releaseAbandoned 处置，避免资源泄漏。
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while the operation is awaited.
    if (signal.aborted && releaseAbandoned !== undefined) {
      void pending.then(releaseAbandoned, () => undefined)
    }
    throw error
  }
}

/** Resolve the deployment-wide scheduler cap at the owning config boundary. */
// 解析部署级并行上限：缺省用默认值 10，非正整数直接抛错（配置错误要响亮失败）。
function resolveMaxParallelToolCalls(value: number | undefined): number {
  const maxParallelToolCalls = value ?? DEFAULT_MAX_PARALLEL_TOOL_CALLS
  if (!Number.isInteger(maxParallelToolCalls) || maxParallelToolCalls < 1) {
    throw new Error('maxParallelToolCalls must be a positive integer')
  }
  return maxParallelToolCalls
}

/** Reject an output-token cap that cannot be represented exactly on the request wire. */
// 校验 maxTokens：必须是正的安全整数（请求线上不能出现无法精确表示的 token 上限）。
function assertAgentOptions(options: AgentOptions): void {
  if (options.maxTokens !== undefined
    && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0)) {
    throw new TypeError('agent maxTokens must be a positive safe integer')
  }
}

/** Prepared-but-unpublished agent resources sharing one memoized teardown. */
// “已准备但未发布”的 agent 资源包：四个能力共用一份幂等拆除。
interface PreparedAgent {
  agent: ReactLoopAgent
  /** Aborts when the factory unloads, the caller cancels, or teardown begins — ends any setup await. */
  // 融合取消信号：工厂卸载/调用方取消/拆除开始都会中止，终结任何 setup await。
  signal: AbortSignal
  /** Enter registries, announce, notify session-start, and start the machine. */
  // 发布：进入注册表、宣布、通知 session-start，并启动机器。
  publish(source: SessionStartSource): AgentHandle
  /** Reverse teardown: stop the machine, unregister, unwind the scope. Memoized. */
  // 反向拆除：停机器 → 注销 → 拆作用域。幂等（共享同一 Promise）。
  dispose(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentLoop: AgentLoop
    /**
     * Launcher-owned exact session identities for configured agents, keyed by
     * the agent's config `id` and set with `ctx.provide()` before any Loader
     * entry mounts (see {@link CONFIGURED_AGENT_IDENTITIES_KEY}). A launcher
     * owns identity because only it knows whether the session already exists,
     * while the `cordis.yml` row keeps the model route as ordinary patchable
     * config. An entry with no matching key keeps its configured identity.
     */
    // launcher 预置的配置 agent 会话身份：只有启动器知道会话是否已存在，模型路由仍留在可 patch 的配置里。
    configuredAgentIdentities?: ConfiguredAgentIdentities
  }
  interface Events {
    /**
     * A declarative agent entry failed before it could publish a live agent.
     * Consumers that buffer work for the configured identity use this
     * transient signal to reject that work instead of waiting forever. Normal
     * factory teardown suppresses failures from the cancelled startup attempt.
     * @param payload.sessionId - exact shared agent/session identity that failed startup.
     * @param payload.error - persistence, setup, or publication failure.
     * @mode emit
     */
    // agent-loop/config-start-failed：配置声明的 agent 在发布前启动失败；为身份缓存工作的消费方据此拒绝积压的工作。
    'agent-loop/config-start-failed'(payload: { sessionId: SessionId; error: unknown }): void
  }
}

export { DEFAULT_MAX_PARALLEL_TOOL_CALLS }

/**
 * One launcher-selected session identity for a configured agent. `resume`
 * distinguishes rehydrating existing persisted history from creating the
 * session fresh under that exact id, which the two config keys express as
 * `resumeSessionId` and `sessionId`.
 */
// 启动器为某个配置 agent 选定的一种会话身份：resume=true 恢复既有历史，否则用该 id 新建。
export interface LauncherAgentIdentity {
  /** Exact session id to create fresh or resume. */
  // 精确会话 id（新建或恢复用）。
  id: SessionId
  /** Resume existing persisted history instead of creating the session fresh. */
  // true 表示恢复已有持久化历史，false 表示全新创建。
  resume: boolean
}

/** Launcher-selected identities keyed by the configured agent's `id`. */
// 按配置 agent 的 id 索引的启动器身份表。
export interface ConfiguredAgentIdentities extends Readonly<Record<string, LauncherAgentIdentity>> {}

/**
 * Context key a launcher sets before any Loader entry mounts
 * (`ctx.provide(CONFIGURED_AGENT_IDENTITIES_KEY, identities)`) to fix
 * configured agents' session identities without a config key, so an overlay
 * repointing the row's model route cannot drop them.
 */
// 上下文键：启动器在任何 Loader 条目挂载前用 ctx.provide() 设置身份表，
// 这样 overlay 改模型路由时不会丢掉身份。
export const CONFIGURED_AGENT_IDENTITIES_KEY = 'configuredAgentIdentities'

/**
 * Apply launcher-owned identities over the configured agents, replacing both
 * identity keys for every entry the launcher named so a config-supplied
 * identity can never survive alongside a launcher-supplied one.
 * @param agents - the configured agent entries.
 * @param identities - launcher identities keyed by configured agent `id`, or `undefined`.
 * @returns the entries with launcher-owned identities applied.
 */
// 把启动器身份应用到配置条目：凡启动器点名的条目，其两个身份键（sessionId/resumeSessionId）
// 都被替换成启动器身份，杜绝“配置身份与启动器身份并存”。
function applyLauncherIdentities(
  agents: Config['agents'],
  identities: ConfiguredAgentIdentities | undefined,
): Config['agents'] {
  if (identities === undefined) return agents
  return agents.map((agent) => {
    const identity = identities[agent.id]
    if (identity === undefined) return agent
    const { sessionId: _sessionId, resumeSessionId: _resumeSessionId, ...rest } = agent
    return identity.resume
      ? { ...rest, resumeSessionId: identity.id }
      : { ...rest, sessionId: identity.id }
  })
}

/** Settings namespace carrying the tool-call parallelism a user owns. */
// 设置命名空间键：用户可运行期调整的“工具并行上限”所在段。
export const AGENT_LOOP_SETTINGS_NAMESPACE = settingsNamespace('agent-loop')

/**
 * The agent-loop fields a user owns. Deliberately a strict subset of
 * {@link Config}: `agents` is a boot-time composition array consumed once when
 * the service starts, so a stored change could only look like it had an effect.
 */
// 用户可拥有的设置字段：刻意只是 Config 的严格子集——agents 是启动时一次性消费的组合数组，
// 存下来改变它只会“看起来有效”，因此不纳入设置。
export interface AgentLoopSettings {
  /** Maximum parallel-safe calls in flight per agent step. */
  // 每步在途的并行安全调用上限。
  maxParallelToolCalls: number
}

/** Schema of the agent-loop settings section. */
// 设置段运行时 schema：正整数，默认 DEFAULT_MAX_PARALLEL_TOOL_CALLS。
export const AGENT_LOOP_SETTINGS_SCHEMA: z<AgentLoopSettings> = z.object({
  maxParallelToolCalls: z.number().step(1).min(1).default(DEFAULT_MAX_PARALLEL_TOOL_CALLS),
})

/** Agent-loop plugin configuration. */
// agent-loop 插件配置：并行上限 + 启动/恢复的 agent 列表。
export interface Config {
  /**
   * Maximum parallel-safe calls in flight per agent step. `1` is serial;
   * omission defaults to {@link DEFAULT_MAX_PARALLEL_TOOL_CALLS}.
   */
  // 每步并行上限：1 表示串行；缺省为默认值 10。
  maxParallelToolCalls?: number
  /** Agents created or resumed at plugin startup. */
  // 插件启动时创建或恢复的 agent 列表。
  agents: (AgentOptions & {
    /** Stable config label used in logs and as the fresh combined-id prefix. */
    // 稳定配置标签：日志标识 + 新建组合 id 的前缀。
    id: string
    /** Optional stable identity; remounts resume its materialized history, while first use creates it fresh. */
    // 可选稳定身份：再次挂载恢复其已物化的历史，首次使用则新建。
    sessionId?: SessionId
    /** Optional workspace for a fresh session. */
    // 新建会话的可选工作目录。
    cwd?: string
    /** Persisted session to resume instead of creating a fresh session. */
    // 要恢复的持久化会话（而不是新建）。
    resumeSessionId?: SessionId
  })[]
}

/** Agent-loop configuration after defaults and load-time validation. */
// 应用默认值并完成装载期校验后的配置形态。
type ResolvedConfig = Config & { maxParallelToolCalls: number }

/** Reject self-contained identity conflicts before any configured agent starts. */
// 装载期校验：任何配置 agent 启动前，先拒绝自洽性冲突（同一条目不兼有 sessionId/resumeSessionId；
// 且不允许两个 agent 复用同一个精确会话身份）。
function validateConfiguredAgents(agents: Config['agents']): void {
  const exactIdentities = new Map<SessionId, string>()
  for (const { id, sessionId, resumeSessionId } of agents) {
    const hasResumeId = resumeSessionId !== undefined && resumeSessionId !== ''
    if (sessionId !== undefined && hasResumeId) {
      throw new Error(`agent "${id}": sessionId and resumeSessionId are mutually exclusive`)
    }
    const exactIdentity = hasResumeId ? resumeSessionId : sessionId
    if (exactIdentity === undefined) continue
    const firstId = exactIdentities.get(exactIdentity)
    if (firstId !== undefined) {
      throw new Error(`agents "${firstId}" and "${id}" use duplicate exact session identity "${exactIdentity}"`)
    }
    exactIdentities.set(exactIdentity, id)
  }
}

/** Concrete agent factory and driver service. */
// AgentLoop：实现 AgentFactory 的驱动服务；负责创建/恢复 ReactLoopAgent 并管理其生命周期。
export class AgentLoop extends Service implements AgentFactory {
  static inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt']

  /** Runtime schema for declarative agents. */
  // 声明式 agent 的运行时 schema：与 Config 对应，装载时校验。
  static Config = z.object({
    maxParallelToolCalls: z.number().step(1).min(1).default(DEFAULT_MAX_PARALLEL_TOOL_CALLS),
    agents: z.array(z.object({
      id: z.string().required(),
      sessionId: z.string().min(1),
      provider: z.string(),
      model: z.string(),
      reasoningEffort: z.string().min(1) as z<ReturnType<typeof ReasoningEffortId>>,
      maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
      cwd: z.string(),
      resumeSessionId: z.string(),
    })).default([]),
  }) as z<Config>

  /** Validated configuration owned by the agent-loop service. */
  // 校验后的配置：maxParallelToolCalls 是实时 getter，每次读取都从设置源取最新值。
  readonly config: ResolvedConfig
  // 工厂级所有权：跟踪在线 agent 拆除器与启动任务。
  private readonly ownership: FactoryOwnership
  /** Plain holder prevents Cordis from re-tracing the factory's dependency context through a caller shadow. */
  // 普通持有者：避免 Cordis 透过调用者影子重复追踪工厂的依赖上下文。
  private readonly runtime: { ctx: Context }

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentLoop')
    const entry: AgentLoopSettings = {
      maxParallelToolCalls: resolveMaxParallelToolCalls(config.maxParallelToolCalls),
    }
    // 设置数据源：默认指向组合配置条目；settings 提供者挂载后换成实时读取函数。
    let source: () => AgentLoopSettings = () => entry
    this.config = {
      ...config,
      agents: applyLauncherIdentities(config.agents, ctx.get(CONFIGURED_AGENT_IDENTITIES_KEY)),
      // Read through on every scheduler decision: `tool-calls.ts` destructures
      // this at the start of each group, so a committed change caps the next
      // group without disturbing the one in flight.
      // 每次调度决策都实时读取：tool-calls.ts 在每个组开始时解构它，因此已提交的修改
      // 只限制下一组，不影响正在飞行中的那一组。
      get maxParallelToolCalls() {
        return source().maxParallelToolCalls
      },
    }
    installSettingsSection(ctx, AGENT_LOOP_SETTINGS_NAMESPACE, AGENT_LOOP_SETTINGS_SCHEMA, entry, {
      // The schema admits any integer above zero; `resolveMaxParallelToolCalls`
      // owns the whole rule, so refusing here keeps the running scheduler on
      // its last good cap instead of failing at the next tool group.
      // schema 允许任何正整数，完整规则由 resolveMaxParallelToolCalls 持有：这里拒绝非法值，
      // 让运行中的调度器保持“上一次的合法上限”，而不是在下一个工具组时失败。
      validate: value => void resolveMaxParallelToolCalls(value.maxParallelToolCalls),
      setSource: (current) => {
        source = current
      },
      // Nothing is derived from the cap: the getter above is the only reader.
      // 上限没有派生注册项：上面的 getter 是唯一读取方，因此 onChange 为空。
      onChange: () => {},
    })
    validateConfiguredAgents(this.config.agents)
    this.ownership = new FactoryOwnership(ctx.fiber)
    this.runtime = { ctx }
    // 生命周期接线：工厂拆除 → 登记本服务为 agent 工厂 → 提供 systemPrompt 变量。
    ctx.effect(() => () => this.ownership.dispose(), 'agentLoop.transactions()')
    ctx.effect(() => ctx.agents.setFactory(this), 'agentLoop.setFactory()')
    ctx.systemPrompt.variable('provider', context => context.agent?.options.provider)
    ctx.systemPrompt.variable('model', context => context.agent?.options.model)
    ctx.systemPrompt.variable('cwd', context => context.agent?.session.header.cwd)

    // 启动配置声明的每个 agent：无 resumeSessionId → 新建（有持久化时先尝试恢复）；有 → 异步恢复。
    for (const { id, sessionId, cwd, resumeSessionId, ...options } of this.config.agents) {
      const meta = cwd === undefined ? {} : { cwd }
      if (resumeSessionId === undefined || resumeSessionId === '') {
        // 未指定恢复身份：sessionId 缺省时生成“id-session-<uuid>”组合身份。
        const configuredId = sessionId ?? SessionId(`${id}-session-${randomUUID()}`)
        const persistence = sessionId === undefined ? undefined : ctx.get('sessionPersistence')
        if (persistence === undefined) {
          // 无持久化（或未给稳定身份）：直接同步创建。
          this.create(configuredId, options, meta)
        } else {
          // 有持久化：先尝试恢复已物化的会话，失败则回落到首次创建（结果登记为启动任务）。
          const startup = this.restoreOrCreateConfigured(ctx, persistence, configuredId, options, meta).catch((error: unknown) => {
            this.reportConfiguredStartupFailure(id, 'restore', configuredId, error)
          })
          this.ownership.trackStartup(startup)
        }
        continue
      }
      // 声明了 resumeSessionId：注入 sessionPersistence 后异步恢复（按配置 id 命名的 effect）。
      ctx.effect(() => {
        const fiber = ctx.inject(['sessionPersistence'], (childCtx: Context) => {
          void this.resumeWith(ctx, childCtx.sessionPersistence, {
            resumeSessionId,
            agentOptions: options,
          }).catch((error: unknown) => {
            this.reportConfiguredStartupFailure(id, 'resume', resumeSessionId, error)
          })
        })
        return fiber.dispose
      }, `agentLoop.resume(${id})`)
    }
  }

  /** Report a contained declarative-start failure to identity-bound consumers. */
  // 上报受控的声明式启动失败：记日志 + 发 agent-loop/config-start-failed（监听器逐个容错）。
  private reportConfiguredStartupFailure(
    configId: string,
    action: 'restore' | 'resume',
    sessionId: SessionId,
    error: unknown,
  ): void {
    if (!this.ownership.isActive()) return
    this.ctx.logger.warn(`agent "${configId}": config-driven ${action} of "${sessionId}" failed: ${errorChain(error)}`)
    const args: unknown[] = ['agent-loop/config-start-failed', { sessionId, error }]
    for (const callback of this.ctx.events.dispatch('emit', args)) {
      try {
        const returned: unknown = callback(...args)
        void Promise.resolve(returned).catch((listenerError: unknown) => {
          this.ctx.logger.warn(`agent "${configId}": config-start-failed listener rejected: ${errorChain(listenerError)}`)
        })
      } catch (listenerError: unknown) {
        this.ctx.logger.warn(`agent "${configId}": config-start-failed listener threw: ${errorChain(listenerError)}`)
      }
    }
  }

  /** Restore a materialized exact config identity on remount, or create it on first use. */
  // 恢复/新建二选一：先等同 id 生命周期排空，再尝试恢复；只有“确实不存在”才回落首次创建，
  // 损坏与后端失败保持响亮报错。
  private async restoreOrCreateConfigured(
    ownerCtx: Context,
    persistence: SessionPersistence,
    sessionId: SessionId,
    agentOptions: AgentOptions,
    meta: Pick<SessionHeader, 'cwd'>,
  ): Promise<void> {
    await this.waitForDrainingConfiguredIdentity(ownerCtx, sessionId)
    if (!this.ownership.isActive()) return
    try {
      await this.resumeWith(ownerCtx, persistence, { resumeSessionId: sessionId, agentOptions })
      return
    } catch (error: unknown) {
      if (!this.ownership.isActive()) return
      // A load is the per-id serialization barrier for eager write-behind and
      // lifecycle retirement. Only a genuinely absent artifact falls back to
      // first creation; corruption and backend failures stay loud.
      // 加载是“按 id 序列化”的屏障：只有真正缺失的工件才回落到首次创建。
      const exists = (await persistence.list()).some(header => header.id === sessionId)
      if (exists) throw error
    }
    this.create(sessionId, agentOptions, meta)
  }

  /** Wait for a draining same-id lifecycle to finish registry teardown. */
  // 等待“正在排空的同 id 生命周期”完成注册表拆除；健康存活者不等待（由下方 create/resume 自己暴露冲突）。
  private async waitForDrainingConfiguredIdentity(ownerCtx: Context, sessionId: SessionId): Promise<void> {
    // Only an id still occupying a registry needs waiting for; a live healthy
    // occupant is a collision the create/resume below will surface itself.
    if (ownerCtx.agents.get(sessionId) === undefined && ownerCtx.sessions.get(sessionId) === undefined) return

    // 监听 agent/disposed 与 session/disposed，两个注册表都清空即释放。
    const released = Promise.withResolvers<void>()
    const checkReleased = (): void => {
      if (ownerCtx.agents.get(sessionId) === undefined && ownerCtx.sessions.get(sessionId) === undefined) {
        released.resolve()
      }
    }
    const disposeAgentListener = ownerCtx.on('agent/disposed', () => { checkReleased() })
    const disposeSessionListener = ownerCtx.on('session/disposed', checkReleased)
    try {
      checkReleased()
      // 与工厂拆除赛跑：工厂先拆则直接放弃等待。
      await this.ownership.waitWhileActive(released.promise)
    } finally {
      disposeAgentListener()
      disposeSessionListener()
    }
  }

  /**
   * Construct the driver, scope, and one memoized reverse teardown for a new
   * agent. The teardown is registered with the factory and the owner fiber
   * BEFORE publication, so a mid-setup unload rolls everything back; `signal`
   * fuses caller cancellation with lifecycle teardown for setup awaits.
   */
  // 准备一个 agent：建驱动器/作用域/一份幂等反向拆除；拆除器在发布前就登记好，
  // 使“setup 中途卸载”也能完整回滚；signal 融合调用方取消与生命周期拆除。
  private prepare(ownerCtx: Context, id: SessionId, options: AgentOptions, session: Session, callerSignal?: AbortSignal): PreparedAgent {
    assertAgentOptions(options)
    ownerCtx.fiber.assertActive()
    // Every caller reaches prepare() synchronously from a service method
    // whose Cordis dispatch already requires the live factory fiber, or
    // re-checks ownership itself after its awaits (resume's load barrier).
    // 所有调用方要么同步来自已校验活纤维的服务方法，要么在 await 后自行复查（如 resume 的加载屏障），
    // 因此这里的活跃性复查只是不可达的兜底。
    /* v8 ignore next -- unreachable backstop, see above */
    if (!this.ownership.isActive()) throw new Error('agent loop is not active')
    if (callerSignal?.aborted) {
      throw callerSignal.reason instanceof Error
        ? callerSignal.reason
        : new Error(`agent "${id}" creation aborted`, { cause: callerSignal.reason })
    }
    const loopCtx = this.runtime.ctx

    // Deactivation fuses three owners, each with its own reason: the caller's
    // cancellation signal, the owner fiber's unload, and factory teardown.
    // It is registered BEFORE any resource exists, over mutable slots, so an
    // unload arriving while the scope is still minting finds a working
    // disposer instead of a leak.
    // 融合三路取消：调用方信号、owner 纤维卸载、工厂拆除。在任何资源存在之前就注册好，
    // 因此作用域还在铸造时到来的卸载也能找到可用的拆除器，不会泄漏。
    const abort = new AbortController()
    const onCallerAbort = (): void => {
      abort.abort(callerSignal?.reason instanceof Error
        ? callerSignal.reason
        : new Error(`agent "${id}" creation aborted`, { cause: callerSignal?.reason }))
    }
    const onFactoryTeardown = (): void => { abort.abort(this.ownership.signal.reason) }
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
    this.ownership.signal.addEventListener('abort', onFactoryTeardown, { once: true })

    // 可变槽位：机器/注册表注销/拆除承诺等，供稍后赋值的闭包共享。
    let machine: ReactLoopAgent | undefined
    let detachSession: (() => void) | undefined
    let detachAgent: (() => void) | undefined
    let disposing: Promise<void> | undefined
    // machineReady：机器构造完成信号；拆除发生在构造前时需先等它。
    const machineReady = Promise.withResolvers<void>()
    // Reverse teardown, memoized so every racing owner awaits one quiescence:
    // stop the machine, leave the registries, unwind the scope, release
    // bookkeeping.
    // 反向拆除（幂等）：停机器 → 离开注册表 → 拆作用域 → 释放登记；所有竞争的所有者共享一次收敛。
    const dispose = (ownerTriggered = false): Promise<void> => (disposing ??= (async () => {
      abort.abort(new Error(`agent "${id}" lifecycle disposed`))
      callerSignal?.removeEventListener('abort', onCallerAbort)
      this.ownership.signal.removeEventListener('abort', onFactoryTeardown)
      try {
        // Disposal IS a disposed-cause cancel followed by quiescence. New work
        // sent after this point is the sender's bug — the registries are about
        // to drop the agent, so nothing should still hold it.
        // 拆除本质是“disposed 原因的取消 + 收敛等待”；此后再投递工作是发送方的 bug。
        if (machine === undefined) await machineReady.promise
        if (machine !== undefined) {
          machine.cancel({ kind: 'disposed' })
          await machine.whenIdle()
          await machine.scope.dispose()
        }
      } finally {
        try {
          detachAgent?.()
          detachSession?.()
        } finally {
          untrack()
          if (!ownerTriggered) await unfollowOwner()
        }
      }
    })())
    // 先把拆除器登记进工厂所有权（防止工厂先拆时漏掉它）。
    const untrack = this.ownership.track(dispose)
    let unfollowOwner: () => Promise<void> | void
    try {
      // owner 纤维的拆除也走同一收敛边界；正在拆除自身时跳过“注销本 owner effect”这一步。
      unfollowOwner = ownerCtx.effect(() => () => {
        // Owner disposal owns the same quiescence boundary. Its teardown skips
        // unregistering this already-running owner effect from inside itself.
        if (disposing !== undefined) return
        abort.abort(new Error(`agent "${id}" setup aborted: owner disposed during setup`))
        return dispose(true)
      }, `agentLoop.lifecycle(${id})`)
      /* v8 ignore start -- ctx.effect throws only on an inactive fiber, which assertActive() above already rejected */
    } catch (error: unknown) {
      untrack()
      callerSignal?.removeEventListener('abort', onCallerAbort)
      this.ownership.signal.removeEventListener('abort', onFactoryTeardown)
      throw error
    }
    /* v8 ignore stop */

    // 每次生命周期检查点前的“活着”断言：任一融合来源已中止则抛对应错误。
    const assertLive = (): void => {
      if (!abort.signal.aborted) return
      // Every fused abort source carries an Error reason: onCallerAbort and
      // raceAbort wrap non-Error caller reasons, and the factory/lifecycle
      // owners abort with constructed Errors.
      // 所有融合来源都带 Error 原因，这里的 String() 分支只是不可达的兜底。
      /* v8 ignore next -- unreachable String() arm, see above */
      throw abort.signal.reason instanceof Error ? abort.signal.reason : new Error(String(abort.signal.reason))
    }
    try {
      // 构造驱动器（ReactLoopAgent 完成作用域/收件箱/投影的搭建）。
      const agent = machine = new ReactLoopAgent(loopCtx, id, options, session)
      machineReady.resolve()
      assertLive()

      return {
        agent,
        signal: abort.signal,
        publish: (source) => {
          // 发布：进入 sessions/agents 注册表 → announce → 通知 session-start → 返回句柄。
          // 每个检查点之间都做 liveness 复查：同步监听器可能已启动拆除，机器已可投递，只欠复查。
          assertLive()
          detachSession = agent.ctx.sessions.enter(session)
          detachAgent = loopCtx.agents.enter(agent, ownerCtx.agent)
          agent.ctx.sessions.announce(session)
          assertLive()
          loopCtx.agents.announce(agent)
          assertLive()
          // A synchronous announce/session-start listener may have started
          // teardown; the machine is already live (delivery works from the
          // session-start extension point), so only the liveness recheck is owed.
          emitAgentEvent(loopCtx, agent, 'agent/session-start', { source })
          assertLive()
          return { agent, dispose }
        },
        dispose,
      }
    } catch (error: unknown) {
      machineReady.resolve()
      void dispose()
      throw error
    }
  }

  /**
   * Create an agent and session under one caller-supplied identity, owned by
   * the accessing fiber. Constructor-driven config calls mint a fresh combined
   * id before entering this boundary.
   * @param id - shared agent/session identity.
   * @param options - concrete loop options.
   * @param meta - optional fresh-session workspace metadata.
   * @returns the published running agent.
   */
  // 同步创建入口（构造期配置与简单宿主使用）：建会话 → prepare → publish，失败则回滚拆除。
  create(id: SessionId, options: AgentOptions = {}, meta: Pick<SessionHeader, 'cwd'> = {}): Agent {
    using preparation = SessionPreparation.create(this.runtime.ctx.sessions.prepare(id, { meta }))
    const prepared = this.prepare(this.ctx, id, options, preparation.session)
    try {
      return prepared.publish('startup').agent
    } catch (error: unknown) {
      void prepared.dispose()
      throw error
    }
  }

  /**
   * Create an owned agent on a caller-supplied session id.
   * @param ownerCtx - caller context that structurally owns the lifecycle.
   * @param options - identities, session seed/metadata, loop options, setup, and cancellation.
   * @returns the published handle.
   */
  // 异步创建入口（AgentFactory 契约）：按调用方身份建会话 → setup → 发布；延续登记进工厂所有权。
  async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
    const preparation = SessionPreparation.create(this.runtime.ctx.sessions.prepare(options.sessionId, {
      ...options.seed === undefined ? {} : { seed: options.seed },
      ...options.meta === undefined ? {} : { meta: options.meta },
    }))
    const published = this.setupAndPublish(
      ownerCtx,
      options.sessionId,
      preparation,
      options.agentOptions ?? {},
      options.setup,
      options.signal,
      'startup',
    )
    this.ownership.trackWrapper(published)
    return published
  }

  /** Prepare one Agent around an acquired Session, run setup, and publish it. */
  // 围绕已取得的会话准备 agent：prepare → 跑 setup（可带同步 commit）→ 发布；失败回滚拆除。
  private async setupAndPublish(
    ownerCtx: Context,
    id: SessionId,
    preparation: SessionPreparation,
    agentOptions: AgentOptions,
    setup: AgentSetup | undefined,
    signal: AbortSignal | undefined,
    source: SessionStartSource,
  ): Promise<AgentHandle> {
    using ownedPreparation = preparation
    const session = ownedPreparation.session
    const prepared = this.prepare(ownerCtx, id, agentOptions, session, signal)
    try {
      const setupCommit = await raceAbort(setup?.(prepared.agent.ctx), prepared.signal, id)
      setupCommit?.commit()
      return prepared.publish(source)
    } catch (error: unknown) {
      await prepared.dispose()
      throw error
    }
  }

  /**
   * Resume an owned agent from the configured persistence service.
   * @param ownerCtx - caller context that owns load, setup, and the live lifecycle.
   * @param options - persisted identity, loop options, setup, and cancellation.
   * @returns the published handle.
   */
  // 公开恢复入口：从配置好的持久化服务加载会话并恢复 agent。
  async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
    const persistence = this.runtime.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      throw new Error('cannot resume: session persistence is not configured (load a dsh-session-persistence backend)')
    }
    return this.resumeWith(ownerCtx, persistence, options)
  }

  /** Resume through an explicit persistence handle used by the deferred config path. */
  // 恢复的实现主体：加载与 owner 生命周期赛跑（防止永不返回的后端钉死身份），加载完成后走 setupAndPublish。
  private resumeWith(
    ownerCtx: Context,
    persistence: SessionPersistence,
    options: ResumeAgentOptions,
  ): Promise<AgentHandle> {
    const id = options.resumeSessionId
    const published = (async () => {
      // The load may outlive its owner: race it against caller cancellation,
      // owner-fiber unload, and factory teardown so a never-settling backend
      // cannot pin the identity.
      // 加载可能比 owner 活得久：与调用方取消、owner 卸载、工厂拆除三方赛跑，
      // 永不结算的后端也无法钉死该身份。
      const ownerAbort = new AbortController()
      const unfollowOwner = ownerCtx.effect(() => () => {
        ownerAbort.abort(new Error(`agent "${id}" setup aborted: owner disposed during setup`))
      }, `agentLoop.resume-load(${id})`)
      const fused = AbortSignal.any([
        ...options.signal === undefined ? [] : [options.signal],
        ownerAbort.signal,
        this.ownership.signal,
      ])
      let preparation: SessionPreparation | undefined
      try {
        try {
          // 持久化加载本身可中止：取消后到达的结果会被释放（丢弃迟到会话准备）。
          preparation = await raceAbortCall(
            () => persistence.prepare(id, fused),
            fused,
            id,
            (abandoned) => { abandoned[Symbol.dispose]() },
          )
        } finally {
          await unfollowOwner()
        }
        // 加载完成后复查：owner 纤维必须仍活跃、工厂必须仍接受。
        ownerCtx.fiber.assertActive()
        if (!this.ownership.isActive()) throw new Error('agent loop is not active')
        return await this.setupAndPublish(
          ownerCtx,
          id,
          preparation,
          options.agentOptions ?? {},
          options.setup,
          options.signal,
          'resume',
        )
      } finally {
        preparation?.[Symbol.dispose]()
      }
    })()
    this.ownership.trackWrapper(published)
    return published
  }
}

export default AgentLoop
