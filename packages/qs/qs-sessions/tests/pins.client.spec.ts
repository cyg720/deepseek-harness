import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createQsPinsStore, groupSessions } from '../src/client/pins-store.ts'

const id = (value: string): SessionId => value as SessionId

describe('会话分组', () => {
  it('置顶进置顶组，其余进最近组，各自保持服务端顺序', () => {
    const groups = groupSessions({
      ids: [id('a'), id('b'), id('c')],
      titles: { a: '甲', b: '乙', c: '丙' },
      running: new Set([id('b')]),
      pinned: [id('c')],
      archived: [],
    })
    expect(groups.pinned.map(row => row.id)).toEqual([id('c')])
    expect(groups.recent.map(row => row.id)).toEqual([id('a'), id('b')])
    expect(groups.recent[1]?.running).toBe(true)
  })

  it('归档集合同时从两组里排除（归档后不得仍显示）', () => {
    const groups = groupSessions({
      ids: [id('a'), id('b')],
      titles: { a: '甲', b: '乙' },
      running: new Set<SessionId>(),
      pinned: [id('b')],
      archived: [id('b')],
    })
    expect(groups.pinned).toEqual([])
    expect(groups.recent.map(row => row.id)).toEqual([id('a')])
  })

  it('标题缺失时退回会话 id', () => {
    const groups = groupSessions({
      ids: [id('x')],
      titles: {},
      running: new Set<SessionId>(),
      pinned: [],
      archived: [],
    })
    expect(groups.recent[0]?.title).toBe('x')
  })
})

/** 置顶操作只调整目标身份，不影响其他会话的顺序。 */
it('切换和归档清理置顶时保持其他会话', () => {
  const store = createQsPinsStore().create()
  expect(store.getSnapshot().pinned).toEqual([])
  store.actions.toggle(id('a')); store.actions.toggle(id('b'))
  expect(store.getSnapshot().pinned).toEqual([id('a'), id('b')])
  store.actions.toggle(id('a'))
  expect(store.getSnapshot().pinned).toEqual([id('b')])
  store.actions.forget(id('missing'))
  expect(store.getSnapshot().pinned).toEqual([id('b')])
  store.actions.forget(id('b'))
  expect(store.getSnapshot().pinned).toEqual([])
})
