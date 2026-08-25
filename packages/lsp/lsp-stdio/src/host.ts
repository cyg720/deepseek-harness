/*
 * ================================ 文件注释 ================================
 * 【文件职责】lsp-stdio 通过 dsh-fs 能力访问"执行世界"（与语言服务器共享的文件系统与子进程执行环境）的源码读取层：规范化工作区路径、校验并限长读取被查询源码。
 * 【技术维度】fs.resolve/fs.stat/fs.contains/fs.streamText 等来自 dsh-fs 文件系统提供者；以 FsTarget
 *   作为稳定身份、processPath 作为子进程 cwd、fileUrl 作为协议 URI，三者共同构成 HostWorkspace。
 * 【产品维度】语言服务器可能运行在远程沙箱或另一平台，其看到的路径与 URI 语法不同于调用方：本层保证查询的源码与工作区在"执行世界"中解析一致，并阻止读取工作区外文件。
 * 【逻辑维度】HostWorkspace/HostSource 类型 → canonicalizeWorkspace（解析并校验工作区是目录）→ readHostSource（解析、限制在区内、按字节上限流式读取）→ messageOf。
 * 【关键边界】文件大小上限（maxDocumentBytes）在本层强制；必须在工作区内（fs.contains）；所有操作可被 signal 取消；失败原因统一包装为带 cause 的 Error。
 * 【新手阅读建议】对照 dsh-fs 的 FsTarget 理解稳定身份的角色，再看 readHostSource 的字节上限与包含性检查如何配合。
 * ==========================================================================
 */
/** Filesystem-seam source access for the generic stdio LSP provider. */

import { Buffer } from 'node:buffer'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { throwIfAborted } from './abort.ts'

/** A canonical workspace in the filesystem/subprocess execution world. */
// "执行世界"（文件系统与子进程执行环境）中的一个规范化工作区。
export interface HostWorkspace {
  /** Stable filesystem identity used for provider pooling. */
  // 稳定的文件系统身份：作为进程池的键（key）。
  readonly target: FsTarget
  /** Canonical absolute path accepted as a subprocess cwd. */
  // 规范化的绝对路径：作为子进程 cwd。
  readonly canonicalPath: string
  /** Canonical file URI sent during LSP initialization. */
  // 规范化 file URI：在 LSP initialize 时发送给服务器。
  readonly fileUrl: string
}

/** A validated source and the exact URI sent to the language server. */
// 已验证的源码及发送给语言服务器的确切 URI。
export interface HostSource {
  /** Canonical file URI in the execution world's platform syntax. */
  // 执行世界平台语法下的规范化 file URI。
  readonly fileUrl: string
  /** Current complete UTF-8 text. */
  // 当前完整 UTF-8 文本。
  readonly text: string
}

/**
 * Resolve and validate one workspace through `ctx.fs`.
 * @param fs - filesystem provider sharing the language server's execution world.
 * @param workspaceRoot - caller-supplied workspace path.
 * @param signal - optional cancellation around provider operations.
 * @returns stable identity plus process path and file URI.
 */
// 通过 ctx.fs 解析并校验一个工作区：返回稳定身份 + 进程路径 + file URI；无法解析或不是目录时报错。
export async function canonicalizeWorkspace(
  fs: FileSystem,
  workspaceRoot: string,
  signal?: AbortSignal,
): Promise<HostWorkspace> {
  throwIfAborted(signal)
  let target: FsTarget
  try {
    target = await fs.resolve(workspaceRoot, signal === undefined ? {} : { signal })
  } catch (error: unknown) {
    // 解析失败时，若已被取消则优先抛出取消错误，否则包装原始错误。
    throwIfAborted(signal)
    throw new Error(`workspace root "${workspaceRoot}" cannot be resolved: ${messageOf(error)}`, { cause: error })
  }
  throwIfAborted(signal)
  // stat 校验目标确实存在；被取消时原样抛取消错误。
  const info = await fs.stat(target, signal).catch((error: unknown) => {
    throwIfAborted(signal)
    throw error
  })
  throwIfAborted(signal)
  // 工作区必须是目录，否则直接拒绝。
  if (info?.type !== 'directory') {
    throw new Error(`workspace root "${workspaceRoot}" is not a directory`)
  }
  // 三种视图：稳定身份、子进程 cwd、协议 URI。
  return {
    target,
    canonicalPath: fs.processPath(target),
    fileUrl: fs.fileUrl(target),
  }
}

/**
 * Resolve, contain, and read one byte-bounded query source through `ctx.fs`.
 * This layer owns the LSP-specific complete-document cap while the filesystem
 * provider owns streaming, regular-file checks, and UTF-8 validation.
 * @param fs - filesystem provider sharing the server's execution world.
 * @param filePath - absolute source path or path relative to `workspace`.
 * @param workspace - already-canonical workspace.
 * @param maxDocumentBytes - largest complete source accepted by this host.
 * @param signal - optional cancellation.
 * @returns canonical file URI and current text.
 */
// 解析、限定并读取一个字节受限的查询源文件：本层负责 LSP 特定的完整文档上限，文件系统提供者负责流式读取、常规文件检查与 UTF-8 校验。
export async function readHostSource(
  fs: FileSystem,
  filePath: string,
  workspace: HostWorkspace,
  maxDocumentBytes: number,
  signal?: AbortSignal,
): Promise<HostSource> {
  throwIfAborted(signal)
  let target: FsTarget
  try {
    target = await fs.resolve(filePath, {
      cwd: workspace.canonicalPath,
      ...signal === undefined ? {} : { signal },
    })
  } catch (error: unknown) {
    throwIfAborted(signal)
    throw new Error(`source "${filePath}" cannot be resolved: ${messageOf(error)}`, { cause: error })
  }
  throwIfAborted(signal)
  // 禁止读取工作区之外的文件。
  if (!fs.contains(workspace.target, target)) {
    throw new Error(`source "${filePath}" resolves outside the workspace`)
  }
  // 分块收集文本并累计字节数，超过上限即停止。
  const chunks: string[] = []
  let bytes = 0
  try {
    // XXX(lsp-source-replacement): Revisit stable-handle identity only if a real query observes
    // replacement between canonical containment and the provider opening this stream.
    const stream = await fs.streamText(target, signal)
    for await (const chunk of stream) {
      throwIfAborted(signal)
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxDocumentBytes) break
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    throwIfAborted(signal)
    throw new Error(`source "${filePath}" could not be read: ${messageOf(error)}`, { cause: error })
  }
  // 超限：明确报错（先读完再判断，保证错误信息包含已读字节数）。
  if (bytes > maxDocumentBytes) {
    throw new Error(
      `source "${filePath}" exceeds the ${maxDocumentBytes}-byte limit; reading stopped after ${bytes} bytes`,
    )
  }
  throwIfAborted(signal)
  return {
    fileUrl: fs.fileUrl(target),
    text: chunks.join(''),
  }
}

// 把未知抛出值统一转成可读的消息文本。
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
