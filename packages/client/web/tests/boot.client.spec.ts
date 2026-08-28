// @vitest-environment jsdom
/**
 * 文件职责：验证Web 启动的 boot.client.spec.ts 行为。
 * 技术维度：Vitest、协议夹具、Worker/子进程或组件替身。
 * 产品维度：防止Web 启动协议与生命周期回归。
 * 逻辑维度：构造输入，运行被测入口并断言输出与清理。
 * 关键边界：跨进程数据必须校验；Worker 和异步任务必须结束。
 * 新手阅读建议：先读协议夹具，再按成功、失败和清理场景阅读。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as modulesClient from '@deepseek-ai/dsh-client-modules/client'
import type {
  ClientBundleRegistration, ClientModuleCreateOptions, ClientModuleLoaderTarget, DshWindow,
  WebBootEntry,
} from '@deepseek-ai/dsh-client-modules/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppWebEntry } from '../src/boot.ts'

/** 中文说明：测试局部值 MODULES_ID，由紧邻初始化决定。 */
const MODULES_ID = '@deepseek-ai/dsh-client-modules'
const PROVIDER_CLIENT_ID = 'provider/client'
const RUNTIME_CLIENT_ID = 'runtime/client'
const win = globalThis as DshWindow
const transportGlobal = globalThis as {
  __DSH_TRANSPORT__?: { loadBundle(url: string): Promise<void> }
}
const moduleFace = modulesClient as unknown as Record<string, unknown>

afterEach(() => {
  vi.restoreAllMocks()
  delete win.__DSH_BOOT__
  delete win.__ModuleLoader__
  delete transportGlobal.__DSH_TRANSPORT__
  document.body.innerHTML = ''
})

/** Install the stable facade shape that the Host injects before AppWebEntry runs. */
/* 中文说明：函数 installFacade 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function installFacade(
  create?: (options: ClientModuleCreateOptions) => modulesClient.ClientModuleSystem,
): ClientModuleLoaderTarget {
  /** 中文说明：测试局部值 pendingQueue，由紧邻初始化决定。 */
  const pendingQueue: ClientBundleRegistration[] = []
  /** 中文说明：测试局部值 target，由紧邻初始化决定。 */
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load: (registration) => { pendingQueue.push(registration) },
    create: create ?? (options => modulesClient.createClientModuleSystem(target, {
      id: MODULES_ID,
      exports: moduleFace,
    }, options)),
  }
  win.__ModuleLoader__ = target
  return target
}

/** 中文说明：函数 expectBootFailure 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function expectBootFailure(setup: () => void, message: string): Promise<void> {
  /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  /** 中文说明：测试局部值 container，由紧邻初始化决定。 */
  const container = document.createElement('div')
  document.body.append(container)
  setup()
  /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
  const entry = new AppWebEntry(container)
  await entry.run()
  expect(container.textContent).toContain(message)
  expect(error).toHaveBeenCalledOnce()
  await entry.dispose()
}

describe('bootstrap failure rendering', () => {
  it('renders a missing bootstrap facade', async () => {
    await expectBootFailure(
      () => { delete win.__ModuleLoader__ },
      'window.__ModuleLoader__ bootstrap facade is missing',
    )
  })

  it('renders a create failure owned by the facade', async () => {
    await expectBootFailure(() => {
      installFacade(() => { throw new Error('facade create failed') })
    }, 'facade create failed')
  })

  it('renders a malformed boot manifest', async () => {
    await expectBootFailure(() => {
      installFacade()
      delete win.__DSH_BOOT__
    }, 'window.__DSH_BOOT__ is missing or not an object')
  })

  it('renders a module-system construction failure', async () => {
    await expectBootFailure(() => {
      installFacade()
      /** 中文说明：测试局部值 duplicate，由紧邻初始化决定。 */
      const duplicate = { id: 'duplicate', url: '/duplicate/client.js', rev: '1' }
      win.__DSH_BOOT__ = {
        rev: 'graph',
        entries: [duplicate, duplicate],
        batches: [{ phase: 'application', url: '/batch.js', rev: 'batch', entries: ['duplicate'] }],
      }
    }, 'duplicate graph entry "duplicate"')
  })
})

describe('plugin activation', () => {
  it('prefetches a parser-loaded immediate row through the injected bundle transport', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const target = installFacade()
    const entries: WebBootEntry[] = [
      { id: 'consumer', url: '/consumer.js', rev: '1' },
      {
        id: 'runtime',
        url: '/runtime.js',
        rev: '1',
        external: [PROVIDER_CLIENT_ID],
        immediately: true,
      },
      { id: 'provider', url: '/provider.js', rev: '1' },
      { id: 'renderer', url: '/renderer.js', rev: '1' },
    ]
    const applicationUrl = '/application.js'
    win.__DSH_BOOT__ = {
      rev: 'graph',
      entries,
      batches: [{ phase: 'application', url: applicationUrl, rev: 'batch', entries: entries.map(row => row.id) }],
    }
    const loaded: string[] = []
    const registrations: ClientBundleRegistration[] = [
      {
        id: 'consumer',
        factory: require => ({
          apply: () => {
            expect((require(RUNTIME_CLIENT_ID) as { marker: string }).marker).toBe('provider')
          },
        }),
      },
      {
        id: 'provider',
        factory: () => ({ apply: () => {}, marker: 'provider' }),
      },
      {
        id: 'runtime',
        factory: require => ({
          apply: () => {},
          marker: (require(PROVIDER_CLIENT_ID) as { marker: string }).marker,
        }),
      },
      {
        id: 'renderer',
        factory: () => ({
          apply: (ctx: Context) => {
            ctx.reflect.provide('uiRenderer', { mount: () => () => {} })
          },
        }),
      },
    ]
    transportGlobal.__DSH_TRANSPORT__ = {
      loadBundle: async (url) => {
        loaded.push(url)
        if (url !== applicationUrl) throw new Error(`missing fixture batch ${url}`)
        for (const registration of registrations) target.load(registration)
      },
    }

    const entry = new AppWebEntry(container)
    await entry.run()

    expect(loaded).toEqual([applicationUrl])
    await entry.dispose()
  })

  it('allows a modules-dependent row to be created before the modules row', async () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events: string[] = []
    /** 中文说明：测试局部值 container，由紧邻初始化决定。 */
    const container = document.createElement('div')
    document.body.append(container)
    /** 中文说明：测试局部值 target，由紧邻初始化决定。 */
    const target = installFacade()
    /** 中文说明：测试局部值 entries，由紧邻初始化决定。 */
    const entries: WebBootEntry[] = [
      { id: 'consumer', url: '/consumer.js', rev: '1' },
      { id: MODULES_ID, url: '/modules.js', rev: '1' },
      { id: 'renderer', url: '/renderer.js', rev: '1' },
    ]
    win.__DSH_BOOT__ = {
      rev: 'graph',
      entries,
      batches: [{
        phase: 'application',
        url: '/application.js',
        rev: 'batch',
        entries: entries.map(row => row.id),
      }],
    }
    const registrations = new Map<string, ClientBundleRegistration>([
      ['/consumer.js', {
        id: 'consumer',
        factory: () => ({
          inject: ['modules'],
          apply: (ctx: Context) => {
            expect(ctx.modules).toBeDefined()
            events.push('consumer')
          },
        }),
      }],
      ['/renderer.js', {
        id: 'renderer',
        factory: () => ({
          apply: (ctx: Context) => {
            ctx.reflect.provide('uiRenderer', {
              mount: (element: HTMLElement) => {
                events.push('mount')
                element.textContent = 'mounted'
                return () => {}
              },
            })
          },
        }),
      }],
    ])
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = new AppWebEntry(container, {
      loadBundle: async (url) => {
        if (url !== '/application.js') throw new Error(`missing fixture batch ${url}`)
        for (const registration of registrations.values()) target.load(registration)
      },
    })

    await entry.run()

    expect(target.mode).toBe('live')
    expect(events).toEqual(['consumer', 'mount'])
    expect(container.textContent).toBe('mounted')
    await entry.dispose()
  })
})
