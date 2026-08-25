/**
 * The `permissions` projection unit and the `/permission` command: mounting
 * the permission service beside the projection registry serves the whole
 * select (table options + effective current value, `custom` appended exactly
 * while derived) folded from the three knob events over the composition
 * defaults; the command child registers `/permission` whose handler switches
 * through `permission.set` (bare invocation reports, unknown names error);
 * compositions without either registry are unaffected; unmounting the
 * service removes the key (HMR safety).
 */
/*
 * 文件职责：验证交互与审批的 projection.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证交互与审批在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import type { Config } from '@deepseek-ai/dsh-permission-presets'
import ApprovalService from '@deepseek-ai/dsh-user-approval'

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(options: { withPermission?: boolean; config?: Config } = {}): Promise<{ ctx: Context; session: Session }> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(CommandRuntime)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('permission tests do not execute bash') },
    run() { throw new Error('permission tests do not execute bash') },
    start() { throw new Error('permission tests do not execute bash') },
  })
  await ctx.plugin(ApprovalService)
  if (options.withPermission !== false) await ctx.plugin(PermissionPresetService, options.config ?? {})
  return { ctx, session: ctx.sessions.create(SessionId('perm-projected')) }
}

/** Mint a scoped agent over a live session (the command executor's addressing shape). */
/* 中文说明：函数 agentFor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function agentFor(ctx: Context, session: Session) {
  /** 中文说明：测试局部值 inject，由紧邻初始化决定。 */
  const inject = vi.fn<Agent['inject']>()
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent = { id: session.id, session, inject } as unknown as Agent
  await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['commands'] }))
  return { agent, inject }
}

describe('permissions projection unit', () => {
  it('serves the pinned new-session default select', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness()
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = ctx.sessionProjections.snapshot(session).values.permissions
    expect(value).toMatchObject({ currentValue: 'workspace-write' })
    expect(value?.options.map(option => option.value)).toEqual(['workspace-write', 'danger-full-access'])
  })

  it('folds the knob events and notifies the change feed per knob append', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness()
    /** 中文说明：测试局部值 changes，由紧邻初始化决定。 */
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value, seq })
    })
    ctx.permissionPresets.set(session, 'danger-full-access')
    // set() appends preset + sandbox/mode + approval/policy: three knob transitions.
    expect(changes).toHaveLength(3)
    expect(changes.at(-1)).toMatchObject({ key: 'permissions', value: { currentValue: 'danger-full-access' } })
    // Unrelated event: same-reference apply, no notification.
    session.append('turn/start', { turn: 1 })
    expect(changes).toHaveLength(3)
  })

  it('appends custom as a current-only option when the knobs match no preset', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness()
    session.append('sandbox/mode', { mode: 'read-only' })
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = ctx.sessionProjections.snapshot(session).values.permissions
    expect(value?.currentValue).toBe('custom')
    expect(value?.options.at(-1)).toMatchObject({ value: 'custom', name: 'Custom' })
  })

  it('has no permissions key without the service, and drops it on unload (HMR safety)', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness({ withPermission: false })
    expect('permissions' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(PermissionPresetService, {})
    expect(ctx.sessionProjections.snapshot(session).values.permissions).toMatchObject({ currentValue: 'workspace-write' })
    await fiber.dispose()
    expect('permissions' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

describe('/permission command', () => {
  it('switches through permission.set and logs the lifecycle pair', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness()
    /** 中文说明：测试局部值 { agent, inject }，由紧邻初始化决定。 */
    const { agent, inject } = await agentFor(ctx, session)
    /** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
    const execution = await ctx.commands.execute(agent, '/permission danger-full-access', [], new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'success', text: 'preset danger-full-access' })
    expect(ctx.permissionPresets.current(session.events)).toBe('danger-full-access')
    expect(inject.mock.calls[0]?.[0]).toMatchObject({
      content: [{
        type: 'text',
        text: 'The approval policy changed from "ask" to "never" (changed by the user).',
      }],
    })
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = session.events.find(event => event.type === 'command/run')
    expect(run?.data).toMatchObject({ name: 'permission', args: ' danger-full-access' })
  })

  it('reports the current preset and the table on bare invocation', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness()
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = await agentFor(ctx, session)
    /** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
    const execution = await ctx.commands.execute(agent, '/permission', [], new AbortController().signal)
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'current preset workspace-write (available: workspace-write, danger-full-access)',
    })
    expect(session.events.filter(event => event.type === 'permission/preset')).toHaveLength(1)
  })

  it('rejects an unknown preset without touching the log', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness()
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = await agentFor(ctx, session)
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = session.events.filter(event =>
      event.type !== 'command/run' && event.type !== 'command/done')
    /** 中文说明：测试局部值 execution，由紧邻初始化决定。 */
    const execution = await ctx.commands.execute(agent, '/permission yolo', [], new AbortController().signal)
    // The error text carries the same no-self-labelling rule as the success
    // texts: `permission · unknown preset "yolo" (…)`, not `unknown permission
    // preset`, which the row's own title already says.
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'unknown preset "yolo" (available: workspace-write, danger-full-access)',
    })
    expect(session.events.filter(event =>
      event.type !== 'command/run' && event.type !== 'command/done')).toEqual(before)
  })
})
