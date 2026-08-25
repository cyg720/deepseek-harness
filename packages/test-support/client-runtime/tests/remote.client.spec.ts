/**
 * TestRemote's own contract: subscription and disposal, dispatch driven by the
 * internal plumbing event, the silent drop for an unsubscribed name, and the
 * `$mount` refusal that sends a spec to the real Client Remote service.
 */
/*
 * 文件职责：验证客户端 TestRemote 的订阅、分发、注销、无人订阅丢弃和禁止挂载约定。
 * 技术维度：使用 Vitest、Cordis 内部 remote plumbing 和内存订阅列表。
 * 产品维度：让客户端插件测试可靠模拟宿主事件，而不会误用真实远程挂载能力。
 * 逻辑维度：第一例覆盖订阅到注销，第二例覆盖未知事件静默丢弃，第三例检查 $mount 明确拒绝。
 * 关键边界：转发参数可含额外线协议字段，订阅回调只接声明部分；每例最终释放 fiber。
 * 新手阅读建议：先看 seen/off 的变化，再看无订阅事件为何不抛错，最后看 $mount 的边界。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { TestRemote } from '../src/remote.ts'

// TestRemote 行为测试套件。
describe('TestRemote', () => {
  // 验证事件送达订阅者，调用 disposer 后不再送达。
  it('delivers a forwarded event to its subscribers and stops after disposal', async () => {
    // 本用例 Cordis 上下文。
    const ctx = new Context()
    // 绑定该上下文的测试远程服务。
    const remote = new TestRemote(ctx)
    // 订阅回调实际收到的命名空间列表。
    const seen: string[] = []
    // 订阅注销函数；ns 是事件的首个字符串参数。
    const off = remote.$on('settings/document-updated', (ns: string) => {
      seen.push(ns)
    })

    ctx.remote.$dispatch('settings/document-updated', ['ui-theme', 1])
    expect(seen).toEqual(['ui-theme'])

    off()
    ctx.remote.$dispatch('settings/document-updated', ['ui-theme', 2])
    expect(seen).toEqual(['ui-theme'])
    await ctx.fiber.dispose()
  })

  // 验证没有订阅者的宿主 allowlist 事件被静默忽略。
  it('drops a forwarded event nobody subscribed to', async () => {
    // 只安装 TestRemote 而不注册目标事件订阅的上下文。
    const ctx = new Context()
    new TestRemote(ctx)
    // No subscriber for this name: the emit must be inert rather than throwing,
    // because the wire carries whatever the Host allowlist selected.
    // 没有该名称订阅者时必须无操作，因为宿主线协议可能转发 allowlist 中任意事件。
    expect(() => { ctx.remote.$dispatch('credentials/reference-updated', ['DEEPSEEK_API_KEY']) }).not.toThrow()
    await ctx.fiber.dispose()
  })

  // 验证测试替身拒绝真实 Client Remote 才支持的 $mount。
  it('refuses $mount, which needs the real Client Remote service', async () => {
    // 本用例上下文和测试远程实例。
    const ctx = new Context()
    const remote = new TestRemote(ctx)
    await expect(remote.$mount()).rejects.toThrow('needs the real Client Remote service')
    await ctx.fiber.dispose()
  })
})
