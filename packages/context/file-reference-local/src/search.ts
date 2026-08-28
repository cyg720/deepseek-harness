/**
 * ================================ 文件注释 ================================
 * 【文件职责】@ 文件补全的 Host 工作区发现核心：扫描 agent 工作目录、建立
 *             有界索引、对候选做模糊排序。索引里只存路径，不读文件内容。
 * 【技术维度】node:fs/promises 的 readdir/lstat 做广度优先遍历；用"代"
 *             （generation）机制支持可取消、可复用的异步索引；AbortSignal
 *             贯穿所有异步点；路径统一用 / 分隔展示，Windows 反斜杠转换。
 * 【产品维度】决定用户输入 @ 后补全面板里"出现什么、按什么顺序"：目录内
 *             实时列出，裸关键字走模糊索引（前缀 > 包含 > 子序列）。
 * 【逻辑维度】1) 默认配置常量；2) WorkspaceFileSearch 类：list 分发（目录
 *             查询走实时 listDirectory，裸查询走 ensureIndex 的模糊索引）；
 *             3) scanWorkspace 广度优先建索引（含排除目录、条目上限、取消）；
 *             4) 排序打分链（scoreCandidate/subsequenceScore/kindRank）。
 * 【关键边界】索引是"建议性缓存"：工具结果事件后失效重建；目录穿越被严格
 *             拦截（resolveDisplayDirectory 逐段 lstat 校验符号链接）；
 *             不可读子树静默跳过（补全只是辅助，不应报错打断用户）。
 * 【新手阅读建议】先看 list 的分流逻辑，再分别追 listDirectory（实时）与
 *                 scanWorkspace（索引）两条路径，最后看打分函数的分层。
 * ==========================================================================
 */

/**
 * Host-workspace discovery for `@file` completion. The index contains paths
 * only: selected values remain ordinary prompt text and file contents stay
 * behind the model-facing `read` tool.
 *
 * @module @deepseek-ai/dsh-file-reference-local/search
 */

import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference'

export { activeAtToken, formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'

/** Default maximum file and directory candidates rendered for one query. */
/* 单次查询默认最多返回 20 个候选（避免补全面板过长）。 */
export const DEFAULT_FILE_SEARCH_MAX_RESULTS = 20
/** Default maximum entries retained in one workspace search index. */
export const DEFAULT_FILE_SEARCH_MAX_ENTRIES = 50_000
/**
 * Directory basenames omitted from traversal unless the deployment overrides
 * them: version-control and dependency stores plus build-output names that no
 * ecosystem also uses for sources. Generated files carry the basenames of the
 * sources that produced them, so an unfiltered tree both spends the entry
 * budget twice and ranks `dist/x.js` beside `src/x.ts` for every query.
 *
 * `lib` is deliberately absent: Ruby gems and many npm packages keep their
 * sources there, and excluding it would make `@` miss those sources entirely
 * and silently. A workspace that builds into `lib` adds it through
 * `excludedDirectories`.
 */
export const DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.gradle',
] as const

/** Resolved limits and exclusions for one workspace index. */
/* 单个工作区索引生效的解析后配置（已合并默认值）。 */
export interface FileSearchConfig {
  /** Maximum ranked candidates returned for one query. */
  /* 单次查询返回的候选数上限。 */
  maxResults: number
  /** Maximum indexed files and directories. */
  /* 索引条目总数上限。 */
  maxEntries: number
  /** Directory basenames never traversed or offered. */
  /* 永不遍历/永不展示的目录 basename 列表。 */
  excludedDirectories: readonly string[]
}

/** 索引中的一条路径：与候选同构，后续过滤/排序都基于它。 */
interface IndexedPath extends FileReferenceCandidate {}

/** 已打分的候选：score 越大越靠前，用于排序阶段。 */
interface RankedPath {
  candidate: FileReferenceCandidate
  score: number
}

/** 一代索引：控制器用于取消该代扫描，promise 为该代扫描的最终结果。 */
interface IndexGeneration {
  controller: AbortController
  promise: Promise<IndexedPath[]>
}

/** A completed traversal and the invalidation counter it observed at its start. */
interface SettledIndex {
  entries: IndexedPath[]
  startedAt: number
}

/**
 * Cancellable, reusable fuzzy index rooted at one agent working directory.
 * Directory-scoped queries list live state; bare fuzzy queries share one
 * bounded traversal. Only the first query of a workspace waits for that
 * traversal — an invalidated index keeps answering while its replacement
 * builds behind the caret.
 */
/*
 * 以某个 agent 工作目录为根的、可取消可复用的模糊索引。
 * 目录级查询直接读实时目录；裸关键字查询共享一次有界遍历的索引，
 * 直到 @ 交互结束或被工具结果事件失效。
 */
export class WorkspaceFileSearch {
  /** 排除目录的集合化视图，遍历时用 has() 判断，O(1) 查询。 */
  private readonly excludedDirectories: ReadonlySet<string>
  private settled: SettledIndex | undefined
  private generation: IndexGeneration | undefined
  /** Monotonic invalidation counter; a settled index below it is stale. */
  private invalidations = 0
  private disposed = false

  constructor(
    private readonly root: string,
    private readonly config: FileSearchConfig,
  ) {
    // 三个配置字段各自校验：正整数边界与排除目录必须是纯 basename
    if (!Number.isSafeInteger(config.maxResults) || config.maxResults <= 0) {
      throw new Error('file search maxResults must be a positive safe integer')
    }
    if (!Number.isSafeInteger(config.maxEntries) || config.maxEntries <= 0) {
      throw new Error('file search maxEntries must be a positive safe integer')
    }
    if (config.excludedDirectories.some(name => name.length === 0 || name.includes('/') || name.includes('\\'))) {
      throw new Error('file search excludedDirectories entries must be non-empty directory basenames')
    }
    this.excludedDirectories = new Set(config.excludedDirectories)
  }

  /**
   * Return ranked path candidates for the current token.
   * @param rawQuery - path text following `@` or `@"`.
   * @param signal - cancels this caller's wait without killing an index shared by a newer query.
   * @returns at most `maxResults` deterministic candidates.
   */
  /*
   * 返回当前输入 token 对应的排序候选。空查询或含 / 的查询视为目录级
   * （实时列出），否则视为裸关键字（走共享索引做模糊匹配）。
   * @param rawQuery @ 或 @" 之后的原始路径文本
   * @param signal 取消信号：只中止本次等待，不会杀掉被更新的查询共享的索引
   * @returns 最多 maxResults 个确定性候选
   */
  async list(rawQuery: string, signal: AbortSignal): Promise<FileReferenceCandidate[]> {
    signal.throwIfAborted()
    if (this.disposed) return []
    // 展示路径统一用 / 分隔，兼容 Windows 输入的反斜杠
    const query = rawQuery.replaceAll('\\', '/')
    const slash = query.lastIndexOf('/')
    if (query === '' || slash >= 0) {
      // 目录级查询：定位目录前缀与剩余片段后实时列目录
      const directory = slash < 0 ? '' : query.slice(0, slash + 1)
      const fragment = slash < 0 ? '' : query.slice(slash + 1)
      return this.listDirectory(directory, fragment, signal)
    }
    const indexed = await this.indexFor(signal)
    return rankCandidates(
      indexed.filter(candidate => visibleForGlobalQuery(candidate.path, query)),
      query,
      this.config.maxResults,
    )
  }

  /**
   * Mark the index stale so a later bare query observes a fresh tree.
   *
   * The stale entries are kept and keep answering: a rebuild costs one
   * traversal of the whole workspace, and putting that in front of the caret
   * is what a caller invalidating on every tool result would otherwise pay.
   */
  invalidate(): void {
    this.invalidations += 1
  }

  /** Abort traversal and make later queries return no candidates. */
  /* 终止遍历并让之后的查询返回空列表（服务/agent 销毁时调用）。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation?.controller.abort(new Error('file search index disposed'))
    this.generation = undefined
    this.settled = undefined
  }

  /**
   * The entries a bare fuzzy query ranks. Only the first query of a workspace
   * waits for a traversal; afterwards a stale index answers immediately and
   * its replacement builds in the background.
   * @param signal - cancels this caller's wait without killing a shared traversal.
   * @returns indexed paths, at most one invalidation behind the tree.
   */
  private async indexFor(signal: AbortSignal): Promise<readonly IndexedPath[]> {
    const settled = this.settled
    if (settled === undefined) return waitForPromise(this.ensureIndex(), signal)
    if (settled.startedAt < this.invalidations) {
      void this.ensureIndex().catch(() => {
        // A background refresh failure is not this caller's error: the stale
        // entries still answer and `settled.startedAt` stays behind, so the
        // next bare query starts a fresh attempt.
      })
    }
    return settled.entries
  }

  /**
   * 获取当前代索引；不存在时启动一代新扫描。多查询并发时共享同一 promise，
   * 失败的代会把 generation 清空以便下次重试。
   * @returns 索引结果 promise
   */
  private ensureIndex(): Promise<IndexedPath[]> {
    if (this.generation !== undefined) return this.generation.promise
    const controller = new AbortController()
    const startedAt = this.invalidations
    const generation = {
      controller,
      promise: Promise.resolve([] as IndexedPath[]),
    } satisfies IndexGeneration
    generation.promise = this.scanWorkspace(controller.signal).then(
      (entries) => {
        /* v8 ignore next -- disposal aborts this traversal, so it reaches the
         * rejection handler instead; the guard only covers a scan that finished
         * its last directory in the instant before the abort landed, and must
         * not hand a disposed index its entries back. */
        if (this.disposed) return entries
        this.generation = undefined
        this.settled = { entries, startedAt }
        return entries
      },
      (error: unknown) => {
        /* v8 ignore next -- dispose clears `generation` synchronously; this only protects an unexpected scan failure */
        if (this.generation === generation) this.generation = undefined
        throw error
      },
    )
    this.generation = generation
    return generation.promise
  }

  /**
   * 广度优先遍历工作区建立索引：用一个队列模拟 BFS，逐层读目录；
   * 跳过排除目录，条目数到 maxEntries 即停止，全程响应取消信号。
   * @param signal 本代扫描的取消信号
   * @returns 全部索引路径
   */
  private async scanWorkspace(signal: AbortSignal): Promise<IndexedPath[]> {
    const indexed: IndexedPath[] = []
    // BFS 队列：每项是目录的绝对路径与相对展示路径
    const directories: { absolute: string; relative: string }[] = [{ absolute: this.root, relative: '' }]
    for (let cursor = 0; cursor < directories.length && indexed.length < this.config.maxEntries; cursor += 1) {
      signal.throwIfAborted()
      const directory = directories[cursor]
      /* v8 ignore next 3 -- cursor is bounded by this exact queue's length. */
      if (directory === undefined) {
        throw new Error('file search selected a missing directory')
      }
      // The root is not a subtree: an unreadable branch costs its own
      // candidates, but an unreadable root means the traversal learned
      // nothing. Letting that settle would publish an empty index over
      // entries that are still good and leave no invalidation to retry from.
      const entries = cursor === 0
        ? await readWorkspaceRoot(directory.absolute, signal)
        : await readDirectory(directory.absolute, signal)
      for (const entry of entries) {
        signal.throwIfAborted()
        // 相对展示路径：根目录直接取名，否则父目录相对路径 + / + 名字
        const path = directory.relative === '' ? entry.name : `${directory.relative}/${entry.name}`
        if (entry.isDirectory()) {
          if (this.excludedDirectories.has(entry.name)) continue
          indexed.push({ path, kind: 'directory' })
          // 目录进队列继续下钻
          directories.push({ absolute: join(directory.absolute, entry.name), relative: path })
        } else if (entry.isFile()) {
          indexed.push({ path, kind: 'file' })
        }
        if (indexed.length >= this.config.maxEntries) break
      }
    }
    return indexed
  }

  /**
   * 目录级查询：把展示目录解析为安全的绝对路径后实时列出其内容并排序。
   * @param displayDirectory 以 / 结尾的目录前缀（可能为空字符串）
   * @param fragment 目录前缀之后的输入片段（文件名过滤关键字）
   * @param signal 取消信号
   * @returns 排序后的候选列表；路径不安全或目录不存在时返回空数组
   */
  private async listDirectory(
    displayDirectory: string,
    fragment: string,
    signal: AbortSignal,
  ): Promise<FileReferenceCandidate[]> {
    // 路径中含被排除目录的查询直接拒绝（如 @node_modules/...）
    if (displayDirectory.split('/').some(segment => this.excludedDirectories.has(segment))) return []
    const absolute = await resolveDisplayDirectory(this.root, displayDirectory, signal)
    if (absolute === undefined) return []
    const entries = await readDirectory(absolute, signal)
    const candidates: FileReferenceCandidate[] = []
    for (const entry of entries) {
      // 输入未显式给点时跳过隐藏文件/目录（避免补全被 .git 等干扰）
      if (entry.name.startsWith('.') && !fragment.startsWith('.')) continue
      if (entry.isDirectory()) {
        if (this.excludedDirectories.has(entry.name)) continue
        candidates.push({ path: `${displayDirectory}${entry.name}`, kind: 'directory' })
      } else if (entry.isFile()) {
        candidates.push({ path: `${displayDirectory}${entry.name}`, kind: 'file' })
      }
    }
    return rankCandidates(candidates, fragment, this.config.maxResults)
  }
}

/**
 * 把用户输入的展示目录解析为绝对路径，并做穿越防护：
 * 解析结果必须仍位于根目录内，且逐段 lstat 校验（任一段是符号链接
 * 或非目录都拒绝），防止 @ 补全被用来探测工作区之外的文件。
 * @param root 工作区根目录（绝对路径）
 * @param displayDirectory 以 / 分隔的展示目录（可为空字符串）
 * @param signal 取消信号
 * @returns 安全的绝对路径；解析越界或中途遇到链接/缺失时返回 undefined
 */
async function resolveDisplayDirectory(
  root: string,
  displayDirectory: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const resolvedRoot = resolve(root)
  const absolute = resolve(resolvedRoot, displayDirectory === '' ? '.' : displayDirectory)
  // 相对根目录的偏移：为 '..' 或以 ..\ 开头说明已逃出工作区
  const fromRoot = relative(resolvedRoot, absolute)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return undefined
  /* v8 ignore next -- only Windows can produce a cross-volume absolute relative path */
  if (isAbsolute(fromRoot)) return undefined
  // 逐段向下校验：任何一段是符号链接或非目录都拒绝，防目录穿越
  let current = resolvedRoot
  for (const segment of fromRoot.split(sep).filter(Boolean)) {
    signal.throwIfAborted()
    current = join(current, segment)
    try {
      const status = await lstat(current)
      signal.throwIfAborted()
      if (status.isSymbolicLink() || !status.isDirectory()) return undefined
    } catch (_error: unknown) {
      signal.throwIfAborted()
      return undefined
    }
  }
  return absolute
}

async function readWorkspaceRoot(absolute: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const entries = await readdir(absolute, { withFileTypes: true })
  signal.throwIfAborted()
  return entries.sort((left, right) => compareText(left.name, right.name))
}

async function readDirectory(absolute: string, signal: AbortSignal) {
  signal.throwIfAborted()
  try {
    const entries = await readdir(absolute, { withFileTypes: true })
    signal.throwIfAborted()
    return entries.sort((left, right) => compareText(left.name, right.name))
  } catch (_error: unknown) {
    signal.throwIfAborted()
    // An unreadable/missing subtree contributes no candidates; other readable
    // branches remain useful and autocomplete is advisory.
    return []
  }
}

/**
 * 全局裸查询的可见性过滤：用户没显式给点（如 .git）时，隐藏路径
 * 一律不参与模糊匹配，避免补全被版本库内部文件淹没。
 * @param path 候选的相对展示路径
 * @param query 用户输入（含点开头即视为显式要求显示隐藏）
 * @returns 是否对该查询可见
 */
function visibleForGlobalQuery(path: string, query: string): boolean {
  if (query.startsWith('.') || query.includes('/.')) return true
  return !path.split('/').some(segment => segment.startsWith('.'))
}

/**
 * 对候选打分排序并截断到 limit。打分规则见 scoreCandidate；同分时
 * 目录优先，再按路径长度、最后按字典序，保证结果确定可复现。
 * @param candidates 待排序候选
 * @param query 用户输入关键字（空串时全部分数相同）
 * @param limit 返回数量上限
 * @returns 排序截断后的候选
 */
function rankCandidates(
  candidates: readonly FileReferenceCandidate[],
  query: string,
  limit: number,
): FileReferenceCandidate[] {
  const ranked: RankedPath[] = []
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, query)
    if (score !== undefined) ranked.push({ candidate, score })
  }
  ranked.sort((left, right) =>
    right.score - left.score
    || kindRank(left.candidate.kind) - kindRank(right.candidate.kind)
    || (query === '' ? 0 : left.candidate.path.length - right.candidate.path.length)
    || compareText(left.candidate.path, right.candidate.path))
  return ranked.slice(0, limit).map(entry => entry.candidate)
}

/**
 * 给单个候选打分：分数从高到低依次为 名称精确相等 > 名称前缀 > 名称包含 >
 * 完整路径包含 > 子序列匹配；目录额外加 25 分偏向；完全无匹配返回 undefined。
 * @param candidate 待打分候选
 * @param query 用户输入关键字（空串返回 0 分，即全部平等）
 * @returns 分数；无任何匹配关系时返回 undefined
 */
function scoreCandidate(candidate: FileReferenceCandidate, query: string): number | undefined {
  if (query === '') return 0
  const path = candidate.path.toLowerCase()
  // 只取 basename 参与名称类匹配
  const name = path.slice(path.lastIndexOf('/') + 1)
  const needle = query.toLowerCase()
  const directoryBonus = candidate.kind === 'directory' ? 25 : 0
  if (name === needle) return 1_000 + directoryBonus
  if (name.startsWith(needle)) return 900 + directoryBonus
  if (name.includes(needle)) return 700 + directoryBonus
  if (path.includes(needle)) return 500 + directoryBonus
  const subsequence = subsequenceScore(path, needle)
  return subsequence === undefined ? undefined : 300 + subsequence + directoryBonus
}

/**
 * 子序列匹配打分：关键字每个字符按顺序出现在路径中即可得分，
 * 字符间距越大得分越低（gap 越大越不连续），返回 0 到 100。
 * @param target 小写化的路径
 * @param query 小写化的关键字
 * @returns 子序列分数；关键字无法按序匹配时返回 undefined
 */
function subsequenceScore(target: string, query: string): number | undefined {
  let targetIndex = 0
  let gap = 0
  for (const character of query) {
    const found = target.indexOf(character, targetIndex)
    if (found < 0) return undefined
    gap += found - targetIndex
    targetIndex = found + 1
  }
  return Math.max(0, 100 - gap)
}

/** 目录排 0、文件排 1：同分时目录优先展示（可继续下钻）。 */
function kindRank(kind: FileReferenceCandidate['kind']): number {
  return kind === 'directory' ? 0 : 1
}

/** 纯字典序比较（entry 与候选均唯一，两个方向都一致）。 */
function compareText(left: string, right: string): number {
  /* v8 ignore next -- entries and candidates are unique; host enumeration
   * order determines which comparison direction sort requests. */
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * 等待一个 promise 同时响应外部取消：取消时以取消原因 reject，
 * 正常完成时移除监听避免泄漏。
 * @param promise 待等待的 promise（如索引构建）
 * @param signal 外部取消信号
 * @returns 与 promise 相同的结果；被取消则 reject
 */
function waitForPromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  /* v8 ignore next -- `list()` checks this signal immediately before its synchronous call into this helper */
  if (signal.aborted) return Promise.reject(errorReason(signal.reason, 'file search aborted'))
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = (): void => { rejectPromise(errorReason(signal.reason, 'file search aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        rejectPromise(errorReason(error, 'file search index failed'))
      },
    )
  })
}

/** 把任意原因归一化为 Error：已是 Error 直接复用，否则包一层带 cause。 */
function errorReason(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback, { cause: reason })
}
