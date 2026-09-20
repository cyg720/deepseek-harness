/** Qishu notes share classification rules while remaining separate from upstream notes. */
import { resolve } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ files: new Map<string, string[]>(), directories: new Map<string, string[]>() }))
vi.mock('node:fs', () => ({
  readdirSync: (root: string) => (fixture.directories.get(root) ?? []).map(name => ({ name, isDirectory: () => true })),
  globSync: (pattern: string, options: { cwd: string }) => (fixture.files.get(options.cwd) ?? [])
    .filter(file => file.startsWith((pattern.split('/')[0] ?? '') + '/')),
}))

import { agentNoteRoot, walkAgentNoteTree } from '../agent-note-tree.ts'

beforeEach(() => { fixture.files.clear(); fixture.directories.clear() })

it('discovers both upstream and Qishu decisions with the same lifecycle', () => {
  fixture.directories.set(agentNoteRoot, ['implemented', 'archived', 'qs'])
  fixture.directories.set(resolve(agentNoteRoot, 'qs'), ['implemented'])
  fixture.files.set(agentNoteRoot, ['implemented/AGENTS.md', 'implemented/architecture/2026-09-18-official.md'])
  fixture.files.set(resolve(agentNoteRoot, 'qs'), [
    'implemented/architecture/2026-09-18-workbench.md', 'implemented/architecture/2026-09-18-workbench.zh.md',
  ])
  expect(walkAgentNoteTree()).toEqual({ errors: [], notes: [
    { lifecycle: 'implemented', rel: 'implemented/architecture/2026-09-18-official.md', date: '2026-09-18' },
    { lifecycle: 'implemented', rel: 'qs/implemented/architecture/2026-09-18-workbench.md', date: '2026-09-18' },
  ] })
})

it.each(['misc', 'archived'])('rejects unregistered Qishu lifecycle %s', (lifecycle) => {
  fixture.directories.set(resolve(agentNoteRoot, 'qs'), [lifecycle])
  expect(walkAgentNoteTree().errors).toEqual([`structure: qs/${lifecycle}/ — unknown lifecycle folder`])
})

it('rejects old isolation depth, unknown classes, invalid dates, and centralized indexes', () => {
  fixture.directories.set(agentNoteRoot, ['INDEX.md', 'unknown'])
  fixture.files.set(agentNoteRoot, ['implemented/architecture/qs/2026-09-18-old.md'])
  fixture.files.set(resolve(agentNoteRoot, 'qs'), ['implemented/unknown/2026-09-18-note.md', 'implemented/bug-fix/undated.md'])
  const result = walkAgentNoteTree()
  expect(result.notes).toEqual([])
  expect(result.errors).toHaveLength(5)
  expect(result.errors.join('\n')).toContain('unknown class')
  expect(result.errors.join('\n')).toContain('yyyy-mm-dd')
})
