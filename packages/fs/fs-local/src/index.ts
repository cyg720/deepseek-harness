/**
 * ================================ 文件注释 ================================
 * 【文件职责】ctx.fs 的"宿主文件系统实现"（LocalFileSystem）：把 dsh-fs 的 Service
 * Definition 落到真实磁盘上——realpath 派生的目标身份让别名共享过期守卫，穿过符号
 * 链接写入会更新其目标而不替换链接本身。
 * 【技术维度】继承 FileSystem 抽象类实现全部抽象方法；细活都在 fsio.ts（解析/探测/
 * 原子写/编辑）。本文件特有的职责：①按 targetKey 的 FIFO 锁（withLock）串行化变更
 * 操作，让"读→守卫→写"窗口不交错；②写/编辑前后的守卫检查（版本/意图）；③可配置
 * 的 diff 基础上限（diffBasisMaxBytes）。
 * 【产品维度】本地磁盘是默认的文件能力提供者：模型读写工作区文件的真实落地实现，
 * 配合工具层（tool-fs）对外暴露为读/写/编辑工具。
 * 【逻辑维度】按出现顺序：Config 接口与默认常量 → LocalFileSystem 类（static Config、
 * config/internals/locks 字段、constructor 校验、withLock、resolve/processPath/fileUrl/
 * contains/stat/lstat/readText/streamText/readBytes/listDir、writeText、editText、
 * versionAfterWrite）。
 * 【关键边界】cwd 只是"相对路径的解析基准"，不是包含边界（containment）——需要更
 * 严格限制时用沙箱后端或权限插件；withLock 保证同键操作 FIFO 有序但每个操作完成后
 * 锁即释放（不是事务）；并发写/编辑会确定性排序（一个赢，其余因版本过期而拒绝）。
 * 【新手阅读建议】先看 withLock 理解并发控制，再看 writeText/editText 的守卫流程，
 * 最后看 resolve/contains 理解身份与包含关系的语义。
 * ==========================================================================
 */
/**
 * Host-filesystem implementation of `ctx.fs`. Realpath-derived target identity makes aliases
 * share stale guards, and writes through a symlink update its target without replacing the link.
 * @module @deepseek-ai/dsh-fs-local
 */
/*
 * 模块总览：本文件是"本地磁盘后端"的服务层；路径解析、原子写、编辑等机制
 * 都在 fsio.ts，本文件负责接线、加锁与守卫检查。
 */

import { Context } from '@deepseek-ai/cordis'
import { constants as bufferConstants } from 'node:buffer'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { FileSystem, FsError, FsVersion } from '@deepseek-ai/dsh-fs'
import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import {
  applyLiteralEdit,
  listDirectory,
  normalizeLineEndings,
  probe,
  probeNoFollow,
  readForEdit,
  readTextForDiff,
  readWholeBytes,
  readWholeText,
  resolveLocalTarget,
  restoreLineEndings,
  streamWholeText,
  writeFileAtomic,
} from './fsio.ts'
import type { FsIoInternals } from './fsio.ts'

/** Configuration for the local filesystem backend. */
/*
 * 本地文件系统后端配置。
 */
export interface Config {
  /** Base directory for relative paths. Defaults to `process.cwd()`. */
  /* 相对路径的基准目录；默认 process.cwd()。 */
  cwd?: string
  /**
   * Exclusive UTF-8 byte limit on each overwrite-diff side, capped by the
   * runtime's safe allocation/decode maximum. Defaults to 10 MiB.
   */
  /*
   * 覆盖写 diff 每一侧的 UTF-8 字节独占上限，再被运行时安全分配/解码上限封顶。
   * 默认 10 MiB。
   */
  diffBasisMaxBytes?: number
}

type ResolvedConfig = Required<Config>
// diff 基础的默认上限：10 MiB。
const DEFAULT_DIFF_BASIS_MAX_BYTES = 10 * 1024 * 1024
// 运行时允许的最大上限：取 Node 缓冲与字符串长度上限的较小者。
const MAX_DIFF_BASIS_BYTES = Math.min(
  bufferConstants.MAX_LENGTH,
  bufferConstants.MAX_STRING_LENGTH,
)

/**
 * The host-filesystem backend. Reads resolve relative paths from {@link Config.cwd}
 * (a resolution default, NOT a containment boundary — see the filesystem
 * capability-seam Agent Note); enforce
 * containment with a stricter backend or a `tools/execute` permission plugin.
 */
/*
 * 宿主文件系统后端。相对路径从 Config.cwd 解析（这只是"解析基准"，不是包含边界
 *  containment——参见文件系统能力接缝的 Agent Note）；需要包含限制时用更严格的后端
 * 或 tools/execute 权限插件。
 */
export class LocalFileSystem extends FileSystem {
  // 插件的 schemastery 校验器：cwd 默认进程启动目录，diffBasisMaxBytes 默认 10 MiB。
  static Config: z<Config> = z.object({
    cwd: z.string().default(process.cwd()),
    diffBasisMaxBytes: z.number().default(DEFAULT_DIFF_BASIS_MAX_BYTES),
  })

  /** Validated config (schemastery applied the defaults before construction). */
  /* 已校验配置（schemastery 在构造前已套用默认值）。 */
  readonly config: ResolvedConfig
  /** Test hook forwarded to fsio for atomic-publication boundaries. */
  /* 测试钩子：转发给 fsio 用于原子发布边界（临时名固定、原生边界覆盖等）。 */
  internals: FsIoInternals = {}
  /** Per-targetKey tail promise: serializes mutating ops so the read→guard→write
   * window can't interleave, making concurrent writes/edits deterministically
   * ordered (one wins, the rest see the new version and reject as stale). */
  /* 每个 targetKey 一条"尾部 Promise"：串行化变更操作，使"读→守卫→写"窗口不会
   * 交错——并发写/编辑被确定性排序（一个赢，其余看到新版本并按过期拒绝）。 */
  private locks = new Map<string, Promise<unknown>>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    const resolved = config as ResolvedConfig
    // 校验 diff 基础上限：必须是正整数且不超过运行时安全上限。
    if (!Number.isSafeInteger(resolved.diffBasisMaxBytes)
      || resolved.diffBasisMaxBytes <= 0
      || resolved.diffBasisMaxBytes > MAX_DIFF_BASIS_BYTES) {
      throw new Error(`fs-local: diffBasisMaxBytes must be a positive safe integer no greater than ${MAX_DIFF_BASIS_BYTES}`)
    }
    this.config = resolved
  }

  /** Run `op` with exclusive access to `targetKey` (FIFO per key). */
  /* 以 targetKey 的独占访问执行 op（每键 FIFO 排队）。 */
  private async withLock<T>(targetKey: string, op: () => Promise<T>): Promise<T> {
    // 取当前尾部（或已解析 Promise），把自己的执行串在其后。
    const prior = this.locks.get(targetKey) ?? Promise.resolve()
    const run = prior.then(op, op)
    // Keep the chain alive but swallow this op's result/throw for the *next* waiter.
    // 中文说明：让链保持存活，但把本次 op 的结果/抛错吞掉（供下一个等待者排队用）。
    const tail = run.then(() => undefined, () => undefined)
    this.locks.set(targetKey, tail)
    try {
      return await run
    } finally {
      // 只有自己是当前尾部才删除锁（防过期清理误删新任务）。
      if (this.locks.get(targetKey) === tail) {
        this.locks.delete(targetKey)
      }
    }
  }

  // 解析路径为稳定目标：fsio 负责 realpath 身份派生；往返前后各查一次取消信号。
  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    if (opts?.signal?.aborted) throw new FsError('resolve aborted', 'FS_ABORTED')
    const local = await resolveLocalTarget(opts?.cwd ?? this.config.cwd, path)
    if (opts?.signal?.aborted) throw new FsError('resolve aborted', 'FS_ABORTED')
    return { targetKey: local.targetKey, displayPath: local.displayPath }
  }

  // 进程路径：本地后端的目标键就是可打开的绝对路径。
  override processPath(target: FsTarget): string {
    return String(target.targetKey)
  }

  override processPathFromHostPath(hostPath: string): string | undefined {
    return isAbsolute(hostPath) ? resolve(hostPath) : undefined
  }

  override fileUrl(target: FsTarget): string {
    return pathToFileURL(this.processPath(target)).href
  }

  // 包含关系：子路径相对父路径的位移既不是空、也不以 .. 开头、也不是绝对路径。
  override contains(parent: FsTarget, child: FsTarget): boolean {
    const path = relative(this.processPath(parent), this.processPath(child))
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  }

  // stat：往返前后检查取消，探测结果映射成 FsInfo（不存在返回 undefined）。
  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    if (signal?.aborted) throw new FsError('stat aborted', 'FS_ABORTED')
    const info = await probe(target.targetKey)
    if (signal?.aborted) throw new FsError('stat aborted', 'FS_ABORTED')
    if (!info) return undefined
    return { version: info.version, type: info.type, size: info.size }
  }

  // lstat：路径级探测（不跟随末级符号链接），空路径直接报 FS_NOT_FOUND。
  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    if (signal?.aborted) throw new FsError('lstat aborted', 'FS_ABORTED')
    if (path.trim().length === 0) throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND')
    const info = await probeNoFollow(resolve(opts?.cwd ?? this.config.cwd, path))
    if (signal?.aborted) throw new FsError('lstat aborted', 'FS_ABORTED')
    if (!info) return undefined
    return { version: info.version, type: info.type, size: info.size }
  }

  // 整文件文本读取：委托 fsio（含二进制拒绝与 UTF-8 校验）。
  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    return readWholeText({ displayPath: target.displayPath, targetKey: target.targetKey }, signal)
  }

  // 流式文本读取：委托 fsio 的流式实现（大文件）。
  override streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    return Promise.resolve(streamWholeText({ displayPath: target.displayPath, targetKey: target.targetKey }, signal))
  }

  // 原始字节读取（带字节上限）：委托 fsio。
  override async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    return readWholeBytes({ displayPath: target.displayPath, targetKey: target.targetKey }, signal, maxBytes, this.internals)
  }

  // 目录列举：委托 fsio，并把 LocalDirEntry 映射回 dsh-fs 的 FsDirEntry。
  override async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    const entries = await listDirectory({ displayPath: target.displayPath, targetKey: target.targetKey }, signal)
    return entries.map(entry => ({
      name: entry.name,
      type: entry.type,
      target: { targetKey: entry.target.targetKey, displayPath: entry.target.displayPath },
      ...(entry.version !== undefined ? { version: entry.version } : {}),
      ...(entry.size !== undefined ? { size: entry.size } : {}),
    }))
  }

  // 原子写入：加锁后依次做"存在性/类型检查 → 守卫（意图/版本）检查 → 尽力而为的
  // diff 基础快照 → 原子发布 → 组装结果"。
  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    return this.withLock(target.targetKey, async () => {
      const existing = await probe(target.targetKey)
      if (existing && existing.type !== 'file') {
        throw new FsError(`cannot write "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }

      if (expected?.kind === 'replaceIfVersion') {
        // Stale guard: the file must still exist at the version the owner observed.
        // 中文说明：过期守卫——文件必须以拥有者观察到的版本仍然存在。
        if (!existing) throw new FsError(`cannot write "${target.displayPath}": file no longer exists`, 'FS_STALE_VERSION')
        if (existing.version !== expected.version) {
          throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
        }
      } else if (expected?.kind === 'createIfAbsent' && existing) {
        // createIfAbsent onto an existing file: a blind overwrite — require a read first.
        // 中文说明：createIfAbsent 撞上已存在文件 = 盲目覆盖——要求先读过。
        throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
      }
      // No expectation means an unconditional but still atomic write.
      // 中文说明：无预期 = 无条件但依然原子的写。

      // Capture an optional contextual-diff basis before the write. The bounded
      // reader checks the opened file itself, so an external replacement after
      // `probe()` cannot turn this best-effort presentation read into an
      // unbounded allocation. Either side at/above the configured limit yields
      // `before: null`; consumers retain their whole-file fallback.
      // 中文说明：写前抓取可选的上下文 diff 基础（旧内容快照）。有界读取器检查的是
      // 已打开的文件本身，因此 probe() 之后的外部替换不可能把这次尽力而为的展示读
      // 变成无界分配。任何一侧达到/超过配置上限都得到 before: null，消费方保留
      // 整文件 diff 兜底。
      const diffable = existing !== null
        && Buffer.byteLength(content, 'utf8') < this.config.diffBasisMaxBytes
      const before = diffable
        ? await readTextForDiff(target.targetKey, this.config.diffBasisMaxBytes, signal)
        : null
      await writeFileAtomic(
        target.targetKey,
        content,
        existing?.mode,
        signal,
        this.internals,
        expected?.kind === 'createIfAbsent' ? { displayPath: target.displayPath } : undefined,
      )
      const after = await probe(target.targetKey)
      return {
        operation: existing ? 'update' : 'create',
        version: this.versionAfterWrite(after, target),
        before,
        // LF-normalized to share the diff basis with `before` (also LF): a CRLF
        // overwrite must not read as every line changed. Line-ending restoration
        // is a storage detail the applied-hunk diff ignores.
        // 中文说明：LF 归一化以与 before（同样 LF）共享 diff 基础：CRLF 覆盖不能
        // 读起来像每行都变了。行尾还原是存储细节，应用补丁的 diff 忽略它。
        after: normalizeLineEndings(content),
      }
    })
  }

  // 原子编辑：加锁后做"存在性/类型检查 → 版本守卫 → 读原文 → 字面替换 → 还原行尾
  // → 原子发布 → 组装结果"。版本检查先于字面匹配，过期内容报 STALE 而非 NOT_FOUND。
  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
  ): Promise<FsEditOutcome> {
    return this.withLock(target.targetKey, async () => {
      const existing = await probe(target.targetKey)
      // Stale guard before literal matching: an edit based on an old read reports
      // FS_STALE_VERSION, not FS_EDIT_NOT_FOUND/FS_AMBIGUOUS_EDIT against newer content.
      // Missing targets use the same stale code on guarded and unconditional edit paths.
      // 中文说明：版本守卫先于字面匹配——基于旧读的编辑报 FS_STALE_VERSION，而不是
      // 对新内容报 FS_EDIT_NOT_FOUND/FS_AMBIGUOUS_EDIT。缺失目标在守卫与无条件
      // 编辑路径上都用同一个过期码。
      if (!existing) throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
      if (existing.type !== 'file') throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      // expected === undefined: unconditional edit of the current content — no
      // version guard. Still inside the per-target lock, so the read→match→write
      // window is serialized and atomic.
      // 中文说明：expected 为 undefined = 对当前内容做无条件编辑（无版本守卫）；
      // 仍在每目标锁内，所以"读→匹配→写"窗口被串行化且原子。
      if (expected && existing.version !== expected.version) {
        throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
      }

      const original = await readForEdit(target.targetKey, target.displayPath, signal)
      const edited = applyLiteralEdit(original.content, edit.oldString, edit.newString, edit.replaceAll, target.displayPath)
      const content = restoreLineEndings(edited.content, original.lineEndings)
      await writeFileAtomic(target.targetKey, content, existing.mode, signal, this.internals)

      const after = await probe(target.targetKey)
      return {
        version: this.versionAfterWrite(after, target),
        // The LF-normalized before/after text (the applied-hunk diff basis);
        // line-ending restoration is a storage detail the diff ignores.
        // 中文说明：LF 归一化的 before/after 文本（应用补丁的 diff 基础）；
        // 行尾还原是存储细节，diff 忽略它。
        before: original.content,
        after: edited.content,
      }
    })
  }

  // 中文说明（v8 ignore 须位于该 pragma 上方）：写/编辑后探测发现文件消失（并发
  // unlink 恰在 rename 与 stat 之间），退回一个"missing:" 哨兵版本，避免悬空。
  /* v8 ignore next 5 -- the post-write probe finding the file absent requires a
   * concurrent unlink between rename and stat; fall back to a sentinel version. */
  private versionAfterWrite(after: { version: FsVersion } | null, target: FsTarget): FsVersion {
    if (after) return after.version
    return FsVersion(`missing:${target.targetKey}`)
  }
}

// 服务包默认导出服务类本身（packages/AGENTS.md 约定）。
export default LocalFileSystem
