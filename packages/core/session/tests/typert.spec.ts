/**
 * 文件职责：验证会话服务向 Typert 注册表贡献实时 Session ID 查询，并随服务释放撤销。
 * 技术维度：使用 Vitest、真实 Cordis 插件上下文、品牌化 SessionId 和 Typert lookup 注册表。
 * 产品维度：让 RPC 或生成类型层可把线上会话 ID 解析为当前内存 Session 对象。
 * 逻辑维度：按一种加载顺序装配服务，创建会话，检查 lookup 元数据与解析，再释放会话纤程。
 * 关键边界：查询只对存活会话有效；SessionStore 卸载后必须移除贡献，防止返回陈旧对象。
 * 新手阅读建议：先看 lookup 的 parameter/wire 类型符号，再比较释放前后的注册表内容。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'

// 测试组：描述 SessionStore 与 TypertRegistry 的实时查询集成。
describe('Session Typert provider', () => {
  /**
   * 功能描述：确认服务不依赖装载先后贡献会话查询，并在拥有纤程释放时撤销。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；元数据、解析或释放断言失败时由 Vitest 报错。
   * 使用示例：lookup.resolve(session.id) 应返回同一 session 对象。
   */
  it('contributes live Session lookup in either service load order', async () => {
    // ctx：承载会话服务和 Typert 注册表的独立 Cordis 上下文。
    const ctx = new Context()
    // sessionFiber：SessionStore 的拥有纤程，释放时应撤销 lookup。
    const sessionFiber = ctx.plugin(SessionStore)
    await sessionFiber
    await ctx.plugin(TypertRegistry)
    // session：为验证解析而创建的当前存活会话。
    const session = ctx.sessions.create(SessionId('remote-session'))

    // lookup：Typert 中参数名为 session 的查询定义，可能在服务未装配时不存在。
    const lookup = ctx.typert.lookups.get('session')
    expect(lookup).toMatchObject({
      parameter: 'session',
      wire: 'sessionId',
      hostTypeSymbol: '@deepseek-ai/dsh-session#Session',
      wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
    })
    expect(lookup?.resolve(session.id)).toBe(session)

    await sessionFiber.dispose()
    expect(ctx.typert.lookups.get('session')).toBeUndefined()
  })
})
