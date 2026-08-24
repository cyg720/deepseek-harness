/**
 * The settings domain base plugin's own mounting behavior: it stands up
 * `ctx.settingsScope` over one shared describe mirror, keeps that mirror
 * fresh on settings-document and connection-reset invalidations, and retires
 * both the service and the subscriptions with its fiber.
 */
/**
 * 文件职责：验证设置插件的 plugin.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、表单事件和 API 替身。
 * 产品维度：防止设置插件保存、发现和错误提示回归。
 * 逻辑维度：构造配置状态，触发操作并断言请求与界面。
 * 关键边界：敏感值不得意外回显；异步发现和保存必须清理。
 * 新手阅读建议：先读状态夹具，再按加载、编辑、保存场景阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { SettingsSchemaService } from '../src/client/schema.ts'
import { SettingsScopeBinder } from '../src/client/settings-scope.ts'

/** Boot the browser half over a fake loopback connection and test remote. */
/** 中文说明：函数 bench 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function bench() {
  /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
  const describeCall = vi.fn().mockResolvedValue({
    rpcId: 'plugin-bench' as never,
    result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [] } },
  })
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  ctx.provide('connection', {
    api: { settings: { describe: describeCall } },
    isLoopback: true,
  } as never)
  new TestRemote(ctx)
  return { ctx, describeCall, fiber: ctx.plugin({ inject: [...inject], apply }) }
}

describe('settings domain base plugin', () => {
  it('mounts the scope service under settingsScope and reads once eagerly', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, describeCall, fiber } = bench()
    await fiber.await()
    expect(ctx.get('settingsScope')).toBeInstanceOf(SettingsScopeBinder)
    expect(ctx.get('settingsSchema')).toBeInstanceOf(SettingsSchemaService)
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
  })

  it('refreshes the mirror on document commits and connection resets, once each', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, describeCall, fiber } = bench()
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
    ctx.remote.$dispatch('settings/document-updated', ['ui-test', 0])
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(2) })
    ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(3) })
  })

  it('fiber disposal retires the service and its invalidation subscriptions', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { ctx, describeCall, fiber } = bench()
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
    await fiber.dispose()
    expect(ctx.get('settingsScope')).toBeUndefined()
    expect(ctx.get('settingsSchema')).toBeUndefined()
    ctx.remote.$dispatch('settings/document-updated', ['ui-test', 0])
    ctx.emit('connection/reset')
    await Promise.resolve()
    expect(describeCall).toHaveBeenCalledTimes(1)
  })
})
