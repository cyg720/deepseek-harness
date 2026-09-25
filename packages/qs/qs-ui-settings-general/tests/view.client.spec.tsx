// @vitest-environment jsdom
/** 模态焦点、动态分区与异步打开仅使用当前实例。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SettingsOnboardingOwnerProps, SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Settings, General } from '../src/client/Settings.tsx'
import { DocumentAction, type DocumentProps } from '../src/client/DocumentAction.tsx'
import type { SettingsProps, GeneralProps, SettingsEntry } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
const originals = ['showModal', 'close'].map(key => [key, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key)] as const)
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')) } })
})
afterEach(() => {
  cleanup()
  for (const [key, descriptor] of originals) {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLDialogElement.prototype, key)
    else Object.defineProperty(HTMLDialogElement.prototype, key, descriptor)
  }
})
const ready: SettingsMirrorSnapshot = { status: 'ready', view: { namespaces: [], writable: true, hasDocument: true }, error: null }
function fixture() {
  const state = { rows: [{ id: 'general', label: 'General' }, { id: 'models', label: 'Models' }] as readonly SettingsEntry[], steps: [] as readonly SettingsEntry[], connection: 'connected', mirror: ready, blank: true }
  const reconnect = vi.fn()
  const renderSlot = vi.fn(() => <span>contribution</span>)
  const props = { t: (key: keyof typeof zh) => zh[key], reconnect, renderSlot,
    useSections: (select: (value: typeof state.rows) => unknown) => select(state.rows),
    useOnboarding: (select: (value: typeof state.steps) => unknown) => select(state.steps),
    useConnection: (select: (value: string) => unknown) => select(state.connection),
    useSettings: (select: (value: SettingsMirrorSnapshot) => unknown) => select(state.mirror),
    useSessions: (select: (value: unknown) => unknown) => select({ phase: 'ready', current: state.blank ? undefined : 'active', byId: { active: { blank: false } } }),
  } as unknown as SettingsProps
  return { state, props, reconnect, renderSlot }
}
it('分区可选择、卸载回退，关闭恢复焦点并卸载表单', () => {
  const f = fixture(), view = render(<Settings {...f.props} />)
  const trigger = screen.getByRole('button', { name: zh.title })
  expect(screen.queryByRole('dialog')).toBeNull(); fireEvent.click(trigger)
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Models' }))
  expect(f.renderSlot).toHaveBeenLastCalledWith('qs.settings.section', expect.any(Object), { only: 'models' })
  f.state.rows = f.state.rows.slice(0, 1);view.rerender(<Settings {...f.props} />)
  expect(f.renderSlot).toHaveBeenLastCalledWith('qs.settings.section', expect.any(Object), { only: 'general' })
  f.state.rows = [];view.rerender(<Settings {...f.props} />);expect(screen.getByText(zh.empty)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.close }))
  expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger)
})
it('离线、加载、只读及 memory 明确区分且不显示原始错误', () => {
  const f = fixture(), view = render(<Settings {...f.props} />); fireEvent.click(screen.getByRole('button', { name: zh.title }))
  f.state.connection = 'disconnected'; f.state.mirror = { ...ready, status: 'loading', error: 'secret-bearing transport failure' }; view.rerender(<Settings {...f.props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.reconnect }));expect(f.reconnect).toHaveBeenCalledOnce()
  expect(screen.getByText(zh.loading)).toBeTruthy();expect(screen.getByRole('alert').textContent).toBe(zh.failed);expect(view.container.textContent).not.toContain('secret-bearing')
  f.state.connection = 'connecting';f.state.mirror = { ...ready, view: { ...ready.view!, writable: false } };view.rerender(<Settings {...f.props} />)
  expect(screen.getByText(zh.connecting)).toBeTruthy();expect(screen.getByText(zh.readonly)).toBeTruthy()
  f.state.mirror = { status: 'unavailable', view: undefined, error: null };view.rerender(<Settings {...f.props} />);expect(screen.getByText(zh.unavailable)).toBeTruthy()
})
it('引导按完成标识推进，离开空白会话后重置', () => {
  const f=fixture();f.state.steps=[{ id:'first',label:'' },{ id:'second',label:'' }]
  const slot = vi.fn<SettingsProps['renderSlot']>((name, owner) => {
    if (name !== 'qs.settings.onboarding') return null
    const step = owner as unknown as SettingsOnboardingOwnerProps
    return <><button onClick={step.complete}>complete</button><button onClick={() =>{  step.openSection('models') }}>configure</button></>
  })
  const view=render(<Settings {...f.props} renderSlot={slot} />)
  expect(slot).toHaveBeenLastCalledWith('qs.settings.onboarding',expect.objectContaining({ stepId:'first' }),{ only:'first' })
  fireEvent.click(screen.getByText('complete'));expect(slot).toHaveBeenLastCalledWith('qs.settings.onboarding',expect.objectContaining({ stepId:'second' }),{ only:'second' })
  fireEvent.click(screen.getByText('configure'));expect(screen.getByRole('dialog')).toBeTruthy();fireEvent.click(screen.getByText(zh.close))
  fireEvent.click(screen.getByText('complete'));expect(screen.queryByText('complete')).toBeNull()
  f.state.blank=false;view.rerender(<Settings {...f.props} renderSlot={slot} />)
  f.state.blank=true;view.rerender(<Settings {...f.props} renderSlot={slot} />)
  expect(screen.getByText('complete')).toBeTruthy()
  const general=vi.fn(()=>null);render(<General {...{ t:f.props.t,renderSlot:general } as unknown as GeneralProps} />);expect(general).toHaveBeenCalledWith('qs.settings.general.item',{})
})
it('文件可用性来自官方镜像，拒绝和传输失败显示反馈，重复点击只发一次', async () => {
  let mirror=ready
  const open=vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('private')).mockResolvedValue(true)
  const props={ t:(key:keyof typeof zh)=>zh[key],openDocument:open,
    useSettings:(select:(value:SettingsMirrorSnapshot)=>unknown)=>select(mirror),
  } as unknown as DocumentProps
  const view=render(<DocumentAction {...props} />)
  for(let i=0;i<2;i++){fireEvent.click(screen.getByRole('button'));await waitFor(()=>{ expect(screen.getByRole('alert')).toBeTruthy() })}
  fireEvent.click(screen.getByRole('button'));await waitFor(()=>{ expect(screen.queryByRole('alert')).toBeNull() })
  expect(view.container.textContent).not.toContain('private')
  let resolve!: (value:boolean)=>void
  open.mockImplementation(()=>new Promise((answer)=>{resolve=answer}))
  const button = screen.getByRole('button')
  act(() => { button.click(); button.click() });expect(open).toHaveBeenCalledTimes(4)
  view.unmount();await act(async()=>{resolve(false)})
  mirror={ status:'loading',view:undefined,error:null };const hidden=render(<DocumentAction {...props}/>);expect(screen.queryByRole('button')).toBeNull()
  mirror={ ...ready,view:{ ...ready.view!,hasDocument:false } };hidden.rerender(<DocumentAction {...props}/>);expect(screen.queryByRole('button')).toBeNull()
})
