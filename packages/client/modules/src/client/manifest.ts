/**
 * ================================ 文件注释 ================================
 * 【文件职责】客户端模块系统的浏览器安全契约面（零 node 导入）：__DSH_BOOT__
 *   线类型、启动清单解析器，以及 ClientModuleSystem 周围的边界。
 * 【技术维度】懒 CJS 表模型的概念契约（执行只注册工厂、副作用在物化时
 *   运行）；解析分支顺序（seed -> 记忆化 -> 图行 -> 工厂）。
 * 【产品维度】浏览器端插件 bundle 的加载/物化协议：vendored Loader 经
 *   internal 契约消费本对象（唯一调用点是 EntryTree.import -> internal.import），
 *   使条目治理（fiber 生命周期、inject 等待、更新/刷新）全在 vendored 侧。
 * 【逻辑维度】类型区（WebBootEntry/WebBootGraph/BootManifest/记录/门面）；
 *   工具函数（optionalStringArray/stripClientSuffix/parseBootManifest）；
 *   契约接口（ClientModuleLoader）与构建选项类型。
 * 【关键边界】resolve 分支"任何其他 -> 抛错"是构建期 bundle 纯净门的运行时
 *   镜像；加载异步，因此动态包必须先注册工厂才能被消费方物化。
 * 【新手阅读建议】先读模块级 doc，再读 ClientModuleLoader 契约。
 * ==========================================================================
 */
/**
 * Client module system: the browser peer of Node's internal ESM loader, built
 * as a lazy CJS table. The vendored cordis Loader consumes this object
 * through its `internal` contract (the only call site is `EntryTree.import` →
 * `internal.import`), which keeps entry governance (fiber lifecycle, inject
 * waiting, update/refresh) entirely on the vendored side while this package
 * owns code arrival.
 *
 * Lazy CJS model: executing a plugin bundle only REGISTERS its
 * factory (`window.__ModuleLoader__.load({id, factory})`); every module body
 * side effect — including CSS injection — lives inside the factory closure
 * and runs at materialization, not at script execution. Materialization
 * (factory(require) → exports) happens on first import/require and is
 * memoized in {@link ClientModuleLoader.loadCache}; a factory that requires
 * another registered-but-unmaterialized module materializes it recursively,
 * so load order needs no external sequencing.
 *
 * Resolution branch order (import): seed word → shell instance; memoized
 * record → exports; graph row → register its dependency factories and own
 * factory; registered factory → materialize; anything else → throw (loud —
 * the runtime mirror of the build-time bundle purity gate).
 * The synchronous `require` handed to factories walks the same order minus
 * the load branch. Loading is async, so a requested dynamic package must have
 * registered its factory before a consumer materializes.
 *
 * This file is the browser-safe contract face (zero node imports): the
 * `__DSH_BOOT__` wire types, the boot-manifest parser, and the boundaries around
 * {@link ClientModuleSystem}. The package root is the host-side service that
 * composes the wire.
 */
/**
 * 客户端模块系统：Node 内置 ESM loader 的浏览器对应物，构建为懒 CJS 表。
 * vendored cordis Loader 经其 internal 契约消费本对象（唯一调用点是
 * EntryTree.import -> internal.import），使条目治理（fiber 生命周期、
 * inject 等待、更新/刷新）完全留在 vendored 侧，而本包拥有代码到达。
 *
 * 懒 CJS 模型：执行插件 bundle 只注册其工厂
 * （window.__ModuleLoader__.load({id, factory})）；每个模块体副作用——
 * 含 CSS 注入——都活在工厂闭包内、在物化而非脚本执行时运行。物化
 * （factory(require) -> exports）发生在首次 import/require 时，并在
 * loadCache 中记忆化；要求另一个"已注册但未物化"模块的工厂会递归物化它，
 * 因此加载顺序无需外部排序。
 *
 * 解析分支顺序（import）：seed 词 -> shell 实例；记忆化记录 -> 导出；
 * 图行 -> 注册其依赖工厂与自身工厂；已注册工厂 -> 物化；任何其他 -> 抛错
 * （响亮——构建期 bundle 纯净门的运行时镜像）。
 * 交给工厂的同步 require 走同样顺序（去掉加载分支）。加载是异步的，
 * 因此被请求的动态包必须先注册其工厂，消费方才可物化。
 *
 * 本文件是浏览器安全契约面（零 node 导入）：__DSH_BOOT__ 线类型、
 * 启动清单解析器，以及 ClientModuleSystem 周围的边界。包根是组装线的
 * Host 侧服务。
 */

import type {} from '@deepseek-ai/cordis'
import type { ClientModuleSystem } from './system.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The client module system the web shell builds at boot (provided by the `./client` wrapper plugin). */
    /** web shell 启动时构建的客户端模块系统（由 ./client 包装插件提供）。 */
    modules: ClientModuleLoader
  }
}

/**
 * One composed client entry pushed by the host (a graph row). Wire
 * single source: the host node half (package root) produces this same shape.
 * `immediately` marks stage-one prefetch; `inject` is informational graph
 * metadata (the authoritative edges live in each package's `dsh.client`
 * declaration and reach fibers through entry creation). `external` carries
 * module-graph edges: unlike `inject`, they constrain code arrival because
 * `require` is synchronous (see {@link WebBootGraph.entries}).
 */
/**
 * Host 推送的一条组合客户端条目（图行）。线的单一来源：Host 节点半边
 * （包根）产出同一形状。immediately 标记一阶段预取；inject 是信息性图
 * 元数据（权威边活在每个包的 dsh.client 声明里，经条目创建到达 fiber）。
 * external 携带模块图边：与 inject 不同，它们约束代码到达，因为 require
 * 是同步的（见 WebBootGraph.entries）。
 */
export interface WebBootEntry {
  /** Entry name == package name. */
  /** 条目名 == 包名。 */
  id: string
  /** Bundle endpoint, '/plugins/<id>/client.js?rev=<rev>'. */
  /** bundle 端点：/plugins/<id>/client.js?rev=<rev>。 */
  url: string
  /** Bundle content hash (cache-busting consistency anchor). */
  /** bundle 内容哈希（缓存破坏一致性锚）。 */
  rev: string
  /** Package-name dependency edges, informational (preflight display / HMR diffing). */
  /** 包名依赖边，信息性（预检展示 / HMR 差异）。 */
  inject?: string[]
  /** Stage-one prefetch mark: load the script for factory registration during module-face boot. */
  /** 一阶段预取标记：模块面启动期间加载脚本以注册工厂。 */
  immediately?: boolean
  /** Non-baseline module specifiers this row requests; omitted when it requests none. */
  /** 本行请求的非基线模块说明符；无请求时省略。 */
  external?: string[]
}

/** The composed client entry graph the host injects as `window.__DSH_BOOT__`. */
/** Host 以 window.__DSH_BOOT__ 注入的组合客户端条目图。 */
export interface WebBootGraph {
  /** Consistency anchor over the whole graph (content + bundle hashes). */
  /** 整张图的一致性锚（内容 + bundle 哈希）。 */
  rev: string
  /**
   * Composed entries in module-graph order — a dynamic package row precedes
   * rows whose `external` requests that package. Cordis activation order is
   * unrelated and remains owned by fiber service waiting.
   */
  /**
   * 按模块图顺序的组合条目——动态包行先于其 external 请求该包的行。
   * Cordis 激活顺序与此无关，仍由 fiber 服务等待拥有。
   */
  entries: WebBootEntry[]
}

/** The npm-package view of one boot row: what the module table needs to fetch the bundle. */
/** 一个启动行的 npm 包视图：模块表拉取 bundle 所需的。 */
export interface BootModuleRow {
  /** Entry name == package name (module-table key). */
  /** 条目名 == 包名（模块表键）。 */
  id: string
  /** Bundle endpoint, '/plugins/<id>/client.js?rev=<rev>'. */
  /** bundle 端点：/plugins/<id>/client.js?rev=<rev>。 */
  url: string
  /** Bundle content hash. */
  /** bundle 内容哈希。 */
  rev: string
  /** Module specifiers this row requests from the module table ([] when the wire omits them). */
  /** 本行向模块表请求的模块说明符（线省略时为 []）。 */
  external: string[]
}

/** The cordis-plugin view of one boot row: what entry composition needs (optional wire fields normalized). */
/** 一个启动行的 cordis 插件视图：条目组合所需的（可选线字段已规范化）。 */
export interface BootPluginRow {
  /** Entry name == package name. */
  /** 条目名 == 包名。 */
  id: string
  /** Package-name dependency edges ([] when the wire omits them). */
  /** 包名依赖边（线省略时为 []）。 */
  inject: string[]
  /** Stage-one prefetch tier (false when the wire omits it). */
  /** 一阶段预取层级（线省略时为 false）。 */
  immediately: boolean
}

/** The parsed boot manifest: one wire, two consumer views. */
/** 解析后的启动清单：一条线，两个消费视图。 */
export interface BootManifest {
  /** Consistency anchor over the whole graph. */
  /** 整张图的一致性锚。 */
  rev: string
  /** Rows as the module table consumes them. */
  /** 模块表消费的行。 */
  modules: BootModuleRow[]
  /** Rows as entry composition consumes them. */
  /** 条目组合消费的行。 */
  plugins: BootPluginRow[]
}

/**
 * Validate an optional string-array field read from a `dsh.client` declaration
 * or from the boot wire.
 * @param subject - diagnostic prefix naming the package or the wire row.
 * @param field - field name as it appears in the diagnostic.
 * @param value - the raw field value.
 * @returns the validated array, or undefined when the field is absent.
 * @throws {Error} when the value is present but is not an array of strings.
 */
/**
 * 校验从 dsh.client 声明或启动线读取的可选字符串数组字段。
 * @param subject 命名包或线行的诊断前缀。
 * @param field 诊断中出现的字段名。
 * @param value 原始字段值。
 * @returns 校验后的数组；字段缺失时为 undefined。
 * @throws 值存在但不是字符串数组时抛出 Error。
 */
export function optionalStringArray(subject: string, field: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`client-modules: ${subject} ${field} must be a string array`)
  }
  return value as string[]
}

/**
 * Normalize a module specifier onto the graph row that owns it: a plugin bundle
 * IS its package's client half, so `<id>/client` (the exports subpath external
 * bundles emit) and the bare package name resolve to the same exports. Both the
 * require path and graph composition normalize here, which is what lets each
 * importing package request the subpath its own code imports.
 * @param spec - module specifier as a bundle requires it or a declaration spells it.
 * @returns the specifier with a trailing `/client` removed.
 */
/**
 * 把模块说明符规范到拥有它的图行：插件 bundle 就是其包的客户端半边，
 * 因此 <id>/client（外部 bundle 发射的导出子路径）与裸包名解析到同一
 * 导出。require 路径与图组合都在这里规范化——这使每个导入包可请求其
 * 自身代码导入的子路径。
 * @param spec bundle require 或声明拼写的模块说明符。
 * @returns 去掉结尾 /client 的说明符。
 */
export function stripClientSuffix(spec: string): string {
  return spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec
}

/**
 * Parse `window.__DSH_BOOT__` into the two consumer views. Wire boundary:
 * a missing or malformed graph throws (the shell shows the loud failure —
 * a page without a valid manifest cannot boot anything).
 * @param wire - the raw `window.__DSH_BOOT__` value.
 * @returns the manifest with optional plugin-view fields normalized.
 */
/**
 * 把 window.__DSH_BOOT__ 解析为两个消费视图。线上边界：缺失或畸形图会
 * 抛错（shell 展示响亮失败——没有有效清单的页面无法启动任何东西）。
 * @param wire 原始 window.__DSH_BOOT__ 值。
 * @returns 可选插件视图字段已规范化的清单。
 */
export function parseBootManifest(wire: unknown): BootManifest {
  if (typeof wire !== 'object' || wire === null) {
    throw new Error('client-modules: window.__DSH_BOOT__ is missing or not an object')
  }
  const graph = wire as Record<string, unknown>
  if (typeof graph.rev !== 'string') {
    throw new Error('client-modules: boot manifest rev must be a string')
  }
  if (!Array.isArray(graph.entries)) {
    throw new Error('client-modules: boot manifest entries must be an array')
  }
  const modules: BootModuleRow[] = []
  const plugins: BootPluginRow[] = []
  for (const value of graph.entries as unknown[]) {
    if (typeof value !== 'object' || value === null) {
      throw new Error('client-modules: boot manifest entry is not an object')
    }
    const row = value as Record<string, unknown>
    const where = typeof row.id === 'string' ? `"${row.id}"` : JSON.stringify(row)
    if (typeof row.id !== 'string' || typeof row.url !== 'string' || typeof row.rev !== 'string') {
      throw new Error(`client-modules: boot manifest entry ${where} must carry string id/url/rev`)
    }
    const subject = `boot manifest entry ${where}`
    const inject = optionalStringArray(subject, 'inject', row.inject)
    const external = optionalStringArray(subject, 'external', row.external)
    if (row.immediately !== undefined && typeof row.immediately !== 'boolean') {
      throw new Error(`client-modules: boot manifest entry ${where} immediately must be a boolean`)
    }
    modules.push({
      id: row.id,
      url: row.url,
      rev: row.rev,
      external: external === undefined ? [] : [...external],
    })
    plugins.push({
      id: row.id,
      inject: inject === undefined ? [] : [...inject],
      immediately: row.immediately === true,
    })
  }
  return { rev: graph.rev, modules, plugins }
}

/** One client bundle's factory registration submitted through `window.__ModuleLoader__.load`. */
/** 经 window.__ModuleLoader__.load 提交的一个客户端 bundle 工厂注册。 */
export interface ClientBundleRegistration {
  /** Plugin id (package name) — the registration key; must match the graph row being executed. */
  /** 插件 id（包名）——注册键；必须匹配正在执行的图行。 */
  id: string
  /**
   * Closure factory holding the whole bundle body: receives the synchronous
   * require bound to the module table and returns the bundle's exports. Runs
   * once, at materialization.
   */
  /**
   * 持有整个 bundle 体的闭包工厂：接收绑定到模块表的同步 require，返回
   * bundle 的导出。在物化时运行一次。
   */
  factory: (require: (spec: string) => unknown) => Record<string, unknown>
}

/** Inputs passed by the web entry when it creates the client module system. */
/** web 入口创建客户端模块系统时传入的输入。 */
export interface ClientModuleCreateOptions {
  /** Raw Host-injected boot graph; the modules bundle owns validation and projection. */
  /** 原始 Host 注入启动图；modules bundle 拥有校验与投影。 */
  boot: unknown
  /** Module-table seed: platform-singleton specifier → shell instance. */
  /** 模块表种子：平台单例说明符 -> shell 实例。 */
  staticModules: Record<string, unknown>
  /** Bundle-load hook. Defaults to a same-origin classic `<script src>` element. */
  /** bundle 加载钩子。默认是同源经典 <script src> 元素。 */
  loadBundle?: (url: string) => Promise<void>
}

/** The modules bundle after its factory has been materialized by the HTML bootstrap facade. */
/** 其工厂已被 HTML bootstrap 门面物化后的 modules bundle。 */
export interface ClientBootstrapModule {
  /** Graph/module id carried by the modules bundle registration. */
  /** modules bundle 注册携带的图/模块 id。 */
  id: string
  /** Materialized exports reused when Cordis later activates the modules entry. */
  /** 物化导出；Cordis 之后激活 modules 条目时复用。 */
  exports: Record<string, unknown>
}

/** Stable page-global facade: queues early bundle registrations, then registers them live. */
/** 稳定的页面全局门面：先排队早期 bundle 注册，之后实时注册。 */
export interface ClientModuleLoaderTarget {
  /** Queue before {@link create}; live registration after it returns. */
  /** create 前为 queue；其返回后为实时注册。 */
  mode: 'queue' | 'live'
  /** Registrations submitted by parser-preloaded scripts before the module system exists. */
  /** 模块系统存在前、解析器预载脚本提交的注册。 */
  pendingQueue: ClientBundleRegistration[]
  /** Queue or immediately register one bundle factory according to {@link mode}. */
  /** 按 mode 排队或立即注册一个 bundle 工厂。 */
  load(registration: ClientBundleRegistration): void
  /** Create the module system exactly once from the parser-preloaded modules bundle. */
  /** 从解析器预载的 modules bundle 恰好一次地创建模块系统。 */
  create(options: ClientModuleCreateOptions): ClientModuleSystem
}

/** Window API of the web boot protocol: the host-injected graph and registration facade. */
/** web 启动协议的 Window API：Host 注入的图与注册门面。 */
export interface DshWindow {
  /** Host-composed entry graph, injected before the shell bundle runs; wire-boundary raw until {@link parseBootManifest}. */
  /** Host 组合条目图，在 shell bundle 运行前注入；parseBootManifest 前保持线上边界原始态。 */
  __DSH_BOOT__?: unknown
  /** HTML-installed facade: a pending registration queue, then the live module-system target. */
  /** HTML 安装的门面：先是待处理注册队列，之后是实时模块系统目标。 */
  __ModuleLoader__?: ClientModuleLoaderTarget
}

/** Per-module bookkeeping in {@link ClientModuleLoader.loadCache} (module-graph boundary, flat today). */
/** loadCache 中的每模块记账（模块图边界，当前为扁平）。 */
export interface ClientModuleRecord {
  /** Module id (entry name / package name). */
  /** 模块 id（条目名 / 包名）。 */
  id: string
  /** Materialized exports (`module.exports` from a factory or bootstrap registration). */
  /** 物化导出（来自工厂或 bootstrap 注册的 module.exports）。 */
  exports: unknown
  /** Owned `<style data-plugin>` tag ids (`data-plugin-css` values) injected during materialization. */
  /** 物化期间注入的属主 <style data-plugin> 标签 id（data-plugin-css 值）。 */
  styles: string[]
  /** Observed `require()` edges (module-graph boundary; only table words can appear today). */
  /** 观察到的 require() 边（模块图边界；当前只可出现表词）。 */
  edges: Set<string>
}

/**
 * The internal-contract subset the vendored Loader and the client HMR plugin
 * consume. Mounted on `ctx.loader.internal` by the shell boot and provided
 * as `ctx.modules`.
 */
/**
 * vendored Loader 与客户端 HMR 插件消费的 internal 契约子集。由 shell 启动
 * 挂在 ctx.loader.internal 上，并以 ctx.modules 提供。
 */
export interface ClientModuleLoader {
  /** Discriminant against Node's internal loader shapes ('v1'/'v2'). */
  /** 与 Node 内置 loader 形状区分的判别（'v1'/'v2' 之外）。 */
  version: 'client'
  /** Parsed Host boot graph shared with the web entry after module-system creation. */
  /** 解析后的 Host 启动图；模块系统创建后与 web 入口共享。 */
  manifest: BootManifest
  /** Materialized-module registry: id → record. The governance-side read API for entry exports. */
  /** 物化模块注册表：id -> 记录。治理侧读条目导出的 API。 */
  loadCache: Map<string, ClientModuleRecord>
  /**
   * Internal contract consumed by the vendored Loader's `tree.import`. Resolves
   * `specifier` through the branch order documented on the module, fetching
   * and executing a bundle when needed.
   * @param specifier - module specifier (entry name or table word).
   * @param parentURL - importer URL (unused — the client module graph is flat).
   * @param attrs - Import attributes (unused; interface parity with Node's loader contract).
   * @returns the module's exports.
   */
  /**
   * vendored Loader 的 tree.import 消费的 internal 契约。按模块文档的分支
   * 顺序解析 specifier，需要时拉取并执行 bundle。
   * @param specifier 模块说明符（条目名或表词）。
   * @param parentURL 导入者 URL（未用——客户端模块图是扁平的）。
   * @param attrs 导入属性（未用；与 Node loader 契约的接口对齐）。
   * @returns 模块的导出。
   */
  import(specifier: string, parentURL: string, attrs: Record<string, unknown>): Promise<unknown>
  /**
   * Stage-one arrival: load the entry's declared dynamic requests, then its
   * own script, to register their factories (no materialization — module side
   * effects wait for import).
   * No-op for materialized bootstrap ids. A registered graph row still
   * registers any unresolved declared requests before skipping its own script;
   * concurrent arrivals share one in-flight task. To force a fresh load (HMR),
   * {@link invalidate} first.
   * @param id - graph entry name.
   */
  /**
   * 一阶段到达：加载条目声明的动态请求、再加载自身脚本以注册其工厂
   * （不物化——模块副作用等 import）。
   * 对已物化的 bootstrap id 是空操作。已注册图行仍会先注册任何未解析的
   * 声明请求，再跳过自身脚本；并发到达共享一个在途任务。要强制重新加载
   * （HMR），先 invalidate。
   * @param id 图条目名。
   */
  prefetch(id: string): Promise<void>
  /**
   * Full reset of one non-bootstrap module: drop its registered factory and
   * materialized record so the next prefetch/import reloads it (the HMR
   * invalidation hook). The bootstrap module remains materialized.
   * @param id - entry name to invalidate.
   */
  /**
   * 非 bootstrap 模块的全量重置：丢弃其已注册工厂与物化记录，使下一次
   * prefetch/import 重新加载它（HMR 失效钩子）。bootstrap 模块保持物化。
   * @param id 要失效的条目名。
   */
  invalidate(id: string): void
}

/** Internal construction inputs assembled by the modules bundle's bootstrap export. */
/** modules bundle 的 bootstrap 导出组装的内部构造输入。 */
export interface ClientModuleSystemOptions {
  /** Parsed boot graph owned by the resulting module system. */
  /** 结果模块系统拥有的解析启动图。 */
  manifest: BootManifest
  /** Module-table seed: platform-singleton specifier → shell instance. */
  /** 模块表种子：平台单例说明符 -> shell 实例。 */
  staticModules: Record<string, unknown>
  /** Stable HTML-installed registration facade to switch from queue to live mode. */
  /** 要从 queue 切换到 live 模式的稳定 HTML 安装注册门面。 */
  registrationTarget: ClientModuleLoaderTarget
  /** Already-materialized modules bundle consumed while creating the system. */
  /** 创建系统时消费的已物化 modules bundle。 */
  bootstrapModule: ClientBootstrapModule
  /** Bundle-load hook. Defaults to a same-origin classic `<script src>` element. */
  /** bundle 加载钩子。默认是同源经典 <script src> 元素。 */
  loadBundle?: (url: string) => Promise<void>
}
