/**
 * 文件职责：验证 Web 用户提问插件不会在宿主全局注册模型可见工具。
 * 技术维度：使用 Vitest 与真实 Cordis 上下文装配提示词、工具和用户提问服务。
 * 产品维度：防止仅启用 Web 提问界面就让所有代理意外获得 ask_user_question 工具。
 * 逻辑维度：每个用例装配依赖与被测插件，断言全局工具缺失，并在用例后释放 fiber。
 * 关键边界：测试关注未限定作用域的全局工具层；需要该工具的 preset 应显式组合 tool-ask-user。
 * 新手阅读建议：先看 afterEach 的清理，再按插件装配顺序理解最终的 undefined 断言。
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { apply } from '../src/index.ts'

// 每个测试当前使用的 Cordis 上下文；用例前可为 undefined，用例后必须释放并清空。
let ctx: Context | undefined

// 测试清理函数；无参数，等待当前 fiber 释放后把共享变量恢复为 undefined。
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

// Web 用户提问宿主插件测试套件。
describe('ui-user-questions node plugin', () => {
  // 验证装配界面插件不会注册模型工具；异步返回 Promise<void>。
  it('mounts no model-facing tool', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(UserQuestionService)

    await ctx.plugin({ apply }).await()

    // Selecting the Web question FEATURE must not hand every agent the tool.
    // `ctx.tools.register` on an unscoped host context files into the global
    // layer, which merges into every agent's view regardless of the preset
    // that composed it — so a two-tool benchmark preset would really present
    // three. The `tool-ask-user` row belongs to the presets that want it.
    // 选择 Web 提问功能不能把工具交给每个代理；未限定宿主上下文的注册会进入全局层，
    // 全局层会合并进所有代理视图，因此真正需要该工具的 preset 必须显式加入 tool-ask-user。
    expect(ctx.tools.get('ask_user_question')).toBeUndefined()
  })
})
