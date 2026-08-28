/** Startup cleanup mechanics for local spill roots.
 * @remarks 文件说明：文件职责：实现 spill/spill-local 中 cleanup 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 spill/spill-local 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import { lstat, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_ROOT_PREFIX, isErrno } from './store.ts'

/**
 * A backend-generated default root name: `dsh-spill-` plus the 6-character
 * suffix `mkdtemp` appends. Discovery matches this
 * EXACT shape, not the bare prefix, so an unrelated `dsh-spill-test-*` fixture
 * or a foreign tool's differently-shaped `dsh-spill-…` directory is never
 * mistaken for a backend root to sweep.
 * @remarks 中文说明：常量说明：DEFAULT_ROOT_RE 用于处理 DEFAULT_ROOT_RE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_ROOT_RE = new RegExp(`^${DEFAULT_ROOT_PREFIX}[A-Za-z0-9]{6}$`)

/**
 * A backend-generated session directory name: `session-` plus the 12 lowercase
 * hex characters {@link sessionDir} derives from `sha256(sessionId)`. The sweep
 * only descends into entries of this EXACT shape, so an unrelated
 * `session-backup` directory under a shared configured root is never swept.
 * @remarks 中文说明：常量说明：SESSION_DIR_RE 用于处理 SESSION_DIR_RE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SESSION_DIR_RE = /^session-[0-9a-f]{12}$/

/** An existing root resolved to one stable filesystem identity. */
interface ResolvedRoot {
  /** Canonical absolute path used for the sweep. */
  path: string
  /** Device/inode identity used to de-duplicate filesystem aliases. */
  identity: string
}

/** A one-argument warning sink — the sweep's only side effect on failure (never throws). */
export type WarnFn = (message: string) => void

/** Report a best-effort sweep failure without allowing the warning sink to reject cleanup.
 * @remarks 中文说明：功能说明：处理 warnSafely 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：warn（WarnFn）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：message（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 warnSafely(warn, message)，并按返回类型处理结果。 */
function warnSafely(warn: WarnFn, message: string): void {
  try {
    warn(message)
  } catch {
    // Warning sinks are observational callbacks; cleanup must remain best-effort
    // even when a logger implementation throws.
  }
}

/** Whether another local OS user cannot replace children of this directory.
 * @remarks 中文说明：功能说明：判断是否为 Trusted Directory 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：stats（Stats）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isTrustedDirectory(stats)，并按返回类型处理结果。 */
function isTrustedDirectory(stats: Stats): boolean {
  if (!stats.isDirectory()) return false
  /* v8 ignore next -- POSIX ownership and mode bits have no Windows equivalent. */
  if (process.platform === 'win32' || process.geteuid === undefined) return true
  /* v8 ignore start -- Windows takes the return above; POSIX tests exercise
     owner and mode rejection. */
  return stats.uid === process.geteuid() && (stats.mode & 0o022) === 0
  /* v8 ignore stop */
}

/** Stable identity for de-duplicating aliases of one root.
 * @remarks 中文说明：功能说明：处理 rootIdentity 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：stats（Stats）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 rootIdentity(path, stats)，并按返回类型处理结果。 */
function rootIdentity(path: string, stats: Stats): string {
  /* v8 ignore next -- Windows file indexes are not portable inode identities. */
  if (process.platform === 'win32') return path.toLowerCase()
  /* v8 ignore start -- Windows uses the canonical path identity above; POSIX
     tests exercise device and inode identity. */
  return `${String(stats.dev)}:${String(stats.ino)}`
  /* v8 ignore stop */
}

/**
 * Check that no ancestor permits another local OS user to replace the selected
 * child. A sticky writable ancestor is safe because the child is owned by the
 * current user; this admits normal per-process roots below `/tmp`.
 * @remarks 中文说明：功能说明：判断是否包含 Protected Ancestors 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<boolean>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * hasProtectedAncestors(path)，并按返回类型处理结果。
 */
async function hasProtectedAncestors(path: string): Promise<boolean> {
  /* v8 ignore next -- POSIX ancestry checks have no Windows ACL equivalent. */
  if (process.platform === 'win32' || process.geteuid === undefined) return true
  /* v8 ignore start -- Windows takes the return above; POSIX tests exercise
     the ancestor ownership and mode policy. */
  /**
   * 常量说明：currentUid 用于处理 currentUid 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const currentUid = process.geteuid()
  /**
   * 变量说明：child 用于处理 child 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let child = path
  /**
   * 变量说明：childStats 用于处理 childStats 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let childStats = await lstat(child)
  for (;;) {
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = dirname(child)
    if (parent === child) return true
    /**
     * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stats = await lstat(parent)
    /* v8 ignore next -- every ancestor of a successfully resolved path is a directory. */
    if (!stats.isDirectory()) return false
    /**
     * 常量说明：writableByOthers 用于处理 writableByOthers 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const writableByOthers = (stats.mode & 0o022) !== 0
    /**
     * 常量说明：sticky 用于处理 sticky 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sticky = (stats.mode & 0o1000) !== 0
    if (writableByOthers && !sticky) return false
    /* v8 ignore next -- requires an ancestor owned by another OS account inside
       a writable sticky parent; ordinary test fixtures cannot change uid. */
    if (writableByOthers && childStats.uid !== currentUid) return false
    child = parent
    childStats = stats
  }
  /* v8 ignore stop */
}

/**
 * Resolve one existing root without admitting a directory another local user
 * can replace during the path-based sweep. A configured root may be a symlink;
 * discovery passes `false` so a symlink cannot impersonate a default root.
 *
 * @param path Candidate root path.
 * @param allowSymlink Whether the candidate itself may be a configured symlink.
 * @param warn Sink for skipped or failed inspection.
 * @returns The trusted canonical root, or `undefined` when it is absent or unsafe.
 * @remarks 中文说明：功能说明：解析 Root 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：allowSymlink（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：warn（WarnFn）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<ResolvedRoot
 * | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * resolveRoot(path, allowSymlink, warn)，并按返回类型处理结果。
 */
async function resolveRoot(path: string, allowSymlink: boolean, warn: WarnFn): Promise<ResolvedRoot | undefined> {
  /**
   * 变量说明：initial 用于处理 initial 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let initial: Stats
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    initial = await lstat(path)
  } catch (error: unknown) {
    /* v8 ignore start -- non-ENOENT inspection failures depend on host ACL or
       an entry racing away and cannot be reproduced portably. */
    if (!isErrno(error, 'ENOENT')) warnSafely(warn, `spill-local: failed to inspect root ${path}: ${String(error)}`)
    return undefined
    /* v8 ignore stop */
  }
  if (initial.isSymbolicLink()) {
    if (!allowSymlink) return undefined
  } else if (!isTrustedDirectory(initial)) {
    warnSafely(warn, `spill-local: skipped unsafe root ${path}: expected a directory owned by the current user and not writable by group or others`)
    return undefined
  }

  /**
   * 变量说明：canonical 用于处理 canonical 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let canonical: string
  /**
   * 变量说明：stats 用于处理 stats 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let stats: Stats
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    canonical = await realpath(path)
    stats = await lstat(canonical)
  } catch (error: unknown) {
    /* v8 ignore start -- a root lstat'd above reaches this only by racing away
       or by a host-specific realpath failure. */
    if (!isErrno(error, 'ENOENT')) warnSafely(warn, `spill-local: failed to resolve root ${path}: ${String(error)}`)
    return undefined
    /* v8 ignore stop */
  }
  /**
   * 变量说明：protectedAncestors 用于处理 protectedAncestors 相关数据，作用于当前作用域；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let protectedAncestors = false
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    protectedAncestors = await hasProtectedAncestors(canonical)
  } catch (error: unknown) {
    /* v8 ignore start -- a canonical ancestor disappears only through a race;
       other failures depend on host ACLs. */
    if (!isErrno(error, 'ENOENT')) warnSafely(warn, `spill-local: failed to inspect ancestors of root ${canonical}: ${String(error)}`)
    return undefined
    /* v8 ignore stop */
  }
  /* v8 ignore start -- Windows has no POSIX ownership or mode rejection path;
     POSIX tests exercise both unsafe-directory conditions. */
  if (!isTrustedDirectory(stats) || !protectedAncestors) {
    warnSafely(warn, `spill-local: skipped unsafe root ${canonical}: expected a current-user-owned directory with protected write and ancestor permissions`)
    return undefined
  }
  /* v8 ignore stop */
  return { path: canonical, identity: rootIdentity(canonical, stats) }
}

/** One root to sweep, plus whether the root itself may be pruned once empty. */
export interface SweepRoot {
  /** Absolute spill root to sweep. */
  path: string
  /**
   * When `true`, remove the root after its empty `session-*` children are
   * pruned. Set for DISCOVERED prior-default `dsh-spill-*` roots (one per past
   * process — otherwise they accumulate empty forever), never for the active
   * root the live process is still writing into. Every root prunes empty session
   * directories; writes retry if that races their removal.
   */
  pruneWhenEmpty: boolean
}

/** Options for {@link sweepSpillRoots} — the roots to scan, the age cutoff, and a failure sink. */
export interface SweepOptions {
  /** Roots to sweep (configured/active root and/or discovered prior-default roots). */
  roots: SweepRoot[]
  /**
   * Epoch-millis cutoff: a regular file is deleted when its `mtime` is strictly
   * older than this. The caller derives it from `now - cleanupPeriodDays`, so a
   * file written exactly at the boundary is kept (only strictly-older expires).
   */
  cutoffMs: number
  /** Where a contained filesystem failure is reported; the sweep itself never throws. */
  warn: WarnFn
}

/**
 * Delete a single path, treating a concurrent-race disappearance as success.
 * A parallel process (or another sweep) may `unlink` the same file between our
 * scan and our own `unlink` — ENOENT then means the goal (file gone) already
 * holds, so it is not a failure. Any other error is reported and swallowed.
 *
 * @param path The absolute file path to remove.
 * @param warn Sink for a non-ENOENT failure message.
 * @returns Resolves once the removal was attempted (never rejects).
 * @remarks 中文说明：功能说明：处理 unlinkIdempotent 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：warn（WarnFn）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 unlinkIdempotent(path,
 * warn)，并按返回类型处理结果。
 */
async function unlinkIdempotent(path: string, warn: WarnFn): Promise<void> {
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    await unlink(path)
  } catch (error: unknown) {
    /* v8 ignore start -- reached only when a file selected for deletion (a
       regular file that passed lstat) then fails to unlink: either it raced away
       (ENOENT) or a permission/IO fault struck between the stat and the unlink.
       Neither is deterministically reproducible in-process. */
    if (isErrno(error, 'ENOENT')) return
    warnSafely(warn, `spill-local: failed to delete ${path}: ${String(error)}`)
    /* v8 ignore stop */
  }
}

/**
 * Sweep one spill session directory: delete expired regular files, skip
 * everything else, and report the directory empty afterward so the caller can
 * prune it. The `dir` entry MUST be a real directory — the caller `lstat`s it
 * first and skips a symlink, so this never follows a `session-*` symlink into a
 * foreign tree. Inside, a symlink or any non-regular entry (socket, fifo, nested
 * dir) is left untouched — `lstat` never follows a link, so a planted symlink
 * can neither be deleted nor redirect the age check. Every per-entry failure is
 * contained: one unreadable file does not abort the directory.
 *
 * @param dir The absolute session directory to scan (already confirmed a real dir).
 * @param cutoffMs Files with `mtime` strictly older than this are deleted.
 * @param warn Sink for contained filesystem failures.
 * @returns `true` when the directory holds no entries after the sweep (a prune candidate).
 * @remarks 中文说明：功能说明：处理 sweepSessionDir 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：dir（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：cutoffMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：warn（WarnFn）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<boolean>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 sweepSessionDir(dir,
 * cutoffMs, warn)，并按返回类型处理结果。
 */
async function sweepSessionDir(dir: string, cutoffMs: number, warn: WarnFn): Promise<boolean> {
  /**
   * 变量说明：names 用于处理 names 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let names: string[]
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    names = await readdir(dir)
  } catch (error: unknown) {
    /* v8 ignore start -- the caller lstat'd this entry and confirmed a real
       directory just before the call, so readdir fails only when the dir races
       away (ENOENT) or a permission/IO fault strikes in that window; not
       deterministically reproducible. False keeps it out of the prune step. */
    warnSafely(warn, `spill-local: failed to read ${dir}: ${String(error)}`)
    return false
    /* v8 ignore stop */
  }
  /**
   * 变量说明：remaining 用于处理 remaining 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let remaining = names.length
  /**
   * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const name of names) {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = join(dir, name)
    /**
     * 变量说明：stats 用于处理 stats 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let stats
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      stats = await lstat(path)
    } catch (error: unknown) {
      /* v8 ignore start -- an entry that readdir just returned then fails to
         lstat only by racing away (ENOENT) or a permission/IO fault; keep it out
         of the deterministic test surface. */
      if (isErrno(error, 'ENOENT')) { remaining--; continue }
      warnSafely(warn, `spill-local: failed to stat ${path}: ${String(error)}`)
      continue
      /* v8 ignore stop */
    }
    // Only regular files expire. Symlinks and other special entries are skipped
    // (never followed) so the sweep cannot be redirected or delete a link.
    if (!stats.isFile()) continue
    if (stats.mtimeMs >= cutoffMs) continue
    await unlinkIdempotent(path, warn)
    remaining--
  }
  return remaining === 0
}

/**
 * Best-effort one-shot cleanup: across each root, delete expired regular files
 * under its `session-*` directories and prune every empty session directory.
 * Only a discovered prior-default root is itself removed. Writes recreate a
 * session directory when pruning races a local write. Every filesystem and
 * warning-sink failure is contained, so a caller can await this during
 * activation/disposal without it ever rejecting.
 *
 * @param options The roots to sweep, the age cutoff, and the failure sink.
 * @returns Resolves when the sweep finishes (never rejects).
 * @remarks 中文说明：功能说明：处理 sweepSpillRoots 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（SweepOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * sweepSpillRoots(options)，并按返回类型处理结果。
 */
export async function sweepSpillRoots(options: SweepOptions): Promise<void> {
  /**
   * 常量说明：cutoffMs、warn 用于处理 cutoffMs、warn 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { cutoffMs, warn } = options
  /**
   * 常量说明：roots 用于处理 roots 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const roots = new Map<string, SweepRoot>()
  /**
   * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const candidate of options.roots) {
    /**
     * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const resolved = await resolveRoot(candidate.path, false, warn)
    if (resolved === undefined) continue
    /**
     * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const existing = roots.get(resolved.identity)
    roots.set(resolved.identity, {
      path: resolved.path,
      pruneWhenEmpty: (existing?.pruneWhenEmpty ?? true) && candidate.pruneWhenEmpty,
    })
  }
  /**
   * 变量说明：root 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const root of roots.values()) {
    /**
     * 变量说明：entries 用于处理 entries 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let entries: string[]
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      entries = await readdir(root.path)
    } catch (error: unknown) {
      // A root that does not exist yet (no spill ever written) is the common
      // case, not an error: ENOENT is silent, anything else is reported.
      /* v8 ignore start -- the trusted root was resolved immediately above; a
         read failure now requires a race or host-specific ACL fault. */
      if (!isErrno(error, 'ENOENT')) warnSafely(warn, `spill-local: failed to read root ${root.path}: ${String(error)}`)
      continue
      /* v8 ignore stop */
    }
    // Track whether the root holds ANY entry the sweep did not fully reclaim, so
    // a discovered prior-default root can be pruned only when nothing remains.
    /**
     * 变量说明：rootEmptiable 用于处理 rootEmptiable 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let rootEmptiable = true
    /**
     * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const name of entries) {
      // Only the backend's own `session-<12 hex>` directories are swept; an
      // unrelated sibling (`session-backup`, a stray file) is left untouched and
      // blocks pruning the root.
      if (!SESSION_DIR_RE.test(name)) { rootEmptiable = false; continue }
      /**
       * 常量说明：dir 用于处理 dir 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const dir = join(root.path, name)
      /**
       * 变量说明：stats 用于处理 stats 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let stats
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        // lstat the session entry itself: a `session-*` SYMLINK must never be
        // followed (readdir/unlink through it would delete files in a foreign
        // target). Only a real directory is swept.
        stats = await lstat(dir)
      } catch (error: unknown) {
        /* v8 ignore start -- an entry readdir just returned fails to lstat only
           by racing away (ENOENT) or a permission/IO fault; not deterministically
           reproducible. */
        if (!isErrno(error, 'ENOENT')) warnSafely(warn, `spill-local: failed to stat ${dir}: ${String(error)}`)
        continue
        /* v8 ignore stop */
      }
      if (!isTrustedDirectory(stats)) {
        warnSafely(warn, `spill-local: skipped unsafe session directory ${dir}`)
        rootEmptiable = false
        continue
      }
      /**
       * 常量说明：empty 用于处理 empty 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const empty = await sweepSessionDir(dir, cutoffMs, warn)
      if (!empty) { rootEmptiable = false; continue }
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        await rmdir(dir)
      } catch (error: unknown) {
        /* v8 ignore start -- prune runs only on a dir observed empty; a failure
           here means a concurrent writer added a file (ENOTEMPTY) or a
           permission/IO fault struck — both are races outside deterministic
           in-process testing. */
        rootEmptiable = false
        if (!isErrno(error, 'ENOENT') && !isErrno(error, 'ENOTEMPTY')) {
          warnSafely(warn, `spill-local: failed to prune ${dir}: ${String(error)}`)
        }
        /* v8 ignore stop */
      }
    }
    // A discovered prior-default root (one per past process) is removed once its
    // last session dir is gone — otherwise empty roots accumulate forever and
    // every future startup rescans them. The active root itself is never pruned.
    if (root.pruneWhenEmpty && rootEmptiable) {
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        await rmdir(root.path)
      } catch (error: unknown) {
        /* v8 ignore start -- prune runs only on a root whose every child was
           reclaimed; a failure here means a concurrent writer added a fresh
           spill after our scan (ENOTEMPTY) or removed the root already (ENOENT)
           or a permission/IO fault struck — all races outside deterministic
           in-process testing. */
        if (!isErrno(error, 'ENOENT') && !isErrno(error, 'ENOTEMPTY')) {
          warnSafely(warn, `spill-local: failed to prune root ${root.path}: ${String(error)}`)
        }
        /* v8 ignore stop */
      }
    }
  }
}

/**
 * Discover prior default spill roots: the `dsh-spill-<6 chars>` directories
 * directly under `base` (the OS tmpdir) that earlier default-root runs created.
 * A long-lived deployment
 * with a configured root will find none; a series of default-root runs
 * accumulates one per process, so the startup sweep reclaims them all. Matching
 * is the EXACT `mkdtemp` shape (see {@link DEFAULT_ROOT_RE}), not the bare
 * prefix, so an unrelated `dsh-spill-test-*` fixture or a foreign
 * differently-shaped directory is never swept; symlinks and non-directories are
 * excluded too — only real directories the backend could have created.
 *
 * @param warn Sink for a failure reading `base` (returns `[]` on failure).
 * @param base The directory to scan; defaults to the OS tmpdir (a test seam).
 * @returns Absolute paths of the discovered default roots (possibly empty).
 * @remarks 中文说明：功能说明：处理 discoverDefaultRootRecords 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：warn（WarnFn）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：base（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<ResolvedRoot[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 discoverDefaultRootRecords(warn, base)，并按返回类型处理结果。
 */
async function discoverDefaultRootRecords(warn: WarnFn, base: string): Promise<ResolvedRoot[]> {
  /**
   * 变量说明：entries 用于处理 entries 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let entries: string[]
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    entries = await readdir(base)
  } catch (error: unknown) {
    warnSafely(warn, `spill-local: failed to scan ${base} for default roots: ${String(error)}`)
    return []
  }
  /**
   * 常量说明：roots 用于处理 roots 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const roots: ResolvedRoot[] = []
  /**
   * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const name of entries) {
    if (!DEFAULT_ROOT_RE.test(name)) continue
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = join(base, name)
    /**
     * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const resolved = await resolveRoot(path, false, warn)
    if (resolved !== undefined) roots.push(resolved)
  }
  return roots
}

/**
 * Discover trusted prior default roots below the OS temporary directory.
 *
 * @param warn Sink for contained discovery failures.
 * @param base Directory to scan; defaults to the OS temporary directory.
 * @returns Canonical paths of trusted default roots.
 * @remarks 中文说明：功能说明：处理 discoverDefaultRoots 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：warn（WarnFn）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：base（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<string[]>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * discoverDefaultRoots(warn, base)，并按返回类型处理结果。
 */
export async function discoverDefaultRoots(warn: WarnFn, base: string = tmpdir()): Promise<string[]> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：root（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(root)，并按返回类型处理结果。
   */
  return (await discoverDefaultRootRecords(warn, base)).map(root => root.path)
}

/**
 * Gather and de-duplicate the trusted roots for one startup sweep. The active
 * configured path may be a symlink; its resolved identity overrides a matching
 * discovered root so the live target is never marked prunable.
 *
 * @param activeRoot Active configured root.
 * @param warn Sink for contained inspection failures.
 * @param defaultRootsBase Directory holding prior default roots.
 * @returns Trusted roots with the active identity marked non-prunable.
 * @remarks 中文说明：功能说明：处理 gatherSweepRoots 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：activeRoot（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：warn（WarnFn）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：defaultRootsBase（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<SweepRoot[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * gatherSweepRoots(activeRoot, warn, defaultRootsBase)，并按返回类型处理结果。
 */
export async function gatherSweepRoots(
  activeRoot: string,
  warn: WarnFn,
  defaultRootsBase: string = tmpdir(),
): Promise<SweepRoot[]> {
  /**
   * 常量说明：discovered、active 用于处理 discovered、active 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [discovered, active] = await Promise.all([
    discoverDefaultRootRecords(warn, defaultRootsBase),
    resolveRoot(activeRoot, true, warn),
  ])
  /**
   * 常量说明：roots 用于处理 roots 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const roots = new Map<string, SweepRoot>()
  /**
   * 变量说明：root 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const root of discovered) roots.set(root.identity, { path: root.path, pruneWhenEmpty: true })
  if (active !== undefined) roots.set(active.identity, { path: active.path, pruneWhenEmpty: false })
  return [...roots.values()]
}
