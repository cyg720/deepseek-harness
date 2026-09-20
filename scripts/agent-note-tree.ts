/**
 * Shared structural source of truth for the Agent Note tree. Lifecycle and class
 * sets are closed under `.agents/notes/README.md`; importing this module is pure.
 */

import { globSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'

export const agentNoteRoot = resolve(import.meta.dirname, '../.agents/notes')

/** The closed set of active Agent Note lifecycles (top-level folders under .agents/notes/). */
const AGENT_NOTE_LIFECYCLES = ['proposed', 'implemented', 'rejected'] as const

/**
 * The closed set of Agent Note classes (nested folder under each lifecycle). Adding a
 * class is a deliberate act: extend this list AND the README's Classification
 * section. The gate rejects any folder not listed here.
 */
export const AGENT_NOTE_CLASSES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing'] as const

/** Qishu notes have their own lifecycle/class tree directly below notes/qs. */
// QS 二开：二开笔记放在 notes/qs，仍复用官方生命周期及分类校验，目录隔离不能绕过检查。
const QS_ISOLATION = 'qs'

/** Historical implemented notes live outside the active lifecycle tree. */
const AGENT_NOTE_ARCHIVE = 'archived'

/** Non-Agent Note Markdown allowed to sit directly at a lifecycle root. */
const ROOT_ALLOWLIST = new Set(['AGENTS.md', 'CLAUDE.md'])

/** One Agent Note file, as discovered by the walker. */
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
export function walkAgentNoteTree(): { notes: AgentNote[]; errors: string[] } {
  const notes: AgentNote[] = []
  const errors: string[] = []
  // QS 二开：同时遍历官方及 QS 笔记并保留相对路径，旧式嵌套目录和未知分类仍报错。
  for (const prefix of ['', QS_ISOLATION + '/']) {
    const root = resolve(agentNoteRoot, prefix)
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name === 'INDEX.md') {
        errors.push('structure: ' + prefix + 'INDEX.md — centralized Agent Note indexes are forbidden')
        continue
      }
      const sharedRoot = prefix === '' && (entry.name === AGENT_NOTE_ARCHIVE || entry.name === QS_ISOLATION)
      if (entry.isDirectory() && !sharedRoot
        && !(AGENT_NOTE_LIFECYCLES as readonly string[]).includes(entry.name)) {
        errors.push('structure: ' + prefix + entry.name + '/ — unknown lifecycle folder')
      }
    }
    for (const lifecycle of AGENT_NOTE_LIFECYCLES) {
      for (const match of globSync(lifecycle + '/**/*.md', { cwd: root }).map(path => path.split(sep).join('/')).sort()) {
        const segs = match.split('/')
        if (segs.length === 2 && ROOT_ALLOWLIST.has(segs[1] ?? '')) continue
        if (match.endsWith('.zh.md')) continue
        const cls = segs[1]
        const base = segs[2]
        const rel = prefix + match
        if (segs.length !== 3 || cls === undefined || base === undefined) {
          errors.push('structure: ' + rel + ' — expected ' + prefix + '{lifecycle}/{class}/file.md')
          continue
        }
        if (!(AGENT_NOTE_CLASSES as readonly string[]).includes(cls)) {
          errors.push('structure: ' + rel + ' — unknown class folder "' + cls + '"')
          continue
        }
        if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(base)) {
          errors.push('structure: ' + rel + ' — filename must be yyyy-mm-dd-topic.md')
          continue
        }
        notes.push({ lifecycle, rel, date: base.slice(0, 10) })
      }
    }
  }
  return { notes, errors }
}
