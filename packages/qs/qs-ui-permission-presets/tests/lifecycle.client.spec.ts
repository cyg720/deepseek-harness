// @vitest-environment jsdom
/** 当前会话的权限命令必须来自仍存在的会话绑定；插件释放撤销贡献。 */
import { expect, it, vi } from 'vitest'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { DefaultInjected } from '../src/client/DefaultRow.tsx'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { CommandDecoration } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { PermissionSelect } from '@deepseek-ai/dsh-permission-presets/client'
import * as plugin from '../src/client/index.ts'
import { apply as host } from '../src/index.ts'

it('按当前投影提供选项，发送机器值命令，拒绝缺失会话与未匹配响应，并释放重装', async () => {
  host()
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const mirror = { getSnapshot: () => ({ status: 'unavailable', error: null, view: undefined }), subscribe: () => () => {}, ensure: vi.fn(async () => {}), acceptView: vi.fn() }
    runtime.ctx.provide('settingsScope', { describe: () => mirror } as never)
    runtime.ctx.provide('settingsSchema', { rehydrate: vi.fn(), nodeAtPath: vi.fn() } as never)
    class Remote extends Service { constructor(ctx: Context) { super(ctx, 'remote') } }
    new Remote(runtime.ctx)
    runtime.ctx.provide('remote.settings', { mutate: vi.fn() } as never)
    await runtime.declare({ 'qs.settings.general.item': { kind: 'list', scope: 'root' } })
    const registrations = new Set<CommandDecoration>()
    runtime.ctx.provide('commandUi', { decorate: (entry: CommandDecoration) => {
      if ([...registrations].some(row => row.name === entry.name)) throw new Error('duplicate command decoration')
      registrations.add(entry)
      return () => { registrations.delete(entry) }
    } } as never)
    let projection: PermissionSelect | undefined = { currentValue: 'read-only', options: [
      { value: 'read-only', name: 'Read Only' }, { value: 'workspace-write', name: 'Workspace Write' },
    ] }
    let present = true
    const command = vi.fn().mockResolvedValue({ ok: true, value: { matched: true } })
    const binding = { session: { command, projections: { faceOf: () => ({ getSnapshot: () => projection }) } } }
    // 网络会话面由此夹具控制，Cordis 挂载、词典及释放路径保持真实。
    vi.spyOn(runtime.ctx.sessions, 'binding').mockImplementation(() => present ? binding as never : undefined)
    const session = { sessionId: 'permission-session' } as ClientSessionContext
    for (let cycle = 0; cycle < 2; cycle++) {
      const feature = await runtime.mount(plugin)
      const rows = runtime.slots.entries('qs.settings.general.item')
      expect(rows).toHaveLength(1)
      const defaults = (rows[0]!.inject as unknown as () => DefaultInjected)()
      expect(defaults.hooks.defaults.getSnapshot().status).toBe('unavailable')
      runtime.ctx.emit('connection/reset')
      await defaults.actions.load()
      expect(registrations.size).toBe(1)
      const decoration = [...registrations][0]!
      expect(decoration.name).toBe('permission')
      expect(decoration.available(session)).toBe(true)
      if (decoration.ui.kind !== 'popupSelect') throw new Error('Expected permission selector')
      const selector = decoration.ui
      const options = await selector.options(session, new AbortController().signal)
      expect(options.map(option => [option.id, option.active])).toEqual([['read-only', true], ['workspace-write', undefined]])
      await selector.onSelect(options[1]!, session)
      expect(command).toHaveBeenLastCalledWith('/permission workspace-write')
      expect(projection?.currentValue).toBe('read-only')
      command.mockResolvedValueOnce({ ok: true, value: { matched: false } })
      await expect(selector.onSelect(options[1]!, session)).rejects.toThrow()
      command.mockResolvedValueOnce({ ok: false, error: { message: 'private-host-detail' } })
      await expect(selector.onSelect(options[1]!, session)).rejects.not.toThrow('private-host-detail')
      present = false
      expect(decoration.available(session)).toBe(false)
      expect(() => selector.options(session, new AbortController().signal)).toThrow()
      const calls = command.mock.calls.length
      await expect(selector.onSelect(options[1]!, session)).rejects.toThrow()
      expect(command).toHaveBeenCalledTimes(calls)
      present = true
      const previous: PermissionSelect | undefined = projection
      projection = undefined
      expect(decoration.available(session)).toBe(false)
      projection = previous
      await feature.dispose()
      expect(registrations.size).toBe(0)
      expect(runtime.slots.entries('qs.settings.general.item')).toHaveLength(0)
    }
  } finally { await runtime.dispose() }
})
