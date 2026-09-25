// @vitest-environment jsdom
/** 预设控件只消费镜像值，保存失败与迟到回执不能伪造已生效状态。 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PolicyControls, type PolicyControlsProps } from '../src/client/PolicyControls.tsx'
import type { QsPresetPolicyResult } from '../src/client/policy.ts'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
function fixture() {
  const save = vi.fn<PolicyControlsProps['policy']['save']>().mockResolvedValue('written')
  const refresh = vi.fn(async () => {})
  const props: PolicyControlsProps = {
    settings: { status: 'ready', error: null, view: { writable: true, hasDocument: true, namespaces: [{ ns: 'agent-presets', revision: 4, schema: {}, value: { default: 'standard', modeSelectionEnabled: true }, applies: 'live', secrets: [] }] } },
    roster: { modeSelectionEnabled: true, authorable: false, presets: [{ id: 'standard', trust: 'system', isDefault: true }, { id: 'custom', name: 'Custom', trust: 'user', isDefault: false }, { id: 'broken', trust: 'user', isDefault: false, broken: 'private' }] },
    policy: { save, reset: vi.fn(), dispose: vi.fn() }, refresh, t: key => zh[key],
  }
  return { props, save, refresh }
}
it('下拉框提交机器值和版本，开关提交布尔值，损坏预设不可选', async () => {
  const f = fixture(); render(<PolicyControls {...f.props} />)
  expect(screen.getByRole<HTMLOptionElement>('option', { name: 'broken' }).disabled).toBe(true)
  await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } }) })
  expect(f.save).toHaveBeenLastCalledWith({ field: 'default', value: 'custom' }, 4)
  expect(f.refresh).toHaveBeenCalledOnce()
  expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('standard')
  await act(async () => { fireEvent.click(screen.getByRole('checkbox')) })
  expect(f.save).toHaveBeenLastCalledWith({ field: 'modeSelectionEnabled', value: false }, 4)
})
it('失败不刷新目录，保存中阻止重复提交，卸载后的结果不刷新新页面', async () => {
  const f = fixture(), mounted = render(<PolicyControls {...f.props} />)
  for (const outcome of ['conflict', 'refused', 'busy', 'syncFailed', 'inactive'] as const) {
    f.save.mockResolvedValueOnce(outcome)
    await act(async () => { fireEvent.click(screen.getByRole('checkbox')) })
    if (outcome !== 'inactive') expect(screen.getByRole('status').textContent).toBe(zh[outcome])
    else expect(screen.queryByRole('status')).toBeNull()
  }
  let finish!: (value: QsPresetPolicyResult) => void
  f.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } })
  expect(f.save).toHaveBeenCalledTimes(6)
  mounted.unmount()
  await act(async () => { finish('written') })
  expect(f.refresh).not.toHaveBeenCalled()
})
it('只读和关闭选择器保持限制，缺失与畸形描述不产生可写表单', () => {
  const f = fixture(), mounted = render(<PolicyControls {...f.props} />)
  const document = f.props.settings.view!
  const namespace = document.namespaces[0]!
  mounted.rerender(<PolicyControls {...f.props} settings={{ ...f.props.settings, view: { ...document, writable: false } }} />)
  expect(screen.getByRole('status').textContent).toBe(zh.readonly)
  expect(screen.getByRole<HTMLSelectElement>('combobox').disabled).toBe(true)
  mounted.rerender(<PolicyControls {...f.props} settings={{ ...f.props.settings, view: { ...document, namespaces: [{ ...namespace, value: { default: 'missing', modeSelectionEnabled: false } }] } }} />)
  expect(screen.getByRole<HTMLOptionElement>('option', { name: 'missing' }).disabled).toBe(true)
  expect(screen.getByRole<HTMLSelectElement>('combobox').disabled).toBe(true)
  expect(screen.getByText(zh.pickerOff)).toBeTruthy()
  for (const settings of [
    { ...f.props.settings, status: 'loading' as const },
    { ...f.props.settings, error: 'private' },
    { ...f.props.settings, view: undefined },
    { ...f.props.settings, view: { ...document, namespaces: [] } },
    ...[null, {}, { default: 1 }, { default: 'standard', modeSelectionEnabled: 'true' }].map(value => ({ ...f.props.settings, view: { ...document, namespaces: [{ ...namespace, value }] } })),
  ]) {
    mounted.rerender(<PolicyControls {...f.props} settings={settings} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(zh.policyUnavailable)
  }
  expect(f.save).not.toHaveBeenCalled()
})
