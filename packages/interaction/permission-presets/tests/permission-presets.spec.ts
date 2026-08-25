/**
 * 文件职责：验证交互与审批的 permission-presets.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证交互与审批在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import PermissionPresetService, {
  CUSTOM_PRESET, effectivePermissionPreset, PERMISSION_SETTINGS_NAMESPACE,
} from '@deepseek-ai/dsh-permission-presets'
import type { Config } from '@deepseek-ai/dsh-permission-presets'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** Writable memory provider for the permission/settings lifecycle specs. */
/** 中文说明：类型或类 MemorySettings 约束宿主、交互或任务数据职责。 */
class MemorySettings extends SettingsProvider {
  readonly doc: Record<string, unknown> = {}
  readonly writable = true

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

/** 中文说明：函数 mounted 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function mounted(options: {
  config?: Config
  bashDefault?: SandboxMode | undefined
  approvalDefault?: ApprovalPolicy | undefined
} = {}): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  ctx.provide('shell', {
    sandboxMode: 'bashDefault' in options ? options.bashDefault : 'workspace-write',
    resolve() { throw new Error('permission tests do not execute bash') },
    run() { throw new Error('permission tests do not execute bash') },
    start() { throw new Error('permission tests do not execute bash') },
  })
  ctx.provide('approval', { config: { policy: 'approvalDefault' in options ? options.approvalDefault : 'ask' } })
  await ctx.plugin(PermissionPresetService, options.config ?? {})
  return ctx
}

/** 中文说明：函数 freshSession 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function freshSession(id: string): Session {
  return Session.create(SessionId(id))
}

/** 中文说明：函数 mountedStore 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function mountedStore(options: { approvalDefault?: ApprovalPolicy | undefined } = {}): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(MemorySettings)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('permission tests do not execute bash') },
    run() { throw new Error('permission tests do not execute bash') },
    start() { throw new Error('permission tests do not execute bash') },
  })
  ctx.provide('approval', {
    config: { policy: 'approvalDefault' in options ? options.approvalDefault : 'ask' },
  })
  await ctx.plugin(PermissionPresetService, {})
  return ctx
}

describe('effectivePermissionPreset', () => {
  it('folds to the last event, or undefined without one', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = freshSession('sess-fold')
    expect(effectivePermissionPreset(session.events)).toBeUndefined()
    session.append('permission/preset', { preset: 'danger-full-access' })
    session.append('permission/preset', { preset: 'workspace-write' })
    expect(effectivePermissionPreset(session.events)).toBe('workspace-write')
    // The backward scan steps over non-preset events to the latest selection.
    session.append('sandbox/mode', { mode: 'read-only' })
    expect(effectivePermissionPreset(session.events)).toBe('workspace-write')
  })
})

describe('PermissionPresetService', () => {
  it('advertises the preset table in declaration order and resolves bundles', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    expect(ctx.permissionPresets.names).toEqual(['workspace-write', 'danger-full-access'])
    expect(ctx.permissionPresets.resolve('danger-full-access')).toMatchObject({ sandbox: 'danger-full-access', approval: 'never' })
    expect(() => ctx.permissionPresets.resolve('plan')).toThrow(/unknown preset "plan"/)
  })

  it('current() derives from the effective knobs: composition defaults hit workspace-write, a switch hits its preset', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = freshSession('sess-current')
    expect(ctx.permissionPresets.current(session.events)).toBe('workspace-write')
    ctx.permissionPresets.set(session, 'danger-full-access')
    expect(ctx.permissionPresets.current(session.events)).toBe('danger-full-access')
  })

  it('a knob state matching no table entry derives custom — a state, not an error', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = freshSession('sess-custom')
    session.append('sandbox/mode', { mode: 'read-only' })
    expect(ctx.permissionPresets.current(session.events)).toBe(CUSTOM_PRESET)
    ctx.permissionPresets.set(session, 'danger-full-access')
    expect(ctx.permissionPresets.current(session.events)).toBe('danger-full-access')
    expect(() => ctx.permissionPresets.resolve(CUSTOM_PRESET)).toThrow(/unknown preset/)
  })

  it('composition defaults outside the table still derive custom when an explicit new-session default is configured', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted({
      approvalDefault: 'never',
      config: { defaultPreset: 'workspace-write' },
    })
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = freshSession('sess-defaults-custom')
    expect(ctx.permissionPresets.current(session.events)).toBe(CUSTOM_PRESET)
  })

  it('the fold breaks bundle ties; a stale fold no longer matching falls back to table order', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted({ config: { presets: {
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      agentish: { sandbox: 'workspace-write', approval: 'ask' },
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    } } })
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = freshSession('sess-tie')
    ctx.permissionPresets.set(session, 'agentish')
    expect(ctx.permissionPresets.current(session.events)).toBe('agentish')
    session.append('approval/policy', { policy: 'never' })
    session.append('sandbox/mode', { mode: 'danger-full-access' })
    expect(ctx.permissionPresets.current(session.events)).toBe('danger-full-access')
  })

  it('set() writes through: one preset event plus both knob events', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = freshSession('sess-set')
    ctx.permissionPresets.set(session, 'danger-full-access')
    expect(session.events.map(e => [e.type, e.data])).toEqual([
      ['permission/preset', { preset: 'danger-full-access' }],
      ['sandbox/mode', { mode: 'danger-full-access' }],
      ['approval/policy', { policy: 'never' }],
    ])
  })

  it('set() to the current preset is a no-op when the knobs already match (clicks are not switches)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = freshSession('sess-noop')
    ctx.permissionPresets.set(session, 'workspace-write')
    expect(session.events).toHaveLength(0)
  })

  it('re-asserting a preset from a drifted (custom) state re-records the choice and repairs the knob', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = freshSession('sess-drift')
    ctx.permissionPresets.set(session, 'danger-full-access')
    // Re-selecting from a drifted state records the choice and repairs only
    // the changed knob.
    session.append('sandbox/mode', { mode: 'read-only' })
    ctx.permissionPresets.set(session, 'danger-full-access')
    /** 中文说明：测试局部值 tail，由紧邻初始化决定。 */
    const tail = session.events.slice(4)
    expect(tail.map(e => [e.type, e.data])).toEqual([
      ['permission/preset', { preset: 'danger-full-access' }],
      ['sandbox/mode', { mode: 'danger-full-access' }],
    ])
  })

  it('rejects composition over a non-confining executor at load', async () => {
    await expect(mounted({ bashDefault: undefined }))
      .rejects.toThrow(/does not confine/)
  })

  it('optionOf() presents shipped labels/descriptions, falls back to the raw key, and fixes custom', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    expect(ctx.permissionPresets.optionOf('danger-full-access')).toEqual({ value: 'danger-full-access', name: 'danger-full-access', description: 'Full file access without approval prompts.' })
    expect(ctx.permissionPresets.optionOf('custom')).toEqual({ value: 'custom', name: 'Custom', description: 'Current sandbox and approval settings do not match a preset.' })
    /** 中文说明：测试局部值 bare，由紧邻初始化决定。 */
    const bare = await mounted({ config: { presets: { plain: { sandbox: 'workspace-write', approval: 'ask' } } } })
    expect(bare.permissionPresets.optionOf('plain')).toEqual({ value: 'plain', name: 'plain' })
    expect(() => ctx.permissionPresets.optionOf('plan')).toThrow(/unknown preset/)
  })

  it('rejects a table entry named custom (reserved for the derived state)', async () => {
    await expect(mounted({ config: { presets: { custom: { sandbox: 'read-only', approval: 'ask' } } } }))
      .rejects.toThrow(/reserved for the derived not-a-preset state/)
  })

  it('requires an explicit default when composition defaults match no preset', async () => {
    await expect(mounted({ approvalDefault: 'never' }))
      .rejects.toThrow(/configure defaultPreset explicitly/)
  })

  it('reads a schema-less approval stand-in as the ask default', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted({ approvalDefault: undefined })
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = freshSession('sess-standin')
    ctx.permissionPresets.set(session, 'workspace-write')
    expect(session.events).toHaveLength(0)
    expect(ctx.permissionPresets.current(session.events)).toBe('workspace-write')
  })
})

describe('new-session default', () => {
  it('pins the current setting into each new session without changing earlier sessions', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mountedStore()
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = ctx.sessions.create(SessionId('first'))
    expect(first.events.map(event => [event.type, event.data])).toEqual([
      ['permission/preset', { preset: 'workspace-write' }],
      ['sandbox/mode', { mode: 'workspace-write' }],
      ['approval/policy', { policy: 'ask' }],
    ])

    await ctx.settings.update(PERMISSION_SETTINGS_NAMESPACE, {
      defaultPreset: 'danger-full-access',
    })
    expect(ctx.permissionPresets.defaultPreset).toBe('danger-full-access')
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = ctx.sessions.create(SessionId('second'))
    expect(ctx.permissionPresets.current(first.events)).toBe('workspace-write')
    expect(ctx.permissionPresets.current(second.events)).toBe('danger-full-access')
    expect(second.events.map(event => event.type)).toEqual([
      'permission/preset', 'sandbox/mode', 'approval/policy',
    ])
  })

  it('preserves a seeded legacy session instead of applying the latest user default', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mountedStore()
    await ctx.settings.update(PERMISSION_SETTINGS_NAMESPACE, {
      defaultPreset: 'danger-full-access',
    })
    /** 中文说明：测试局部值 legacy，由紧邻初始化决定。 */
    const legacy = freshSession('legacy-source')
    legacy.append('turn/start', { turn: 1 })
    legacy.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = ctx.sessions.create(SessionId('legacy-resumed'), { seed: legacy.events })
    expect(ctx.permissionPresets.current(resumed.events)).toBe('workspace-write')
    expect(resumed.events.slice(-3).map(event => event.type)).toEqual([
      'permission/preset', 'sandbox/mode', 'approval/policy',
    ])
  })

  it('preserves composition defaults when an empty stored session resumes', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mountedStore()
    await ctx.settings.update(PERMISSION_SETTINGS_NAMESPACE, {
      defaultPreset: 'danger-full-access',
    })
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = ctx.sessions.create(SessionId('empty-resumed'), { seed: [] })
    expect(ctx.permissionPresets.current(resumed.events)).toBe('workspace-write')
    expect(resumed.events.map(event => event.type)).toEqual([
      'session/end-seed', 'permission/preset', 'sandbox/mode', 'approval/policy',
    ])
  })

  it('pins sessions that already exist when the service remounts', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.provide('shell', {
      sandboxMode: 'workspace-write',
      resolve() { throw new Error('permission tests do not execute bash') },
      run() { throw new Error('permission tests do not execute bash') },
      start() { throw new Error('permission tests do not execute bash') },
    })
    ctx.provide('approval', { config: { policy: 'ask' } })
    /** 中文说明：测试局部值 existing，由紧邻初始化决定。 */
    const existing = ctx.sessions.create(SessionId('existing-before-permission'))
    expect(existing.events).toEqual([])

    await ctx.plugin(PermissionPresetService, {})
    expect(existing.events.map(event => event.type)).toEqual([
      'permission/preset', 'sandbox/mode', 'approval/policy',
    ])
    expect(ctx.permissionPresets.current(existing.events)).toBe('workspace-write')
  })

  it('fills only missing legacy facts and preserves an unmatched seeded combination', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mountedStore()
    /** 中文说明：测试局部值 partial，由紧邻初始化决定。 */
    const partial = freshSession('partial-source')
    partial.append('sandbox/mode', { mode: 'workspace-write' })
    partial.append('approval/policy', { policy: 'ask' })
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = ctx.sessions.create(SessionId('partial-resumed'), { seed: partial.events })
    expect(resumed.events.at(-1)).toMatchObject({
      type: 'permission/preset',
      data: { preset: 'workspace-write' },
    })

    /** 中文说明：测试局部值 custom，由紧邻初始化决定。 */
    const custom = freshSession('custom-source')
    custom.append('sandbox/mode', { mode: 'read-only' })
    custom.append('approval/policy', { policy: 'never' })
    /** 中文说明：测试局部值 unmatched，由紧邻初始化决定。 */
    const unmatched = ctx.sessions.create(SessionId('custom-resumed'), { seed: custom.events })
    expect(ctx.permissionPresets.current(unmatched.events)).toBe(CUSTOM_PRESET)
    expect(unmatched.events.at(-1)?.type).toBe('session/end-seed')
  })

  it('materializes ask when a legacy seed and approval stand-in omit the policy', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mountedStore({ approvalDefault: undefined })
    /** 中文说明：测试局部值 partial，由紧邻初始化决定。 */
    const partial = freshSession('approval-fallback-source')
    partial.append('sandbox/mode', { mode: 'workspace-write' })
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = ctx.sessions.create(SessionId('approval-fallback-resumed'), { seed: partial.events })
    expect(resumed.events.at(-1)).toMatchObject({
      type: 'approval/policy',
      data: { policy: 'ask' },
    })
  })

  it('rejects a stored default outside the configured preset table', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mountedStore()
    await expect(ctx.settings.update(PERMISSION_SETTINGS_NAMESPACE, {
      defaultPreset: 'missing',
    })).rejects.toThrow()
    expect(ctx.permissionPresets.defaultPreset).toBe('workspace-write')
  })
})
