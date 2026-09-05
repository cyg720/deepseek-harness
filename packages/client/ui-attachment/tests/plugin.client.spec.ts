/**
 * 文件职责：验证附件客户端插件保持宿主半边为空，并注册/注销输入附件和消息图片两个插槽入口。
 * 技术维度：使用 Vitest、Cordis、真实 SlotRegistry 和最小 root 插槽测试装配。
 * 产品维度：确保附件上传与消息图片界面只在客户端启用，并随插件生命周期完整清理。
 * 逻辑维度：bench 装配插槽和插件；用例分别检查宿主空实现及两个组件入口的注册与释放。
 * 关键边界：root 子插槽定义使用测试类型断言；插件只依赖 slots 服务。
 * 新手阅读建议：先看 bench 的插槽树，再比较 host 用例和 client 注册/释放用例。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { ComposerAttachments } from '../src/client/ComposerAttachments.tsx'
import { MessageImages } from '../src/client/MessageImages.tsx'

/** 构建附件插件测试台。@returns 已装配的 ctx 和插件 fiber。@example const { ctx, fiber } = await bench()。 */
async function bench() {
  // 本测试台独立 Cordis 上下文。
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
      'conversation.message.images': { kind: 'single', scope: 'session' },
      'conversation.trajectory.images': { kind: 'single', scope: 'session' },
      'tool.call.images': { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  // 被测客户端插件 fiber。
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

// 附件插件测试套件。
describe('attachment plugin', () => {
  // 验证 Node 宿主入口不注册客户端界面也不抛错。
  it('keeps the host half empty', () => {
    expect(() => { applyHost() }).not.toThrow()
  })

  it('registers all entries and removes them with the plugin fiber', async () => {
    const { ctx, fiber } = await bench()
    expect(inject).toEqual(['slots'])
    expect(ctx.slots.entries('conversation.input.attachments')).toMatchObject([{
      locale: 'conversation',
      component: ComposerAttachments,
    }])
    expect(ctx.slots.entries('conversation.message.images')).toMatchObject([{
      locale: 'conversation',
      component: MessageImages,
    }])
    expect(ctx.slots.entries('conversation.trajectory.images')).toMatchObject([{
      locale: 'conversation',
      component: MessageImages,
    }])
    expect(ctx.slots.entries('tool.call.images')).toMatchObject([{
      locale: 'conversation',
      component: MessageImages,
    }])

    await fiber.dispose()

    expect(ctx.slots.entries('conversation.input.attachments')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.message.images')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.trajectory.images')).toHaveLength(0)
    expect(ctx.slots.entries('tool.call.images')).toHaveLength(0)
  })
})
