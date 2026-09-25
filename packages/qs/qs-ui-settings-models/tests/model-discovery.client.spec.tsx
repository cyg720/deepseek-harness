// @vitest-environment jsdom
/** 发现请求、候选采用和过期响应隔离，均不隐式触发配置或凭据写入。 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ModelsOperations } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { ModelDiscovery, type ModelDiscoveryProps } from '../src/client/ModelDiscovery.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function fixture() {
  const discoverModels = vi.fn<ModelsOperations['discoverModels']>().mockResolvedValue({ kind: 'found', models: [
    { id: 'known', name: 'Known' }, { id: 'new', name: '<img src=x>', contextWindow: 1000 }, { id: 'third' }, { id: 'third' },
  ] })
  const writeSettings = vi.fn(), storeCredential = vi.fn()
  const operations: ModelsOperations = { discoverModels, writeSettings, storeCredential,
    removeCredential: vi.fn(), describeCredential: vi.fn() }
  const onAdopt = vi.fn()
  const props: ModelDiscoveryProps = { namespace: 'llm-pi-ai', request: { provider: 'route', baseURL: 'https://draft.example', apiKey: 'fixture-key' },
    operations, known: new Set(['known']), disabled: false, t: key => zh[key], onAdopt }
  return { props, discoverModels, writeSettings, storeCredential, onAdopt }
}
function query() { fireEvent.click(screen.getByRole('button', { name: zh.discoverModels })) }
function adopt() { fireEvent.click(screen.getByRole('button', { name: zh.adoptModels })) }

it('请求使用草稿字段，候选去重且仅明确添加时传出新模型', async () => {
  const f = fixture(), node = render(<ModelDiscovery {...f.props} />); query()
  await screen.findByText(zh.modelAlreadyAdded)
  expect(f.discoverModels).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', f.props.request)
  expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /^Known/ }).disabled).toBe(true)
  expect(node.container.querySelector('img')).toBeNull(); expect(f.onAdopt).not.toHaveBeenCalled()
  adopt(); expect(f.onAdopt).toHaveBeenCalledExactlyOnceWith([
    { id: 'new', name: '<img src=x>', contextWindow: 1000 }, { id: 'third' },
  ])
  expect(f.writeSettings).not.toHaveBeenCalled(); expect(f.storeCredential).not.toHaveBeenCalled()
})

it('筛选批量选择不清除隐藏项，单选可撤销，关闭不采用', async () => {
  const f = fixture(); render(<ModelDiscovery {...f.props} />); query(); await screen.findByText(zh.modelAlreadyAdded)
  fireEvent.change(screen.getByLabelText(zh.filterModels), { target: { value: 'new' } })
  fireEvent.click(screen.getByRole('button', { name: zh.toggleVisibleModels }))
  fireEvent.click(screen.getByRole('button', { name: zh.toggleVisibleModels }))
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByLabelText(zh.filterModels), { target: { value: 'missing' } })
  expect(screen.getByText(zh.noModelMatches)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(zh.filterModels), { target: { value: '<img' } })
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  adopt(); expect(f.onAdopt.mock.calls[0]![0]).toHaveLength(2)
  query(); await screen.findByText(zh.modelAlreadyAdded)
  fireEvent.click(screen.getByRole('button', { name: zh.dismissCandidates })); expect(f.onAdopt).toHaveBeenCalledOnce()
})

it.each(['refused', 'transport', 'empty'] as const)('发现 %s 提示可见且可重试，不泄露诊断', async (kind) => {
  const f = fixture()
  if (kind === 'transport') f.discoverModels.mockRejectedValueOnce(new Error('private-key'))
  else f.discoverModels.mockResolvedValueOnce(kind === 'empty' ? { kind: 'found', models: [] } : { kind: 'refused', message: 'private-key' })
  const node = render(<ModelDiscovery {...f.props} />); query()
  await screen.findByText(kind === 'empty' ? zh.discoveryEmpty : zh.discoveryFailed)
  expect(node.container.textContent).not.toContain('private-key')
  query(); await screen.findByText(zh.modelAlreadyAdded)
  expect(f.discoverModels).toHaveBeenCalledTimes(2)
})

it.each([false, true])('请求字段变化后，旧请求拒绝=%s 不污染新查询', async (reject) => {
  const f = fixture(), gate = Promise.withResolvers<Awaited<ReturnType<ModelsOperations['discoverModels']>>>()
  f.discoverModels.mockReturnValueOnce(gate.promise)
  const node = render(<ModelDiscovery {...f.props} />); query()
  node.rerender(<ModelDiscovery {...f.props} request={{ provider: 'another', baseURL: 'https://next.example' }} />)
  query(); await screen.findByText(zh.modelAlreadyAdded)
  await act(async () => {
    if (reject) gate.reject(new Error('private-key')); else gate.resolve({ kind: 'found', models: [{ id: 'stale' }] })
    await Promise.allSettled([gate.promise])
  })
  expect(screen.queryByText('stale')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText(zh.modelAlreadyAdded)).toBeTruthy()
})

it('卸载后发现结果不采用，草稿中途已添加的模型不重复采用', async () => {
  const f = fixture(), node = render(<ModelDiscovery {...f.props} />)
  query(); await screen.findByText(zh.modelAlreadyAdded)
  node.rerender(<ModelDiscovery {...f.props} known={new Set(['known', 'new', 'third'])} />)
  adopt(); expect(f.onAdopt).toHaveBeenCalledWith([])
  const gate = Promise.withResolvers<Awaited<ReturnType<ModelsOperations['discoverModels']>>>()
  f.discoverModels.mockReturnValueOnce(gate.promise); query(); node.unmount()
  await act(async () => { gate.resolve({ kind: 'found', models: [{ id: 'late' }] }); await gate.promise })
  expect(f.onAdopt).toHaveBeenCalledOnce()
})
