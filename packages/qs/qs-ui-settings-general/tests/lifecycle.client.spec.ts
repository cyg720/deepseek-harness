// @vitest-environment jsdom
/** 设置壳等候宿主，复用唯一镜像并释放级联贡献。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SettingsInjected } from '../src/client/contract.ts'
import type { DocumentInjected } from '../src/client/DocumentAction.tsx'
import * as plugin from '../src/client/index.ts'
import { apply as host } from '../src/index.ts'
it.each([true,false])('设置壳装卸、镜像身份与本机入口 loopback=%s', async (loopback) => {
  host();const runtime=await SlotTestRuntime.create()
  try {
    const locale=new LocaleRuntime(runtime.ctx);runtime.ctx.provide('locale',locale);runtime.slots.installLocale(locale)
    const mirror={ getSnapshot:()=>({ status:'ready',view:undefined,error:null }),subscribe:()=>()=>{} }
    const reconnect=vi.fn(),open=vi.fn(async()=>({ ok:true }))
    runtime.ctx.provide('settingsScope',{ describe:()=>mirror } as never)
    runtime.ctx.provide('connection',{ state:{ getSnapshot:()=> 'connected',subscribe:()=>()=>{} },reconnect } as never)
    runtime.ctx.provide('remote',{ $host:{ isLoopback:loopback },settings:{ openSettingsDocument:open } } as never)
    runtime.ctx.provide('remote.settings',{ openSettingsDocument:open } as never)
    const feature=await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.sidebar.settings')).toHaveLength(0)
    await runtime.declare({ 'qs.sidebar.settings':{ kind:'single',scope:'root' } })
    const entry=runtime.slots.entries('qs.sidebar.settings')[0]!
    const face=(entry.inject as unknown as ()=>SettingsInjected)()
    expect(face.hooks.settings).toBe(mirror);face.reconnect();expect(reconnect).toHaveBeenCalledOnce()
    const source=face.hooks.sections, rows=source.getSnapshot();expect(rows[0]?.id).toBe('general');expect(source.getSnapshot()).toBe(rows)
    const observer=vi.fn(),off=source.subscribe(observer)
    const extra=runtime.slots.register({ name:'qs.settings.section',id:'extra',label:'Extra',order:10 },()=>null)
    expect(source.getSnapshot().map(row=>row.id)).toEqual(['general','extra']);await vi.waitFor(() =>{  expect(observer).toHaveBeenCalled() })
    extra();off();expect(source.getSnapshot()).toHaveLength(1)
    const first=runtime.slots.register({ name:'qs.settings.section',id:'first',order:-10 },()=>null)
    expect(source.getSnapshot()[0]).toMatchObject({ id:'first',label:'first' })
    first()
    const step=runtime.slots.register({ name:'qs.settings.onboarding',id:'welcome' },()=>null)
    expect(face.hooks.onboarding.getSnapshot()[0]?.id).toBe('welcome');step()
    const onboarding=face.hooks.onboarding
    const offOnboarding=onboarding.subscribe(vi.fn())
    expect(onboarding.getSnapshot()).toHaveLength(0);offOnboarding()
    expect(runtime.slots.entries('qs.settings.action')).toHaveLength(loopback?1:0)
    if(loopback){const action=runtime.slots.entries('qs.settings.action')[0]!;const injected=(action.inject as unknown as ()=>DocumentInjected)();expect(injected.hooks.settings).toBe(mirror);expect(await injected.openDocument()).toBe(true);expect(open).toHaveBeenCalledOnce()}
    await feature.dispose();expect(runtime.slots.entries('qs.sidebar.settings')).toHaveLength(0);expect(runtime.slots.spec('qs.settings.general.item')).toBeUndefined()
    await runtime.mount(plugin);expect(runtime.slots.entries('qs.sidebar.settings')).toHaveLength(1)
  } finally {await runtime.dispose()}
})
