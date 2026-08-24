/**
 * 文件职责：验证凭据包不变量伴生插件接受合法更新、拒绝无服务事件并保留包名唯一性。
 * 技术维度：使用 Vitest、Cordis、真实 InvariantRegistry 和内存凭据提供者。
 * 产品维度：防止凭据事件与实际服务状态脱节，并避免多个插件争用同一包所有权。
 * 逻辑维度：分别装配完整服务验证成功、缺少服务直接发事件验证失败、重复注册验证冲突。
 * 关键边界：测试只使用内存凭据；REF 是品牌化引用，示例密钥不是真实秘密。
 * 新手阅读建议：先看三个用例装配差异，再比较正常 API、直接 emit 和重复 register 三条路径。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { credentialRef } from '../src/index.ts'
import * as CredentialsInvariant from '../src/invariant.ts'
import { MemoryCredentials } from './memory.ts'

// 测试使用的品牌化 DeepSeek API 密钥引用；值只是名称，不包含秘密。
const REF = credentialRef('DEEPSEEK_API_KEY')

// 凭据不变量伴生插件测试套件。
describe('credentials invariant companion', () => {
  // 验证活跃服务提交的更新事件可通过不变量检查。
  it('accepts a committed change emitted by a live service', async () => {
    // 完整装配不变量、伴生插件和内存凭据服务的上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(CredentialsInvariant)
    await ctx.plugin(MemoryCredentials)

    await expect(ctx.credentials.set(REF, 'sk-live')).resolves.toBeUndefined()
  })

  // 验证没有活跃凭据服务时伪造更新事件会立即失败。
  it('fails an update event emitted without a live service', async () => {
    // 故意不装配 MemoryCredentials 的上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(CredentialsInvariant)

    expect(() => { ctx.emit('credentials/reference-updated', REF) }).toThrow(/invariant violated by "@deepseek-ai\/dsh-credentials"/)
  })

  // 验证同一包名不能被第二个安装器重复占用。
  it('reserves the package name against duplicate registration', async () => {
    // 已由 CredentialsInvariant 占用包名的上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(CredentialsInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-credentials', () => {})
    }).toThrow(/already registered/)
  })
})
