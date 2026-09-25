/** 真实 Client 装配验证协议失败后的实例替换及新增基线。 */
import { afterEach, expect, vi } from 'vitest'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'

const SELF = '@deepseek-ai/dsh-api-session-controller'
const it = createClientTest({ roster: webApp.closure([SELF]) })
afterEach(() => { vi.restoreAllMocks() })

it('recovers a terminal protocol failure with one replacement control consumer', async ({ mock, start }) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const client = await start()
  const control = client.ctx.sessions.control
  await vi.waitFor(() => { expect(control.state.getSnapshot()).toEqual({ phase: 'ready', baseline: 1 }) })
  // 重复基线由真实 RemoteSnapshotStream 拒绝，不直接伪造 UI 失败状态。
  mock.streams.push('session/control', { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } })
  await vi.waitFor(() => { expect(control.state.getSnapshot().phase).toBe('failed') })
  const retry = control.retry()
  expect(control.retry()).toBe(retry)
  await retry
  await vi.waitFor(() => { expect(control.state.getSnapshot()).toEqual({ phase: 'ready', baseline: 2 }) })
  expect(mock.log.streams('session/control')).toHaveLength(2)
  await client.unload(SELF)
  expect(control.state.getSnapshot().phase).toBe('disposed')
  await control.retry()
  expect(mock.log.streams('session/control')).toHaveLength(2)
}, 60_000)
