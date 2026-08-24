/**
 * 文件职责：验证设置系统的 settings-scope.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、DOM 事件和服务替身。
 * 产品维度：防止设置系统显示、导航或生命周期回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：全局主题、DOM 尺寸和订阅必须在用例后恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和卸载场景阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { SettingsSchemaService } from '../src/client/schema.ts'
import { SettingsScopeController, SettingsScopeBinder } from '../src/client/settings-scope.ts'
import { SettingsDescribeMirror } from '../src/client/settings-mirror.ts'

/** 中文说明：测试局部值 settingsSchema，由紧邻初始化决定。 */
const settingsSchema = new SettingsSchemaService(new Context())

/** 中文说明：类型或类 UiTestSettings 约束模块数据或组件职责。 */
interface UiTestSettings {
  preference: 'light' | 'dark' | 'system'
}

/** 中文说明：测试局部值 ENVELOPE，由紧邻初始化决定。 */
const ENVELOPE = z.object({
  preference: z.union(['light', 'dark', 'system']).default('system'),
}).toJSON()

/** 中文说明：测试局部值 rpc，由紧邻初始化决定。 */
let rpc = 0

/** 中文说明：函数 ok 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `scope-${rpc++}` as never, result: { ok: true, value } }
}

/** 中文说明：函数 rejected 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function rejected<T>(): RpcResponse<T> {
  return {
    rpcId: `scope-${rpc++}` as never,
    result: {
      ok: false,
      error: { code: 'settings-rejected', message: 'conflict', details: { ns: 'ui-test' } },
    },
  }
}

/** 中文说明：函数 view 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function view(value: unknown, revision = 0): SettingsNamespaceView {
  return {
    ns: 'ui-test',
    schema: ENVELOPE,
    value,
    applies: 'live',
    secrets: [],
    revision,
  }
}

/** 中文说明：函数 described 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function described(value: unknown, revision = 0) {
  return ok({ writable: true, hasDocument: true, namespaces: [view(value, revision)] })
}

/** 中文说明：函数 deferred 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function deferred<T>() {
  /** 中文说明：测试局部值 resolve，由紧邻初始化决定。 */
  let resolve!: (value: T) => void
  /** 中文说明：测试局部值 reject，由紧邻初始化决定。 */
  let reject!: (reason: unknown) => void
  /** 中文说明：测试局部值 promise，由紧邻初始化决定。 */
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** A host-mode mirror plus a controller derived from it, over one fake wire. */
/** 中文说明：函数 derivedScope 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function derivedScope(
  api: { describe?: ReturnType<typeof vi.fn>; mutate?: ReturnType<typeof vi.fn> },
  spec: { namespace: string; decode?: (section: unknown) => UiTestSettings | undefined } = { namespace: 'ui-test' },
) {
  /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
  const wire = { settings: api } as never
  /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
  const mirror = new SettingsDescribeMirror(wire)
  /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
  const scope = new SettingsScopeController<UiTestSettings>(wire, spec, mirror, 'host', settingsSchema)
  return { mirror, scope }
}

/** Record each distinct published section, starting from the current one. */
/** 中文说明：函数 trackValues 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function trackValues(scope: SettingsScope<UiTestSettings>): Array<UiTestSettings | undefined> {
  /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
  const seen: Array<UiTestSettings | undefined> = [scope.getSnapshot().value]
  scope.subscribe(() => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = scope.getSnapshot().value
    if (value !== seen[seen.length - 1]) seen.push(value)
  })
  return seen
}

describe('SettingsScopeController', () => {
  it('starts loading and derives a schema-valid section with revision and writability', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn().mockResolvedValueOnce(described({ preference: 'dark' }, 3))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall })
    expect(scope.getSnapshot()).toEqual({
      status: 'loading', value: undefined, revision: undefined, writable: false, mode: 'host',
    })
    await mirror.load()
    expect(scope.getSnapshot()).toEqual({
      status: 'ready', value: { preference: 'dark' }, revision: 3, writable: true, mode: 'host',
    })
  })

  it('keeps the last good value across invalid, rejected, and failed reads while tracking revisions', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'dark' }, 3))
      .mockResolvedValueOnce(described({ preference: 'sepia' }, 4))
      .mockResolvedValueOnce(described(null, 5))
      .mockResolvedValueOnce(described('scalar', 6))
      .mockResolvedValueOnce(described(['queue'], 7))
      .mockResolvedValueOnce(rejected())
      .mockRejectedValueOnce(new Error('offline'))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall })
    /** 中文说明：测试局部值 good，由紧邻初始化决定。 */
    const good = trackValues(scope)
    /** 中文说明：测试局部值 i，由紧邻初始化决定。 */
    for (let i = 0; i < 7; i++) await mirror.load()
    expect(scope.getSnapshot()).toMatchObject({
      status: 'ready', value: { preference: 'dark' }, revision: 7,
    })
    expect(good).toEqual([undefined, { preference: 'dark' }])
  })

  it('treats a schema envelope it cannot rehydrate as vouching for no section', async () => {
    /** 中文说明：测试局部值 broken，由紧邻初始化决定。 */
    const broken = { ...view({ preference: 'dark' }, 2), schema: null }
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: [broken] }))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall })
    await mirror.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'loading', value: undefined, revision: 2 })
  })

  it('reports an unexposed namespace as unavailable and recovers when it reappears', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'light' }, 1))
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: [] }))
      .mockResolvedValueOnce(described({ preference: 'system' }, 2))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall })
    await mirror.load()
    expect(scope.getSnapshot().status).toBe('ready')
    await mirror.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'unavailable', value: { preference: 'light' } })
    await mirror.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'ready', value: { preference: 'system' }, revision: 2 })
  })

  it('applies a custom decode override in place of the wire schema', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'light' }, 1))
      .mockResolvedValueOnce(described({ preference: 'dark' }, 2))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall }, {
      namespace: 'ui-test',
      decode: section => (section as UiTestSettings).preference === 'dark'
        ? section as UiTestSettings
        : undefined,
    })
    await mirror.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'loading', value: undefined, revision: 1 })
    await mirror.load()
    expect(scope.getSnapshot()).toMatchObject({ status: 'ready', value: { preference: 'dark' }, revision: 2 })
  })

  it('serializes rapid set writes, carries revisions, and publishes only the latest settlement', async () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = deferred<RpcResponse<SettingsNamespaceView>>()
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn().mockResolvedValue(described({ preference: 'system' }, 4))
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(ok(view({ preference: 'light' }, 6)))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall, mutate })
    /** 中文说明：测试局部值 published，由紧邻初始化决定。 */
    const published = trackValues(scope)
    await mirror.load()
    /** 中文说明：测试局部值 dark，由紧邻初始化决定。 */
    const dark = scope.set('preference', 'dark')
    /** 中文说明：测试局部值 light，由紧邻初始化决定。 */
    const light = scope.set('preference', 'light')
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    first.resolve(ok(view({ preference: 'dark' }, 5)))
    await Promise.all([dark, light])
    expect(published.map(section => section?.preference)).toEqual([undefined, 'system', 'light'])
    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'light' }, revision: 6 })
    expect(mutate).toHaveBeenNthCalledWith(1, {
      ns: 'ui-test',
      ops: [{ op: 'set', path: ['preference'], value: 'dark' }],
      expectedRevision: 4,
    })
    expect(mutate).toHaveBeenNthCalledWith(2, {
      ns: 'ui-test',
      ops: [{ op: 'set', path: ['preference'], value: 'light' }],
      expectedRevision: 5,
    })
  })

  it('folds the latest write answer into the mirror so a sibling scope sees it', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn().mockResolvedValueOnce(described({ preference: 'system' }, 4))
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn().mockResolvedValueOnce(ok(view({ preference: 'dark' }, 5)))
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = { settings: { describe: describeCall, mutate } } as never
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror(wire)
    /** 中文说明：测试局部值 writer，由紧邻初始化决定。 */
    const writer = new SettingsScopeController<UiTestSettings>(wire, { namespace: 'ui-test' }, mirror, 'host', settingsSchema)
    /** 中文说明：测试局部值 sibling，由紧邻初始化决定。 */
    const sibling = new SettingsScopeController<UiTestSettings>(wire, { namespace: 'ui-test' }, mirror, 'host', settingsSchema)
    await mirror.load()
    await writer.set('preference', 'dark')
    expect(describeCall).toHaveBeenCalledTimes(1)
    expect(sibling.getSnapshot()).toMatchObject({ value: { preference: 'dark' }, revision: 5 })
  })

  it('re-reads after a revisionless first write lands during the initial read', async () => {
    /** 中文说明：测试局部值 initial，由紧邻初始化决定。 */
    const initial = deferred<ReturnType<typeof described>>()
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(described({ preference: 'dark' }, 2))
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn().mockResolvedValueOnce(ok(view({ preference: 'dark' }, 2)))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall, mutate })
    /** 中文说明：测试局部值 loading，由紧邻初始化决定。 */
    const loading = mirror.load()
    await Promise.resolve()

    await scope.set('preference', 'dark')
    initial.resolve(described({ preference: 'system' }, 1))
    await loading

    expect(mutate).toHaveBeenCalledWith({
      ns: 'ui-test',
      ops: [{ op: 'set', path: ['preference'], value: 'dark' }],
    })
    expect(describeCall).toHaveBeenCalledTimes(2)
    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'dark' }, revision: 2 })
  })

  it('recovers the latest rejected or thrown write from Host state', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'system' }, 2))
      .mockResolvedValueOnce(described({ preference: 'light' }, 3))
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn()
      .mockResolvedValueOnce(rejected())
      .mockRejectedValueOnce(new Error('offline'))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall, mutate })
    /** 中文说明：测试局部值 published，由紧邻初始化决定。 */
    const published = trackValues(scope)
    await mirror.load()
    await scope.set('preference', 'dark')
    await scope.set('preference', 'system')
    expect(published.map(section => section?.preference)).toEqual([undefined, 'system', 'light'])
  })

  it('does not recover superseded rejected or thrown writes', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn().mockResolvedValueOnce(described({ preference: 'system' }, 2))
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn()
      .mockResolvedValueOnce(rejected())
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(ok(view({ preference: 'light' }, 3)))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall, mutate })
    /** 中文说明：测试局部值 published，由紧邻初始化决定。 */
    const published = trackValues(scope)
    await mirror.load()
    await Promise.all([
      scope.set('preference', 'dark'),
      scope.set('preference', 'system'),
      scope.set('preference', 'light'),
    ])
    expect(describeCall).toHaveBeenCalledTimes(1)
    expect(published.map(section => section?.preference)).toEqual([undefined, 'system', 'light'])
  })

  it('keeps the write queue usable when a subscriber throws', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'dark' }, 1))
      .mockResolvedValueOnce(described({ preference: 'light' }, 2))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall })
    /** 中文说明：测试局部值 thrown，由紧邻初始化决定。 */
    let thrown = false
    scope.subscribe(() => {
      if (thrown) return
      thrown = true
      throw new Error('subscriber failed')
    })
    await expect(mirror.load()).rejects.toThrow('subscriber failed')
    await expect(mirror.load()).resolves.toBeUndefined()
    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'light' }, revision: 2 })
  })

  it('keeps the write queue usable when a write publication listener throws', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn().mockResolvedValueOnce(described({ preference: 'system' }, 1))
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn()
      .mockResolvedValueOnce(ok(view({ preference: 'dark' }, 2)))
      .mockResolvedValueOnce(ok(view({ preference: 'light' }, 3)))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall, mutate })
    await mirror.load()
    /** 中文说明：测试局部值 shouldThrow，由紧邻初始化决定。 */
    let shouldThrow = true
    mirror.subscribe(() => {
      if (!shouldThrow) return
      shouldThrow = false
      throw new Error('write subscriber failed')
    })

    await expect(scope.set('preference', 'dark')).rejects.toThrow('write subscriber failed')
    await expect(scope.set('preference', 'light')).resolves.toBeUndefined()

    expect(mutate).toHaveBeenCalledTimes(2)
    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'light' }, revision: 3 })
  })

  it('cancels queued and post-dispose writes while draining the in-flight mutation', async () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = deferred<RpcResponse<SettingsNamespaceView>>()
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn().mockReturnValue(first.promise)
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
    /** 中文说明：测试局部值 { scope }，由紧邻初始化决定。 */
    const { scope } = derivedScope({ describe: describeCall, mutate })
    /** 中文说明：测试局部值 published，由紧邻初始化决定。 */
    const published = trackValues(scope)
    /** 中文说明：测试局部值 dark，由紧邻初始化决定。 */
    const dark = scope.set('preference', 'dark')
    await vi.waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    /** 中文说明：测试局部值 light，由紧邻初始化决定。 */
    const light = scope.set('preference', 'light')
    /** 中文说明：测试局部值 stopped，由紧邻初始化决定。 */
    let stopped = false
    /** 中文说明：测试局部值 stop，由紧邻初始化决定。 */
    const stop = scope.dispose().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    first.resolve(ok(view({ preference: 'dark' }, 1)))
    await Promise.all([dark, light, stop])
    await scope.set('preference', 'system')
    expect(mutate).toHaveBeenCalledOnce()
    expect(describeCall).not.toHaveBeenCalled()
    expect(published).toEqual([undefined])
  })

  it('stops deriving from the mirror after dispose', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'dark' }, 1))
      .mockResolvedValueOnce(described({ preference: 'light' }, 2))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall })
    await mirror.load()
    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'dark' } })
    await scope.dispose()
    await mirror.load()
    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'dark' }, revision: 1 })
  })

  it('ignores a mirror notification already queued when disposal starts', async () => {
    /** 中文说明：测试局部值 notify，由紧邻初始化决定。 */
    let notify = (): void => {}
    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    let snapshot = {
      status: 'ready' as const,
      view: {
        writable: true, hasDocument: true,
        namespaces: [view({ preference: 'dark' }, 1)],
      },
      error: null,
    }
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        notify = listener
        return () => {}
      },
    } as never
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = { settings: {} } as never
    /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
    const scope = new SettingsScopeController<UiTestSettings>(
      wire, { namespace: 'ui-test' }, mirror, 'host', settingsSchema)
    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'dark' }, revision: 1 })

    await scope.dispose()
    snapshot = {
      ...snapshot,
      view: { ...snapshot.view, namespaces: [view({ preference: 'light' }, 2)] },
    }
    notify()

    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'dark' }, revision: 1 })
  })

  it('keeps a remote browser in memory mode without Host calls', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn()
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = { settings: { describe: describeCall, mutate } } as never
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror(wire, 'memory')
    /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
    const scope = new SettingsScopeController<UiTestSettings>(
      wire, { namespace: 'ui-test' }, mirror, 'memory', settingsSchema)
    expect(scope.getSnapshot()).toEqual({
      status: 'unavailable', value: undefined, revision: undefined, writable: false, mode: 'memory',
    })
    await mirror.load()
    await scope.set('preference', 'dark')
    await scope.dispose()
    expect(describeCall).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('carries the composition base and the user layer into the snapshot', async () => {
    /** 中文说明：测试局部值 layered，由紧邻初始化决定。 */
    const layered: SettingsNamespaceView = {
      ...view({ preference: 'dark' }, 3),
      base: { preference: 'system' },
      user: { preference: 'dark' },
    }
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: [layered] }))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall })

    await mirror.load()

    expect(scope.getSnapshot()).toMatchObject({
      value: { preference: 'dark' },
      base: { preference: 'system' },
      user: { preference: 'dark' },
    })
  })

  it('reports an inherited field as absent from the user layer', async () => {
    /** 中文说明：测试局部值 inherited，由紧邻初始化决定。 */
    const inherited: SettingsNamespaceView = { ...view({ preference: 'system' }, 1), base: { preference: 'system' } }
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: true, namespaces: [inherited] }))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall })

    await mirror.load()

    expect(scope.getSnapshot().user).toBeUndefined()
  })

  it('clears one field through an unset op fenced by the held revision', async () => {
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn().mockResolvedValueOnce(ok(view({ preference: 'system' }, 4)))
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn().mockResolvedValueOnce(described({ preference: 'dark' }, 3))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall, mutate })
    await mirror.load()

    await scope.unset('preference')

    expect(mutate).toHaveBeenCalledWith({
      ns: 'ui-test',
      ops: [{ op: 'unset', path: ['preference'] }],
      expectedRevision: 3,
    })
    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'system' }, revision: 4 })
  })

  it('recovers the Host state when the latest clear is refused', async () => {
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn().mockResolvedValueOnce(rejected())
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described({ preference: 'dark' }, 3))
      .mockResolvedValueOnce(described({ preference: 'light' }, 5))
    /** 中文说明：测试局部值 { mirror, scope }，由紧邻初始化决定。 */
    const { mirror, scope } = derivedScope({ describe: describeCall, mutate })
    await mirror.load()

    await scope.unset('preference')

    expect(scope.getSnapshot()).toMatchObject({ value: { preference: 'light' }, revision: 5 })
  })
})

describe('SettingsScopeBinder.bind', () => {
  it('shares one mirror read across bound scopes and disposes each with its fiber', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn().mockResolvedValue(described({ preference: 'dark' }, 1))
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = { settings: { describe: describeCall } }
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror(wire as never)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    ctx.provide('connection', { api: wire, isLoopback: true } as never)
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let theme!: SettingsScope<UiTestSettings>
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let locale!: SettingsScope<UiTestSettings>
    new TestRemote(ctx)
    await ctx.plugin(SettingsScopeBinder, { mirror, schema: settingsSchema }).await()
    expect(ctx.settingsScope.describe()).toBe(mirror)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin({
      inject: ['connection', 'remote', 'settingsScope'],
      apply: (plugin: Context) => {
        theme = plugin.settingsScope.bind<UiTestSettings>({ namespace: 'ui-test' })
        locale = plugin.settingsScope.bind<UiTestSettings>({ namespace: 'ui-test' })
      },
    })
    await fiber.await()
    await vi.waitFor(() => {
      expect(theme.getSnapshot()).toMatchObject({ status: 'ready', value: { preference: 'dark' } })
      expect(locale.getSnapshot()).toMatchObject({ status: 'ready', value: { preference: 'dark' } })
    })
    expect(describeCall).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    await mirror.load()
    expect(theme.getSnapshot()).toMatchObject({ revision: 1 })
  })

  it('binds a remote browser in memory mode without starting a settings read', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = { settings: { describe: describeCall } }
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror(wire as never, 'memory')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    ctx.provide('connection', { api: wire, isLoopback: false } as never)
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let scope!: SettingsScope<UiTestSettings>
    new TestRemote(ctx)
    await ctx.plugin(SettingsScopeBinder, { mirror, schema: settingsSchema }).await()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin({
      inject: ['connection', 'remote', 'settingsScope'],
      apply: (plugin: Context) => {
        scope = plugin.settingsScope.bind<UiTestSettings>({ namespace: 'ui-test' })
      },
    })
    await fiber.await()
    expect(scope.getSnapshot()).toMatchObject({ status: 'unavailable', mode: 'memory', writable: false })
    await fiber.dispose()
    expect(describeCall).not.toHaveBeenCalled()
  })
})
