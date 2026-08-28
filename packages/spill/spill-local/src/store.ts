/**
 * Cordis-free storage mechanics for the local spill backend: private
 * session-scoped directory selection, safe-name derivation, path-traversal
 * protection, and the exclusive owner-only write.
 *
 * @module @deepseek-ai/dsh-spill-local/store
 */
/*
 * 文件职责：实现 store.ts 覆盖的大结果落盘行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的大结果落盘能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */

import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Prefix shared by default-root creation and startup discovery. */
export const DEFAULT_ROOT_PREFIX = 'dsh-spill-'

/**
 * Test a caught value for a Node system error code.
 *
 * @param error The caught value.
 * @param code The expected system error code.
 * @returns Whether the code matches.
 */
export function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

let defaultRoot: string | undefined

/**
 * Return the lazily-created private per-process spill root.
 *
 * @returns The private root path.
 */
/*
 * 中文说明：函数 privateRoot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function privateRoot(): string {
  defaultRoot ??= mkdtempSync(join(tmpdir(), DEFAULT_ROOT_PREFIX))
  return defaultRoot
}

// Spill keeps its empty-name policy local so storage backends stay decoupled.
/* jscpd:ignore-start */
/**
 * Encode an arbitrary string as one safe path segment, injectively over ALL JS
 * (UTF-16) strings. A session id / suggested name is untrusted input, so this
 * neutralizes `../`, absolute paths, NUL, and separators before any filesystem
 * use. Each code unit is kept literal (`[A-Za-z0-9._-]`, minus `~`) or escaped
 * as `~XXXX`; `~` is itself escaped, so the mapping is reversible and distinct
 * inputs never collide. The whole-segment tokens `.`/`..` are escaped so they
 * can never traverse. An empty string encodes to `~` (never an empty segment).
 *
 * @param raw Untrusted text.
 * @returns One injective filesystem-safe path segment.
 */
/*
 * 中文说明：函数 encodeSegment 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param raw 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) return '~'
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  /** 中文说明：变量 out 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let out = ''
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (let i = 0; i < raw.length; i++) {
    /** 中文说明：变量 code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const code = raw.charCodeAt(i)
    /** 中文说明：变量 ch 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ch = String.fromCharCode(code)
    out += ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)
      ? ch
      : '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}
/* jscpd:ignore-end */

/**
 * Derive the stable session-scoped directory under a spill root.
 *
 * @param root The spill root.
 * @param sessionId The owning session id.
 * @returns The stable session-scoped directory.
 */
/*
 * 中文说明：函数 sessionDir 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param root 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param sessionId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function sessionDir(root: string, sessionId: string): string {
  /** 中文说明：变量 hash 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const hash = createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
  return join(root, `session-${hash}`)
}

/** Inputs needed to save a local spill file. */
export interface SaveTextOptions {
  /** Spill root. */
  root: string
  /** Owning session id. */
  sessionId: string
  /** Caller-suggested filename. */
  suggestedName: string
  /** Full text to persist. */
  content: string
}

/** A written spill file. */
/* 中文说明：interface SavedText 定义本模块所需的数据或行为，用于表达大结果落盘场景。 */
export interface SavedText {
  /** Absolute saved path. */
  path: string
  /** UTF-8 content length. */
  bytes: number
}

/**
 * Write text to a fresh 0600 file below its private session directory.
 * @param options The save request.
 * @returns The saved path and UTF-8 byte length.
 */
/*
 * 中文说明：函数 saveTextFile 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function saveTextFile(options: SaveTextOptions): Promise<SavedText> {
  /** 中文说明：变量 dir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = sessionDir(options.root, options.sessionId)
  const path = join(dir, `${randomBytes(6).toString('hex')}-${encodeSegment(options.suggestedName)}`)
  let handle
  for (;;) {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    try {
      handle = await open(path, 'wx', 0o600)
      break
    } catch (error: unknown) {
      /* v8 ignore start -- requires another process to remove the directory
         between mkdir and open, or an external permission/IO race. */
      if (isErrno(error, 'ENOENT')) continue
      throw error
      /* v8 ignore stop */
    }
  }
  try {
    await handle.writeFile(options.content)
  } finally {
    await handle.close()
  }
  return { path, bytes: Buffer.byteLength(options.content, 'utf8') }
}
