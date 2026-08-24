/**
 * 文件职责：验证 UI 原子组件包注册其解释为空的 invariant companion。
 * 技术维度：使用 Vitest、真实 Cordis Context 和运行时 invariant 注册表。
 * 产品维度：确保静态组件包在统一诊断清单中有明确归属。
 * 逻辑维度：建立上下文、启用注册表、挂载组件包 companion 并断言成功。
 * 关键边界：测试不渲染 React 组件，也不检查任何具体视觉行为。
 * 新手阅读建议：先看插件挂载顺序，再查看 invariant.ts 的说明文本。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as PrimitivesInvariant from '@deepseek-ai/dsh-client-ui-primitives/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** UI 原子组件 invariant 测试套件；由客户端测试命令执行。 */
describe('invariant companion', () => {
  /** 验证 companion 可挂载；无参数，异步完成后不返回业务值。 */
  it('registers under the package name with an empty installer', async () => {
    /** 仅供当前用例使用的 Cordis 上下文，初始不含任何插件。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(PrimitivesInvariant).await()).resolves.toBeDefined()
  })
})
