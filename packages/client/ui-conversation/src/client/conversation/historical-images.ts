/** Session-scoped durable image URL cache shared by Conversation targets.
 * @remarks 文件说明：文件职责：实现 client/ui-conversation 中 historical images 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-conversation 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'

interface ImageUrlEntry {
  readonly sessionId: SessionId
  readonly generation: number
  current?: string
  pending: Promise<string>
}

/** Resolve durable Conversation images and release their browser URLs with Session scope.
 * @remarks 中文说明：类说明：HistoricalImageCache 用于集中封装 处理 HistoricalImageCache
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * client/ui-conversation 在对应插件或业务生命周期内创建和调用。 */
export class HistoricalImageCache {
  /**
   * 常量说明：entries 用于处理 entries 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly entries = new Map<string, ImageUrlEntry>()
  /**
   * 常量说明：generations 用于处理 generations 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly generations = new Map<SessionId, number>()
  /**
   * 常量说明：scopeDisposers 用于处理 scopeDisposers 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly scopeDisposers = new Map<SessionId, () => void>()
  /**
   * 常量说明：urls 用于处理 urls 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly urls = new Set<string>()
  /**
   * 变量说明：disposed 用于处理 disposed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private disposed = false

  /**
   * @param ctx - Owning ui-conversation fiber.
   * @param sessions - Session Controller object layer.
   * @remarks 中文说明：功能说明：处理 HistoricalImageCache 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
   * 参数说明：sessions（ISessions）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new HistoricalImageCache(ctx,
   * sessions) 创建实例，并在所属生命周期内使用。
   */
  constructor(ctx: Context, private readonly sessions: ISessions) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.effect(() => () => { this.dispose() }, 'ui-conversation historical image cache')
  }

  /**
   * Resolve and cache one session-authorized image URL.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference.
   * @returns browser URL valid until the Session binding is released.
   * @remarks 中文说明：功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：attachment（ImageAttachmentRef）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * resolve(sessionId, attachment)，并按返回类型处理结果。
   */
  resolve(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('ui-conversation image cache is disposed'))
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = this.key(sessionId, attachment)
    /**
     * 常量说明：cached 用于处理 cached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cached = this.entries.get(key)
    if (cached !== undefined) return cached.pending
    /**
     * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const binding = this.sessions.binding(sessionId)
    if (binding === undefined) {
      return Promise.reject(new Error(`ui-conversation: unknown session "${sessionId}"`))
    }
    this.bindScope(sessionId, binding.ctx)
    /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entry: ImageUrlEntry = {
      sessionId,
      generation: this.generations.get(sessionId) ?? 0,
      pending: Promise.resolve(''),
    }
    this.entries.set(key, entry)
    entry.pending = this.loadCanonical(key, entry, attachment)
    return entry.pending
  }

  /**
   * Return an already-displayable URL without starting a read.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference.
   * @returns current preview or canonical URL when cached.
   * @remarks 中文说明：功能说明：处理 peek 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：attachment（ImageAttachmentRef）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * peek(sessionId, attachment)，并按返回类型处理结果。
   */
  peek(sessionId: SessionId, attachment: ImageAttachmentRef): string | undefined {
    return this.entries.get(this.key(sessionId, attachment))?.current
  }

  /**
   * Adopt a submission preview while fetching the durable admitted bytes.
   * The preview is available synchronously, then replaced and revoked when
   * the canonical attachment read completes.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference the URL temporarily displays.
   * @param url - browser URL to adopt.
   * @returns whether the cache took ownership.
   * @remarks 中文说明：功能说明：处理 seed 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：attachment（ImageAttachmentRef）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：url（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 seed(sessionId, attachment, url)，
   * 并按返回类型处理结果。
   */
  seed(sessionId: SessionId, attachment: ImageAttachmentRef, url: string): boolean {
    if (this.disposed) return false
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = this.key(sessionId, attachment)
    if (this.entries.has(key)) return false
    /**
     * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const binding = this.sessions.binding(sessionId)
    if (binding === undefined) return false
    this.bindScope(sessionId, binding.ctx)
    /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entry: ImageUrlEntry = {
      sessionId,
      generation: this.generations.get(sessionId) ?? 0,
      current: url,
      pending: Promise.resolve(url),
    }
    this.urls.add(url)
    this.entries.set(key, entry)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
     */
    entry.pending = this.loadCanonical(key, entry, attachment).catch((error: unknown) => {
      if (this.entries.get(key) === entry && entry.current === url) {
        this.entries.delete(key)
        this.releaseUrl(url)
      }
      throw error
    })
    // Seed begins the durable read before a transcript image necessarily
    // mounts. Keep that legitimate no-consumer path from becoming an
    // unhandled rejection; resolve() still returns the rejecting promise.
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    void entry.pending.catch(() => {})
    return true
  }

  /**
   * 功能说明：处理 key 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param attachment （ImageAttachmentRef）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 key(sessionId, attachment)，并按返回类型处理结果。
   */
  private key(sessionId: SessionId, attachment: ImageAttachmentRef): string {
    return `${sessionId}:${attachment.attachmentId}`
  }

  /**
   * 功能说明：加载 Canonical 相关流程；使用场景由所在模块及调用位置决定。
   * @param key （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param entry （ImageUrlEntry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param attachment （ImageAttachmentRef）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 loadCanonical(key, entry, attachment)，并按返回类型处理结果。
   */
  private loadCanonical(
    key: string,
    entry: ImageUrlEntry,
    attachment: ImageAttachmentRef,
  ): Promise<string> {
    /**
     * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const binding = this.sessions.binding(entry.sessionId)
    if (binding === undefined) return Promise.reject(new Error(`ui-conversation: unknown session "${entry.sessionId}"`))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：result（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(result)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
     */
    return binding.session.readAttachment(attachment.attachmentId)
      .then((result) => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        this.assertLive(key, entry)
        /**
         * 变量说明：url 用于处理 url 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
         */
        let url: string
        if (typeof URL.createObjectURL !== 'function') {
          url = `data:${result.value.attachment.mediaType};base64,${bytesToBase64(result.value.data)}`
        } else {
          /**
           * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const bytes = Uint8Array.from(result.value.data)
          url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }))
        }
        this.assertLive(key, entry)
        this.urls.add(url)
        /**
         * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const previous = entry.current
        entry.current = url
        if (previous !== undefined && previous !== url) this.releaseUrl(previous)
        return url
      })
      .catch((error: unknown) => {
        if (this.entries.get(key) === entry && entry.current === undefined) this.entries.delete(key)
        throw error
      })
  }

  /**
   * 功能说明：断言 Live 相关流程；使用场景由所在模块及调用位置决定。
   * @param key （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param entry （ImageUrlEntry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 assertLive(key, entry)，并按返回类型处理结果。
   */
  private assertLive(key: string, entry: ImageUrlEntry): void {
    if (this.disposed) throw new Error('ui-conversation image cache was disposed before loading completed')
    if (this.entries.get(key) !== entry
      || (this.generations.get(entry.sessionId) ?? 0) !== entry.generation) {
      throw new Error('ui-conversation image scope was released before loading completed')
    }
  }

  /**
   * 功能说明：处理 bindScope 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param scope （Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 bindScope(sessionId, scope)，并按返回类型处理结果。
   */
  private bindScope(sessionId: SessionId, scope: Context): void {
    if (this.scopeDisposers.has(sessionId)) return
    /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const dispose = scope.effect(() => () => {
      this.scopeDisposers.delete(sessionId)
      this.release(sessionId)
    }, 'ui-conversation historical image scope')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.scopeDisposers.set(sessionId, () => { void dispose() })
  }

  /**
   * 功能说明：处理 release 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 release(sessionId)，并按返回类型处理结果。
   */
  private release(sessionId: SessionId): void {
    this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1)
    /**
     * 变量说明：key、entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [key, entry] of this.entries) {
      if (entry.sessionId !== sessionId) continue
      this.entries.delete(key)
      if (entry.current !== undefined) this.releaseUrl(entry.current)
    }
  }

  /**
   * 功能说明：处理 releaseUrl 相关流程；使用场景由所在模块及调用位置决定。
   * @param url （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 releaseUrl(url)，并按返回类型处理结果。
   */
  private releaseUrl(url: string): void {
    if (!this.urls.delete(url)) return
    revokeUrl(url)
  }

  /**
   * 功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 dispose()，并按返回类型处理结果。
   */
  private dispose(): void {
    if (this.disposed) return
    this.disposed = true
    /**
     * 变量说明：dispose 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const dispose of [...this.scopeDisposers.values()]) dispose()
    this.scopeDisposers.clear()
    /**
     * 变量说明：url 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const url of this.urls) revokeUrl(url)
    this.urls.clear()
    this.entries.clear()
  }
}

/**
 * 功能说明：处理 revokeUrl 相关流程；使用场景由所在模块及调用位置决定。
 * @param url （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 revokeUrl(url)，并按返回类型处理结果。
 */
function revokeUrl(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}
