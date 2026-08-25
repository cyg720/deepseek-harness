/**
 * 文件职责：验证工作区持久记录与内存注册表缓存必须保持一致的不变量规则。
 * 技术维度：使用 Vitest、Cordis 测试上下文和存储领域事件模拟缓存更新场景。
 * 产品维度：避免工作区列表展示不存在的数据，或在记录仍被缓存时错误删除工作区。
 * 逻辑维度：构造可控注册表和 put/deleted 事件，分别覆盖有效、越界和缓存分歧场景。
 * 关键边界：测试只关注 workspace 域的 workspaces 表，其他域或表的事件应被忽略。
 * 新手阅读建议：先看 setup、put、deleted 三个辅助函数，再逐个比较四个测试的缓存状态。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import * as WorkspaceInvariant from '../src/invariant.ts'
import { WorkspaceId } from '../src/index.ts'

/** Boot the invariant service plus the companion over a stubbed registry knowing exactly `ids`. */
/*
 * 启动不变量服务和工作区伴随检查器，并让桩注册表只识别给定编号。
 * @param ids 注册表当前持有的工作区编号。
 * @returns 已安装待测插件的 Cordis 上下文。
 * @example `const ctx = await setup(['w1'])`
 */
async function setup(ids: string[]): Promise<Context> {
  /** 本测试独占的 Cordis 上下文。 */
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => (ids.includes(id) ? { id } : undefined),
  })
  await ctx.plugin(WorkspaceInvariant)
  return ctx
}

/** 测试可覆盖的领域事件定位字段。 */
type ChangeLocation = Partial<Pick<DomainChanged, 'domain' | 'table' | 'key'>>

/**
 * 创建工作区写入事件，并允许测试替换定位字段。
 * @param overrides 可选的域、表或记录键覆盖值。
 * @returns 用于触发不变量检查的 put 事件。
 * @example `put({ domain: 'other' })`
 */
const put = (overrides?: ChangeLocation): DomainChanged => ({
  domain: 'workspace',
  table: 'workspaces',
  key: 'w1',
  operation: 'put',
  value: {},
  ...overrides,
})

/**
 * 创建固定工作区的删除完成事件。
 * @returns 键为 w1 的 deleted 事件。
 * @example `ctx.emit('domain/changed', deleted())`
 */
const deleted = (): DomainChanged => ({
  domain: 'workspace',
  table: 'workspaces',
  key: 'w1',
  operation: 'deleted',
})

describe('workspace cache/table invariant', () => {
  it('accepts a put whose record has a cached entity and ignores foreign events', async () => {
    /** 注册表中存在 w1 的有效测试上下文。 */
    const ctx = await setup(['w1'])
    expect(() => { ctx.emit('domain/changed', put()) }).not.toThrow()
    // Other domains and other tables are out of scope, whatever their shape.
    // 其他域和其他表不属于此检查器的范围，无论其字段内容如何都应忽略。
    expect(() => { ctx.emit('domain/changed', put({ domain: 'other', key: 'missing' })) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', put({ table: 'other', key: 'missing' })) }).not.toThrow()
  })

  it('fails deletion while the registry still publishes the entity', async () => {
    /** 删除记录时仍发布 w1 的分歧测试上下文。 */
    const ctx = await setup(['w1'])
    expect(() => { ctx.emit('domain/changed', deleted()) })
      .toThrow(/cache still publishes/)
  })

  it('allows deletion after the registry removed the cache entry for rollback or explicit deletion', async () => {
    /** 注册表已移除 w1 的有效删除测试上下文。 */
    const ctx = await setup([])
    expect(() => { ctx.emit('domain/changed', deleted()) }).not.toThrow()
  })

  it('fails a put whose record the registry cache does not hold', async () => {
    /** 写入记录但注册表没有 w1 的分歧测试上下文。 */
    const ctx = await setup([])
    expect(() => { ctx.emit('domain/changed', put()) }).toThrow(/diverged/)
  })
})
