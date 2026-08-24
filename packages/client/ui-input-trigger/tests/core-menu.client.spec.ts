// menuReduce generation gating, auto-close, silent group removal, cyclic
// highlight movement, stale/no-op reference identity; exactMatch lookup.
/**
 * 文件职责：验证输入触发菜单的 core-menu.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染和可控服务替身。
 * 产品维度：防止输入触发菜单用户流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { describe, expect, it } from 'vitest'
import type { MenuState, TriggerHit } from '../src/core/contract.ts'
import { exactMatch, MENU_CLOSED, menuReduce, seedGroups } from '../src/core/menu.ts'

/** 中文说明：测试局部值 hit，由紧邻初始化决定。 */
const hit = (query = ''): TriggerHit => ({
  trigger: '/',
  query,
  quoted: false,
  position: 'leading',
  span: { start: 0, end: 1 + query.length, draftRev: 1 },
})

/** Seed sources onto the closed state and open a first generation. */
/** 中文说明：函数 open 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function open(sources: readonly string[], h: TriggerHit = hit()): MenuState {
  return menuReduce(seedGroups(MENU_CLOSED, sources.map(name => ({ name }))), { type: 'hit', hit: h })
}

/** 中文说明：测试局部值 item，由紧邻初始化决定。 */
const item = (name: string) => ({ name })

describe('menuReduce hit', () => {
  it('opens a new generation with all groups pending', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    const s = open(['command', 'skill'])
    expect(s.open).toBe(true)
    expect(s.generation).toBe(1)
    expect(s.groups).toEqual([
      { source: 'command', status: 'pending', items: [] },
      { source: 'skill', status: 'pending', items: [] },
    ])
    expect(s.highlight).toBeNull()
  })

  it('re-hit resets ready groups to pending under a bumped generation', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command'])
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'command', items: [item('goal')] })
    s = menuReduce(s, { type: 'hit', hit: hit('g') })
    expect(s.generation).toBe(2)
    expect(s.groups).toEqual([{ source: 'command', status: 'pending', items: [] }])
    expect(s.highlight).toBeNull()
  })

  it('preserves a hidden group title through re-hit and settlement', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = menuReduce(seedGroups(MENU_CLOSED, [{ name: 'reference', showGroupTitle: false }]), { type: 'hit', hit: hit() })
    expect(s.groups[0]).toMatchObject({ source: 'reference', showGroupTitle: false, status: 'pending' })
    s = menuReduce(s, { type: 'hit', hit: hit('r') })
    s = menuReduce(s, { type: 'source-settled', generation: 2, source: 'reference', items: [item('README.md')] })
    expect(s.groups[0]).toMatchObject({ source: 'reference', showGroupTitle: false, status: 'ready' })
  })

  it('null hit closes; closing an already-closed state is a no-op reference', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    const s = open(['command'])
    /** 中文说明：测试局部值 c，由紧邻初始化决定。 */
    const c = menuReduce(s, { type: 'hit', hit: null })
    expect(c.open).toBe(false)
    expect(c.groups).toEqual([])
    expect(menuReduce(c, { type: 'hit', hit: null })).toBe(c)
  })
})

describe('menuReduce source-settled', () => {
  it('marks the group ready and highlights the first item', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command', 'skill'])
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'skill', items: [item('commit')] })
    expect(s.groups[1]).toEqual({ source: 'skill', status: 'ready', items: [item('commit')] })
    expect(s.groups[0]!.status).toBe('pending')
    expect(s.highlight).toEqual({ source: 'skill', index: 0 })
  })

  it('keeps an existing valid highlight when a later group settles', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command', 'skill'])
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'skill', items: [item('commit')] })
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'command', items: [item('goal')] })
    expect(s.highlight).toEqual({ source: 'skill', index: 0 })
  })

  it('drops settlements from a stale generation by reference', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command'])
    s = menuReduce(s, { type: 'hit', hit: hit('g') }) // generation 2
    /** 中文说明：测试局部值 next，由紧邻初始化决定。 */
    const next = menuReduce(s, { type: 'source-settled', generation: 1, source: 'command', items: [item('goal')] })
    expect(next).toBe(s)
  })

  it('drops settlements while closed and for unknown sources by reference', () => {
    /** 中文说明：测试局部值 closed，由紧邻初始化决定。 */
    const closed = menuReduce(open(['command']), { type: 'close' })
    expect(menuReduce(closed, { type: 'source-settled', generation: 1, source: 'command', items: [] })).toBe(closed)
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    const s = open(['command'])
    expect(menuReduce(s, { type: 'source-settled', generation: 1, source: 'ghost', items: [] })).toBe(s)
  })

  it('treats omitted items as empty', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command', 'skill'])
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'command' })
    expect(s.groups[0]).toEqual({ source: 'command', status: 'ready', items: [] })
    expect(s.open).toBe(true) // skill still pending
  })

  it('auto-closes when every group settles ready and empty', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command', 'skill'])
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'command', items: [] })
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'skill', items: [] })
    expect(s.open).toBe(false)
    expect(s.groups).toEqual([])
  })

  it('stays open when one group is empty but another has items', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command', 'skill'])
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'command', items: [] })
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'skill', items: [item('commit')] })
    expect(s.open).toBe(true)
    expect(s.highlight).toEqual({ source: 'skill', index: 0 })
  })
})

describe('menuReduce source-failed', () => {
  it('silently removes the failed group', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command', 'skill'])
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'skill', items: [item('commit')] })
    s = menuReduce(s, { type: 'source-failed', generation: 1, source: 'command' })
    expect(s.groups.map(g => g.source)).toEqual(['skill'])
    expect(s.open).toBe(true)
  })

  it('closes when the last group fails', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command'])
    s = menuReduce(s, { type: 'source-failed', generation: 1, source: 'command' })
    expect(s.open).toBe(false)
  })

  it('closes when the surviving groups are all ready and empty', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command', 'skill'])
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'skill', items: [] })
    s = menuReduce(s, { type: 'source-failed', generation: 1, source: 'command' })
    expect(s.open).toBe(false)
  })

  it('moves the highlight off the failed group', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command', 'skill'])
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'command', items: [item('goal')] })
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'skill', items: [item('commit')] })
    expect(s.highlight).toEqual({ source: 'command', index: 0 })
    s = menuReduce(s, { type: 'source-failed', generation: 1, source: 'command' })
    expect(s.highlight).toEqual({ source: 'skill', index: 0 })
  })

  it('drops stale-generation and unknown-source failures by reference', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    const s = open(['command'])
    expect(menuReduce(s, { type: 'source-failed', generation: 0, source: 'command' })).toBe(s)
    expect(menuReduce(s, { type: 'source-failed', generation: 1, source: 'ghost' })).toBe(s)
  })
})

describe('menuReduce move', () => {
  /** Two ready groups: command [goal, model], skill [commit]. */
  /** 中文说明：函数 ready 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function ready(): MenuState {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command', 'skill'])
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'command', items: [item('goal'), item('model')] })
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'skill', items: [item('commit')] })
    return s
  }

  it('cycles forward across groups and wraps', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = ready()
    s = menuReduce(s, { type: 'move', dir: 1 })
    expect(s.highlight).toEqual({ source: 'command', index: 1 })
    s = menuReduce(s, { type: 'move', dir: 1 })
    expect(s.highlight).toEqual({ source: 'skill', index: 0 })
    s = menuReduce(s, { type: 'move', dir: 1 })
    expect(s.highlight).toEqual({ source: 'command', index: 0 })
  })

  it('cycles backward and wraps to the last item', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = ready()
    s = menuReduce(s, { type: 'move', dir: -1 })
    expect(s.highlight).toEqual({ source: 'skill', index: 0 })
  })

  it('skips pending groups', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command', 'skill'])
    s = menuReduce(s, { type: 'source-settled', generation: 1, source: 'skill', items: [item('commit')] })
    s = menuReduce(s, { type: 'move', dir: 1 })
    expect(s.highlight).toEqual({ source: 'skill', index: 0 })
  })

  it('enters from null highlight at either end', () => {
    /** 中文说明：测试局部值 base，由紧邻初始化决定。 */
    const base = { ...ready(), highlight: null }
    expect(menuReduce(base, { type: 'move', dir: 1 }).highlight).toEqual({ source: 'command', index: 0 })
    expect(menuReduce(base, { type: 'move', dir: -1 }).highlight).toEqual({ source: 'skill', index: 0 })
  })

  it('is a no-op reference when closed, without positions, or single-item', () => {
    /** 中文说明：测试局部值 closed，由紧邻初始化决定。 */
    const closed = menuReduce(ready(), { type: 'close' })
    expect(menuReduce(closed, { type: 'move', dir: 1 })).toBe(closed)
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = open(['command'])
    expect(menuReduce(pending, { type: 'move', dir: 1 })).toBe(pending)
    /** 中文说明：测试局部值 single，由紧邻初始化决定。 */
    let single = open(['command'])
    single = menuReduce(single, { type: 'source-settled', generation: 1, source: 'command', items: [item('goal')] })
    expect(menuReduce(single, { type: 'move', dir: 1 })).toBe(single)
  })
})

describe('menuReduce close', () => {
  it('clears everything but keeps the generation for stale-drop', () => {
    /** 中文说明：测试局部值 s，由紧邻初始化决定。 */
    let s = open(['command'])
    s = menuReduce(s, { type: 'close' })
    expect(s).toMatchObject({ open: false, hit: null, groups: [], highlight: null, generation: 1 })
  })
})

describe('exactMatch', () => {
  /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
  const groups: MenuState['groups'] = [
    { source: 'command', status: 'ready', items: [item('goal'), item('model')] },
    { source: 'skill', status: 'pending', items: [] },
  ]

  it('finds an exact name in a ready group', () => {
    expect(exactMatch(groups, 'command', 'model')).toEqual(item('model'))
  })

  it('returns null on name miss, non-ready group, and unknown source', () => {
    expect(exactMatch(groups, 'command', 'goa')).toBeNull()
    expect(exactMatch(groups, 'skill', 'commit')).toBeNull()
    expect(exactMatch(groups, 'ghost', 'goal')).toBeNull()
  })
})
