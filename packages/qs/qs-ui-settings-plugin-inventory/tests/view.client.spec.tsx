// @vitest-environment jsdom
/** 真实快照字段覆盖搜索、预设切换、空态与迟到读取隔离。 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { Inventory, type InventoryProps } from '../src/client/Inventory.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
const translate = (key: keyof typeof zh, vars?: Record<string, string | number>) =>
  Object.entries(vars ?? {}).reduce<string>((s, [k, v]) => s.replace(`{${k}}`, String(v)), zh[key])
const props = (list: () => Promise<PluginInventorySnapshot>): InventoryProps => ({
  list, presetName: preset => preset.name ?? preset.id, t: translate,
}) as InventoryProps
const entry = (id: string, phase: PluginInventorySnapshot['entries'][number]['fiberPhase'], enabled = true) => ({ entryId: id as PluginInventorySnapshot['entries'][number]['entryId'], moduleName: `module-${id}`, enabled, fiberPhase: phase })
it('显示失败优先的全局状态并区分未知状态，搜索无结果及空目录', async () => {
  const snapshot: PluginInventorySnapshot = { entries: [entry('idle', null, false), entry('active', 'active'), entry('failed', 'failed'), entry('waiting', 'pending'), entry('loading', 'loading'), entry('unloading', 'unloading')] }
  const view = render(<Inventory {...props(async () => snapshot)} />)
  await screen.findByLabelText(zh.search)
  expect(view.container.querySelector('[data-plugin-entry]')?.getAttribute('data-plugin-entry')).toBe('failed')
  expect(screen.getByText(zh.unobserved)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(zh.search), { target: { value: ' NO-MATCH ' } })
  expect(screen.getByText(zh.emptySearch)).toBeTruthy()
  view.rerender(<Inventory {...props(async () => ({ entries: [] }))} />)
  fireEvent.change(screen.getByLabelText(zh.search), { target: { value: '' } })
  await screen.findByText(zh.empty)
})
it('预设条件只作文本，搜索跨预设定位并显示损坏预设', async () => {
  const snapshot: PluginInventorySnapshot = { entries: [entry('shared', null, false), entry('bad', 'failed')], agentPresets: [
    { id: 'standard', trust: 'system', isDefault: true, rows: [{ entryId: null, moduleName: 'module-shared', enabled: true, fiberPhase: 'active' }] },
    { id: 'custom', name: '自定义', trust: 'user', isDefault: false, rows: [
      { entryId: 'conditional', moduleName: 'needle', enabled: 'conditional', fiberPhase: null, condition: '<script>throw 1</script>' },
      { entryId: 'disabled', moduleName: 'off', enabled: false, fiberPhase: null },
      { entryId: 'failed', moduleName: 'module-bad', enabled: true, fiberPhase: 'failed' },
    ] },
    { id: 'broken', trust: 'user', isDefault: false, broken: '无法读取预设', rows: [] },
  ] }
  const view = render(<Inventory {...props(async () => snapshot)} />)
  await screen.findByLabelText(zh.search)
  expect(screen.getByText(zh.presetEnabledTag)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(zh.search), { target: { value: 'needle' } })
  fireEvent.click(screen.getByRole('button', { name: /去预设分组查看.*自定义/ }))
  expect(screen.getByText('<script>throw 1</script>')).toBeTruthy(); expect(view.container.querySelector('script')).toBeNull()
  fireEvent.change(screen.getByLabelText(zh.search), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText(zh.switcherLabel), { target: { value: 'standard' } })
  fireEvent.click(screen.getByRole('button', { name: /去预设分组查看.*自定义/ }))
  fireEvent.change(screen.getByLabelText(zh.switcherLabel), { target: { value: 'broken' } })
  expect(screen.getByRole('alert').textContent).toBe('无法读取预设')
  view.rerender(<Inventory {...props(async () => ({ entries: [], agentPresets: [snapshot.agentPresets![1]!] }))} />)
  await waitFor(() => { expect(screen.getByLabelText<HTMLSelectElement>(zh.switcherLabel).value).toBe('custom') })
})
it('读取失败可重试，旧读取成功和失败都不污染新实例', async () => {
  let resolve!: (value: PluginInventorySnapshot) => void
  const old = new Promise<PluginInventorySnapshot>((done) => { resolve = done })
  const view = render(<Inventory {...props(() => old)} />)
  const list = vi.fn<() => Promise<PluginInventorySnapshot>>().mockRejectedValueOnce(new Error('private-error')).mockResolvedValue({ entries: [] })
  view.rerender(<Inventory {...props(list)} />)
  await screen.findByRole('alert'); expect(screen.queryByText('private-error')).toBeNull()
  await act(async () => { resolve({ entries: [entry('old', 'active')] }); await old })
  expect(screen.getByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.retry })); await screen.findByText(zh.empty)
  let reject!: (reason: Error) => void
  const late = new Promise<PluginInventorySnapshot>((_done, fail) => { reject = fail })
  view.rerender(<Inventory {...props(() => late)} />)
  view.unmount()
  await act(async () => { reject(new Error('late')); await Promise.resolve() })
})
