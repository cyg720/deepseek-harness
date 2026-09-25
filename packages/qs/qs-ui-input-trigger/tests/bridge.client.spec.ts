/** 输入同步以官方修订号为准，IME 和忙碌阶段禁止候选匹配。 */
import { expect, it, vi } from 'vitest'
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerController } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { createCommandInputBridge } from '../src/client/input-bridge.ts'

it('选区、修订号、阶段与键盘动作均交给同一官方控制器', () => {
  let state = { draft: '/goal', draftRev: 7, phase: 'plain' }
  const track = vi.fn(), arbitrate = vi.fn(() => 'consumed'), onSpace = vi.fn(() => true)
  const input = { state: { getSnapshot: () => state } } as unknown as SessionInput
  const controller = { track, arbitrate, onSpace } as unknown as InputTriggerController
  const bridge = createCommandInputBridge(input, controller)
  bridge.track(3, false)
  expect(track).toHaveBeenLastCalledWith('/goal', 3, { tier: 'plain' }, 7)
  bridge.track(4, true)
  expect(track).toHaveBeenLastCalledWith('/goal', 4, { tier: 'frozen' }, 7)
  for (const phase of ['claimed', 'adjudicating', 'submitting']) {
    state = { draft: '/goal arg', draftRev: 8, phase }
    bridge.track(9, false)
    expect(track).toHaveBeenLastCalledWith('/goal arg', 9, { tier: phase === 'claimed' ? 'claimed' : 'frozen' }, 8)
  }
  expect(bridge.arbitrate('enter', true)).toBe('consumed')
  expect(arbitrate).toHaveBeenCalledWith('enter', true)
  expect(bridge.space()).toBe(true)
  expect(onSpace).toHaveBeenCalledOnce()
})
