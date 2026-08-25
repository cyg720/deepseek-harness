/**
 * Unit tests for the result-time contextual-diff computation (`src/diff.ts`):
 * the pure before/after → {@link FileDiff}[] hunk builder and the defensive
 * `meta` narrowing. These pin the exact hunk reconstruction (context lines,
 * multi-hunk replaceAll, pure insertion/deletion, no-op) that UIs render.
 */
/*
 * 文件职责：验证文件系统与工具的 diff.spec.ts 行为与安全边界。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证文件系统与工具操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：构造请求与状态，驱动服务并断言输出和清理。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */

import { describe, expect, it } from 'vitest'
import { computeHunkDiffs, diffsFromMeta, DIFF_CONTEXT } from '../src/diff.ts'
import type { JsonValue } from '@deepseek-ai/dsh-session'

/** 中文说明：测试局部值 lines，由紧邻初始化决定。 */
const lines = (n: number): string => Array.from({ length: n }, (_, i) => `line${i + 1}`).join('\n') + '\n'

describe('computeHunkDiffs', () => {
  it('a single-line change yields one hunk with ±context lines on both sides', () => {
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = lines(8)
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = before.replace('line4', 'CHANGED')
    /** 中文说明：测试局部值 diffs，由紧邻初始化决定。 */
    const diffs = computeHunkDiffs('f.txt', before, after)
    expect(diffs).toEqual([{
      path: 'f.txt',
      oldText: 'line1\nline2\nline3\nline4\nline5\nline6\nline7',
      newText: 'line1\nline2\nline3\nCHANGED\nline5\nline6\nline7',
    }])
  })

  it('a scattered replace_all yields one FileDiff PER hunk (matching per-site editor blocks)', () => {
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = lines(20)
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = before.replace('line3', 'A').replace('line16', 'B')
    /** 中文说明：测试局部值 diffs，由紧邻初始化决定。 */
    const diffs = computeHunkDiffs('f.txt', before, after)
    expect(diffs).toHaveLength(2)
    expect(diffs[0]?.path).toBe('f.txt')
    expect(diffs[0]?.oldText).toContain('line3')
    expect(diffs[0]?.newText).toContain('A')
    expect(diffs[1]?.oldText).toContain('line16')
    expect(diffs[1]?.newText).toContain('B')
    // The two hunks are distinct sites, not one merged block.
    expect(diffs[0]?.newText).not.toContain('B')
    expect(diffs[1]?.newText).not.toContain('A')
  })

  it('identical before/after (a no-op) yields no hunks', () => {
    expect(computeHunkDiffs('f.txt', 'same\n', 'same\n')).toEqual([])
  })

  it('a pure insertion into empty content reports oldText null (nothing to diff against)', () => {
    /** 中文说明：测试局部值 diffs，由紧邻初始化决定。 */
    const diffs = computeHunkDiffs('f.txt', '', 'brand new\n')
    expect(diffs).toEqual([{ path: 'f.txt', oldText: null, newText: 'brand new' }])
  })

  it('a pure deletion of the whole file reports newText empty', () => {
    /** 中文说明：测试局部值 diffs，由紧邻初始化决定。 */
    const diffs = computeHunkDiffs('f.txt', 'gone\n', '')
    expect(diffs).toEqual([{ path: 'f.txt', oldText: 'gone', newText: '' }])
  })

  it('drops the "\\ No newline at end of file" marker from a no-trailing-newline change', () => {
    /** 中文说明：测试局部值 diffs，由紧邻初始化决定。 */
    const diffs = computeHunkDiffs('f.txt', 'x', 'y')
    // The marker line (starting with "\\") must never leak into a diff block.
    expect(diffs).toEqual([{ path: 'f.txt', oldText: 'x', newText: 'y' }])
    expect(diffs[0]?.oldText).not.toContain('\\')
    expect(diffs[0]?.newText).not.toContain('\\')
  })

  it('uses DIFF_CONTEXT (3) surrounding lines', () => {
    expect(DIFF_CONTEXT).toBe(3)
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = lines(20)
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = before.replace('line10', 'CHANGED')
    /** 中文说明：测试局部值 [diff]，由紧邻初始化决定。 */
    const [diff] = computeHunkDiffs('f.txt', before, after)
    // 3 context above (7,8,9) + the change + 3 below (11,12,13) = 7 lines a side.
    expect(diff?.oldText?.split('\n')).toHaveLength(7)
    expect(diff?.newText.split('\n')).toHaveLength(7)
    expect(diff?.oldText?.split('\n')[0]).toBe('line7')
  })
})

describe('diffsFromMeta (defensive narrowing)', () => {
  // The narrowing accepts an opaque JsonValue; a malformed payload is not a
  // statically-valid JsonValue, so route every case through one cast helper that
  // mirrors how a hand-edited/older session log delivers arbitrary shapes.
  /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
  const m = (value: unknown): JsonValue | undefined => value as JsonValue | undefined
  /** 中文说明：测试局部值 good，由紧邻初始化决定。 */
  const good = { diffs: [{ path: 'f.txt', oldText: 'a', newText: 'b' }] }

  it('narrows a well-formed { diffs } payload', () => {
    expect(diffsFromMeta(m(good))).toEqual(good.diffs)
  })

  it('accepts a diff whose oldText is null (a create-style hunk)', () => {
    /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
    const meta = { diffs: [{ path: 'f.txt', oldText: null, newText: 'x' }] }
    expect(diffsFromMeta(m(meta))).toEqual(meta.diffs)
  })

  it('rejects undefined / non-object / array meta', () => {
    expect(diffsFromMeta(undefined)).toBeUndefined()
    expect(diffsFromMeta(null)).toBeUndefined()
    expect(diffsFromMeta(m('nope'))).toBeUndefined()
    expect(diffsFromMeta(m([]))).toBeUndefined()
  })

  it('rejects a missing / empty / non-array diffs field', () => {
    expect(diffsFromMeta(m({}))).toBeUndefined()
    expect(diffsFromMeta(m({ diffs: [] }))).toBeUndefined()
    expect(diffsFromMeta(m({ diffs: 'x' }))).toBeUndefined()
  })

  it('rejects a diffs array containing a malformed entry', () => {
    expect(diffsFromMeta(m({ diffs: [{ path: 'f.txt', oldText: 'a' }] }))).toBeUndefined()
    expect(diffsFromMeta(m({ diffs: [{ path: 1, oldText: 'a', newText: 'b' }] }))).toBeUndefined()
    expect(diffsFromMeta(m({ diffs: [{ path: 'f', oldText: 5, newText: 'b' }] }))).toBeUndefined()
    expect(diffsFromMeta(m({ diffs: [{ path: 'f', oldText: 'a', newText: 7 }] }))).toBeUndefined()
    expect(diffsFromMeta(m({ diffs: [null] }))).toBeUndefined()
    expect(diffsFromMeta(m({ diffs: ['x'] }))).toBeUndefined()
    expect(diffsFromMeta(m({ diffs: [[]] }))).toBeUndefined()
  })
})
