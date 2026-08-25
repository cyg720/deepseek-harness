/**
 * 文件职责：验证实验 Agent Team的 invariant.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证实验 Agent Team在真实组装、失败和清理场景中可靠。
 * 逻辑维度：构造服务或远程替身，驱动操作并断言结果。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantService, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as TeamInvariant from '../src/invariant.ts'
import { TeamId, TeamTaskId } from '../src/types.ts'

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(TeamInvariant)
  return ctx
}

describe('Agent Teams stream invariant', () => {
  it('accepts provisioning and rejects a terminal member as the first edge', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(SessionId('team-invariant'))
    /** 中文说明：测试局部值 member，由紧邻初始化决定。 */
    const member = {
      id: SessionId('team-invariant-child'),
      name: 'worker',
      description: 'worker responsibility',
      provider: 'spawn',
      context: 'fresh' as const,
      phase: 'provisioning' as const,
    }
    expect(() => {
      session.append('team/member', { version: 1, teamId: TeamId(session.id), member })
    }).not.toThrow()

    /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
    const invalid = ctx.sessions.create(SessionId('team-invariant-invalid'))
    expect(() => {
      invalid.append('team/member', {
        version: 1,
        teamId: TeamId(invalid.id),
        member: { ...member, phase: 'active' },
      })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-experimental-agent-team',
    }))
    expect(invalid.events).toEqual([])
  })

  it('rejects an invalid task dependency before publication', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(SessionId('team-task-invariant'))

    expect(() => {
      session.append('team/task', {
        version: 1,
        teamId: TeamId(session.id),
        task: {
          id: TeamTaskId('task-1'),
          revision: 1,
          subject: 'invalid dependency',
          description: 'references a missing blocker',
          status: 'pending',
          blockedBy: [TeamTaskId('missing')],
          writeScopes: [],
        },
      })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-experimental-agent-team',
    }))
    expect(session.events).toEqual([])
  })
})
