/**
 * 文件职责：验证通用设置的 settings-document-store.client.spec.ts 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止通用设置的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'

/** Store over a real mirror derived from the same fake wire. */
/* 中文说明：函数 derivedDocumentStore 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function derivedDocumentStore(api: object) {
  /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
  const wire = api as never
  return new SettingsDocumentStore(wire, new SettingsDescribeMirror(wire))
}

/** 中文说明：函数 response 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function response(hasDocument = false): RpcResponse<{
  writable: boolean
  hasDocument: boolean
  namespaces: []
}> {
  return {
    rpcId: 'settings-document' as never,
    result: {
      ok: true,
      value: { writable: true, hasDocument, namespaces: [] },
    },
  }
}

/** 中文说明：函数 opened 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function opened(): RpcResponse<{ opened: true }> {
  return {
    rpcId: 'settings-open' as never,
    result: { ok: true, value: { opened: true } },
  }
}

/** 中文说明：函数 describeFailed 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function describeFailed(message: string): RpcResponse<never> {
  return {
    rpcId: 'settings-document-failed' as never,
    result: { ok: false, error: { code: 'internal', message, details: {} } },
  }
}

describe('SettingsDocumentStore', () => {
  it('loads provider metadata and asks the settings domain to open its document', async () => {
    /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
    const describe = vi.fn(() => Promise.resolve(response(true)))
    /** 中文说明：测试局部值 openDocument，由紧邻初始化决定。 */
    const openDocument = vi.fn(() => Promise.resolve(opened()))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = derivedDocumentStore({ settings: { describe, openDocument } })
    await controller.load()
    expect(controller.store.getSnapshot()).toEqual({
      status: 'ready', opening: false, error: null,
    })
    await controller.open()
    expect(openDocument).toHaveBeenCalledWith({})
  })

  it('marks absent or failed metadata unavailable without opening anything', async () => {
    /** 中文说明：测试局部值 openDocument，由紧邻初始化决定。 */
    const openDocument = vi.fn(() => Promise.resolve(opened()))
    /** 中文说明：测试局部值 absent，由紧邻初始化决定。 */
    const absent = derivedDocumentStore({
      settings: { describe: () => Promise.resolve(response()), openDocument },
    })
    await absent.load()
    await absent.open()
    expect(absent.store.getSnapshot().status).toBe('unavailable')
    expect(openDocument).not.toHaveBeenCalled()

    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = derivedDocumentStore({
      settings: { describe: () => Promise.reject(new Error('offline')), openDocument },
    })
    await failed.load()
    expect(failed.store.getSnapshot()).toMatchObject({ status: 'unavailable', error: 'offline' })

    /** 中文说明：测试局部值 rejected，由紧邻初始化决定。 */
    const rejected = derivedDocumentStore({
      settings: { describe: () => Promise.resolve(describeFailed('provider failed')), openDocument },
    })
    await rejected.load()
    expect(rejected.store.getSnapshot()).toMatchObject({
      status: 'unavailable', error: 'provider failed',
    })
  })

  it('collapses concurrent open gestures and recovers after a failure', async () => {
    /** 中文说明：测试局部值 resolveOpen，由紧邻初始化决定。 */
    let resolveOpen!: (response: RpcResponse<{ opened: true }>) => void
    /** 中文说明：测试局部值 openDocument，由紧邻初始化决定。 */
    const openDocument = vi.fn(() => new Promise<RpcResponse<{ opened: true }>>((resolve) => { resolveOpen = resolve }))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = derivedDocumentStore({
      settings: { describe: () => Promise.resolve(response(true)), openDocument },
    })
    await controller.load()
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = controller.open()
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = controller.open()
    expect(openDocument).toHaveBeenCalledOnce()
    resolveOpen({
      rpcId: 'settings-open-failed' as never,
      result: { ok: false, error: { code: 'internal', message: 'no default editor', details: {} } },
    })
    await Promise.all([first, second])
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', opening: false, error: 'no default editor',
    })
  })

  it('reports non-Error native failures and recovers availability via a mirror refresh', async () => {
    /** 中文说明：测试局部值 rejectOpen，由紧邻初始化决定。 */
    let rejectOpen!: (reason?: unknown) => void
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve(response(true))),
        openDocument: () => new Promise((_, reject) => { rejectOpen = reject }),
      },
    })
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    /** 中文说明：测试局部值 opening，由紧邻初始化决定。 */
    const opening = controller.open()
    rejectOpen('native unavailable')
    await opening
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', opening: false, error: 'native unavailable',
    })

    // A first read that failed leaves the action unavailable with the miss
    // recorded; the mirror's next refresh (a commit or reconnect) recovers it.
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = {
      settings: {
        describe: vi.fn()
          .mockRejectedValueOnce(new Error('offline'))
          .mockResolvedValueOnce(response(true)),
        openDocument: vi.fn(),
      },
    } as never
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror(wire)
    /** 中文说明：测试局部值 caught，由紧邻初始化决定。 */
    const caught = new SettingsDocumentStore(wire, mirror)
    await caught.load()
    expect(caught.store.getSnapshot()).toMatchObject({ status: 'unavailable', error: 'offline' })
    await mirror.load()
    expect(caught.store.getSnapshot()).toMatchObject({ status: 'ready', error: null })
  })
})
