/**
 * 文件职责：验证权限预设的 settings-store.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染和可控服务替身。
 * 产品维度：防止权限预设用户流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import {
  PermissionPresetSettingsController, permissionDefaultOf,
} from '../src/client/settings-store.ts'

/** 中文说明：测试局部值 SCHEMA，由紧邻初始化决定。 */
const SCHEMA = {
  uid: 6,
  refs: {
    1: { type: 'const', value: 'read-only' },
    2: { type: 'const', meta: { description: 'Workspace' }, value: 'workspace-write' },
    3: { type: 'union', list: [1, 2] },
    6: { type: 'object', dict: { defaultPreset: 3 } },
  },
}

/** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
const schema = new SettingsSchemaService(new Context())

/** 中文说明：函数 resolveDefault 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function resolveDefault(view: SettingsNamespaceView) {
  return permissionDefaultOf(view, schema)
}

/** 中文说明：函数 view 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function view(defaultPreset: string, revision = 0, schema: SettingsNamespaceView['schema'] = SCHEMA): SettingsNamespaceView {
  return {
    ns: 'permission',
    schema,
    value: { defaultPreset },
    base: { defaultPreset: 'read-only' },
    applies: 'live',
    secrets: [],
    revision,
  }
}

/** 中文说明：函数 ok 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function ok<T>(value: T) {
  return { rpcId: 'test', result: { ok: true as const, value } }
}

/** The permission controller over a real mirror and one fake wire. */
/** 中文说明：函数 permissionController 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function permissionController(api: object) {
  /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
  const wire = { settings: api } as never
  /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
  const mirror = new SettingsDescribeMirror(wire)
  return { mirror, controller: new PermissionPresetSettingsController(mirror, wire, schema) }
}

describe('permission settings store', () => {
  it('derives dynamic options and host labels from the descriptor schema', () => {
    expect(resolveDefault(view('read-only'))).toEqual({
      currentValue: 'read-only',
      options: [
        { id: 'read-only', label: 'Read Only' },
        { id: 'workspace-write', label: 'Workspace' },
      ],
    })
    /** 中文说明：测试局部值 single，由紧邻初始化决定。 */
    const single = {
      uid: 2,
      refs: {
        1: { type: 'const', meta: { description: '' }, value: 'read-only' },
        2: { type: 'object', dict: { defaultPreset: 1 } },
      },
    }
    expect(resolveDefault(view('read-only', 0, single))).toEqual({
      currentValue: 'read-only',
      options: [{ id: 'read-only', label: 'Read Only' }],
    })
    /** 中文说明：测试局部值 undescribed，由紧邻初始化决定。 */
    const undescribed = {
      uid: 2,
      refs: {
        1: { type: 'const', meta: { description: 7 }, value: 'read-only' },
        2: { type: 'object', dict: { defaultPreset: 1 } },
      },
    }
    expect(resolveDefault(view('read-only', 0, undescribed)).options)
      .toEqual([{ id: 'read-only', label: 'Read Only' }])
  })

  it('rejects malformed values and dynamic enums at the wire boundary', () => {
    expect(() => resolveDefault({ ...view('read-only'), value: {} })).toThrow(/no defaultPreset value/)
    expect(() => resolveDefault(view('read-only', 0, {
      uid: 1, refs: { 1: { type: 'object', dict: {} } },
    }))).toThrow(/no defaultPreset field/)
    expect(() => resolveDefault(view('read-only', 0, {
      uid: 2,
      refs: {
        1: { type: 'union' },
        2: { type: 'object', dict: { defaultPreset: 1 } },
      },
    }))).toThrow(/does not advertise/)
    expect(() => resolveDefault(view('read-only', 0, {
      uid: 4,
      refs: {
        1: { type: 'string' },
        2: { type: 'const', value: 1 },
        3: { type: 'union', list: [1, 2] },
        4: { type: 'object', dict: { defaultPreset: 3 } },
      },
    }))).toThrow(/does not advertise/)
    expect(() => resolveDefault(view('missing'))).toThrow(/does not advertise/)
  })

  it('loads and writes defaultPreset with optimistic concurrency', async () => {
    /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
    const describe = vi.fn(() => Promise.resolve(ok({
      writable: true,
      hasDocument: false,
      namespaces: [view('read-only', 4)],
    })))
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn(() => Promise.resolve(ok(view('workspace-write', 5))))
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = permissionController({ describe, mutate })
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      writable: true,
      currentValue: 'read-only',
      revision: 4,
    })
    await controller.select('workspace-write')
    expect(mutate).toHaveBeenCalledWith({
      ns: 'permission',
      ops: [{ op: 'set', path: ['defaultPreset'], value: 'workspace-write' }],
      expectedRevision: 4,
    })
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      currentValue: 'workspace-write',
      revision: 5,
    })
    // The write answer folded into the mirror; no re-read followed.
    expect(describe).toHaveBeenCalledTimes(1)
  })

  it('hides the row when the namespace is absent and contains write failures', async () => {
    /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
    const describe = vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] })))
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = permissionController({ describe, mutate: vi.fn() })
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('unavailable')

    /** 中文说明：测试局部值 failing，由紧邻初始化决定。 */
    const failing = permissionController({
      describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
      mutate: () => Promise.resolve({
        rpcId: 'test',
        result: {
          ok: false as const,
          error: { code: 'settings-conflict', message: 'stale', details: {} },
        },
      }),
    }).controller
    await failing.load()
    await failing.select('workspace-write')
    expect(failing.store.getSnapshot()).toMatchObject({ status: 'error', error: 'stale' })
  })

  it('contains read failures and no-ops without a writable view', async () => {
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn()
    /** 中文说明：测试局部值 readOnly，由紧邻初始化决定。 */
    const readOnly = permissionController({
      describe: () => Promise.resolve(ok({
        writable: false, hasDocument: false, namespaces: [view('read-only', 2)],
      })),
      mutate,
    }).controller
    await readOnly.load()
    expect(readOnly.store.getSnapshot()).toMatchObject({
      currentValue: 'read-only',
      writable: false,
      revision: 2,
    })
    await readOnly.select('workspace-write')
    expect(mutate).not.toHaveBeenCalled()

    /** 中文说明：测试局部值 rejected，由紧邻初始化决定。 */
    const rejected = permissionController({
      describe: () => Promise.resolve({
        rpcId: 'test',
        result: { ok: false as const, error: { code: 'internal', message: 'offline', details: {} } },
      }),
      mutate,
    }).controller
    await rejected.select('workspace-write')
    await rejected.load()
    expect(rejected.store.getSnapshot()).toMatchObject({ status: 'error', error: 'offline' })
    expect(mutate).not.toHaveBeenCalled()

    /** 中文说明：测试局部值 thrown，由紧邻初始化决定。 */
    const thrown = permissionController({
      describe: async () => { throw 'disconnected' },
      mutate,
    }).controller
    await thrown.load()
    expect(thrown.store.getSnapshot()).toMatchObject({ status: 'error', error: 'disconnected' })

    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = {
      settings: {
        describe: () => Promise.resolve(ok({
          writable: true, hasDocument: false, namespaces: [view('read-only')],
        })),
        mutate,
      },
    } as never
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror(wire)
    /** 中文说明：测试局部值 malformed，由紧邻初始化决定。 */
    const malformed = new PermissionPresetSettingsController(mirror, wire, {
      rehydrate: () => { throw 'schema disconnected' },
    } as never)
    await malformed.load()
    expect(malformed.store.getSnapshot()).toMatchObject({
      status: 'error', error: 'schema disconnected',
    })
  })

  it('hides the row in a remote browser instead of loading forever', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn()
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = { settings: { describe: describeCall, mutate } } as never
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror(wire, 'memory')
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new PermissionPresetSettingsController(mirror, wire, schema)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('unavailable')
    await controller.select('workspace-write')
    expect(describeCall).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('follows a mirror refresh without an own read once loaded', async () => {
    /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
    const describe = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: false, namespaces: [view('read-only', 1)] }))
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: false, namespaces: [view('workspace-write', 2)] }))
    /** 中文说明：测试局部值 { mirror, controller }，由紧邻初始化决定。 */
    const { mirror, controller } = permissionController({ describe, mutate: vi.fn() })
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ currentValue: 'read-only' })

    await mirror.load()

    expect(controller.store.getSnapshot()).toMatchObject({ currentValue: 'workspace-write', revision: 2 })
  })

  it('disposal stops deriving and suppresses in-flight writes', async () => {
    /** 中文说明：测试局部值 neverRead，由紧邻初始化决定。 */
    const neverRead = vi.fn()
    /** 中文说明：测试局部值 { controller，由紧邻初始化决定。 */
    const { controller: neverLoaded } = permissionController({ describe: neverRead, mutate: vi.fn() })
    neverLoaded.dispose()
    await neverLoaded.load()
    expect(neverLoaded.store.getSnapshot().status).toBe('idle')
    expect(neverRead).not.toHaveBeenCalled()

    /** 中文说明：测试局部值 read，由紧邻初始化决定。 */
    const read = Promise.withResolvers<ReturnType<typeof ok<{
      writable: boolean
      namespaces: SettingsNamespaceView[]
    }>>>()
    /** 中文说明：测试局部值 { mirror, controller，由紧邻初始化决定。 */
    const { mirror, controller: idle } = permissionController({ describe: () => read.promise, mutate: vi.fn() })
    /** 中文说明：测试局部值 loading，由紧邻初始化决定。 */
    const loading = idle.load()
    idle.dispose()
    read.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }))
    await Promise.all([loading, mirror.load()])
    expect(idle.store.getSnapshot().status).toBe('loading')

    /** 中文说明：测试局部值 mutation，由紧邻初始化决定。 */
    const mutation = Promise.withResolvers<ReturnType<typeof ok<SettingsNamespaceView>>>()
    /** 中文说明：测试局部值 { controller，由紧邻初始化决定。 */
    const { controller: active } = permissionController({
      describe: () => Promise.resolve(ok({
        writable: true,
        hasDocument: false,
        namespaces: [view('read-only')],
      })),
      mutate: () => mutation.promise,
    })
    await active.load()
    /** 中文说明：测试局部值 saving，由紧邻初始化决定。 */
    const saving = active.select('workspace-write')
    active.dispose()
    mutation.resolve(ok(view('workspace-write', 1)))
    await saving
    expect(active.store.getSnapshot().status).toBe('saving')

    /** 中文说明：测试局部值 rejectedMutation，由紧邻初始化决定。 */
    const rejectedMutation = Promise.withResolvers<ReturnType<typeof ok<SettingsNamespaceView>>>()
    /** 中文说明：测试局部值 { controller，由紧邻初始化决定。 */
    const { controller: disposedWrite } = permissionController({
      describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
      mutate: () => rejectedMutation.promise,
    })
    await disposedWrite.load()
    /** 中文说明：测试局部值 writing，由紧邻初始化决定。 */
    const writing = disposedWrite.select('workspace-write')
    disposedWrite.dispose()
    rejectedMutation.reject(new Error('late write'))
    await writing
    expect(disposedWrite.store.getSnapshot().status).toBe('saving')
  })
})
