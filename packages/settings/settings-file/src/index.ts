/**
 * File-backed settings provider. One YAML or JSON document under the user's
 * harness home carries every namespace section; external edits hot-publish
 * through the seam, and every write re-reads the document under a
 * cross-process writer lock before patching it as a comment-preserving
 * leaf-level diff.
 * @module @deepseek-ai/dsh-settings-file
 */

/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现"文件型设置提供者"（FileSettingsProvider）：把用户设置以单个 YAML/JSON 文档存
 *   在 harness 主目录下，充当 dsh-settings 能力缝的 Provider 角色，负责读取、持久化与热更新。
 * 【技术维度】基于 Cordis 的 Service 生命周期；chokidar 文件监听 + 去抖；跨进程写锁 + 原子写；
 *   YAML 以"叶级 diff"方式局部修补，保留文件里的注释、锚点与排版。
 * 【产品维度】配置界面与用户需要一处可手工编辑、被外部改动后立即生效的设置来源，即 settings.yaml
 *   /settings.json 文档；本包承担"持久化 + 外部编辑热发布"。
 * 【逻辑维度】resolveSpec 解析配置 → load 读盘 → persist 排队写盘 → refresh/reconcileFromDisk
 *   把磁盘变化经 publish 推入设置缝 → renderYaml/renderJson 生成下次写入文本 → init 建立 watcher。
 * 【关键边界】所有写操作串行排队避免互相覆盖；写前必须重新读盘以免覆盖外部编辑；启动期解析失败
 *   loud fail（显式报错），热更新期失败则保留最后好值；文件权限 0600/0700 保护隐私。
 * 【新手阅读建议】先读 packages/settings/settings/src/index.ts 理解"设置缝"整体模型，再按
 *   resolveSpec → load/persist → refresh 的顺序读本文件，最后细看 renderYaml 体会注释保留 diff。
 * ==========================================================================
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { watch as chokidarWatch } from 'chokidar'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { Document, parseDocument } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { canonicalizeWatchPath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { SettingsProvider, deepEqualJson, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

// 插件配置：由 cordis.yml 传入，控制设置文档的存放位置与热更新行为。
/** Plugin config: file location and hot-reload behavior. */
export interface Config {
  /** Settings document path; defaults to `settings.yaml` under the harness home. */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Watch the document and hot-publish external edits; defaults to true. */
  watch?: boolean
  /** Watcher write-settle window in milliseconds; defaults to 100. */
  debounceMs?: number
}

// 文档格式：仅 yaml 与 json 两种，由文件扩展名推导。
/** Document format derived from the configured file extension. */
type SettingsFormat = 'yaml' | 'json'

// 扩展名 → 格式的映射表；未收录的扩展名会在 resolveSpec 中显式报错。
const FORMATS: Record<string, SettingsFormat> = {
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
}

// 解析后的运行时参数：所有默认值集中在此处补齐，避免散落到各方法里用 ?? 兜底。
/** Fully resolved provider parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  filename: string
  format: SettingsFormat
  watch: boolean
  debounceMs: number
}

/**
 * Resolve the runtime spec from plugin config: an explicit `path` wins,
 * otherwise the document lives at `<harness home>/settings.yaml`.
 * @param config - raw plugin config.
 * @returns the resolved file location, format, and watch behavior.
 */
// 解析插件配置：显式 path 优先，否则落到 <harness home>/settings.yaml；同时校验扩展名、补齐默认值。
export function resolveSpec(config: Config): ResolvedSpec {
  const filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), 'settings.yaml'))
  const format = FORMATS[extname(filename)]
  if (format === undefined) {
    throw new Error(`settings-file: extension "${extname(filename)}" is not supported (use .yaml, .yml, or .json)`)
  }
  return {
    filename,
    format,
    watch: config.watch ?? true,
    debounceMs: config.debounceMs ?? 100,
  }
}

// 判断解析出的 YAML 值是否为"键值对"（map）：两侧都是 map 才能递归 diff，否则只能整体替换。
/** Whether a parsed YAML value is a map for diffing purposes. */
function isMapLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Apply the difference between one node's stored and next value as minimal
 * `setIn`/`deleteIn` edits, recursing through maps, so every untouched node —
 * and the key node of every changed pair — keeps its comments, anchors, and
 * formatting. Non-map values (arrays and scalars) replace wholesale when
 * unequal, taking any comments inside them along.
 */
// 递归生成最小 diff：两侧都是 map 时逐键对比（删除缺失键、递归处理变化的键）；其余类型不等则整体替换。
function patchNode(document: Document, path: readonly string[], current: unknown, next: unknown): void {
  if (isMapLike(current) && isMapLike(next)) {
    for (const key of Object.keys(current)) {
      if (!(key in next)) document.deleteIn([...path, key])
    }
    for (const [key, value] of Object.entries(next)) {
      patchNode(document, [...path, key], current[key], value)
    }
    return
  }
  if (!deepEqualJson(current, next)) document.setIn([...path], next)
}

// 判断某个文件系统错误是否代表"文件不存在"（ENOENT）；其余错误一律原样抛出，绝不静默吞掉。
/** Whether a filesystem error means absence; every non-ENOENT failure must surface. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

// 判断错误是否为"文件已存在"（EEXIST）：独占创建（wx 标志）撞上已存在文档时会返回这个码。
/** Whether an exclusive file create found an existing document. */
function isEEXIST(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}

// 文件型设置提供者：以单个 YAML/JSON 文档承载所有命名空间段落，是"文件即存储"场景的默认 Provider。
/** File-backed settings provider (`settings.yaml`/`.json`). */
export class FileSettingsProvider extends SettingsProvider {
  // 插件级配置 schema：加载本插件时由 Schemastery 自动校验入参并补齐默认值。
  static Config: z<Config> = z.object({
    path: z.string(),
    dshHome: z.string(),
    watch: z.boolean().default(true),
    debounceMs: z.number().min(0).default(100),
  })

  // 解析后的运行时参数（路径、格式、监听开关、去抖窗口），构造时一次性算好。
  private readonly spec: ResolvedSpec
  /**
   * Raw text of the last successfully parsed or persisted document;
   * `undefined` while the file is absent. Watcher events whose content equals
   * this cache are no-ops, which is also the self-write suppression.
   */
  // 最近一次成功解析/写入的文档原文缓存：磁盘内容与它相同就视为无变化（同时抑制自己的写入回声）。
  private text: string | undefined
  /**
   * Single exclusive operation chain: watcher reloads and document writes run
   * one at a time in queue order (settled tail), so a write can never render
   * from text a concurrent reload is busy replacing, and a reload can never
   * read a half-committed write.
   */
  // 独占操作链：读盘与写盘排成一队顺序执行，杜绝并发覆盖，也保证读盘永远看不到写了一半的文件。
  private operations: Promise<void> = Promise.resolve()
  // 关闭标记：dispose 后拒绝新的 watcher 事件，让在途操作安全收尾。
  /** Set at dispose: refuse new watcher events and let in-flight work no-op. */
  private closed = false

  // 读取关闭标记的"不透明"方法：跨 await 后 TS 无法收窄 this.closed，封装成函数以保证每次读到实时值。
  /** Opaque read of {@link closed}: control flow cannot narrow it across awaits. */
  private isClosed(): boolean {
    return this.closed
  }

  // 构造：直接调用 resolveSpec 补齐默认值——因为编程方式构造可能绕过 Schemastery 的规范化。
  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // Programmatic construction may bypass Schemastery normalization; resolve
    // the same defaults in one explicit step either way.
    this.spec = resolveSpec(config)
  }

  // 本地文档总是可写：update/replace/mutate 等写入路径都允许走本提供者。
  /** The local document is always writable through {@link SettingsProvider.update}. */
  get writable(): boolean {
    return true
  }

  // 对外暴露文档绝对路径：配置界面的"打开配置文件"入口据此定位文件。
  /** The resolved YAML/JSON document path exposed to local configuration surfaces. */
  override get documentPath(): string {
    return this.spec.filename
  }

  // 为原生编辑器准备文档：文件不存在时先独占创建一份"仅所有者可读写"的空文档，再返回路径。
  /** Materialize an absent owner-only document, then return its resolved path. */
  override prepareDocument(): Promise<string> {
    return this.enqueue(async () => {
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      await withFileLock(this.spec.filename, async () => {
        try {
          await writeFile(this.spec.filename, '', { flag: 'wx', mode: 0o600 })
        } catch (error) {
          if (isEEXIST(error)) return
          throw error
        }
        this.text = ''
        if (!this.isClosed()) this.publish({})
      })
      return this.spec.filename
    })
  }

  // 读盘：文件缺失视为空文档；文件存在则解析为"命名空间 → 原始段落"映射，并缓存文档原文。
  protected async load(): Promise<Record<string, unknown>> {
    let text: string
    try {
      text = await readFile(this.spec.filename, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      this.text = undefined
      return {}
    }
    const doc = this.parse(text)
    this.text = text
    return doc
  }

  // 写盘入口：所有命名空间的写请求都汇入同一条独占操作链排队，避免兄弟段落互相覆盖。
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    // One document backs every namespace, so writes from different namespace
    // queues serialize with each other and with watcher reloads on the one
    // operation chain: each render must see the text the previous operation
    // committed, or a sibling section silently vanishes from disk.
    return this.enqueue(() => this.persistSection(ns, section))
  }

  // 把一次文档操作接到独占链末尾排队；即使前序失败也不让队列"中毒"（尾指针用 catch 归位）。
  /** Queue one exclusive document operation behind every earlier one. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operations.then(operation)
    this.operations = task.then(() => undefined, () => undefined)
    return task
  }

  // 排队一次热更新：除逃逸出提交路径的不变量违规外，其余失败记日志后继续——一次坏提交不能永久终止热更新。
  /** Queue a reload; only an invariant violation escaping a commit can reject it. */
  private queueRefresh(): void {
    void this.enqueue(() => this.refresh()).catch((error: unknown) => {
      // Only an invariant violation escaping the commit path can reject a
      // refresh; keep the operation queue alive and surface it as an error so
      // one poisoned commit cannot silently end hot reloading forever.
      this.ctx.logger.error('settings-file: reload commit failed at %s', this.spec.filename)
      this.ctx.logger.error(error)
    })
  }

  // 写盘核心：先确保父目录存在（写锁的独占创建依赖它），加跨进程写锁后"读盘合并 → 渲染 → 原子写"。
  private async persistSection(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    // The writer lock's exclusive create needs the parent to exist before
    // writeFileAtomic gets its own chance to create it.
    // 0700: the harness home holds user-private documents.
    await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
    await withFileLock(this.spec.filename, async () => {
      // Read-modify-write: fold in any on-disk state this process has not
      // observed yet — an external edit still inside the watcher debounce
      // window, a change the watcher missed, or another process's write — so
      // the render below can never resurrect a stale document. An unparsable
      // on-disk document fails the write loud instead of silently overwriting
      // a user's manual edit.
      await this.reconcileFromDisk()
      const output = this.spec.format === 'yaml'
        ? this.renderYaml(ns, section)
        : this.renderJson(ns, section)
      // 0600: a document that may hold personal values is never world-readable.
      await writeFileAtomic(this.spec.filename, output, { mode: 0o600, dirMode: 0o700 })
      this.text = output
    })
  }

  // 服务启动：先让基类加载并发布（解析失败 = 启动失败，坏文档绝不能被静默吞掉），再建立文件监听。
  override async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    // The base init loads and publishes; a parse failure there is a boot
    // failure: an existing-but-invalid document must fail loud, never be
    // silently ignored or overwritten.
    yield* super[Service.init]()
    const watcher = this.spec.watch
      ? chokidarWatch(await canonicalizeWatchPath(this.spec.filename), {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: this.spec.debounceMs,
          pollInterval: Math.max(1, Math.min(this.spec.debounceMs, 10)),
        },
      })
      : undefined
    if (watcher !== undefined) {
      watcher.on('all', () => {
        if (this.closed) return
        this.queueRefresh()
      })
      watcher.on('ready', () => {
        // The base init's load raced the watcher's own setup: a change written
        // between that read and the watcher becoming active never fires an
        // event. One reconcile at ready closes the gap.
        if (this.closed) return
        this.queueRefresh()
      })
      watcher.on('error', (error) => {
        this.ctx.logger.warn('settings-file: watcher error on %s', this.spec.filename)
        this.ctx.logger.warn(error)
      })
    }
    yield async () => {
      // Quiesce every operation chain, even when no watcher is configured.
      this.closed = true
      await watcher?.close()
      await this.operations
    }
  }

  // 解析文档原文为"命名空间 → 原始段落"映射；根必须是键值对象，否则抛错。
  /** Parse one document text into raw sections, failing on a non-map root. */
  private parse(text: string): Record<string, unknown> {
    let root: unknown
    if (this.spec.format === 'yaml') {
      // `prettyErrors` is on only for `linePos`; `error.message` is never
      // used, because the parser quotes the offending source line and a
      // settings document can hold a `role('secret')` value.
      const document = parseDocument(text, { prettyErrors: true })
      if (document.errors.length > 0) {
        throw new Error(`settings-file: invalid document at ${this.spec.filename}: ${
          document.errors.map((error) => {
            const at = error.linePos?.[0]
            /* v8 ignore next -- `prettyErrors` populates linePos on every error; the guard answers its optional type */
            return `${error.code}${at === undefined ? '' : ` at line ${String(at.line)}, column ${String(at.col)}`}`
          }).join('; ')}`)
      }
      root = document.toJS() ?? {}
    } else {
      root = text.trim().length === 0 ? {} : JSON.parse(text)
    }
    if (typeof root !== 'object' || root === null || Array.isArray(root)) {
      throw new TypeError(`settings-file: ${this.spec.filename} must be a map of namespace sections`)
    }
    return root as Record<string, unknown>
  }

  /**
   * Re-read the document after a watcher event. Unchanged content (including
   * this provider's own writes) is a no-op; an unreadable or unparsable
   * document keeps the last good sections and warns — a live hot-reload must
   * never take the process down. An invariant violation escaping a commit is
   * not a reload failure and propagates to the queue's error surface.
   */
  // 热更新入口：磁盘无变化则无操作；读不了或解析不了时保留最后好值并告警——热更新绝不拖垮进程。
  private async refresh(): Promise<void> {
    if (this.closed) return
    try {
      await this.reconcileFromDisk()
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'INVARIANT') throw error
      this.ctx.logger.warn('settings-file: reload failed at %s; keeping the last good document', this.spec.filename)
      this.ctx.logger.warn(error)
    }
  }

  /**
   * Compare the on-disk text against the cache and publish any difference
   * into the seam. Absence publishes the empty document; an unreadable or
   * unparsable file throws, so each caller picks its policy — a reload warns
   * and keeps the last good document, a write fails loud.
   */
  // 对比磁盘文本与缓存，有差异就发布进设置缝；文件缺失发布空文档，读不了/解析不了则抛出，由调用方决定策略。
  private async reconcileFromDisk(): Promise<void> {
    let text: string | undefined
    try {
      text = await readFile(this.spec.filename, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      text = undefined
    }
    if (text === this.text || this.isClosed()) return
    if (text === undefined) {
      this.text = undefined
      this.publish({})
      return
    }
    const doc = this.parse(text)
    this.text = text
    this.publish(doc)
  }

  /**
   * Render the next YAML text by patching one namespace in the
   * comment-preserving document. The next section lands as a leaf-level diff
   * against the stored one — only changed values set, only removed keys
   * delete — so comments inside the section survive edits to their siblings,
   * not just comments outside it.
   */
  // 渲染下一次 YAML 文本：在保留注释的文档树上按叶级 diff 打补丁，只改动变化的值与删除的键，
  private renderYaml(ns: SettingsNamespace, section: Record<string, unknown>): string {
    if (this.text === undefined) {
      return new Document({ [ns]: section }).toString()
    }
    // this.text only ever caches content that parsed successfully, so this
    // re-parse (for the mutable comment-preserving tree) cannot fail, and
    // parse() already rejected any non-map root.
    const document = parseDocument(this.text)
    const root: unknown = document.toJS()
    patchNode(document, [ns], isMapLike(root) ? root[ns] : undefined, section)
    return document.toString()
  }

  /** Render the next JSON text by replacing one namespace key. */
  // 渲染下一次 JSON 文本：整体替换命名空间键即可——JSON 无注释可保留，无需叶级 diff。
  private renderJson(ns: SettingsNamespace, section: Record<string, unknown>): string {
    const root = this.text === undefined
      ? {}
      : this.parse(this.text)
    root[ns] = section
    return `${JSON.stringify(root, null, 2)}\n`
  }
}

export default FileSettingsProvider
