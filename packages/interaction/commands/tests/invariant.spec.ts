/**
 * 文件职责：验证交互与审批的 invariant.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证交互与审批在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as CommandInvariant from '@deepseek-ai/dsh-commands/invariant'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId, SessionSeq, type Session } from '@deepseek-ai/dsh-session'
import { CommandId } from '@deepseek-ai/dsh-commands'

/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function mount(installCompanion = true): Promise<{ ctx: Context; session: Session }> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create(SessionId('commands-invariant'))
  await ctx.plugin(InvariantRegistry, { enabled: true })
  if (installCompanion) await ctx.plugin(CommandInvariant)
  return { ctx, session }
}

/** 中文说明：函数 appendRun 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function appendRun(session: Session, id: string): void {
  session.append('command/run', {
    commandId: CommandId(id),
    name: 'linked',
    args: '',
    source: { kind: 'user' },
  })
}

describe('command lifecycle invariants', () => {
  it('accepts a success outcome linked to an earlier non-command domain event', async () => {
    /** 中文说明：测试局部值 { session }，由紧邻初始化决定。 */
    const { session } = await mount()
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = session.append('turn/start', { turn: 1 })
    appendRun(session, 'cmd-valid')

    expect(() => {
      session.append('command/done', {
        commandId: CommandId('cmd-valid'),
        kind: 'success',
        sourceEventSeq: source.seq,
      })
    }).not.toThrow()
  })

  it.each([-1, 1.5, 1])('rejects invalid or non-prior sourceEventSeq %s', async (sourceEventSeq) => {
    /** 中文说明：测试局部值 { session }，由紧邻初始化决定。 */
    const { session } = await mount()
    appendRun(session, 'cmd-invalid')

    expect(() => {
      session.append('command/done', {
        commandId: CommandId('cmd-invalid'),
        kind: 'success',
        sourceEventSeq: sourceEventSeq as never,
      })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-commands',
    }))
  })

  it('rejects an error settlement carrying a success-only source reference', async () => {
    /** 中文说明：测试局部值 { session }，由紧邻初始化决定。 */
    const { session } = await mount()
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = session.append('turn/start', { turn: 1 })
    appendRun(session, 'cmd-error-source')

    expect(() => {
      session.append('command/done', {
        commandId: CommandId('cmd-error-source'),
        kind: 'error',
        text: 'failed',
        sourceEventSeq: source.seq,
      })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-commands',
    }))
  })

  it('attributes an invalid durable prefix during late companion loading', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await mount(false)
    appendRun(session, 'cmd-late')
    session.append('command/done', {
      commandId: CommandId('cmd-late'),
      kind: 'success',
      sourceEventSeq: SessionSeq(0),
    })

    await expect(ctx.plugin(CommandInvariant)).rejects.toMatchObject({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-commands',
    })
  })
})
