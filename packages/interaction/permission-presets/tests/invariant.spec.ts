import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SessionStore, { SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as PermissionInvariant from '@deepseek-ai/dsh-permission-presets/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文：提供固定权限预设名称的最小 Cordis 服务，供不变量测试解析事件。 */
class PermissionProbe extends Service {
  /** 可解析的权限预设名称，只允许 safe 和 trusted。 */
  readonly names = ['safe', 'trusted']

  /** 中文：把服务注册为 permissionPresets；ctx 是拥有该服务的上下文，无返回值。 */
  constructor(ctx: Context) {
    super(ctx, 'permissionPresets')
  }
}

/** 中文：装载会话、权限探针、不变量注册表和伴生插件；无参数，返回测试 Context。 */
async function setup(): Promise<Context> {
  /** 当前用例的新 Cordis 上下文。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(PermissionProbe)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(PermissionInvariant)
  return ctx
}

/** 中文：构造 permission/preset 会话事件；preset 是待校验名称，返回最小 SessionEvent。 */
function presetEvent(preset: string): SessionEvent {
  return { type: 'permission/preset', seq: SessionSeq(0), time: 0, data: { preset } }
}

/** 中文：权限预设持久化不变量测试组。 */
describe('permission invariants', () => {
  /** 中文：合法预设与无关事件流均不应抛错；无参数和返回值。 */
  it('accepts configured preset events and ignores other session data', async () => {
    /** 已装载完整校验链的上下文。 */
    const ctx = await setup()
    expect(() => { ctx.emit('session/event', {} as Session, presetEvent('safe')) }).not.toThrow()
    expect(() => { ctx.emit('session/event', {} as Session, {
      type: 'turn/end', seq: SessionSeq(0), time: 0, data: {},
    } as SessionEvent) }).not.toThrow()
    expect(() => { ctx.emit('tools/change') }).not.toThrow()
  })

  /** 中文：实时写入未知预设时应立即拒绝；无参数和返回值。 */
  it('rejects a durable preset that the active table cannot resolve', async () => {
    /** 已装载完整校验链的上下文。 */
    const ctx = await setup()
    expect(() => { ctx.emit('session/event', {} as Session, presetEvent('missing')) })
      .toThrow(/unknown preset "missing"/)
  })

  /** 中文：伴生插件晚注册时应拒绝日志中已有的未知预设；无参数和返回值。 */
  it('rejects an unknown preset already present on late registration', async () => {
    /** 先写入历史事件、后装载不变量的上下文。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(PermissionProbe)
    ctx.sessions.create().append('permission/preset', { preset: 'missing' })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(PermissionInvariant).then(() => undefined)).rejects.toThrow(/unknown preset "missing"/)
  })
})
/**
 * 中文说明：
 * - 文件职责：验证持久化权限预设事件只能引用当前权限表中可解析的名称。
 * - 技术维度：使用 Vitest、Cordis Service、会话事件和不变量伴生插件。
 * - 产品维度：防止会话恢复出不存在的权限模式，避免代理以错误策略继续执行。
 * - 逻辑维度：构造最小权限服务，装载校验链，再覆盖合法、无关、实时非法及历史非法事件。
 * - 关键边界：测试表只含 safe/trusted；伴生插件晚注册时也必须回放已有会话。
 * - 新手阅读建议：先看 PermissionProbe.names，再比较实时 emit 与预先 append 两条校验入口。
 */
