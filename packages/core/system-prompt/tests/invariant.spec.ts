/**
 * 文件职责：验证系统提示词最终组装结果必须满足名称、文本、工具和变量规则。
 * 技术维度：使用 Vitest、Cordis 瀑布事件和不变量注册表测试权威组装结果。
 * 产品维度：在提示词发送给模型前拦截歧义或非法内容，避免模型收到不可解释的上下文。
 * 逻辑维度：创建标准有效样本，通过瀑布末端替换结果，并用表格测试覆盖各种非法字段。
 * 关键边界：检查对象是瀑布链最终结果而非初始输入；测试中的 never 仅用于模拟边界外坏值。
 * 新手阅读建议：先看 valid 的合法数据结构，再读 assemble 如何把候选结果交给不变量检查。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import * as SystemPromptInvariant from '@deepseek-ai/dsh-system-prompt/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/**
 * 创建安装系统提示词不变量检查器的独立上下文。
 * @returns 已准备好组装提示词的 Cordis 上下文。
 * @example `const ctx = await setup()`
 */
async function setup(): Promise<Context> {
  /** 当前测试独占的 Cordis 上下文。 */
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SystemPromptInvariant)
  return ctx
}

/**
 * 创建包含区段、上下文、工具和变量的最小合法组装结果。
 * @returns 每次调用均为新对象的有效 PromptAssembly。
 * @example `await assemble(ctx, valid())`
 */
const valid = (): PromptAssembly => ({
  sections: [{ name: 'identity', text: 'prompt' }],
  contexts: [{ name: 'policy', text: 'current policy' }],
  tools: [{ name: 'echo', description: 'Echo', parameters: {} }],
  variables: { cwd: '/repo', optional: undefined },
})

/**
 * 运行系统提示词组装瀑布，并在链尾提供指定的权威结果。
 * @param ctx 已安装不变量检查器的 Cordis 上下文。
 * @param result 要接受校验的最终组装结果。
 * @returns 校验通过后的组装结果。
 * @example `await assemble(ctx, valid())`
 */
async function assemble(ctx: Context, result: PromptAssembly): Promise<PromptAssembly> {
  return ctx.waterfall(
    ctx as never, 'system-prompt/assemble', valid(), {},
    () => Promise.resolve(result),
  )
}

describe('system-prompt invariants', () => {
  it('accepts a well-formed authoritative assembly', async () => {
    /** 用于验证合法组装结果的测试上下文。 */
    const ctx = await setup()
    await expect(assemble(ctx, valid())).resolves.toEqual(valid())
  })

  it.each([
    [{ ...valid(), sections: [{ name: '', text: 'x' }] }, /section names must be non-empty/],
    [{ ...valid(), sections: [{ name: 'x', text: 'a' }, { name: 'x', text: 'b' }] }, /section name "x" is duplicated/],
    [{ ...valid(), sections: [{ name: 'x', text: 1 as never }] }, /section "x" text must be a string/],
    [{ ...valid(), contexts: [{ name: '', text: 'x' }] }, /context names must be non-empty/],
    [{ ...valid(), contexts: [{ name: 'x', text: 'a' }, { name: 'x', text: 'b' }] }, /context name "x" is duplicated/],
    [{ ...valid(), contexts: [{ name: 'x', text: 1 as never }] }, /context "x" text must be a string/],
    [{ ...valid(), tools: [{ name: '', description: 'x', parameters: {} }] }, /tool names must be non-empty/],
    [{ ...valid(), variables: { Bad: 'x' } }, /variable name "Bad" is invalid/],
    [{ ...valid(), variables: { value: 1 as never } }, /variable "value" must be a string or undefined/],
  ])('rejects malformed authoritative assembly %#', async (assembly, message) => {
    /** 用于验证当前非法样本的独立测试上下文。 */
    const ctx = await setup()
    await expect(assemble(ctx, assembly)).rejects.toThrow(message)
  })
})
