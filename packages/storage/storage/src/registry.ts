/**
 * ================================ 文件注释 ================================
 * 【文件职责】存储枢纽（storage hub）的"后端注册表"：用名字登记/解析多个存储后端，
 * 让多个后端（JSON、SQLite 等）并存，由消费方（如领域层）按名字选择。
 * 【技术维度】薄封装一个 Map<string, StorageBackend>：register 返回注销函数
 * （注册即副作用，符合仓库"注册返回 disposer"约定），get 找不到时抛 backend-not-found。
 * 【产品维度】支撑"一个应用可同时使用多种存储介质"：比如会话数据走 SQLite、
 * 技能状态走 JSON 文件，只需在配置里路由。
 * 【逻辑维度】按出现顺序：类 JSDoc → backends 字段（名字→后端）→ register（登记并
 * 返回注销函数）→ get（按名解析）→ names（诊断用名单）。
 * 【关键边界】重名注册抛 duplicate-backend；注销函数带"陈旧保护"——只移除自己登记的
 * 那一条，防止旧 disposer 误删新注册的同名后端；注销不等于关闭后端（关闭由拥有插件负责）。
 * 【新手阅读建议】先看 register/get 这对基本操作，再看注销函数里的陈旧保护注释理解其必要性。
 * ==========================================================================
 */
/**
 * Named backend registry of the storage hub.
 * @module @deepseek-ai/dsh-storage/src/registry
 */
/**
 * 模块总览：后端注册表只解决"名字 ↔ 后端实例"的登记与查找，不做任何读写。
 * 哪个消费方用哪个后端，是消费方自己的配置（如领域层的路由表），枢纽不做全局选择。
 */

import type { StorageBackend } from './backend.ts'
import { StorageError } from './error.ts'

/**
 * Mutable name → backend table. Multiple backends stay mounted side by side;
 * which backend serves which consumer is the consumer's configuration
 * (e.g. the domain layer's route table), never a hub-global choice.
 */
/**
 * 可变的"名字 → 后端"表。多个后端可同时登记；谁服务谁由消费方配置决定，
 * 例如领域层的 routes 路由表，而不是枢纽的全局选择。
 */
export class BackendRegistry {
  // 名字 → 后端实例 的映射表。
  private readonly backends = new Map<string, StorageBackend>()

  /**
   * Register a named backend. Registration is an effect: the returned
   * disposer removes the name. Disposal does NOT close the backend — the
   * owning plugin closes it after unregistering.
   * @param name - Backend name, e.g. `json` or `sqlite`.
   * @param backend - The backend instance.
   * @returns the disposer that unregisters the name.
   */
  /**
   * 登记一个命名后端。登记是一种副作用（effect）：返回的注销函数用于移除该名字。
   * 注意：注销并不关闭后端——关闭由拥有它的插件在注销后自行负责。
   * @param name 后端名，例如 json 或 sqlite。
   * @param backend 后端实例。
   * @returns 注销该名字的函数。
   */
  register(name: string, backend: StorageBackend): () => void {
    if (this.backends.has(name)) {
      throw new StorageError('duplicate-backend', `storage backend '${name}' is already registered`)
    }
    this.backends.set(name, backend)
    return () => {
      // Remove only this registration's contribution: after dispose + re-register,
      // a stale disposer firing again must not remove the successor.
      // 中文说明：只移除本次登记的那一条。若经历"注销→重新登记同名后端"后，
      // 一个过期的旧注销函数再次被调用，不能误删新登记的后端——所以先比对实例是否还是自己。
      if (this.backends.get(name) === backend) {
        this.backends.delete(name)
      }
    }
  }

  /**
   * Resolve a backend by name.
   * @param name - Registered backend name.
   * @returns the backend.
   */
  /**
   * 按名字解析后端。
   * @param name 已登记的后端名。
   * @returns 后端实例。
   */
  get(name: string): StorageBackend {
    const backend = this.backends.get(name)
    if (!backend) {
      throw new StorageError(
        'backend-not-found',
        `storage backend '${name}' is not registered (registered: ${[...this.backends.keys()].join(', ') || 'none'})`,
      )
    }
    return backend
  }

  /**
   * Registered backend names, for diagnostics.
   * @returns a snapshot array of names.
   */
  /**
   * 已登记的后端名清单（用于诊断）。
   * @returns 名字的快照数组。
   */
  names(): string[] {
    return [...this.backends.keys()]
  }
}
