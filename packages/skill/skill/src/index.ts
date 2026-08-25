/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是"代理技能"能力 seam 的 Service Definition：ctx.skills 技能注册表。
 *             它合并各提供方（如 skill-filesystem）的目录、按名字选出获胜技能、并向消费方
 *             暴露排序后的摘要与按需加载的完整技能定义。
 * 【技术维度】继承 Cordis Service；按 scope 分层（ScopedLayers）管理提供者与运行时技能；
 *             rank 决定层内同名技能的优先级；目录收集带版本号缓存与并发修订重试；
 *             加载结果与提供者输入都做严格校验。
 * 【产品维度】模型或用户在任何时候都能列出/加载"当前可用技能"；提供方可插拔，
 *             同名技能按优先级收敛出唯一获胜者，保证行为可预期。
 * 【逻辑维度】常量与类型词汇 → 渲染/转义辅助 → 提供者接口与控制 → SkillLayer 层类 →
 *             SkillRegistry 注册表类（注册/列出/快照/加载/收集/失效）→ 校验与排序辅助函数。
 * 【关键边界】同名技能在同一层内由 rank（数值越小越优先）决定，跨层由"最近层获胜"；
 *             收集期间发生并发修订时最多重试 MAX_COLLECT_ATTEMPTS 次，否则标记不完整；
 *             不完整观测绝不缓存，消费方可保留上次良好状态并在下个请求边界重试。
 * 【新手阅读建议】先读 SkillRegistry 的 register/list/get 三个公开方法，再读 collect 系列
 *             私有方法理解缓存与分层，最后看 renderSkillContent 了解技能呈现。
 * ==========================================================================
 */
/**
 * Agent skill provider registry.
 *
 * This package owns the Service Definition role of the skill capability seam.
 * Concrete
 * providers such as `@deepseek-ai/dsh-skill-filesystem` decide where skills come
 * from; this service only merges provider catalogs, resolves the winning skill
 * for a name, and exposes the winning summaries and definitions to consumers.
 *
 * @module @deepseek-ai/dsh-skill
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { assertNever } from '@deepseek-ai/dsh-llm'
import { NamedEntries, ScopedLayers, scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import type { ScopeKey, ScopeLayer } from '@deepseek-ai/dsh-scope'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

// 技能名的公共文法：小写字母/数字开头，可由连字符连接的多个小写片段组成。
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// 收集缓存默认最多保留的条目数。
const DEFAULT_COLLECT_CACHE_ENTRIES = 128
// 收集期间若发生并发修订，最多重试的次数。
const MAX_COLLECT_ATTEMPTS = 2
// 运行时技能（register() 直接注入的）使用的保留提供者名。
const RUNTIME_PROVIDER = 'runtime'
// 运行时技能使用的保留优先级。
const RUNTIME_RANK = 250

/** Standard precedence rank for packaged skill providers and local bundled roots. */
// 打包技能提供者与本地捆绑根的标准化优先级。
export const BUNDLED_SKILL_RANK = 600

/**
 * Return whether a string is a valid kebab-case skill name.
 * @param name - candidate skill name to validate.
 * @returns whether the name matches the public skill-name grammar.
 */
// 判断字符串是否为合法的 kebab-case 技能名（用于地址寻址）。
export function isSkillName(name: string): boolean {
  return SKILL_NAME.test(name)
}

/** Origin bucket for a skill contribution. The value is prompt-visible metadata, not precedence by itself. */
// 技能贡献的来源分桶。该值是对模型可见的元数据，本身不代表优先级。
export type SkillSource = 'project-dsh' | 'project-agents' | 'runtime' | 'user-dsh' | 'user-agents' | 'custom' | 'bundled' | (string & {})

/** Optional provider-specific base used by loaded skill bodies to resolve relative resources. */
// 可选的提供方特定基准：已加载的技能正文用它解析相对资源。
export type SkillResourceBase =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'opaque'; readonly description: string }

/** Invocation controls shared by skill discovery consumers. */
// 技能发现消费方共享的调用控制。
export interface SkillInvocationPolicy {
  /** Whether model-facing catalogs and loaders include this skill. */
  // 面向模型的目录与加载器是否包含该技能。
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs and loaders include this skill. */
  // 面向人类的命令目录与加载器是否包含该技能。
  readonly userInvocable: boolean
}

/** Invocation-neutral skill metadata returned by `ctx.skills.list()`. */
// ctx.skills.list() 返回的、与调用方式无关的技能元数据。
export interface SkillSummary {
  /** Kebab-case identifier used to address the skill. */
  // 用于寻址技能的 kebab-case 标识符。
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  // 供发现消费方展示的简短路由描述。
  readonly description: string
  /** Optional extra routing guidance. */
  // 可选的额外路由指引。
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  // 解析后的模型/用户调用控制。
  readonly invocation: SkillInvocationPolicy
  /** Discovery source that produced this winning skill. */
  // 产出该获胜技能的发现来源。
  readonly source: SkillSource
  /** Provider that owns this skill body. */
  // 拥有该技能正文的提供方。
  readonly provider: string
  /** Provider-specific base for relative resources. */
  // 提供方特定的相对资源基准。
  readonly resourceBase?: SkillResourceBase
}

/** Provider catalog entry used by the registry to merge and later load skills. */
// 注册表用于合并目录、随后加载技能的提供方目录条目。
export interface SkillCandidate extends SkillSummary {
  /** Lower ranks win duplicate skill names before provider registration order is considered. */
  // 处理同名技能时数值更小的 rank 获胜；之后才看提供者注册顺序。
  readonly rank: number
  /** Opaque provider-owned handle passed back to `provider.get()`. */
  // 提供方持有的不透明句柄，会原样传回 provider.get()。
  readonly locator: unknown
  /** Absolute file path when the provider has one. */
  // 提供方有绝对文件路径时给出。
  readonly path?: string
  /** Parsed optional metadata object from provider-specific skill frontmatter. */
  // 从提供方特定的技能 frontmatter 解析出的可选元数据对象。
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Complete parsed skill definition, including the body loaded by `ctx.skills.get()`. */
// 完整解析后的技能定义，含 ctx.skills.get() 加载出的正文。
export interface SkillDefinition extends SkillSummary {
  /** Markdown instruction body after any provider-specific metadata removal. */
  // 去除提供方特定元数据后的 Markdown 指令正文。
  readonly content: string
  /** Absolute file path when the skill came from disk. */
  // 技能来自磁盘时的绝对文件路径。
  readonly path?: string
  /** Parsed optional metadata object from frontmatter. */
  // 从 frontmatter 解析出的可选元数据对象。
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Runtime skill contribution accepted by `ctx.skills.register()`. */
// ctx.skills.register() 接受的运行时技能贡献。
export type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
  /** Invocation controls; omission permits both model and user surfaces. */
  // 调用控制；省略时模型与用户两种入口都开放。
  readonly invocation?: SkillInvocationPolicy
  /** Provider label; omission uses the registry-owned runtime provider. */
  // 提供方标签；省略时使用注册表自有的 runtime 提供方。
  readonly provider?: string
}

/** Caller context used for cwd-sensitive and abortable provider work. */
// 供"对 cwd 敏感、可中止"的提供方工作使用的调用方上下文。
export interface SkillLookupOptions {
  /** Workspace selector for the current lookup. */
  // 当前查找的工作区选择器。
  readonly cwd?: string | undefined
  /** Abort discovery or loading work for the current caller. */
  // 为当前调用方中止发现或加载工作。
  readonly signal?: AbortSignal | undefined
}

/**
 * Registry read options: provider lookup context plus the viewing scope.
 * The registry consumes `scope` to select layers; providers receive the same
 * borrowed options object and read only their {@link SkillLookupOptions}
 * contract from it.
 */
// 注册表读选项：提供方查找上下文加查看作用域。注册表消费 scope 来选择分层；
// 提供方收到同一个借出的选项对象，只读取其中的 SkillLookupOptions 契约部分。
export interface SkillViewOptions extends SkillLookupOptions {
  /** Viewing scope (the calling agent); omitted reads the global layer alone. */
  // 查看作用域（即调用代理）；省略时只读全局层。
  readonly scope?: ScopeKey | undefined
}

/**
 * Return whether a skill may be advertised to and loaded by a model.
 * @param skill - skill metadata carrying resolved invocation controls.
 * @returns whether the policy permits model invocation.
 */
// 判断技能是否可被模型广告与加载。
export function isModelInvocable(skill: Pick<SkillSummary, 'invocation'>): boolean {
  return skill.invocation.modelInvocable
}

/**
 * Return whether a skill may be advertised to and loaded by a human-facing command.
 * @param skill - skill metadata carrying resolved invocation controls.
 * @returns whether the policy permits user invocation.
 */
// 判断技能是否可被面向人类的命令广告与加载。
export function isUserInvocable(skill: Pick<SkillSummary, 'invocation'>): boolean {
  return skill.invocation.userInvocable
}

/**
 * Durable source for the context message a user-explicit skill invocation
 * injects: the user's own words ride a plain user message, and the rendered
 * skill body follows as injected `instructions`-form context carrying this
 * source, so transcript consumers present the injection from metadata
 * instead of re-parsing the model-facing text.
 */
// 用户显式技能唤起所注入上下文消息的可持久化来源：用户自己的话走普通用户消息，
// 渲染后的技能正文以携带本来源的 instructions 形式上下文跟随其后——因此转录消费方
// 从元数据呈现注入，而不是重解析面向模型的文本。
export interface SkillInvocationSource {
  readonly kind: 'skill-invocation'
  /** Invoked skill name, validated user-invocable at the injecting boundary. */
  // 被唤起的技能名，已在注入边界校验为用户可唤起。
  readonly name: string
  /** Injected skill bodies are instructions for the model to follow. */
  // 注入的技能正文是供模型遵循的指令。
  readonly form: 'instructions'
}

// 类型合并：把 skill-invocation 来源登记进消息来源表。
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A user-explicit skill invocation injected by the host. */
    // 由宿主注入的用户显式技能唤起。
    'skill-invocation': SkillInvocationSource
  }
}

/**
 * Render one loaded skill for the model. The output is shared verbatim by the
 * `skill` tool result and the user-explicit invocation injection, so the model
 * sees one canonical `<skill_content>` shape on both paths. The name rides an
 * escaped attribute; the body is embedded verbatim (skills are trusted local
 * content, and user-supplied invocation text stays outside this wrapper).
 * @param skill - name, provider, optional resource base, and body to render.
 * @returns the complete model-facing `<skill_content>` block.
 */
// 为模型渲染一份已加载的技能。skill 工具结果与用户显式唤起注入逐字共享该输出，
// 使模型在两条路径上看到同一份规范的 <skill_content> 形状。名称放在转义后的属性里；
// 正文原样内嵌（技能是受信任的本地内容，用户提供的唤起文本保持在本包装之外）。
export function renderSkillContent(skill: Pick<SkillDefinition, 'name' | 'provider' | 'resourceBase' | 'content'>): string {
  const resourceHint = renderResourceHint(skill)
  return [
    `<skill_content name="${escapeAttr(skill.name)}">`,
    '<skill_resources>',
    ...resourceHint,
    '</skill_resources>',
    '',
    '<skill_instructions>',
    skill.content,
    '</skill_instructions>',
    '</skill_content>',
  ].join('\n')
}

// 渲染"资源指引"段落：告知模型技能资源由谁管理、相对路径如何解析。
function renderResourceHint(skill: Pick<SkillDefinition, 'provider' | 'resourceBase'>): string[] {
  const base = skill.resourceBase
  if (base === undefined) {
    return [
      `Resources for this skill are managed by provider "${escapeText(skill.provider)}".`,
      'Load referenced resources only as needed.',
    ]
  }
  switch (base.kind) {
    case 'directory':
      return [
        `Base directory for this skill: ${escapeText(base.path)}`,
        'Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.',
      ]
    case 'url':
      return [
        `Base URL for this skill: ${escapeText(base.url)}`,
        'Resolve relative URLs mentioned by this skill against the base URL before using them. Load referenced resources only as needed.',
      ]
    case 'opaque':
      return [
        `Resources for this skill: ${escapeText(base.description)}`,
        'Load referenced resources only as needed.',
      ]
    // SkillResourceBase 是封闭联合；未来新增 kind 必须在这里编译失败。
    /* v8 ignore start -- SkillResourceBase is a closed union; a future kind must fail compilation here. */
    default:
      return assertNever(base, 'SkillResourceBase.kind')
    /* v8 ignore stop */
  }
}

// 转义属性值中的 HTML 敏感字符（技能名用于 XML 属性）。
function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

/**
 * Escape model-facing prose embedded inside skill markup so provider-supplied
 * text cannot open or close framing tags.
 * @param value - raw prose to embed.
 * @returns the escaped text.
 */
// 转义内嵌在技能标记中的面向模型散文，使提供方提供的文本无法开/关框架标签。
export function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** One catalog observation plus whether discovery completed within a stable catalog revision. */
// 一次目录观测，以及发现是否在稳定的目录修订内完成。
export interface SkillCatalogSnapshot {
  /** Sorted invocation-neutral summaries collected in this observation. */
  // 本次观测收集的、排序后的与调用方式无关的摘要。
  readonly skills: SkillSummary[]
  /** Whether every registered provider completed without a concurrent catalog revision. */
  // 是否每个注册提供方都在无并发目录修订的情况下完成。
  readonly complete: boolean
}

/** Provider candidates plus whether the current discovery is authoritative. */
// 提供方候选，以及当前发现是否权威。
export interface SkillProviderObservation {
  /** Candidates available from the current provider discovery. */
  // 当前提供方发现可用的候选。
  readonly candidates: readonly SkillCandidate[]
  /** Whether discovery completed and these candidates may be cached. */
  // 发现是否完成、这些候选是否可缓存。
  readonly complete: boolean
}

/** Provider interface for one source of skills, such as local directories or a remote registry. */
// 单个技能来源（如本地目录或远程注册表）的提供方接口。
export interface SkillProvider {
  /** Unique provider name in the `ctx.skills` registry. */
  // 在 ctx.skills 注册表中的唯一提供方名。
  readonly name: string
  /**
   * List available skill candidates for the current lookup context. Provider
   * plugins register synchronously during `apply()`; remote initialization,
   * authentication, and discovery are awaited inside this method. Implementations
   * should settle promptly when `options.signal` aborts.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns provider candidates as a complete-array shorthand, or an explicit
   *   observation when usable candidates came from incomplete discovery.
   */
  // 列出当前查找上下文可用的技能候选。提供方插件在 apply() 期间同步注册；
  // 远程初始化、鉴权与发现在本方法内等待。实现应在其 options.signal 中止时尽快结算。
  readonly list: (options: SkillLookupOptions) => Promise<readonly SkillCandidate[] | SkillProviderObservation>
  /**
   * Load a complete skill body for a previously listed candidate.
   * @param candidate - the winning candidate originally returned by this provider.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns the full skill body, or `undefined` if it is no longer loadable.
   */
  // 为之前列出的候选加载完整技能正文；不可再加载时返回 undefined。
  readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<SkillDefinition | undefined>
}

/** Registration-scoped lifecycle and invalidation capability borrowed by one provider. */
// 借给单个提供方的、以注册为作用域的生命周期与失效能力。
export interface SkillProviderControl {
  /** Aborts if registration fails or when the exact provider registration is disposed. */
  // 注册失败或该精确提供方注册被销毁时中止。
  readonly signal: AbortSignal
  /** Invalidate completed catalogs and notify consumers only while the exact registration remains active. */
  // 仅当该精确注册仍活跃时，使已完成的目录失效并通知消费方。
  readonly invalidate: () => void
}

/** Skill registry configuration. */
// 技能注册表配置。
export interface Config {
  /** Maximum number of completed cwd/provider catalogs kept in memory. */
  // 内存中保留的已完成 cwd/提供方目录的最大条数。
  readonly collectCacheMaxEntries?: number
}

// 类型合并：把 ctx.skills 与 skills/change 事件声明进 Cordis 的 Context/Events。
declare module '@deepseek-ai/cordis' {
  interface Context {
    skills: SkillRegistry
  }

  interface Events {
    /**
     * A skill provider, runtime contribution, or provider-backed catalog may
     * have changed. This is an unfiltered invalidation notification; consumers
     * refetch the catalog for their own lookup options. Listener failures are
     * contained and cannot veto the registry mutation.
     * @mode emit
     */
    // 技能提供方、运行时贡献或提供方目录可能已变化。这是不过滤的失效通知；
    // 消费方为自己的查找选项重新取目录。监听器失败被包含，不能否决注册表变更。
    'skills/change'(): void
  }
}

// 一条已索引的候选：候选本体 + 归属提供方 + 层内/提供方内次序 + 所属层。
interface IndexedCandidate {
  candidate: SkillCandidate
  provider: SkillProvider
  providerOrder: number
  localOrder: number
  /** Owning layer, so a stale-definition invalidation can verify the exact registration is still live. */
  // 归属层：过期定义失效时据此验证精确注册是否仍然存活。
  layer: SkillLayer
}

/** One provider registration retained by its layer. */
// 由某层保留的一条提供方注册。
interface RegisteredProvider {
  provider: SkillProvider
  /** Service-wide monotonic registration order, the within-layer rank tiebreak. */
  // 服务级单调注册顺序，用于层内 rank 相同者决胜。
  order: number
}

// 单层收集的中间结果。
interface LayerCollectResult {
  entries: IndexedCandidate[]
  cacheable: boolean
}

// 全量收集的中间结果：按技能名索引的条目。
interface CollectResult {
  entries: Map<string, IndexedCandidate>
  cacheable: boolean
}

/** One scope's complete skill-registry contribution. */
// 单个作用域的完整技能注册表贡献（一层）。
class SkillLayer implements ScopeLayer {
  /** Providers registered through contexts carrying this scope, insertion-ordered. */
  // 通过携带该作用域的 context 注册的提供方，按插入顺序。
  readonly providers: NamedEntries<RegisteredProvider>
  /** Runtime skills registered through contexts carrying this scope. */
  // 通过携带该作用域的 context 注册的运行时技能。
  readonly runtime = new Map<string, SkillDefinition>()

  constructor(scope: ScopeKey | undefined) {
    this.providers = new NamedEntries(name => new Error(scope === undefined
      ? `a skill provider named "${name}" is already registered`
      : `a skill provider named "${name}" is already registered in this scope`))
  }

  /** Whether every contribution table in this aggregate layer is empty. */
  // 该聚合层的所有贡献表是否都为空。
  isEmpty(): boolean {
    return this.providers.isEmpty() && this.runtime.size === 0
  }
}

/**
 * Layered registry of skill providers, the host+per-scope shape the tools
 * registry established. A registration files into the layer of its calling
 * context's scope ({@link scopeOf}): host rows and repository plugins land in
 * the global layer, while a plugin mounted by an agent preset's standing
 * composition lands in that preset's layer. A read merges the global layer
 * with the viewing scope's chain — the nearest layer's entry wins a duplicate
 * name outright, and the rank order decides duplicates only within one layer.
 * It exposes sorted invocation-neutral summaries and loads full skill bodies
 * on demand.
 */
// 技能提供方的分层注册表，形态与工具注册表确立的"宿主 + 每作用域"一致。一次注册归档进
// 其调用方 context 作用域的那一层（scopeOf）：宿主行与仓库插件落在全局层，而由代理预设
// 常驻组合挂载的插件落在该预设的层。一次读取合并全局层与查看作用域的链——最近层的条目
// 直接赢下重名，rank 顺序只在层内决定重名胜负。它暴露排序后的调用无关摘要，并按需加载
// 完整技能正文。
export class SkillRegistry extends Service {
  // 注册表自身的配置 schema（缓存条目上限）。
  static Config: Schema<Config> = z.object({
    collectCacheMaxEntries: z.number().default(DEFAULT_COLLECT_CACHE_ENTRIES),
  })

  // 收集缓存的最大条目数（构造时从配置解析）。
  private readonly collectCacheMaxEntries: number
  // 按作用域分层存储的层对象；层被移除时自动失效缓存。
  private readonly layers = new ScopedLayers<SkillLayer>(
    scope => new SkillLayer(scope),
    () => { this.invalidateCache() },
  )
  // 收集缓存：key 是 cwd + 作用域链 + 修订号，value 是技能名到条目的映射。
  private readonly collectCache = new Map<string, Map<string, IndexedCandidate>>()
  // 目录修订号：任何失效都会 +1，使旧缓存自然过期。
  private revision = 0
  // 服务级单调的提供方注册序号（层内 rank 决胜）。
  private nextProviderOrder = 0
  /** Stable identities for cache keys; scope keys are opaque identity-compared objects. */
  // 缓存键的稳定身份：作用域键是不透明、按身份比较的对象，故分配数字 id。
  private readonly scopeIds = new WeakMap<ScopeKey, number>()
  private nextScopeId = 1

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skills')
    this.collectCacheMaxEntries = config.collectCacheMaxEntries ?? DEFAULT_COLLECT_CACHE_ENTRIES
    assertPositiveInteger('collectCacheMaxEntries', this.collectCacheMaxEntries)
  }

  /**
   * Register a borrowed same-process provider synchronously during plugin
   * apply, into the calling context's layer: a scoped context (an agent
   * preset's standing mount) registers for that scope alone, an unscoped
   * context registers globally. Duplicate names within one layer and reserved
   * names throw; remote initialization belongs in `list()`. Fiber disposal
   * unregisters the provider and invalidates catalog caches.
   * @param create - synchronous factory receiving this registration's lifecycle and invalidation control.
   * @returns the exact Cordis effect disposer that unregisters this provider;
   *   composite effects may yield it directly to preserve teardown ordering.
   */
  // 在插件 apply 期间同步注册一个借用的同进程提供方，归档进调用方 context 的层：
  // 带作用域的 context（代理预设的常驻挂载）只为该作用域注册，无作用域的 context 全局注册。
  // 层内重名与保留名会抛错；远程初始化属于 list()。fiber 销毁会注销提供方并使目录缓存失效。
  registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void {
    const lifecycle = new AbortController()
    let registration: { layer: SkillLayer; name: string } | undefined
    let provider: SkillProvider
    const control: SkillProviderControl = {
      signal: lifecycle.signal,
      invalidate: () => {
        const active = registration
        if (active !== undefined && active.layer.providers.get(active.name)?.provider === provider) {
          this.invalidateCache()
        }
      },
    }
    try {
      provider = create(control)
      const name = provider.name
      if (name === RUNTIME_PROVIDER) {
        throw new Error(`"${RUNTIME_PROVIDER}" is reserved for runtime skill registrations`)
      }
      const order = this.nextProviderOrder
      this.nextProviderOrder += 1
      return this.layers.effect(
        this.ctx,
        (layer) => {
          const undo = layer.providers.insert(name, { provider, order })
          registration = { layer, name }
          return () => {
            registration = undefined
            undo()
            lifecycle.abort(new Error(`skill provider "${name}" disposed`))
          }
        },
        { label: 'skills.registerProvider()' },
      )
    } catch (error) {
      lifecycle.abort(error)
      throw error
    }
  }

  /**
   * Register a borrowed readonly runtime skill into the calling context's
   * layer. Project entries outrank runtime entries, which outrank user
   * entries, within one layer. Same-name runtime entries in one layer are
   * first-wins; a duplicate logs a warning and receives a no-op disposer so
   * it cannot remove the winner.
   * @param skill - the skill definition input; omitted invocation and provider fields receive defaults.
   * @returns the exact Cordis effect disposer, preserving composite teardown order and invalidating caches.
   */
  // 把借用的只读运行时技能注册进调用方 context 的层。同一层内"项目条目 > 运行时条目 >
  // 用户条目"；层内同名运行时条目先到先得——重复注册只记警告并返回空操作释放器，
  // 使重复者无法移除获胜者。
  register(skill: SkillRegistration): () => void {
    validateRuntimeSkill(skill)
    const scope = scopeOf(this.ctx)
    const existingLayer = scope === undefined ? this.layers.global : this.layers.peek(scope)
    if (existingLayer !== undefined && existingLayer.runtime.has(skill.name)) {
      this.ctx.logger.warn(`runtime skill "${skill.name}" ignored because it is already registered`)
      return () => {}
    }
    const definition: SkillDefinition = {
      ...skill,
      invocation: skill.invocation ?? { modelInvocable: true, userInvocable: true },
      provider: skill.provider ?? RUNTIME_PROVIDER,
    }
    return this.layers.effect(
      this.ctx,
      (layer) => {
        layer.runtime.set(definition.name, definition)
        return () => { layer.runtime.delete(definition.name) }
      },
      { label: 'skills.register()' },
    )
  }

  /**
   * List invocation-neutral skill summaries for a workspace. Consumers apply
   * model or user invocation policy at their operational boundary. Lookup
   * options and provider candidates are readonly same-process values borrowed
   * throughout discovery.
   * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
   * @returns all sorted winning summaries.
   */
  // 列出某工作区的、与调用方式无关的技能摘要。消费方在自己的操作边界应用模型/用户
  // 调用策略。查找选项与提供方候选是只读的同进程值，整个发现过程全程借用。
  async list(options: SkillViewOptions = {}): Promise<SkillSummary[]> {
    return (await this.snapshot(options)).skills
  }

  /**
   * Observe the current invocation-neutral catalog and whether discovery completed within a stable revision.
   * Incomplete observations are never cached, allowing consumers to retain last-good state and
   * retry on their next request boundary.
   * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
   * @returns sorted summaries plus discovery-completeness state.
   */
  // 观测当前目录及发现是否在稳定修订内完成。不完整的观测绝不缓存，消费方可保留上次良好
  // 状态并在下个请求边界重试。
  async snapshot(options: SkillViewOptions = {}): Promise<SkillCatalogSnapshot> {
    const collected = await this.collect(options)
    return {
      skills: [...collected.entries.values()]
        .map(entry => toSummary(entry.candidate))
        .sort(compareSkillSummary),
      complete: collected.cacheable,
    }
  }

  /**
   * Load and validate the winning candidate, passing its opaque discovery locator back to the
   * provider. Cancellation is rechecked after selection, including cache hits, and raced against
   * loading so an uncooperative provider cannot hang the caller.
   * @param name - kebab-case skill name.
   * @param options - view options; `scope` selects the viewing agent's layers,
   *   `cwd` selects workspace-sensitive skills, and `signal` cancels work.
   * @returns the full skill, including body content, or `undefined`.
   */
  // 加载并校验获胜候选，把其不透明发现句柄传回提供方。选择之后（含缓存命中）会复查取消，
  // 并与加载竞速，使不配合的提供方无法吊死调用方。
  async get(name: string, options: SkillViewOptions = {}): Promise<SkillDefinition | undefined> {
    if (!isSkillName(name)) return undefined
    const collected = await this.collect(options)
    throwIfAborted(options.signal)
    const match = collected.entries.get(name)
    if (match === undefined) return undefined
    const definition = await waitWithAbort(
      match.provider.get(match.candidate, options),
      options.signal,
    )
    if (definition === undefined) return undefined
    validateDefinition(definition)
    if (definition.name !== match.candidate.name) {
      this.invalidateEntry(match)
      return undefined
    }
    return definition
  }

  // 收集当前目录：优先读缓存，否则收集新值；期间发生并发修订则按预算重试。
  private async collect(options: SkillViewOptions): Promise<CollectResult> {
    throwIfAborted(options.signal)
    let attempt = 1
    while (true) {
      const revision = this.revision
      // The chain is part of the key rather than assumed stable: a blank-session
      // recompose re-parents an existing scope without touching this registry,
      // and only a chain-bearing key makes the next read see the new preset.
      // 作用域链是 key 的一部分而不是假设其稳定：空会话重组会重新挂载既有作用域而不触碰
      // 本注册表，只有携带链的 key 才能让下一次读取看到新预设。
      const key = this.collectCacheKey(options.cwd, scopeChainOf(options.scope), revision)
      const cached = this.collectCache.get(key)
      if (cached !== undefined) return { entries: cached, cacheable: true }

      const result = await this.collectFresh(options)
      throwIfAborted(options.signal)
      if (revision !== this.revision) {
        if (attempt < MAX_COLLECT_ATTEMPTS) {
          attempt += 1
          continue
        }
        return { entries: result.entries, cacheable: false }
      }
      if (result.cacheable) {
        this.collectCache.set(key, result.entries)
        if (this.collectCache.size > this.collectCacheMaxEntries) {
          const oldest = this.collectCache.keys().next() as IteratorYieldResult<string>
          this.collectCache.delete(oldest.value)
        }
      }
      return result
    }
  }

  // 不读缓存、真正收集一次：先全局层，再按"最远祖先在前、精确作用域在后"叠加链上各层，
  // 后写者（更近层）的同名条目替换先写者。
  private async collectFresh(options: SkillViewOptions): Promise<CollectResult> {
    // Global first, then existing chain overlays farthest ancestor first and
    // the exact scope last, so the nearest layer's same-name entry replaces
    // the farther ones — the tools registry's shadowing rule. Rank decides
    // duplicates only within one layer.
    // 先全局层，再把已存在的链自最远祖先起叠加、精确作用域最后，使最近层的同名条目
    // 替换更远的——即工具注册表的遮蔽规则。rank 只在层内决定重名胜负。
    const layers = [this.layers.global, ...this.layers.chainLayers(options.scope)]
    const merged = new Map<string, IndexedCandidate>()
    let cacheable = true
    for (const layer of layers) {
      const collected = await this.collectLayer(layer, options)
      if (!collected.cacheable) cacheable = false
      for (const entry of collected.entries) merged.set(entry.candidate.name, entry)
    }
    return { entries: merged, cacheable }
  }

  // 收集单层：排序、去重（保留第一个，即优先级最高者），并打日志说明被忽略的技能。
  private async collectLayer(layer: SkillLayer, options: SkillLookupOptions): Promise<LayerCollectResult> {
    const collected = await this.listLayerCandidates(layer, options)
    collected.entries.sort(compareIndexedCandidates)
    const seen = new Set<string>()
    const result: IndexedCandidate[] = []
    for (const entry of collected.entries) {
      const skill = entry.candidate
      if (seen.has(skill.name)) {
        this.ctx.logger.warn(`skill "${skill.name}" from ${skill.source} ignored because a higher-priority skill already exists`)
        continue
      }
      seen.add(skill.name)
      result.push(entry)
    }
    return { entries: result, cacheable: collected.cacheable }
  }

  // 列出单层全部候选：先运行时技能（按名排序），再各提供方的 list() 结果；
  // 单个提供方失败只降级为"不完整"并记警告，不阻断整层。
  private async listLayerCandidates(layer: SkillLayer, options: SkillLookupOptions): Promise<LayerCollectResult> {
    throwIfAborted(options.signal)
    const candidates: IndexedCandidate[] = []
    let cacheable = true
    let runtimeOrder = 0
    for (const skill of [...layer.runtime.values()].sort((a, b) => compareCodePoints(a.name, b.name))) {
      candidates.push({
        candidate: runtimeCandidate(skill),
        provider: RUNTIME_SKILL_PROVIDER,
        providerOrder: -1,
        localOrder: runtimeOrder,
        layer,
      })
      runtimeOrder += 1
    }
    for (const { provider, order } of [...layer.providers.values()]) {
      let localOrder = 0
      let output: unknown
      try {
        output = await waitWithAbort(provider.list(options), options.signal)
      } catch (error) {
        if (options.signal?.aborted === true) throw toError(options.signal.reason)
        cacheable = false
        this.ctx.logger.warn(`skill provider "${provider.name}" skipped: ${errorMessage(error)}`)
      }
      if (output === undefined) continue
      const observation = normalizeProviderObservation(output, provider.name)
      if (!observation.complete) cacheable = false
      for (const candidate of observation.candidates) {
        validateCandidate(candidate, provider.name)
        candidates.push({ candidate, provider, providerOrder: order, localOrder, layer })
        localOrder += 1
      }
    }
    return { entries: candidates, cacheable }
  }

  // 使全部目录缓存失效：修订号 +1、清空缓存、通知消费方。
  private invalidateCache(): void {
    this.revision += 1
    this.collectCache.clear()
    this.notifyChange()
  }

  /** Invalidate after a stale definition load, only while the exact registration that produced the entry is still live. */
  // 过期定义加载后失效：仅当"产出该条目的精确注册"仍然存活时才做。
  private invalidateEntry(entry: IndexedCandidate): void {
    /* v8 ignore else -- A definition load can outlive the exact provider registration it selected. */
    if (entry.layer.providers.get(entry.provider.name)?.provider === entry.provider) this.invalidateCache()
  }

  // 为作用域键分配/复用稳定数字 id（WeakMap 键，避免强引用）。
  private scopeId(key: ScopeKey): number {
    let id = this.scopeIds.get(key)
    if (id === undefined) {
      id = this.nextScopeId
      this.nextScopeId += 1
      this.scopeIds.set(key, id)
    }
    return id
  }

  // 组收集缓存 key：cwd + 作用域链（以数字 id 表示）+ 修订号。
  private collectCacheKey(cwd: string | undefined, chain: ScopeKey[], revision: number): string {
    return JSON.stringify({ cwd, scopes: chain.map(key => this.scopeId(key)), revision })
  }

  /** Notify catalog observers without making their refresh work load-bearing. */
  // 通知目录观察者，但不让它们的刷新工作成为负载关键路径。
  private notifyChange(): void {
    for (const callback of this.ctx.events.dispatch('emit', ['skills/change'])) {
      try {
        const returned: unknown = callback()
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`skills/change listener rejected: ${errorMessage(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`skills/change listener threw: ${errorMessage(error)}`)
      }
    }
  }
}

// 归一化提供方 list() 的返回：数组视为"完整候选"，对象必须是合法观测形状。
function normalizeProviderObservation(output: unknown, providerName: string): SkillProviderObservation {
  if (Array.isArray(output)) {
    return { candidates: output as readonly SkillCandidate[], complete: true }
  }
  if (output === null || typeof output !== 'object') {
    throw invalidProviderObservation(providerName)
  }
  const observation = output as Partial<SkillProviderObservation>
  if (!Array.isArray(observation.candidates) || typeof observation.complete !== 'boolean') {
    throw invalidProviderObservation(providerName)
  }
  return observation as SkillProviderObservation
}

// 构造"非法提供方观测"的类型错误，附上期望形状的说明。
function invalidProviderObservation(providerName: string): TypeError {
  return new TypeError(`skill provider "${providerName}" list() must return an array or { candidates, complete } observation`)
}

// 运行时技能的"虚拟提供方"：只承担 get()（直接把 locator 当定义返回）。
const RUNTIME_SKILL_PROVIDER: SkillProvider = {
  name: RUNTIME_PROVIDER,
  // 运行时技能由注册表直接注入，此提供方只承担 get()，list() 恒为空。
  /* v8 ignore next -- Runtime skills are injected directly by the registry; this provider only owns `get()`. */
  list() {
    return Promise.resolve([])
  },
  get(candidate) {
    return Promise.resolve(candidate.locator as SkillDefinition)
  },
}

// 把运行时技能定义转成候选：locator 直接指向定义本身。
function runtimeCandidate(skill: SkillDefinition): SkillCandidate {
  return {
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {},
    invocation: skill.invocation,
    source: skill.source,
    provider: skill.provider,
    ...skill.resourceBase !== undefined ? { resourceBase: skill.resourceBase } : {},
    rank: RUNTIME_RANK,
    locator: skill,
    ...skill.path !== undefined ? { path: skill.path } : {},
    ...skill.metadata !== undefined ? { metadata: skill.metadata } : {},
  }
}

// 校验提供方返回的候选：名称文法、描述非空、调用策略、rank、provider 归属等。
function validateCandidate(candidate: SkillCandidate, providerName: string): void {
  if (typeof candidate.name !== 'string') {
    throw new TypeError(`skill provider "${providerName}" returned a non-string skill name`)
  }
  if (!SKILL_NAME.test(candidate.name)) {
    throw new Error(`skill provider "${providerName}" returned invalid skill name "${candidate.name}"`)
  }
  if (typeof candidate.description !== 'string') {
    throw new TypeError(`skill provider "${providerName}" returned skill "${candidate.name}" with a non-string description`)
  }
  if (candidate.description.length === 0) {
    throw new Error(`skill provider "${providerName}" returned skill "${candidate.name}" without a description`)
  }
  validateInvocation(candidate.invocation, `skill provider "${providerName}" returned skill "${candidate.name}"`)
  if (candidate.whenToUse !== undefined && typeof candidate.whenToUse !== 'string') {
    throw new TypeError(`skill provider "${providerName}" returned skill "${candidate.name}" with a non-string whenToUse`)
  }
  if (typeof candidate.source !== 'string') {
    throw new TypeError(`skill provider "${providerName}" returned skill "${candidate.name}" with a non-string source`)
  }
  if (typeof candidate.rank !== 'number' || !Number.isFinite(candidate.rank)) {
    throw new Error(`skill provider "${providerName}" returned skill "${candidate.name}" with an invalid rank`)
  }
  if (typeof candidate.provider !== 'string') {
    throw new TypeError(`skill provider "${providerName}" returned skill "${candidate.name}" with a non-string provider`)
  }
  if (candidate.provider !== providerName) {
    throw new Error(`skill provider "${providerName}" returned skill "${candidate.name}" for provider "${candidate.provider}"`)
  }
  if (candidate.path !== undefined && typeof candidate.path !== 'string') {
    throw new TypeError(`skill provider "${providerName}" returned skill "${candidate.name}" with a non-string path`)
  }
}

// 校验运行时技能注册：名称、描述、调用策略。
function validateRuntimeSkill(skill: SkillRegistration): void {
  if (!SKILL_NAME.test(skill.name)) throw new Error(`invalid skill name "${skill.name}"`)
  if (skill.description.length === 0) throw new Error(`skill "${skill.name}" requires a description`)
  validateInvocation(skill.invocation, `runtime skill "${skill.name}"`)
}

/** Validate a definition loaded from a provider-controlled parser or remote source. */
// 校验从提供方控制的解析器或远程来源加载的定义。
function validateDefinition(skill: SkillDefinition): void {
  const name = skill.name
  const description = skill.description
  const whenToUse = skill.whenToUse
  const invocation = skill.invocation
  const source = skill.source
  const provider = skill.provider
  const content = skill.content
  const path = skill.path
  if (typeof name !== 'string') throw new TypeError('loaded skill name must be a string')
  if (!SKILL_NAME.test(name)) throw new Error(`loaded skill has invalid name "${name}"`)
  if (typeof description !== 'string') throw new TypeError(`loaded skill "${name}" description must be a string`)
  if (description.length === 0) throw new Error(`loaded skill "${name}" requires a description`)
  validateInvocation(invocation, `loaded skill "${name}"`)
  if (whenToUse !== undefined && typeof whenToUse !== 'string') throw new TypeError(`loaded skill "${name}" whenToUse must be a string`)
  if (typeof source !== 'string') throw new TypeError(`loaded skill "${name}" source must be a string`)
  if (typeof provider !== 'string') throw new TypeError(`loaded skill "${name}" provider must be a string`)
  if (typeof content !== 'string') throw new TypeError(`loaded skill "${name}" content must be a string`)
  if (path !== undefined && typeof path !== 'string') throw new TypeError(`loaded skill "${name}" path must be a string`)
}

// 把候选/定义收窄为摘要：只保留展示与路由所需字段。
function toSummary(skill: SkillDefinition | SkillCandidate): SkillSummary {
  const { name, description, whenToUse, invocation, source, provider, resourceBase } = skill
  return {
    name,
    description,
    ...whenToUse !== undefined ? { whenToUse } : {},
    invocation,
    source,
    provider,
    ...resourceBase !== undefined ? { resourceBase } : {},
  }
}

// 校验调用策略对象：modelInvocable 与 userInvocable 必须都是布尔。
function validateInvocation(invocation: unknown, subject: string): void {
  if (invocation === undefined) return
  if (typeof invocation !== 'object' || invocation === null || Array.isArray(invocation)) {
    throw new TypeError(`${subject} with a non-object invocation policy`)
  }
  const policy = invocation as Record<string, unknown>
  if (typeof policy.modelInvocable !== 'boolean') {
    throw new TypeError(`${subject} with a non-boolean invocation.modelInvocable`)
  }
  if (typeof policy.userInvocable !== 'boolean') {
    throw new TypeError(`${subject} with a non-boolean invocation.userInvocable`)
  }
}

// 摘要按技能名排序（码点序）。
function compareSkillSummary(left: SkillSummary, right: SkillSummary): number {
  return compareCodePoints(left.name, right.name)
}

// 字符串按 Unicode 码点比较。
function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

// 候选排序：rank 升序，再提供方注册顺序，再层内出现顺序。
function compareIndexedCandidates(left: IndexedCandidate, right: IndexedCandidate): number {
  return left.candidate.rank - right.candidate.rank
    || left.providerOrder - right.providerOrder
    || left.localOrder - right.localOrder
}

// 校验正整数（可指定最小值）。
function assertPositiveInteger(name: string, value: number, minimum = 1): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`skill: ${name} must be an integer greater than or equal to ${minimum}`)
  }
}

// 把一个 Promise 与调用方中止竞速：中止时 reject 为总错误，同时保留操作自身的结算。
function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      cleanup()
      reject(toError(signal.reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(toError(error))
      },
    )
  })
}

/** Throw a total Error for an already-aborted lookup. */
// 查找已中止时抛出总错误（把中止原因归一化为 Error）。
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw toError(signal.reason)
}

/** Normalize an arbitrary abort or provider failure without trusting coercion. */
// 归一化任意中止或提供方失败，不信任强制转换。
function toError(error: unknown): Error {
  try {
    if (error instanceof Error) return error
  } catch {
    // A hostile proxy may throw during instanceof; fall through to the total renderer.
    // 恶意代理可能在 instanceof 时抛错；落入下面的总渲染器。
  }
  return new Error(errorMessage(error))
}

/** Render an arbitrary provider failure without letting coercion escape containment. */
// 渲染任意提供方失败，不让强制转换逃出容器。
function errorMessage(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

export default SkillRegistry
