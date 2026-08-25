/**
 * Enforce Agent Note lifecycle/class paths and dated filenames. Structural rules
 * are shared with `agent-note-tree.ts`; the closed classification rules live
 * in `.agents/notes/README.md`.
 */
/*
 * 文件职责：校验 Agent Note 生命周期目录、分类路径和日期文件名符合封闭规则。
 * 技术维度：使用 Node.js 路径与存在检查、共享树遍历器和进程退出码实现仓库门禁。
 * 产品维度：让架构与过程决策保存在唯一可发现的位置，避免旧目录产生第二套事实来源。
 * 逻辑维度：遍历当前 Note 树，把仍存在的旧目录加入错误；无错误成功，否则逐条报告并失败。
 * 关键边界：分类规则由 .agents/notes/README.md 定义；脚本只校验，不移动或改写 Note。
 * 新手阅读建议：先看 walkAgentNoteTree 返回的 notes/errors，再理解 legacyRoot 为何总是禁止。
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { walkAgentNoteTree } from './agent-note-tree.ts'

// notes：结构有效的 Agent Note 记录；errors：遍历时发现的全部结构违规。
const { notes, errors } = walkAgentNoteTree()

// Keep the former homes unavailable so new notes cannot silently escape this tree.
// 保持旧目录不可用，防止新 Note 悄悄绕开 .agents/notes 生命周期树。
// legacyRoot：当前检查的历史文档目录，只允许不存在。
for (const legacyRoot of ['docs/rfc', 'docs/rfcs']) {
  if (existsSync(resolve(import.meta.dirname, '..', legacyRoot))) {
    errors.push(`legacy-path: ${legacyRoot}/ is forbidden — put Agent Notes under .agents/notes/`)
  }
}

// 成功分支：没有任何结构或旧目录违规时报告检查数量并返回状态 0。
if (errors.length === 0) {
  console.log(`verify-agent-note-classification: ${notes.length} Agent Note(s) checked, structure consistent.`)
  process.exit(0)
}

console.error('verify-agent-note-classification: violations found:')
// e：当前待输出的单项分类错误文本。
for (const e of errors) console.error(`  ${e}`)
process.exit(1)
