/** Page-store join: directory × namespaces × credentials, with last-good rows on failure. */
/*
 * 文件职责：验证模型设置的 store.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、表单事件和 API 替身。
 * 产品维度：防止模型设置保存、发现和错误提示回归。
 * 逻辑维度：构造配置状态，触发操作并断言请求与界面。
 * 关键边界：敏感值不得意外回显；异步发现和保存必须清理。
 * 新手阅读建议：先读状态夹具，再按加载、编辑、保存场景阅读。
 */
import { describe, expect, it } from 'vitest'
import type { RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { settingsSchema } from './settings-schema.client.ts'
import { messageOf, ModelsSettingsStore } from '../src/client/store.ts'

/** 中文说明：测试局部值 nextRpc，由紧邻初始化决定。 */
let nextRpc = 0
/** 中文说明：函数 ok 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
/** 中文说明：函数 fail 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: false, error: { code: 'internal', message, details: {} } } }
}

/** Credentials answers over the Remote carrier, which has no envelope. */
type RemoteAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { code: string; message: string; details: object } }
function remoteOk<T>(value: T): RemoteAnswer<T> {
  return { ok: true, value }
}
function remoteFail<T>(message: string): RemoteAnswer<T> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

const DIRECTORY = [
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
  { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true },
  { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], active: false },
  { provider: 'ghost', displayName: 'Ghost', settingsNs: '', settingsPath: [], active: true },
]

/** 中文说明：测试局部值 NAMESPACES，由紧邻初始化决定。 */
const NAMESPACES = [
  {
    ns: 'llm-deepseek',
    schema: {},
    value: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://base' },
    base: { baseURL: 'https://base' },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  },
  {
    ns: 'llm-pi-ai',
    schema: {},
    value: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } },
    user: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  },
]

/** 中文说明：函数 api 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function api(overrides: {
  providers?: () => Promise<RpcResponse<{ providers: typeof DIRECTORY }>>
  describeSettings?: () => Promise<RemoteAnswer<{ writable: boolean; hasDocument: boolean; namespaces: typeof NAMESPACES }>>
  describeCredentials?: (refs: readonly string[]) => Promise<RemoteAnswer<Record<string, unknown>>>
} = {}) {
  /** 中文说明：测试局部值 seenRefs，由紧邻初始化决定。 */
  const seenRefs: string[][] = []
  const providers = overrides.providers ?? (() => Promise.resolve(ok({ providers: DIRECTORY })))
  let providerBatch: Promise<RpcResponse<{ providers: typeof DIRECTORY }>> | undefined
  let providerBatchReads = 0
  const readProviderBatch = (): Promise<RpcResponse<{ providers: typeof DIRECTORY }>> => {
    providerBatch ??= providers()
    const current = providerBatch
    providerBatchReads += 1
    if (providerBatchReads % 2 === 0) providerBatch = undefined
    return current
  }
  const mapProviderBatch = async <T>(
    project: (rows: typeof DIRECTORY) => T,
  ): Promise<RemoteAnswer<T>> => {
    const response = await readProviderBatch()
    return response.result.ok
      ? remoteOk(project(response.result.value.providers))
      : remoteFail(response.result.error.message)
  }
  const face = {
    llm: {
      listProviders: () => mapProviderBatch(rows => rows
        .filter(row => row.active)
        .map(row => ({ id: row.provider, name: row.displayName }))),
      listConfigurableProviders: () => mapProviderBatch(rows => rows
        .filter(row => row.settingsNs !== '')
        .map(({ active: _active, ...row }) => row)),
      discoverModels: () => Promise.resolve(remoteOk([])),
    },
    settings: {
      describe: overrides.describeSettings
        ?? (() => Promise.resolve(remoteOk({ writable: true, hasDocument: false, namespaces: NAMESPACES }))),
      mutate: () => Promise.resolve(remoteFail('the store spec issues no writes')),
    },
    credentials: {
      describe: (refs: readonly string[]) => {
        seenRefs.push([...refs])
        return (overrides.describeCredentials ?? (asked => Promise.resolve(remoteOk(
          Object.fromEntries(asked.map(ref => [ref, { configured: ref === 'OPENAI_API_KEY', writable: true }])),
        ))))(refs)
      },
      set: () => Promise.resolve(remoteOk(undefined)),
      unset: () => Promise.resolve(remoteOk(undefined)),
    },
  }
  /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
  const wire = face as never
  return { face: wire, mirror: new SettingsDescribeMirror(wire), seenRefs }
}

describe('ModelsSettingsStore', () => {
  it('joins rows with configured, removable, and credential state', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { face, mirror, seenRefs } = api()
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    await store.load()
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.writable).toBe(true)
    expect(state.credentialError).toBeNull()
    // Named references first (rows order), then the derived <ROUTE>_API_KEY
    // of every row whose profile names none — one batched describe.
    expect(seenRefs).toEqual([['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GHOST_API_KEY']])
    const byProvider = new Map(state.rows.map(row => [row.entry.provider, row]))
    expect(byProvider.get('deepseek-official')).toMatchObject({
      configured: true,
      removable: false,
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      credential: { configured: false, writable: true },
    })
    expect(byProvider.get('openai')).toMatchObject({
      configured: true,
      removable: true,
      apiKeyEnv: 'OPENAI_API_KEY',
      credential: { configured: true },
    })
    expect(byProvider.get('anthropic')).toMatchObject({ configured: false, removable: false })
    expect(byProvider.get('anthropic')?.apiKeyEnv).toBeUndefined()
    expect(byProvider.get('ghost')).toMatchObject({ configured: false, removable: false })
    expect(state.namespaces.get('llm-pi-ai')?.ns).toBe('llm-pi-ai')
  })

  it('degrades the credential badge, not the page, when the credential domain fails', async () => {
    const { face, mirror } = api({ describeCredentials: () => Promise.resolve(remoteFail('no provider')) })
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    await store.load()
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.credentialError).toBe('no provider')
    expect(state.rows.every(row => row.credential === undefined)).toBe(true)
  })

  it('settles a credential transport rejection without leaving the store loading', async () => {
    /** 中文说明：测试局部值 { face, mirror }，由紧邻初始化决定。 */
    const { face, mirror } = api({
      describeCredentials: () => Promise.reject(new Error('credential transport down')),
    })
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.store.getSnapshot()).toMatchObject({
      status: 'ready',
      credentialError: 'credential transport down',
    })
  })

  it('stringifies a non-Error credential transport rejection', async () => {
    /** 中文说明：测试局部值 { face, mirror }，由紧邻初始化决定。 */
    const { face, mirror } = api({
      describeCredentials: async () => { throw 'credential transport refusal' },
    })
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.store.getSnapshot().credentialError).toBe('credential transport refusal')
  })

  it('surfaces a directory failure and keeps the last good rows', async () => {
    /** 中文说明：测试局部值 { face, mirror }，由紧邻初始化决定。 */
    const { face, mirror } = api()
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    await store.load()
    expect(store.store.getSnapshot().rows).toHaveLength(4)
    /** 中文说明：测试局部值 broken，由紧邻初始化决定。 */
    const broken = api({ providers: () => Promise.resolve(fail('directory down')) })
    /** 中文说明：测试局部值 failing，由紧邻初始化决定。 */
    const failing = new ModelsSettingsStore(broken.face, settingsSchema, broken.mirror)
    await failing.load()
    expect(failing.store.getSnapshot()).toMatchObject({ status: 'error', error: 'directory down' })
    // The first store's snapshot is untouched by the second's failure.
    expect(store.store.getSnapshot().status).toBe('ready')
  })

  it('surfaces a configurable-provider directory failure', async () => {
    const { face, mirror } = api()
    const llm = (face as unknown as {
      llm: { listConfigurableProviders: () => Promise<RemoteAnswer<never>> }
    }).llm
    llm.listConfigurableProviders = () => Promise.resolve(remoteFail<never>('configuration directory down'))
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)

    await store.load()

    expect(store.store.getSnapshot()).toMatchObject({
      status: 'error', error: 'configuration directory down',
    })
  })

  it('lets the newest load win over a stale slow response', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release: (() => void) | undefined
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：测试局部值 call，由紧邻初始化决定。 */
    let call = 0
    /** 中文说明：测试局部值 { face, mirror }，由紧邻初始化决定。 */
    const { face, mirror } = api({
      providers: async () => {
        call += 1
        if (call === 1) {
          await gate
          return fail('stale slow failure')
        }
        return ok({ providers: DIRECTORY })
      },
    })
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = store.load()
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = store.load()
    release?.()
    await Promise.all([first, second])
    expect(store.store.getSnapshot().status).toBe('ready')
  })
})

describe('edge joins', () => {
  it('treats a non-object profile as having no credential reference', async () => {
    /** 中文说明：测试局部值 { face, mirror }，由紧邻初始化决定。 */
    const { face, mirror } = api({
      describeSettings: () => Promise.resolve(remoteOk({
        writable: true,
        hasDocument: false,
        namespaces: [{
          ns: 'llm-pi-ai',
          schema: {},
          value: { providers: { weird: 'oops' } },
          applies: 'live' as const,
          secrets: [],
          revision: 0,
        }] as never,
      })),
      providers: () => Promise.resolve(ok({
        providers: [
          { provider: 'weird', displayName: 'weird', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'weird'], active: false },
        ] as never,
      })),
    })
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    await store.load()
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = store.store.getSnapshot()
    expect(state.rows[0]).toMatchObject({ configured: true, removable: false })
    expect(state.rows[0]?.apiKeyEnv).toBeUndefined()
  })

  it('describes the derived reference for a row whose profile names none', async () => {
    const { face, mirror, seenRefs } = api({
      describeSettings: () => Promise.resolve(remoteOk({
        writable: true,
        hasDocument: false,
        namespaces: [{ ns: 'llm-pi-ai', schema: {}, value: { providers: {} }, applies: 'live' as const, secrets: [], revision: 0 }] as never,
      })),
      providers: () => Promise.resolve(ok({
        providers: [
          { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], active: false },
        ] as never,
      })),
      describeCredentials: refs => Promise.resolve(remoteOk(
        Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
      )),
    })
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    await store.load()
    // The dormant row names no reference, so the join asks about the page's
    // own derived <ROUTE>_API_KEY — what the editor would display for it.
    expect(seenRefs).toEqual([['ANTHROPIC_API_KEY']])
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.rows[0]?.credential).toBeUndefined()
    expect(state.rows[0]?.derivedCredential).toMatchObject({ configured: true })
  })

  it('surfaces a settings describe failure', async () => {
    const { face, mirror } = api({ describeSettings: () => Promise.resolve(remoteFail('settings down')) })
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'settings down' })
  })

  it('reports a terminally unavailable settings mirror precisely', async () => {
    /** 中文说明：测试局部值 { face }，由紧邻初始化决定。 */
    const { face } = api()
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new ModelsSettingsStore(
      face,
      settingsSchema,
      new SettingsDescribeMirror(face, 'memory'),
    )
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'settings are unavailable in this browser',
    })
  })

  it('reuses a held settings view after its refresh fails', async () => {
    /** 中文说明：测试局部值 settingsCall，由紧邻初始化决定。 */
    let settingsCall = 0
    /** 中文说明：测试局部值 { face, mirror }，由紧邻初始化决定。 */
    const { face, mirror } = api({
      describeSettings: () => {
        settingsCall += 1
        return Promise.resolve(settingsCall === 1
          ? remoteOk({ writable: true, hasDocument: false, namespaces: NAMESPACES })
          : remoteFail('settings refresh down'))
      },
    })
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    await store.load()
    await mirror.load()
    expect(mirror.getSnapshot().error).toBe('settings refresh down')
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', error: null })
    expect(store.store.getSnapshot().rows).toHaveLength(4)
  })

  it('stringifies a non-Error load failure', async () => {
    // The wire can surface non-Error throwables; the store must stringify them.
    /** 中文说明：测试局部值 { face, mirror }，由紧邻初始化决定。 */
    const { face, mirror } = api({ providers: async () => { throw 'plain refusal' } })
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'plain refusal' })
  })

  it('drops a stale successful response after a newer load finished', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release: (() => void) | undefined
    /** 中文说明：测试局部值 gate，由紧邻初始化决定。 */
    const gate = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：测试局部值 call，由紧邻初始化决定。 */
    let call = 0
    /** 中文说明：测试局部值 { face, mirror }，由紧邻初始化决定。 */
    const { face, mirror } = api({
      providers: async () => {
        call += 1
        if (call === 1) {
          await gate
          return ok({ providers: [] as never })
        }
        return ok({ providers: DIRECTORY })
      },
    })
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = new ModelsSettingsStore(face, settingsSchema, mirror)
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = store.load()
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = store.load()
    await second
    release?.()
    await first
    // The stale empty directory never overwrote the newer join.
    expect(store.store.getSnapshot().rows).toHaveLength(4)
  })
})

describe('messageOf', () => {
  it('reads an Error message, and stringifies anything else a rejection may carry', () => {
    // The wire layer rejects with an Error, but a host or a runtime can reject
    // with any value, and the page still has to render something.
    expect(messageOf(new Error('connection lost'))).toBe('connection lost')
    expect(messageOf('the host refused')).toBe('the host refused')
    expect(messageOf(undefined)).toBe('undefined')
  })
})
