/**
 * Agent-scope primitive spec: the actx minted by createScope carries the
 * tag and the dispatch filter itself, so plain cordis dispatch with the actx
 * as subject routes by agent — same-agent tagged listeners receive,
 * foreign-agent ones are filtered out, untagged listeners hear everything,
 * and a subject-less root dispatch stays unfiltered. Scope-owned listeners
 * dispose with the fiber.
 */
/*
 * 文件职责：验证客户端运行时服务与会话状态在 Cordis 作用域中的隔离和清理。
 * 技术维度：Cordis Context、Vitest、作用域服务解析与 effect 生命周期。
 * 产品维度：避免不同窗口、插件或测试实例共享不属于自己的会话状态。
 * 逻辑维度：创建多个作用域并装载运行时，比较服务实例，销毁后检查可见性与清理。
 * 关键边界：父子作用域继承与本地覆盖语义不同；断言必须明确读取者所在 Context。
 * 新手阅读建议：先识别每个 Context 的父子关系，再跟踪服务读取、覆盖和销毁。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { createScope, scopeOf } from '../src/client/scope.ts'

/** 中文说明：标识对象、顺序或版本的标量值；变量 `sid` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
const sid = (k: string): SessionId => k as SessionId

declare module '@deepseek-ai/cordis' {
  /** 中文说明：类型 `Events` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
  interface Events {
    /**
     * Test-only routed probe event.
     * @param payload - marker payload.
     * @mode bail
     */
    'test/scope-probe'(payload: { from: string }): true | undefined
  }
}

/** 中文说明：测试辅助函数 `bench`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function bench() {
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `root` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const root = new Context()
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `a` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const a = createScope(root, sid('a'))
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const b = createScope(root, sid('b'))
  /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `seen` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const seen: string[] = []
  /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `listen` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const listen = (label: string, ctx: Context, answer?: true) => {
    ctx.on('test/scope-probe', (payload) => {
      seen.push(`${label}:${payload.from}`)
      return answer
    })
  }
  return { root, a, b, seen, listen }
}

describe('createScope', () => {
  it('tags the ctx (scopeOf) and leaves the root untagged', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `{ root, a }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { root, a } = bench()
    expect(scopeOf(a.ctx)).toBe(sid('a'))
    expect(scopeOf(root)).toBeUndefined()
  })

  it('scoped dispatch reaches same-session and untagged listeners, never a foreign session', () => {
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `{ root, a, b, seen, listen }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { root, a, b, seen, listen } = bench()
    listen('a', a.ctx)
    listen('b', b.ctx)
    listen('root', root)
    a.ctx.bail(a.ctx, 'test/scope-probe', { from: 'a' })
    expect(seen).toEqual(['a:a', 'root:a'])
    seen.length = 0
    b.ctx.emit(b.ctx, 'test/scope-probe', { from: 'b' })
    expect(seen).toEqual(['b:b', 'root:b'])
  })

  it('bail answers the first same-scope listener and skips filtered foreign ones', () => {
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `{ a, b, listen }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { a, b, listen } = bench()
    listen('b', b.ctx, true) // registered first, but foreign → filtered out
    expect(a.ctx.bail(a.ctx, 'test/scope-probe', { from: 'a' })).toBeUndefined()
    listen('a', a.ctx, true)
    expect(a.ctx.bail(a.ctx, 'test/scope-probe', { from: 'a' })).toBe(true)
  })

  it('a subject-less root dispatch is unfiltered (every listener hears it)', () => {
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `{ root, a, b, seen, listen }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { root, a, b, seen, listen } = bench()
    listen('a', a.ctx)
    listen('b', b.ctx)
    listen('root', root)
    root.emit('test/scope-probe', { from: 'root' })
    expect(seen).toEqual(['a:root', 'b:root', 'root:root'])
  })

  it('fiber disposal removes scope-owned listeners', async () => {
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `{ a, seen, listen }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { a, seen, listen } = bench()
    listen('a', a.ctx)
    await a.fiber.dispose()
    a.ctx.emit(a.ctx, 'test/scope-probe', { from: 'late' })
    expect(seen).toEqual([])
  })
})
