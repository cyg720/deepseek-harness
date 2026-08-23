/**
 * ================================ 文件注释 ================================
 * 【文件职责】文件系统服务定义（ctx.fs）的"词汇表"：不透明目标/版本身份（FsTargetKey、
 * FsVersion）、stat 返回的元数据、写意图与写结果形态、字面编辑的请求/结果，以及
 * 类型化错误分类（FsErrorCode）。
 * 【技术维度】纯类型与轻量标记函数模块：Branded 类型把"普通字符串"标记成不透明身份，
 * 防止跨边界误用；FsError 继承 HarnessError 携带稳定错误码，让重试/权限/UI 层可以
 * 按 code 分支而不解析消息文本。
 * 【产品维度】这是模型文件操作（读/写/编辑）的"数据契约"：后端（本地磁盘、沙箱）
 * 与工具层（tool-fs）共用同一套类型，保证行为一致。
 * 【逻辑维度】按出现顺序：FsTargetKey（目标身份键 + 标记函数）→ FsVersion（新鲜度
 * 令牌 + 标记函数）→ FsObservation（观察结果）→ FsTarget（已解析目标）→ FsInfo /
 * FsPathInfo（stat/lstat 元数据）→ FsDirEntry（目录条目）→ FsWriteIntent / FsWriteOutcome
 * （写意图与结果）→ FsEditRequest / FsEditOutcome（编辑请求与结果）→ FsErrorCode /
 * FsError（错误分类）。
 * 【关键边界】消费者绝不能解析 targetKey 或假设它是本地绝对路径（远程后端可能是
 * URI 或文件 id）；version 同样不可解释，只作为新鲜度令牌传递；无意图的 writeText
 * 是"无条件创建或覆盖"，不是第三个联合分支。
 * 【新手阅读建议】先看 FsTarget/FsVersion 理解两个不透明身份，再看 FsWriteIntent 与
 * FsEditRequest 理解"带守卫的写/编辑"长什么样，最后看 FsErrorCode 清单。
 * ==========================================================================
 */
/**
 * Vocabulary for the filesystem Service Definition (`ctx.fs`): the opaque target/version
 * identities, the metadata `stat` returns, the write-intent and outcome shapes, the
 * literal-edit request/outcome, and the typed error taxonomy.
 * @module @deepseek-ai/dsh-fs/types
 */
/**
 * 模块总览：本文件只有类型与标记函数，没有运行时逻辑。它是后端（fs-local、
 * fs-sandbox）与工具层（tool-fs）之间的公共词汇。
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Opaque key for stale guards and target lookup. The local backend uses a
 * realpath-like string; a remote backend might use a workspace URI or file id.
 * Consumers MUST NOT parse it or assume it is a local absolute path.
 */
/**
 * 目标的"不透明键"：用于过期守卫（stale guard）与目标查找。本地后端用类似 realpath
 * 的字符串；远程后端可能是工作区 URI 或文件 id。消费者绝不能解析它，也不能假定它是
 * 本地绝对路径。Branded 是 TypeScript 的"品牌类型"技巧：给字符串打个类型标签，
 * 让普通 string 无法直接充当它（跨边界防误用）。
 */
export type FsTargetKey = Branded<'FsTargetKey'>

/**
 * Brand a string as an {@link FsTargetKey}. For backend use only — a consumer
 * never manufactures a key, it receives one from `resolve()`.
 * @param key - the backend's raw key string (the local backend passes a realpath).
 * @returns the same string, branded; no validation is performed.
 */
/**
 * 把字符串"标记"成 FsTargetKey。仅供后端使用——消费者从不制造键，而是从
 * resolve() 接收一个。函数与类型同名（TS 允许类型与值同名声明），不做任何校验。
 * @param key 后端的原始键字符串（本地后端传 realpath）。
 * @returns 同一个字符串，带品牌类型；无校验。
 */
export function FsTargetKey(key: string): FsTargetKey {
  return key as FsTargetKey
}

/**
 * Opaque file-version token — the freshness token a write/edit guards against.
 * The local backend derives it from high-resolution stat identity and freshness
 * fields; a remote backend might use a revision id. The policy layer records it
 * for stale checks; consumers may display related metadata but MUST NOT
 * interpret this token.
 */
/**
 * 文件版本令牌：写/编辑所守卫的"新鲜度令牌"。本地后端从高精度 stat 身份与新鲜度
 * 字段派生；远程后端可能是修订 id。策略层记录它做过期检查；消费者可以展示相关
 * 元数据，但绝不能解释这个令牌本身。
 */
export type FsVersion = Branded<'FsVersion'>

/**
 * Brand a string as an {@link FsVersion}. For backend use only — a consumer
 * never manufactures a version, it receives one from `stat`/write/edit outcomes.
 * @param v - the backend's raw version string.
 * @returns the same string, branded; no validation is performed.
 */
/**
 * 把字符串"标记"成 FsVersion。仅供后端使用——消费者从 stat/写/编辑结果接收版本。
 * @param v 后端的原始版本字符串。
 * @returns 同一个字符串，带品牌类型；无校验。
 */
export function FsVersion(v: string): FsVersion {
  return v as FsVersion
}

/**
 * One authoritative observation of a target. A present observation carries the
 * version used by guarded replacement; an absent observation authorizes only a
 * guarded create, never an edit.
 */
/**
 * 对一个目标的一次权威观察。present（存在）观察携带版本，供带守卫的替换使用；
 * absent（不存在）观察只授权"带守卫的创建"，绝不授权编辑。
 */
export type FsObservation =
  | { readonly kind: 'present'; readonly version: FsVersion }
  | { readonly kind: 'absent' }

/**
 * A path resolved by a backend into a stable identity. `resolve()` produces
 * this; every other operation takes it.
 */
/**
 * 后端把路径解析成的稳定身份。resolve() 产生它；其它所有操作都以它为入参。
 * 同一文件会得到相同的 targetKey（身份在别名/符号链接下保持稳定）。
 */
export interface FsTarget {
  /** Opaque key for stale guards and target lookup. */
  /** 不透明键：用于过期守卫与目标查找。 */
  targetKey: FsTargetKey
  /**
   * Path for model/UI-facing output. May be a local absolute path,
   * workspace-relative path, or remote URI depending on the backend.
   */
  /**
   * 面向模型/UI 展示的路径。依后端不同，可能是本地绝对路径、工作区相对路径或远程 URI。
   */
  displayPath: string
}

/**
 * Metadata about a target — what {@link FileSystem.stat} returns. Lets the
 * policy layer reject directories/special files before reading and choose
 * `readText` vs `streamText` from `size` without probing by failure. `version`
 * is the freshness token. `undefined` from `stat` means the target is absent.
 */
/**
 * 目标的元数据（FileSystem.stat 的返回）。让策略层在读取前就能拒绝目录/特殊文件，
 * 并按 size 决定用 readText 还是 streamText，而不是靠失败来试探。version 是新鲜度令牌。
 * stat 返回 undefined 表示目标不存在。
 */
export interface FsInfo {
  /** Opaque freshness token of the target right now. */
  /** 目标此刻的新鲜度令牌。 */
  version: FsVersion
  /** Whether the target is a regular file, a directory, or something else. */
  /** 目标是普通文件、目录还是其它（如设备、管道、符号链接等）。 */
  type: 'file' | 'directory' | 'other'
  /** Byte size of a regular file, when the backend can report it. */
  /** 普通文件的字节大小（后端能报告时才有）。 */
  size?: number
}

/**
 * Metadata about a path without following the final path component when it is a
 * symbolic link. Unlike {@link FsInfo}, this path-level probe can report
 * `symlink` so consumers with trust-boundary rules can reject repository-owned
 * links before resolving a target.
 */
/**
 * 不跟随末级符号链接的路径元数据（lstat 的返回）。与 FsInfo 不同，这种"路径级"
 * 探测能报告 symlink 类型，让有信任边界规则的消费者能在解析目标之前拒绝仓库里的链接。
 */
export interface FsPathInfo {
  /** Opaque freshness token of the path entry right now. */
  /** 路径条目此刻的新鲜度令牌。 */
  version: FsVersion
  /** Whether the path entry is a regular file, directory, symlink, or other. */
  /** 路径条目是普通文件、目录、符号链接还是其它。 */
  type: 'file' | 'directory' | 'symlink' | 'other'
  /** Byte size of the path entry, when the backend can report it. */
  /** 路径条目的字节大小（后端能报告时才有）。 */
  size?: number
}

/**
 * One direct child returned by {@link FileSystem.listDir}. Listing returns
 * metadata and resolved targets only; it must not read file contents.
 */
/**
 * listDir 返回的一个直接子项。列举只返回元数据与已解析目标，绝不读文件内容。
 */
export interface FsDirEntry {
  /** Basename of the child inside the listed directory. */
  /** 子项在所列目录内的基名（basename）。 */
  name: string
  /** Whether the child is a regular file, a directory, or something else. */
  /** 子项是普通文件、目录还是其它。 */
  type: 'file' | 'directory' | 'other'
  /** Resolved child target for follow-up operations. */
  /** 已解析的子目标，供后续操作直接使用。 */
  target: FsTarget
  /** Opaque freshness token when the backend can report metadata cheaply. */
  /** 后端能低成本报告元数据时的新鲜度令牌。 */
  version?: FsVersion
  /** Byte size of a regular file, when the backend can report it. */
  /** 普通文件的字节大小（后端能报告时才有）。 */
  size?: number
}

/**
 * Guarded write intent. `createIfAbsent` rejects an existing target with
 * `FS_NOT_OBSERVED`; `replaceIfVersion` rejects absence or mismatch with
 * `FS_STALE_VERSION`. Omitting the intent from `writeText` means unconditional
 * create-or-overwrite, not a third union arm.
 */
/**
 * 带守卫的写意图。createIfAbsent（不存在才创建）：目标已存在时以 FS_NOT_OBSERVED 拒绝；
 * replaceIfVersion（按版本替换）：目标不存在或版本不匹配时以 FS_STALE_VERSION 拒绝。
 * writeText 不传意图 = 无条件创建或覆盖，而不是联合类型的第三个分支。
 */
export type FsWriteIntent =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: FsVersion }

/** Outcome of a full-file write. */
/**
 * 整文件写入的结果。
 */
export interface FsWriteOutcome {
  /** Whether the write created a new file or replaced an existing one. */
  /** 本次写入是创建了新文件还是覆盖了已有文件。 */
  operation: 'create' | 'update'
  /** Opaque version of the file after the write. */
  /** 写入后文件的不透明版本。 */
  version: FsVersion
  /**
   * The file's content BEFORE the write, or `null` when the file did not exist
   * (a create) or the backend declined a contextual basis (for example, a
   * binary/non-UTF-8 prior file or either overwrite side reaching its exclusive limit).
   * LF-normalized storage text (the diff basis), never a diff — a consumer
   * computes the result-time contextual diff from `before`/`after` when
   * `before` is present, else falls back to a whole-file diff.
   */
  /**
   * 写入前的文件内容；文件原本不存在（创建）或后端拒绝给出上下文基础时（例如原先
   * 是二进制/非 UTF-8 文件，或覆盖两侧达到独占上限）为 null。
   * 是 LF 归一化的存储文本（做 diff 的基础），绝不是 diff 本身——消费者在 before 存在时
   * 用 before/after 计算结果时的上下文 diff，否则退化为整文件 diff。
   */
  before: string | null
  /** The file's content AFTER the write, LF-normalized to share `before`'s diff basis. */
  /** 写入后的文件内容，同样 LF 归一化，与 before 共享 diff 基础。 */
  after: string
}

/** A literal-replacement edit request. */
/**
 * 字面替换编辑请求：在文件里精确查找一段文本并替换。
 */
export interface FsEditRequest {
  /** Literal non-empty text to replace. Must match exactly (after line-ending normalization). */
  /** 要替换的字面文本（非空）。必须精确匹配（换行符归一化之后）。 */
  oldString: string
  /** Literal replacement text. An empty string deletes the matched text. */
  /** 替换文本；空字符串表示删除匹配到的文本。 */
  newString: string
  /** Replace every match instead of requiring exactly one. */
  /** 是否替换所有匹配（true）而不是要求恰好一处匹配（false）。 */
  replaceAll: boolean
}

/** Outcome of a literal edit. */
/**
 * 字面编辑的结果。
 */
export interface FsEditOutcome {
  /** Opaque version of the file after the edit. */
  /** 编辑后文件的不透明版本。 */
  version: FsVersion
  /**
   * The file's content BEFORE the edit. Raw storage text (LF-normalized by the
   * backend), never a diff — a consumer computes the result-time contextual diff
   * (the applied hunk with context) from `before`/`after`.
   */
  /**
   * 编辑前的文件内容。是后端 LF 归一化的原始存储文本，绝不是 diff——消费者用
   * before/after 计算"应用后的上下文 diff"（带上下文的变更块）。
   */
  before: string
  /** The file's content AFTER the edit. */
  /** 编辑后的文件内容。 */
  after: string
}

/**
 * Stable, machine-routable codes for filesystem failures. Carried on
 * {@link FsError}; the tool registry exposes `{ name, code }` on `isError`
 * results so retry/permission/UI layers can branch without parsing messages.
 */
/**
 * 文件系统失败的稳定、可机器路由的错误码。挂在 FsError 上；工具注册表在 isError
 * 结果里暴露 { name, code }，让重试/权限/UI 层无需解析消息文本即可分支。
 */
export type FsErrorCode =
  | 'FS_NOT_FOUND'
  | 'FS_NOT_DIRECTORY'
  | 'FS_NOT_TEXT'
  | 'FS_NOT_REGULAR_FILE'
  | 'FS_TOO_LARGE'
  | 'FS_PERMISSION_DENIED'
  | 'FS_SANDBOX_DENIED'
  | 'FS_IO_ERROR'
  | 'FS_STALE_VERSION'
  | 'FS_NOT_OBSERVED'
  | 'FS_AMBIGUOUS_EDIT'
  | 'FS_EDIT_NOT_FOUND'
  | 'FS_ABORTED'

/**
 * Typed filesystem error. Extends {@link HarnessError} so it carries a stable
 * {@link FsErrorCode} and chains `cause`. `dsh-fs` owns this vocabulary so
 * backends and the policy layer raise the same codes instead of each inventing
 * message strings.
 */
/**
 * 类型化文件系统错误。继承 HarnessError，携带稳定 FsErrorCode 并链上 cause。
 * dsh-fs 拥有这套词汇：后端与策略层抛同一批错误码，而不是各自发明消息字符串。
 */
export class FsError extends HarnessError {
  override readonly code: FsErrorCode

  constructor(message: string, code: FsErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
