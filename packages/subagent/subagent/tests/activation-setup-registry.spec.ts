/**
 * 文件职责：验证 activation-setup-registry.spec.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubagentActivationSetupRegistry from '../src/activation-setup-registry.ts'

/** A child-like scoped context with observable disposal. */
/* 中文说明：函数 childContext 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function childContext(): { ctx: Context; close: () => Promise<void> } {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = new Context()
  /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const scope = root.plugin(function child() {})
  return { ctx: scope.ctx, close: async () => { await scope.dispose() } }
}

describe('SubagentActivationSetupRegistry', () => {
  it('installs contributions in registration order and commits them', () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new SubagentActivationSetupRegistry()
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    registry.register(() => { order.push('first'); return () => order.push('undo-first') })
    registry.register(() => { order.push('second'); return () => order.push('undo-second') })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = childContext()

    /** 中文说明：变量 transaction 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transaction = registry.apply(child.ctx)
    expect(order).toEqual(['first', 'second'])
    expect(() => { transaction.commit() }).not.toThrow()
    expect(order).toEqual(['first', 'second'])
  })

  it('makes repeated removal and converging ownership idempotent', async () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new SubagentActivationSetupRegistry()
    /** 中文说明：变量 disposals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposals = 0
    /** 中文说明：函数值 remove 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const remove = registry.register(() => () => { disposals += 1 })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = childContext()
    registry.apply(child.ctx).commit()

    remove()
    remove()
    await child.close()
    expect(disposals).toBe(1)
  })

  it('makes the opposite ownership convergence idempotent', async () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new SubagentActivationSetupRegistry()
    /** 中文说明：变量 disposals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposals = 0
    /** 中文说明：函数值 remove 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const remove = registry.register(() => () => { disposals += 1 })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = childContext()
    registry.apply(child.ctx).commit()

    await child.close()
    remove()
    expect(disposals).toBe(1)
  })

  it('skips a contribution removed before a child is applied', () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new SubagentActivationSetupRegistry()
    /** 中文说明：变量 installed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const installed: string[] = []
    /** 中文说明：函数值 remove 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const remove = registry.register(() => { installed.push('gone'); return () => {} })
    registry.register(() => { installed.push('kept'); return () => {} })
    remove()

    registry.apply(childContext().ctx).commit()
    expect(installed).toEqual(['kept'])
  })

  it('invalidates a provisioning batch revoked before commit', () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new SubagentActivationSetupRegistry()
    /** 中文说明：变量 disposals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposals = 0
    /** 中文说明：函数值 remove 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const remove = registry.register(() => () => { disposals += 1 })
    /** 中文说明：变量 transaction 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transaction = registry.apply(childContext().ctx)

    remove()
    expect(disposals).toBe(1)
    expect(() => { transaction.commit() }).toThrow(/revoked while this child was being built/)
  })

  it('catches a contribution revoked inside its own installer', () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new SubagentActivationSetupRegistry()
    /** 中文说明：变量 disposals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposals = 0
    /** 中文说明：函数值 self 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const self: { remove?: () => void } = {}
    self.remove = registry.register(() => {
      self.remove?.()
      return () => { disposals += 1 }
    })

    /** 中文说明：变量 transaction 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transaction = registry.apply(childContext().ctx)
    expect(disposals).toBe(1)
    expect(() => { transaction.commit() }).toThrow(/revoked/)
  })

  it('attempts every contribution-removal disposer before reporting failures', () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new SubagentActivationSetupRegistry()
    /** 中文说明：变量 released 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const released: string[] = []
    /** 中文说明：变量 seq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let seq = 0
    /** 中文说明：函数值 remove 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const remove = registry.register(() => {
      /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const id = `child-${++seq}`
      return () => {
        released.push(id)
        if (id === 'child-1') throw new Error('disposer exploded')
      }
    })
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const child of [childContext(), childContext(), childContext()]) {
      registry.apply(child.ctx).commit()
    }

    expect(() => { remove() }).toThrow(/failed to release 1 installation\(s\)/)
    expect(released).toEqual(['child-1', 'child-2', 'child-3'])
  })

  it('attempts every child-scope disposer before reporting failures', async () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new SubagentActivationSetupRegistry()
    /** 中文说明：变量 released 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const released: string[] = []
    registry.register(() => () => {
      released.push('a')
      throw new Error('first disposer exploded')
    })
    registry.register(() => () => { released.push('b') })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = childContext()
    registry.apply(child.ctx).commit()

    await child.close().catch(() => undefined)
    expect(released).toEqual(['a', 'b'])
  })

  it('rolls back earlier installations when a later contribution throws', () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new SubagentActivationSetupRegistry()
    /** 中文说明：变量 undone 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const undone: string[] = []
    registry.register(() => () => undone.push('first'))
    registry.register(() => { throw new Error('boom') })
    registry.register(() => () => undone.push('third'))

    expect(() => registry.apply(childContext().ctx)).toThrow(/boom/)
    expect(undone).toEqual(['first'])
  })

  it('does not dispose twice when revocation precedes setup rollback', () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new SubagentActivationSetupRegistry()
    /** 中文说明：变量 disposals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposals: string[] = []
    /** 中文说明：函数值 removeFirst 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const removeFirst = registry.register(() => () => { disposals.push('first') })
    registry.register(() => {
      removeFirst()
      throw new Error('second failed after revoking the first')
    })

    expect(() => registry.apply(childContext().ctx)).toThrow(/second failed/)
    expect(disposals).toEqual(['first'])
  })

  it('does not cross-release independent child scopes', async () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new SubagentActivationSetupRegistry()
    /** 中文说明：变量 disposed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposed: string[] = []
    /** 中文说明：变量 seq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let seq = 0
    registry.register(() => {
      /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const id = `child-${++seq}`
      return () => disposed.push(id)
    })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = childContext()
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = childContext()
    registry.apply(first.ctx).commit()
    registry.apply(second.ctx).commit()

    await first.close()
    expect(disposed).toEqual(['child-1'])
    await second.close()
    expect(disposed).toEqual(['child-1', 'child-2'])
  })
})
