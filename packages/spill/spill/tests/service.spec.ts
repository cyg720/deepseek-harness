/**
 * Tests for the spill Service Definition: a minimal concrete subclass registers as
 * `ctx.spillStore`, a second load throws (duplicate service), and disposal
 * releases the service. The storage behavior is the implementation's concern
 * (`@deepseek-ai/dsh-spill-local`); here we only pin the seam contract.
 */
/*
 * 中文说明：
 * - 文件职责：验证溢出存储服务定义的注册、保存转发、重复实现拒绝和释放生命周期。
 * - 技术维度：使用 Vitest、Cordis Service、品牌标识、Buffer 字节计算和最小具体子类。
 * - 产品维度：确保大型工具输出可通过统一服务落盘，而宿主始终只有一个明确后端。
 * - 逻辑维度：StubStore 记录请求并返回固定引用，三个用例依次验证使用、唯一性和 dispose。
 * - 关键边界：不测试真实文件存储；本文件只约束 seam，具体安全行为由 spill-local 负责。
 * - 新手阅读建议：先看 SaveTextSpill 到 SpillRef 的转换，再看 ctx.spillStore 的装载和释放。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SpillLocator, SpillStore } from '@deepseek-ai/dsh-spill'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'

/** Minimal concrete backend: records the last request, returns a fixed ref. */
/* 中文：最小溢出后端，保存最后一次请求并返回可预测引用，供服务定义测试使用。 */
class StubStore extends SpillStore {
  /** 最近一次 saveText 输入；尚未调用时为 undefined。 */
  last: SaveTextSpill | undefined

  /** 中文：记录 input 并返回固定路径、UTF-8 字节数和读取提示；返回 SpillRef Promise。 */
  async saveText(input: SaveTextSpill): Promise<SpillRef> {
    this.last = input
    return {
      locator: SpillLocator(`/stub/${input.suggestedName}`),
      bytes: Buffer.byteLength(input.content, 'utf8'),
      retrievalHint: 'Use the stub reader.',
    }
  }
}

/** 中文：构造归属 s1、来源 web_fetch 的溢出请求；content 是保存文本，返回 SaveTextSpill。 */
function request(content: string): SaveTextSpill {
  return {
    owner: { sessionId: SessionId('s1') },
    source: { toolName: 'web_fetch', callId: ToolCallId('c1'), label: 'result' },
    suggestedName: 'web_fetch.txt',
    content,
  }
}

/** 中文：spill 服务定义生命周期测试组。 */
describe('spill seam', () => {
  /** 中文：装载后应注册 ctx.spillStore 并正确保存文本；无参数和返回值。 */
  it('registers as ctx.spillStore and saves text', async () => {
    /** 当前用例的新 Cordis 上下文。 */
    const ctx = new Context()
    await ctx.plugin(StubStore)
    /** 保存 hello 后得到的溢出引用。 */
    const ref = await ctx.spillStore.saveText(request('hello'))
    expect(ref).toEqual({ locator: '/stub/web_fetch.txt', bytes: 5, retrievalHint: 'Use the stub reader.' })
    expect((ctx.spillStore as StubStore).last?.content).toBe('hello')
  })

  /** 中文：同一上下文装载第二个实现应拒绝；无参数和返回值。 */
  it('rejects a second implementation (one per context)', async () => {
    /** 当前用例的新 Cordis 上下文。 */
    const ctx = new Context()
    await ctx.plugin(StubStore)
    await expect(ctx.plugin(StubStore)).rejects.toThrow()
  })

  /** 中文：释放插件纤程后服务属性应消失；无参数和返回值。 */
  it('releases the service on disposal', async () => {
    /** 当前用例的新 Cordis 上下文。 */
    const ctx = new Context()
    /** StubStore 插件生命周期句柄。 */
    const fiber = await ctx.plugin(StubStore)
    expect(ctx.spillStore).toBeInstanceOf(StubStore)
    await fiber.dispose()
    expect((ctx as Context & { spillStore?: unknown }).spillStore).toBeUndefined()
  })
})
