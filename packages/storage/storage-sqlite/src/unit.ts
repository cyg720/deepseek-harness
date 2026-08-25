/**
 * ================================ 文件注释 ================================
 * 【文件职责】一个已打开 SQLite KV 单元的实现：在 u_<单元>_<表> 记录表与共享的
 * unit_globals 表上执行预编译的逐表语句。
 * 【技术维度】每个原语只执行一条语句，原子性由 SQLite 自身保证——没有显式事务、
 * 没有写队列（按 KV 契约，写顺序是调用方责任）。值以 JSON 文本存进 value 列；
 * 预编译语句（StatementSync）在构造时准备一次、反复复用。
 * 【产品维度】SQLite 介质的"读写引擎"：打开单元即获得一组可复用的预编译语句，
 * 单语句读写天然原子，不需要应用层事务。
 * 【逻辑维度】按出现顺序：TableStatements（单表语句组）→ SqliteKvUnit（单元类：
 * 构造预编译、loadAll/putRecord/deleteRecord/setGlobal/close、settle/ensureOpen/
 * statementsFor 内部助手）。
 * 【关键边界】数据库句柄由后端拥有，这里只借用不关闭；两个名字片段都经过
 * UNIT_NAME_RE 校验，物理标识符可安全插进语句文本；JSON 解析失败映射为
 * malformed-medium；settle 把同步抛错转成 rejection（契约不同步抛错），
 * 非 Error 抛出（如 toJSON 抛的）会被包装。
 * 【新手阅读建议】先看构造函数理解预编译语句的组装，再看 loadAll 的
 * 空原型对象（防 __proto__ 污染），最后看 settle 理解"同步转异步"的契约适配。
 * ==========================================================================
 */
/**
 * One opened SQLite KV unit: prepared per-table statements over the
 * `u_<unit>_<table>` record tables plus this unit's row in the shared
 * `unit_globals` table. Each primitive is a single statement, so atomicity
 * comes from SQLite itself — no explicit transactions, and no write queue
 * (write ordering is the caller's responsibility per the KV contract).
 * @module @deepseek-ai/dsh-storage-sqlite/unit
 */
/*
 * 模块总览：本文件是 SQLite 后端的"单元运行时"。单语句 = 原子性来自 SQLite，
 * 应用层不需要事务，也没有写队列。
 */

import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { recordTableName } from './schema.ts'

/** Prepared statements for one declared table. */
/*
 * 一张已声明表对应的三句预编译语句：写入（upsert）、删除、全量读取。
 */
interface TableStatements {
  upsert: StatementSync
  remove: StatementSync
  selectAll: StatementSync
}

/**
 * The SQLite {@link KvUnit}. Constructed by the backend AFTER the unit's
 * record tables exist; statements are prepared once here and reused for every
 * primitive. Values are stored as JSON text in the `value` column.
 */
/*
 * SQLite 的 KvUnit 实现。由后端在"单元的记录表已存在之后"构造；
 * 语句在这里一次性预编译，之后每个原语复用。值以 JSON 文本存入 value 列。
 */
export class SqliteKvUnit implements KvUnit {
  // 表名 → 该表的预编译语句组。
  private readonly tables = new Map<string, TableStatements>()
  // 全局单例的写入/读取语句；描述符未声明 global 时为 undefined。
  private readonly globalUpsert: StatementSync | undefined
  private readonly globalSelect: StatementSync | undefined
  // 关闭标记：关闭后一切操作抛 closed。
  private closed = false

  /**
   * @param db - Open database handle owned by the backend (never closed here).
   * @param descriptor - Validated descriptor whose record tables already exist.
   * @param onClose - Backend callback releasing this unit's open-name slot.
   */
  /*
   * @param db 后端拥有的已打开数据库句柄（本类绝不关闭它）。
   * @param descriptor 已校验的描述符；其记录表此时已存在。
   * @param onClose 后端回调：单元关闭时释放其 open 槽位。
   */
  constructor(
    db: DatabaseSync,
    private readonly descriptor: KvUnitDescriptor,
    private readonly onClose: () => void,
  ) {
    for (const table of descriptor.tables) {
      // Both name segments are validated against UNIT_NAME_RE by the backend,
      // so the physical identifier is safe to interpolate into statement text.
      // 中文说明：两个名字片段都已由后端按 UNIT_NAME_RE 校验过，
      // 物理标识符可以安全地插进语句文本（不会引入注入）。
      const physical = recordTableName(descriptor.name, table)
      this.tables.set(table, {
        upsert: db.prepare(
          `INSERT INTO "${physical}" (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ),
        remove: db.prepare(`DELETE FROM "${physical}" WHERE key = ?`),
        selectAll: db.prepare(`SELECT key, value FROM "${physical}"`),
      })
    }
    // 全局单例语句：只有描述符声明 hasGlobal 时才准备。
    this.globalUpsert = descriptor.hasGlobal
      ? db.prepare(
        'INSERT INTO unit_globals (unit, value) VALUES (?, ?) ON CONFLICT(unit) DO UPDATE SET value = excluded.value',
      )
      : undefined
    this.globalSelect = descriptor.hasGlobal
      ? db.prepare('SELECT value FROM unit_globals WHERE unit = ?')
      : undefined
  }

  // 快照读取：全表 SELECT + 全局单例行，JSON 解析失败映射为 malformed-medium。
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    return this.settle(() => {
      const tables: Record<string, Record<string, unknown>> = {}
      for (const [name, statements] of this.tables) {
        // Null prototype: record keys are arbitrary strings, so '__proto__'
        // must land as an own property instead of mutating the prototype.
        // 中文说明：用空原型对象存记录——键是任意字符串，'__proto__' 必须落成
        // 普通自有属性，而不能触发原型污染。
        const records: Record<string, unknown> = Object.create(null) as Record<string, unknown>
        for (const row of statements.selectAll.all() as unknown as Array<{ key: string; value: string }>) {
          records[row.key] = this.parseValue(row.value, `table '${name}' key '${row.key}'`)
        }
        tables[name] = records
      }
      let global: unknown = null
      // 全局单例：单元行存在才解析（否则保持 null，即"从未写入"）。
      if (this.globalSelect !== undefined) {
        const row = this.globalSelect.get(this.descriptor.name) as { value: string } | undefined
        if (row !== undefined) global = this.parseValue(row.value, 'global slot')
      }
      return { tables, global }
    })
  }

  /** Parse one stored value column, mapping bad JSON to `malformed-medium`. */
  /* 解析一个存储的 value 列；坏 JSON 映射为 malformed-medium 错误。 */
  private parseValue(text: string, slot: string): unknown {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new StorageError(
        'malformed-medium',
        `kv unit '${this.descriptor.name}' holds unparsable JSON at ${slot}`,
        { cause: error },
      )
    }
  }

  // 写入（插入或覆盖）一条记录：单条 upsert 语句。
  putRecord(table: string, key: string, value: unknown): Promise<void> {
    return this.settle(() => {
      this.statementsFor(table).upsert.run(key, JSON.stringify(value))
    })
  }

  // 删除一条记录：单条 DELETE；键不存在时 SQLite 自然无操作（幂等）。
  deleteRecord(table: string, key: string): Promise<void> {
    return this.settle(() => {
      this.statementsFor(table).remove.run(key)
    })
  }

  // 写入全局单例：未声明 global 槽位是调用方 bug（抛普通 Error）。
  setGlobal(value: unknown): Promise<void> {
    return this.settle(() => {
      if (this.globalUpsert === undefined) {
        throw new Error(`kv unit '${this.descriptor.name}' declared no global slot`)
      }
      this.globalUpsert.run(this.descriptor.name, JSON.stringify(value))
    })
  }

  // 关闭单元：幂等。首次调用置关闭标记并通知后端释放槽位（数据库由后端统一关闭）。
  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.onClose()
    }
    return Promise.resolve()
  }

  /**
   * Run one synchronous primitive behind the closed guard, mapping a throw to
   * a rejection so the Promise-returning contract never throws synchronously.
   */
  /*
   * 在关闭守卫之后执行一个同步原语，并把同步抛错转成 rejection——
   * 这样"返回 Promise"的契约永远不会同步抛错（异步边界统一）。
   */
  private settle<T>(operation: () => T): Promise<T> {
    try {
      this.ensureOpen()
      return Promise.resolve(operation())
    } catch (error) {
      // Non-Error throws can only enter through JSON.stringify propagating a
      // value's own toJSON throw; wrap those, preserve every real Error.
      // 中文说明：非 Error 抛出只能来自 JSON.stringify 传播的 toJSON 抛错；
      // 把这类包装成 Error，真正的 Error 则原样保留。
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  // 打开守卫：已关闭的单元拒绝一切操作（closed 错误）。
  private ensureOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `kv unit '${this.descriptor.name}' is closed`)
    }
  }

  // 取一张表的语句组；未声明表是调用方 bug（抛普通 Error）。
  private statementsFor(table: string): TableStatements {
    const statements = this.tables.get(table)
    if (statements === undefined) {
      throw new Error(`kv unit '${this.descriptor.name}' declared no table '${table}'`)
    }
    return statements
  }
}
