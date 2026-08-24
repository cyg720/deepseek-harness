/**
 * 文件职责：验证附件界面包能以包名注册其解释为空的 invariant companion。
 * 技术维度：使用 Vitest、真实 Cordis Context 和 InvariantRegistry 装载插件。
 * 产品维度：保证附件插件参与统一运行时诊断，即使当前没有额外关系检查。
 * 逻辑维度：创建上下文、启用注册表、挂载 companion 并等待成功。
 * 关键边界：该测试只验证注册生命周期，不测试附件展示或文件加载。
 * 新手阅读建议：先看注册表挂载顺序，再阅读 invariant.ts 中的空安装理由。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as AttachmentInvariant from '@deepseek-ai/dsh-client-ui-attachment/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 附件 invariant 测试套件；由 `pnpm run test:gui` 自动执行。 */
describe('invariant companion', () => {
  /** 验证异步插件挂载成功；回调无参数，完成后返回 Promise<void>。 */
  it('registers under the package name with an empty installer', async () => {
    /** 本用例独享的 Cordis 上下文，避免插件状态跨测试泄漏。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(AttachmentInvariant).await()).resolves.toBeDefined()
  })
})
