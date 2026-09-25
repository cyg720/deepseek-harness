// @vitest-environment jsdom
/** 两项反馈贡献独立装卸，均解析到同一官方呈现服务。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'

it('消息按钮与会话表单各注册一次，卸载和重装不重复反馈源', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const actionsFace = {}, dialogFace = {}, actions = vi.fn(() => actionsFace), dialog = vi.fn(() => dialogFace)
    runtime.ctx.provide('messageFeedbackPresentation', { actions, dialog } as never)
    await runtime.declare({ 'qs.composer.overlay': { kind: 'list', scope: 'session' }, 'qs.chat.assistant-actions': { kind: 'list', scope: 'session' } })
    for (let iteration = 0; iteration < 2; iteration++) {
      const mounted = await runtime.mount({ inject, apply })
      for (const [name, expected] of [['qs.composer.overlay', dialogFace], ['qs.chat.assistant-actions', actionsFace]] as const) {
        const entries = runtime.slots.entries(name)
        expect(entries).toHaveLength(1)
        expect((entries[0]!.inject as unknown as (id: SessionId) => unknown)('s1' as SessionId)).toBe(expected)
      }
      expect(actions).toHaveBeenLastCalledWith('s1'); expect(dialog).toHaveBeenLastCalledWith('s1')
      await mounted.dispose()
      expect(runtime.slots.entries('qs.composer.overlay')).toHaveLength(0)
      expect(runtime.slots.entries('qs.chat.assistant-actions')).toHaveLength(0)
    }
  } finally { await runtime.dispose() }
})
