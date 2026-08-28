import { Service, type Context } from '@deepseek-ai/cordis'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'

/** Shared lifecycle and stable-entry storage for one Conversation Definition registry. */
export abstract class ConversationDefinitionRegistry<Definition> {
  protected readonly definitions = new Map<string, Definition>()
  private listeners = new Set<() => void>()
  private cached: readonly Definition[] = []

  /** @param ctx - Context whose effects own contributed Definitions. */
  constructor(protected readonly ctx: Context) {
    Object.defineProperty(this, Service.tracker, {
      value: { property: 'ctx' },
    })
  }

  /**
   * Return reference-stable Definitions in registration order.
   * @returns current Definitions.
   */
  /*
   * 以注册顺序返回引用稳定的定义列表（注册/注销间引用不变化）。
   * @returns 当前定义列表。
   */
  entries(): readonly Definition[] {
    return this.cached
  }

  /**
   * Observe low-frequency registry changes.
   * @param listener - synchronous invalidation callback.
   * @returns unsubscribe callback.
   */
  /*
   * 观察低频的注册表变更。
   * @param listener 同步失效回调。
   * @returns 取消订阅回调。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Register one uniquely keyed Definition for the caller's lifetime.
   * @param key - registry-local unique key.
   * @param definition - contributed Definition.
   * @param duplicateMessage - error raised when the key is already owned.
   * @param effectName - Cordis effect diagnostic label.
   * @returns idempotent disposer.
   */
  /*
   * 为调用方的生命周期注册一个键唯一的定义。
   * @param key 注册表内唯一的键。
   * @param definition 贡献的定义。
   * @param duplicateMessage 键已被占用时抛出的错误信息。
   * @param effectName Cordis effect 的诊断标签。
   * @returns 幂等销毁函数。
   */
  protected registerDefinition(
    key: string,
    definition: Definition,
    duplicateMessage: string,
    effectName: string,
  ): () => void {
    if (this.definitions.has(key)) throw new Error(duplicateMessage)
    const owner = this.ctx
    const dispose = owner.effect(() => {
      this.definitions.set(key, definition)
      this.refresh()
      return () => {
        if (this.definitions.get(key) !== definition) return
        this.definitions.delete(key)
        this.refresh()
      }
    }, effectName)
    return () => { void dispose() }
  }

  /** Refresh cached entries and synchronously invalidate subscribers. */
  /* 重建缓存条目并同步失效所有订阅者。 */
  protected refresh(): void {
    this.cached = [...this.definitions.values()]
    notifySubscribers(this.listeners, '[ui-conversation] definition registry')
  }
}
