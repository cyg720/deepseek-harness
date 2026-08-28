/**
 * The summary blank bit means "conversation not started" (no turn has run),
 * not "log empty": standalone plugin events — command lifecycle records,
 * plan/mode, permission knob events, session titles — never flip it, so running /plan or /goal on a
 * fresh session keeps it list-hidden and reusable, while the first accepted
 * prompt's turn/start clears it. The host/session-added frame shares the
 * same predicate function (covered by the workspace spec's frame assertion).
 */
/*
 * 文件职责：验证Host API Proxy的 api-proxy-blank.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
// Side-effect type imports: the configuration-event SessionEventMap merges.
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { createSessionTestRemote, type TestSessionRemote } from './test-remote.ts'

async function harness(): Promise<{ ctx: Context; remote: TestSessionRemote; attach: (session: Session) => void }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return {
    ctx,
    remote: createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
    attach: (session) => {
      ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    },
  }
}

/** Append the standalone (non-conversation) event family a fresh session can accumulate. */
/* 中文说明：函数 appendStandalone 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function appendStandalone(session: Session): void {
  session.append('command/run', {
    commandId: CommandId('blank-cmd-1'), name: 'plan', args: '', source: { kind: 'user' },
  })
  session.append('plan/mode', { active: true })
  session.append('command/done', { commandId: CommandId('blank-cmd-1'), kind: 'success', text: 'Plan mode on.' })
  session.append('session/title', {
    title: 'standalone title', messageSeqs: [], source: { kind: 'fallback' },
  })
  // Permission configuration events from a /permission switch on a fresh session.
  session.append('permission/preset', { preset: 'danger-full-access' })
  session.append('sandbox/mode', { mode: 'danger-full-access' })
}

async function listBlank(remote: TestSessionRemote, id: string): Promise<boolean | undefined> {
  const result = await remote.list({})
  if (!result.ok) throw new Error('list failed')
  return result.value.items.find(item => item.sessionId === id)?.blank
}

describe('summary blank = conversation not started', () => {
  it('standalone events (command lifecycle, plan/mode, title) keep the session blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    expect(await listBlank(remote, session.id)).toBe(true)
    appendStandalone(session)
    expect(await listBlank(remote, session.id)).toBe(true)
  })

  it('the first turn clears blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    appendStandalone(session)
    session.append('turn/start', { turn: 0 })
    expect(await listBlank(remote, session.id)).toBe(false)
  })
})
