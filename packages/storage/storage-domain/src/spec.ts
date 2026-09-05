/**
 * Domain declaration vocabulary. A spec object is the single source of a
 * domain's identity, layout, and record schemas: the owning package defines
 * it once with {@link defineDomain} and both the type surface and the runtime
 * (validation, descriptor projection) derive from it. Record schemas are zod
 * (`z.infer` keeps types un-duplicated and the same schemas later project to
 * RPC wire schemas); plugin `Config` stays schemastery.
 * @module @deepseek-ai/dsh-storage-domain/src/spec
 */

/*
 * 【文件职责】以单个领域声明集中定义身份、布局和记录 schema，使静态类型与运行时验证从同一来源派生。
 */

import type { ZodType } from 'zod'
import { UNIT_NAME_RE, type KvUnitDescriptor } from '@deepseek-ai/dsh-storage'

/** Global singleton declaration: schema plus the value used before the first write. */
/*
 * 全局单例（global）的声明：领域里一个可选的"全局唯一值"槽位。
 * 与表不同，它不是按键存取的集合，而是整个领域只有一个值（例如一段全局配置）。
 * schema 负责校验该值，initial 负责在介质尚无该值时兜底。
 */
export interface DomainGlobalSpec<G> {
  /** Validates the stored global at the durable boundary. */
  /* 在持久化边界校验存储的 global 值：介质里的原始数据必须符合它才能被读取。 */
  readonly schema: ZodType<G>
  /** Value served when the medium holds no global yet; not written until the first `set`. */
  /* 介质中还没有 global 时对外提供的初始值；该值不会写入介质，直到第一次 set 才落盘。 */
  readonly initial: G
}

/**
 * One table declaration. `K` is a phantom key type (typically a branded
 * string) carried for compile-time projection only; keys are plain strings on
 * the medium.
 */
/*
 * 单张"表"（table）的声明：表是一组"字符串键 → 结构化记录"的集合，类似数据库表。
 * K 是"幻影键类型"（phantom type）：只在编译期把键的类型（通常是 Branded 字符串）
 * 带给使用者，运行时介质里的键始终是普通字符串。V 是记录值的类型。
 */
export interface DomainTableSpec<K extends string = string, V = unknown> {
  /** Validates every stored record at the durable boundary. */
  /* 在持久化边界校验每条存储记录；记录 schema 用 zod 编写，同一 schema 日后可投影成 RPC schema。 */
  readonly valueSchema: ZodType<V>
  /** Phantom carrier for the key type; never present at runtime. */
  /* 键类型的"幻影载体"：只用来让 TypeScript 记住键的类型，运行时不存在该字段。 */
  readonly __key?: K
}

/** Static declaration of one domain: identity, version, and record layout. */
/*
 * 一个领域的静态声明：身份（name）、格式版本（version）与记录布局（tables/global）。
 * 它是整个领域定义的"唯一事实来源"：类型派生与运行时行为都由它决定。
 */
export interface DomainSpec {
  /** Domain name; must match `UNIT_NAME_RE` (doubles as the backend unit name). */
  /* 领域名；必须匹配 UNIT_NAME_RE（该正则约束也决定了它可作后端单元名，即介质上的存储单元名）。 */
  readonly name: string
  /** Current domain format version; reads enforce it according to the selected layout. */
  readonly version: number
  /**
   * Medium layout for the backend unit: `single` (the default) stores the
   * whole unit as one document; `per-record` stores each record as its own
   * document, for units whose records are large, sparse, or individually
   * disposable — the projection cache — and scopes version checks per record
   * (an unaccepted record document is discarded, never migrated).
   */
  readonly layout?: 'single' | 'per-record'
  /**
   * Older domain versions whose stored records the current record schemas
   * also accept (the declaring owner vouches for that, typically by
   * declaring the fields older records lack as optional). `per-record` backends
   * read documents stamped with a listed version instead of discarding them,
   * and accept a legacy whole-unit file so stamped for the one-time
   * bootstrap; writes always stamp {@link version}.
   */
  readonly compatibleVersions?: readonly number[]
  /**
   * What `open` does with a stored table record that fails its zod schema.
   * Absent (the default), the whole open rejects with `invalid-record` —
   * right for authoritative data. `'backup-and-skip'` is for domains whose
   * records are disposable derived data: the backend moves the record's
   * document aside (`KvUnit.backupRecord`), the failure is logged with
   * its cause, and the open continues with the record absent. A backend
   * without `backupRecord` (no per-record document to move) falls back
   * to the rejecting default. The global slot always rejects.
   */
  readonly invalidRecords?: 'backup-and-skip'
  /** Optional global singleton slot. */
  /* 可选的全局单例槽位；不声明就没有 global。 */
  readonly global?: DomainGlobalSpec<unknown>
  /** Table declarations keyed by table name; each name must match `UNIT_NAME_RE`. */
  /* 表声明集合，以表名为键；每个表名都必须匹配 UNIT_NAME_RE。 */
  readonly tables: Record<string, DomainTableSpec>
}

/** Key type of one declared table, recovered from its phantom carrier. */
/*
 * 从领域声明 S 与表名 N 反推出该表的键类型（取自幻影载体）。条件类型（conditional type）
 * 是 TypeScript 在"类型层面"的 if/else，这里用 extends 判断并取出 infer 推断的类型。
 */
export type TableKeyOf<S extends DomainSpec, N extends keyof S['tables']> =
  S['tables'][N] extends DomainTableSpec<infer K> ? K : never

/** Value type of one declared table. */
/* 从领域声明 S 与表名 N 反推出该表的记录值类型。 */
export type TableValueOf<S extends DomainSpec, N extends keyof S['tables']> =
  S['tables'][N] extends DomainTableSpec<string, infer V> ? V : never

/** Global value type of a spec; `never` when the spec declares no global. */
/*
 * 反推出领域声明的 global 值类型；声明中没有 global 时结果是 never。
 * never 表示"该类型不存在"：此时访问 global 的代码会在编译期报错，起到类型防线作用。
 */
export type GlobalValueOf<S extends DomainSpec> =
  S['global'] extends DomainGlobalSpec<infer G> ? G : never

/**
 * Declare one table.
 * @param schema - zod schema validating every stored record of this table.
 * @returns the table declaration, key-typed by `K`.
 */
/*
 * 声明一张表的辅助函数：给定记录值的 zod schema，返回该表的声明对象。
 * K 泛型由调用方显式给出（或由上下文推断），决定这张表的键类型。
 * 使用示例：domainTable<SessionId, Session>(sessionSchema)
 * @param schema 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function domainTable<K extends string, V>(schema: ZodType<V>): DomainTableSpec<K, V> {
  return { valueSchema: schema }
}

/**
 * Identity helper that pins a spec's literal types and validates its fields.
 * Misconfiguration fails loud at the owning package's module load, before any
 * medium is touched: a domain or table name outside `UNIT_NAME_RE`, a version
 * that is not a non-negative integer, or a global schema that accepts `null`
 * all throw. The `null` rejection guards round-tripping: backends store the
 * global as opaque JSON with `null` as the "never written" sentinel, so a
 * nullable global would be indistinguishable from an absent one on reopen
 * (a stored `null` silently reverts to `initial`).
 * @param spec - The domain declaration.
 * @returns the same spec, narrowed to its literal type.
 */
/*
 * 领域声明入口：既"钉住"声明的字面量类型（让 TypeScript 保留精确的 name/version 字面量），
 * 又做加载期校验，使错误配置在所属包模块加载时就立刻报错（fail loud），而不是等到读写介质才暴露。
 * 校验点：域名、表名必须匹配 UNIT_NAME_RE；version 必须是非负整数；global 的 schema 不得接受 null。
 * 拒绝 null 的原因：后端把 global 存成不透明 JSON，并用 null 表示"从未写入"，若 schema 允许 null，
 * 重开后存进去的 null 与"未写入"无法区分，会悄悄回退成 initial。
 * @param spec 领域声明对象（通常由领域拥有者构造）。
 * @returns 原样返回同一个 spec，但类型被收窄为字面量类型。
 */
export function defineDomain<S extends DomainSpec>(spec: S): S {
  if (!UNIT_NAME_RE.test(spec.name)) {
    throw new Error(`domain name '${spec.name}' must match ${UNIT_NAME_RE}`)
  }
  if (!Number.isInteger(spec.version) || spec.version < 0) {
    throw new Error(`domain '${spec.name}' version must be a non-negative integer, got ${spec.version}`)
  }
  for (const compat of spec.compatibleVersions ?? []) {
    if (!Number.isInteger(compat) || compat < 0 || compat >= spec.version) {
      throw new Error(
        `domain '${spec.name}' compatibleVersions entries must be non-negative integers below version ${spec.version}, got ${compat}`,
      )
    }
  }
  if (spec.layout !== undefined) {
    // Runtime boundary: the union type is compile-time only — a spec built
    // from config could carry any value, and a bad one must fail loud here.
    const layout: string = spec.layout
    if (layout !== 'single' && layout !== 'per-record') {
      throw new Error(`domain '${spec.name}' layout must be 'single' or 'per-record', got ${layout}`)
    }
  }
  if (spec.invalidRecords !== undefined) {
    const policy: string = spec.invalidRecords
    if (policy !== 'backup-and-skip') {
      throw new Error(`domain '${spec.name}' invalidRecords must be 'backup-and-skip' when present, got ${policy}`)
    }
  }
  for (const table of Object.keys(spec.tables)) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new Error(`domain '${spec.name}' table name '${table}' must match ${UNIT_NAME_RE}`)
    }
  }
  if (spec.global !== undefined && spec.global.schema.safeParse(null).success) {
    throw new Error(
      `domain '${spec.name}' global schema must not accept null: `
      + 'null is the medium\'s "never written" sentinel, so a stored null could not round-trip',
    )
  }
  return spec
}

/**
 * Project a spec onto the backend-facing unit descriptor.
 * @param spec - The domain declaration.
 * @returns the descriptor handed to `KvFacet.open`.
 */
/*
 * 把领域声明"投影"成后端面对的描述符：后端（SQLite、JSON 文件等介质）只认这个最小结构，
 * 不关心 zod schema 等上层细节。KvFacet.open 用该描述符打开对应单元。
 * @param spec 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function descriptorOf(spec: DomainSpec): KvUnitDescriptor {
  return {
    name: spec.name,
    version: spec.version,
    tables: Object.keys(spec.tables),
    hasGlobal: spec.global !== undefined,
    ...spec.layout === undefined ? {} : { layout: spec.layout },
    ...spec.compatibleVersions === undefined ? {} : { compatibleVersions: spec.compatibleVersions },
  }
}
