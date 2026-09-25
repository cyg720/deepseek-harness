// @vitest-environment jsdom
/** 原生副作用只按请求身份启动，组件重放和迟到回调不会重复采纳。 */
import { StrictMode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeDirectoryFlow } from '../src/client/flow.ts'

afterEach(cleanup)
function fixture() {
  const pending = Promise.withResolvers<string | null>()
  const props = { request: Symbol('request'), open: true, busy: false,
    pick: vi.fn(() => pending.promise), onPicked: vi.fn(), onCancel: vi.fn(), onError: vi.fn() }
  return { props, pending }
}
it('opens once through StrictMode and reports through the current handlers for that request', async () => {
  const f = fixture()
  const view = render(<StrictMode><NativeDirectoryFlow {...f.props} /></StrictMode>)
  await act(async () => {})
  expect(f.props.pick).toHaveBeenCalledOnce()
  const onPicked = vi.fn(), replacementPick = vi.fn()
  view.rerender(<StrictMode><NativeDirectoryFlow {...f.props} busy onPicked={onPicked} pick={replacementPick} /></StrictMode>)
  await act(async () => { f.pending.resolve('/host/project') })
  expect(onPicked).toHaveBeenCalledExactlyOnceWith('/host/project')
  expect(f.props.onPicked).not.toHaveBeenCalled()
  expect(replacementPick).not.toHaveBeenCalled()
})
it.each([null, new Error('denied'), 'offline'])('reports native cancellation or failure %s', async (outcome) => {
  const f = fixture()
  render(<NativeDirectoryFlow {...f.props} />)
  await act(async () => { if (outcome === null) f.pending.resolve(null); else f.pending.reject(outcome) })
  expect(f.props.onPicked).not.toHaveBeenCalled()
  if (outcome === null) expect(f.props.onCancel).toHaveBeenCalledOnce()
  else expect(f.props.onError).toHaveBeenCalledExactlyOnceWith(outcome instanceof Error ? outcome.message : outcome)
})
it.each(['resolve', 'reject'] as const)('rejects old native %s after another request starts', async (outcome) => {
  const old = fixture(), next = fixture()
  const view = render(<NativeDirectoryFlow {...old.props} />)
  await act(async () => {})
  view.rerender(<NativeDirectoryFlow {...next.props} />)
  await act(async () => {
    if (outcome === 'resolve') old.pending.resolve('/old')
    else old.pending.reject(new Error('old failure'))
    next.pending.resolve('/new')
  })
  expect(old.props.onPicked).not.toHaveBeenCalled(); expect(old.props.onError).not.toHaveBeenCalled()
  expect(next.props.onPicked).toHaveBeenCalledExactlyOnceWith('/new')
})
it('withdraws an open chooser, rearms on reopen, and ignores settlements after unmount', async () => {
  const f = fixture()
  const view = render(<NativeDirectoryFlow {...f.props} open={false} />)
  await act(async () => {})
  expect(f.props.pick).not.toHaveBeenCalled()
  view.rerender(<NativeDirectoryFlow {...f.props} />)
  await act(async () => {})
  view.rerender(<NativeDirectoryFlow {...f.props} open={false} />)
  await act(async () => { f.pending.resolve('/withdrawn') })
  expect(f.props.onPicked).not.toHaveBeenCalled()
  const next = fixture()
  view.rerender(<NativeDirectoryFlow {...next.props} />)
  await act(async () => {})
  view.unmount()
  await act(async () => { next.pending.reject(new Error('unmounted')) })
  expect(next.props.onError).not.toHaveBeenCalled()
})

it('does not reopen the OS picker when mounted while the owner adopts a directory', async () => {
  const f = fixture()
  const view = render(<NativeDirectoryFlow {...f.props} busy />)
  await act(async () => {})
  expect(f.props.pick).not.toHaveBeenCalled()
  view.rerender(<NativeDirectoryFlow {...f.props} request={Symbol('new request')} />)
  await act(async () => { f.pending.resolve(null) })
  expect(f.props.pick).toHaveBeenCalledOnce()
  expect(f.props.onCancel).toHaveBeenCalledOnce()
})
