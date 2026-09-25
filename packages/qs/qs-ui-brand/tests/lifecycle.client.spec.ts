// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import * as plugin from '../src/client/index.ts'

it('waits for its parent and releases registrations on disposal before remount', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    const first = await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.brand.mark')).toHaveLength(0)
    await runtime.declare({ 'qs.brand.mark': { kind: 'single', scope: 'root' }, 'qs.brand.name': { kind: 'single', scope: 'root' } })
    expect(runtime.slots.entries('qs.brand.mark')).toHaveLength(1)
    expect(runtime.slots.entries('qs.brand.name')).toHaveLength(1)
    await first.dispose()
    expect(runtime.slots.entries('qs.brand.name')).toHaveLength(0)
    expect(runtime.slots.entries('qs.brand.mark')).toHaveLength(0)
    expect(runtime.slots.entries('qs.brand.mark')).toHaveLength(0)
    await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.brand.mark')).toHaveLength(1)
  } finally { await runtime.dispose() }
})
