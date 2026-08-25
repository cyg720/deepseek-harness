/**
 * Real Loader-path guard for an injected namespace plugin. A default export would make
 * `unwrapExports` collapse the namespace and drop `inject`, causing access to `ctx.web` to fail.
 * Hand-built mounting bypasses that path, so this test unwraps through the real Loader first; see
 * postmortem 0001.
 */
/*
 * 文件职责：守护 tool-web 命名空间经过真实 Cordis Loader 解包后仍保留 inject，并验证可正常装配。
 * 技术维度：使用 Vitest、真实 Loader.prototype.unwrapExports 和 Cordis 工具/Web/提示词服务。
 * 产品维度：防止默认导出折叠丢失依赖声明，导致 Web 搜索与抓取工具启动失败。
 * 逻辑维度：第一例检查导出形式；第二例装配依赖、解包并挂载插件，检查两个工具模式后释放。
 * 关键边界：手工直接挂载无法覆盖 Loader 路径风险；测试必须先调用真实 unwrapExports。
 * 新手阅读建议：先看第一例 loader/unwrapped 字段，再看第二例服务装配和工具名称断言。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as toolWeb from '@deepseek-ai/dsh-tool-web'

// tool-web 真实加载路径测试套件。
describe('dsh-tool-web real-load-path guard', () => {
  // 验证没有 default 且命名空间关键导出完整。
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in toolWeb).toBe(false)

    // 仅继承 Loader 原型的轻量实例。
    const loader = Object.create(Loader.prototype) as Loader
    // 解包结果，应保持原 toolWeb 命名空间身份。
    const unwrapped = loader.unwrapExports(toolWeb) as Record<string, unknown>
    expect(unwrapped).toBe(toolWeb)
    expect(unwrapped.name).toBe('tool-web')
    expect(unwrapped.inject).toEqual(['tools', 'web', 'systemPrompt'])
    expect(typeof unwrapped.apply).toBe('function')
  })

  // 验证解包后的插件可通过 ctx.web 装配而无 inject 错误。
  it('boots over ctx.web through the unwrapped module without an inject error', async () => {
    // 本用例 Cordis 上下文。
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(WebRuntime, {})

    // 真实 Loader 原型实例与适配 Context.plugin 的解包模块。
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolWeb) as Parameters<Context['plugin']>[0]
    // Mounting the collapsed shape would throw for missing injection here.
    // 若命名空间已折叠，此处会因缺少注入而抛错。
    // 已挂载插件 fiber，用于最终释放。
    const fiber = await ctx.plugin(unwrapped)
    // s 是单个工具 schema，只提取名称比较。
    expect(ctx.tools.schemas().map(s => s.name)).toEqual(expect.arrayContaining(['web_search', 'web_fetch']))
    await fiber.dispose()
  })
})
