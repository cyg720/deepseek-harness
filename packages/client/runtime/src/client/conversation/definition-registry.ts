/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话定义（Conversation Definition）注册表的共享基类：
 *   为一种"按唯一键注册/去重/自动清理"的注册表提供公共生命周期与
 *   稳定的条目缓存。
 * 【技术维度】继承 Cordis Service；注册通过 owner.effect 挂到调用方
 *   生命周期；缓存条目数组引用稳定（引用不变，内容更新时整体替换）。
 * 【产品维度】会话 UI 的节点构建器（事件注册表、视图注册表）共用一套
 *   注册语义：谁注册谁负责、重复键报错、低频率变更可订阅。
 * 【逻辑维度】entries 返回引用稳定的注册序条目；subscribe 提供低频变更
 *   通知；registerDefinition 执行去重与 effect 注册；refresh 重建缓存。
 * 【关键边界】键必须是注册表内唯一的；effect 在调用方生命周期结束或
 *   销毁函数调用时清理，且只清理自己持有的那条定义。
 * 【新手阅读建议】理解 Cordis effect 的"随生命周期自动回收"语义即可。
 * ==========================================================================
 */
import { Service } from '@deepseek-ai/cordis'

/** Shared lifecycle and stable-entry storage for one Conversation Definition registry. */
/** 会话定义注册表的共享生命周期与稳定条目存储基类。 */
export abstract class ConversationDefinitionRegistry<Definition> extends Service {
  protected readonly definitions = new Map<string, Definition>() // 键 -> 定义的存储
  private listeners = new Set<() => void>() // 变更订阅者集合
  private cached: readonly Definition[] = [] // 注册序条目的引用稳定缓存

  /**
   * Return reference-stable Definitions in registration order.
   * @returns current Definitions.
   */
  /**
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
  /**
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
  /**
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
  /** 重建缓存条目并同步失效所有订阅者。 */
  protected refresh(): void {
    this.cached = [...this.definitions.values()]
    for (const listener of this.listeners) listener()
  }
}
