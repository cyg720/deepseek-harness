/**
 * ================================ 文件注释 ================================
 * 【文件职责】storage 包（dsh-storage）的入口：存储枢纽（ctx.storage）服务本身——
 * 一个"命名后端注册表 + 数据形态挂载点"。枢纽自己不做任何 IO：后端拥有介质，
 * 数据形态（首先是领域层）拥有语义。
 * 【技术维度】Storage 继承 Cordis 的 Service（生命周期服务）：backend 是 BackendRegistry
 * 实例，forms 是"形态名 → facility"的映射；mount/form 是挂载/解析形态的对称操作。
 * storageBackendServiceKey 把后端名转成生命周期服务键，供数据形态注入等待。
 * 【产品维度】这是存储体系的"总线"：后端插件注册介质，数据形态插件挂载语义，
 * 上层组件通过 ctx.storage.form('domain') 等拿到能力，互不耦合。
 * 【逻辑维度】按出现顺序：export 桶（再导出后端词汇与注册表）→ storageBackendServiceKey
 * （服务键派生）→ 声明合并（ctx.storage）→ StorageForms（形态名映射）→ Storage 类
 * （backend 字段、mount/form、domain 便捷 getter）→ 默认导出 Storage。
 * 【关键边界】挂载/登记都是副作用：返回的 disposer 带"陈旧保护"（只移除自己那一条）；
 * 重复挂载/登记会抛 duplicate 错误；服务包约定只默认导出服务类本身，不导出插件形状。
 * 【新手阅读建议】先看 StorageForms 与 mount/form 理解形态机制，再看 Storage 类与
 * storageBackendServiceKey 理解枢纽如何组织后端与形态。
 * ==========================================================================
 */
/**
 * Storage hub (`ctx.storage`): a named backend registry plus mounted
 * data-form facilities. The hub itself performs no IO — backends own media,
 * data forms (the domain layer first) own semantics.
 * @module @deepseek-ai/dsh-storage
 */
/*
 * 模块总览：枢纽 = 后端注册表 + 形态挂载表。它不读写介质（那是后端的事），
 * 也不解释数据（那是领域层等形态的事），只负责"把名字解析到实现"。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { StorageError } from './error.ts'
import { BackendRegistry } from './registry.ts'

// 对外再导出：后端词汇（backend.ts）、错误（error.ts）、注册表（registry.ts）。
export { BackendRegistry } from './registry.ts'
export { StorageError } from './error.ts'
export type { StorageErrorCode } from './error.ts'
export { UNIT_NAME_RE } from './backend.ts'
export type { StorageBackend, KvFacet, KvUnit, KvUnitDescriptor } from './backend.ts'

/**
 * Derive the Cordis lifecycle service that one named backend plugin provides.
 * Domain-form providers inject these keys so activation cannot race backend
 * registration even though callers continue resolving backends through the
 * storage registry.
 * @param name - Backend registry name.
 * @returns the corresponding lifecycle-only service key.
 */
/*
 * 把一个后端名派生为对应的 Cordis 生命周期服务键。数据形态插件注入这些键，
 * 从而"后端注册"与"形态激活"不会竞争（等后端服务就绪才激活）；
 * 但调用方仍然通过 storage 注册表解析后端实例，两者各司其职。
 * @param name 后端注册名。
 * @returns 对应的生命周期服务键。
 */
export function storageBackendServiceKey(name: string): string {
  return `storage.backend.${name}`
}

// 声明合并：把 storage 服务挂到 Cordis 的 Context 上，ctx.storage 因此有类型。
declare module '@deepseek-ai/cordis' {
  interface Context {
    storage: Storage
  }
}

/**
 * Data forms mountable on the hub, keyed by form name. Form owners extend
 * this map via declaration merging (the domain layer merges
 * `domain: DomainFacility`) and mount the facility in their `apply`.
 */
/*
 * 可挂载到枢纽上的数据形态，按形态名索引。形态拥有者通过声明合并扩展这个映射
 * （领域层合并入 domain: DomainFacility），并在自己的 apply 里挂载 facility。
 */
export interface StorageForms {}

/**
 * The storage hub service. Backends register under `backend`; data forms
 * mount under their `StorageForms` key and are reached as `ctx.storage.<form>`.
 */
/*
 * 存储枢纽服务。后端登记在 backend 下；数据形态挂载在各自的 StorageForms 键下，
 * 通过 ctx.storage.<form> 访问。
 */
export class Storage extends Service {
  /** Named backend table; multiple backends stay mounted side by side. */
  /* 命名后端表：多个后端可并存。 */
  readonly backend: BackendRegistry = new BackendRegistry()

  // 形态名 → facility 的映射表。
  private readonly forms = new Map<keyof StorageForms, unknown>()

  constructor(ctx: Context) {
    super(ctx, 'storage')
  }

  /**
   * Mount a data-form facility on the hub. Mounting is an effect: the
   * returned disposer unmounts the form.
   * @param form - Form key declared in {@link StorageForms}.
   * @param facility - The facility instance to expose.
   * @returns the disposer that unmounts the form.
   */
  /*
   * 把一个数据形态 facility 挂到枢纽上。挂载是副作用：返回的注销函数用于卸载。
   * @param form StorageForms 中声明的形态键。
   * @param facility 要暴露的 facility 实例。
   * @returns 卸载该形态的函数。
   */
  mount<K extends keyof StorageForms>(form: K, facility: StorageForms[K]): () => void {
    if (this.forms.has(form)) {
      throw new StorageError('duplicate-mount', `storage form '${String(form)}' is already mounted`)
    }
    this.forms.set(form, facility)
    return () => {
      // Same stale-disposer guard as BackendRegistry.register.
      // 中文说明：与 BackendRegistry.register 相同的"陈旧注销函数"保护——只移除
      // 自己挂载的那一条，防止旧 disposer 误删重新挂载的形态。
      if (this.forms.get(form) === facility) {
        this.forms.delete(form)
      }
    }
  }

  /**
   * Resolve a mounted data form.
   * @param form - Form key declared in {@link StorageForms}.
   * @returns the mounted facility.
   */
  /*
   * 解析一个已挂载的数据形态。
   * @param form StorageForms 中声明的形态键。
   * @returns 已挂载的 facility。
   */
  form<K extends keyof StorageForms>(form: K): StorageForms[K] {
    if (!this.forms.has(form)) {
      throw new StorageError('form-not-mounted', `storage form '${String(form)}' is not mounted`)
    }
    return this.forms.get(form) as StorageForms[K]
  }

  /** Domain data form; present once the domain layer plugin is loaded. */
  /* 领域数据形态；领域层插件加载后即可用（类型上通过条件类型保证未加载时不可访问）。 */
  get domain(): StorageForms extends { domain: infer D } ? D : never {
    return this.form('domain' as keyof StorageForms)
  }
}

// Service packages default-export their service class and nothing else
// plugin-shaped (packages/AGENTS.md): mixing a default export with a
// function-plugin `apply` makes the Loader drop the plugin namespace.
// 中文说明：服务包只默认导出服务类本身，不导出其他插件形状的东西
// （packages/AGENTS.md 约定）：默认导出与函数式插件 apply 混用会让
// Loader 丢弃插件命名空间。
export default Storage
