/*
 * ================================ 文件注释 ================================
 * 【文件职责】lsp-stdio 包入口：把 cordis.yml 配置的"提供者 id → 本地语言服务器命令表"注册为 ctx.lsp 上的多个独立提供者；每个提供者按规范化工作区懒启动并池化服务器进程。同时 re-export 主机、帧、翻译、实例、连接等公共 API。
 * 【技术维度】命名空间插件（命名导出、无默认导出）；schemastery 解析配置并填充默认值；启动时先用
 *   ctx.subprocess.resolveExecutable 解析可执行文件（含凭据擦洗）再发布提供者；进程池与查询队列在
 *   LocalLspProvider 内按工作区键管理。
 * 【产品维度】让任意本机 LSP 服务器接入"代码语义查询"能力：模型查询跳转定义、引用、实现、悬停时，由本包拉起对应服务器进程并复用。
 * 【逻辑维度】re-export 公共 API → 配置类型与 schemastery 校验 → 校验辅助（assertTimer/
 *   assertPositiveInteger）→ apply 插件入口（解析可执行文件、注册提供者、卸载时反注册并销毁）→
 *   LocalLspProvider 池化提供者（查询队列、实例生命周期）。
 * 【关键边界】配置为空抛错；所有服务器可执行文件须先解析成功才发布任何提供者（全部或全不）；每工作区一个进程、查询串行；传输失败自动替换一次并重试；卸载先移除路由再销毁进程。
 * 【新手阅读建议】先读 apply 理解插件装配顺序，再读 LocalLspProvider.query 理解"读源码 → 开文档 → 查询 → 关文档"的完整链路。
 * ==========================================================================
 */
/**
 * Generic stdio language-server backend for `ctx.lsp`. One plugin instance configures a named table
 * of server commands and registers one isolated provider for each entry. Every provider lazily
 * single-flights one server process per canonical workspace target, serves transient-open queries
 * through it, and replaces a selected transport that fails before or during the next read-only
 * query. Providers read sources through `ctx.fs` and launch servers through
 * `ctx.subprocess`, so both local and remote implementations share one host.
 *
 * Namespace plugin (named exports, no default export). Lifecycle is effect-scoped: disposal
 * unregisters from `ctx.lsp` and tears down every live server.
 * @module @deepseek-ai/dsh-lsp-stdio
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LspError, LspProviderId } from '@deepseek-ai/dsh-lsp'
import type {
  LspProvider,
  LspProviderQuery,
  LspQueryResult,
} from '@deepseek-ai/dsh-lsp'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { abortable, abortError } from './abort.ts'
import { canonicalizeWorkspace, readHostSource } from './host.ts'
import type { HostWorkspace } from './host.ts'
import { LspInstance } from './instance.ts'
import type { ConnectionSpawner } from './connection.ts'
import type { InstanceSpec } from './instance.ts'

export { canonicalizeWorkspace, readHostSource } from './host.ts'
export { encodeMessage, MessageDecoder } from './framing.ts'
export {
  negotiatePositionEncoding,
  normalizeHover,
  normalizeLocations,
  requestMethod,
  supportsOperation,
  supportsTransientOpen,
} from './translate.ts'
export { LspInstance } from './instance.ts'
export { LspConnection } from './connection.ts'

/** Cordis plugin name for loader diagnostics. */
// 插件名：供加载器诊断使用。
export const name = 'lsp-stdio'

/** Services required by this plugin. */
// 依赖注入声明：需要 fs、lsp、subprocess 三个服务就绪。
export const inject = ['fs', 'lsp', 'subprocess']

// 默认值：单条帧消息上限 16 MB（防御恶意服务器）。
const DEFAULT_MAX_MESSAGE_BYTES = 16_000_000
// 默认值：stderr 诊断尾部上限 1 MB。
const DEFAULT_MAX_STDERR_BYTES = 1_000_000
// 默认值：单个源码文档大小上限 4 MB。
const DEFAULT_MAX_DOCUMENT_BYTES = 4_000_000
// 默认值：优雅关闭预算 5 秒。
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000
// 默认值：SIGTERM 后到 SIGKILL 的宽限 2 秒。
const DEFAULT_KILL_GRACE_MS = 2_000

/** One configured local language server and its host bounds. */
// 一个已配置的本地语言服务器及其宿主边界参数。
export interface LspLocalServerConfig {
  /** Executable to spawn (absolute, or resolved on PATH at load). */
  // 要拉起的可执行文件（绝对路径，或在加载时按 PATH 解析）。
  command: string
  /** Lowercase leading-dot extension → LSP language id (e.g. `{ '.ts': 'typescript' }`). */
  // 小写前导点扩展名 → LSP 语言 id（如 { '.ts': 'typescript' }）。
  extensionToLanguage: Record<string, string>
  /** Arguments passed to the executable (no shell). Default `[]`. */
  // 传给可执行文件的参数（不经 shell）。默认 []。
  args?: string[]
  /** Extra env vars merged on top of the scrubbed ambient env. Default `{}`. */
  // 在擦洗后的环境之上合并的额外环境变量。默认 {}。
  env?: Record<string, string>
  /** Static `initialize` options forwarded to the server. Default `null`. */
  // 静态 initialize 选项，转发给服务器。默认 null。
  initializationOptions?: unknown
  /** Static answer to every `workspace/configuration` item. Default `null`. */
  // 对每个 workspace/configuration 项的静态回答。默认 null。
  configuration?: unknown
  /** Largest single framed message accepted from the server (bytes). Default 16000000. */
  // 从服务器接受的最大单条帧消息字节数。默认 16000000。
  maxMessageBytes?: number
  /** Largest stderr tail retained for diagnostics (bytes). Default 1000000. */
  // 为诊断保留的最大 stderr 尾部字节数。默认 1000000。
  maxStderrBytes?: number
  /** Largest source file this host will open (bytes). Default 4000000. */
  // 本宿主会打开的最大源文件字节数。默认 4000000。
  maxDocumentBytes?: number
  /** Graceful `shutdown`/`exit` budget before escalation (ms). Default 5000. */
  // 优雅 shutdown/exit 的预算（毫秒），超时升级强杀。默认 5000。
  shutdownTimeoutMs?: number
  /** Request-cancel and SIGTERM→SIGKILL grace (ms). Default 2000. */
  // 请求取消与 SIGTERM→SIGKILL 的宽限（毫秒）。默认 2000。
  killGraceMs?: number
}

/** Plugin configuration: provider id → local language-server configuration. */
// 插件配置：提供者 id → 本地语言服务器配置。
export interface Config {
  /** Non-empty table of stable provider ids to independent local server configurations. */
  // 非空表：稳定提供者 id 映射到相互独立的本地服务器配置。
  servers: Record<string, LspLocalServerConfig>
}

/** One server config after schemastery fills every default. */
// schemastery 填充全部默认值后的服务器配置（全部字段必填）。
type ResolvedServerConfig = Required<LspLocalServerConfig>
// 工作区键：作为进程池与查询队列的稳定身份。
type WorkspaceKey = HostWorkspace['target']['targetKey']

// LspLocalServerConfig 的 schemastery 校验器：声明字段类型并填入默认值；非法配置在加载时即报错。
const LspLocalServerConfig: z<LspLocalServerConfig> = z.object({
  command: z.string().required(),
  args: z.array(String).default([]),
  env: z.dict(String).default({}),
  extensionToLanguage: z.dict(String).required(),
  initializationOptions: z.any().default(null),
  configuration: z.any().default(null),
  maxMessageBytes: z.number().default(DEFAULT_MAX_MESSAGE_BYTES),
  maxStderrBytes: z.number().default(DEFAULT_MAX_STDERR_BYTES),
  maxDocumentBytes: z.number().default(DEFAULT_MAX_DOCUMENT_BYTES),
  shutdownTimeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
  killGraceMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_KILL_GRACE_MS),
})

// 插件级配置校验器：servers 表必填。
export const Config: z<Config> = z.object({
  servers: z.dict(LspLocalServerConfig).required(),
})

/** Propagate teardown failures only after every sibling has settled. */
// 汇总拆卸结果：等所有兄弟任务都落定后传播失败（单失败抛原错误，多失败聚合为 AggregateError）。
function throwTeardownFailures(results: readonly PromiseSettledResult<void>[], message: string): void {
  const failures: unknown[] = []
  for (const result of results) {
    if (result.status === 'rejected') failures.push(result.reason)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, message)
}

/**
 * Register the configured stdio LSP providers. Resolves every executable at load (after credential
 * scrubbing) before publishing any provider; each process launches lazily on its first matching
 * query.
 * @param ctx - the plugin context carrying `fs`, `lsp`, and `subprocess`.
 * @param config - the resolved plugin configuration (schemastery has filled every default).
 */
// 插件入口：加载时（凭据擦洗后）解析全部可执行文件，再发布任何提供者；每个服务器进程在首个匹配查询时才懒启动。
export async function apply(ctx: Context, config: Config): Promise<void> {
  // 服务器表转成条目数组；空表直接报错（配置不允许为空）。
  const entries = Object.entries(config.servers)
  if (entries.length === 0) throw new Error('lsp-stdio: servers must contain at least one server')

  // 设置阶段的取消控制器：插件回调被卸载时用它中止仍在进行的解析。
  const setupAbort = new AbortController()
  const stopSetupCancellation = ctx.on('internal/plugin', (fiber) => {
    // An async plugin callback must observe its own disposal before Cordis can
    // run effect cleanup, because unload otherwise waits for this callback.
    // 异步插件回调必须在自己被卸载前观察到，否则卸载会一直等待该回调而无法执行 effect 清理。
    if (fiber === ctx.fiber && fiber.uid === null) {
      setupAbort.abort(new Error('lsp-stdio setup disposed'))
    }
  })

  // Resolve every server-local setting before registration so a bad later command or bound cannot
  // publish an earlier provider. Registry-level mapping conflicts are rolled back below.
  // 注册前解析所有服务器本地设置：后项的命令或边界错误不会让前面的提供者已发布（全部或全无）；注册级映射冲突在下方回滚。
  const providers = await (async () => {
    const lookups = entries.map(async ([providerId, rawConfig]) => {
      // 提供者 id 不能为空字符串。
      if (providerId.trim() === '') throw new Error('lsp-stdio: server ids must be non-empty strings')
      // schemastery 已填默认值，这里强转为必填形状。
      const resolved = rawConfig as ResolvedServerConfig
      validateServerConfig(providerId, resolved)
      // 解析可执行文件（经 subprocess 缝的凭据擦洗与 PATH 解析）。
      const executable = await ctx.subprocess.resolveExecutable(
        resolved.command,
        resolved.env,
        setupAbort.signal,
      )
      setupAbort.signal.throwIfAborted()
      // 每个配置项对应一个独立提供者，进程由 spawner（ctx.subprocess.spawn）按需拉起。
      return new LocalLspProvider(
        providerId,
        ctx.fs,
        resolved,
        executable,
        spec => ctx.subprocess.spawn(spec),
      )
    })
    try {
      return await Promise.all(lookups)
    } catch (error: unknown) {
      // 任一解析失败：中止其余、等它们全部落定后抛出原始错误。
      setupAbort.abort(error)
      await Promise.allSettled(lookups)
      throw error
    } finally {
      stopSetupCancellation()
    }
  })()

  // 注册全部提供者；卸载时先反注册路由再销毁进程（新查询不得进入排空中的提供者）。
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      for (const provider of providers) disposers.push(ctx.lsp.registerProvider(provider))
    } catch (error) {
      // 注册中途失败：逆序回滚已注册的部分。
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return async () => {
      // Remove every route before process teardown so no new query can enter a draining provider.
      // 先移除全部路由再做进程拆卸，让新查询无法进入排空中的提供者。
      for (const dispose of disposers.reverse()) dispose()
      const results = await Promise.allSettled(providers.map(provider => provider.disposeAll()))
      throwTeardownFailures(results, 'lsp-stdio provider teardown failed')
    }
  }, 'lsp-stdio.registerProviders')
}

/** Validate one resolved server entry before any provider in the table is registered. */
// 在注册任何提供者之前校验一个已解析的服务器条目。
function validateServerConfig(providerId: string, resolved: ResolvedServerConfig): void {
  // Teardown budgets feed `deadline()`, whose `<= 0` is the internal no-timeout sentinel; a
  // nonpositive value would let a server that ignores shutdown hang disposal forever. Fail at load.
  // 拆卸预算喂给 deadline()，其 <= 0 是"无超时"的内部哨兵：非正数会让无视 shutdown 的服务器永久卡死拆卸，因此在加载时拒绝。
  assertTimer(providerId, 'shutdownTimeoutMs', resolved.shutdownTimeoutMs)
  assertTimer(providerId, 'killGraceMs', resolved.killGraceMs)
  // Byte caps must be positive: a nonpositive stderr cap defeats the retained-tail bound
  // (`slice(-0)` keeps everything), `maxMessageBytes: 0` makes every response fatal, and a bad
  // document cap fails later in the read path instead of at load.
  // 字节上限必须为正：非正的 stderr 上限会使保留尾部约束失效（slice(-0) 保留全部），maxMessageBytes 为 0 会让每个响应都致命，错误的文档上限则会拖到读取路径才失败。
  assertPositiveInteger(providerId, 'maxStderrBytes', resolved.maxStderrBytes)
  assertPositiveInteger(providerId, 'maxMessageBytes', resolved.maxMessageBytes)
  assertPositiveInteger(providerId, 'maxDocumentBytes', resolved.maxDocumentBytes)
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
// 拒绝 Node 会"钳制"而非按配置调度的定时器值（必须为正整数且不超过 MAX_TIMER_DELAY_MS）。
function assertTimer(providerId: string, name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`lsp-stdio: servers.${providerId}.${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** Reject a nonpositive or non-integer config value at load, so misconfiguration fails loud. */
// 在加载时拒绝非正数或非整数的配置值，让错误配置大声失败。
function assertPositiveInteger(providerId: string, name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`lsp-stdio: servers.${providerId}.${name} must be a positive integer`)
  }
}

/** A pooled generic provider: one server process per canonical workspace, created on demand. */
// 池化通用提供者：每个规范化工作区一个服务器进程，按需创建。
class LocalLspProvider implements LspProvider {
  readonly id: LspProviderId
  readonly extensionToLanguage: Readonly<Record<string, string>>
  /** One live instance per stable canonical workspace identity. */
  // 每个稳定规范化工作区身份对应一个存活实例。
  private readonly instances = new Map<WorkspaceKey, LspInstance>()
  /** One complete source-read→open→query→close serialization tail per canonical workspace. */
  // 每个规范化工作区一条完整的"读源码→打开→查询→关闭"串行化队列尾。
  private readonly queues = new Map<WorkspaceKey, Promise<void>>()
  /** Workspace canonicalizations that have not entered a provider-owned queue yet. */
  // 尚未进入提供者队列的工作区规范化操作集合（用于在拆卸时一并等待）。
  private readonly workspaceLookups = new Set<Promise<void>>()
  // 提供者生命周期取消控制器：拆卸时中止所有进行中的工作。
  private readonly lifetime = new AbortController()
  // 已拆卸标记：置位后拒绝新查询。
  private disposed = false

  constructor(
    providerId: string,
    private readonly fs: Context['fs'],
    private readonly config: ResolvedServerConfig,
    private readonly executable: string,
    private readonly spawner: ConnectionSpawner,
  ) {
    this.id = LspProviderId(providerId)
    this.extensionToLanguage = config.extensionToLanguage
  }

  /** Read the disposed flag through a method so a `query()` await cannot narrow it to a literal. */
  // 通过方法读取拆卸标记：防止 query() 的 await 把它收窄成字面量（避免误判）。
  private isDisposed(): boolean {
    return this.disposed
  }

  /** Reject work that cannot publish or use a provider-owned instance. */
  // 拒绝无法发布或使用提供者实例的工作：已拆卸或信号已中止时抛错。
  private assertActive(signal?: AbortSignal): void {
    /* v8 ignore next -- the seam unregisters this provider before disposal; direct in-flight calls
       exercise the post-await check instead. */
    if (this.isDisposed()) throw new LspError('lsp-stdio provider is disposed', 'LSP_DISPOSED')
    if (signal?.aborted) throw abortError(signal)
  }

  /** Fuse caller cancellation with provider disposal for every filesystem and protocol await. */
  // 融合调用方取消与提供者拆卸：返回的信号在任一者触发时都会中止，供文件系统与协议等待使用。
  private querySignal(signal?: AbortSignal): AbortSignal {
    return signal === undefined
      ? this.lifetime.signal
      : AbortSignal.any([signal, this.lifetime.signal])
  }

  async query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult> {
    // Honor an already-aborted signal before provider I/O so a canceled request never starts a server.
    // 先响应已触发的中止信号再做任何提供者 I/O，让被取消的请求永远不会拉起服务器。
    this.assertActive(signal)
    const querySignal = this.querySignal(signal)
    // 规范化工作区（在队列外进行，避免长 I/O 阻塞队列）。
    const workspaceResult = canonicalizeWorkspace(this.fs, request.workspaceRoot, querySignal)
    const workspaceLookup = workspaceResult.then(() => undefined, () => undefined)
    this.workspaceLookups.add(workspaceLookup)
    let workspace: HostWorkspace
    try {
      workspace = await workspaceResult
    } finally {
      this.workspaceLookups.delete(workspaceLookup)
    }
    this.assertActive(querySignal)
    const workspaceKey = workspace.target.targetKey
    // 进入该工作区的串行队列执行完整查询生命周期。
    return this.enqueue(workspaceKey, querySignal, async () => {
      this.assertActive(querySignal)
      // Read inside the workspace queue but before spawning: a queued query sees current bytes when
      // its turn starts, while an invalid source still cannot leave an idle process pooled.
      // 在工作区队列内、拉起进程之前读源码：轮到执行时读到的是最新字节，而非法源码不会留下空闲进程被池化。
      const source = await readHostSource(this.fs, request.filePath, workspace, this.config.maxDocumentBytes, querySignal)
      // Disposal may have snapshotted the instance map while host I/O was pending. Re-check before a
      // synchronous get-or-create so every spawned process remains owned by teardown.
      // 主机 I/O 期间拆卸可能已快照过实例表：在同步 get-or-create 之前复查一次，保证每个拉起的进程仍归拆卸流程所有。
      this.assertActive(querySignal)
      let instance = this.instanceFor(workspaceKey, workspace)
      try {
        return await instance.query(request, source, querySignal)
      } catch (error) {
        // A selected child can have died while idle or fail during the next write. Queries are
        // read-only, so replace that transport once and retry transparently.
        // 选中的子进程可能在空闲时死亡或在下次写入时失败。查询只读，因此替换一次传输并透明重试。
        if (!instance.isTransportFailure(error)) throw error
        await instance.dispose()
        this.evictIfCurrent(workspaceKey, instance)
        this.assertActive(querySignal)
        instance = this.instanceFor(workspaceKey, workspace)
        return await instance.query(request, source, querySignal)
      } finally {
        // Reach quiescence before dropping a dead slot; a replacement must survive this ownership check.
        // 先达到静默再丢弃死槽；替换实例必须通过此所有权检查才能存活。
        if (instance.dead) {
          await instance.dispose()
          this.evictIfCurrent(workspaceKey, instance)
        }
      }
    })
  }

  /** Serialize one complete query lifecycle for a canonical workspace. */
  // 为规范化工作区串行化一次完整查询生命周期：排队等待前序、执行 run。
  private enqueue<T>(workspace: WorkspaceKey, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    // 前一个任务的队列尾（没有则立即开始）。
    const previous = this.queues.get(workspace) ?? Promise.resolve()
    // 等待前序（可被取消）后执行本次任务。
    const result = abortable(previous, signal).then(run)
    // The tail follows the actual prior work even when this caller aborts its wait. It never rejects,
    // so later callers serialize without inheriting an earlier query's outcome.
    // 队列尾跟随真实的前序工作（即使调用方放弃了等待）；它永不拒绝，因此后续调用方串行时不会继承前一个查询的结果。
    const tail = previous.then(() => result).then(() => undefined, () => undefined)
    this.queues.set(workspace, tail)
    // 队列尾一旦完成且仍是最新尾，就从表中移除（避免泄漏）。
    void tail.then(() => {
      if (this.queues.get(workspace) === tail) this.queues.delete(workspace)
    })
    return result
  }

  /** Return or synchronously publish the one instance for a canonical workspace. */
  // 返回（或同步发布）一个规范化工作区的唯一实例：存在即复用，否则创建并登记。
  private instanceFor(workspaceKey: WorkspaceKey, workspace: HostWorkspace): LspInstance {
    this.assertActive()
    const existing = this.instances.get(workspaceKey)
    if (existing !== undefined) return existing
    const created = this.createInstance(workspace)
    this.instances.set(workspaceKey, created)
    return created
  }

  /** Drop the slot iff it still contains this instance. */
  // 仅当槽位仍指向该实例时才删除它（防止误删已被替换的实例）。
  private evictIfCurrent(workspace: WorkspaceKey, instance: LspInstance): void {
    /* v8 ignore next -- mismatch requires another query to replace the slot before this finally runs. */
    if (this.instances.get(workspace) === instance) this.instances.delete(workspace)
  }

  // 按已解析配置创建实例规格并构造 LspInstance。
  private createInstance(workspace: HostWorkspace): LspInstance {
    const spec: InstanceSpec = {
      command: this.executable,
      args: this.config.args,
      cwd: workspace.canonicalPath,
      workspaceUri: workspace.fileUrl,
      env: this.config.env,
      configuration: this.config.configuration,
      initializationOptions: this.config.initializationOptions,
      maxMessageBytes: this.config.maxMessageBytes,
      maxStderrBytes: this.config.maxStderrBytes,
      shutdownTimeoutMs: this.config.shutdownTimeoutMs,
      killGraceMs: this.config.killGraceMs,
    }
    return new LspInstance(spec, this.spawner)
  }

  /** Dispose every live instance and block further queries. */
  // 销毁所有存活实例并阻止后续查询：置拆卸标记、中止生命周期信号、快照并清空实例表、等待全部落定后汇总失败。
  async disposeAll(): Promise<void> {
    this.disposed = true
    this.lifetime.abort(new LspError('lsp-stdio provider is disposed', 'LSP_DISPOSED'))
    // 快照存活实例、排空中的队列与进行中的工作区规范化。
    const live = [...this.instances.values()]
    const draining = [...this.queues.values()]
    const resolving = [...this.workspaceLookups]
    this.instances.clear()
    const results = await Promise.allSettled([
      ...live.map(instance => instance.dispose()),
      ...draining,
      ...resolving,
    ])
    this.queues.clear()
    this.workspaceLookups.clear()
    throwTeardownFailures(results, 'lsp-stdio instance teardown failed')
  }
}
