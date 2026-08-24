/**
 * 文件职责：验证工作区界面的 tree.client.spec.ts 行为。
 * 技术维度：Vitest、协议夹具、Worker/子进程或组件替身。
 * 产品维度：防止工作区界面协议与生命周期回归。
 * 逻辑维度：构造输入，运行被测入口并断言输出与清理。
 * 关键边界：跨进程数据必须校验；Worker 和异步任务必须结束。
 * 新手阅读建议：先读协议夹具，再按成功、失败和清理场景阅读。
 */
import { describe, expect, it } from 'vitest'
import type {
  SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  deriveFlat, deriveGroups, deriveSearchResults, workspaceLabel, relativeTime,
  UNGROUPED_KEY, UNGROUPED_LABEL,
} from '../src/client/tree.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (id: string) => id as SessionId
/** 中文说明：测试局部值 wid，由紧邻初始化决定。 */
const wid = (id: string) => id as WorkspaceId
/** 中文说明：测试局部值 summary，由紧邻初始化决定。 */
const summary = (id: string, updatedAt: number, cwd?: string): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false,
  updatedAt, ...(cwd === undefined ? {} : { cwd }),
})
/** 中文说明：测试局部值 list，由紧邻初始化决定。 */
const list = (...items: SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
})
/** 中文说明：测试局部值 workspace，由紧邻初始化决定。 */
const workspace = (id: string, sessionIds: string[], title = id): WorkspaceView => ({
  workspaceId: wid(id), path: `/projects/${id}`, title,
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
/** 中文说明：测试局部值 view，由紧邻初始化决定。 */
const view = (expandedGroups: readonly string[] = [], ungroupedOrder?: readonly string[]) => ({
  expandedGroups,
  ...(ungroupedOrder === undefined ? {} : { ungroupedOrder }),
})
/** 中文说明：测试局部值 noArchive，由紧邻初始化决定。 */
const noArchive: readonly SessionId[] = []
/** 中文说明：测试局部值 archived，由紧邻初始化决定。 */
const archived = (...ids: string[]): readonly SessionId[] => ids.map(sid)

describe('deriveGroups', () => {
  it('keeps Host Workspace and sessionIds order without Client recency sorting', () => {
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = list(summary('newer', 20), summary('older', 10))
    /** 中文说明：测试局部值 workspaces，由紧邻初始化决定。 */
    const workspaces = [workspace('first', ['older', 'newer']), workspace('empty', [])]
    /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
    const groups = deriveGroups(sessions, workspaces, noArchive, view(['first']))
    expect(groups.map(group => group.key)).toEqual(['first', 'empty'])
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([sid('older'), sid('newer')])
  })

  it('projects pending-interaction state into grouped and flat rows', () => {
    /** 中文说明：测试局部值 awaiting，由紧邻初始化决定。 */
    const awaiting = { ...summary('awaiting', 10), pendingInteraction: 'plan-review' as const, running: true }
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = list(awaiting)
    /** 中文说明：测试局部值 grouped，由紧邻初始化决定。 */
    const grouped = deriveGroups(sessions, [workspace('project', ['awaiting'])], noArchive, view(['project']))
    expect(grouped[0]!.sessions[0]).toMatchObject({ pendingInteraction: 'plan-review', running: true })
    expect(deriveFlat(sessions, noArchive)[0]).toMatchObject({ pendingInteraction: 'plan-review', running: true })
  })

  it('puts only real unaccounted Sessions in the trailing Ungrouped group', () => {
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = list(summary('owned', 1, '/projects/first'), summary('loose', 9, '/other'))
    /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
    const groups = deriveGroups(sessions, [workspace('first', ['owned'])], noArchive, view([UNGROUPED_KEY]))
    expect(groups.map(group => group.key)).toEqual(['first', UNGROUPED_KEY])
    expect(groups[1]!.sessions.map(session => session.id)).toEqual([sid('loose')])
  })

  it('applies stored Ungrouped order and appends new loose Sessions by recency', () => {
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = list(summary('one', 3), summary('two', 2), summary('new', 4))
    /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
    const groups = deriveGroups(
      sessions,
      [],
      noArchive,
      view([UNGROUPED_KEY], ['two', 'stale', 'two']),
    )
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([
      sid('two'), sid('new'), sid('one'),
    ])
  })

  it('shows only the current blank session in its Workspace count and tree', () => {
    /** 中文说明：测试局部值 currentBlank，由紧邻初始化决定。 */
    const currentBlank = { ...summary('current-blank', 5), blank: true }
    /** 中文说明：测试局部值 staleBlank，由紧邻初始化决定。 */
    const staleBlank = { ...summary('stale-blank', 4), blank: true }
    /** 中文说明：测试局部值 real，由紧邻初始化决定。 */
    const real = summary('shown', 3)
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = {
      ...list(real, currentBlank, staleBlank),
      current: currentBlank.id,
    }
    /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
    const groups = deriveGroups(
      sessions, [workspace('first', ['shown', 'current-blank', 'stale-blank'])], noArchive, view(['first']),
    )
    expect(groups[0]!.sessions.map(session => session.id)).toEqual([real.id, currentBlank.id])
    /** 中文说明：测试局部值 blankNode，由紧邻初始化决定。 */
    const blankNode = groups[0]!.sessions.find(session => session.id === currentBlank.id)!
    // The stored placeholder title stays canonical; the renderer swaps in
    // the localized New Session label via the blank flag.
    expect(blankNode.title).toBe('New Session')
    expect(blankNode.blank).toBe(true)
    expect(groups[0]!.sessions.find(session => session.id === real.id)!.blank).toBe(false)
    expect(groups[0]!.sessionCount).toBe(2)
    // A non-current blank stray never surfaces an Ungrouped bucket either.
    /** 中文说明：测试局部值 strayGroups，由紧邻初始化决定。 */
    const strayGroups = deriveGroups(list({ ...summary('stray', 2), blank: true }), [workspace('first', [])], noArchive, view())
    expect(strayGroups.map(group => group.key)).toEqual(['first'])
  })

  it('projects the completion reminder into session and search rows (absent = false)', () => {
    /** 中文说明：测试局部值 done，由紧邻初始化决定。 */
    const done = { ...summary('done', 3), completed: true }
    /** 中文说明：测试局部值 plain，由紧邻初始化决定。 */
    const plain = summary('plain', 2)
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = list(done, plain)
    /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
    const groups = deriveGroups(
      sessions, [workspace('first', ['done', 'plain'])], noArchive, view(['first']),
    )
    /** 中文说明：测试局部值 doneNode，由紧邻初始化决定。 */
    const doneNode = groups[0]!.sessions.find(session => session.id === done.id)!
    /** 中文说明：测试局部值 plainNode，由紧邻初始化决定。 */
    const plainNode = groups[0]!.sessions.find(session => session.id === plain.id)!
    expect(doneNode.completed).toBe(true)
    expect(plainNode.completed).toBe(false)
    expect(deriveFlat(sessions, noArchive).find(node => node.id === done.id)!.completed).toBe(true)
    /** 中文说明：测试局部值 search，由紧邻初始化决定。 */
    const search = deriveSearchResults(sessions, [workspace('first', ['done', 'plain'])], 'done', noArchive, { items: [], hasMore: false }, 10)
    expect(search.items[0]?.completed).toBe(true)
  })

  it('hides subagent-origin sessions without hiding ordinary forks', () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = summary('parent', 1)
    /** 中文说明：测试局部值 subagent，由紧邻初始化决定。 */
    const subagent = {
      ...summary('subagent', 3), parentId: parent.id, origin: 'subagent' as const, running: true,
    }
    /** 中文说明：测试局部值 grandchild，由紧邻初始化决定。 */
    const grandchild = {
      ...summary('grandchild', 4), parentId: subagent.id, origin: 'subagent' as const, running: true,
    }
    /** 中文说明：测试局部值 fork，由紧邻初始化决定。 */
    const fork = { ...summary('fork', 2), parentId: subagent.id }
    /** 中文说明：测试局部值 forkChild，由紧邻初始化决定。 */
    const forkChild = {
      ...summary('fork-child', 5), parentId: fork.id, origin: 'subagent' as const, running: true,
    }
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = { ...list(parent, fork, subagent, grandchild, forkChild), current: subagent.id }
    /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
    const groups = deriveGroups(
      sessions,
      [workspace('first', ['parent', 'fork', 'subagent', 'grandchild', 'fork-child'])],
      noArchive,
      view(['first']),
    )

    expect(groups[0]!.sessions.map(node => node.id)).toEqual([parent.id, fork.id])
    expect(groups[0]!.sessionCount).toBe(2)
    expect(groups[0]!.sessions[0]).toMatchObject({ running: false, runningSubagentCount: 2 })
    expect(groups[0]!.sessions[1]).toMatchObject({ running: false, runningSubagentCount: 1 })
    expect(deriveFlat(sessions, noArchive).map(node => [node.id, node.runningSubagentCount])).toEqual([
      [fork.id, 1], [parent.id, 2],
    ])
    expect(deriveSearchResults(
      sessions, [workspace('first', ['parent', 'fork'])], 'parent', noArchive,
      { items: [], hasMore: false }, 10,
    ).items[0]).toMatchObject({ id: parent.id, runningSubagentCount: 2 })
  })

  it('ignores fork lineage and sorts every ungrouped session as a top-level row', () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = summary('parent', 1)
    /** 中文说明：测试局部值 oldChild，由紧邻初始化决定。 */
    const oldChild = { ...summary('old-child', 10), parentId: parent.id }
    /** 中文说明：测试局部值 newChild，由紧邻初始化决定。 */
    const newChild = { ...summary('new-child', 20), parentId: parent.id }
    /** 中文说明：测试局部值 tieB，由紧邻初始化决定。 */
    const tieB = { ...summary('tie-b', 20), parentId: parent.id }
    /** 中文说明：测试局部值 tieA，由紧邻初始化决定。 */
    const tieA = { ...summary('tie-a', 20), parentId: parent.id }
    /** 中文说明：测试局部值 self，由紧邻初始化决定。 */
    const self = { ...summary('self', 2), parentId: sid('self') }
    /** 中文说明：测试局部值 orphan，由紧邻初始化决定。 */
    const orphan = { ...summary('orphan', 3), parentId: sid('missing') }
    /** 中文说明：测试局部值 cycleA，由紧邻初始化决定。 */
    const cycleA = { ...summary('cycle-a', 4), parentId: sid('cycle-b') }
    /** 中文说明：测试局部值 cycleB，由紧邻初始化决定。 */
    const cycleB = { ...summary('cycle-b', 5), parentId: sid('cycle-a') }
    /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
    const groups = deriveGroups(
      list(parent, oldChild, newChild, tieB, tieA, self, orphan, cycleA, cycleB),
      [],
      noArchive,
      { expandedGroups: [UNGROUPED_KEY] },
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([
      newChild.id, tieA.id, tieB.id, oldChild.id,
      cycleB.id, cycleA.id, orphan.id, self.id, parent.id,
    ])

    // Equal timestamps use ids as a deterministic tiebreak in either input order.
    expect(deriveGroups(list(summary('tie-a', 1), summary('tie-b', 1)), [], noArchive, view([UNGROUPED_KEY]))[0]!
      .sessions.map(node => node.id)).toEqual([sid('tie-a'), sid('tie-b')])
  })

  it('tolerates Workspace membership arriving before its Session summary', () => {
    /** 中文说明：测试局部值 partial，由紧邻初始化决定。 */
    const partial: SessionListState = {
      ...list(),
      ids: [sid('present')],
      byId: { [sid('present')]: summary('present', 1) },
    }
    /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
    const groups = deriveGroups(partial, [workspace('project', ['missing', 'present'])], noArchive, view(['project']))
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([sid('present')])
  })

  it('hides archived sessions from workspace groups and Ungrouped', () => {
    /** 中文说明：测试局部值 kept，由紧邻初始化决定。 */
    const kept = summary('kept', 1, '/projects/first')
    /** 中文说明：测试局部值 gone，由紧邻初始化决定。 */
    const gone = summary('gone', 2, '/projects/first')
    /** 中文说明：测试局部值 looseGone，由紧邻初始化决定。 */
    const looseGone = summary('loose-gone', 3, '/other')
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = list(kept, gone, looseGone)
    /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
    const groups = deriveGroups(
      sessions, [workspace('first', ['kept', 'gone'])], archived('gone', 'loose-gone'), view(['first', UNGROUPED_KEY]),
    )
    // The archived member drops from its group AND the archived stray never
    // surfaces an Ungrouped bucket; counts follow the visible rows.
    expect(groups.map(group => group.key)).toEqual(['first'])
    expect(groups[0]!.sessions.map(node => node.id)).toEqual([kept.id])
    expect(groups[0]!.sessionCount).toBe(1)
  })

  it('marks selected Workspace and Ungrouped sessions without relying on an Intent', () => {
    /** 中文说明：测试局部值 owned，由紧邻初始化决定。 */
    const owned = summary('owned', 1)
    /** 中文说明：测试局部值 loose，由紧邻初始化决定。 */
    const loose = summary('loose', 2)
    /** 中文说明：测试局部值 ws，由紧邻初始化决定。 */
    const ws = workspace('project', ['owned'])
    /** 中文说明：测试局部值 ownedGroups，由紧邻初始化决定。 */
    const ownedGroups = deriveGroups({ ...list(owned, loose), current: owned.id }, [ws], noArchive, view())
    expect(ownedGroups.find(group => group.key === 'project')!.containsCurrent).toBe(true)
    /** 中文说明：测试局部值 looseGroups，由紧邻初始化决定。 */
    const looseGroups = deriveGroups({ ...list(owned, loose), current: loose.id }, [ws], noArchive, view())
    expect(looseGroups.find(group => group.key === UNGROUPED_KEY)!.containsCurrent).toBe(true)
  })
})

describe('deriveFlat', () => {
  it('flattens every session — fork children included — newest-first with id tiebreak', () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = summary('parent', 10)
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = { ...summary('child', 30), parentId: parent.id }
    /** 中文说明：测试局部值 tieB，由紧邻初始化决定。 */
    const tieB = summary('tie-b', 20)
    /** 中文说明：测试局部值 tieA，由紧邻初始化决定。 */
    const tieA = summary('tie-a', 20)
    /** 中文说明：测试局部值 rows，由紧邻初始化决定。 */
    const rows = deriveFlat(list(parent, child, tieB, tieA), noArchive)
    expect(rows.map(row => row.id)).toEqual([sid('child'), sid('tie-a'), sid('tie-b'), sid('parent')])
  })

  it('hides subagent-origin rows but keeps ordinary forks', () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = summary('parent', 1)
    /** 中文说明：测试局部值 fork，由紧邻初始化决定。 */
    const fork = { ...summary('fork', 2), parentId: parent.id }
    /** 中文说明：测试局部值 subagent，由紧邻初始化决定。 */
    const subagent = { ...summary('subagent', 3), parentId: parent.id, origin: 'subagent' as const }
    /** 中文说明：测试局部值 rows，由紧邻初始化决定。 */
    const rows = deriveFlat(
      { ...list(parent, fork, subagent), current: subagent.id },
      noArchive,
    )
    expect(rows.map(row => row.id)).toEqual([fork.id, parent.id])
  })

  it('tolerates ids whose summary has not landed yet', () => {
    /** 中文说明：测试局部值 partial，由紧邻初始化决定。 */
    const partial: SessionListState = { ...list(summary('present', 1)), ids: [sid('ghost'), sid('present')] }
    expect(deriveFlat(partial, noArchive).map(row => row.id)).toEqual([sid('present')])
  })

  it('shows only the current blank session and excludes blanks from search', () => {
    /** 中文说明：测试局部值 currentBlank，由紧邻初始化决定。 */
    const currentBlank = { ...summary('current-blank', 9), blank: true }
    /** 中文说明：测试局部值 staleBlank，由紧邻初始化决定。 */
    const staleBlank = { ...summary('stale-blank', 8), blank: true }
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = {
      ...list(summary('real', 1), currentBlank, staleBlank),
      current: currentBlank.id,
    }
    /** 中文说明：测试局部值 rows，由紧邻初始化决定。 */
    const rows = deriveFlat(sessions, noArchive)
    expect(rows.map(row => row.id)).toEqual([currentBlank.id, sid('real')])
    expect(rows.map(row => row.title)).toEqual(['New Session', 'real'])
    expect(rows.map(row => row.blank)).toEqual([true, false])
  })

  it('hides archived sessions in flat mode', () => {
    /** 中文说明：测试局部值 kept，由紧邻初始化决定。 */
    const kept = summary('kept', 1)
    /** 中文说明：测试局部值 gone，由紧邻初始化决定。 */
    const gone = summary('gone', 2)
    expect(deriveFlat(list(kept, gone), archived('gone')).map(row => row.id)).toEqual([kept.id])
  })
})

describe('deriveSearchResults archive filtering', () => {
  it('archived sessions never match — not by title and not via a backend content hit', () => {
    /** 中文说明：测试局部值 hit，由紧邻初始化决定。 */
    const hit = summary('hit', 2)
    hit.displayTitle = 'Needle row'
    /** 中文说明：测试局部值 gone，由紧邻初始化决定。 */
    const gone = summary('gone', 1)
    gone.displayTitle = 'Needle archived'
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = deriveSearchResults(
      list(hit, gone),
      [],
      'needle',
      archived('gone'),
      { items: [{ sessionId: gone.id, snippet: 'needle body' }], hasMore: false },
      10,
    )
    expect(result.items.map(item => item.id)).toEqual([hit.id])
  })
})

describe('deriveSearchResults', () => {
  it('merges local title/Workspace matches before ranked content hits and enriches duplicates', () => {
    /** 中文说明：测试局部值 titleHit，由紧邻初始化决定。 */
    const titleHit = summary('title-hit', 30, '/projects/a')
    titleHit.displayTitle = 'Needle title'
    titleHit.pendingInteraction = 'plan-review'
    /** 中文说明：测试局部值 workspaceHit，由紧邻初始化决定。 */
    const workspaceHit = summary('workspace-hit', 20, '/projects/b')
    workspaceHit.displayTitle = 'Ordinary title'
    /** 中文说明：测试局部值 contentHit，由紧邻初始化决定。 */
    const contentHit = summary('content-hit', 10, '/projects/c')
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = list(titleHit, workspaceHit, contentHit)
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = deriveSearchResults(
      sessions,
      [
        workspace('a', ['title-hit'], 'Alpha'),
        workspace('b', ['workspace-hit'], 'Needle Workspace'),
        workspace('duplicate-owner', ['title-hit'], 'Ignored duplicate owner'),
      ],
      ' NEEDLE ',
      noArchive,
      {
        items: [
          { sessionId: contentHit.id, snippet: 'body needle excerpt' },
          { sessionId: contentHit.id, snippet: 'ignored duplicate excerpt' },
          { sessionId: titleHit.id, snippet: 'title session body excerpt' },
          { sessionId: sid('unknown'), snippet: 'not in session.list' },
        ],
        hasMore: false,
      },
      10,
    )

    expect(result).toEqual({
      items: [
        {
          id: titleHit.id,
          title: 'Needle title',
          workspace: 'Alpha',
          running: false,
          runningSubagentCount: 0,
          pendingInteraction: 'plan-review',
          completed: false,
          snippet: 'title session body excerpt',
        },
        {
          id: workspaceHit.id,
          title: 'Ordinary title',
          workspace: 'Needle Workspace',
          running: false,
          runningSubagentCount: 0,
          completed: false,
        },
        {
          id: contentHit.id,
          title: 'content-hit',
          workspace: 'c',
          running: false,
          runningSubagentCount: 0,
          completed: false,
          snippet: 'body needle excerpt',
        },
      ],
      hasMore: false,
    })
  })

  it('excludes blank sessions from search regardless of query or content hits', () => {
    /** 中文说明：测试局部值 currentBlank，由紧邻初始化决定。 */
    const currentBlank = { ...summary('opaque-current', 5), blank: true }
    /** 中文说明：测试局部值 staleBlank，由紧邻初始化决定。 */
    const staleBlank = { ...summary('new session stale', 4), blank: true }
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = {
      ...list(currentBlank, staleBlank),
      current: currentBlank.id,
    }
    // Blank placeholders never match — not their localized-display title, not
    // their id, and not even a backend content hit naming them.
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = deriveSearchResults(
      sessions,
      [workspace('first', ['opaque-current', 'new session stale'])],
      'new session',
      noArchive,
      {
        items: [
          { sessionId: staleBlank.id, snippet: 'stale body' },
          { sessionId: currentBlank.id, snippet: 'current body' },
        ],
        hasMore: false,
      },
      10,
    )
    expect(result.items).toEqual([])
  })

  it('uses the supplied cap and preserves either local overflow or backend hasMore', () => {
    /** 中文说明：测试局部值 rows，由紧邻初始化决定。 */
    const rows = Array.from({ length: 5 }, (_, index) => {
      /** 中文说明：测试局部值 item，由紧邻初始化决定。 */
      const item = summary(`s-${String(index).padStart(2, '0')}`, index)
      item.displayTitle = `Needle ${String(index)}`
      return item
    })
    /** 中文说明：测试局部值 overflow，由紧邻初始化决定。 */
    const overflow = deriveSearchResults(
      list(...rows),
      [],
      'needle',
      noArchive,
      { items: [], hasMore: false },
      3,
    )
    expect(overflow.items).toHaveLength(3)
    expect(overflow.hasMore).toBe(true)

    /** 中文说明：测试局部值 backendMore，由紧邻初始化决定。 */
    const backendMore = deriveSearchResults(
      list(summary('body', 1)),
      [],
      'needle',
      noArchive,
      { items: [{ sessionId: sid('body'), snippet: 'needle' }], hasMore: true },
      3,
    )
    expect(backendMore.items).toHaveLength(1)
    expect(backendMore.hasMore).toBe(true)
    expect(deriveSearchResults(list(), [], '  ', noArchive, { items: [], hasMore: true }, 3))
      .toEqual({ items: [], hasMore: false })
  })
})

describe('createWorkspaceViewStore', () => {
  it('stores grouping, ordering, Workspace expansion, and recent-session view order', () => {
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = createWorkspaceViewStore().create()
    expect(store.getSnapshot().groupBy).toBe('workspace')
    expect(store.getSnapshot().orderBy).toBe('updated')
    store.actions.setGroupBy('flat')
    store.actions.setOrderBy('updated')
    store.actions.setGroupExpanded('alpha', true)
    store.actions.syncSessionOrderAccount('alpha', ['two', 'one'], { one: 1, two: 2 })
    store.actions.setSessionOrder('alpha', ['one', 'two'])
    expect(store.getSnapshot().groupBy).toBe('flat')
    expect(store.getSnapshot()).toMatchObject({
      orderBy: 'updated',
      groupExpansion: { alpha: true },
      sessionOrderByAccount: { alpha: ['one', 'two'] },
      sessionUpdatedAtByAccount: { alpha: { one: 1, two: 2 } },
    })
  })

  it('removes view state outside the retained Workspace key set', () => {
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = createWorkspaceViewStore().create()
    store.actions.setGroupExpanded('', true)
    store.actions.setGroupExpanded('alpha', true)
    store.actions.setGroupExpanded('deleted', true)
    store.actions.syncSessionOrderAccount('alpha', ['alpha-session'], { 'alpha-session': 2 })
    store.actions.syncSessionOrderAccount('deleted', ['deleted-session'], { 'deleted-session': 1 })

    store.actions.retainAccountKeys(['', 'alpha'])

    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    const snapshot = store.getSnapshot()
    expect(snapshot.groupExpansion).toEqual({ '': true, alpha: true })
    expect(snapshot.sessionOrderByAccount).toEqual({ alpha: ['alpha-session'] })
    expect(snapshot.sessionUpdatedAtByAccount).toEqual({ alpha: { 'alpha-session': 2 } })
  })
})

describe('workspaceLabel', () => {
  it('uses the Ungrouped fallback and extracts POSIX and Windows basenames', () => {
    expect(workspaceLabel(undefined)).toBe(UNGROUPED_LABEL)
    expect(workspaceLabel('')).toBe(UNGROUPED_LABEL)
    expect(workspaceLabel('/projects/demo/')).toBe('demo')
    expect(workspaceLabel('C:\\projects\\demo\\')).toBe('demo')
    expect(workspaceLabel('/')).toBe('/')
  })
})

describe('relativeTime', () => {
  it('buckets current, minute, hour, day, month, and year distances', () => {
    /** 中文说明：测试局部值 now，由紧邻初始化决定。 */
    const now = 400 * 24 * 60 * 60 * 1_000
    expect(relativeTime(now, now)).toEqual({ unit: 'now', n: 0 })
    expect(relativeTime(now - 5 * 60_000, now)).toEqual({ unit: 'minutes', n: 5 })
    expect(relativeTime(now - 3 * 3_600_000, now)).toEqual({ unit: 'hours', n: 3 })
    expect(relativeTime(now - 2 * 86_400_000, now)).toEqual({ unit: 'days', n: 2 })
    expect(relativeTime(now - 60 * 86_400_000, now)).toEqual({ unit: 'months', n: 2 })
    expect(relativeTime(0, now)).toEqual({ unit: 'years', n: 1 })
  })
})
