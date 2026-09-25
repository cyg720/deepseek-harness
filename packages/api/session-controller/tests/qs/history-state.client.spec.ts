/** QS 分页通过真实 Client Remote 验证失败状态，不让组件猜测吞掉的异常。 */
import { expect } from 'vitest'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionPage } from '../../src/types.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { sessionBench } from '../remote/bench.client.ts'
import { FOLLOW, followScript, history, pageRule, err } from '../remote/session.client.ts'
import { plainTurn } from '../event-script.client.ts'

const it = createClientTest({ roster: webApp.closure(['@deepseek-ai/dsh-api-gateway']) })
const id = 'qs-history-state' as SessionId

it('分页失败保留窗口，手动重试发布成功和进展', async ({ mock, start }) => {
  const session = await sessionBench(mock, start, id)
  mock.stream(FOLLOW, followScript(history(plainTurn(SessionSeq(6), 1, 'new', 'answer'), true)))
  await session.open()
  const before = session.eventSource.getSnapshot().entries
  mock.remote.session.page.mockImplementation(pageRule(err(new RemoteError('session/not-found', 'blocked', { sessionId: id }))))
  await session.loadOlder()
  expect(session.getSnapshot().historyLoad).toMatchObject({ phase: 'failed', kind: 'older' })
  expect(session.eventSource.getSnapshot().entries).toEqual(before)
  mock.remote.session.page.mockImplementation(pageRule(history(plainTurn(SessionSeq(0), 0, 'old', 'answer'))))
  await session.loadOlder()
  expect(session.getSnapshot().historyLoad).toMatchObject({ phase: 'succeeded', progressed: true, hasMore: false })
}, 60_000)

it('跳转分页失败同样可观察，重连撤销旧请求身份', async ({ mock, start }) => {
  const session = await sessionBench(mock, start, id)
  mock.stream(FOLLOW, followScript(history(plainTurn(SessionSeq(6), 1, 'new', 'answer'), true)))
  await session.open()
  mock.remote.session.page.mockImplementation(pageRule(err(new RemoteError('session/not-found', 'blocked', { sessionId: id }))))
  await session.loadThrough(SessionSeq(0))
  expect(session.getSnapshot().historyLoad).toMatchObject({ phase: 'failed', kind: 'through', targetSeq: 0 })
  await session.resync()
  expect(session.getSnapshot().historyLoad).toMatchObject({ phase: 'cancelled' })
  expect(session.getSnapshot().loadingOlder).toBe(false)
})

// 使用可控回包排序，不靠计时器猜测重连与旧 finally 的先后。
it('重连后旧分页结算不能清除新分页的 busy 和请求身份', async ({ mock, start }) => {
  const session = await sessionBench(mock, start, id)
  mock.stream(FOLLOW, followScript(history(plainTurn(SessionSeq(12), 2, 'new', 'answer'), true)))
  await session.open()
  const old = Promise.withResolvers<RemoteResult<SessionPage>>()
  mock.remote.session.page.mockReturnValueOnce(old.promise)
  const first = session.loadOlder()
  const firstState = session.getSnapshot().historyLoad
  await session.resync()
  const fresh = Promise.withResolvers<RemoteResult<SessionPage>>()
  mock.remote.session.page.mockReturnValueOnce(fresh.promise)
  const second = session.loadOlder()
  const freshState = session.getSnapshot().historyLoad
  expect(freshState).toMatchObject({ phase: 'loading' })
  expect(freshState).not.toEqual(firstState)
  old.resolve(history(plainTurn(SessionSeq(6), 1, 'old', 'answer'), true))
  await first
  expect(session.getSnapshot().historyLoad).toEqual(freshState)
  expect(session.getSnapshot().loadingOlder).toBe(true)
  fresh.resolve(history(plainTurn(SessionSeq(6), 1, 'current', 'answer'), true))
  await second
  expect(session.getSnapshot().historyLoad).toMatchObject({ phase: 'succeeded', progressed: true })
})

it('空页声明还有历史时只请求一次，并明确报告无进展', async ({ mock, start }) => {
  const session = await sessionBench(mock, start, id)
  mock.stream(FOLLOW, followScript(history(plainTurn(SessionSeq(12), 2, 'new', 'answer'), true)))
  await session.open()
  mock.remote.session.page.mockImplementation(pageRule(history([], true)))
  await session.loadThrough(SessionSeq(0))
  expect(session.getSnapshot().historyLoad).toMatchObject({ phase: 'succeeded', progressed: false, hasMore: true })
  expect(mock.remote.session.page).toHaveBeenCalledTimes(1)
})

it('合并跳转保留同一个请求身份并公开最低目标', async ({ mock, start }) => {
  const session = await sessionBench(mock, start, id)
  mock.stream(FOLLOW, followScript(history(plainTurn(SessionSeq(12), 2, 'new', 'answer'), true)))
  await session.open()
  const held = Promise.withResolvers<RemoteResult<SessionPage>>()
  mock.remote.session.page.mockReturnValueOnce(held.promise)
  const first = session.loadThrough(SessionSeq(6))
  const original = session.getSnapshot().historyLoad
  const second = session.loadThrough(SessionSeq(0))
  expect(second).toBe(first)
  expect(session.getSnapshot().historyLoad).toEqual({ ...original, targetSeq: 0 })
  held.resolve(history([], true))
  await first
  expect(session.getSnapshot().historyLoad).toMatchObject({ phase: 'succeeded', kind: 'through', targetSeq: 0, progressed: false })
  expect(mock.remote.session.page).toHaveBeenCalledTimes(1)
})

// 载体自动重连不调用 Session.resync，仍必须废弃旧分页并允许新请求占用状态。
for (const kind of ['older', 'through'] as const) it(`物理重连隔离在途 ${kind} 分页与新请求`, async ({ mock, start }) => {
  const session = await sessionBench(mock, start, id)
  mock.stream(FOLLOW, followScript(history(plainTurn(SessionSeq(12), 2, 'new', 'answer'), true)))
  await session.open()
  const old = Promise.withResolvers<RemoteResult<SessionPage>>()
  const current = Promise.withResolvers<RemoteResult<SessionPage>>()
  try {
    mock.remote.session.page.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const first = kind === 'older' ? session.loadOlder() : session.loadThrough(SessionSeq(0))
    const oldState = session.getSnapshot().historyLoad
    mock.streams.fail(FOLLOW, new RemoteStreamCarrierError('controlled carrier replacement'))
    await expect.poll(() => session.getSnapshot().historyLoad.phase).toBe('cancelled')
    expect(session.getSnapshot().loadingOlder).toBe(false)
    const second = session.loadOlder()
    const newState = session.getSnapshot().historyLoad
    expect(newState).toMatchObject({ phase: 'loading' })
    expect(newState).not.toEqual(oldState)
    old.resolve(history(plainTurn(SessionSeq(6), 1, 'stale', 'answer'), false))
    await first
    expect(session.getSnapshot().historyLoad).toEqual(newState)
    expect(session.getSnapshot().loadingOlder).toBe(true)
    expect(session.getSnapshot().hasMore).toBe(true)
    current.resolve(history(plainTurn(SessionSeq(6), 1, 'current', 'answer'), true))
    await second
    expect(session.getSnapshot().historyLoad).toMatchObject({ phase: 'succeeded', progressed: true })
  } finally {
    old.resolve(history([], true))
    current.resolve(history([], true))
  }
})
