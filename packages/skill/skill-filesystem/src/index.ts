/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是 dsh-skill-filesystem 包：本地文件系统技能提供方。它从项目、自定义与
 *             用户根目录发现"目录包"与"扁平 Markdown"两类技能，解析 YAML frontmatter，
 *             并在存在文件系统服务（ctx.fs）时经其加载正文。
 * 【技术维度】实现 SkillProvider 接口；提供方注册在 apply() 中同步完成；发现与读取优先走
 *             ctx.fs（受策略约束），缺失时回退 Node 原生 fs；用 Chokidar/watchFile 做宿主
 *             监听并在技能文件变化时令目录失效。
 * 【产品维度】用户把 SKILL.md 放进约定目录即成为可用技能；改动文件会被监听并自动反映到
 *             目录；模型或用户随后即可加载使用。
 * 【逻辑维度】常量与配置 → 提供方类（roots 根目录装配 / list / get / 监听管理）→
 *             监听器管理类（WatchManager）→ 发现/解析/读取辅助函数 → frontmatter 解析。
 * 【关键边界】各根目录有固定优先级（项目 .dsh 100 < 项目 .agents 200 < 自定义 300 < 用户
 *             .dsh 400 < 用户 .agents 500 < 捆绑 600）；监听按项目数限量、按所有者引用计数；
 *             frontmatter 缺失/非法/名称非法一律跳过并记警告。
 * 【新手阅读建议】先读 apply() 与 FileSystemSkillProvider.list/get，再看 discoverRoot /
 *             parseSkillFile 理解发现流程，最后看 SkillWatchManager 理解监听生命周期。
 * ==========================================================================
 */
/**
 * Local filesystem skill provider.
 *
 * This package is one implementation of the `ctx.skills` provider registry. It
 * discovers directory-bundle and flat Markdown skills from project, custom, and
 * user roots, parses YAML frontmatter, and loads bodies through `ctx.fs` when a
 * filesystem service is present.
 *
 * @module @deepseek-ai/dsh-skill-filesystem
 */

import { access, lstat, readdir, readFile, stat } from 'node:fs/promises'
import { unwatchFile, watchFile, type Stats } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import chokidar from 'chokidar'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { parse as parseYaml } from 'yaml'
import type { FileSystem, FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import { canonicalizeWatchPath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  BUNDLED_SKILL_RANK,
  isSkillName,
  type SkillCandidate,
  type SkillDefinition,
  type SkillInvocationPolicy,
  type SkillLookupOptions,
  type SkillProvider,
  type SkillProviderControl,
  type SkillProviderObservation,
  type SkillSource,
} from '@deepseek-ai/dsh-skill'

// 项目根 .dsh/skills 的优先级。
const PROJECT_DSH_RANK = 100
// 项目根 .agents/skills 的优先级。
const PROJECT_AGENTS_RANK = 200
// 自定义技能目录的优先级。
const CUSTOM_RANK = 300
// 用户根 .dsh/skills 的优先级。
const USER_DSH_RANK = 400
// 用户根 .agents/skills 的优先级。
const USER_AGENTS_RANK = 500
// 监听稳定性阈值默认值（毫秒）：文件在阈值内稳定后才算一次变更。
const DEFAULT_WATCH_STABILITY_THRESHOLD_MS = 200
// 监听轮询间隔默认值（毫秒）。
const DEFAULT_WATCH_POLL_INTERVAL_MS = 100
// 默认最多同时监听的项目根数。
const DEFAULT_WATCH_MAX_PROJECTS = 128

export const name = 'skill-filesystem'
export const inject = ['skills']

/** Local filesystem skill provider configuration. */
// 本地文件系统技能提供方配置。
export interface Config {
  /** Unique provider name. Defaults to `filesystem`. */
  providerName?: string
  /** Whether project and user roots are included around custom roots. */
  // 是否在自定义根之外再包含项目根与用户根。
  includeDefaultRoots?: boolean
  /** DeepSeek Harness config root. Defaults to `$DSH_HOME` or `~/.dsh`. */
  // DeepSeek Harness 配置根；缺省为 $DSH_HOME 或 ~/.dsh。
  dshHome?: string
  /** Shared agent config root. Defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  // 共享代理配置根；缺省为 $DSH_AGENTS_HOME 或 ~/.agents。
  agentsHome?: string
  /** Additional skill roots scanned after project roots and before user roots. */
  // 额外技能根：在项目根之后、用户根之前扫描。
  customSkillDirs?: string[]
  /** Whether host-local skill roots are watched for catalog changes. */
  // 是否监听宿主本地技能根的目录变化。
  watch?: boolean
  /** Whether Chokidar uses polling instead of native filesystem events. */
  // Chokidar 是否改用轮询而非原生文件系统事件。
  watchUsePolling?: boolean
  /** Milliseconds a changed skill entry must remain stable before it is observed. */
  // 变更的技能条目须保持稳定多少毫秒才被观测到。
  watchStabilityThresholdMs?: number
  /** Milliseconds between Chokidar stability or polling probes. */
  // Chokidar 稳定性或轮询探测的间隔毫秒数。
  watchPollIntervalMs?: number
  /** Maximum distinct project roots whose skill directories remain watched. */
  // 最多保持监听的不同项目根数。
  watchMaxProjects?: number
  /** Whether watched symbolic links follow their target files. */
  // 监听符号链接时是否跟随其目标文件。
  watchFollowSymlinks?: boolean
  /** Bundled skill root; defaults to `$DSH_BUNDLED_SKILL_DIR` when default roots are included, otherwise mounts none. */
  // 捆绑技能根；包含默认根时缺省为 $DSH_BUNDLED_SKILL_DIR，否则不挂载。
  bundledSkillDir?: string
}

// schemastery 配置 schema：为 Config 提供校验与默认值。
export const Config: Schema<Config> = z.object({
  providerName: z.string().min(1).default('filesystem'),
  includeDefaultRoots: z.boolean().default(true),
  dshHome: z.string(),
  agentsHome: z.string(),
  customSkillDirs: z.array(z.string()).default([]),
  watch: z.boolean().default(true),
  watchUsePolling: z.boolean().default(false),
  watchStabilityThresholdMs: z.number().default(DEFAULT_WATCH_STABILITY_THRESHOLD_MS),
  watchPollIntervalMs: z.number().default(DEFAULT_WATCH_POLL_INTERVAL_MS),
  watchMaxProjects: z.number().default(DEFAULT_WATCH_MAX_PROJECTS),
  watchFollowSymlinks: z.boolean().default(true),
  bundledSkillDir: z.string(),
})

// 一个技能根：路径 + 来源标签 + 优先级 + 附加属性。
interface SkillRoot {
  path: string
  source: SkillSource
  rank: number
  skipSystem?: boolean
  projectRoot?: string
  trustedHost?: boolean
}

// 技能根下的一个目录条目（发现用）。
interface SkillRootEntry {
  name: string
  type: 'directory' | 'file' | 'other'
  path: string
}

// 解析完一份技能文件后的结构化结果。
interface ParsedSkill {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
  metadata?: Record<string, unknown>
  content: string
}

// 本地技能的不透明定位器：文件路径 + 所属目录。
interface LocalLocator {
  path: string
  directory: string
}

// 解析后的监听配置（全部默认化）。
interface ResolvedWatchConfig {
  enabled: boolean
  usePolling: boolean
  stabilityThresholdMs: number
  pollIntervalMs: number
  maxProjects: number
  followSymlinks: boolean
}

/** Register the local filesystem skill provider on `ctx.skills`. */
// 插件入口 apply：注册提供方、登记销毁清理，并监听文件系统工具的宿主变更。
export function apply(ctx: Context, config: Config = {}): void {
  let provider!: FileSystemSkillProvider
  ctx.skills.registerProvider((control) => {
    provider = new FileSystemSkillProvider(ctx, control, config)
    return provider
  })
  // 插件销毁时关闭全部宿主监听器。
  ctx.effect(function* () {
    yield async () => { await provider.dispose() }
  }, 'skill-filesystem watcher')
  // 模型工具写入/编辑技能文件后，让宿主变更也能触发目录失效。
  ctx.on('fs/observed', (target, _observation, actor) => {
    if (mutationToolName(actor) === undefined) return
    provider.observeHostMutation(target.displayPath)
  })
}

/** Provider that maps local project/user skill roots into `ctx.skills`. */
// 把本地项目/用户技能根映射进 ctx.skills 的提供方。
export class FileSystemSkillProvider implements SkillProvider {
  readonly name: string
  private readonly includeDefaultRoots: boolean
  private readonly dshHome: string
  private readonly agentsHome: string
  private readonly customSkillDirs: string[]
  private readonly watchManager: SkillWatchManager
  private readonly bundledSkillDir: string | undefined
  // 一次性销毁承诺：多次调用共享同一次销毁。
  private disposal: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    control: SkillProviderControl,
    config: Config = {},
  ) {
    this.name = config.providerName ?? 'filesystem'
    this.includeDefaultRoots = config.includeDefaultRoots ?? true
    this.dshHome = resolveDshHome(config.dshHome)
    this.agentsHome = resolve(config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'))
    this.customSkillDirs = (config.customSkillDirs ?? []).map(root => resolve(root))
    this.watchManager = new SkillWatchManager(ctx, control.invalidate, resolveWatchConfig(config))
    control.signal.addEventListener('abort', () => { void this.dispose() }, { once: true })
    // The environment bundled root is a default root: an isolated provider
    // must see only its explicit roots, or every such provider would
    // re-discover the app's bundled skills under its own provider name.
    // 环境捆绑根属于默认根：隔离的提供方只能看到其显式根，否则每个这样的提供方都会
    // 在自己的提供方名下重新发现应用捆绑技能。
    const bundledSkillDir = config.bundledSkillDir
      ?? (this.includeDefaultRoots ? process.env.DSH_BUNDLED_SKILL_DIR : undefined)
    this.bundledSkillDir = bundledSkillDir === undefined ? undefined : resolve(bundledSkillDir)
  }

  /**
   * Discover local skill summaries for a cwd-sensitive workspace.
   * @param options - lookup options; `cwd` selects the project roots to scan.
   * @returns local provider candidates with stable root ranks; watcher startup
   *   failure returns readable candidates as an incomplete observation.
   */
  // 为对 cwd 敏感的工作区发现本地技能摘要。监听启动失败时把已读到的候选作为
  // "不完整观测"返回（不抛错）。
  async list(options: SkillLookupOptions): Promise<SkillCandidate[] | SkillProviderObservation> {
    const roots = await this.roots(options.cwd)
    let complete = true
    try {
      await this.watchManager.observeRoots(roots)
    } catch (error) {
      if (this.disposal !== undefined) throw error
      complete = false
    }
    const candidates: SkillCandidate[] = []
    for (const root of roots) {
      for (const skill of await discoverRoot(root, this.ctx, this.name)) {
        candidates.push(skill)
      }
    }
    return complete ? candidates : { candidates, complete }
  }

  /**
   * Load a complete local skill body from the candidate's file locator.
   * @param candidate - the winning candidate returned by this provider.
   * @param options - lookup options whose signal cancels filesystem reads.
   * @returns the full local skill, or `undefined` if the file disappeared.
   */
  // 从候选的文件定位器加载完整技能正文；文件消失返回 undefined。
  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as LocalLocator
    const parsed = await parseSkillFile(locator.path, this.ctx, options.signal, candidate.source === 'bundled')
    if (parsed === undefined) return undefined
    return {
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
      invocation: parsed.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: locator.path,
      ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
      content: parsed.content,
    }
  }

  /**
   * Invalidate this provider synchronously after a first-party filesystem mutation.
   * @param path - host display path observed after a model-facing write or edit.
   */
  // 第一方文件系统变更后同步令本提供方失效。
  observeHostMutation(path: string): void {
    this.watchManager.observeHostMutation(path)
  }

  /**
   * Close every host watcher and contain late filesystem callbacks.
   * @returns a shared promise that settles when every watcher reaches quiescence.
   */
  // 关闭全部宿主监听器并包住迟到的文件系统回调；返回共享 Promise。
  dispose(): Promise<void> {
    this.disposal ??= this.watchManager.dispose()
    return this.disposal
  }

  // 装配本提供方的全部技能根（项目根需先定位 git 根）。
  private async roots(cwd: string | undefined): Promise<SkillRoot[]> {
    const roots: SkillRoot[] = []
    if (this.includeDefaultRoots && cwd !== undefined) {
      const projectRoot = await findProjectRoot(resolve(cwd), optionalFileSystem(this.ctx))
      roots.push(
        { path: join(projectRoot, '.dsh/skills'), source: 'project-dsh', rank: PROJECT_DSH_RANK, projectRoot },
        { path: join(projectRoot, '.agents/skills'), source: 'project-agents', rank: PROJECT_AGENTS_RANK, projectRoot },
      )
    }
    roots.push(...this.customSkillDirs.map(path => ({ path, source: 'custom' as const, rank: CUSTOM_RANK })))
    if (this.includeDefaultRoots) {
      roots.push(
        { path: join(this.dshHome, 'skills'), source: 'user-dsh', rank: USER_DSH_RANK, skipSystem: true },
        { path: join(this.agentsHome, 'skills'), source: 'user-agents', rank: USER_AGENTS_RANK },
      )
    }
    if (this.bundledSkillDir !== undefined) {
      roots.push({ path: this.bundledSkillDir, source: 'bundled', rank: BUNDLED_SKILL_RANK, trustedHost: true })
    }
    return roots
  }
}

// 监听器关注的文件系统事件类型。
type SkillWatchEvent = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'

// 根监听模式：root 直接监听根目录；ancestor 监听最近的已存在祖先（根目录尚不存在时）。
type RootWatchMode =
  | { kind: 'root'; anchor: string }
  | { kind: 'ancestor'; anchor: string; nextPath: string }

// 单个根的状态：持有者集合、监听句柄、打开中承诺与健康标记。
interface RootWatchState {
  root: SkillRoot
  owners: Set<string>
  watcher: WatchHandle | undefined
  opening: Promise<void> | undefined
  unhealthy: boolean
}

// 一个可关闭的监听句柄。
interface WatchHandle {
  mode: RootWatchMode
  close(): Promise<void> | void
}

/** Owns bounded host watchers while discovery and reads remain on the filesystem service. */
// 持有有界数量的宿主监听器；发现与读取仍走文件系统服务。
class SkillWatchManager {
  // 按技能根路径索引的状态表。
  private readonly roots = new Map<string, RootWatchState>()
  // 项目根 → 其技能根路径集合（用于按项目限量与驱逐）。
  private readonly projects = new Map<string, Set<string>>()
  // 本监听器生命周期的中止控制器。
  private readonly lifecycle = new AbortController()
  // 是否已开始关闭。
  private closing = false
  // 是否已排队一次失效（防止同一批次重复触发）。
  private invalidationQueued = false

  constructor(
    private readonly ctx: Context,
    private readonly invalidate: () => void,
    private readonly config: ResolvedWatchConfig,
  ) {}

  // 让给定技能根集合进入"被观察"状态：无项目归属的共享根按路径保留，
  // 项目根按项目分组、替换旧映射，并在超出项目上限时驱逐最旧项目。
  async observeRoots(roots: readonly SkillRoot[]): Promise<void> {
    if (this.closing) return
    const projectRoots = new Map<string, SkillRoot[]>()
    const pending: Promise<void>[] = []
    for (const root of roots) {
      if (root.projectRoot === undefined) {
        pending.push(this.retainRoot(root, `shared:${root.path}`))
        continue
      }
      const grouped = projectRoots.get(root.projectRoot) ?? []
      grouped.push(root)
      projectRoots.set(root.projectRoot, grouped)
    }
    for (const [projectRoot, grouped] of projectRoots) {
      const owner = `project:${projectRoot}`
      this.projects.delete(projectRoot)
      const paths = new Set(grouped.map(root => root.path))
      this.projects.set(projectRoot, paths)
      for (const root of grouped) pending.push(this.retainRoot(root, owner))
    }
    let evictedProject = false
    while (this.projects.size > this.config.maxProjects) {
      const oldest = this.projects.entries().next()
      /* v8 ignore next -- the loop condition proves one project exists. */
      if (oldest.done) break
      const [projectRoot, paths] = oldest.value
      this.projects.delete(projectRoot)
      const owner = `project:${projectRoot}`
      for (const path of paths) pending.push(this.releaseRoot(path, owner))
      evictedProject = true
    }
    await Promise.all(pending)
    if (evictedProject) this.invalidate()
  }

  // 宿主工具变更路径后调用：若路径可能命中某个技能根，则失效目录。
  observeHostMutation(path: string): void {
    if (this.closing) return
    const normalized = resolve(path)
    if (![...this.roots.values()].some(state => isPotentialSkillPath(state.root, normalized))) return
    this.invalidate()
  }

  // 关闭全部监听器：置 closing、中止生命周期、逐个等 opening 结算并关闭 watcher。
  async dispose(): Promise<void> {
    this.closing = true
    this.lifecycle.abort(new Error('skill-filesystem watcher disposed'))
    const states = [...this.roots.values()]
    this.roots.clear()
    this.projects.clear()
    await Promise.all(states.map(async (state) => {
      await settleWatcherOpening(state.opening)
      const watcher = state.watcher
      state.watcher = undefined
      if (watcher !== undefined) await this.closeWatcher(watcher)
    }))
  }

  // 保留一个技能根：状态不存在则创建；增加一个持有者；必要时确保监听器就绪。
  private async retainRoot(root: SkillRoot, owner: string): Promise<void> {
    let state = this.roots.get(root.path)
    if (state === undefined) {
      state = { root, owners: new Set(), watcher: undefined, opening: undefined, unhealthy: true }
      this.roots.set(root.path, state)
    }
    state.owners.add(owner)
    if (this.config.enabled) await this.ensureWatcher(state)
  }

  // 释放一个技能根：移除持有者；无剩余持有者时删除状态并关闭监听器。
  private async releaseRoot(path: string, owner: string): Promise<void> {
    const state = this.roots.get(path)
    /* v8 ignore next -- Concurrent cwd observations can evict the same shared root before this release settles. */
    if (state === undefined) return
    state.owners.delete(owner)
    if (state.owners.size > 0) return
    this.roots.delete(path)
    await settleWatcherOpening(state.opening)
    const watcher = state.watcher
    state.watcher = undefined
    if (watcher !== undefined) await this.closeWatcher(watcher)
  }

  // 确保监听器就绪：已打开则复用，否则启动并记住打开中承诺。
  private ensureWatcher(state: RootWatchState): Promise<void> {
    /* v8 ignore next -- A scheduled rewatch can reach this guard only when teardown wins its await. */
    if (this.closing || !this.config.enabled) return Promise.resolve()
    if (state.opening !== undefined) return state.opening
    const opening = this.ensureCurrentWatcher(state)
    state.opening = opening
    void opening.then(
      () => {
        state.opening = undefined
      },
      () => {
        state.opening = undefined
      },
    )
    return opening
  }

  // 校验当前监听句柄是否仍匹配现状：不匹配（路径形态变化或健康标记置位）则重建。
  private async ensureCurrentWatcher(state: RootWatchState): Promise<void> {
    const watcher = state.watcher
    if (watcher !== undefined && !state.unhealthy) {
      const current = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
      // A child unlink can publish an empty catalog before root unlinkDir arrives.
      // Discovery therefore revalidates the retained handle independently.
      // 子项 unlink 可能在根 unlinkDir 到达前就发布空目录；
      // 因此发现流程会独立复核已保留的句柄。
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- watcher callbacks can mark unhealthy while the probe awaits
      if (!state.unhealthy && sameWatchMode(watcher.mode, current)) return
    }
    await this.replaceWatcher(state)
  }

  // 关闭旧监听器并打开新的稳定监听器；打开期间销毁则安全返回。
  private async replaceWatcher(state: RootWatchState): Promise<void> {
    const previous = state.watcher
    state.watcher = undefined
    if (previous !== undefined) await this.closeWatcher(previous)
    /* v8 ignore next -- Teardown can win while an unhealthy watcher is still closing. */
    if (this.closing || state.owners.size === 0) return
    try {
      const watcher = await this.openStableWatcher(state)
      /* v8 ignore next -- The loop returns no handle only when teardown wins between awaited probes. */
      if (watcher === undefined) return
      /* v8 ignore start -- Post-open teardown is timing-dependent; the disposal race has an explicit integration test. */
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- teardown can race awaited watcher startup
      if (this.closing || state.owners.size === 0) {
        await this.closeWatcher(watcher)
        return
      }
      /* v8 ignore stop */
      state.watcher = watcher
      state.unhealthy = false
    } catch (error) {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- teardown can race awaited watcher startup
      if (!this.closing) {
        state.unhealthy = true
        this.ctx.logger.warn(`skill-filesystem: failed to watch ${state.root.path}: ${errorMessage(error)}`)
      }
      throw error
    }
  }

  // TODO(file-watch-service): Extract Chokidar and missing-root observation below into a Cordis
  // service; keep skill filtering and invalidation here.
  // TODO(file-watch-service)：把下面的 Chokidar 与"缺失根观测"抽成 Cordis 服务；
  // 技能过滤与失效逻辑保留在本类。
  private async openStableWatcher(state: RootWatchState): Promise<WatchHandle | undefined> {
    while (!this.closing && state.owners.size > 0) {
      const mode = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
      const watcher = mode.kind === 'ancestor'
        ? this.openAncestorWatcher(state, mode)
        : await this.openRootWatcher(state, mode)
      const current = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
      /* v8 ignore else -- A host path transition between the two probes is timing-dependent. */
      if (sameWatchMode(mode, current)) return watcher
      /* v8 ignore next -- Covered by the same host path transition guard. */
      await this.closeWatcher(watcher)
    }
    /* v8 ignore next -- The loop exits only when teardown wins between awaited probes. */
    return undefined
  }

  // 祖先模式监听：根目录尚不存在时，watchFile 监听"根即将出现的下一段路径"。
  private openAncestorWatcher(state: RootWatchState, mode: Extract<RootWatchMode, { kind: 'ancestor' }>): WatchHandle {
    const listener = (_current: Stats, _previous: Stats): void => {
      void this.handleAncestorWatchEvent(state, mode)
    }
    watchFile(mode.nextPath, {
      persistent: false,
      interval: this.config.pollIntervalMs,
    }, listener)
    return {
      mode,
      close() {
        unwatchFile(mode.nextPath, listener)
      },
    }
  }

  // 祖先路径变化：重新解析模式；若形态已变则失效、标记不健康并安排重监听。
  private async handleAncestorWatchEvent(
    state: RootWatchState,
    mode: Extract<RootWatchMode, { kind: 'ancestor' }>,
  ): Promise<void> {
    let current: RootWatchMode
    try {
      current = await resolveRootWatchMode(state.root.path, this.config.followSymlinks)
    } catch (error) {
      /* v8 ignore start -- Non-absence stat failures need a platform permission or I/O fault. */
      if (!this.closing && state.owners.size > 0) this.handleWatcherError(state, error)
      return
      /* v8 ignore stop */
    }
    if (this.closing || state.owners.size === 0 || sameWatchMode(mode, current)) return
    this.queueInvalidation()
    state.unhealthy = true
    this.scheduleRewatch(state)
  }

  // 根模式监听：用 Chokidar 监听根目录，等待 ready 事件后返回句柄。
  private async openRootWatcher(state: RootWatchState, mode: Extract<RootWatchMode, { kind: 'root' }>): Promise<WatchHandle> {
    const watcher = chokidar.watch(mode.anchor, {
      // Chokidar owns late native fs.watch errors only for persistent watchers;
      // this provider's effect explicitly closes every handle at teardown.
      // Chokidar 只为持久监听器承担迟到的原生 fs.watch 错误；
      // 本提供方的 effect 会在销毁时显式关闭每个句柄。
      persistent: true,
      ignoreInitial: true,
      depth: 1,
      followSymlinks: this.config.followSymlinks,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: this.config.stabilityThresholdMs,
        pollInterval: this.config.pollIntervalMs,
      },
      usePolling: this.config.usePolling,
      interval: this.config.pollIntervalMs,
    })
    const handle: WatchHandle = {
      mode,
      close: () => watcher.close(),
    }
    let ready = false
    const readiness = Promise.withResolvers<undefined>()
    const signal = this.lifecycle.signal
    if (signal.aborted) {
      await this.closeWatcher(handle)
      signal.throwIfAborted()
    }
    const onAbort = (): void => { readiness.reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    const onError = (error: unknown): void => {
      if (!ready) {
        readiness.reject(error)
        return
      }
      this.handleWatcherError(state, error)
    }
    watcher.on('error', onError)
    watcher.once('ready', () => {
      ready = true
      readiness.resolve(undefined)
    })
    for (const event of ['add', 'addDir', 'change', 'unlink', 'unlinkDir'] as const) {
      watcher.on(event, (path) => { this.handleWatchEvent(state, mode, event, path) })
    }
    try {
      await readiness.promise
    } catch (error) {
      await this.closeWatcher(handle)
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
    return handle
  }

  // 处理单个监听事件：与技能根相关才失效；根被删除则标记不健康并安排重监听。
  private handleWatchEvent(
    state: RootWatchState,
    mode: Extract<RootWatchMode, { kind: 'root' }>,
    event: SkillWatchEvent,
    path: string,
  ): void {
    const target = resolve(path)
    if (this.closing || !isRelevantWatchEvent({ ...state.root, path: mode.anchor }, event, target)) return
    this.queueInvalidation()
    if (target === mode.anchor && event === 'unlinkDir') {
      state.unhealthy = true
      this.scheduleRewatch(state)
    }
  }

  // 监听器出错：记警告、标记不健康、失效并安排重监听。
  private handleWatcherError(state: RootWatchState, error: unknown): void {
    if (this.closing) return
    this.ctx.logger.warn(`skill-filesystem: watcher for ${state.root.path} failed: ${errorMessage(error)}`)
    state.unhealthy = true
    this.queueInvalidation()
    this.scheduleRewatch(state)
  }

  // 安排一次重监听：等当前打开结算后重新 ensureWatcher，再失效。
  private scheduleRewatch(state: RootWatchState): void {
    const currentOpening = state.opening ?? Promise.resolve()
    void (async () => {
      await settleWatcherOpening(currentOpening)
      try {
        await this.ensureWatcher(state)
      } catch {
        // Watch startup logged the retry failure; the next incomplete discovery retries it again.
        // 监听启动已记录重试失败；下一次不完整发现会再次重试。
        return
      }
      this.queueInvalidation()
    })()
  }

  // 以微任务合并同批次失效通知（避免高频事件风暴）。
  private queueInvalidation(): void {
    if (this.closing || this.invalidationQueued) return
    this.invalidationQueued = true
    queueMicrotask(() => {
      this.invalidationQueued = false
      /* v8 ignore next -- Effect teardown can win this queued microtask before provider disposal emits. */
      if (this.closing) return
      this.invalidate()
    })
  }

  // 关闭监听器并包住关闭错误。
  private async closeWatcher(watcher: WatchHandle): Promise<void> {
    try {
      await watcher.close()
    } catch (error) {
      this.ctx.logger.warn(`skill-filesystem: failed to close watcher: ${errorMessage(error)}`)
    }
  }
}

// 等一次"打开中承诺"结算（吞掉其失败，失败已在打开路径记录过）。
async function settleWatcherOpening(opening: Promise<void> | undefined): Promise<void> {
  if (opening === undefined) return
  try {
    await opening
  } catch {
    // Watch startup already logged the underlying failure; teardown only contains it.
    // 监听启动已记录底层失败；销毁路径只负责包含它。
  }
}

// 解析监听配置并校验相关数值参数。
function resolveWatchConfig(config: Config): ResolvedWatchConfig {
  const stabilityThresholdMs = config.watchStabilityThresholdMs ?? DEFAULT_WATCH_STABILITY_THRESHOLD_MS
  const pollIntervalMs = config.watchPollIntervalMs ?? DEFAULT_WATCH_POLL_INTERVAL_MS
  const maxProjects = config.watchMaxProjects ?? DEFAULT_WATCH_MAX_PROJECTS
  assertPositiveInteger('watchStabilityThresholdMs', stabilityThresholdMs)
  assertPositiveInteger('watchPollIntervalMs', pollIntervalMs)
  assertPositiveInteger('watchMaxProjects', maxProjects)
  return {
    enabled: config.watch ?? true,
    usePolling: config.watchUsePolling ?? false,
    stabilityThresholdMs,
    pollIntervalMs,
    maxProjects,
    followSymlinks: config.watchFollowSymlinks ?? true,
  }
}

// 解析根目录的监听模式：存在则 root 模式（保留符号链接或规范化路径），
// 不存在则向上找最近存在的祖先并返回 ancestor 模式。
async function resolveRootWatchMode(root: string, followSymlinks: boolean): Promise<RootWatchMode> {
  let candidate = root
  while (true) {
    try {
      const info = await stat(candidate)
      if (info.isDirectory()) {
        const preserveRootLink = candidate === root
          && !followSymlinks
          && (await lstat(candidate)).isSymbolicLink()
        const anchor = preserveRootLink ? resolve(candidate) : await canonicalizeWatchPath(candidate)
        if (candidate === root) return { kind: 'root', anchor }
        const firstSegment = relative(candidate, root).split(sep)[0]
        /* v8 ignore next -- candidate is a strict ancestor of root. */
        if (firstSegment === undefined || firstSegment.length === 0) return { kind: 'root', anchor }
        return { kind: 'ancestor', anchor, nextPath: join(anchor, firstSegment) }
      }
    } catch (error) {
      /* v8 ignore next -- Non-absence stat failures are platform/permission-specific and propagate as incomplete discovery. */
      if (!isAbsentPathError(error)) throw error
    }
    const parent = dirname(candidate)
    /* v8 ignore next -- Traversal reaches the existing filesystem root before this fallback. */
    if (parent === candidate) return { kind: 'ancestor', anchor: candidate, nextPath: root }
    candidate = parent
  }
}

// 两种监听模式是否等价。
function sameWatchMode(left: RootWatchMode, right: RootWatchMode): boolean {
  return left.kind === right.kind
    && left.anchor === right.anchor
    && (left.kind === 'root' || (right.kind === 'ancestor' && left.nextPath === right.nextPath))
}

// 事件路径是否与技能根相关（用于过滤无关文件系统噪声）。
function isRelevantWatchEvent(
  root: SkillRoot,
  event: SkillWatchEvent,
  path: string,
): boolean {
  const segments = containedSegments(root.path, path)
  if (segments === undefined) return false
  if (segments.length === 0) return event === 'addDir' || event === 'unlinkDir'
  if (root.skipSystem === true && segments[0] === '.system') return false
  if (segments.length === 1) {
    if (event === 'addDir' || event === 'unlinkDir') return true
    return segments[0]?.endsWith('.md') === true
  }
  return segments.length === 2
    && segments[1] === 'SKILL.md'
    && event !== 'addDir'
    && event !== 'unlinkDir'
}

// 路径是否可能命中某个技能（宿主变更失效用的快速判定）。
function isPotentialSkillPath(root: SkillRoot, path: string): boolean {
  const segments = containedSegments(root.path, path)
  if (segments === undefined || segments.length === 0 || segments.length > 2) return false
  if (root.skipSystem === true && segments[0] === '.system') return false
  return segments.length === 1
    ? segments[0]?.endsWith('.md') === true
    : segments[1] === 'SKILL.md'
}

// 计算 path 相对 root 的路径段；不在根内时返回 undefined。
function containedSegments(root: string, path: string): string[] | undefined {
  const child = relative(root, path)
  if (child.length === 0) return []
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) return undefined
  return child.split(sep)
}

// 识别宿主变更的发起工具：只认 edit / write。
function mutationToolName(actor: object | undefined): 'edit' | 'write' | undefined {
  if (actor === undefined || !('name' in actor)) return undefined
  const value = actor.name
  return value === 'edit' || value === 'write' ? value : undefined
}

// 校验正整数配置。
function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`skill-filesystem: ${field} must be a positive integer`)
  }
}

// 是否为"路径不存在"类错误（ENOENT / ENOTDIR）。
function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')
}

// 是否为"技能路径不存在"类错误（含 ctx.fs 的自定义错误码）。
function isAbsentSkillPathError(error: unknown): boolean {
  return isAbsentPathError(error)
    || hasErrorCode(error, 'FS_NOT_FOUND')
    || hasErrorCode(error, 'FS_NOT_DIRECTORY')
}

// 判断错误对象是否带指定 code。
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

// 发现一个技能根下的全部技能候选（目录包或扁平 .md 文件）。
async function discoverRoot(root: SkillRoot, ctx: Context, provider: string): Promise<SkillCandidate[]> {
  const skills: SkillCandidate[] = []
  const entries = await listSkillRootEntries(root, ctx)
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (root.skipSystem && entry.name === '.system') continue
    const locator = entry.type === 'directory'
      ? { path: join(entry.path, 'SKILL.md'), directory: entry.path }
      : entry.type === 'file' && entry.name.endsWith('.md')
        ? { path: entry.path, directory: root.path }
        : undefined
    if (locator === undefined) continue
    const parsed = await parseSkillFile(locator.path, ctx, undefined, root.trustedHost === true)
    if (parsed === undefined) continue
    skills.push({
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
      invocation: parsed.invocation,
      provider,
      source: root.source,
      rank: root.rank,
      locator,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: locator.path,
      ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
    })
  }
  return skills
}

// 列出技能根的目录条目：优先走 ctx.fs（受策略约束），否则走 Node 原生 readdir。
async function listSkillRootEntries(root: SkillRoot, ctx: Context): Promise<SkillRootEntry[]> {
  const fs = optionalFileSystem(ctx)
  if (fs !== undefined && root.trustedHost !== true) return await listSkillRootEntriesFromFileSystem(root, fs)
  return await listSkillRootEntriesFromNode(root, ctx)
}

// 经 ctx.fs 列目录：路径不存在视为空目录而非错误。
async function listSkillRootEntriesFromFileSystem(root: SkillRoot, fs: FileSystem): Promise<SkillRootEntry[]> {
  try {
    return (await fsListDir(fs, root.path)).map(entryFromFs)
  } catch (error) {
    if (isAbsentSkillPathError(error)) return []
    throw error
  }
}

// 解析路径并列出目录（ctx.fs 的封装）。
async function fsListDir(fs: FileSystem, path: string): Promise<FsDirEntry[]> {
  const target = await fs.resolve(path)
  return await fs.listDir(target)
}

// 把 ctx.fs 的目录条目转为内部条目。
function entryFromFs(entry: FsDirEntry): SkillRootEntry {
  return { name: entry.name, type: entry.type, path: entry.target.displayPath }
}

// 用 Node 原生 readdir 列目录，并逐个判定条目类型（跟随符号链接）。
async function listSkillRootEntriesFromNode(root: SkillRoot, ctx: Context): Promise<SkillRootEntry[]> {
  let entries
  try {
    entries = await readdir(root.path, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    /* v8 ignore else -- Native non-absence directory failures are provider-dependent; the ctx.fs path pins incomplete discovery. */
    if (isAbsentSkillPathError(error)) return []
    /* v8 ignore next -- Same native error branch as above. */
    throw error
  }

  const result: SkillRootEntry[] = []
  for (const entry of entries) {
    const path = join(root.path, entry.name)
    const type = await nodeEntryKind(path, entry, ctx)
    result.push({ name: entry.name, type: type ?? 'other', path })
  }
  return result
}

// 解析一份技能文件：读文本 → 校验 frontmatter → 提取名称/描述/调用策略/正文。
async function parseSkillFile(path: string, ctx: Context, signal?: AbortSignal, trustedHost = false): Promise<ParsedSkill | undefined> {
  const raw = await readSkillText(ctx, path, signal, trustedHost)
  signal?.throwIfAborted()
  if (raw === undefined) {
    return undefined
  }
  let parsed
  try {
    parsed = parseFrontmatter(raw)
  } catch (error) {
    ctx.logger.warn(`skill file ${path} ignored: invalid YAML frontmatter: ${errorMessage(error)}`)
    return undefined
  }
  if (!parsed) {
    ctx.logger.warn(`skill file ${path} ignored: missing YAML frontmatter`)
    return undefined
  }
  const name = stringField(parsed.data, 'name')
  const description = stringField(parsed.data, 'description')
  if (name === undefined || description === undefined) {
    ctx.logger.warn(`skill file ${path} ignored: frontmatter requires name and description`)
    return undefined
  }
  if (!isSkillName(name)) {
    ctx.logger.warn(`skill file ${path} ignored: invalid skill name "${name}"`)
    return undefined
  }
  let invocation
  try {
    invocation = parseInvocationPolicy(parsed.data)
  } catch (error) {
    ctx.logger.warn(`skill file ${path} ignored: invalid invocation frontmatter: ${errorMessage(error)}`)
    return undefined
  }
  return {
    name,
    description,
    ...optionalString(parsed.data, 'whenToUse'),
    invocation,
    ...optionalMetadata(parsed.data),
    content: parsed.body.trim(),
  }
}

// 取 ctx.fs 服务（可能不存在）。
function optionalFileSystem(ctx: Context): FileSystem | undefined {
  return ctx.get('fs')
}

// 读取技能文件文本：优先经 ctx.fs（非可信宿主时），否则走 Node 原生 readFile。
async function readSkillText(ctx: Context, path: string, signal?: AbortSignal, trustedHost = false): Promise<string | undefined> {
  signal?.throwIfAborted()
  const fs = optionalFileSystem(ctx)
  if (fs !== undefined && !trustedHost) {
    return await readSkillTextFromFileSystem(ctx, fs, path, signal)
  }
  try {
    return await readFile(path, { encoding: 'utf8', signal })
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentSkillPathError(error)) return undefined
    throw error
  }
}

// 经 ctx.fs 读取文本：缺失/暂不可达/非文本都安全处理，返回 undefined 或文本。
async function readSkillTextFromFileSystem(ctx: Context, fs: FileSystem, path: string, signal?: AbortSignal): Promise<string | undefined> {
  // A missing or temporarily inaccessible skill file is not fatal to discovery.
  // 缺失或暂时不可访问的技能文件对发现不是致命的。
  signal?.throwIfAborted()
  let target
  try {
    target = await fs.resolve(path)
  } catch (error) {
    if (isAbsentSkillPathError(error)) return undefined
    throw error
  }
  signal?.throwIfAborted()
  let info
  try {
    info = await fs.stat(target, signal)
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentSkillPathError(error)) return undefined
    throw error
  }
  if (info === undefined || info.type !== 'file') return undefined
  try {
    return await fs.readText(target, signal)
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentSkillPathError(error)) return undefined
    if (!hasErrorCode(error, 'FS_NOT_TEXT')) throw error
    ctx.logger.warn(`skill file ${path} ignored: ${fsReadErrorMessage(target, error)}`)
    return undefined
  }
}

// 构造 ctx.fs 读文本失败的日志文案。
function fsReadErrorMessage(target: FsTarget, error: unknown): string {
  return `failed to read text file at ${target.displayPath}: ${errorMessage(error)}`
}

// 判定 Node 目录条目的类型：目录/文件/其它；符号链接跟随其目标。
async function nodeEntryKind(fullPath: string, entry: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }, ctx: Context): Promise<'directory' | 'file' | undefined> {
  if (entry.isDirectory()) return 'directory'
  if (entry.isFile()) return 'file'
  /* v8 ignore next -- Non-file directory entries such as FIFOs are platform-specific and intentionally skipped. */
  if (!entry.isSymbolicLink()) return undefined
  try {
    const info = await stat(fullPath)
    if (info.isDirectory()) return 'directory'
    /* v8 ignore else -- the special-file symlink branch relies on POSIX /dev/null. */
    if (info.isFile()) return 'file'
    /* v8 ignore next -- The special-file symlink fixture relies on POSIX /dev/null. */
    return undefined
  } catch (error) {
    ctx.logger.warn(`skill entry ${fullPath} ignored: failed to follow symbolic link: ${errorMessage(error)}`)
    return undefined
  }
}

// 解析 YAML frontmatter：首行必须是 ---，找到闭合行后把中间段交给 yaml 解析。
function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  const yaml = raw.slice(start, closing.start)
  const parsed = parseYaml(yaml) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed as Record<string, unknown>, body: raw.slice(closing.bodyStart) }
}

// 逐行寻找 frontmatter 的闭合 --- 行。
function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
}

// 从 cwd 向上寻找含 .git 的目录作为项目根；找不到则回退 cwd 本身。
async function findProjectRoot(cwd: string, fs: FileSystem | undefined): Promise<string> {
  let current = cwd
  while (true) {
    if (await pathExists(join(current, '.git'), fs)) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

// 路径是否存在（按可用后端分派）。
async function pathExists(path: string, fs: FileSystem | undefined): Promise<boolean> {
  if (fs !== undefined) {
    return await pathExistsInFileSystem(path, fs)
  }
  return await pathExistsInNode(path)
}

// 经 ctx.fs 判断路径是否存在：解析/stat 失败一律视为不存在并继续向上走。
async function pathExistsInFileSystem(path: string, fs: FileSystem): Promise<boolean> {
  let target
  try {
    target = await fs.resolve(path)
  } catch {
    // A backend may reject or hide this candidate; continue walking upward.
    // 后端可能拒绝或隐藏该候选；继续向上走。
    return false
  }
  try {
    return await fs.stat(target) !== undefined
  } catch {
    // Transient stat failures make only this git-root candidate unusable.
    // 瞬时 stat 失败只会让这一个 git 根候选不可用。
    return false
  }
}

// 用 Node access 判断路径是否存在。
async function pathExistsInNode(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // Missing host paths are expected while walking toward the filesystem root.
    // 向文件系统根走的过程中，缺失的宿主路径是常态。
    return false
  }
}

// 取 frontmatter 中的字符串字段（非空字符串才有效）。
function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

// 取可选字符串字段：有效则返回含该字段的对象，否则返回空对象。
function optionalString(data: Record<string, unknown>, key: string): { [K in typeof key]?: string } {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {}
}

// 解析调用策略 frontmatter：拒绝旧键、支持布尔/数字/字符串多种写法。
function parseInvocationPolicy(data: Record<string, unknown>): SkillInvocationPolicy {
  rejectLegacyInvocationKey(data, 'disableModelInvocation', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'modelInvocable', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'userInvocable', 'user-invocable')
  const disableModelInvocation = frontmatterBoolean(data, 'disable-model-invocation')
  const userInvocable = frontmatterBoolean(data, 'user-invocable')
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

// 拒绝已废弃的 frontmatter 键：提示用户改用规范键名。
function rejectLegacyInvocationKey(data: Record<string, unknown>, legacy: string, canonical: string): void {
  if (Object.hasOwn(data, legacy)) {
    throw new Error(`frontmatter field "${legacy}" is unsupported; use "${canonical}"`)
  }
}

// 把 frontmatter 字段解析为布尔：接受 true/false、1/0、以及常见字符串写法。
function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

// 取可选 metadata 字段：仅当其为普通对象时有效。
function optionalMetadata(data: Record<string, unknown>): { metadata?: Record<string, unknown> } {
  const value = data.metadata
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { metadata: value as Record<string, unknown> }
  }
  return {}
}

// 把任意错误渲染为字符串。
function errorMessage(error: unknown): string {
  return String(error)
}
