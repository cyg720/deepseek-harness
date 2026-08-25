/*
 * ================================ 文件注释 ================================
 * 【文件职责】JSON 存储后端：在配置的根目录下，每个单元（unit）对应一个人类可读的
 * JSON 文件，通过"整文件原子重写"发布；以 backend 名 json 注册到存储枢纽上。
 * 【技术维度】Cordis 插件 + 后端实现：JsonStorageBackend 实现 StorageBackend 接口，
 * 只提供 kv facet；open 用"opening 槽位"同步占位来拒绝同名单元的并发打开；
 * 关闭时先等所有在途 open、再逐个关闭单元。
 * 【产品维度】为领域数据提供"直接可见、可手工编辑"的介质：每个单元一个 .json 文件，
 * 便于调试、备份与人工检查；代价是整文件重写，适合中小规模数据。
 * 【逻辑维度】按出现顺序：name/inject（插件元信息）→ Config 与 Config（根目录配置，
 * 无默认值）→ JsonStorageBackend（后端类：open 槽位、kv facet、openUnit、close）→
 * validateDescriptor（名称校验）→ apply（注册到枢纽并托管生命周期）。
 * 【关键边界】root 故意不设默认值：用 process.cwd() 兜底会把单元文件散落到进程启动
 * 目录；未关闭重复打开同名单元是调用方 bug（抛普通 Error）；打开在途时后端关闭，
 * 不会交出"越过 close"的活单元。
 * 【新手阅读建议】先看 Config 与 apply 理解如何接入，再看 JsonStorageBackend 的
 * open/opening/close 理解并发打开与关闭语义，最后追 unit.ts 看读写实现。
 * ==========================================================================
 */
/**
 * JSON storage backend: one human-readable file per unit under a configured
 * root, published by atomic whole-file rewrite. Registers as backend `json`
 * on the storage hub.
 * @module @deepseek-ai/dsh-storage-json
 */
/*
 * 模块总览：本文件是后端插件的组装层；真正的文件读写逻辑在 unit.ts（打开单元、
 * 整文件发布）与 format.ts（序列化/解析）、atomic.ts（原子替换）中。
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import { openJsonUnit } from './unit.ts'

/** Cordis plugin name. */
/* 插件名：加载后枢纽上出现 json 后端。 */
export const name = 'storage-json'
/** The hub must exist before the backend can register. */
/* 依赖注入声明：必须先有 storage 枢纽服务，后端才能登记。 */
export const inject = ['storage']

/**
 * Plugin configuration.
 * `root` has NO default on purpose: a `process.cwd()` fallback would scatter
 * unit files wherever the process happens to start; assemblies state the
 * location explicitly.
 */
/*
 * 插件配置。root 故意不设默认值：process.cwd() 兜底会把单元文件散落到进程启动目录；
 * 由组装方（cordis.yml）显式声明位置。
 */
export interface Config {
  /** Directory holding one `<unit>.json` file per unit. */
  /* 存放单元文件的目录：每个单元一个 <单元名>.json 文件。 */
  root: string
}

/** Config schema. */
/* schemastery 配置校验器（插件加载时校验 root 必填）。 */
export const Config: z<Config> = z.object({
  root: z.string().required(),
})

/** JSON backend: owns the file-tree root and serves the `kv` facet. */
/*
 * JSON 后端：拥有文件树根目录，提供 kv 能力（facet）。每个打开的同名单元同时只有
 * 一个活句柄（open 表 + opening 槽位双重防止并发打开）。
 */
export class JsonStorageBackend implements StorageBackend {
  // 已打开的单元：单元名 → 单元句柄。
  private readonly open = new Map<string, KvUnit>()
  // Reserved synchronously at open() entry so a concurrent open of the same
  // unit fails, and close() can await opens still in flight.
  // 中文说明：opening 槽位在 open() 入口同步占位——同名单元并发 open 会失败，
  // 而且 close() 可以等待仍在途的 open 完成。
  private readonly opening = new Map<string, Promise<KvUnit>>()
  // 关闭标记：关闭后拒绝一切新的 open。
  private closed = false

  // 根目录（配置传入）。
  constructor(private readonly root: string) {}

  // kv 能力实现：open 单元。
  readonly kv: KvFacet = {
    // The body up to the first await runs synchronously, so the opening-slot
    // reservation below still excludes a concurrent open of the same unit.
    // 中文说明：第一个 await 之前的主体是同步执行的，所以下面的 opening 槽位
    // 占位依然能挡住同名单元的并发 open。
    open: async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
      if (this.closed) throw new StorageError('closed', 'json backend is closed')
      validateDescriptor(descriptor)
      if (this.open.has(descriptor.name) || this.opening.has(descriptor.name)) {
        // Double-open is a caller bug, not a medium condition.
        // 中文说明：重复打开是调用方 bug，而不是介质问题。
        throw new Error(`unit '${descriptor.name}' is already open; a unit has exactly one live handle`)
      }
      const opening = this.openUnit(descriptor)
      this.opening.set(descriptor.name, opening)
      // open 结束后（无论成败）释放槽位。
      return opening.finally(() => this.opening.delete(descriptor.name))
    },
  }

  // 真正打开单元：建目录 → 计算文件路径 → 打开（不存在则延迟物化）→ 若期间后端已
  // 关闭则关掉刚打开的单元并抛错，否则登记进 open 表。
  private async openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const path = join(this.root, `${descriptor.name}.json`)
    const unit = await openJsonUnit(descriptor, path, () => this.open.delete(descriptor.name))
    if (this.closed) {
      // The backend closed while this open was in flight: do not hand out a
      // live unit past close().
      // 中文说明：open 在途期间后端已关闭：不能把"越过 close()"的活单元交出去。
      await unit.close()
      throw new StorageError('closed', 'json backend is closed')
    }
    this.open.set(descriptor.name, unit)
    return unit
  }

  // 关闭后端：置关闭标记 → 等所有在途 open 结束 → 逐个关闭已打开单元。
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
    }
    await Promise.allSettled([...this.opening.values()])
    for (const unit of [...this.open.values()]) {
      await unit.close()
    }
  }
}

// 打开前校验单元名与表名：不合法的名字在写文件前就拒绝（malformed-medium）。
function validateDescriptor(descriptor: KvUnitDescriptor): void {
  if (!UNIT_NAME_RE.test(descriptor.name)) {
    throw new StorageError('malformed-medium', `invalid unit name '${descriptor.name}'`)
  }
  for (const table of descriptor.tables) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new StorageError('malformed-medium', `invalid table name '${table}' in unit '${descriptor.name}'`)
    }
  }
}

/**
 * Register the `json` backend on the storage hub.
 * @param ctx - Plugin context.
 * @param config - Validated configuration.
 */
/*
 * 把 json 后端注册到存储枢纽：登记 backend 名，并提供同名生命周期服务键；
 * 卸载时先注销名字再关闭后端（关闭由本插件负责，符合注册表约定）。
 * @param ctx 插件上下文。
 * @param config 已校验的配置。
 */
export function apply(ctx: Context, config: Config) {
  const backend = new JsonStorageBackend(config.root)
  ctx.effect(() => {
    const unregister = ctx.storage.backend.register('json', backend)
    return async () => {
      unregister()
      await backend.close()
    }
  })
  ctx.provide(storageBackendServiceKey('json'), backend)
}
