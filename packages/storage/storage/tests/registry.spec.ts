/**
 * 文件职责：验证 registry.spec.ts 覆盖的持久化存储行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的持久化存储能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage, { BackendRegistry, storageBackendServiceKey } from '../src/index.ts'
import type { StorageBackend } from '../src/index.ts'

/** 中文说明：函数值 fakeBackend 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const fakeBackend = (): StorageBackend => ({ close: async () => {} })

describe('BackendRegistry', () => {
  it('registers, resolves, and disposes names', () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new BackendRegistry()
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = fakeBackend()
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = registry.register('json', backend)
    expect(registry.get('json')).toBe(backend)
    expect(registry.names()).toEqual(['json'])
    dispose()
    expect(registry.names()).toEqual([])
    expect(() => registry.get('json')).toThrowMatchingObject({ code: 'backend-not-found' })
  })

  it('rejects duplicate names', () => {
    /** 中文说明：变量 registry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = new BackendRegistry()
    registry.register('json', fakeBackend())
    expect(() => registry.register('json', fakeBackend())).toThrowMatchingObject({ code: 'duplicate-backend' })
  })
})

describe('Storage service', () => {
  it('derives stable lifecycle service keys for named backends', () => {
    expect(storageBackendServiceKey('json')).toBe('storage.backend.json')
    expect(storageBackendServiceKey('tenant-a')).toBe('storage.backend.tenant-a')
  })

  it('mounts on the context and exposes registry plus form mounting', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Storage)
    expect(ctx.storage).toBeInstanceOf(Storage)

    /** 中文说明：变量 facility 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const facility = { marker: true }
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = ctx.storage.mount('domain' as never, facility as never)
    expect(ctx.storage.form('domain' as never)).toBe(facility)
    expect(ctx.storage.domain).toBe(facility)
    expect(() => ctx.storage.mount('domain' as never, facility as never)).toThrowMatchingObject({
      code: 'duplicate-mount',
    })
    dispose()
    expect(() => ctx.storage.form('domain' as never)).toThrowMatchingObject({ code: 'form-not-mounted' })
    expect(() => ctx.storage.domain).toThrowMatchingObject({ code: 'form-not-mounted' })
  })

  it('ignores a stale disposer after dispose and re-mount / re-register', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(Storage)
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = { first: true }
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = { second: true }
    /** 中文说明：变量 staleMount 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const staleMount = ctx.storage.mount('domain' as never, first as never)
    staleMount()
    ctx.storage.mount('domain' as never, second as never)
    staleMount()
    expect(ctx.storage.form('domain' as never)).toBe(second)

    /** 中文说明：变量 backendA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backendA = fakeBackend()
    /** 中文说明：变量 backendB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backendB = fakeBackend()
    /** 中文说明：变量 staleRegister 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const staleRegister = ctx.storage.backend.register('json', backendA)
    staleRegister()
    ctx.storage.backend.register('json', backendB)
    staleRegister()
    expect(ctx.storage.backend.get('json')).toBe(backendB)
  })
})

expect.extend({
  toThrowMatchingObject(received: () => unknown, expected: object) {
    try {
      received()
    } catch (error) {
      /** 中文说明：变量 pass 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const pass = Object.entries(expected).every(
        entry => (error as Record<string, unknown>)[entry[0]] === entry[1],
      )
      return { pass, message: () => `expected thrown error to match ${JSON.stringify(expected)}, got ${String(error)}` }
    }
    return { pass: false, message: () => 'expected function to throw' }
  },
})

declare module 'vitest' {
  /** 中文说明：interface Assertion 定义本测试所需的数据或行为，用于表达持久化存储场景。 */
  interface Assertion<T> {
    toThrowMatchingObject(expected: object): T
  }
}
