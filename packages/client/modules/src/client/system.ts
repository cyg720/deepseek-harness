/*
 * ================================ 文件注释 ================================
 * 【文件职责】ClientModuleSystem——ClientModuleLoader 契约背后的实现：
 *   状态表 + 到达（加载/注册）/物化机制。
 * 【技术维度】懒 CJS 模型：执行 bundle 只注册工厂，副作用（含 CSS 注入）
 *   在物化时运行；materialize 有重入守卫（工厂形 CJS 无法交付部分导出，
 *   环是致命的）；到达按图行递归处理 external 依赖。
 * 【产品维度】浏览器端插件加载：import 解析 seed/记录/图行/工厂四分支；
 *   prefetch 做一阶段脚本预载；invalidate 供 HMR 全量重置。
 * 【逻辑维度】构造函数索引启动行、保留 bootstrap 模块、切换注册门面；
 *   register/arrive/arriveGraphRow 管到达；materialize/makeRequire 管
 *   物化；import/prefetch/invalidate 是契约面。
 * 【关键边界】require 同步，因此动态包必须先于其消费方到达；重复工厂
 *   注册抛错（未 invalidate 就重执行 bundle）；图环在到达时 fail-loud。
 * 【新手阅读建议】先读 manifest.ts 的契约文档，再看本文件状态表。
 * ==========================================================================
 */
/**
 * ClientModuleSystem — the implementation behind the {@link ClientModuleLoader}
 * contract. The conceptual contract (lazy CJS model, resolution branch order) is
 * documented on the public interfaces in `./manifest.ts`; this file owns the
 * state tables and the load/materialize machinery.
 */
/*
 * ClientModuleSystem——ClientModuleLoader 契约背后的实现。概念契约（懒 CJS
 * 模型、解析分支顺序）记录在 ./manifest.ts 的公开接口上；本文件拥有状态
 * 表与加载/物化机制。
 */
import { stripClientSuffix } from './manifest.ts'
import type {
  BootManifest, BootModuleRow, ClientBundleRegistration, ClientModuleLoader, ClientModuleRecord,
  ClientModuleSystemOptions,
} from './manifest.ts'

/** Default bundle-load hook: same-origin external classic script. */
/* 默认 bundle 加载钩子：同源外部经典脚本。 */
const defaultLoadBundle = (url: string): Promise<void> => new Promise((resolve, reject) => {
  const el = document.createElement('script')
  el.async = true
  el.src = url
  el.addEventListener('load', () => {
    el.remove()
    resolve()
  }, { once: true })
  el.addEventListener('error', () => {
    el.remove()
    reject(new Error(`client-modules: bundle script ${url} failed to load`))
  }, { once: true })
  document.head.append(el)
})

/**
 * Claim and inventory the <style> tags a factory injected during
 * materialization: preset-emitted tags arrive pre-tagged with data-plugin;
 * any untagged tag is claimed for the materializing plugin (HMR bookkeeping).
 */
/*
 * 认领并盘点工厂在物化期间注入的 <style> 标签：预设发射的标签自带
 * data-plugin；任何未带标签的标签被认领给物化插件（HMR 记账）。
 */
const claimStyles = (id: string): string[] => {
  if (typeof document === 'undefined') return []
  for (const el of document.querySelectorAll('style:not([data-plugin])')) {
    el.setAttribute('data-plugin', id)
  }
  const owned: string[] = []
  for (const el of document.querySelectorAll(`style[data-plugin=${JSON.stringify(id)}]`)) {
    owned.push(el.getAttribute('data-plugin-css') ?? id)
  }
  return owned
}

/**
 * The client module system: state tables plus the arrival/materialization
 * machinery implementing {@link ClientModuleLoader} (whose members carry the
 * contract documentation). Construction indexes the boot rows, retains the
 * already-materialized bootstrap module, and switches the HTML-installed
 * loader facade from its pending queue to live registration.
 */
/*
 * 客户端模块系统：状态表 + 实现 ClientModuleLoader 的到达/物化机制
 * （其成员携带契约文档）。构造时索引启动行、保留已物化的 bootstrap 模块，
 * 并把 HTML 安装的 loader 门面从待处理队列切换为实时注册。
 */
export class ClientModuleSystem implements ClientModuleLoader {
  readonly version = 'client'
  readonly manifest: BootManifest
  readonly loadCache = new Map<string, ClientModuleRecord>()

  private readonly seed: Map<string, unknown> // 平台种子表：说明符 -> shell 实例
  private readonly factories = new Map<string, ClientBundleRegistration['factory']>() // 已注册工厂表
  private readonly bootstrapIds = new Set<string>() // bootstrap 模块 id（不可 invalidate）
  /** In-flight prefetch (script load) per id; concurrent callers share it. */
  /* 每 id 进行中的预取（脚本加载）；并发调用方共享它。 */
  private readonly pendingArrival = new Map<string, Promise<void>>()
  /** Materialization re-entrancy guard: factory-form CJS cannot deliver partial exports, so a cycle is fatal. */
  /* 物化重入守卫：工厂形 CJS 无法交付部分导出，因此环是致命的。 */
  private readonly materializing = new Set<string>()
  private readonly graphRows = new Map<string, BootModuleRow>() // 启动图行：id -> 行
  private readonly loadBundle: (url: string) => Promise<void>

  /**
   * Build the module system over the parsed boot rows.
   * @param options - Parsed graph, platform seed, bootstrap module, registration facade, and transport.
   */
  /*
   * 在解析后的启动行上构建模块系统。
   * @param options 解析图、平台种子、bootstrap 模块、注册门面与传输。
   */
  constructor(options: ClientModuleSystemOptions) {
    this.manifest = options.manifest
    this.seed = new Map(Object.entries(options.staticModules))
    this.loadBundle = options.loadBundle ?? defaultLoadBundle

    for (const row of options.manifest.modules) {
      if (this.graphRows.has(row.id)) throw new Error(`client-modules: duplicate graph entry "${row.id}"`)
      this.graphRows.set(row.id, row)
    }

    const bootstrapId = stripClientSuffix(options.bootstrapModule.id)
    this.bootstrapIds.add(bootstrapId)
    this.loadCache.set(bootstrapId, {
      id: bootstrapId,
      exports: options.bootstrapModule.exports,
      styles: [],
      edges: new Set(),
    })

    const target = options.registrationTarget
    if (target.mode !== 'queue') {
      throw new Error('client-modules: window.__ModuleLoader__.create called after module-system boot')
    }
    const pending = target.pendingQueue.splice(0)
    // Switch first: a bundle that executes while pending registrations drain
    // must register live rather than append behind the drain.
    // 先切换：在待处理注册排空期间执行的 bundle 必须实时注册，而不是排在
    // 排空之后。
    target.mode = 'live'
    target.load = (registration) => { this.register(registration) }
    for (const registration of pending) target.load(registration)
  }

  /** Register one bundle factory, rejecting a script that executes twice without invalidation. */
  /* 注册一个 bundle 工厂；拒绝未经 invalidate 就二次执行的脚本。 */
  private register(registration: ClientBundleRegistration): void {
    const id = stripClientSuffix(registration.id)
    if (this.bootstrapIds.has(id) || this.factories.has(id)) {
      throw new Error(`client-modules: duplicate factory registration for "${registration.id}" (bundle executed twice without invalidate?)`)
    }
    this.factories.set(id, registration.factory)
  }

  /** Load one graph row so its factory is registered (idempotent per in-flight arrival). */
  /* 加载一个图行使工厂被注册（按在途到达幂等）。 */
  private arrive(row: BootModuleRow): Promise<void> {
    const { id, url } = row
    const pending = this.pendingArrival.get(id)
    if (pending !== undefined) return pending
    if (this.loadCache.has(id) || this.factories.has(id)) return Promise.resolve()
    const task = this.loadBundle(url).then(() => {
      if (!this.factories.has(id)) {
        throw new Error(`client-modules: bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load`)
      }
    }).finally(() => { this.pendingArrival.delete(id) })
    this.pendingArrival.set(id, task)
    return task
  }

  /** Register each unresolved dynamic request before registering its consumer. */
  /* 在注册消费方之前先注册每个未解析的动态请求。 */
  private async arriveGraphRow(row: BootModuleRow, open: readonly string[] = []): Promise<void> {
    const cycleStart = open.indexOf(row.id)
    if (cycleStart !== -1) {
      throw new Error(
        `client-modules: module arrival cycle ${[...open.slice(cycleStart), row.id].join(' -> ')} `
        + '(the host must reject this graph before serving it)',
      )
    }
    const next = [...open, row.id]
    for (const request of row.external) {
      const id = stripClientSuffix(request)
      if (this.seed.has(request) || this.loadCache.has(id)) continue
      const dependency = this.graphRows.get(id)
      if (dependency !== undefined) await this.arriveGraphRow(dependency, next)
    }
    await this.arrive(row)
  }

  /** Materialize a registered factory (synchronous; memoized in loadCache). */
  /* 物化一个已注册工厂（同步；在 loadCache 中记忆化）。 */
  private materialize(id: string): ClientModuleRecord {
    const existing = this.loadCache.get(id)
    if (existing !== undefined) return existing
    const registered = this.factories.get(id)
    /* v8 ignore next -- callers check the factory branch before dispatching here. */
    if (registered === undefined) throw new Error(`client-modules: no registered factory for "${id}"`)
    if (this.materializing.has(id)) {
      throw new Error(`client-modules: require cycle through "${id}" (factory-form CJS cannot deliver partial exports)`)
    }
    this.materializing.add(id)
    try {
      const edges = new Set<string>() // 物化期间观察到的 require 边
      const exports = registered(this.makeRequire(edges))
      const record: ClientModuleRecord = { id, exports, styles: claimStyles(id), edges }
      this.loadCache.set(id, record)
      return record
    } finally {
      this.materializing.delete(id)
    }
  }

  /**
   * The synchronous require answered to factories: seed → memoized record →
   * registered factory. Fetching is async and therefore unreachable
   * from here; an external dynamic package must have arrived before its
   * consumer materializes.
   */
  /*
   * 应答给工厂的同步 require：seed -> 记忆化记录 -> 已注册工厂。拉取是
   * 异步的，因此从这里不可达；外部动态包必须先于其消费方物化前到达。
   */
  private makeRequire(edges: Set<string>): (spec: string) => unknown {
    return (spec: string): unknown => {
      edges.add(spec)
      if (this.seed.has(spec)) return this.seed.get(spec)
      const id = stripClientSuffix(spec)
      const record = this.loadCache.get(id)
      if (record !== undefined) return record.exports
      if (this.factories.has(id)) return this.materialize(id).exports
      throw new Error(
        `client-modules: require("${spec}") missed the module table — not a platform seed word, not a materialized module, `
        + 'and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)',
      )
    }
  }

  /** 契约入口 import：按分支顺序解析（seed -> 记忆化 -> 图行 -> 工厂）。 */
  async import(specifier: string): Promise<unknown> {
    if (this.seed.has(specifier)) return this.seed.get(specifier)
    const id = stripClientSuffix(specifier)
    const existing = this.loadCache.get(id)
    if (existing !== undefined) return existing.exports
    const row = this.graphRows.get(id)
    if (row !== undefined) {
      await this.arriveGraphRow(row)
    } else if (!this.factories.has(id)) {
      throw new Error(
        `client-modules: cannot resolve "${specifier}" — not a seed word, not a materialized module, `
        + 'and not a row in the boot graph (the runtime mirror of the bundle purity gate)',
      )
    }
    return this.materialize(id).exports
  }

  /** 一阶段预取：加载图行的脚本以注册工厂（不物化）。 */
  async prefetch(id: string): Promise<void> {
    const normalized = stripClientSuffix(id)
    if (this.loadCache.has(normalized)) return
    const row = this.graphRows.get(normalized)
    if (row === undefined) throw new Error(`client-modules: prefetch("${id}") — not a graph entry`)
    await this.arriveGraphRow(row)
  }

  /** HMR 失效：丢弃非 bootstrap 模块的工厂与物化记录。 */
  invalidate(id: string): void {
    const normalized = stripClientSuffix(id)
    if (this.bootstrapIds.has(normalized)) return
    this.factories.delete(normalized)
    this.loadCache.delete(normalized)
  }
}
