/**
 * 文件职责：验证 invariant.spec.ts 覆盖的持久化存储行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的持久化存储能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage from '@deepseek-ai/dsh-storage'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import * as DomainInvariantCompanion from '@deepseek-ai/dsh-storage-domain/invariant'
import { DomainFacility, defineDomain, domainTable } from '../src/index.ts'
import type { DomainChanged } from '../src/events.ts'
import { MemoryStorageBackend } from './helpers/memory-backend.ts'

/** 中文说明：变量 itemSchema 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const itemSchema = z.object({ n: z.number() })
/** 中文说明：type Item 定义本测试所需的数据或行为，用于表达持久化存储场景。 */
type Item = z.infer<typeof itemSchema>

/** 中文说明：变量 spec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const spec = defineDomain({
  name: 'inv',
  version: 1,
  global: { schema: itemSchema, initial: { n: 0 } },
  tables: { rows: domainTable<string, Item>(itemSchema) },
})

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup() {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(DomainInvariantCompanion)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  /** 中文说明：变量 facility 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  return { ctx, facility }
}

/** 中文说明：变量 invariantViolation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const invariantViolation: unknown = expect.objectContaining<Partial<InvariantError>>({
  code: 'INVARIANT',
  packageName: '@deepseek-ai/dsh-storage-domain',
})

describe('domain change-event invariants', () => {
  it('accepts every write shape emitted by the real write paths', async () => {
    const { facility } = await setup()
    /** 中文说明：变量 domain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const domain = await facility.open(spec)
    /** 中文说明：变量 rows 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rows = domain.table('rows')
    await rows.put('a', { n: 1 })
    await rows.update('a', current => ({ n: current.n + 1 }))
    await expect(rows.delete('a')).resolves.toBe(true)
    await domain.global.set({ n: 5 })
  })

  it('rejects an event for a domain that is not open', async () => {
    const { ctx } = await setup()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'ghost', table: 'rows', key: 'a', operation: 'put', value: { n: 1 },
    }) }).toThrow(invariantViolation)
  })

  it('rejects a put event whose value is not the in-memory record', async () => {
    const { ctx, facility } = await setup()
    /** 中文说明：变量 domain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const domain = await facility.open(spec)
    await domain.table('rows').put('a', { n: 1 })
    expect(() => { ctx.emit('domain/changed', {
      domain: 'inv', table: 'rows', key: 'a', operation: 'put', value: { n: 999 },
    }) }).toThrow(invariantViolation)
  })

  it('rejects a deletion event while the record is still in memory', async () => {
    const { ctx, facility } = await setup()
    /** 中文说明：变量 domain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const domain = await facility.open(spec)
    await domain.table('rows').put('a', { n: 1 })
    expect(() => { ctx.emit('domain/changed', {
      domain: 'inv', table: 'rows', key: 'a', operation: 'deleted',
    }) }).toThrow(invariantViolation)
  })

  it('rejects a global event whose value is not the in-memory global', async () => {
    const { ctx, facility } = await setup()
    await facility.open(spec)
    expect(() => { ctx.emit('domain/changed', {
      domain: 'inv', table: '', key: '', operation: 'put', value: { n: 42 },
    }) }).toThrow(invariantViolation)
  })

  it('tolerates operations outside the closed union without failing falsely', async () => {
    const { ctx, facility } = await setup()
    /** 中文说明：变量 domain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const domain = await facility.open(spec)
    await domain.table('rows').put('a', { n: 1 })
    // Merge-hostile input: the closed union's satisfies-never default arm is
    // unreachable in typed code; an untyped emit must not crash the check.
    expect(() => { ctx.emit('domain/changed', {
      domain: 'inv', table: 'rows', key: 'a', operation: 'exotic',
    } as unknown as DomainChanged) }).not.toThrow()
  })
})
