
/**
 * Backend-facing vocabulary of the storage hub: a backend owns one medium
 * (a file-tree root, a database file) and exposes operation groups over it.
 * This module defines the normative contract text for backend implementers; the shared
 * conformance suite in `tests/contract.ts` checks every rule.
 * @module @deepseek-ai/dsh-storage/src/backend
 */
/*
 * 模块总览：本文件是后端实现者的"规范契约"。tests/contract.ts 提供共享的一致性测试套件，
 * 每个后端实现都要通过它，确保行为一致。
 */

/** Allowed format for unit and table names: safe as a file name and as a SQL identifier segment without escaping. */
/*
 * 单元名与表名的合法格式：小写字母开头，只含小写字母/数字/下划线。
 * 该约束保证名字既可安全用作文件名，也可不加转义地用作 SQL 标识符片段（双保险）。
 */

/*
 * 【文件职责】定义存储后端的介质与操作组接口，统一实现者在命名、读取、写入和持久化方面的义务。
 */

export const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/

/**
 * One registered backend. A backend owns exactly one medium and shares its
 * lifecycle across all facets; facets are optional members — a backend that
 * cannot serve a data kind simply omits it, and resolution fails loud instead.
 */
/*
 * 一个已登记的后端。后端只拥有一个介质，所有 facet 共享它的生命周期；
 * facet 是可选成员——不能提供某种数据能力的后端直接省略该成员，解析时立刻报错（fail loud）。
 */
export interface StorageBackend {
  /** Key-value operations; absent when this backend cannot serve them. */
  /* 键值操作组；后端无法提供该能力时此字段不存在。 */
  readonly kv?: KvFacet

  /**
   * Drain in-flight writes across all open units and release the medium.
   * Idempotent; concurrent and repeated calls resolve once teardown finishes.
   * @returns resolution after the medium is released.
   */
  /*
   * 排空所有打开单元的在途写入并释放介质。幂等：并发或重复调用都会在拆卸完成后解析。
   * @returns 介质释放完成后解析。
   */
  close(): Promise<void>
}

/** The key-value data shape: whole-unit snapshots plus per-record durable writes. */
/*
 * 键值数据形态：整单元快照读取 + 逐记录持久化写入。
 */
export interface KvFacet {
  /**
   * Open one unit, creating it when the medium holds no trace of it yet
   * (materialization may defer to the first write, but {@link KvUnit.loadAll}
   * must immediately serve the empty shape). A version already stamped on the
   * medium that differs from `descriptor.version` rejects with
   * `version-mismatch`; a medium that cannot be parsed as this unit rejects
   * with `malformed-medium`. Opening the same unit name twice without closing
   * is a caller bug and rejects.
   * @param descriptor - Static identity and shape of the unit to open.
   * @returns the opened unit.
   */
  /*
   * 打开一个单元：介质上还没有它的痕迹时创建（物化可以推迟到首次写入，但 loadAll
   * 必须立刻提供空形态）。介质上已盖的版本戳与 descriptor.version 不一致 → version-mismatch；
   * 介质无法按该单元解析 → malformed-medium；未关闭就重复打开同名单元是调用方 bug，会拒绝。
   * @param descriptor 要打开单元的静态身份与形态。
   * @returns 已打开的单元。
   */
  open(descriptor: KvUnitDescriptor): Promise<KvUnit>
}

/** Static identity and shape of one KV unit, projected from its owner's spec. */
/*
 * 一个 KV 单元的静态身份与形态（由拥有者的 spec 投影而来）。
 */
export interface KvUnitDescriptor {
  /** Unit name; must match {@link UNIT_NAME_RE}. Also the file-name / SQL-identifier segment. */
  /* 单元名；必须匹配 UNIT_NAME_RE。同时是文件名/SQL 标识符片段。 */
  readonly name: string
  /** Unit format version; a non-negative integer stamped on the medium at first materialization. */
  /* 单元格式版本：首次物化时盖在介质上的非负整数，用于拒绝不兼容的旧介质。 */
  readonly version: number
  /** Table names; each must match {@link UNIT_NAME_RE}. */
  /* 表名清单；每个都必须匹配 UNIT_NAME_RE。 */
  readonly tables: readonly string[]
  /** Whether this unit carries the global singleton slot. */
  /* 该单元是否带全局单例槽位。 */
  readonly hasGlobal: boolean
  /**
   * Medium layout. `single` (the default) keeps the whole unit in one
   * document; `per-record` keeps each record in its own document, so a unit
   * whose records are large or sparse never rewrites the rest on one write,
   * and an unaccepted version stamp discards only that record instead of
   * rejecting the whole unit. Backends that only serve one layout accept the
   * other's units as foreign documents.
   */
  readonly layout?: 'single' | 'per-record'
  /**
   * Older unit versions whose stored records are also readable under the
   * declaring owner's current record schemas (the owner vouches for that —
   * typically by declaring the fields old records lack as optional). Reads of
   * a `per-record` unit accept documents stamped with any listed version, and
   * the legacy whole-unit bootstrap accepts a legacy file stamped with one;
   * writes always stamp {@link version}. `single`-layout reads stay
   * exact-version.
   */
  readonly compatibleVersions?: readonly number[]
}

/**
 * One opened unit. Values are opaque JSON to this layer: no schema, no
 * events, no domain meaning. The unit does NOT serialize concurrent writes —
 * write ordering is the caller's responsibility (the domain layer runs one
 * write chain per unit); the unit only guarantees that each single call is
 * atomic on the medium and durable once resolved (a crash after resolution
 * followed by a re-open observes the write). Any call after {@link close}
 * rejects with `closed`.
 */
/*
 * 一个已打开的单元。对本层而言值是不透明 JSON：无 schema、无事件、无领域含义。
 * 单元不序列化并发写——写入顺序是调用方责任（领域层按单元跑一条写链）；
 * 单元只保证每次单调用在介质上原子、且解析后已持久化（解析后崩溃、再重开能看到这次写入）。
 * 任何对已关闭单元的调用都以 closed 拒绝。
 */
export interface KvUnit {
  /**
   * Read the full current snapshot.
   * @returns every table's records keyed by table name, plus the global
   * singleton (`null` when never written or not declared).
   */
  /*
   * 读取当前完整快照。
   * @returns 每张表的记录（按表名分组），外加全局单例（从未写入或未声明时为 null）。
   */
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>

  /**
   * Upsert one record durably. Overwrite semantics: an existing key is replaced.
   * @param table - Declared table name.
   * @param key - Record key. In the `per-record` layout a key becomes a path
   * segment and must match `[a-zA-Z0-9_-]+` (an unsafe key rejects); in the
   * `single` layout keys stay opaque.
   * @param value - Opaque JSON-serializable record.
   * @returns resolution after durability.
   */
  /*
   * 持久化写入（插入或覆盖）一条记录。
   * @param table 已声明的表名。
   * @param key 记录键；任意字符串都安全（键永远不会拼进文件路径）。
   * @param value 不透明、可 JSON 序列化的记录。
   * @returns 持久化完成后解析。
   */
  putRecord(table: string, key: string, value: unknown): Promise<void>

  /**
   * Delete one record durably. Idempotent: a missing key is a no-op.
   * @param table - Declared table name.
   * @param key - Record key.
   * @returns resolution after durability.
   */
  /*
   * 持久化删除一条记录。幂等：键不存在时什么都不做。
   * @param table 已声明的表名。
   * @param key 记录键。
   * @returns 持久化完成后解析。
   */
  deleteRecord(table: string, key: string): Promise<void>

  /**
   * Move one record's stored document out of the unit's readable set,
   * preserving its bytes for inspection instead of deleting them. Backends
   * whose medium has no per-record document to move (the `single` layout, a
   * row store) omit this member, and the caller falls back to its
   * reject-loud path. Absent after the move: a later {@link loadAll} reads
   * the key as missing and a later {@link putRecord} recreates it fresh.
   * @param table - Declared table name.
   * @param key - Record key.
   * @returns the medium location the document was moved to (diagnostics).
   */
  backupRecord?(table: string, key: string): Promise<string>

  /**
   * Write the global singleton durably. Only valid when the descriptor
   * declared `hasGlobal`.
   * @param value - Opaque JSON-serializable value.
   * @returns resolution after durability.
   */
  /*
   * 持久化写入全局单例。仅当描述符声明了 hasGlobal 时有效。
   * @param value 不透明、可 JSON 序列化的值。
   * @returns 持久化完成后解析。
   */
  setGlobal(value: unknown): Promise<void>

  /**
   * Drain this unit's in-flight writes and release it. Idempotent.
   * @returns resolution after the unit is released.
   */
  /*
   * 排空本单元的在途写入并释放它。幂等。
   * @returns 单元释放完成后解析。
   */
  close(): Promise<void>
}
