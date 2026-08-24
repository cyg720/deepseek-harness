/** Node-half coverage for the model guidance paired with Web file references. */
/**
 * 文件职责：验证 Web 交付物插件在挂载期间注册最终回复文件引用提示词。
 * 技术维度：使用 Vitest、Cordis 和真实 SystemPrompt 注册表检查提示区段生命周期。
 * 产品维度：指导模型把生成文件写成 Web 可点击的路径引用。
 * 逻辑维度：创建上下文并装配插件，查找提示区段和快照文本，释放后确认区段移除。
 * 关键边界：提示只应在插件挂载期间存在；persona 置空以隔离本区段。
 * 新手阅读建议：先看 ctx 清理，再跟踪 mounted、section 和释放后的 some 断言。
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply, inject } from '../src/index.ts'

// 当前测试上下文；用例结束后恢复为 undefined。
let ctx: Context | undefined

// 释放共享上下文的测试后置钩子。
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

// Web 交付物宿主提示测试套件。
describe('ui-deliverables node plugin', () => {
  // 验证提示区段只在 fiber 挂载期间存在。
  it('registers final-response file-reference guidance only while mounted', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    // 被测插件 fiber；用于等待注册并显式释放。
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()

    // 按稳定名称找到的文件引用提示区段；未注册时为 undefined。
    const section = (await ctx.systemPrompt.assemble()).sections
      // entry 是一个已装配提示区段，只接受目标名称。
      .find(entry => entry.name === 'ui:deliverable-file-references')
    expect(section?.text).toMatchInlineSnapshot('"When you successfully create or modify files, mention the primary outputs in your final response. To make those and any other changed-file references clickable in Web, format them as Markdown inline code using the exact file-tool path, or a basename when unique among the files changed in that turn."')

    await mounted.dispose()
    expect((await ctx.systemPrompt.assemble()).sections
      // entry 是释放后剩余区段，任何同名项都表示注销失败。
      .some(entry => entry.name === 'ui:deliverable-file-references')).toBe(false)
  })
})
