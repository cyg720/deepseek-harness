/**
 * E2B provider for the filesystem capability seam. Paths, contents, and
 * atomic staging files remain inside the shared remote sandbox.
 * @module @deepseek-ai/dsh-fs-e2b
 */
/**
 * 文件职责：实现E2B 远程沙箱的 index.ts 模块。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证E2B 远程沙箱在真实组装、失败和清理场景中可靠。
 * 逻辑维度：注册能力，转换请求并管理远程资源。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */

import { createHash, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { posix } from 'node:path'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
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
  CommandExitError,
  e2bControlEnvs,
  FileNotFoundError,
  FileType,
  quoteE2BShellArg,
} from '@deepseek-ai/dsh-e2b'
import type { EntryInfo, Sandbox } from '@deepseek-ai/dsh-e2b'

/** 中文说明：运行时局部值 VERSION_METADATA_KEY，由紧邻初始化决定。 */
const VERSION_METADATA_KEY = 'dsh-version'
/** 中文说明：运行时局部值 BINARY_SAMPLE_BYTES，由紧邻初始化决定。 */
const BINARY_SAMPLE_BYTES = 8192
/** 中文说明：运行时局部值 BASE64，由紧邻初始化决定。 */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** 中文说明：函数 assertNotAborted 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertNotAborted(signal: AbortSignal | undefined, operation: string): void {
  if (signal?.aborted === true) throw new FsError(`${operation} aborted`, 'FS_ABORTED')
}

/** 中文说明：函数 normalizeLineEndings 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function normalizeLineEndings(value: string): string {
  return value.replaceAll('\r\n', '\n')
}

/** 中文说明：函数 detectsCrlf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function detectsCrlf(value: string): boolean {
  /** 中文说明：运行时局部值 sample，由紧邻初始化决定。 */
  const sample = value.slice(0, 4096)
  /** 中文说明：运行时局部值 crlf，由紧邻初始化决定。 */
  const crlf = sample.split('\r\n').length - 1
  /** 中文说明：运行时局部值 lf，由紧邻初始化决定。 */
  const lf = sample.split('\n').length - 1 - crlf
  return crlf > lf
}

/** 中文说明：函数 restoreLineEndings 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function restoreLineEndings(value: string, crlf: boolean): string {
  return crlf ? normalizeLineEndings(value).replaceAll('\n', '\r\n') : value
}

/** 中文说明：函数 decodeText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function decodeText(bytes: Uint8Array, displayPath: string, binarySampleBytes: number): string {
  if (bytes.subarray(0, binarySampleBytes).includes(0)) {
    throw new FsError(`cannot read "${displayPath}": binary file`, 'FS_NOT_TEXT')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error: unknown) {
    throw new FsError(`cannot read "${displayPath}": invalid UTF-8 text`, 'FS_NOT_TEXT', { cause: error })
  }
}

/** 中文说明：函数 decodeCanonicalPath 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function decodeCanonicalPath(encoded: string): string {
  if (encoded.length === 0 || !BASE64.test(encoded)) {
    throw new Error('fs-e2b: canonical path transport returned invalid base64')
  }
  /** 中文说明：运行时局部值 framed，由紧邻初始化决定。 */
  const framed = Buffer.from(encoded, 'base64')
  if (framed.toString('base64') !== encoded
    || framed.length < 2
    || framed.at(-1) !== 0
    || framed.subarray(0, -1).includes(0)) {
    throw new Error('fs-e2b: canonical path transport returned invalid NUL framing')
  }
  /** 中文说明：运行时局部值 path: string，由紧邻初始化决定。 */
  let path: string
  try {
    path = new TextDecoder('utf-8', { fatal: true }).decode(framed.subarray(0, -1))
  } catch (error: unknown) {
    throw new Error('fs-e2b: canonical path is not valid UTF-8', { cause: error })
  }
  if (!posix.isAbsolute(path)) throw new Error('fs-e2b: canonical path is not absolute')
  return path
}

/** 中文说明：函数 signalOpts 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function signalOpts(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal }
}

/** 中文说明：函数 commandOpts 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function commandOpts(signal: AbortSignal | undefined): { envs: Record<string, string>; signal?: AbortSignal } {
  return { envs: e2bControlEnvs(), ...signalOpts(signal) }
}

/** 中文说明：函数 openReadStream 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function openReadStream(
  sandbox: Sandbox,
  target: FsTarget,
  signal: AbortSignal | undefined,
): Promise<ReadableStream<Uint8Array>> {
  try {
    // The pinned SDK's stream overload lies for empty files: content-length 0
    // returns '' instead of a ReadableStream.
    /** 中文说明：运行时局部值 read，由紧邻初始化决定。 */
    const read = await sandbox.files.read(String(target.targetKey), { format: 'stream', ...signalOpts(signal) }) as
      ReadableStream<Uint8Array> | string
    return typeof read === 'string'
      ? new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })
      : read
  } catch (error: unknown) {
    throw mapError(error, 'read', target.displayPath, signal)
  }
}

/** 中文说明：函数 entryType 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function entryType(entry: EntryInfo): FsInfo['type'] {
  switch (entry.type) {
    case FileType.FILE:
      return 'file'
    case FileType.DIR:
      return 'directory'
    default:
      return 'other'
  }
}

/** 中文说明：函数 entryVersion 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function entryVersion(entry: EntryInfo): ReturnType<typeof FsVersion> {
  /** 中文说明：运行时局部值 facts，由紧邻初始化决定。 */
  const facts = JSON.stringify([
    entry.metadata?.[VERSION_METADATA_KEY],
    entry.path,
    entry.type,
    entry.size,
    entry.mode,
    entry.modifiedTime?.toISOString(),
    entry.symlinkTarget,
  ])
  return FsVersion(`e2b:${createHash('sha256').update(facts).digest('hex')}`)
}

/** 中文说明：函数 mapError 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function mapError(error: unknown, operation: string, displayPath: string, signal?: AbortSignal): FsError {
  if (error instanceof FsError) return error
  if (signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')) {
    return new FsError(`${operation} aborted`, 'FS_ABORTED', { cause: error })
  }
  if (error instanceof FileNotFoundError) {
    return new FsError(`cannot ${operation} "${displayPath}": not found`, 'FS_NOT_FOUND', { cause: error })
  }
  if (/permission denied|operation not permitted/i.test(String(error))) {
    return new FsError(`cannot ${operation} "${displayPath}": permission denied`, 'FS_PERMISSION_DENIED', { cause: error })
  }
  return new FsError(`cannot ${operation} "${displayPath}": ${String(error)}`, 'FS_IO_ERROR', { cause: error })
}

/** 中文说明：函数 literalEdit 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function literalEdit(content: string, request: FsEditRequest, displayPath: string): string {
  /** 中文说明：运行时局部值 oldString，由紧邻初始化决定。 */
  const oldString = normalizeLineEndings(request.oldString)
  /** 中文说明：运行时局部值 newString，由紧邻初始化决定。 */
  const newString = normalizeLineEndings(request.newString)
  if (oldString.length === 0) {
    throw new FsError(`cannot edit "${displayPath}": old_string must be non-empty`, 'FS_EDIT_NOT_FOUND')
  }
  /** 中文说明：运行时局部值 matches，由紧邻初始化决定。 */
  let matches = 0
  /** 中文说明：运行时局部值 offset，由紧邻初始化决定。 */
  let offset = 0
  while (true) {
    /** 中文说明：运行时局部值 found，由紧邻初始化决定。 */
    const found = content.indexOf(oldString, offset)
    if (found < 0) break
    matches += 1
    offset = found + oldString.length
  }
  if (matches === 0) throw new FsError(`cannot edit "${displayPath}": old_string was not found`, 'FS_EDIT_NOT_FOUND')
  if (!request.replaceAll && matches !== 1) {
    throw new FsError(`cannot edit "${displayPath}": old_string matched ${matches} times`, 'FS_AMBIGUOUS_EDIT')
  }
  return request.replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
}

/** Remote filesystem backend sharing the sandbox owned by `ctx.e2b`. */
/** 中文说明：类型或类 E2BFileSystem 约束远程资源或测试数据职责。 */
export class E2BFileSystem extends FileSystem {
  static inject = ['e2b']

  private readonly locks = new Map<string, Promise<unknown>>()

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    assertNotAborted(opts?.signal, 'resolve')
    if (path.trim().length === 0) throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND')
    /** 中文说明：运行时局部值 displayPath，由紧邻初始化决定。 */
    const displayPath = posix.resolve(opts?.cwd ?? this.ctx.e2b.cwd, path)
    try {
      /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
      const sandbox = await this.ctx.e2b.getSandbox()
      /** 中文说明：运行时局部值 targetKey，由紧邻初始化决定。 */
      const targetKey = await this.canonicalPath(sandbox, displayPath, opts?.signal)
      assertNotAborted(opts?.signal, 'resolve')
      return { targetKey: FsTargetKey(targetKey), displayPath }
    } catch (error: unknown) {
      throw mapError(error, 'resolve', displayPath, opts?.signal)
    }
  }

  override processPath(target: FsTarget): string {
    return String(target.targetKey)
  }

  override fileUrl(target: FsTarget): string {
    /** 中文说明：运行时局部值 path，由紧邻初始化决定。 */
    const path = this.processPath(target)
    if (!posix.isAbsolute(path)) throw new Error(`fs-e2b: expected an absolute process path: ${JSON.stringify(path)}`)
    return `file://${path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
  }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    /** 中文说明：运行时局部值 relative，由紧邻初始化决定。 */
    const relative = posix.relative(this.processPath(parent), this.processPath(child))
    return relative === '' || (relative !== '..' && !relative.startsWith('../') && !posix.isAbsolute(relative))
  }

  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    assertNotAborted(signal, 'stat')
    /** 中文说明：运行时局部值 entry，由紧邻初始化决定。 */
    const entry = await this.probe(String(target.targetKey), target.displayPath, signal)
    if (entry === undefined) return undefined
    return {
      version: entryVersion(entry),
      type: entryType(entry),
      ...(entry.type === FileType.FILE ? { size: entry.size } : {}),
    }
  }

  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    assertNotAborted(signal, 'lstat')
    if (path.trim().length === 0) throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND')
    /** 中文说明：运行时局部值 displayPath，由紧邻初始化决定。 */
    const displayPath = posix.resolve(opts?.cwd ?? this.ctx.e2b.cwd, path)
    /** 中文说明：运行时局部值 entry，由紧邻初始化决定。 */
    const entry = await this.probe(displayPath, displayPath, signal)
    if (entry === undefined) return undefined
    /** 中文说明：运行时局部值 type，由紧邻初始化决定。 */
    const type = entry.symlinkTarget !== undefined
      ? 'symlink' as const
      : entry.type === FileType.FILE
        ? 'file' as const
        : entry.type === FileType.DIR
          ? 'directory' as const
          : 'other' as const
    return {
      version: entryVersion(entry),
      type,
      ...(entry.type === FileType.FILE ? { size: entry.size } : {}),
    }
  }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
    const sandbox = await this.ctx.e2b.getSandbox()
    await this.requireRegular(target, signal)
    try {
      /** 中文说明：运行时局部值 bytes，由紧邻初始化决定。 */
      const bytes = await sandbox.files.read(String(target.targetKey), { format: 'bytes', ...signalOpts(signal) })
      assertNotAborted(signal, 'read')
      return decodeText(bytes, target.displayPath, BINARY_SAMPLE_BYTES)
    } catch (error: unknown) {
      throw mapError(error, 'read', target.displayPath, signal)
    }
  }

  override async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
    const sandbox = await this.ctx.e2b.getSandbox()
    /** 中文说明：运行时局部值 info，由紧邻初始化决定。 */
    const info = await this.requireRegular(target, signal)
    if (info.size !== undefined && info.size > maxBytes) {
      throw new FsError(`cannot read "${target.displayPath}": ${info.size} bytes exceeds the ${maxBytes}-byte limit`, 'FS_TOO_LARGE')
    }
    /** 中文说明：运行时局部值 stream，由紧邻初始化决定。 */
    const stream = await openReadStream(sandbox, target, signal)
    /** 中文说明：运行时局部值 reader，由紧邻初始化决定。 */
    const reader = stream.getReader()
    /** 中文说明：运行时局部值 chunks，由紧邻初始化决定。 */
    const chunks: Uint8Array[] = []
    /** 中文说明：运行时局部值 bytes，由紧邻初始化决定。 */
    let bytes = 0
    /** 中文说明：运行时局部值 completed，由紧邻初始化决定。 */
    let completed = false
    try {
      while (true) {
        assertNotAborted(signal, 'read')
        /** 中文说明：运行时局部值 next，由紧邻初始化决定。 */
        const next = await reader.read()
        if (next.done) break
        // The stat preflight covers the at-rest case; this streamed bound stops
        // a post-stat grower without transferring past the first overflowing chunk.
        bytes += next.value.byteLength
        if (bytes > maxBytes) {
          throw new FsError(`cannot read "${target.displayPath}": content exceeds the ${maxBytes}-byte limit`, 'FS_TOO_LARGE')
        }
        chunks.push(next.value)
      }
      completed = true
    } catch (error: unknown) {
      throw mapError(error, 'read', target.displayPath, signal)
    } finally {
      if (!completed) {
        try {
          await reader.cancel()
        } catch (_streamCancellationFailure) {
          // The read already failed; a cancellation failure on the abandoned
          // remote stream adds nothing actionable for the caller.
        }
      }
      reader.releaseLock()
    }
    /** 中文说明：运行时局部值 whole，由紧邻初始化决定。 */
    const whole = new Uint8Array(bytes)
    /** 中文说明：运行时局部值 offset，由紧邻初始化决定。 */
    let offset = 0
    /** 中文说明：运行时局部值 chunk，由紧邻初始化决定。 */
    for (const chunk of chunks) {
      whole.set(chunk, offset)
      offset += chunk.byteLength
    }
    return whole
  }

  override async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
    const sandbox = await this.ctx.e2b.getSandbox()
    await this.requireRegular(target, signal)
    /** 中文说明：运行时局部值 stream，由紧邻初始化决定。 */
    const stream = await openReadStream(sandbox, target, signal)
    /** 中文说明：运行时局部值 displayPath，由紧邻初始化决定。 */
    const displayPath = target.displayPath
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        /** 中文说明：运行时局部值 reader，由紧邻初始化决定。 */
        const reader = stream.getReader()
        /** 中文说明：运行时局部值 decoder，由紧邻初始化决定。 */
        const decoder = new TextDecoder('utf-8', { fatal: true })
        /** 中文说明：运行时局部值 sampledBytes，由紧邻初始化决定。 */
        let sampledBytes = 0
        /** 中文说明：运行时局部值 completed，由紧邻初始化决定。 */
        let completed = false
        try {
          while (true) {
            assertNotAborted(signal, 'read')
            /** 中文说明：运行时局部值 next，由紧邻初始化决定。 */
            const next = await reader.read()
            if (next.done) break
            if (sampledBytes < BINARY_SAMPLE_BYTES) {
              /** 中文说明：运行时局部值 sample，由紧邻初始化决定。 */
              const sample = next.value.subarray(0, BINARY_SAMPLE_BYTES - sampledBytes)
              if (sample.includes(0)) throw new FsError(`cannot read "${displayPath}": binary file`, 'FS_NOT_TEXT')
              sampledBytes += sample.length
            }
            /** 中文说明：运行时局部值 text: string，由紧邻初始化决定。 */
            let text: string
            try {
              text = decoder.decode(next.value, { stream: true })
            } catch (error: unknown) {
              throw new FsError(`cannot read "${displayPath}": invalid UTF-8 text`, 'FS_NOT_TEXT', { cause: error })
            }
            if (text.length > 0) yield text
          }
          try {
            decoder.decode()
          } catch (error: unknown) {
            throw new FsError(`cannot read "${displayPath}": invalid UTF-8 text`, 'FS_NOT_TEXT', { cause: error })
          }
          completed = true
        } catch (error: unknown) {
          throw mapError(error, 'read', displayPath, signal)
        } finally {
          if (!completed) {
            try {
              await reader.cancel()
            } catch (_streamCancellationFailure) {
              // The primary read outcome owns the result; cancellation is best-effort after early stop.
            }
          }
          reader.releaseLock()
        }
      },
    }
  }

  override async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    /** 中文说明：运行时局部值 info，由紧邻初始化决定。 */
    const info = await this.stat(target, signal)
    if (info === undefined) throw new FsError(`cannot list "${target.displayPath}": not found`, 'FS_NOT_FOUND')
    if (info.type !== 'directory') throw new FsError(`cannot list "${target.displayPath}": not a directory`, 'FS_NOT_DIRECTORY')
    try {
      /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
      const sandbox = await this.ctx.e2b.getSandbox()
      /** 中文说明：运行时局部值 listed，由紧邻初始化决定。 */
      const listed = await sandbox.files.list(String(target.targetKey), { depth: 1, ...signalOpts(signal) })
      /** 中文说明：运行时局部值 entries，由紧邻初始化决定。 */
      const entries: FsDirEntry[] = []
      /** 中文说明：运行时局部值 entry，由紧邻初始化决定。 */
      for (const entry of listed) {
        /** 中文说明：运行时局部值 displayPath，由紧邻初始化决定。 */
        const displayPath = posix.join(target.displayPath, entry.name)
        /** 中文说明：运行时局部值 canonical，由紧邻初始化决定。 */
        const canonical = entry.symlinkTarget === undefined
          ? entry.path
          : await this.canonicalPath(sandbox, entry.path, signal)
        /** 中文说明：运行时局部值 resolved，由紧邻初始化决定。 */
        const resolved = entry.symlinkTarget === undefined
          ? entry
          : await this.probe(canonical, displayPath, signal)
        entries.push({
          name: entry.name,
          type: resolved === undefined ? 'other' : entryType(resolved),
          target: { targetKey: FsTargetKey(canonical), displayPath },
          ...(resolved !== undefined ? { version: entryVersion(resolved) } : {}),
          ...(resolved?.type === FileType.FILE ? { size: resolved.size } : {}),
        })
      }
      return entries.sort((left, right) => left.name.localeCompare(right.name))
    } catch (error: unknown) {
      throw mapError(error, 'list', target.displayPath, signal)
    }
  }

  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    return this.withLock(String(target.targetKey), async () => {
      /** 中文说明：运行时局部值 existing，由紧邻初始化决定。 */
      const existing = await this.probe(String(target.targetKey), target.displayPath, signal)
      if (existing !== undefined && entryType(existing) !== 'file') {
        throw new FsError(`cannot write "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      this.checkWriteIntent(existing, expected, target)
      /** 中文说明：运行时局部值 before，由紧邻初始化决定。 */
      const before = existing === undefined ? null : await this.readForDiff(target, signal)
      /** 中文说明：运行时局部值 version，由紧邻初始化决定。 */
      const version = await this.writeAtomic(
        target,
        content,
        existing,
        expected?.kind === 'createIfAbsent',
        signal,
      )
      return {
        operation: existing === undefined ? 'create' : 'update',
        version,
        before,
        after: normalizeLineEndings(content),
      }
    })
  }

  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: ReturnType<typeof FsVersion> },
    signal?: AbortSignal,
  ): Promise<FsEditOutcome> {
    return this.withLock(String(target.targetKey), async () => {
      /** 中文说明：运行时局部值 existing，由紧邻初始化决定。 */
      const existing = await this.probe(String(target.targetKey), target.displayPath, signal)
      if (existing === undefined) {
        throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
      }
      if (entryType(existing) !== 'file') {
        throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      if (expected !== undefined && entryVersion(existing) !== expected.version) {
        throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
      }
      /** 中文说明：运行时局部值 raw，由紧邻初始化决定。 */
      const raw = await this.readForEdit(target, signal)
      /** 中文说明：运行时局部值 before，由紧邻初始化决定。 */
      const before = normalizeLineEndings(raw)
      /** 中文说明：运行时局部值 after，由紧邻初始化决定。 */
      const after = literalEdit(before, edit, target.displayPath)
      /** 中文说明：运行时局部值 storage，由紧邻初始化决定。 */
      const storage = restoreLineEndings(after, detectsCrlf(raw))
      /** 中文说明：运行时局部值 version，由紧邻初始化决定。 */
      const version = await this.writeAtomic(target, storage, existing, false, signal)
      return { version, before, after }
    })
  }

  private async withLock<T>(targetKey: string, operation: () => Promise<T>): Promise<T> {
    /** 中文说明：运行时局部值 prior，由紧邻初始化决定。 */
    const prior = this.locks.get(targetKey) ?? Promise.resolve()
    /** 中文说明：运行时局部值 run，由紧邻初始化决定。 */
    const run = prior.then(operation, operation)
    /** 中文说明：运行时局部值 tail，由紧邻初始化决定。 */
    const tail = run.then(() => undefined, () => undefined)
    this.locks.set(targetKey, tail)
    try {
      return await run
    } finally {
      if (this.locks.get(targetKey) === tail) this.locks.delete(targetKey)
    }
  }

  private async canonicalPath(sandbox: Sandbox, path: string, signal?: AbortSignal): Promise<string> {
    try {
      /** 中文说明：运行时局部值 result，由紧邻初始化决定。 */
      const result = await sandbox.commands.run(
        `set -o pipefail; realpath -mz -- ${quoteE2BShellArg(path)} | base64 -w0`,
        commandOpts(signal),
      )
      return decodeCanonicalPath(result.stdout)
    } catch (error: unknown) {
      if (error instanceof CommandExitError) throw new Error(error.stderr || error.message, { cause: error })
      throw error
    }
  }

  private async probe(path: string, displayPath: string, signal?: AbortSignal): Promise<EntryInfo | undefined> {
    assertNotAborted(signal, 'stat')
    try {
      /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
      const sandbox = await this.ctx.e2b.getSandbox()
      /** 中文说明：运行时局部值 entry，由紧邻初始化决定。 */
      const entry = await sandbox.files.getInfo(path, signalOpts(signal))
      assertNotAborted(signal, 'stat')
      return entry
    } catch (error: unknown) {
      if (error instanceof FileNotFoundError) return undefined
      throw mapError(error, 'stat', displayPath, signal)
    }
  }

  private async requireRegular(target: FsTarget, signal?: AbortSignal): Promise<FsInfo> {
    /** 中文说明：运行时局部值 info，由紧邻初始化决定。 */
    const info = await this.stat(target, signal)
    if (info === undefined) throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
    if (info.type !== 'file') throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
    return info
  }

  private checkWriteIntent(existing: EntryInfo | undefined, expected: FsWriteIntent | undefined, target: FsTarget): void {
    if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
      throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
    }
    if (expected?.kind === 'replaceIfVersion') {
      if (existing === undefined || entryVersion(existing) !== expected.version) {
        throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
      }
    }
  }

  private async readForDiff(target: FsTarget, signal?: AbortSignal): Promise<string | null> {
    try {
      /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
      const sandbox = await this.ctx.e2b.getSandbox()
      /** 中文说明：运行时局部值 bytes，由紧邻初始化决定。 */
      const bytes = await sandbox.files.read(String(target.targetKey), { format: 'bytes', ...signalOpts(signal) })
      assertNotAborted(signal, 'read')
      return normalizeLineEndings(decodeText(bytes, target.displayPath, bytes.length))
    } catch (error: unknown) {
      if (error instanceof FsError && error.code === 'FS_NOT_TEXT') return null
      throw mapError(error, 'read', target.displayPath, signal)
    }
  }

  private async readForEdit(target: FsTarget, signal?: AbortSignal): Promise<string> {
    try {
      /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
      const sandbox = await this.ctx.e2b.getSandbox()
      /** 中文说明：运行时局部值 bytes，由紧邻初始化决定。 */
      const bytes = await sandbox.files.read(String(target.targetKey), { format: 'bytes', ...signalOpts(signal) })
      assertNotAborted(signal, 'edit')
      return decodeText(bytes, target.displayPath, bytes.length)
    } catch (error: unknown) {
      throw mapError(error, 'edit', target.displayPath, signal)
    }
  }

  private async writeAtomic(
    target: FsTarget,
    content: string,
    existing: EntryInfo | undefined,
    createIfAbsent: boolean,
    signal?: AbortSignal,
  ): Promise<ReturnType<typeof FsVersion>> {
    assertNotAborted(signal, 'write')
    /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
    const sandbox = await this.ctx.e2b.getSandbox()
    /** 中文说明：运行时局部值 targetPath，由紧邻初始化决定。 */
    const targetPath = String(target.targetKey)
    /** 中文说明：运行时局部值 versionId，由紧邻初始化决定。 */
    const versionId = randomUUID()
    /** 中文说明：运行时局部值 stagingDirectory，由紧邻初始化决定。 */
    const stagingDirectory = posix.join(posix.dirname(targetPath), `.dsh-${randomUUID()}.tmp`)
    /** 中文说明：运行时局部值 temporary，由紧邻初始化决定。 */
    const temporary = posix.join(stagingDirectory, 'content')
    /** 中文说明：运行时局部值 stagingDirectoryCreated，由紧邻初始化决定。 */
    let stagingDirectoryCreated = false
    try {
      /** 中文说明：运行时局部值 created，由紧邻初始化决定。 */
      const created = await sandbox.files.makeDir(stagingDirectory, signalOpts(signal))
      if (!created) throw new Error('private staging directory already exists')
      stagingDirectoryCreated = true
      await sandbox.commands.run(`chmod 700 -- ${quoteE2BShellArg(stagingDirectory)}`, commandOpts(signal))
      assertNotAborted(signal, 'write')
      await sandbox.files.write(temporary, content, {
        metadata: { [VERSION_METADATA_KEY]: versionId },
        ...signalOpts(signal),
      })
      assertNotAborted(signal, 'write')
      /** 中文说明：运行时局部值 mode，由紧邻初始化决定。 */
      const mode = existing === undefined ? 0o600 : existing.mode & 0o777
      await sandbox.commands.run(
        `chmod ${mode.toString(8)} -- ${quoteE2BShellArg(temporary)}`,
        commandOpts(signal),
      )
      assertNotAborted(signal, 'write')
      /** 中文说明：运行时局部值 committed: EntryInfo，由紧邻初始化决定。 */
      let committed: EntryInfo
      if (createIfAbsent) {
        /** 中文说明：运行时局部值 staged，由紧邻初始化决定。 */
        const staged = await sandbox.files.getInfo(temporary, signalOpts(signal))
        assertNotAborted(signal, 'write')
        /** 中文说明：运行时局部值 targetArg，由紧邻初始化决定。 */
        const targetArg = quoteE2BShellArg(targetPath)
        /** 中文说明：运行时局部值 publication，由紧邻初始化决定。 */
        const publication = await sandbox.commands.run(
          `if ln -T -- ${quoteE2BShellArg(temporary)} ${targetArg}; then printf created; elif test -e ${targetArg} || test -L ${targetArg}; then printf exists; else exit 1; fi`,
          commandOpts(undefined),
        )
        if (publication.stdout === 'exists') {
          throw new FsError(
            `cannot overwrite existing "${target.displayPath}" without reading it first`,
            'FS_NOT_OBSERVED',
          )
        }
        if (publication.stdout !== 'created') {
          throw new Error('guarded create returned an invalid publication result')
        }
        committed = { ...staged, name: posix.basename(targetPath), path: targetPath }
      } else {
        committed = await sandbox.files.rename(temporary, targetPath)
      }
      try {
        await sandbox.files.remove(stagingDirectory)
      } catch (_committedStagingCleanupFailure) {
        // The target is already committed; an empty private directory cannot turn that write into a failure.
      }
      return entryVersion(committed)
    } catch (error: unknown) {
      if (stagingDirectoryCreated) {
        try {
          await sandbox.files.remove(stagingDirectory)
        } catch (_stagingDirectoryAlreadyAbsentOrCleanupFailed) {
          // Only the private staging directory is swallowed; the original failure owns the operation.
        }
      }
      throw mapError(error, 'write', target.displayPath, signal)
    }
  }
}

export default E2BFileSystem
