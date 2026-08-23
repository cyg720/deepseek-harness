/**
 * ================================ 文件注释 ================================
 * 【文件职责】fs-local 的"无 Cordis 依赖的本地文件系统机制"：路径解析、元数据探测、
 * 整文件/流式文本读取、二进制拒绝、原子写入与字面编辑的底层实现。
 * 【技术维度】核心手法：写文件先在同目录的私有暂存目录（0700）里用独占方式（wx）
 * 建暂存文件（0600），写完 fsync 后按平台选择发布原语——POSIX 用 rename，Windows
 * 用 ReplaceFileW（保留 ACL）；createIfAbsent 用硬链接（link）实现"不覆盖"。行窗口
 * 属于 dsh-tool-fs，本层只保证返回已校验的 UTF-8 文本。
 * 【产品维度】本地磁盘后端的"引擎"：被 fs-local 的 LocalFileSystem 调用，
 * 提供模型文件操作所需的稳定身份（realpath 派生 targetKey）与原子变更保证。
 * 【逻辑维度】按出现顺序：错误判定助手 → 可中止读取 → 版本令牌 → 测试接缝
 * FsIoInternals → 目标/元数据/目录条目类型 → resolveLocalTarget（路径解析）→
 * 探测（probe/probeNoFollow）→ 列举（listDirectory）→ 读取（readWholeText/
 * readWholeBytes/streamWholeText）→ 写入（writeFileAtomic 及失败翻译）→ 编辑
 * （行尾检测/归一化、readForEdit、readTextForDiff、applyLiteralEdit）。
 * 【关键边界】本文件遍布 v8 ignore pragma（覆盖需要文件系统/内核故障的稀有分支），
 * 注释已避开这些 pragma 与目标行的相邻关系；大文件上限、二进制/NUL 拒绝、
 * 行尾归一化（编辑 diff 一律用 LF 基准）都是本层的硬约束。
 * 【新手阅读建议】先读 resolveLocalTarget 理解"稳定身份从哪来"，再读
 * writeFileAtomic 理解原子写协议，最后读 applyLiteralEdit 理解编辑匹配规则。
 * ==========================================================================
 */
/**
 * Cordis-free local filesystem mechanics. This provider layer returns validated UTF-8 text,
 * streams large files, and rejects binary data; line windows belong to `dsh-tool-fs`. Writes
 * stage an exclusive owner-only file in a private sibling directory and atomically publish it.
 * @module @deepseek-ai/dsh-fs-local/fsio
 */
/**
 * 模块总览：本文件不含 Cordis 依赖，是纯文件系统机制层；LocalFileSystem（index.ts）
 * 负责服务接线（ctx.fs）与按目标键加锁，真正的读写原子性都在这里。
 */

import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, link, lstat, mkdir, open, readFile, realpath, readdir, rename, rm, stat } from 'node:fs/promises'
import type { BigIntStats, Dirent, Stats } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { TextDecoder } from 'node:util'
import { FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import { copyFileDaclWin32, replaceFileWin32 } from './win32.ts'

// 二进制判定采样的字节数：只检查文件开头 8 KiB 是否含 NUL 字节。
const BINARY_SAMPLE_BYTES = 8192
// Bound one non-abortable FileHandle.read so cancellation is observed between chunks.
// 中文说明：单次 FileHandle.read 不可中止，限制每次读取的字节数，让取消能在块之间被观察到。
const DIFF_BASIS_READ_CHUNK_BYTES = 64 * 1024

// 判断"文件不存在"（ENOENT）的错误。
function isENOENT(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

// 判断"文件已存在"（EEXIST）的错误。
function isEEXIST(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

/**
 * A path component that is expected to be a directory is a regular file (e.g.
 * resolving `afile/child.txt` when `afile` is a file). Like `ENOENT`, the target
 * cannot exist — so the resolution/probe paths treat it as "absent" rather than
 * letting a raw Node error escape without the structured `FsError` taxonomy.
 */
/**
 * 判断"路径中的目录段实际是文件"（ENOTDIR），例如 afile 是文件时解析 afile/child.txt。
 * 与 ENOENT 一样意味着目标不可能存在——解析/探测路径把它当"不存在"处理，
 * 而不是让裸 Node 错误逃出结构化 FsError 分类。
 */
function isENOTDIR(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOTDIR'
}

// 判断中止错误（AbortError，Node 取消读取时的拒绝类型）。
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

// 中文说明：errorMessage 负责把未知异常转成消息文本，用于组合"次要清理失败"的
// 报错；该分支需要主失败之后再来一次文件系统/内核故障，故被 v8 ignore 覆盖。
/* v8 ignore start -- composes secondary cleanup-failure messages, which require a filesystem/kernel fault after the primary failure. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
/* v8 ignore stop */

// 判断权限错误（EACCES/EPERM）。
function isPermissionError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM')
}

// 在信号已中止时抛出结构化的 FS_ABORTED 错误（verb 用于报错文案）。
function throwIfAborted(signal: AbortSignal | undefined, verb: string): void {
  if (signal?.aborted) throw new FsError(`${verb} aborted`, 'FS_ABORTED')
}

/**
 * `readFile` with the supplied signal, translating a mid-read `AbortError` into
 * the seam's structured `FsError('FS_ABORTED')` (Node rejects an aborted
 * `readFile` with a bare `AbortError`, which would otherwise escape the seam's
 * error taxonomy — the streaming/write paths translate it the same way).
 */
/**
 * 带信号的可中止 readFile：把读中途的 AbortError 翻译成接缝的结构化
 * FsError(FS_ABORTED)。原因：Node 对已中止的 readFile 会拒绝一个裸 AbortError，
 * 若不加翻译它就会逃出接缝的错误分类体系（流式/写入路径也做同样的翻译）。
 */
async function readFileAbortable(absolutePath: string, verb: 'read' | 'edit', signal?: AbortSignal): Promise<Buffer> {
  try {
    return await readFile(absolutePath, signal ? { signal } : {})
  } catch (error: unknown) {
    /* v8 ignore next 2 -- a non-abort readFile rejection needs a permission/IO fault racing an open file. */
    if (!isAbortError(error)) throw error
    throw new FsError(`${verb} aborted`, 'FS_ABORTED')
  }
}

/** Opaque version token from high-resolution identity and freshness metadata. */
/** 从高精度身份与新鲜度元数据派生的不透明版本令牌：设备号+inode+大小+两个纳秒时间戳。 */
function versionOf(info: BigIntStats): FsVersion {
  return FsVersion(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`)
}

/**
 * Test hook: lets specs pin the atomic-write temp names (to prove exclusive-open behavior without
 * a name race), override native boundaries, and observe the staged temp file before publication.
 */
/**
 * 测试接缝：让测试能固定原子写的临时名字（在无名字竞争的情况下证明独占打开行为）、
 * 覆盖原生边界、并在发布前观察暂存文件。
 */
export interface FsIoInternals {
  /** Override the host platform for native-publication unit coverage. */
  /** 覆盖宿主平台，用于原生发布逻辑的单测覆盖。 */
  platform?: NodeJS.Platform
  /** Override the generated private staging-dir name (relative to the target dir). */
  /** 覆盖生成的私有暂存目录名（相对目标目录）。 */
  tempDirName?: (writePath: string) => string
  /** Override the generated temp-file name (relative to the private staging dir). */
  /** 覆盖生成的临时文件名（相对私有暂存目录）。 */
  tempName?: (writePath: string) => string
  /** Override the Win32 DACL copy boundary. */
  /** 覆盖 Win32 DACL 拷贝边界。 */
  copyFileDacl?: (source: string, destination: string) => Promise<void>
  /** Override the Win32 security-preserving replacement boundary. */
  /** 覆盖 Win32 保安全替换边界。 */
  replaceFile?: (replaced: string, replacement: string) => Promise<void>
  /** Override the hard-link no-replace publication boundary. */
  /** 覆盖硬链接"不覆盖"发布边界。 */
  linkFile?: (existingPath: string, newPath: string) => Promise<void>
  /** Override target inspection after guarded publication fails. */
  /** 覆盖守卫发布失败后的目标检查。 */
  inspectPublicationTarget?: (path: string) => Promise<BigIntStats>
  /** Override staging-directory removal for commit-point failure coverage. */
  /** 覆盖暂存目录删除（用于提交点失败覆盖）。 */
  removeStagingDir?: (stagingDir: string) => Promise<void>
  /** Test hook after the temp file is written/synced but before final chmod+publication. */
  /** 测试钩子：临时文件写完并 sync 后、最终 chmod+发布前触发。 */
  inspectTemp?: (paths: { stagingDir: string; tempPath: string }) => void | Promise<void>
  /** Test hook after raw-read stat preflight and before bounded content I/O. */
  /** 测试钩子：原始读取的 stat 预检之后、有界内容 I/O 之前触发。 */
  inspectReadBytesAfterStat?: (target: LocalTarget) => void | Promise<void>
}

/** A resolved local path: the absolute path shown to callers and its realpath identity. */
/**
 * 一个已解析的本地路径：展示给调用方的绝对路径 + 用作稳定身份的 realpath。
 */
export interface LocalTarget {
  /** Absolute path (symlinks not resolved) — used for display. */
  /** 绝对路径（不解析符号链接）——用于展示。 */
  displayPath: string
  /** Realpath identity — used as the stable target key and the I/O path. */
  /** realpath 身份——用作稳定目标键与 I/O 路径。 */
  targetKey: FsTargetKey
}

/** Result of probing a path: null when it does not exist. */
/** 探测一条路径的结果：不存在时为 null。 */
export interface PathInfo {
  version: FsVersion
  mode: number
  type: 'file' | 'directory' | 'other'
  size: number
}

/** Result of probing a path without following the final symlink component. */
/** 不跟随末级符号链接探测一条路径的结果（多一个 symlink 类型）。 */
export interface PathLinkInfo {
  version: FsVersion
  mode: number
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
}

/** One local directory child with a resolved target and cheap metadata. */
/** 一个本地目录子项：已解析目标 + 廉价元数据。 */
export interface LocalDirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  target: LocalTarget
  version?: FsVersion
  size?: number
}

/**
 * Resolve a path to its absolute display path and realpath identity. For a missing target,
 * realpath the nearest existing ancestor and append the missing suffix, preserving identity
 * across symlinked ancestors before and after creation.
 * @param cwd - base directory a relative `path` resolves against.
 * @param path - absolute or relative path; empty/whitespace-only throws `FS_NOT_FOUND`.
 * @returns the absolute display path plus the realpath-derived stable target key.
 */
/**
 * 把路径解析成"绝对展示路径 + realpath 身份"。目标不存在时：对最近的已存在祖先做
 * realpath，再补上缺失后缀——这样在创建缺失目录前后，目标键保持稳定（身份跨符号链接
 * 祖先保持）。空/纯空白路径抛 FS_NOT_FOUND。
 * @param cwd 相对路径的基准目录。
 * @param path 绝对或相对路径。
 * @returns 绝对展示路径 + realpath 派生的稳定目标键。
 */
export async function resolveLocalTarget(cwd: string, path: string): Promise<LocalTarget> {
  if (path.trim().length === 0) throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND')
  const displayPath = resolve(cwd, path)
  try {
    // Prefer the file's own realpath (resolves a symlinked file to its target).
    // 中文说明：优先用文件自己的 realpath（把符号链接文件解析到它的目标）。
    return { displayPath, targetKey: FsTargetKey(await realpath(displayPath)) }
  } catch (error: unknown) {
    // A path component is a file, not a directory (e.g. "afile/child.txt" where
    // "afile" is a regular file): the target can neither exist nor be created,
    // so surface the structured taxonomy instead of a raw Node ENOTDIR.
    // 中文说明：路径中的某一段是文件而非目录（如 afile 是普通文件时的
    // afile/child.txt）：目标既不能存在也不能被创建，所以给出结构化错误而非裸 ENOTDIR。
    /* v8 ignore next -- Windows reports this case as ENOENT and repairs it in the ancestor walk below. */
    if (isENOTDIR(error)) throw new FsError(`cannot resolve "${displayPath}": a parent path segment is not a directory`, 'FS_NOT_FOUND')
    /* v8 ignore next -- non-ENOENT realpath failure needs a permission/IO fault; ENOENT falls through to ancestor resolution. */
    if (!isENOENT(error)) throw error
  }
  // File absent: realpath the nearest existing ancestor and re-append the
  // missing suffix (the file basename plus any not-yet-created intermediate
  // dirs), so the key is stable across creation of those dirs.
  // 中文说明：文件不存在时：对最近的已存在祖先 realpath，再重新拼上缺失后缀
  // （文件基名 + 尚未创建的中间目录），使键在创建这些目录的过程中保持稳定。
  const missing = [basename(displayPath)]
  let ancestor = dirname(displayPath)
  while (true) {
    try {
      const realAncestor = await realpath(ancestor)
      // On Windows, realpath of a regular file succeeds where POSIX returns
      // ENOTDIR (the OS reports ENOENT for `regular-file/child`, not ENOTDIR).
      // Stat the ancestor to restore the semantic distinction: a non-directory
      // ancestor means the target passes through a file and can never be created.
      // 中文说明：Windows 上对普通文件做 realpath 会成功（POSIX 才返回 ENOTDIR，
      // 因为 Windows 对 regular-file/child 报 ENOENT）。这里 stat 祖先恢复语义区别：
      // 非目录祖先意味着目标要穿过一个文件、永远无法创建。
      /* v8 ignore start -- native Windows coverage exercises this repair; POSIX reports ENOTDIR before this point. */
      if (process.platform === 'win32') {
        const parentInfo = await stat(realAncestor)
        if (!parentInfo.isDirectory()) {
          throw new FsError(`cannot resolve "${displayPath}": a parent path segment is not a directory`, 'FS_NOT_FOUND')
        }
      }
      /* v8 ignore stop */
      return { displayPath, targetKey: FsTargetKey(join(realAncestor, ...missing)) }
    } catch (error: unknown) {
      /* v8 ignore next -- native Windows coverage exercises the FsError raised by the repair above. */
      if (error instanceof FsError) throw error
      /* v8 ignore next -- a non-ENOENT realpath failure needs a permission/IO fault. */
      if (!isENOENT(error)) throw error
      const parent = dirname(ancestor)
      /* v8 ignore next -- the filesystem root always realpaths, so the walk terminates before parent === ancestor. */
      if (parent === ancestor) return { displayPath, targetKey: FsTargetKey(displayPath) }
      missing.unshift(basename(ancestor))
      ancestor = parent
    }
  }
}

// 把 stat 结果映射成路径类型（file/directory/other）。
function pathType(info: Stats | BigIntStats): PathInfo['type'] {
  if (info.isFile()) return 'file'
  /* v8 ignore else -- Windows has no special-entry fixture for the non-directory branch. */
  if (info.isDirectory()) return 'directory'
  /* v8 ignore next -- the corresponding special-entry return is covered on POSIX. */
  return 'other'
}

// 不跟随末级链接的路径类型：先看是否符号链接，否则退化到 pathType。
function pathLinkType(info: Stats | BigIntStats): PathLinkInfo['type'] {
  if (info.isSymbolicLink()) return 'symlink'
  return pathType(info)
}

// 探测的通用骨架：调一次 stat/lstat，把 ENOENT/ENOTDIR 视为"不存在"返回 null。
async function probeStats<T extends Stats | BigIntStats>(
  absolutePath: string,
  readStats: (path: string) => Promise<T>,
): Promise<T | null> {
  try {
    return await readStats(absolutePath)
  } catch (error: unknown) {
    // ENOENT (no such file) and ENOTDIR (a parent segment is a file) both mean
    // the target is absent; any other metadata failure is a real permission/IO
    // fault.
    // 中文说明：ENOENT（无此文件）与 ENOTDIR（某段是文件）都表示目标不存在；
    // 其它元数据失败是真实的权限/IO 故障，直接抛出。
    /* v8 ignore next -- a non-ENOENT/ENOTDIR metadata failure needs a permission/IO fault; surface it. */
    if (!isENOENT(error) && !isENOTDIR(error)) throw error
    return null
  }
}

/**
 * Probe a path for its version, mode, type, and size. Null if absent.
 * @param absolutePath - the path to stat (typically a target key; symlinks are followed).
 * @returns the metadata, or null when the path — or a parent segment — does not exist.
 */
/**
 * 探测一条路径的版本/模式/类型/大小；不存在时返回 null。跟随符号链接。
 * @param absolutePath 要 stat 的路径（通常是目标键）。
 * @returns 元数据；路径或其父段不存在时为 null。
 */
export async function probe(absolutePath: string): Promise<PathInfo | null> {
  const info = await probeStats(absolutePath, path => stat(path, { bigint: true }))
  if (!info) return null
  return {
    version: versionOf(info),
    mode: Number(info.mode & 0o777n),
    type: pathType(info),
    size: Number(info.size),
  }
}

/**
 * Probe a path without following the final symlink component.
 * @param absolutePath - the path entry to inspect with `lstat` semantics.
 * @returns path-entry metadata, or null when the entry is absent.
 */
/**
 * 不跟随末级符号链接探测路径（lstat 语义）。
 * @param absolutePath 要检查的路径条目。
 * @returns 路径条目元数据；条目不存在时为 null。
 */
export async function probeNoFollow(absolutePath: string): Promise<PathLinkInfo | null> {
  const info = await probeStats(absolutePath, path => lstat(path, { bigint: true }))
  if (!info) return null
  return {
    version: versionOf(info),
    mode: Number(info.mode & 0o777n),
    type: pathLinkType(info),
    size: Number(info.size),
  }
}

// --- Directory listing ---

// 把列举过程中的任意异常翻译成结构化 FsError（按错误类型分流到合适错误码）。
function listingIoError(displayPath: string, error: unknown): FsError {
  /* v8 ignore next -- defensive pass-through for races where a child resolver has already produced a structured FsError. */
  if (error instanceof FsError) return error
  /* v8 ignore next -- requires the listed target/parent to disappear between successful preflight and listing/child resolution. */
  if (isENOENT(error) || isENOTDIR(error)) return new FsError(`cannot list "${displayPath}": not found`, 'FS_NOT_FOUND', { cause: error })
  /* v8 ignore next -- Windows chmod does not deny directory listing; POSIX covers permission translation. */
  if (isPermissionError(error)) return new FsError(`cannot list "${displayPath}": permission denied`, 'FS_PERMISSION_DENIED', { cause: error })
  return new FsError(`cannot list "${displayPath}": ${errorMessage(error)}`, 'FS_IO_ERROR', { cause: error })
}

// 解析一个列举出的子项目标：展示路径拼接在父展示路径下，身份用 realpath 派生。
async function resolveListedChildTarget(parent: LocalTarget, name: string): Promise<LocalTarget> {
  const identity = await resolveLocalTarget(parent.targetKey, name)
  return { displayPath: join(parent.displayPath, name), targetKey: identity.targetKey }
}

/**
 * List direct children of a directory in stable name order. Each child includes
 * a resolved target plus stat metadata when still available; file contents are
 * never read.
 * @param target - the resolved directory to list; a missing or non-directory target throws.
 * @param signal - aborts the listing, checked between children (`FS_ABORTED`).
 * @returns one entry per direct child, sorted by name.
 */
/**
 * 以稳定名字顺序列举目录的直接子项。每个子项包含已解析目标与（仍可取得时的）
 * stat 元数据；绝不读文件内容。目标缺失或不是目录会抛错；信号在子项之间检查。
 * @param target 要列举的已解析目录；缺失或非目录会抛错。
 * @param signal 中止列举（FS_ABORTED），在子项之间检查。
 * @returns 每个直接子项一条，按名字排序。
 */
export async function listDirectory(target: LocalTarget, signal?: AbortSignal): Promise<LocalDirEntry[]> {
  throwIfAborted(signal, 'list')
  let info: PathInfo | null
  try {
    info = await probe(target.targetKey)
  } catch (error: unknown) {
    throw listingIoError(target.displayPath, error)
  }
  if (!info) throw new FsError(`cannot list "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  if (info.type !== 'directory') throw new FsError(`cannot list "${target.displayPath}": not a directory`, 'FS_NOT_DIRECTORY')

  let entries: Dirent[]
  try {
    entries = await readdir(target.targetKey, { withFileTypes: true, encoding: 'utf8' })
  } catch (error: unknown) {
    /* v8 ignore next -- requires permission/kernel failure from readdir after a successful directory stat. */
    throw listingIoError(target.displayPath, error)
  }
  throwIfAborted(signal, 'list')

  const result: LocalDirEntry[] = []
  // 名字排序后逐子项：解析目标 + 探测元数据（存在则带版本，普通文件还带大小）。
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    throwIfAborted(signal, 'list')
    try {
      const childTarget = await resolveListedChildTarget(target, entry.name)
      const childInfo = await probe(childTarget.targetKey)
      result.push({
        name: entry.name,
        type: childInfo?.type ?? 'other',
        target: childTarget,
        ...(childInfo ? { version: childInfo.version } : {}),
        ...(childInfo?.type === 'file' ? { size: childInfo.size } : {}),
      })
    } catch (error: unknown) {
      throw listingIoError(join(target.displayPath, entry.name), error)
    }
    throwIfAborted(signal, 'list')
  }
  return result
}

// --- Reading ---

// 构造"不是合法 UTF-8 文本"错误（verb 用于区分 read/edit 文案）。
function notTextError(verb: 'read' | 'edit', displayPath: string): FsError {
  return new FsError(`cannot ${verb} "${displayPath}": invalid UTF-8 text`, 'FS_NOT_TEXT')
}

// 用致命模式解码 UTF-8（fatal: true 遇非法字节即抛），失败翻译成 FS_NOT_TEXT。
function decodeUtf8(buffer: Uint8Array, verb: 'read' | 'edit', displayPath: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch (error: unknown) {
    /* v8 ignore next 2 -- TextDecoder({fatal}) only throws TypeError on invalid bytes; any other throw is an unreachable runtime fault. */
    if (!(error instanceof TypeError)) throw error
    throw notTextError(verb, displayPath)
  }
}

// 流式解码一帧（chunk 为 undefined 时冲刷解码器余量），失败翻译成 FS_NOT_TEXT。
function decodeUtf8Stream(
  decoder: TextDecoder,
  chunk: Uint8Array | undefined,
  verb: 'read' | 'edit',
  displayPath: string,
): string {
  try {
    return chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode()
  } catch (error: unknown) {
    /* v8 ignore next 2 -- TextDecoder({fatal}) only throws TypeError on invalid bytes; any other throw is an unreachable runtime fault. */
    if (!(error instanceof TypeError)) throw error
    throw notTextError(verb, displayPath)
  }
}

// 读取前预检：目标必须是普通文件（缺失报 FS_NOT_FOUND，非文件报 FS_NOT_REGULAR_FILE）。
async function statRegularFile(target: LocalTarget, verb: 'read', signal?: AbortSignal): Promise<Stats> {
  throwIfAborted(signal, verb)
  let info: Stats
  try {
    info = await stat(target.targetKey)
  } catch (error: unknown) {
    /* v8 ignore next 2 -- a non-ENOENT stat failure needs a permission/IO fault; only the not-found path is reachable in tests. */
    if (!isENOENT(error)) throw error
    throw new FsError(`cannot ${verb} "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (!info.isFile()) throw new FsError(`cannot ${verb} "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  return info
}

/**
 * Read a whole regular UTF-8 text file into a single decoded string. Rejects
 * non-regular files, invalid UTF-8, and NUL-byte binary samples.
 * @param target - the resolved file to read.
 * @param signal - aborts the read (`FS_ABORTED`).
 * @returns the full decoded text, byte-for-byte (no normalization).
 */
/**
 * 把整个常规 UTF-8 文本文件读成一个已解码字符串。拒绝非普通文件、非法 UTF-8、
 * 以及含 NUL 字节的二进制样本。
 * @param target 要读取的已解析文件。
 * @param signal 中止读取（FS_ABORTED）。
 * @returns 完整解码文本，逐字节原样（不做归一化）。
 */
export async function readWholeText(target: LocalTarget, signal?: AbortSignal): Promise<string> {
  await statRegularFile(target, 'read', signal)
  const raw = await readFileAbortable(target.targetKey, 'read', signal)
  throwIfAborted(signal, 'read')
  // 二进制判定：文件开头采样范围内出现 NUL 字节即视为二进制。
  if (raw.subarray(0, BINARY_SAMPLE_BYTES).includes(0)) {
    throw new FsError(`cannot read "${target.displayPath}": binary file`, 'FS_NOT_TEXT')
  }
  return decodeUtf8(raw, 'read', target.displayPath)
}

/**
 * Read a whole regular file as raw bytes with no decoding or binary rejection.
 * `maxBytes` bounds the complete content: the stat size short-circuits an
 * oversized file before any content I/O, and the stream reads at most one byte
 * beyond the cap so a file growing after stat cannot cause unbounded buffering.
 * @param target - the resolved file to read.
 * @param signal - aborts the read (`FS_ABORTED`).
 * @param maxBytes - inclusive byte cap on the complete content (`FS_TOO_LARGE`).
 * @param internals - test seam for a deterministic post-stat growth race.
 * @returns the full raw content, at most `maxBytes` long.
 */
/**
 * 以原始字节读取整个常规文件，不做解码也不拒绝二进制。maxBytes 约束完整内容：
 * stat 大小先短路掉超限文件（在任何内容 I/O 之前），流最多读到上限多 1 字节，
 * 因此 stat 之后文件再增长也不会造成无界缓冲。
 * @param target 要读取的已解析文件。
 * @param signal 中止读取（FS_ABORTED）。
 * @param maxBytes 完整内容的字节上限（含）；超限报 FS_TOO_LARGE。
 * @param internals 测试接缝（模拟确定性的"stat 后增长"竞争）。
 * @returns 完整原始内容，最长不超过 maxBytes。
 */
export async function readWholeBytes(
  target: LocalTarget,
  signal: AbortSignal | undefined,
  maxBytes: number,
  internals: FsIoInternals = {},
): Promise<Uint8Array> {
  const info = await statRegularFile(target, 'read', signal)
  if (info.size > maxBytes) {
    throw new FsError(`cannot read "${target.displayPath}": ${info.size} bytes exceeds the ${maxBytes}-byte limit`, 'FS_TOO_LARGE')
  }
  await internals.inspectReadBytesAfterStat?.(target)
  // 流式读取：end 上限约束读取范围，跨块累计字节数再复核一次。
  const stream = createReadStream(target.targetKey, {
    end: maxBytes,
    ...signal ? { signal } : {},
  })
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      bytes += chunk.length
      if (bytes > maxBytes) {
        throw new FsError(`cannot read "${target.displayPath}": content exceeds the ${maxBytes}-byte limit`, 'FS_TOO_LARGE')
      }
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    /* v8 ignore next 2 -- a mid-stream abort needs cancellation racing an active read; pre-abort is deterministic. */
    if (isAbortError(error)) throw new FsError('read aborted', 'FS_ABORTED')
    throw error
  }
  return Buffer.concat(chunks, bytes)
}

/**
 * Stream a whole regular UTF-8 text file as decoded text chunks. Same text
 * semantics as {@link readWholeText} (regular-file check, binary/NUL rejection,
 * cross-chunk UTF-8 decoding), but never holds the whole file in memory.
 * @param target - the resolved file to stream.
 * @param signal - aborts the stream, including between chunks (`FS_ABORTED`).
 * @returns decoded text chunks in file order; chunk boundaries carry no meaning.
 */
/**
 * 以解码文本块流式读取整个常规 UTF-8 文本文件。文本语义与 readWholeText 相同
 * （普通文件检查、二进制/NUL 拒绝、跨块 UTF-8 解码），但从不把整个文件放内存。
 * @param target 要流式读取的已解析文件。
 * @param signal 中止流式读取，包括块与块之间（FS_ABORTED）。
 * @returns 按文件顺序的解码文本块；块边界无含义。
 */
export async function* streamWholeText(target: LocalTarget, signal?: AbortSignal): AsyncIterable<string> {
  await statRegularFile(target, 'read', signal)
  const stream = createReadStream(target.targetKey, signal ? { signal } : {})
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let sampledBytes = 0

  // 只在前 8 KiB 内扫描 NUL 字节：达到采样量后不再检查（成本固定）。
  function scanBinarySample(chunk: Buffer): void {
    if (sampledBytes >= BINARY_SAMPLE_BYTES) return
    const sample = chunk.subarray(0, Math.min(chunk.length, BINARY_SAMPLE_BYTES - sampledBytes))
    if (sample.includes(0)) {
      throw new FsError(`cannot read "${target.displayPath}": binary file`, 'FS_NOT_TEXT')
    }
    sampledBytes += sample.length
  }

  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      scanBinarySample(chunk)
      yield decodeUtf8Stream(decoder, chunk, 'read', target.displayPath)
    }
    // 冲刷解码器余量（最后一帧可能残留半个多字节字符）。
    yield decodeUtf8Stream(decoder, undefined, 'read', target.displayPath)
  } catch (error: unknown) {
    /* v8 ignore next 4 -- mid-stream errors need an abort/IO fault racing the loop; pre-abort is caught by throwIfAborted. */
    if (isAbortError(error)) throw new FsError('read aborted', 'FS_ABORTED')
    throw error
  }
}

// --- Writing ---

// 清理暂存目录；清理也失败时组合"写失败 + 清理失败"的双重报错，否则重抛原错误。
async function removeStagingDirOrThrow(
  stagingDir: string,
  originalError: unknown,
  removeStagingDir: (path: string) => Promise<void>,
): Promise<never> {
  try {
    await removeStagingDir(stagingDir)
  } catch (cleanupError: unknown) {
    /* v8 ignore next 1 -- cleanup failure here needs a second filesystem fault after the primary write failure. */
    throw new FsError(`write failed (${errorMessage(originalError)}) and temp cleanup failed (${errorMessage(cleanupError)})`, 'FS_NOT_FOUND', { cause: originalError })
  }
  throw originalError
}

// 守卫写（createIfAbsent）失败的翻译：检查发布目标区分"已存在/不是文件/其它错误"。
async function throwGuardedCreateFailure(
  error: unknown,
  absolutePath: string,
  displayPath: string,
  inspectPublicationTarget: (path: string) => Promise<BigIntStats>,
): Promise<never> {
  let existing: BigIntStats | undefined
  try {
    existing = await inspectPublicationTarget(absolutePath)
  } catch (metadataError: unknown) {
    if (!isENOENT(metadataError) && !isENOTDIR(metadataError)) {
      throw new FsError(`cannot write "${displayPath}": ${errorMessage(metadataError)}`, 'FS_IO_ERROR', { cause: metadataError })
    }
  }

  // Link errno values vary by platform and filesystem. Inspect the target entry
  // after failure so a collision is not confused with missing hard-link support.
  // 中文说明：链接失败的 errno 因平台与文件系统而异。失败后检查目标条目，
  // 以便把"撞名"与"文件系统不支持硬链接"区分开。
  if (existing !== undefined) {
    if (!existing.isFile()) {
      throw new FsError(`cannot write "${displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE', { cause: error })
    }
    throw new FsError(
      `cannot overwrite existing "${displayPath}" without reading it first`,
      'FS_NOT_OBSERVED',
      { cause: error },
    )
  }
  if (isEEXIST(error)) {
    throw new FsError(
      `cannot overwrite existing "${displayPath}" without reading it first`,
      'FS_NOT_OBSERVED',
      { cause: error },
    )
  }
  throw new FsError(`cannot write "${displayPath}": ${errorMessage(error)}`, 'FS_IO_ERROR', { cause: error })
}

/**
 * Atomically replace a file through a private, synced staging file in the same directory.
 * POSIX protects the staging directory and file with `0o700` and `0o600`. A new Windows file
 * inherits the destination directory's DACL; a replacement copies the existing target's DACL
 * onto the empty temp before writing and preserves the target descriptor at publication.
 * @param absolutePath - destination; missing parent directories are created.
 * @param content - the full UTF-8 text to write.
 * @param mode - existing destination's POSIX mode to preserve, or `undefined` for a new file;
 * inert as a mode on Windows but identifies replacement security semantics.
 * @param signal - cancellation checked before final publication.
 * @param internals - Test hook for pinning temp names and observing the staged file.
 * @param createIfAbsent - when provided, publish with a hard-link no-replace
 * primitive; a concurrent creator's file is preserved and this write is
 * rejected with `FS_NOT_OBSERVED` using the supplied display path.
 */
/**
 * 通过同目录下的私有、已 sync 的暂存文件原子替换目标文件。POSIX 上暂存目录与文件
 * 分别用 0700/0600 保护。Windows 上新文件继承目标目录的 DACL；替换则先把既有目标的
 * DACL 拷到空暂存文件上，再在发布时保留目标描述符。
 * @param absolutePath 目标路径；缺失的父目录会被创建。
 * @param content 要写入的完整 UTF-8 文本。
 * @param mode 要保留的既有目标 POSIX 模式；新文件为 undefined。Windows 上作为模式
 *  无效，但用于标识"替换"的安全语义。
 * @param signal 最终发布前检查的取消信号。
 * @param internals 固定临时名、观察暂存文件的测试钩子。
 * @param createIfAbsent 提供时用硬链接"不覆盖"原语发布；并发创建者的文件会被保留，
 *  本次写以 FS_NOT_OBSERVED 拒绝（用提供的展示路径报错）。
 */
export async function writeFileAtomic(
  absolutePath: string,
  content: string,
  mode: number | undefined,
  signal: AbortSignal | undefined,
  internals: FsIoInternals = {},
  createIfAbsent?: { displayPath: string },
): Promise<void> {
  throwIfAborted(signal, 'write')
  const directory = dirname(absolutePath)
  await mkdir(directory, { recursive: true })

  throwIfAborted(signal, 'write')
  // 暂存目录名/文件名可被测试覆盖；默认名带进程号与随机 UUID，避免名字竞争。
  const stagingDirName = internals.tempDirName?.(absolutePath) ?? `.${basename(absolutePath)}.${process.pid}.${randomUUID()}.tmpdir`
  const stagingDir = join(directory, stagingDirName)
  const tempName = internals.tempName?.(absolutePath) ?? `${basename(absolutePath)}.tmp`
  const tempPath = join(stagingDir, tempName)
  // 平台相关边界可被测试覆盖（原生边界默认值见各 ?? 右侧）。
  const platform = internals.platform ?? process.platform
  const copyFileDacl = internals.copyFileDacl ?? copyFileDaclWin32
  const replaceFile = internals.replaceFile ?? replaceFileWin32
  const linkFile = internals.linkFile ?? link
  const inspectPublicationTarget = internals.inspectPublicationTarget
    ?? (path => lstat(path, { bigint: true }))
  const removeStagingDir = internals.removeStagingDir
    ?? (path => rm(path, { recursive: true, force: true }))
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let stagingCreated = false
  try {
    // 阶段一：暂存。私有目录 0700、独占创建 0600 临时文件，写内容并 sync。
    await mkdir(stagingDir, { mode: 0o700 })
    stagingCreated = true
    await chmod(stagingDir, 0o700)

    handle = await open(tempPath, 'wx', 0o600)
    await handle.chmod(0o600)
    // Windows 替换：把既有目标 DACL 拷到空暂存文件（写内容之前）。
    if (platform === 'win32' && mode !== undefined) {
      await copyFileDacl(absolutePath, tempPath)
    }
    await handle.writeFile(content, { encoding: 'utf8', ...signal ? { signal } : {} })
    await handle.sync()
    await internals.inspectTemp?.({ stagingDir, tempPath })
    if (mode !== undefined) await handle.chmod(mode)
    await handle.close()
    handle = undefined

    // 阶段二：发布。三种原语：createIfAbsent 用硬链接（不覆盖）、Windows 替换用
    // ReplaceFileW（保 ACL）、其它用 rename。发布后清理暂存目录。
    throwIfAborted(signal, 'write')
    if (createIfAbsent !== undefined) {
      try {
        await linkFile(tempPath, absolutePath)
      } catch (error: unknown) {
        await throwGuardedCreateFailure(error, absolutePath, createIfAbsent.displayPath, inspectPublicationTarget)
      }
    } else if (platform === 'win32' && mode !== undefined) {
      try {
        await replaceFile(absolutePath, tempPath)
      } catch (error: unknown) {
        // If the observed target disappears during staging, the protected DACL
        // already copied to the temp remains authoritative for recreation.
        // 中文说明：暂存期间被观察的目标消失了——此时已拷到临时文件上的受保护
        // DACL 仍是重建时该用的权威描述符，退回普通 rename。
        if (!isENOENT(error)) throw error
        await rename(tempPath, absolutePath)
      }
    } else {
      await rename(tempPath, absolutePath)
    }
    try {
      await removeStagingDir(stagingDir)
    } catch (_committedStagingCleanupFailure) {
      // The target is committed; owner-only staging residue cannot turn that write into a failure.
      // 中文说明：目标已提交；仅属主的暂存残留不能把这次写入变成失败，忽略清理失败。
    }
  } catch (error: unknown) {
    /* v8 ignore next -- abort-mid-write needs a writeFile/signal race; the non-abort (rename/open) side is tested. */
    let failure: unknown = isAbortError(error) ? new FsError('write aborted', 'FS_ABORTED') : error
    /* v8 ignore next 8 -- reached only if writeFile/sync throws with the handle open (IO fault); close-failure is a double fault. */
    if (handle) {
      try {
        await handle.close()
      } catch (closeError: unknown) {
        failure = new FsError(`write failed (${errorMessage(failure)}) and temp close failed (${errorMessage(closeError)})`, 'FS_NOT_FOUND', { cause: failure })
      }
    }
    if (!stagingCreated) throw failure
    return removeStagingDirOrThrow(stagingDir, failure, removeStagingDir)
  }
}

// --- Editing ---

/** Line ending style detected before LF normalization. */
/** LF 归一化前检测到的行尾风格：LF（Unix）或 CRLF（Windows）。 */
export type LineEndings = 'LF' | 'CRLF'

/**
 * Collapse CRLF to LF — the canonical in-memory form every edit/diff basis
 * uses. Lone `\r` bytes (not followed by `\n`) are left untouched.
 * @param content - decoded text in whatever line-ending style the file had.
 * @returns the text with every `\r\n` pair replaced by `\n`.
 */
/**
 * 把 CRLF 折叠成 LF——所有编辑/diff 基准使用的规范内存形式。孤立的 \r（后不跟 \n）
 * 保持原样。
 * @param content 任意行尾风格的已解码文本。
 * @returns 每个 \r\n 都被替换成 \n 的文本。
 */
function normalizeLineEndings(content: string): string {
  return content.replaceAll('\r\n', '\n')
}

// 检测行尾风格：取前 4 KiB 采样，比较 CRLF 与"裸 LF"的数量，多的那种胜出。
function detectLineEndings(raw: string): LineEndings {
  const sample = raw.slice(0, 4096)
  const crlfCount = sample.split('\r\n').length - 1
  const lfCount = sample.split('\n').length - 1 - crlfCount
  return crlfCount > lfCount ? 'CRLF' : 'LF'
}

/**
 * Convert LF-normalized content back to the line-ending style detected at read
 * time, for write-back. `LF` returns the content unchanged; `CRLF` re-normalizes
 * first so an already-CRLF sequence is never doubled to `\r\r\n`.
 * @param content - the LF-normalized (edited) text.
 * @param lineEndings - the original file's style, as detected by {@link readForEdit}.
 * @returns the text in the original file's line-ending style.
 */
/**
 * 把 LF 归一化内容还原成读取时检测到的行尾风格，用于写回。LF 原样返回；
 * CRLF 先归一化再转换，避免已存在的 CRLF 序列被加倍成 \r\r\n。
 * @param content 已编辑的 LF 归一化文本。
 * @param lineEndings 原文件的行尾风格（readForEdit 检测）。
 * @returns 原行尾风格的文本。
 */
function restoreLineEndings(content: string, lineEndings: LineEndings): string {
  return lineEndings === 'LF' ? content : normalizeLineEndings(content).split('\n').join('\r\n')
}

// 统计 needle 在 content 中出现的次数（非重叠）。
function countOccurrences(content: string, needle: string): number {
  let count = 0
  let index = 0
  while (true) {
    const found = content.indexOf(needle, index)
    if (found === -1) return count
    count += 1
    index = found + needle.length
  }
}

/**
 * Read and decode a file for editing: rejects binaries, returns LF-normalized
 * content plus the original line-ending style for write-back.
 * @param absolutePath - the file to read (typically a target key).
 * @param displayPath - the caller-facing path used in error messages.
 * @param signal - aborts the read (`FS_ABORTED`).
 * @returns the LF-normalized content and the detected style to restore on write-back.
 */
/**
 * 读取并解码文件用于编辑：拒绝二进制，返回 LF 归一化内容 + 写回所需的原行尾风格。
 * @param absolutePath 要读取的文件（通常是目标键）。
 * @param displayPath 报错时使用的展示路径。
 * @param signal 中止读取（FS_ABORTED）。
 * @returns LF 归一化内容与写回时要还原的行尾风格。
 */
export async function readForEdit(
  absolutePath: string,
  displayPath: string,
  signal?: AbortSignal,
): Promise<{ content: string; lineEndings: LineEndings }> {
  throwIfAborted(signal, 'edit')
  const buffer = await readFileAbortable(absolutePath, 'edit', signal)
  throwIfAborted(signal, 'edit')
  // 编辑路径的二进制判定：整个缓冲区含 NUL 即拒绝（读路径只采样前 8 KiB）。
  if (buffer.includes(0)) throw new FsError(`cannot edit "${displayPath}": binary file`, 'FS_NOT_TEXT')
  const raw = decodeUtf8(buffer, 'edit', displayPath)
  return { content: normalizeLineEndings(raw), lineEndings: detectLineEndings(raw) }
}

/**
 * Best-effort overwrite diff basis. Binary, invalid UTF-8, a file at/above the byte limit,
 * or a file deleted/made unreadable after the caller's preflight returns `null` so the write
 * still succeeds and presentation falls back to a whole-file diff. The bound is enforced on
 * the opened descriptor rather than a prior path stat, so concurrent external replacement or
 * size changes cannot make this helper buffer more than `maxBytes`.
 * @param absolutePath - the file to read (typically a target key).
 * @param maxBytes - exclusive upper bound for bytes held as the contextual-diff basis.
 * @param signal - aborts the read (`FS_ABORTED`); cancellation propagates, unlike I/O failure.
 * @returns the LF-normalized text, or null for a non-regular, at/above-limit, binary, non-UTF-8,
 * descriptor-size-changed, or unreadable file.
 */
/**
 * "尽力而为"的覆盖写 diff 基础（写前旧内容快照）。二进制、非法 UTF-8、达到/超过
 * 字节上限、或调用方预检后被删除/不可读的文件都返回 null——写入照常成功，
 * 展示层退化为整文件 diff。上限在"已打开的描述符"上强制而非先前的路径 stat，
 * 因此并发的外部替换或大小变化不可能让本助手缓冲超过 maxBytes。
 * @param absolutePath 要读取的文件（通常是目标键）。
 * @param maxBytes 作为上下文 diff 基础所持有的字节独占上限。
 * @param signal 中止读取（FS_ABORTED）；与 I/O 失败不同，取消会继续传播。
 * @returns LF 归一化文本；对非普通文件、达到/超限、二进制、非 UTF-8、描述符大小
 *  变化或不可读文件返回 null。
 */
export async function readTextForDiff(
  absolutePath: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string | null> {
  throwIfAborted(signal, 'read')
  try {
    const handle = await open(absolutePath, 'r')
    let buffer: Buffer
    let total = 0
    let openedSize = 0
    try {
      throwIfAborted(signal, 'read')
      const info = await handle.stat()
      throwIfAborted(signal, 'read')
      if (!info.isFile()) return null
      if (info.size >= maxBytes) return null
      openedSize = info.size
      // One extra byte detects growth after stat without retaining per-read backing buffers.
      // 中文说明：多分配 1 字节用于检测 stat 之后的增长，且不保留逐次读的后备缓冲。
      buffer = Buffer.allocUnsafe(openedSize + 1)
      while (total < buffer.length) {
        throwIfAborted(signal, 'read')
        const length = Math.min(buffer.length - total, DIFF_BASIS_READ_CHUNK_BYTES)
        const { bytesRead } = await handle.read(buffer, total, length, null)
        if (bytesRead === 0) break
        total += bytesRead
      }
    } finally {
      await handle.close()
    }
    throwIfAborted(signal, 'read')
    // 读到的大小与 stat 不一致（并发增长/收缩）：放弃这次尽力而为的基础。
    if (total !== openedSize) return null
    const basis = buffer.subarray(0, total)
    if (basis.includes(0)) return null
    try {
      return normalizeLineEndings(new TextDecoder('utf-8', { fatal: true }).decode(basis))
    } catch (error: unknown) {
      /* v8 ignore next 2 -- TextDecoder({fatal}) only throws TypeError on invalid bytes;
       * any other throw is an unreachable runtime fault. */
      if (!(error instanceof TypeError)) throw error
      return null
    }
  } catch (error: unknown) {
    // Cancellation is the caller's intent and still propagates.
    // 中文说明：取消是调用方意图，仍然传播。
    if (error instanceof FsError) throw error
    // A descriptor-phase errno — deleted or made unreadable after the caller's
    // preflight, or a faulted read — costs only the optional basis: a committed
    // write must not fail for a presentation-only pre-read.
    // 中文说明：描述符阶段的 errno（预检后被删/不可读，或读取故障）只损失这个
    // 可选基础——已提交的写入绝不能因为一次纯展示的预读而失败。
    if (error instanceof Error && 'code' in error) return null
    throw error
  }
}

/**
 * Apply a literal replacement to LF-normalized content. Empty or missing search text throws
 * `FS_EDIT_NOT_FOUND`; multiple matches throw `FS_AMBIGUOUS_EDIT` unless `replaceAll` is true.
 * @param content - the current file content, already LF-normalized.
 * @param oldString - literal text to find; CRLF inside it is normalized to LF before
 *   matching.
 * @param newString - literal replacement text, normalized the same way.
 * @param replaceAll - replace every match instead of requiring exactly one.
 * @param displayPath - the caller-facing path used in error messages.
 * @returns the edited LF-normalized content plus how many occurrences were replaced.
 */
/**
 * 在 LF 归一化内容上应用字面替换。空搜索文本或未找到抛 FS_EDIT_NOT_FOUND；
 * 多处匹配且 replaceAll 为 false 时抛 FS_AMBIGUOUS_EDIT。
 * @param content 当前文件内容（已 LF 归一化）。
 * @param oldString 要查找的字面文本；其中的 CRLF 在匹配前归一化为 LF。
 * @param newString 替换文本，同样先归一化。
 * @param replaceAll true 时替换所有匹配，false 时要求恰好一处。
 * @param displayPath 报错时使用的展示路径。
 * @returns 编辑后的 LF 归一化内容 + 实际替换次数。
 */
export function applyLiteralEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  displayPath: string,
): { content: string; replacements: number } {
  const oldNorm = normalizeLineEndings(oldString)
  if (oldNorm.length === 0) {
    throw new FsError('old_string must be a non-empty string', 'FS_EDIT_NOT_FOUND')
  }
  const newNorm = normalizeLineEndings(newString)
  const replacements = countOccurrences(content, oldNorm)
  if (replacements === 0) {
    throw new FsError(`old_string was not found in "${displayPath}"`, 'FS_EDIT_NOT_FOUND')
  }
  if (!replaceAll && replacements > 1) {
    throw new FsError(`old_string matched ${replacements} times in "${displayPath}"; provide a more specific old_string or set replace_all to true`, 'FS_AMBIGUOUS_EDIT')
  }
  return { content: content.split(oldNorm).join(newNorm), replacements }
}

// 行尾归一化/还原函数同时供 fs-local 的 index.ts 使用（写结果与 diff 基准共享 LF）。
export { normalizeLineEndings, restoreLineEndings }
