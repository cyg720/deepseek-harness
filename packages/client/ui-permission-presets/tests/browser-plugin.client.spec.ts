/**
 * ui-permission browser half on a real cordis Context with fake command/
 * sessions faces: the plugin hangs the /permission popup decoration on the
 * host command; options flatten the session's permissions projection with
 * the current value active and `custom` excluded; availability follows the
 * projection key's presence; a pick submits the /permission line through
 * Session.command and surfaces rejection/unmatched as thrown errors; fiber
 * disposal removes the contribution (HMR safety). The same plugin registers
 * its Settings row and invalidates that row on host settings changes.
 */
/**
 * 文件职责：验证权限预设的 browser-plugin.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染和可控服务替身。
 * 产品维度：防止权限预设用户流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CommandDecoration } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { PermissionSelect } from '@deepseek-ai/dsh-permission-presets/client'
import {
  PermissionRow, type PermissionRowInjected,
} from '../src/client/PermissionRow.tsx'
import { apply, inject } from '../src/client/index.ts'
import { accessEn } from '../src/client/locales.ts'

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (k: string): SessionId => k as SessionId

/** 中文说明：测试局部值 SELECT，由紧邻初始化决定。 */
const SELECT: PermissionSelect = {
  options: [
    { value: 'read-only', name: 'read-only', description: 'Reads only.' },
    { value: 'workspace-write', name: 'workspace-write' },
    { value: 'danger-full-access', name: 'danger-full-access' },
  ],
  currentValue: 'workspace-write',
}

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  /** 中文说明：测试局部值 locale，由紧邻初始化决定。 */
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  // The plugin injects `remote`; forwarded events reach it through the same
  // `$dispatch` handoff the connection sink makes.
  new TestRemote(ctx)
  ctx.slots.register({
    name: 'root',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  ctx.provide('connection', {
    api: {
      settings: {
        describe: () => Promise.resolve({
          rpcId: 'describe',
          result: { ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } },
        }),
        mutate: () => Promise.reject(new Error('settings mutation is not exercised')),
      },
    },
  } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
  let decoration: CommandDecoration | undefined
  ctx.provide('commandUi', {
    decorate(c: CommandDecoration) {
      decoration = c
      return () => { decoration = undefined }
    },
  })
  /** 中文说明：测试局部值 values，由紧邻初始化决定。 */
  const values = new Map<SessionId, PermissionSelect>()
  /** 中文说明：测试局部值 commands，由紧邻初始化决定。 */
  const commands: string[] = []
  /** 中文说明：测试局部值 commandResult，由紧邻初始化决定。 */
  let commandResult: { ok: boolean; matched?: boolean } = { ok: true, matched: true }
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = (id: SessionId) => ({
    projections: {
      faceOf: (key: string) => ({
        getSnapshot: () => (key === 'permissions' ? values.get(id) : undefined),
        subscribe: () => () => {},
      }),
    },
    command: (line: string) => {
      commands.push(line)
      return Promise.resolve(commandResult.ok
        ? { ok: true as const, value: { matched: commandResult.matched ?? true } }
        : { ok: false as const, error: { code: 'internal', message: 'boom' } })
    },
  })
  ctx.provide('sessions', {
    binding: (id: SessionId) => (values.has(id) ? { sessionId: id, session: session(id) } : undefined),
  })
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx, fiber, values, commands,
    setResult: (r: { ok: boolean; matched?: boolean }) => { commandResult = r },
    decoration: () => decoration,
    permissionRow: () => ctx.slots.entries('settings.general.item')
      .find(entry => entry.component === PermissionRow),
  }
}

describe('ui-permission browser plugin', () => {
  it('hangs the /permission popup decoration on the host command', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 c，由紧邻初始化决定。 */
    const c = b.decoration()!
    expect(c.name).toBe('permission')
    expect(c.ui.kind).toBe('popupSelect')
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = b.permissionRow()!
    expect(row.options).toEqual({ id: 'permission', order: -20 })
    /** 中文说明：测试局部值 injected，由紧邻初始化决定。 */
    const injected = row.inject?.() as PermissionRowInjected | undefined
    expect(injected?.hooks.permission).toBeDefined()
    expect(typeof injected?.load).toBe('function')
    expect(typeof injected?.select).toBe('function')
    await injected!.load()
    await injected!.select('read-only')
  })

  it('availability follows the projection key; options mark the current value active and exclude custom', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 c，由紧邻初始化决定。 */
    const c = b.decoration()!
    /** 中文说明：测试局部值 proj，由紧邻初始化决定。 */
    const proj = { sessionId: sid('s1') }
    expect(c.available(proj)).toBe(false)
    b.values.set(sid('s1'), { ...SELECT, options: [...SELECT.options, { value: 'custom', name: 'Custom' }], currentValue: 'custom' })
    expect(c.available(proj)).toBe(true)
    /** 中文说明：测试局部值 options，由紧邻初始化决定。 */
    const options = await c.ui.options(proj, new AbortController().signal)
    expect(options.map(option => option.id)).toEqual(['read-only', 'workspace-write', 'danger-full-access'])
    expect(options.every(option => option.active !== true)).toBe(true)
    b.values.set(sid('s1'), SELECT)
    /** 中文说明：测试局部值 again，由紧邻初始化决定。 */
    const again = await c.ui.options(proj, new AbortController().signal)
    expect(again.find(option => option.id === 'workspace-write')?.active).toBe(true)
    expect(again.find(option => option.id === 'read-only')?.detail).toBe('Reads only.')
    // Kebab-case names title-case; non-kebab host-configured names pass through.
    expect(again.map(option => option.label)).toEqual(['Read Only', 'Workspace Write', 'Full access'])
    expect(again.find(option => option.id === 'danger-full-access')?.confirmation).toEqual({
      title: 'Enable Full access?',
      description: accessEn['confirm.description'],
      acknowledgeLabel: 'I understand the risks and want to continue',
      cancelLabel: 'Cancel',
      confirmLabel: 'Enable Full access',
    })
    b.values.set(sid('s1'), { ...SELECT, options: [{ value: 'plain', name: 'Ask Every Time' }] })
    /** 中文说明：测试局部值 passthrough，由紧邻初始化决定。 */
    const passthrough = await c.ui.options(proj, new AbortController().signal)
    expect(passthrough[0]?.label).toBe('Ask Every Time')
    // A projection that vanished between availability and open throws.
    expect(() => c.ui.options({ sessionId: sid('ghost') }, new AbortController().signal))
      .toThrow(/not available on this host/)
  })

  it('a pick submits the /permission line; rejection and unmatched throw', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 c，由紧邻初始化决定。 */
    const c = b.decoration()!
    /** 中文说明：测试局部值 proj，由紧邻初始化决定。 */
    const proj = { sessionId: sid('s1') }
    b.values.set(sid('s1'), SELECT)
    await c.ui.onSelect({ id: 'danger-full-access', label: 'danger-full-access' }, proj)
    expect(b.commands).toEqual(['/permission danger-full-access'])
    b.setResult({ ok: false })
    await expect(c.ui.onSelect({ id: 'read-only', label: 'read-only' }, proj)).rejects.toThrow(/permission switch failed/)
    b.setResult({ ok: true, matched: false })
    await expect(c.ui.onSelect({ id: 'read-only', label: 'read-only' }, proj)).rejects.toThrow(/no \/permission command/)
    // An unmaterialized session throws before any submit.
    await expect(c.ui.onSelect({ id: 'read-only', label: 'read-only' }, { sessionId: sid('ghost') }))
      .rejects.toThrow(/not materialized/)
  })

  it('disposal removes the decoration (HMR safety)', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    expect(b.decoration()).toBeDefined()
    b.ctx.remote.$dispatch('settings/document-updated', ['another', 1])
    b.ctx.remote.$dispatch('settings/document-updated', ['permission', 1])
    b.ctx.emit('connection/reset')
    await b.fiber.dispose()
    expect(b.decoration()).toBeUndefined()
    expect(b.permissionRow()).toBeUndefined()
  })
})
