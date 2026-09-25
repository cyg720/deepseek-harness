/** 输入准备贡献按会话隔离，注册、取消与服务释放均清理订阅。 */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { QsSendPreparation, type QsSendPreparationEntry } from '../src/client/preparation.ts'
it('只阻止指定会话，拒绝重名贡献并在释放后恢复', async () => {
  const ctx = new Context()
  const service = new QsSendPreparation(ctx)
  let value: QsSendPreparationEntry | undefined
  const listeners = new Set<() => void>(), off = vi.fn()
  const source = { getSnapshot: () => value, subscribe: (listener: () => void) => {
    listeners.add(listener); return () => { off(); listeners.delete(listener) }
  } }
  const target = 'a' as QsSendPreparationEntry['sessionId']
  const face = service.forSession(target), listener = vi.fn(), unsubscribe = face.subscribe(listener)
  const remove = service.register('preset', source, 'interrupted')
  expect(() => service.register('preset', source, 'interrupted')).toThrow('Duplicate QS send preparation')
  expect(face.getSnapshot()).toBeUndefined()
  value = { sessionId: target, pending: true, reason: 'preparing' }
  for (const update of listeners) update()
  expect(face.getSnapshot()).toBe(value)
  expect(service.forSession(undefined).getSnapshot()).toBeUndefined()
  expect(service.forSession('other' as typeof target).getSnapshot()).toBeUndefined()
  value = { ...value, pending: false, reason: 'failed' }
  for (const update of listeners) update()
  expect(face.getSnapshot()?.pending).toBe(false)
  remove(); remove(); expect(off).toHaveBeenCalledOnce(); expect(face.getSnapshot()?.reason).toBe('interrupted')
  const release = service.register('preset', source, 'interrupted')
  unsubscribe()
  await ctx.fiber.dispose()
  release(); expect(off).toHaveBeenCalledTimes(2); expect(listeners.size).toBe(0)
  expect(listener).toHaveBeenCalled()
})

// 卸载不能被当作远端准备成功；空闲重装也不能清掉尚未确认的状态。
it('准备贡献卸载后保留取消状态，新实例完成明确重试后才恢复', async () => {
  const ctx = new Context(), service = new QsSendPreparation(ctx)
  const sessionId = 'interrupted' as QsSendPreparationEntry['sessionId']
  let value: QsSendPreparationEntry | undefined = { sessionId, pending: true, reason: 'working' }
  const listeners = new Set<() => void>()
  const source = { getSnapshot: () => value, subscribe: (listener: () => void) => {
    listeners.add(listener); return () => { listeners.delete(listener) }
  } }
  const face = service.forSession(sessionId)
  const remove = service.register('preset', source, 'reload or retry preset')
  remove(); remove()
  expect(face.getSnapshot()).toEqual({ sessionId, pending: false, reason: 'reload or retry preset' })
  expect(listeners.size).toBe(0)
  value = undefined
  const release = service.register('preset', source, 'reload or retry preset')
  for (const listener of listeners) listener()
  expect(face.getSnapshot()?.pending).toBe(false)
  value = { sessionId, pending: true, reason: 'retrying' }
  for (const listener of listeners) listener()
  expect(face.getSnapshot()).toBe(value)
  value = undefined
  for (const listener of listeners) listener()
  expect(face.getSnapshot()).toBeUndefined()
  release()
  await ctx.fiber.dispose()
})
