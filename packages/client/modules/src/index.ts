/**
 * ================================ 文件注释 ================================
 * 【文件职责】客户端模块系统的节点半边（dsh.client 双面包）：扫描 Host
 *   Loader 条目中声明 dsh.client 的包，按模块图顺序组合 __DSH_BOOT__ 条目
 *   图，服务 /plugins/<id>/client.js 及其 source map，向 webserver 的 index
 *   注入表贡献启动清单与解析器阻塞 bootstrap 预载，并提供 clientModuleHost
 *   服务（HMR 节点半边的注册/通知面）。
 * 【技术维度】增量按包扫描（无全量重扫路径）：internal/plugin 发射标记
 *   脏名，微任务冲刷对账；包元数据（含"非客户端包"否定裁决）按名缓存
 *   永不过期；模块图排序保证动态包先于其消费方。
 * 【产品维度】web 插件在浏览器的加载面：bundle 路由、启动清单注入、HMR
 *   重建通知都由此服务承载。
 * 【逻辑维度】声明解析（parseDshClient/clientExportOf）；图排序
 *   （orderByModuleGraph）；注入行（bootInjections）；服务类
 *   （ClientModuleRegistry：扫描/组合/路由/重建通知）。
 * 【关键边界】插件集变化在重启时生效（元数据永不过期）；bundle 内容变化
 *   只经 rebuilt() 进入图；畸形声明或缺失 bundle 在激活期聚合为响亮抛错。
 * 【新手阅读建议】先读 ./client/manifest.ts 理解线契约，再看服务类。
 * ==========================================================================
 */
/**
 * Node half of the client module system (`dsh.client` dual-face package): scans
 * the host Loader's entries for packages declaring `dsh.client`, composes the
 * `window.__DSH_BOOT__` entry graph (wire single source: {@link WebBootEntry}
 * in `./client/manifest.ts`) in module-graph order, serves
 * `/plugins/<id>/client.js` and its source map, contributes the boot manifest
 * plus the parser-blocking bootstrap preloads to the webserver's index
 * injection table, and provides the `clientModuleHost` service (the HMR node
 * half's registration/notification face).
 *
 * Scanning is incremental per package — there is no full-rescan code path.
 * Every cordis `internal/plugin` emission (fiber construction/disposal) marks
 * the fiber's entry name dirty; a microtask flush reconciles each dirty name
 * against the live loader entries. The activation pass seeds the same dirty
 * set with all current entries and flushes synchronously, so first scan and
 * steady state share one implementation. Package metadata (including the
 * negative "not a client package" verdict) is cached per name and never
 * expires — plugin-set changes take effect on restart; bundle content
 * changes reach the graph only through
 * {@link ClientModuleRegistry.rebuilt}.
 * @module @deepseek-ai/dsh-client-modules
 */
/*
 * 客户端模块系统的节点半边（dsh.client 双面包）：扫描 Host Loader 条目中
 * 声明 dsh.client 的包，按模块图顺序组合 window.__DSH_BOOT__ 条目图
 * （线单一来源：./client/manifest.ts 的 WebBootEntry），服务
 * /plugins/<id>/client.js 及其 source map，向 webserver 的 index 注入表贡献
 * 启动清单 + 解析器阻塞 bootstrap 预载，并提供 clientModuleHost 服务
 * （HMR 节点半边的注册/通知面）。
 *
 * 扫描按包增量进行——没有全量重扫代码路径。每次 cordis internal/plugin
 * 发射（fiber 构建/销毁）都把该 fiber 的条目名标记为脏；微任务冲刷对每个
 * 脏名对照活跃 loader 条目对账。激活趟用当前全部条目播种同一脏集并同步
 * 冲刷，因此首扫与稳态共享同一实现。包元数据（含"非客户端包"否定裁决）
 * 按名缓存且永不过期——插件集变化在重启时生效；bundle 内容变化只经
 * ClientModuleRegistry.rebuilt 进入图。
 * @module @deepseek-ai/dsh-client-modules
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { optionalStringArray, stripClientSuffix } from './client/manifest.ts'
import type { WebBootEntry, WebBootGraph } from './client/manifest.ts'

export { stripClientSuffix } from './client/manifest.ts'
export type {
  BootManifest, BootModuleRow, BootPluginRow, WebBootEntry, WebBootGraph,
} from './client/manifest.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The web plugin table (provided by the client-modules node half). */
    /* web 插件表（由 client-modules 节点半边提供）。 */
    clientModules: ClientModuleRegistry
  }
}

/** package.json `dsh.client` declaration fields, validated one by one after reading the file. */
/* package.json 的 dsh.client 声明字段，读文件后逐项校验。 */
interface DshClientDeclaration {
  inject?: string[]
  platform: string
  /** Boot phase-one prefetch mark; absent means lazy (fetched on demand). */
  /* 启动一阶段预取标记；缺省为懒（按需拉取）。 */
  immediately?: boolean
  /**
   * Exact module-table requests beyond the implicit client baseline. Any
   * specifier is valid, including subpaths such as `<pkg>/client`; each
   * importing package declares its own exceptional requests. A type-only
   * import is not a request because the transform erases it before resolution.
   * Absent means the package uses only the baseline externals.
   */
  /*
   * 超出隐式客户端基线的精确模块表请求。任何说明符都有效，含 <pkg>/client
   * 之类子路径；每个导入包声明自己的例外请求。仅类型导入不是请求，因为
   * 转换在解析前就擦除它。缺省表示包只用基线外部化。
   */
  external?: string[]
}

/** The declared fields a graph row carries, normalized (absent array declarations become empty). */
/* 图行携带的声明字段，已规范化（缺省数组声明变空）。 */
interface WebBootRowFields {
  inject?: string[]
  /** Module specifiers the package requests from the module table. */
  /* 包向模块表请求的模块说明符。 */
  external: string[]
  immediately: boolean
}

/** Resolved package metadata for one `dsh.client` package (cached per name, never expires). */
/* 一个 dsh.client 包的已解析包元数据（按名缓存，永不过期）。 */
interface PkgMeta extends WebBootRowFields {
  clientPath: string
}

/** Recovery instruction shared by grouped startup and steady-state bundle diagnostics. */
/* 分组启动与稳态 bundle 诊断共享的恢复指引。 */
const CLIENT_BUNDLE_BUILD_INSTRUCTION = 'run `pnpm run build` before launch'

/** Missing built client export, retained as structured data for activation-error grouping. */
/* 缺失的内置客户端导出，保留为结构化数据以支持激活错误分组。 */
class MissingClientBundleError extends Error {
  constructor(
    readonly packageName: string,
    readonly clientPath: string,
    cause: unknown,
  ) {
    super(
      [
        `client-modules: client bundle not found; ${CLIENT_BUNDLE_BUILD_INSTRUCTION}:`,
        `  package: ${packageName}`,
        `  path: ${clientPath}`,
      ].join('\n'),
      { cause },
    )
  }
}

/** Activation failures grouped by actionable package-build errors and unrelated failures. */
/* 激活失败按"可操作的包构建错误"与"无关失败"分组。 */
class ClientPackageCompositionError extends AggregateError {
  constructor(failures: Error[]) {
    const missingBundles = failures.filter((error): error is MissingClientBundleError => error instanceof MissingClientBundleError)
    const otherFailures = failures.filter(error => !(error instanceof MissingClientBundleError))
    const packageNoun = failures.length === 1 ? 'package' : 'packages'
    const lines = [`client-modules: ${String(failures.length)} client ${packageNoun} failed to compose:`]
    if (missingBundles.length > 0) {
      lines.push(`  client bundles not found; ${CLIENT_BUNDLE_BUILD_INSTRUCTION}:`)
      for (const error of missingBundles) {
        lines.push(`    - package: ${error.packageName}`, `      path: ${error.clientPath}`)
      }
    }
    if (otherFailures.length > 0) {
      lines.push('  other failures:', ...otherFailures.map(error => `    - ${error.message}`))
    }
    super(failures, lines.join('\n'))
  }
}

/** One composed table row: the wire entry plus the resolved package metadata behind it. */
/* 一条组合表行：线条目 + 其背后的已解析包元数据。 */
interface WebPluginRecord {
  entry: WebBootEntry
  meta: PkgMeta
}

/** Narrow an unknown parsed JSON value to the `dsh.client` declaration, throwing on malformed fields. */
/* 把未知解析 JSON 值收窄为 dsh.client 声明；畸形字段抛错。 */
function parseDshClient(pkgName: string, value: unknown): DshClientDeclaration | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`)
  }
  const decl = value as Record<string, unknown>
  if (typeof decl.platform !== 'string') {
    throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`)
  }
  const inject = optionalStringArray(pkgName, 'dsh.client.inject', decl.inject)
  const external = optionalStringArray(pkgName, 'dsh.client.external', decl.external)
  if (decl.immediately !== undefined && typeof decl.immediately !== 'boolean') {
    throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`)
  }
  return {
    platform: decl.platform,
    ...(inject !== undefined ? { inject } : {}),
    ...(external !== undefined ? { external } : {}),
    ...(decl.immediately !== undefined ? { immediately: decl.immediately } : {}),
  }
}

/** Resolve `exports["./client"]` to a relative path, accepting the string and one-level conditional forms. */
/* 把 exports["./client"] 解析为相对路径，接受字符串与一级条件形式。 */
function clientExportOf(pkgName: string, exportsField: unknown): string | undefined {
  if (typeof exportsField !== 'object' || exportsField === null) return undefined
  const client = (exportsField as Record<string, unknown>)['./client']
  if (client === undefined) return undefined
  if (typeof client === 'string') return client
  if (typeof client === 'object' && client !== null) {
    const fallback = (client as Record<string, unknown>).default
    if (typeof fallback === 'string') return fallback
  }
  throw new Error(`client-modules: ${pkgName} exports["./client"] must be a string or an object with a string default`)
}

/** sha1 content hash shortened to 12 hex chars (bundle rev / graph rev). */
/* sha1 内容哈希截为 12 个十六进制字符（bundle rev / 图 rev）。 */
function shortHash(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

/** Graph row for one bundle rev (url carries the rev as its cache-busting query). */
/* 一个 bundle rev 的图行（url 以 rev 作为其缓存破坏查询）。 */
function graphRow(id: string, rev: string, fields: WebBootRowFields): WebBootEntry {
  return {
    id,
    url: `/plugins/${id}/client.js?rev=${rev}`,
    rev,
    ...(fields.inject !== undefined ? { inject: fields.inject } : {}),
    ...(fields.immediately ? { immediately: true } : {}),
    ...(fields.external.length > 0 ? { external: fields.external } : {}),
  }
}

/**
 * Order composed rows so every requested dynamic package precedes its
 * consumers. An `external` specifier is either the package row it names
 * (`<pkg>/client` aliases the bare package) or a static-table name that adds no
 * graph edge.
 * @param entries - composed rows in scan order.
 * @returns the same rows reordered; scan order breaks every tie.
 * @throws {Error} when a row requests itself or when the module graph has a
 * cycle; the message lists the packages on it.
 */
/*
 * 给组合行排序，使每个被请求的动态包先于其消费方。external 说明符要么是
 * 它命名的包行（<pkg>/client 别名为裸包），要么是不加图边的静态表名。
 * @param entries 扫描顺序的组合行。
 * @returns 同一批行重排；扫描顺序打破每个平局。
 * @throws 行请求自身或模块图有环时抛 Error；消息列出环上的包。
 */
export function orderByModuleGraph(entries: readonly WebBootEntry[]): WebBootEntry[] {
  const rowsById = new Map<string, WebBootEntry>()
  for (const entry of entries) rowsById.set(entry.id, entry)
  const ordered: WebBootEntry[] = []
  const placed = new Set<string>()
  const open: string[] = []
  const visit = (entry: WebBootEntry): void => {
    if (placed.has(entry.id)) return
    const cycleStart = open.indexOf(entry.id)
    if (cycleStart !== -1) {
      throw new Error(
        `client-modules: module graph cycle ${[...open.slice(cycleStart), entry.id].join(' -> ')} `
        + '— a requested package row must precede its consumers, and factory-form CJS cannot deliver partial exports',
      )
    }
    open.push(entry.id)
    for (const name of entry.external ?? []) {
      const dependency = rowsById.get(name) ?? rowsById.get(stripClientSuffix(name))
      if (dependency === entry) {
        throw new Error(
          `client-modules: "${entry.id}" requests module "${name}" that it answers itself `
          + '— a row must not declare its own package in dsh.client.external',
        )
      }
      if (dependency !== undefined) visit(dependency)
    }
    open.pop()
    placed.add(entry.id)
    ordered.push(entry)
  }
  for (const entry of entries) visit(entry)
  return ordered
}

/** Bootstrap package whose ordinary client bundle supplies the module-system implementation. */
/* bootstrap 包：其普通客户端 bundle 提供模块系统实现。 */
const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'

/** Dynamic package whose ordinary client bundle must be registered before plugin boot starts. */
/* 动态包：其普通客户端 bundle 必须在插件启动开始前注册。 */
const CLIENT_RUNTIME_ID = '@deepseek-ai/dsh-client-runtime'

/** Ordinary dynamic bundles the HTML parser executes before the Vite shell. */
/* HTML 解析器在 Vite shell 前执行的普通动态 bundle。 */
const PARSER_PRELOAD_IDS = [CLIENT_MODULES_ID, CLIENT_RUNTIME_ID] as const

/**
 * The boot protocol as index injection rows. The inline registration queue
 * precedes blocking classic scripts for modules' and runtime's ordinary
 * `lib/client.js` artifacts. Its `create()` method materializes the modules
 * bundle, delegates construction to that bundle, and leaves the same facade
 * in live-registration mode. The graph global follows before the shell reads
 * it.
 * @param graph - the composed entry graph.
 * @returns head rows in execution order: queue script, preload scripts, graph global.
 */
/*
 * 以 index 注入行表达的启动协议。内联注册队列先于 modules 与 runtime 的
 * 普通 lib/client.js 阻塞经典脚本。其 create() 方法物化 modules bundle、
 * 把构造委派给该 bundle，并让同一门面留在实时注册模式。图全局随后，在
 * shell 读取它之前。
 * @param graph 组合条目图。
 * @returns 按执行顺序的 head 行：队列脚本、预载脚本、图全局。
 */
export function bootInjections(graph: WebBootGraph): IndexInjection[] {
  const bootstrapId = JSON.stringify(CLIENT_MODULES_ID)
  const queue = `(()=>{
const pendingQueue=[]
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){
    if(this.mode!=="queue")throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
    const index=pendingQueue.findIndex(registration=>registration.id===${bootstrapId})
    const registration=pendingQueue[index]
    if(registration===undefined)throw new Error("client-modules: HTML did not preload ${CLIENT_MODULES_ID}/client.js")
    pendingQueue.splice(index,1)
    const exports=registration.factory(specifier=>{
      throw new Error('client-modules: ${CLIENT_MODULES_ID}/client.js requested external "'+specifier+'" before the module system existed')
    })
    if(typeof exports!=="object"||exports===null||typeof exports.createClientModuleSystem!=="function"||typeof exports.apply!=="function"){
      throw new Error("client-modules: ${CLIENT_MODULES_ID}/client.js did not export the bootstrap module face")
    }
    return exports.createClientModuleSystem(this,{id:registration.id,exports},options)
  }
}
})()`
  const preload = PARSER_PRELOAD_IDS.map(id => graph.entries.find(entry => entry.id === id))
    .filter((entry): entry is WebBootEntry => entry !== undefined)
    .map((entry): IndexInjection => ({ kind: 'script-src', placement: 'head', src: entry.url }))
  return [
    { kind: 'script', placement: 'head', text: queue },
    ...preload,
    { kind: 'global', name: '__DSH_BOOT__', value: graph },
  ]
}

/**
 * The web plugin table service: incremental `dsh.client` scan + wire composition
 * + bundle route + index injection rows. Construction runs the activation scan
 * synchronously — a malformed declaration or missing bundle among the
 * already-loaded entries aggregates into one loud throw (FAILED fiber; the
 * boot activation audit reports it).
 */
/*
 * web 插件表服务：增量 dsh.client 扫描 + 线组合 + bundle 路由 + index 注入
 * 行。构造同步运行激活扫描——已加载条目中的畸形声明或缺失 bundle 聚合为
 * 一次响亮抛错（FAILED fiber；启动激活审计报告它）。
 */
export class ClientModuleRegistry extends Service {
  static inject = ['webServer', 'loader']

  private readonly table = new Map<string, WebPluginRecord>()
  // Negative verdicts (unresolvable specifier — builtins like cordis:include,
  // subpath rows — or a package without a web `dsh.client` declaration) are
  // cached as null and never expire: plugin-set changes take effect on restart.
  private readonly pkgMeta = new Map<string, PkgMeta | null>()
  private readonly rebuildListeners = new Set<(id: string, rev: string) => void>()
  private readonly graphListeners = new Set<() => void>()
  private readonly dirty = new Set<string>()
  private readonly resolvePkgJson: (spec: string) => string
  private flushQueued = false
  private composed: WebBootGraph

  /**
   * Build the service: subscribe, seed, and run the activation flush.
   * @param ctx - plugin context carrying webServer and loader.
   */
  constructor(ctx: Context) {
    super(ctx, 'clientModules')
    // Resolution anchor: the config tree's baseUrl (the cordis.yml directory,
    // whose package declares every composed plugin as a dependency). The
    // modules package's own URL would miss sibling packages under pnpm's
    // isolated node_modules.
    if (ctx.baseUrl === undefined) {
      throw new Error('client-modules: ctx.baseUrl is unset — the node half needs the config-tree anchor to resolve plugin packages')
    }
    const require = createRequire(ctx.baseUrl)
    this.resolvePkgJson = spec => require.resolve(`${spec}/package.json`)

    // Subscribe before seeding so a fiber arriving mid-activation lands in the
    // same dirty set (Set idempotence makes the overlap harmless). An entry-less
    // fiber is a child plugin or a manual mount — never a loader row; O(1) drop.
    ctx.on('internal/plugin', (fiber) => {
      const entryName = fiber.entry?.options.name
      if (entryName === undefined) return
      this.dirty.add(entryName)
      if (this.flushQueued) return
      this.flushQueued = true
      queueMicrotask(() => {
        this.flushQueued = false
        this.flush((err) => { ctx.logger.warn(err) })
      })
    })

    // Activation pass: the initial scan IS the incremental path over the
    // current entries, flushed synchronously (nothing async between subscribe,
    // seed, and flush).
    for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name)
    this.composed = this.compose()
    const failures: Error[] = []
    this.flush(err => failures.push(err))
    if (failures.length > 0) {
      throw new ClientPackageCompositionError(failures)
    }

    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: '/plugins', handler: this.serveBundle }),
      'client-modules: bundle route',
    )
    ctx.on('webserver/index-inject', (table) => {
      table.push(...bootInjections(this.composed))
    })
  }

  /**
   * Current composed entry graph (stable object between changes).
   * @returns the graph served as `window.__DSH_BOOT__`.
   */
  graph(): WebBootGraph {
    return this.composed
  }

  /**
   * Absolute path of an entry's client bundle.
   * @param id - entry id (package name).
   * @returns the path, or undefined for an unknown id.
   */
  clientPath(id: string): string | undefined {
    return this.table.get(id)?.meta.clientPath
  }

  /**
   * Re-hash one bundle (the HMR watch's registration hook — the only entry
   * point through which bundle content changes reach the graph).
   * @param id - entry id (package name).
   * @returns the new rev, or undefined for an unknown id.
   */
  rebuilt(id: string): string | undefined {
    const record = this.table.get(id)
    if (record === undefined) return undefined
    const rev = shortHash(readFileSync(record.meta.clientPath))
    if (rev === record.entry.rev) return rev
    record.entry = graphRow(id, rev, record.meta)
    this.composed = this.compose()
    for (const notify of this.rebuildListeners) {
      // Containment: rebuilt() runs inside the HMR watch callback — a
      // throwing subscriber must not kill the poll or skip later subscribers.
      try {
        notify(id, rev)
      } catch (error) {
        this.ctx.logger.error(error)
      }
    }
    this.notifyGraphChanged()
    return rev
  }

  /**
   * Subscribe to bundle rebuilds; fires only when the re-hash changed the rev.
   * @param listener - receives the entry id and its new bundle rev.
   * @returns the unsubscriber.
   */
  onRebuilt(listener: (id: string, rev: string) => void): () => void {
    this.rebuildListeners.add(listener)
    return () => { this.rebuildListeners.delete(listener) }
  }

  /**
   * Fires after any flush that recomposed the graph (row added/removed, or a
   * rebuilt rev change). Pull model: listeners re-read {@link graph}.
   * @param listener - notified with no payload.
   * @returns the unsubscriber.
   */
  onGraphChanged(listener: () => void): () => void {
    this.graphListeners.add(listener)
    return () => { this.graphListeners.delete(listener) }
  }

  private compose(): WebBootGraph {
    const entries = orderByModuleGraph([...this.table.values()].map(record => record.entry))
    return { rev: shortHash(JSON.stringify(entries)), entries }
  }

  private notifyGraphChanged(): void {
    for (const listener of this.graphListeners) {
      // A throwing subscriber must not skip later subscribers (or escape into
      // whatever triggered the flush — possibly an fs.watchFile callback).
      try {
        listener()
      } catch (error) {
        this.ctx.logger.error(error)
      }
    }
  }

  private resolveMeta(pkgName: string): PkgMeta | null {
    const cached = this.pkgMeta.get(pkgName)
    if (cached !== undefined) return cached
    let pkgPath: string
    try {
      pkgPath = this.resolvePkgJson(pkgName)
    } catch {
      // Not a resolvable package root: loader builtins (cordis:include) and
      // subpath entries (…/gateway) land here — permanently not a client row.
      this.pkgMeta.set(pkgName, null)
      return null
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    const dsh = pkg.dsh
    const decl = parseDshClient(
      pkgName,
      dsh !== null && typeof dsh === 'object' ? (dsh as Record<string, unknown>).client : undefined,
    )
    if (decl === undefined || decl.platform !== 'web') {
      this.pkgMeta.set(pkgName, null)
      return null
    }
    const clientRel = clientExportOf(pkgName, pkg.exports)
    if (clientRel === undefined) {
      throw new Error(`client-modules: ${pkgName} declares dsh.client but exports no "./client" bundle`)
    }
    const meta: PkgMeta = {
      clientPath: join(dirname(pkgPath), clientRel),
      ...(decl.inject !== undefined ? { inject: decl.inject } : {}),
      external: decl.external ?? [],
      immediately: decl.immediately === true,
    }
    this.pkgMeta.set(pkgName, meta)
    return meta
  }

  /**
   * Read the activation-time bundle revision.
   * @param pkgName - package that declares the client bundle.
   * @param clientPath - absolute path of the built client artifact.
   * @returns the bundle content's short hash for use as its revision.
   * @throws {MissingClientBundleError} when the read fails with `ENOENT`; other filesystem errors are rethrown unchanged.
   */
  private initialBundleRevision(pkgName: string, clientPath: string): string {
    try {
      return shortHash(readFileSync(clientPath))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      throw new MissingClientBundleError(pkgName, clientPath, error)
    }
  }

  /** Reconcile one entry name against the live loader entries. @returns whether the table changed. */
  private processOne(entryName: string): boolean {
    let qualifies = false
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name === entryName && entry.fiber !== undefined && !entry.disabled) {
        qualifies = true
        break
      }
    }
    if (!qualifies) return this.table.delete(entryName)
    if (this.table.has(entryName)) return false
    const meta = this.resolveMeta(entryName)
    if (meta === null) return false
    // The rev rides the row from here on: a fiber restart reuses the row (and
    // its rev) untouched; only rebuilt() re-reads the bundle.
    const rev = this.initialBundleRevision(entryName, meta.clientPath)
    this.table.set(entryName, { entry: graphRow(entryName, rev, meta), meta })
    return true
  }

  private flush(onError: (err: Error) => void): void {
    let changed = false
    for (const entryName of [...this.dirty]) {
      this.dirty.delete(entryName)
      try {
        if (this.processOne(entryName)) changed = true
      } catch (error) {
        // Steady state: one broken package must not poison the others; the
        // activation pass aggregates these into a loud throw instead.
        onError(error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (!changed) return
    let composed: WebBootGraph
    try {
      composed = this.compose()
    } catch (error) {
      // An unorderable module graph is a property of the whole table, not of
      // the arriving package, so it surfaces here: aggregated into the
      // activation throw, or warned in steady state while the last orderable
      // graph stays served.
      onError(error as Error)
      return
    }
    this.composed = composed
    this.notifyGraphChanged()
  }

  private readonly serveBundle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    /* v8 ignore next -- `?? '/'` arm: node:http always sets url on server requests. */
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    // The id may contain a scope slash. Anything else under /plugins (including
    // /plugins/events when the HMR row is absent) is an unknown resource.
    const prefix = '/plugins/'
    const mapSuffix = '/client.js.map'
    const bundleSuffix = '/client.js'
    const isSourceMap = pathname.startsWith(prefix) && pathname.endsWith(mapSuffix)
    const suffix = isSourceMap ? mapSuffix : bundleSuffix
    const clientPath = pathname.startsWith(prefix) && pathname.endsWith(suffix)
      ? this.clientPath(pathname.slice(prefix.length, -suffix.length))
      : undefined
    const path = clientPath === undefined ? undefined : `${clientPath}${isSourceMap ? '.map' : ''}`
    if (path === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    try {
      const body = await readFile(path)
      res.writeHead(200, {
        'content-type': isSourceMap ? 'application/json; charset=utf-8' : 'text/javascript; charset=utf-8',
        'cache-control': 'no-cache',
      })
      res.end(body)
    } catch {
      // Registered but unreadable (bundle not built yet): loud 404 beats a silent SPA-fallback HTML page.
      res.writeHead(404)
      res.end()
    }
  }
}

export default ClientModuleRegistry
