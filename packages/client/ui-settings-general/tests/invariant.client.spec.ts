/**
 * 文件职责：验证通用设置包能注册其解释为空的 invariant companion。
 * 技术维度：通过 Vitest 在真实 Cordis Context 中启用 InvariantRegistry。
 * 产品维度：保证设置与引导插件出现在统一运行时诊断体系中。
 * 逻辑维度：创建上下文、挂载注册表，再挂载目标 companion 并等待成功。
 * 关键边界：本测试不覆盖设置内容、欢迎提示或界面插槽。
 * 新手阅读建议：先理解 companion 注册，再到 invariant.ts 阅读为何无需关系检查。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as GeneralInvariant from '@deepseek-ai/dsh-client-ui-settings-general/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 通用设置 invariant 测试套件；使用 `pnpm run test:gui` 运行。 */
describe('invariant companion', () => {
  /** 验证 companion 挂载 Promise 成功解析；回调无输入和业务返回值。 */
  it('registers under the package name with an empty installer', async () => {
    /** 隔离本用例插件生命周期的全新 Cordis 上下文。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(GeneralInvariant).await()).resolves.toBeDefined()
  })
})
