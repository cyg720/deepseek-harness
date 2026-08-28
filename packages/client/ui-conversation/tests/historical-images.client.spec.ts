// @vitest-environment jsdom
/**
 * 文件职责：验证 client/ui-conversation 中 historical images client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { HistoricalImageCache } from '../src/client/conversation/historical-images.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('HistoricalImageCache', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('invalidates a pending image load when its Session binding is released', async () => {
    /**
     * 常量说明：read 用于读取 read 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const read = Promise.withResolvers<Awaited<ReturnType<SessionFace['readAttachment']>>>()
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = await SlotTestRuntime.create()
    /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const sessionId = await runtime.sessions.add({
      id: 's1',
      session: { readAttachment: () => read.promise },
    })
    /**
     * 常量说明：cache 用于处理 cache 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cache = new HistoricalImageCache(runtime.ctx, runtime.ctx.sessions)
    /**
     * 常量说明：attachment 用于处理 attachment 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const attachment = {
      attachmentId: AttachmentId('image-1'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
    } as const

    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = cache.resolve(sessionId, attachment)
    await runtime.sessions.remove(sessionId)
    read.resolve({ ok: true, value: { attachment, data: Uint8Array.of(1) } })

    await expect(pending).rejects.toThrow('ui-conversation image scope was released before loading completed')
    await runtime.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('shows a seeded URL synchronously, replaces it with canonical bytes, and revokes both', async () => {
    /**
     * 常量说明：revoked 用于处理 revoked 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const revoked: string[] = []
    /**
     * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:canonical')
    /**
     * 常量说明：originalRevoke 用于处理 originalRevoke 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const originalRevoke = URL.revokeObjectURL.bind(URL)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：url（string）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(url)，并按返回类型处理结果。
     */
    URL.revokeObjectURL = (url: string) => { revoked.push(url) }
    try {
      /**
       * 常量说明：read 用于读取 read 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const read = Promise.withResolvers<Awaited<ReturnType<SessionFace['readAttachment']>>>()
      /**
       * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const runtime = await SlotTestRuntime.create()
      /**
       * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      const sessionId = await runtime.sessions.add({ id: 's1', session: { readAttachment: () => read.promise } })
      /**
       * 常量说明：cache 用于处理 cache 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const cache = new HistoricalImageCache(runtime.ctx, runtime.ctx.sessions)
      /**
       * 常量说明：attachment 用于处理 attachment 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const attachment = {
        attachmentId: AttachmentId('image-seeded'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
      } as const

      expect(cache.seed(sessionId, attachment, 'blob:seeded')).toBe(true)
      expect(cache.peek(sessionId, attachment)).toBe('blob:seeded')
      expect(cache.seed(sessionId, attachment, 'blob:duplicate')).toBe(false)
      /**
       * 常量说明：canonical 用于处理 canonical 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const canonical = cache.resolve(sessionId, attachment)
      read.resolve({ ok: true, value: { attachment, data: Uint8Array.of(1) } })
      await expect(canonical).resolves.toBe('blob:canonical')
      expect(cache.peek(sessionId, attachment)).toBe('blob:canonical')
      expect(revoked).toContain('blob:seeded')

      await runtime.sessions.remove(sessionId)
      await Promise.resolve()
      expect(revoked).toContain('blob:canonical')
      await runtime.dispose()
    } finally {
      created.mockRestore()
      URL.revokeObjectURL = originalRevoke
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('revokes a seeded preview when canonical bytes cannot be read', async () => {
    /**
     * 常量说明：revoked 用于处理 revoked 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    try {
      /**
       * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const runtime = await SlotTestRuntime.create()
      /**
       * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      const sessionId = await runtime.sessions.add({
        id: 's1',
        session: {
          readAttachment: () => Promise.resolve({
            ok: false,
            error: { code: 'attachment-error', message: 'missing', details: {} },
          } as never),
        },
      })
      /**
       * 常量说明：cache 用于处理 cache 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const cache = new HistoricalImageCache(runtime.ctx, runtime.ctx.sessions)
      /**
       * 常量说明：attachment 用于处理 attachment 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const attachment = {
        attachmentId: AttachmentId('image-missing'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
      } as const

      expect(cache.seed(sessionId, attachment, 'blob:seeded')).toBe(true)
      await expect(cache.resolve(sessionId, attachment)).rejects.toThrow('attachment-error: missing')
      expect(cache.peek(sessionId, attachment)).toBeUndefined()
      expect(revoked).toHaveBeenCalledWith('blob:seeded')
      await runtime.dispose()
    } finally {
      revoked.mockRestore()
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses to seed for an unknown session', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = await SlotTestRuntime.create()
    /**
     * 常量说明：cache 用于处理 cache 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cache = new HistoricalImageCache(runtime.ctx, runtime.ctx.sessions)
    /**
     * 常量说明：attachment 用于处理 attachment 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const attachment = {
      attachmentId: AttachmentId('image-unknown'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
    } as const
    expect(cache.seed('missing' as never, attachment, 'blob:orphan')).toBe(false)
    await runtime.dispose()
  })
})
