/** Repository-wide canonical-layout check for committed session snapshots. */
/**
 * 文件职责：检查已提交的会话格式 JSONL 测试数据是否使用规范的紧凑布局。
 * 技术维度：使用 Vitest 调用布局检查器，并通过 Node 路径 API 定位仓库根目录。
 * 产品维度：保持会话夹具与真实持久化格式一致，降低 SDK 和回放测试读取差异。
 * 逻辑维度：扫描所有会话夹具，筛出源码布局与规范布局不同的路径，并要求结果为空。
 * 关键边界：本测试只报告差异，不自动重写；修复必须运行提示中的迁移命令并提交结果。
 * 新手阅读建议：先看 nonCanonical 的筛选链，再阅读 session-fixture-layout.ts 理解两种布局如何比较。
 */

import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { inspectSessionFixtureLayouts } from './session-fixture-layout.ts'

// root：仓库绝对根目录，由当前 scripts 目录向上一级解析得到。
const root = resolve(import.meta.dirname, '..')

/**
 * 功能描述：确认每个会话格式 JSONL 夹具都已投影为规范紧凑布局。
 * 参数说明：测试回调不接收参数。
 * 返回值解释：无返回值；发现路径时断言给出统一迁移命令。
 * 使用示例：运行本测试前后可用 pnpm run migrate:packed-session-fixtures 修复差异。
 */
it('keeps every session-format JSONL fixture projected into canonical packed layout', () => {
  // nonCanonical：仍有布局差异的仓库相对路径；fixture 回调参数表示当前检查结果。
  const nonCanonical = inspectSessionFixtureLayouts(root)
    .filter(fixture => fixture.source !== fixture.canonical)
    .map(fixture => fixture.path)
  expect(
    nonCanonical,
    'Run `pnpm run migrate:packed-session-fixtures` and commit the mechanical fixture rewrite.',
  ).toEqual([])
})
