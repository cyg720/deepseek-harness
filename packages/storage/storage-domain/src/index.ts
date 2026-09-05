
/**
 * Domain data form (`ctx.storage.domain`): schema-validated, change-emitting
 * KV domains over storage backends. The single implementation of the domain
 * layer — consumers depend on this package and never touch backends directly.
 * Plugin `Config` is schemastery; record schemas inside domain specs are zod
 * (see `src/spec.ts` for the split rationale).
 * @module @deepseek-ai/dsh-storage-domain
 */
/*
 * 模块总览：本文件是领域层的门面与插件入口。消费者只依赖本包，绝不直接碰后端；
 * 类型化访问（ctx.storage.domain.open(spec)）与运行时实现（DomainImpl）在这里汇合。
 */

/*
 * 【文件职责】提供经过 schema 校验的领域键值存储及变更通知，消费者通过领域层访问后端而不直接操作存储介质。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { DomainError } from './error.ts'
import { descriptorOf } from './spec.ts'
import type { DomainSpec } from './spec.ts'
import { DomainImpl } from './domain.ts'
import type { Domain } from './domain.ts'

// 以下是本包的对外再导出（桶导出）：错误、声明工具、类型一次性暴露给依赖方。
export { DomainError } from './error.ts'
export type { DomainErrorCode, DomainErrorOptions, InvalidRecordDetail } from './error.ts'
export { defineDomain, domainTable, descriptorOf } from './spec.ts'
export type {
  DomainSpec, DomainGlobalSpec, DomainTableSpec,
  TableKeyOf, TableValueOf, GlobalValueOf,
} from './spec.ts'
export type { DomainChanged } from './events.ts'
export type { Domain, DomainGlobal, DomainGlobalHandleOf, KvTable } from './domain.ts'

// 声明合并：把 domain 形态挂到 dsh-storage 的 StorageForms 与 Cordis 的 Context 上，
// 让 ctx.storage.form('domain') 与 ctx.storageDomain 拥有正确类型。
declare module '@deepseek-ai/dsh-storage' {
  interface StorageForms {
    domain: DomainFacility
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    storageDomain: DomainFacility
  }
}

/** Cordis plugin name. */
/* 插件名：加载本插件后，ctx.storageDomain 可用。 */
export const name = 'storage-domain'
/** The storage hub must be present before the form can mount. */
/* 依赖注入声明：必须已有 storage 枢纽（hub）服务，本形态才能挂载。 */
export const inject = ['storage']

/**
 * Plugin config. Which backend serves which domain is decided here, not
 * globally on the hub: `backend` is the default route and `routes` overrides
 * it per domain name. A route naming an unregistered backend fails loud at
 * `open` with `backend-not-found`.
 */
/*
 * 插件配置：哪个后端服务哪个领域在这里决定，而不是在枢纽上全局决定。
 * backend 是默认路由，routes 按领域名覆盖；路由到未注册后端会在 open 时
 * 以 backend-not-found 立刻报错（fail loud）。
 */
export interface Config {
  /** Default backend name for every domain without an explicit route. Required: there is no universally correct medium. */
  /* 没有显式路由的领域使用的默认后端名。必填：因为不存在"放之四海皆准"的介质选择。 */
  backend: string
  /** Per-domain overrides: domain name → backend name. */
  /* 按领域的覆盖：域名 → 后端名。 */
  routes?: Record<string, string>
}

// schemastery 版本的 Config 校验器：插件加载时框架用它校验并给出默认值。
export const Config: z<Config> = z.object({
  backend: z.string().required(),
  routes: z.dict(z.string()).default({}),
})

/**
 * The mounted domain facility. Opens declared domains over routed backends;
 * one facility instance owns the open-domain table and enforces single-open
 * per domain name.
 */
/*
 * 已挂载的领域门面：把声明好的领域打开到路由的后端上。一个 facility 实例拥有
 * 打开的领域表，并强制"每个领域名同时只打开一个"。
 */
export class DomainFacility {
  // 已打开的领域：域名 → 领域运行时。
  private readonly domains = new Map<string, DomainImpl>()
  /** Names reserved by an in-flight or completed open, so concurrent opens of one name fail loud. */
  /* 被"进行中或已完成"的 open 占用的名字：同一名字并发 open 会立刻报错（fail loud）。 */
  private readonly reserved = new Set<string>()

  /**
   * @param ctx - Context of the domain plugin; open-domain effects and change
   * events attach here.
   * @param config - Validated plugin config.
   */
  /*
   * @param ctx 领域插件的上下文：打开领域的副作用与变更事件都挂在这里。
   * @param config 已校验的插件配置（后端路由表）。
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}

  /**
   * Open one declared domain. Steps, each failing the whole call: reject a
   * name that is already open (`already-open`); resolve the backend route
   * (`backend-not-found` passes through from the hub); require its `kv` facet
   * (`facet-unsupported`); open the unit projected from the spec (backend
   * `version-mismatch`/`malformed-medium` pass through); load and validate
   * every stored record against the spec's zod schemas (`invalid-record`
   * with the offending table and key — unless the spec declares
   * `invalidRecords: 'backup-and-skip'` and the unit can move documents aside, in
   * which case the failing record is backed up, logged, and skipped);
   * construct the domain.
   *
   * Lifecycle: the CALLER owns the returned handle and closes it via
   * `Domain.close()` (typically as its own `ctx.effect` disposer) — the
   * facility does not tie the domain to any consumer fiber. Domains still
   * open when the facility unmounts are closed by the plugin disposer.
   * @param spec - The domain declaration, typically from `defineDomain`.
   * @returns the opened domain handle, typed by the spec.
   */
  /*
   * 打开一个已声明的领域。每一步失败都会让整个调用失败（按序）：
   * 拒绝已打开的名字（already-open）→ 解析后端路由（backend-not-found 从枢纽穿透）→
   * 要求后端有 kv 能力（facet-unsupported）→ 用 spec 投影出的描述符打开单元
   * （version-mismatch/malformed-medium 穿透）→ loadAll 并逐条按 spec 的 zod schema
   * 校验（invalid-record，附带出错的表与键）→ 构造领域。
   * 生命周期：调用方拥有返回的句柄并通过 Domain.close() 关闭（通常作为自己的
   * ctx.effect 注销函数）；facility 不把领域绑定到任何消费者协程。facility 卸载时
   * 由插件注销函数关闭仍开着的领域。
   * @param spec 领域声明（通常来自 defineDomain）。
   * @returns 已打开的领域句柄，类型由 spec 决定。
   */
  async open<S extends DomainSpec>(spec: S): Promise<Domain<S>> {
    if (this.reserved.has(spec.name)) {
      throw new DomainError('already-open', `domain '${spec.name}' is already open`)
    }
    this.reserved.add(spec.name)
    try {
      // 路由解析：有显式路由用路由，否则用默认 backend。
      const backendName = this.config.routes?.[spec.name] ?? this.config.backend
      const backend = this.ctx.storage.backend.get(backendName)
      if (!backend.kv) {
        throw new DomainError(
          'facet-unsupported',
          `backend '${backendName}' routed for domain '${spec.name}' has no kv facet`,
        )
      }
      const unit = await backend.kv.open(descriptorOf(spec))
      try {
        const snapshot = await unit.loadAll()
        const tables = new Map<string, Map<string, unknown>>()
        // 按 spec 声明的每张表，把介质里的原始记录逐条 parse 进内存 Map。
        for (const [table, tableSpec] of Object.entries(spec.tables)) {
          const records = new Map<string, unknown>()
          for (const [key, raw] of Object.entries(snapshot.tables[table] ?? {})) {
            let parsed: unknown
            try {
              parsed = parseRecord(spec.name, table, key, () => tableSpec.valueSchema.parse(raw))
            } catch (error) {
              // Backup-and-skip policy (disposable derived data): move the record's
              // document aside, log the concrete failure, and open without the
              // record. Backends that cannot move a document keep the loud path.
              if (spec.invalidRecords !== 'backup-and-skip' || unit.backupRecord === undefined) throw error
              const moved = await unit.backupRecord(table, key)
              // parseRecord always wraps the zod failure as the cause.
              this.ctx.logger.error(
                `domain '${spec.name}': stored record '${key}' in table '${table}' failed schema validation; `
                + `moved to '${moved}' and treated as absent. Cause: ${String((error as DomainError).cause)}`,
              )
              continue
            }
            records.set(key, parsed)
          }
          tables.set(table, records)
        }
        // A null stored global means "never written": serve `initial` without
        // materializing it — the first `set` writes.
        // 中文说明：介质里 global 为 null 表示"从未写入"：直接提供 initial，
        // 不落盘（第一次 set 时才写）。
        const globalSpec = spec.global
        const globalValue = globalSpec === undefined
          ? undefined
          : snapshot.global === null
            ? globalSpec.initial
            : parseRecord(spec.name, '', '', () => globalSpec.schema.parse(snapshot.global))
        // The onClosed hook runs strictly after teardown completes: writes
        // landing during the drain still emit domain/changed, and the domain
        // stays resolvable (the package invariant cross-checks each event)
        // until fully closed — only then does the name free up for reopening.
        // 中文说明：onClosed 钩子严格在拆卸完成后执行：排空期间落地的写入仍发
        // domain/changed，且领域在完全关闭前一直可解析（不变式插件核对每个事件），
        // 只有完全关闭后名字才释放、允许重新打开。
        const domain: DomainImpl = new DomainImpl(this.ctx, spec, unit, tables, globalValue, () => {
          this.domains.delete(spec.name)
          this.reserved.delete(spec.name)
        })
        this.domains.set(spec.name, domain)
        // The single type-erasure point: DomainImpl is the untyped runtime,
        // Domain<S> the spec-typed view; the unknown hop is required because
        // S's conditional global-handle type stays unresolved here.
        // 中文说明：全包唯一一次类型擦除——DomainImpl 是未类型化运行时，Domain<S>
        // 是带 spec 类型的视图；必须经 unknown 中转，因为 S 的条件全局句柄类型
        // 在这里无法被静态解析。
        return domain as unknown as Domain<S>
      } catch (error) {
        // 校验等任何一步失败：已打开的单元必须关闭，避免泄漏。
        await unit.close()
        throw error
      }
    } catch (error) {
      // Any failure means the domain never registered (nothing can throw
      // after it), so releasing the name reservation is unconditional.
      // 中文说明：任何失败都意味着领域从未注册成功（注册之后没有代码会再抛错），
      // 所以无条件释放名字保留。
      this.reserved.delete(spec.name)
      throw error
    }
  }

  /**
   * Look up an open domain by name, untyped. Diagnostic surface (the package
   * invariant cross-checks change events against live domain state); typed
   * consumers hold the handle returned by {@link open}.
   * @param name - Domain name.
   * @returns the open domain runtime, or `undefined` when not open.
   */
  /*
   * 按名字查找已打开的领域（未类型化）。这是诊断面（不变式插件用它核对变更事件与
   * 领域实况）；类型化消费者应持有 open 返回的句柄。
   * @param name 领域名。
   * @returns 打开的领域运行时；未打开时返回 undefined。
   */
  get(name: string): DomainImpl | undefined {
    return this.domains.get(name)
  }

  /**
   * Close every domain still open on this facility. The unmount path for
   * consumers that never called `Domain.close()` themselves; closing is
   * idempotent, so double-closing an already-closed domain is harmless.
   * @returns resolution after every unit is released.
   */
  /*
   * 关闭本 facility 上所有仍开着的领域。这是给"从未自己调用 Domain.close()"的
   * 消费者的卸载兜底；关闭幂等，重复关闭已关领域无害。
   * @returns 所有单元释放完成后解析。
   */
  async closeAll(): Promise<void> {
    await Promise.all([...this.domains.values()].map(domain => domain.close()))
  }
}

/** Run one zod parse, translating failure to `invalid-record` with its location. */
/*
 * 执行一次 zod 校验，把失败翻译成带定位信息的 invalid-record 错误：
 * 让调用方知道"哪个领域、哪张表、哪个键"的介质数据不合法。
 */
function parseRecord<T>(domain: string, table: string, key: string, parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    const slot = table === '' ? 'global' : `record '${key}' in table '${table}'`
    throw new DomainError(
      'invalid-record',
      `domain '${domain}': stored ${slot} does not match its schema`,
      { detail: { table, key }, cause: error },
    )
  }
}

/**
 * Mount the domain data form on the storage hub.
 * @param ctx - Plugin context.
 * @param config - Validated plugin config.
 * @returns resolution after an already-available backend set activates the form.
 */
/*
 * 把领域数据形态挂到存储枢纽上：收集配置里出现的所有后端名，转成生命周期服务键
 * （storageBackendServiceKey），等它们全部就绪后再创建 facility 并挂载。
 * @param ctx 插件上下文。
 * @param config 已校验的插件配置。
 * @returns 已可用的后端集合激活形态后解析。
 */
export function apply(ctx: Context, config: Config): Promise<void> {
  // 去重收集配置中出现的后端名：默认后端 + 所有路由值。
  const backendServices = [...new Set([
    config.backend,
    ...Object.values(config.routes ?? {}),
  ])].map(storageBackendServiceKey)

  const fiber = ctx.inject(backendServices, (domainCtx) => {
    const facility = new DomainFacility(domainCtx, config)
    domainCtx.effect(() => {
      const unmount = domainCtx.storage.mount('domain', facility)
      return async () => {
        // Close leftovers before unmounting: draining writes still emit
        // domain/changed, whose invariant resolves the facility through the hub.
        // 中文说明：卸载前先关闭遗留领域——排空中的写入仍会发 domain/changed，
        // 其不变式插件要通过枢纽解析 facility，所以必须先关领域再卸载。
        await facility.closeAll()
        unmount()
      }
    })
    // 把门面暴露为 ctx.storageDomain 服务，供诊断/不变式插件使用。
    domainCtx.provide('storageDomain', facility)
  })
  return Promise.resolve(fiber).then(() => {})
}
