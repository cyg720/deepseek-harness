/**
 * ================================ 文件注释 ================================
 * 【文件职责】一个已打开 JSON 单元的读写实现：内存态是权威，每次写原语先改内存、
 * 再以"整文件原子重写"重新发布整个文件。
 * 【技术维度】实现 KvUnit 接口；发布走 writeAtomic（同目录临时文件 + fsync + rename，
 * 见 atomic.ts）；发布失败会回滚内存（内存权威，失败的写不能留在内存里搭下次发布的车）。
 * 写不排队——按后端契约，写顺序属于调用方（领域层的写链）。
 * 【产品维度】JSON 介质的"读写引擎"：保证每次单调用发布出完整、持久的文件，
 * 崩溃后重开读到的是最后一次成功发布的状态。
 * 【逻辑维度】按出现顺序：openJsonUnit（打开或懒创建）→ JsonKvUnit（单元类：字段、
 * loadAll/putRecord/deleteRecord/setGlobal/close/assertOpen/records/publish）。
 * 【关键边界】内存权威意味着"先改内存、发布失败回滚"；close 幂等且先等所有在途发布；
 * 未声明表/未声明 global 的写入是调用方 bug（抛普通 Error）；关闭后调用抛 closed。
 * 【新手阅读建议】先看 openJsonUnit 理解"文件缺失 = 空单元"的懒物化，再看 putRecord
 * 的回滚路径理解内存权威，最后看 publish 理解在途发布追踪。
 * ==========================================================================
 */
/**
 * One opened JSON unit. The in-memory state is authoritative; every write
 * primitive mutates it and republishes the whole file atomically. Writes are
 * NOT queued here — per the backend contract, write ordering belongs to the
 * caller (the domain layer's write chain); this unit only guarantees that
 * each single call publishes a complete, durable file.
 * @module @deepseek-ai/dsh-storage-json/src/unit
 */
/*
 * 模块总览：本文件是 JSON 后端的"单元运行时"。注意写不排队：并发写由领域层
 * 的写链串行化，本单元只承诺"单次调用发布出完整、持久的文件"。
 */

import { readFile } from 'node:fs/promises'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { writeAtomic } from './atomic.ts'
import { parse, serialize } from './format.ts'
import type { UnitState } from './format.ts'

/**
 * Open (load or lazily create) one unit backed by `path`.
 * @param descriptor - Static identity and shape of the unit.
 * @param path - Absolute unit file path under the backend root.
 * @param onClose - Backend callback releasing the unit's open-slot.
 * @returns the opened unit.
 */
/*
 * 打开（加载或懒创建）一个由 path 支撑的单元。
 * 文件存在 → parse 成内存态；文件不存在（ENOENT）→ 返回空形态的单元，
 * 物化推迟到首次写入。
 * @param descriptor 单元的静态身份与形态。
 * @param path 后端根目录下的单元文件绝对路径。
 * @param onClose 后端回调：单元关闭时释放其 open 槽位。
 * @returns 已打开的单元。
 */
export async function openJsonUnit(
  descriptor: KvUnitDescriptor,
  path: string,
  onClose: () => void,
): Promise<KvUnit> {
  let text: string | undefined
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Missing file = empty unit; materialization defers to the first write.
    // 中文说明：文件缺失 = 空单元；物化（真正落盘）推迟到首次写入。
  }
  const state: UnitState =
    text === undefined
      ? {
        version: descriptor.version,
        global: null,
        tables: new Map(descriptor.tables.map(table => [table, new Map<string, unknown>()])),
      }
      : parse(text, descriptor)
  return new JsonKvUnit(descriptor, path, state, onClose)
}

// 单元实现：所有操作先改内存（state），再发布整个文件；发布失败回滚内存。
class JsonKvUnit implements KvUnit {
  // 关闭标记：关闭后一切操作抛 closed。
  private closed = false
  /** In-flight publishes; close() drains them before releasing the unit. */
  /* 在途发布集合：close() 在释放单元前先等它们全部结束。 */
  private readonly inFlight = new Set<Promise<void>>()

  constructor(
    private readonly descriptor: KvUnitDescriptor,
    private readonly path: string,
    private readonly state: UnitState,
    private readonly onClose: () => void,
  ) {}

  // 中文说明（本注释须位于 oxlint 豁免 pragma 的上方）：loadAll 同步快照整个内存态：
  // 每张表转成普通对象、附带 global 值。async 关键字让关闭守卫表现为 rejection 而非同步抛出。
  // oxlint-disable-next-line typescript/require-await -- async keeps the closed guard a rejection, not a synchronous throw
  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen()
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [table, records] of this.state.tables) {
      tables[table] = Object.fromEntries(records)
    }
    return { tables, global: this.state.global }
  }

  // 写入（插入或覆盖）一条记录：改内存 → 发布；失败时回滚内存并重抛。
  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    const records = this.records(table)
    const hadKey = records.has(key)
    const previous = records.get(key)
    records.set(key, value)
    // Roll back on a failed publish: memory is authoritative, so a rejected
    // write must not survive in memory (or ride along with the next publish).
    // 中文说明：发布失败要回滚内存——内存是权威，被拒的写不能残留在内存里，
    // 也不能搭下一次发布的车写到盘上。
    await this.publish().catch((error: unknown) => {
      if (hadKey) records.set(key, previous)
      else records.delete(key)
      throw error
    })
  }

  // 删除一条记录：记录不存在直接返回；存在则删内存并发布，失败回滚。
  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    const records = this.records(table)
    if (!records.has(key)) return
    const previous = records.get(key)
    records.delete(key)
    await this.publish().catch((error: unknown) => {
      records.set(key, previous)
      throw error
    })
  }

  // 写入全局单例：未声明 global 槽位的单元是调用方 bug（抛普通 Error）。
  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    if (!this.descriptor.hasGlobal) {
      throw new Error(`unit '${this.descriptor.name}' does not declare a global slot`)
    }
    const previous = this.state.global
    this.state.global = value
    await this.publish().catch((error: unknown) => {
      this.state.global = previous
      throw error
    })
  }

  // 关闭单元：幂等。首次调用置关闭标记并等所有在途发布结束，然后通知后端释放槽位。
  async close(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled(this.inFlight)
      return
    }
    this.closed = true
    await Promise.allSettled(this.inFlight)
    this.onClose()
  }

  // 打开守卫：已关闭的单元拒绝一切操作（closed 错误）。
  private assertOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `unit '${this.descriptor.name}' is closed`)
    }
  }

  // 取一张表的记录 Map；未声明表是调用方 bug（抛普通 Error）。
  private records(table: string): Map<string, unknown> {
    const records = this.state.tables.get(table)
    if (!records) {
      throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`)
    }
    return records
  }

  // 发布：把当前内存态序列化后原子写盘，并登记进 inFlight 供 close 等待；
  // 只有追踪分支吞 rejection（调用方自己 await 了 write，拒绝恰好被观察一次）。
  private publish(): Promise<void> {
    const write = writeAtomic(this.path, serialize(this.descriptor.name, this.state))
    this.inFlight.add(write)
    // Swallow only on the tracking branch: the caller still awaits `write`
    // itself, so rejections stay observed exactly once.
    // 中文说明：只在追踪分支吞掉 rejection——调用方本身还 await 着 write，
    // 所以拒绝恰好被观察一次，不会出现未处理拒绝。
    write.catch(() => {}).finally(() => this.inFlight.delete(write))
    return write
  }
}
