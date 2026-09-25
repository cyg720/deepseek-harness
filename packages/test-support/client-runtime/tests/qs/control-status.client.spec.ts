// @vitest-environment jsdom
/** 测试会话默认未接控制流，失败重试不能伪报成功。 */
import { expect, it } from 'vitest'
import { SlotTestRuntime } from '../../src/index.ts'

it('requires explicit control behavior instead of accepting a fixture retry', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    expect(runtime.ctx.sessions.control.state.getSnapshot()).toEqual({ phase: 'loading', baseline: 0 })
    await expect(runtime.ctx.sessions.control.retry()).rejects.toThrow('requires a real control-stream test')
  } finally { await runtime.dispose() }
})
