/**
 * Mechanical guard for the coverage-exempt roster: each entry's positional
 * filter and exclude glob must select the same non-empty file set out of the
 * repository's spec inventory, so a renamed suite cannot silently fall out of
 * the uninstrumented gate while its exclude goes stale.
 */
/*
 * 中文说明：
 * - 文件职责：机械校验覆盖率豁免清单的过滤前缀与排除 glob 始终命中同一非空测试集合。
 * - 技术维度：使用 Vitest、Node globSync、Set/Map 和标准化 POSIX 路径。
 * - 产品维度：防止重型测试重命名后静默漏跑或被重复运行，维持覆盖率门禁可信度。
 * - 逻辑维度：建立全仓 spec 清单，分别按 glob 与前缀求匹配，再检查逐项相等和全局不重叠。
 * - 关键边界：测试清单模式必须与 vitest.config.ts 同步；每项必须至少命中一个文件。
 * - 新手阅读建议：先看 allSpecs 的来源，再比较 excludeMatches 和 filterMatches 的两种筛选方式。
 */

import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coverageExemptHeavySuites } from './coverage-exempt.ts'

/** 仓库根目录绝对路径，供所有 glob 统一使用。 */
const root = resolve(import.meta.dirname, '..')

/** The spec inventory mirrored from vitest.config.ts testIncludes. */
/* 中文：与 vitest.config.ts testIncludes 对齐的全部测试文件集合，路径统一使用正斜杠。 */
const allSpecs = new Set([
  ...globSync('packages/*/*/tests/**/*.spec.ts', { cwd: root }),
  ...globSync('packages/*/*/tests/**/*.spec.tsx', { cwd: root }),
  ...globSync('apps/*/tests/**/*.spec.ts', { cwd: root }),
  ...globSync('scripts/**/*.spec.ts', { cwd: root }),
].map(path => path.replaceAll('\\', '/')))

/** 中文：按 exclude glob 查找且限定在 allSpecs 中；返回排序后的路径数组。 */
function excludeMatches(exclude: string): string[] {
  return globSync(exclude, { cwd: root })
    .map(path => path.replaceAll('\\', '/'))
    .filter(path => allSpecs.has(path))
    .sort()
}

/** 中文：按位置过滤前缀筛选 allSpecs；返回排序后的路径数组。 */
function filterMatches(filter: string): string[] {
  return [...allSpecs].filter(spec => spec.startsWith(filter)).sort()
}

/** 中文：覆盖率豁免清单一致性测试组。 */
describe('coverage-exempt roster', () => {
  /** 中文：逐项验证 filter 与 exclude 命中同一非空集合；suite 是当前豁免项，无返回值。 */
  it.each(coverageExemptHeavySuites.map(suite => [suite.filter, suite] as const))(
    'filter and exclude select the same non-empty spec set for %s',
    (_filter, suite) => {
      /** 当前 exclude glob 命中的测试列表。 */
      const fromExclude = excludeMatches(suite.exclude)
      /** 当前 filter 前缀命中的测试列表。 */
      const fromFilter = filterMatches(suite.filter)
      expect(fromExclude.length).toBeGreaterThan(0)
      expect(fromFilter).toEqual(fromExclude)
    },
  )

  /** 中文：验证任意测试不会同时属于两个豁免项；无参数和返回值。 */
  it('entries never overlap, so no suite is double-run or double-excluded', () => {
    /** 测试路径到首次命中 exclude 的记录表。 */
    const seen = new Map<string, string>()
    /** 当前遍历的覆盖率豁免项。 */
    for (const suite of coverageExemptHeavySuites) {
      /** 当前豁免项命中的单个测试路径。 */
      for (const spec of excludeMatches(suite.exclude)) {
        expect(seen.get(spec), `${spec} matched by ${seen.get(spec) ?? ''} and ${suite.exclude}`).toBeUndefined()
        seen.set(spec, suite.exclude)
      }
    }
  })
})
