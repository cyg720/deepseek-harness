#!/usr/bin/env node
/**
 * Temporary branch-convergence command for canonical projected session fixtures.
 *
 * @see ../.agents/notes/proposed/process/2026-07-26-remove-packed-session-fixture-migrator.md
 */
/*
 * 文件职责：把仓库内旧布局的会话 JSONL 夹具一次性重写为规范紧凑布局。
 * 技术维度：使用 Node.js 文件写入、路径解析和共享布局检查器执行确定性迁移。
 * 产品维度：保持会话回放与 SDK 测试数据和当前持久化格式一致，便于分支合并。
 * 逻辑维度：拒绝额外参数，扫描全部夹具，筛出有差异的文件，逐个覆盖并报告数量。
 * 关键边界：命令会直接覆盖已跟踪夹具；只应在确认差异后运行，并检查生成的 Git diff。
 * 新手阅读建议：先看 changed 的筛选条件，再确认 writeFileSync 写入的是 canonical 而非 source。
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inspectSessionFixtureLayouts } from './session-fixture-layout.ts'

// 参数边界：该迁移命令不接受位置参数，防止误以为可以限定部分文件。
if (process.argv.length > 2) throw new Error('migrate:packed-session-fixtures takes no arguments')

// root：由 scripts 目录向上解析得到的仓库绝对根目录。
const root = resolve(import.meta.dirname, '..')
// fixtures：每个已提交会话夹具的源码布局与规范布局检查结果。
const fixtures = inspectSessionFixtureLayouts(root)
// changed：源码文本尚未等于规范紧凑文本的夹具集合。
const changed = fixtures.filter(fixture => fixture.source !== fixture.canonical)
// fixture：当前待重写的单个夹具，path 为仓库相对路径，canonical 为目标文本。
for (const fixture of changed) {
  writeFileSync(resolve(root, fixture.path), fixture.canonical)
  console.log(fixture.path)
}
console.log(`session snapshot fixtures: ${changed.length} rewritten, ${fixtures.length} inspected`)
