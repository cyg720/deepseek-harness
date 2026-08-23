/**
 * ================================ 文件注释 ================================
 * 【文件职责】write/edit 的"结果时上下文 diff 展示"：存储返回 before/after 文本，
 * 本模型侧层为每个被应用的变更块（hunk）派生一张"每侧三行上下文"的 diff 卡片。
 * 【技术维度】用 diff 库的 structuredPatch 生成统一格式补丁，再逐 hunk 拆成
 * FileDiff（oldText/newText，纯插入 oldText 为 null，跳过 \ 无尾换行标记）；
 * diffsFromMeta 从不透明 meta 防御性收窄成非空 diff 数组（重放时坏数据返回
 * undefined 走兜底）。
 * 【产品维度】让模型/UI 在 write/edit 之后立刻看到"改了什么"的上下文 diff，
 * 而不是整文件对比，聚焦变更本身。
 * 【逻辑维度】按出现顺序：DIFF_CONTEXT（上下文行数）→ FsDiffMeta（meta 载荷类型）
 * → computeHunkDiffs（before/after → FileDiff[]）→ isFileDiff（防御性收窄）→
 * diffsFromMeta（meta → FileDiff[]）。
 * 【关键边界】meta 必须可 JSON 序列化（会话在 append 时校验），presentResult 才能
 * 在重放时复现 diff 卡片；散布的替换保持为独立 hunk。
 * 【新手阅读建议】先看 computeHunkDiffs 理解 hunk 如何拆行，再看 diffsFromMeta
 * 理解重放安全。
 * ==========================================================================
 */
/**
 * Result-time contextual diff presentation for write and edit. Storage returns before/after
 * text; this model-facing layer derives one three-line-context card per applied hunk.
 * @module @deepseek-ai/dsh-tool-fs/src/diff
 */
/**
 * 模块总览：本文件把"变更前后文本"转成面向展示的 diff 块，并负责结果 meta 的
 * 防御性解析（重放安全）。
 */

import { structuredPatch } from 'diff'
import type { FileDiff } from '@deepseek-ai/dsh-tools'

/** Context lines shown on each side of an applied hunk. */
/** 每个被应用变更块两侧展示的上下文行数：3。 */
export const DIFF_CONTEXT = 3

/**
 * The `write`/`edit` tools' private `tool/result` `meta` payload: the applied
 * contextual-diff hunks. Attached opaquely (as `unknown`) on the tool result and
 * persisted with the session log — it must be JSON-serializable (the session
 * validates this at `append`), so `presentResult` reproduces the diff card on
 * replay. The producing tool owns and narrows this opaque shape.
 */
/**
 * write/edit 工具私有的 tool/result meta 载荷：被应用的上下文 diff 块数组。
 * 以不透明 unknown 形式附在工具结果上并随会话日志持久化——必须可 JSON 序列化
 * （会话在 append 时校验），这样 presentResult 能在重放时复现 diff 卡片。
 * 生产工具拥有并收窄这个不透明形状。
 */
export type FsDiffMeta = { diffs: FileDiff[] }

/**
 * Compute one {@link FileDiff} per hunk between `before` and `after`, each carrying the
 * applied change plus {@link DIFF_CONTEXT} context lines. Pure insertions use `oldText: null`,
 * patch-only no-newline markers are omitted, and scattered replacements remain separate hunks.
 *
 * @param path - the path stamped on every produced diff (the model-facing `file_path`; the
 *   bridge relativizes it).
 * @param before - the file text before the change (the backend's LF-normalized diff basis).
 * @param after - the file text after the change, on the same basis.
 * @returns one diff per applied hunk, in file order; empty when the texts are identical.
 */
/**
 * 在 before/after 之间为每个变更块计算一个 FileDiff，各携带被应用的改动加 3 行上下文。
 * 纯插入用 oldText: null；补丁专属的"无尾换行"标记被跳过；散布的替换保持为独立 hunk。
 * @param path 盖在每个产出 diff 上的路径（模型侧 file_path；桥接层会相对化它）。
 * @param before 变更前的文件文本（后端的 LF 归一化 diff 基础）。
 * @param after 变更后的文件文本（同一基础）。
 * @returns 每个被应用块一个 diff，按文件顺序；文本相同时为空数组。
 */
export function computeHunkDiffs(path: string, before: string, after: string): FileDiff[] {
  const patch = structuredPatch('', '', before, after, undefined, undefined, { context: DIFF_CONTEXT })
  const diffs: FileDiff[] = []
  for (const hunk of patch.hunks) {
    const oldLines: string[] = []
    const newLines: string[] = []
    for (const line of hunk.lines) {
      // The unified-diff marker for a missing trailing newline annotates the
      // patch, not the content — skip it so it never leaks into a diff block.
      // 中文说明：统一 diff 中"缺尾换行"的 \\ 标记注解的是补丁本身而非内容，
      // 跳过它以免泄漏进 diff 块。
      if (line.startsWith('\\')) continue
      const text = line.slice(1)
      if (line.startsWith('-')) {
        oldLines.push(text)
      } else if (line.startsWith('+')) {
        newLines.push(text)
      } else {
        // A context (unchanged) line appears on both sides.
        // 中文说明：上下文（未变）行同时出现在两侧。
        oldLines.push(text)
        newLines.push(text)
      }
    }
    diffs.push({ path, oldText: oldLines.length > 0 ? oldLines.join('\n') : null, newText: newLines.join('\n') })
  }
  return diffs
}

/** Whether `value` is a valid {@link FileDiff} (defensive narrowing from opaque `meta`). */
/** value 是否为合法的 FileDiff（从不透明 meta 做的防御性收窄）。 */
function isFileDiff(value: unknown): value is FileDiff {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { path, oldText, newText } = value as Record<string, unknown>
  return typeof path === 'string'
    && (oldText === null || typeof oldText === 'string')
    && typeof newText === 'string'
}

/**
 * Narrow opaque live or replayed result metadata to non-empty file diffs. Malformed metadata
 * returns `undefined` so presentation can fall back instead of throwing during replay.
 * @param meta - result metadata.
 * @returns validated hunks, or `undefined` for absent or malformed data.
 */
/**
 * 把不透明的实时/重放结果 meta 收窄成非空 diff 数组。畸形 meta 返回 undefined，
 * 让展示层回退而不是在重放时抛错。
 * @param meta 结果元数据。
 * @returns 校验通过的变更块；缺失或畸形时为 undefined。
 */
export function diffsFromMeta(meta: unknown): FileDiff[] | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const diffs = (meta as Record<string, unknown>).diffs
  if (!Array.isArray(diffs) || diffs.length === 0 || !diffs.every(isFileDiff)) return undefined
  return diffs
}
