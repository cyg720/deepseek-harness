/**
 * Shared structural source of truth for the Agent Note tree. Lifecycle and class
 * sets are closed under `.agents/notes/README.md`; importing this module is pure.
 */
/**
 * 文件职责：实现 agent-note-tree.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */

import { globSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/** 中文说明：变量 agentNoteRoot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const agentNoteRoot = resolve(import.meta.dirname, '../.agents/notes')

/** The closed set of active Agent Note lifecycles (top-level folders under .agents/notes/). */
/** 中文说明：常量 AGENT_NOTE_LIFECYCLES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const AGENT_NOTE_LIFECYCLES = ['proposed', 'implemented', 'rejected'] as const

/**
 * The closed set of Agent Note classes (nested folder under each lifecycle). Adding a
 * class is a deliberate act: extend this list AND the README's Classification
 * section. The gate rejects any folder not listed here.
 */
/** 中文说明：常量 AGENT_NOTE_CLASSES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const AGENT_NOTE_CLASSES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing'] as const

/** Historical implemented notes live outside the active lifecycle tree. */
/** 中文说明：常量 AGENT_NOTE_ARCHIVE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const AGENT_NOTE_ARCHIVE = 'archived'

/** Non-Agent Note Markdown allowed to sit directly at a lifecycle root. */
/** 中文说明：常量 ROOT_ALLOWLIST 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ROOT_ALLOWLIST = new Set(['AGENTS.md', 'CLAUDE.md'])

/** One Agent Note file, as discovered by the walker. */
/** 中文说明：interface AgentNote 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
export interface AgentNote {
  lifecycle: string
  /** Path relative to .agents/notes. */
  rel: string
  /** `yyyy-mm-dd` from the filename. */
  date: string
}

/**
 * Walk the Agent Note tree, enforcing the structure rules. Returns every valid Agent Note
 * plus one error string per violation (unknown lifecycle or class folder, bad
 * depth, or bad filename). Callers treat a non-empty error list as fatal.
 */
/** 中文说明：函数 walkAgentNoteTree 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function walkAgentNoteTree(): { notes: AgentNote[]; errors: string[] } {
  /** 中文说明：变量 notes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const notes: AgentNote[] = []
  /** 中文说明：变量 errors 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const errors: string[] = []
  // The lifecycle set is closed too: any directory under .agents/notes/ that is not
  // a known lifecycle would otherwise hold Agent Notes invisible to the walk below.
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const entry of readdirSync(agentNoteRoot, { withFileTypes: true })) {
    if (entry.name === 'INDEX.md') {
      errors.push('structure: INDEX.md — centralized Agent Note indexes are forbidden; browse the lifecycle/class tree or search the repository')
      continue
    }
    if (entry.isDirectory()
      && entry.name !== AGENT_NOTE_ARCHIVE
      && !(AGENT_NOTE_LIFECYCLES as readonly string[]).includes(entry.name)) {
      errors.push(`structure: ${entry.name}/ — unknown lifecycle folder (allowed: ${AGENT_NOTE_LIFECYCLES.join(', ')}, plus ${AGENT_NOTE_ARCHIVE}/)`)
    }
  }
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const lifecycle of AGENT_NOTE_LIFECYCLES) {
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const match of globSync(`${lifecycle}/**/*.md`, { cwd: agentNoteRoot }).map(path => path.split(sep).join('/')).sort()) {
      /** 中文说明：变量 segs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const segs = match.split('/')
      // Allowlisted file directly at the lifecycle root (e.g. implemented/AGENTS.md).
      if (segs.length === 2 && ROOT_ALLOWLIST.has(segs[1] ?? '')) continue
      // A Chinese counterpart (foo.zh.md, docs/i18n/README.md) is the SAME Agent Note,
      // indexed via its English filename; the pairing gate owns its consistency.
      if (match.endsWith('.zh.md')) continue
      /** 中文说明：变量 cls 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const cls = segs[1]
      /** 中文说明：变量 base 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const base = segs[2]
      if (segs.length !== 3 || cls === undefined || base === undefined) {
        errors.push(`structure: ${match} — expected {lifecycle}/{class}/file.md (got depth ${segs.length})`)
        continue
      }
      if (!(AGENT_NOTE_CLASSES as readonly string[]).includes(cls)) {
        errors.push(`structure: ${match} — unknown class folder "${cls}" (allowed: ${AGENT_NOTE_CLASSES.join(', ')})`)
        continue
      }
      if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(base)) {
        errors.push(`structure: ${match} — filename must be yyyy-mm-dd-topic.md`)
        continue
      }
      notes.push({ lifecycle, rel: match, date: base.slice(0, 10) })
    }
  }
  return { notes, errors }
}
