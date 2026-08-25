/**
 * 文件职责：验证 json-backend.spec.ts 覆盖的持久化存储行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的持久化存储能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { runKvBackendContract } from '../../storage/tests/contract.ts'
import { Config, JsonStorageBackend, apply } from '../src/index.ts'
import * as InvariantCompanion from '../src/invariant.ts'

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []

/** 中文说明：函数 freshRoot 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function freshRoot(): Promise<string> {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = await mkdtemp(join(tmpdir(), 'dsh-storage-json-'))
  roots.push(root)
  return root
}

afterAll(async () => {
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

runKvBackendContract('json', async () => {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = await freshRoot()
  return {
    backend: new JsonStorageBackend(root),
    reopen: async () => new JsonStorageBackend(root),
  }
})

describe('json backend specifics', () => {
  /** 中文说明：变量 descriptor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const descriptor = { name: 'shape', version: 1, tables: ['t'], hasGlobal: true }

  it('publishes a human-readable pretty-printed file', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    /** 中文说明：变量 unit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unit = await backend.kv.open(descriptor)
    await unit.putRecord('t', 'k', { hello: 'world' })
    /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = await readFile(join(root, 'shape.json'), 'utf8')
    expect(text).toBe(`${JSON.stringify(
      { unit: { name: 'shape', version: 1 }, global: null, tables: { t: { k: { hello: 'world' } } } },
      null,
      2,
    )}\n`)
    await backend.close()
  })

  it('defers materialization until the first write', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    await backend.kv.open(descriptor)
    await expect(readFile(join(root, 'shape.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await backend.close()
  })

  it('rejects a malformed medium', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    await writeFile(join(root, 'shape.json'), 'not json at all', 'utf8')
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })
    await backend.close()
  })

  it('rejects a foreign unit header', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    await writeFile(
      join(root, 'shape.json'),
      JSON.stringify({ unit: { name: 'other', version: 1 }, global: null, tables: {} }),
      'utf8',
    )
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })
    await backend.close()
  })

  it('rejects double-open of one unit as a plain caller error', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    await backend.kv.open(descriptor)
    await expect(backend.kv.open(descriptor)).rejects.toThrow(/already open/)
    await backend.close()
  })

  it('rolls back memory when a publish fails', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    /** 中文说明：变量 unit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unit = await backend.kv.open(descriptor)
    await unit.putRecord('t', 'k', { v: 'committed' })
    await unit.setGlobal({ g: 'committed' })
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(root, 'shape.json')
    /** 中文说明：变量 backup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backup = join(root, 'shape.committed.json')
    // A directory at the publish target rejects atomic replacement on every host.
    await rename(path, backup)
    await mkdir(path)
    await expect(unit.putRecord('t', 'k', { v: 'rejected' })).rejects.toThrow()
    await expect(unit.putRecord('t', 'k2', { v: 'also rejected' })).rejects.toThrow()
    await expect(unit.deleteRecord('t', 'k')).rejects.toThrow()
    await expect(unit.setGlobal({ g: 'rejected' })).rejects.toThrow()
    await rm(path, { recursive: true })
    await rename(backup, path)
    /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const snapshot = await unit.loadAll()
    expect(snapshot.tables['t']).toEqual({ k: { v: 'committed' } })
    expect(snapshot.global).toEqual({ g: 'committed' })
    // The next successful publish must not carry rejected writes to disk.
    await unit.putRecord('t', 'k3', { v: 'later' })
    /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = await readFile(path, 'utf8')
    expect(text).not.toContain('rejected')
    await backend.close()
  })

  it('rejects undeclared table and global access as caller errors', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    /** 中文说明：变量 unit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unit = await backend.kv.open({ name: 'shape', version: 1, tables: ['t'], hasGlobal: false })
    await expect(unit.putRecord('undeclared', 'k', {})).rejects.toThrow(/does not declare table/)
    await expect(unit.setGlobal({})).rejects.toThrow(/does not declare a global slot/)
    await backend.close()
  })

  it('rejects invalid unit and table names', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    await expect(backend.kv.open({ ...descriptor, name: 'Bad-Name' })).rejects.toMatchObject({
      name: 'StorageError',
      code: 'malformed-medium',
    })
    await expect(backend.kv.open({ ...descriptor, tables: ['ok', 'not ok'] })).rejects.toMatchObject({
      name: 'StorageError',
      code: 'malformed-medium',
    })
    await backend.close()
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'closed' })
  })

  it('opens a file missing a declared table as that table empty', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    await writeFile(
      join(root, 'contract_unit.json'),
      JSON.stringify({ unit: { name: 'contract_unit', version: 3 }, global: null, tables: { alpha: { k: 1 } } }),
      'utf8',
    )
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    /** 中文说明：变量 unit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unit = await backend.kv.open({ name: 'contract_unit', version: 3, tables: ['alpha', 'beta'], hasGlobal: true })
    /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const snapshot = await unit.loadAll()
    expect(snapshot.tables['alpha']).toEqual({ k: 1 })
    expect(snapshot.tables['beta']).toEqual({})
    await backend.close()
  })

  it('propagates non-ENOENT read failures', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    const { mkdir } = await import('node:fs/promises')
    // A directory where the unit file should be: readFile fails with EISDIR.
    await mkdir(join(root, 'shape.json'))
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'EISDIR' })
    await backend.close()
  })

  it('rejects malformed table shapes and foreign versions distinctly', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    await writeFile(
      join(root, 'shape.json'),
      JSON.stringify({ unit: { name: 'shape', version: 1 }, global: null, tables: { t: ['not', 'an', 'object'] } }),
      'utf8',
    )
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })

    await writeFile(
      join(root, 'shape.json'),
      JSON.stringify({ unit: { name: 'shape', version: 9 }, global: null, tables: {} }),
      'utf8',
    )
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'version-mismatch' })

    await writeFile(join(root, 'shape.json'), JSON.stringify({ unit: { name: 'shape', version: 1 }, global: null }), 'utf8')
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })

    await writeFile(join(root, 'shape.json'), JSON.stringify('just a string'), 'utf8')
    await expect(backend.kv.open(descriptor)).rejects.toMatchObject({ code: 'malformed-medium' })
    await backend.close()
  })

  it('registers on the hub via apply and closes on dispose', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Storage)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin({ apply, Config, inject: ['storage'] }, { root })
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = ctx.storage.backend.get('json')
    expect(ctx.get(storageBackendServiceKey('json'))).toBe(backend)
    /** 中文说明：变量 unit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unit = await backend.kv!.open(descriptor)
    await unit.putRecord('t', 'k', { v: 1 })
    await fiber.dispose()
    expect(() => ctx.storage.backend.get('json')).toThrow()
    expect(ctx.get(storageBackendServiceKey('json'))).toBeUndefined()
    await expect(unit.putRecord('t', 'x', {})).rejects.toMatchObject({ code: 'closed' })
  })

  it('registers the invariant companion and disposes cleanly', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(InvariantCompanion)
    // Disposal releases the reservation: a fresh mount succeeds.
    await fiber.dispose()
    await ctx.plugin(InvariantCompanion)
  })

  it('close drains in-flight writes and blocks in-flight opens', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new JsonStorageBackend(root)
    /** 中文说明：变量 unit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unit = await backend.kv.open(descriptor)
    /** 中文说明：变量 bigWrite 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bigWrite = unit.putRecord('t', 'big', { blob: 'x'.repeat(4 * 1024 * 1024) })
    await unit.close()
    await expect(bigWrite).resolves.toBeUndefined()
    /** 中文说明：变量 onDisk 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const onDisk = JSON.parse(await readFile(join(root, 'shape.json'), 'utf8')) as {
      tables: Record<string, Record<string, unknown>>
    }
    expect(onDisk.tables['t']?.['big']).toBeDefined()

    /** 中文说明：变量 backend2 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend2 = new JsonStorageBackend(root)
    /** 中文说明：变量 opening 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const opening = backend2.kv.open(descriptor)
    /** 中文说明：变量 closing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const closing = backend2.close()
    await expect(opening.then(u => u.putRecord('t', 'x', {}))).rejects.toMatchObject({ code: 'closed' })
    await closing
  })
})
