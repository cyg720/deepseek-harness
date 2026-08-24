import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import * as SandboxPolicyInvariant from '@deepseek-ai/dsh-sandbox-policy/invariant'

/** 中文：装载会话与沙箱不变量服务；无参数，返回测试 Context。 */
async function setup(): Promise<Context> {
  /** 当前用例的新 Cordis 上下文。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(SandboxPolicyInvariant)
  return ctx
}

/** 中文：构造 sandbox/mode 事件；mode 是待校验字符串，返回最小 SessionEvent。 */
function modeEvent(mode: string): SessionEvent {
  return { type: 'sandbox/mode', seq: 0, time: 0, data: { mode } } as SessionEvent
}

/** 中文：沙箱策略持久事件不变量测试组。 */
describe('sandbox-policy invariants', () => {
  /** 中文：逐个验证三种公开模式可写入；mode 是当前模式字符串，无返回值。 */
  it.each(['read-only', 'workspace-write', 'danger-full-access'])(
    'accepts the durable %s mode',
    async (mode) => {
      /** 已装载完整校验链的上下文。 */
      const ctx = await setup()
      expect(() => { ctx.emit('session/event', {} as Session, modeEvent(mode)) }).not.toThrow()
    },
  )

  /** 中文：无关会话事件和工具变化不应被本规则拦截；无参数和返回值。 */
  it('ignores unrelated event streams', async () => {
    /** 已装载完整校验链的上下文。 */
    const ctx = await setup()
    expect(() => { ctx.emit('session/event', {} as Session, {
      type: 'turn/start', seq: 0, time: 0, data: {},
    } as SessionEvent) }).not.toThrow()
    expect(() => { ctx.emit('tools/change') }).not.toThrow()
  })

  /** 中文：未知模式应以沙箱策略包名归属并抛出精确错误；无参数和返回值。 */
  it('rejects and attributes an unknown durable sandbox mode', async () => {
    /** 已装载完整校验链的上下文。 */
    const ctx = await setup()
    expect(() => { ctx.emit('session/event', {} as Session, modeEvent('host-root')) })
      .toThrow(new InvariantError('@deepseek-ai/dsh-sandbox-policy', 'sandbox/mode carries unknown mode "host-root"'))
  })

  /** 中文：伴生插件晚注册时也应拒绝历史未知模式；无参数和返回值。 */
  it('rejects an unknown mode already present on late registration', async () => {
    /** 先写入历史事件、后装载不变量的上下文。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('sandbox/mode', { mode: 'host-root' as never })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SandboxPolicyInvariant).then(() => undefined)).rejects.toMatchObject({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-sandbox-policy',
    })
  })
})
/**
 * 中文说明：
 * - 文件职责：验证沙箱模式持久事件的不变量对合法值、无关事件、非法实时事件和历史事件的处理。
 * - 技术维度：使用 Vitest、Cordis 会话服务、不变量注册表和错误归属断言。
 * - 产品维度：保证恢复后的会话只采用系统支持的沙箱权限模式。
 * - 逻辑维度：setup 装载校验链，modeEvent 构造事件，再覆盖三种合法模式与两种非法时机。
 * - 关键边界：合法集合固定为 read-only、workspace-write、danger-full-access；其他流应忽略。
 * - 新手阅读建议：先看 it.each 的合法集合，再对比实时 emit 与晚注册回放的错误断言。
 */
