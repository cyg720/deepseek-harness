/**
 * 文件职责：验证凭据授权的 invariant.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证凭据授权在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import * as AuthorizationInvariant from '../src/invariant.ts'
import { MemoryCredentials } from './memory.ts'

/** 中文说明：测试局部值 KEY，由紧邻初始化决定。 */
const KEY = credentialKey('llm-pi-ai', 'openai-codex')

describe('authorization invariant companion', () => {
  it('accepts an attempt that released its key before settling', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(AuthorizationInvariant)
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(AuthorizationService)
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      run: () => ctx.credentials
        .modifyRecord(KEY, () => Promise.resolve({ kind: 'grant', payload: {} }))
        .then(() => undefined),
    })

    await expect(ctx.authorization.begin({
      key: KEY,
      interaction: { notify: () => {}, prompt: () => Promise.reject(new Error('unused')) },
    })).resolves.toEqual({ status: 'authorized' })
  })

  it('fails a settlement that left its key in flight', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(AuthorizationInvariant)
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(AuthorizationService)
    /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
    const started = Promise.withResolvers<undefined>()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in' }],
      run: () => {
        started.resolve(undefined)
        return new Promise(() => {})
      },
    })
    void ctx.authorization.begin({
      key: KEY,
      interaction: { notify: () => {}, prompt: () => Promise.reject(new Error('unused')) },
    })
    await started.promise

    expect(() => { ctx.emit('authorization/settled', KEY, 'authorized') })
      .toThrow(/left the key in flight/)
  })

  it('fails a settlement emitted without a live service', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(AuthorizationInvariant)

    expect(() => { ctx.emit('authorization/settled', KEY, 'cancelled') })
      .toThrow(/without a live authorization service/)
  })

  it('accepts a settlement whose flow left during its own attempt', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(AuthorizationInvariant)
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(AuthorizationService)

    expect(() => { ctx.emit('authorization/settled', KEY, 'cancelled') }).not.toThrow()
  })

  it('reserves the package name against duplicate registration', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(AuthorizationInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-authorization', () => {})
    }).toThrow(/already registered/)
  })
})
