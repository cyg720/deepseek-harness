/*
 * ================================ 文件注释 ================================
 * 【文件职责】文件系统沙箱的"路径包含判定"机制：判断一个规范目标是否在可写根
 * 之内或之下。
 * 【技术维度】两级判定：①词汇快路径（isLexicallyUnder）——规范拼写的普通情况
 * 直接按字符串前缀比较；②文件系统身份兜底——拼写不同（如 Windows 8.3 短名、
 * 大小写别名）时沿目标已有祖先逐级 stat，用 dev+ino 与根的 stat 身份比对。
 * 【产品维度】支撑沙箱的 workspace-write 模式：只有落在可写根（或平台临时区）
 * 内的变更才被允许，拒绝以 FS_SANDBOX_DENIED 结构化报错。
 * 【逻辑维度】按出现顺序：MISSING_CODES（缺失错误码集合）→ isMissing →
 * comparablePath/isLexicallyUnder（词汇比较）→ statIfPresent（容错 stat）→
 * sameIdentity（身份比较）→ isPathUnder（主入口：词汇快路径 + 祖先身份回退）。
 * 【关键边界】目标键可能以缺失后缀结尾（resolve 对不存在路径的产物），此时沿已有
 * 祖先向上走；词汇比较的大小写敏感性默认按宿主平台约定（Windows 不敏感）。
 * 【新手阅读建议】先看 isPathUnder 的主流程，再看 isLexicallyUnder 与身份回退
 * 两个分支各自解决什么问题。
 * ==========================================================================
 */
/**
 * Path-containment mechanics for the filesystem sandbox. Canonical spellings
 * take the fast lexical path; filesystem identity supplies the conservative
 * fallback for alias-equivalent roots such as Windows 8.3 names and casing.
 * @module @deepseek-ai/dsh-fs-sandbox/containment
 */
/*
 * 模块总览：本文件解决"某路径是否在根目录之内"的判定，兼顾性能（词汇快路径）
 * 与正确性（身份回退处理别名等价拼写）。
 */

import type { BigIntStats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, sep } from 'node:path'

// 视为"路径缺失"的错误码集合：ENOENT（无此文件）与 ENOTDIR（某段是文件）。
const MISSING_CODES: ReadonlySet<NodeJS.ErrnoException['code']> = new Set(['ENOENT', 'ENOTDIR'])

// 判断错误是否为"路径缺失"类。
function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return MISSING_CODES.has(code)
}

// 按大小写敏感性把路径转成可比较形式（不敏感时统一小写）。
function comparablePath(path: string, caseSensitive: boolean): string {
  return caseSensitive ? path : path.toLowerCase()
}

// 词汇层判断 target 是否等于 root 或以 root/ 为前缀（纯字符串比较，不做文件系统 I/O）。
function isLexicallyUnder(path: string, root: string, caseSensitive: boolean): boolean {
  const comparableTarget = comparablePath(path, caseSensitive)
  const comparableRoot = comparablePath(root, caseSensitive)
  if (comparableTarget === comparableRoot) return true
  const prefix = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep
  return comparableTarget.startsWith(prefix)
}

// 容错 stat：路径缺失（ENOENT/ENOTDIR）返回 undefined，其它错误照抛。
async function statIfPresent(path: string): Promise<BigIntStats | undefined> {
  try {
    return await stat(path, { bigint: true })
  } catch (error: unknown) {
    /* v8 ignore else -- a non-missing stat failure requires a host permission or I/O fault after resolve reached this ancestor. */
    if (isMissing(error)) return undefined
    /* v8 ignore next -- requires a host permission or I/O fault after resolve already reached this ancestor. */
    throw error
  }
}

// 文件系统身份比较：设备号 + inode 相同即视为同一文件系统对象。
function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

/**
 * Determine whether a canonical target is a writable root or lies beneath it.
 * The lexical fast path handles normal canonical spellings. When spellings
 * differ, walk the target's existing ancestors and compare filesystem identity
 * with the root; this recognizes Windows long-name/8.3 aliases and casing
 * without weakening containment to a textual approximation.
 * @param path - canonical target key, which may end in a missing suffix.
 * @param root - canonical writable root.
 * @param caseSensitive - whether lexical comparison preserves case; defaults
 *   to the host filesystem convention used by supported platforms.
 * @returns whether the target is the root or a descendant of it.
 */
/*
 * 判断规范目标是否是可写根本身或位于其下。词汇快路径处理正常规范拼写；
 * 拼写不同时沿目标已有祖先逐级向上、与根做文件系统身份比对——这样能识别
 * Windows 长名/8.3 别名与大小写差异，而不把包含判定弱化成文本近似。
 * @param path 规范目标键（可能以缺失后缀结尾）。
 * @param root 规范可写根。
 * @param caseSensitive 词汇比较是否区分大小写；默认取支持平台的主机文件系统约定
 *  （Windows 不区分）。
 * @returns 目标是根本身或其后代时为 true。
 */
export async function isPathUnder(
  path: string,
  root: string,
  caseSensitive = process.platform !== 'win32',
): Promise<boolean> {
  // 快路径：规范拼写直接命中。
  if (isLexicallyUnder(path, root, caseSensitive)) return true

  // 回退路径：根不存在则目标不可能在其下（已存在的目标无法挂在缺失的根下）。
  const rootInfo = await statIfPresent(root)
  if (!rootInfo) return false

  // 沿目标祖先向上走：每一级与根的 dev/ino 比对。
  let ancestor = path
  while (true) {
    const ancestorInfo = await statIfPresent(ancestor)
    if (ancestorInfo && sameIdentity(ancestorInfo, rootInfo)) return true
    const parent = dirname(ancestor)
    // 走到文件系统根仍未命中：结束。
    if (parent === ancestor) return false
    ancestor = parent
  }
}
