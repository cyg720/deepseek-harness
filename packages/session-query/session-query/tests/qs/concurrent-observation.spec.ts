/** 冷读取重叠时复用同一持久版本的准备实例；版本变化和单个调用取消保持独立。 */
import { Context, Service } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionLogOffset, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import { expect, it, vi } from 'vitest'
import { SessionObservationReader } from '../../src/observation.ts'

it.each([[false, false], [false, true], [true, false], [true, true]] as const)('重叠冷读取在不同版本=%s、Cordis 追踪代理=%s 时保持缓存身份', async (differentRevisions, traced) => {
  const ctx = new Context()
  const id = SessionId('qs-concurrent-observation')
  const header = { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false, cwd: '/workspace' }
  const ready = Promise.withResolvers<undefined>()
  const releases = Array.from({ length: 3 }, () => Promise.withResolvers<undefined>())
  let stats = 0, reads = 0, closes = 0
  await ctx.plugin(SessionStore)
  // 替身仅实现读取器使用的持久化方法；每个句柄拥有独立取消与释放生命周期。
  ctx.provide('sessionPersistence', {
    // 使用真实 Cordis 的追踪机制，不能用恒定普通对象掩盖服务代理身份变化。
    ...traced ? { ctx, [Service.tracker]: { associate: 'sessionPersistence', property: 'ctx' } } : {},
    stat: async () => ({ header, revision: SessionPersistenceRevision(`r${differentRevisions ? ++stats : 0}`) }),
    open: async () => ({
      id, header, inheritedEventCount: SessionLogOffset(0), access: 'read',
      read: async () => {
        const index = reads++
        if (reads === 3) ready.resolve(undefined)
        await releases[index]?.promise
        return { events: [], eventState: 'detached' }
      },
      close: async () => { closes++ },
    }),
  } as unknown as SessionPersistence)
  const prepare = vi.spyOn(ctx.sessions, 'prepare')
  const reader = new SessionObservationReader(ctx)
  const pending = [reader.read(id, { projectionMode: 'none' }), reader.read(id, { projectionMode: 'none' }), reader.read(id, { projectionMode: 'none' })] as const
  try {
    await ready.promise
    releases[0]?.resolve(undefined)
    using first = await pending[0]
    releases[1]?.resolve(undefined)
    using second = await pending[1]
    releases[2]?.resolve(undefined)
    using third = await pending[2]
    expect(reads).toBe(3)
    expect(closes).toBe(3)
    expect(prepare).toHaveBeenCalledTimes(differentRevisions ? 3 : 1)
    if (differentRevisions) {
      expect(first.revision).not.toBe(second.revision)
      expect(first.events).not.toBe(second.events)
    } else {
      expect(first.events).toBe(second.events)
      expect(first.events).toBe(third.events)
    }
    // 共享准备内容不共享租约；释放一位读者不会使其他读者失效。
    first[Symbol.dispose]()
    using retained = second.retain()
    expect(retained.events).toBe(second.events)
  } finally {
    for (const release of releases) release.resolve(undefined)
    const settled = await Promise.allSettled(pending)
    for (const result of settled) if (result.status === 'fulfilled') result.value[Symbol.dispose]()
    prepare.mockRestore()
    await ctx.fiber.dispose()
  }
})
