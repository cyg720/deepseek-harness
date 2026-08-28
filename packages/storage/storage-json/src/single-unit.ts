/**
 * One opened JSON unit in `single` layout: the whole unit is one document at
 * `<root>/<name>.json`. The in-memory state is authoritative; every write
 * primitive mutates it and republishes the whole file atomically. Writes are
 * NOT queued here — per the backend contract, write ordering belongs to the
 * caller (the domain layer's write chain); this unit only guarantees that
 * each single call publishes a complete, durable file. The `per-record`
 * layout is a separate unit class in `per-record-unit.ts`.
 * @module @deepseek-ai/dsh-storage-json/src/single-unit
 */
/*
 * 模块总览：本文件是 JSON 后端的"单元运行时"。注意写不排队：并发写由领域层
 * 的写链串行化，本单元只承诺"单次调用发布出完整、持久的文件"。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { writeAtomic } from './atomic.ts'
import { parse, serialize } from './format.ts'
import type { UnitState } from './format.ts'

/**
 * Open (load or lazily create) one `single`-layout unit under `root`: the
 * unit file is `<root>/<name>.json`.
 * @param descriptor - Static identity and shape of the unit.
 * @param root - Absolute backend root directory.
 * @param onClose - Backend callback releasing the unit's open-slot.
 * @returns the opened unit.
 */
export async function openSingleUnit(
  descriptor: KvUnitDescriptor,
  root: string,
  onClose: () => void,
): Promise<KvUnit> {
  const path = join(root, `${descriptor.name}.json`)
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
  return new SingleJsonUnit(descriptor, path, state, onClose)
}

class SingleJsonUnit implements KvUnit {
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

  /* jscpd:ignore-start -- the two unit classes are standalone; the drain/guard lifecycle mirrors the shared KvUnit contract */
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
  /* jscpd:ignore-end */

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
