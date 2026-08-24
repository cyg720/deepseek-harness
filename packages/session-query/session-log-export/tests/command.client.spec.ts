/**
 * 文件职责：验证 Web /export 命令的注册、参数处理和随插件 fiber 注销行为。
 * 技术维度：使用 Vitest、真实 Cordis 上下文和最小 commands 服务替身捕获 CommandDefinition。
 * 产品维度：保证用户可下载当前会话日志，同时明确拒绝 Web 环境不支持的输出路径参数。
 * 逻辑维度：捕获注册描述符，检查元数据，调用 handler 覆盖空输入与路径输入，最后释放并确认注销。
 * 关键边界：Web 命令只接受空输入；descriptor 在注册前和注销后都可能为 undefined。
 * 新手阅读建议：先看 provide 如何捕获 descriptor，再阅读 invoke 对两种 rawInput 的期望结果。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import * as SessionLogDownload from '../src/index.ts'

// Web 导出命令测试套件。
describe('/export Web download command', () => {
  // 验证注册、调用和注销完整生命周期；异步返回 Promise<void>。
  it('registers one pathless command and removes it with the plugin fiber', async () => {
    // commands 服务最近注册的命令描述；注册前及 disposer 执行后为 undefined。
    let descriptor: CommandDefinition | undefined
    // 本用例独立 Cordis 上下文；通过 provide 注入最小 commands 服务。
    const ctx = new Context()
    ctx.provide('commands', {
      // 捕获下一条命令定义并返回注销函数。@param next 插件提交的命令定义。@returns 清空 descriptor 的函数。
      register(next: CommandDefinition) {
        descriptor = next
        return () => { descriptor = undefined }
      },
    } as never)
    // 被测下载插件的 fiber；释放它应调用 register 返回的注销函数。
    const fiber = await ctx.plugin(SessionLogDownload)

    expect(descriptor).toMatchObject({
      name: 'export',
      description: 'Download this Session log as a ZIP archive',
    })
    // 命令调用便捷函数；rawInput 是斜杠命令后的原始文本，descriptor 缺失时返回 undefined。
    const invoke = (rawInput: string) => descriptor?.handler({ rawInput } as CommandInvocation)
    await expect(invoke('')).resolves.toEqual({
      kind: 'success', text: 'Session log download requested.',
    })
    await expect(invoke(' output.zip')).resolves.toEqual({
      kind: 'error', text: 'The Web /export command does not accept a path.',
    })

    await fiber.dispose()
    expect(descriptor).toBeUndefined()
  })
})
