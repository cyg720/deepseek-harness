// @vitest-environment jsdom
/**
 * 文件职责：验证 controller.client.spec.ts 覆盖的会话日志导出行为与生命周期。
 * 技术维度：使用 TypeScript、Cordis 插件、Vitest、事件日志或异步传输。
 * 产品维度：保障 Agent 的会话日志导出能力稳定、可追踪且可恢复。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：跨进程数据不可信；持久化状态必须可重放；异步资源必须完全释放。
 * 新手阅读建议：先看导出类型和辅助函数，再读主流程，最后关注错误、恢复和清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  downloadUrl, SessionLogDownloadController, sessionLogZipFilename,
} from '../src/client/controller.ts'

/** 中文说明：常量 SID 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SID = 'session-export-controller' as SessionId

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SessionLogDownloadController', () => {
  it('downloads the host ZIP and publishes one shared success state', async () => {
    /** 中文说明：函数值 fetcher 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const fetcher = vi.fn(async () => new Response('zip', { status: 200 }))
    /** 中文说明：变量 save 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const save = vi.fn()
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionLogDownloadController(fetcher, save)

    await controller.download(SID)

    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.pathname).toBe('/api/session.export')
    expect(url.searchParams.get('sessionId')).toBe(SID)
    expect(url.searchParams.get('includeDescendants')).toBe('true')
    expect(init.method).toBe('HEAD')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(save).toHaveBeenCalledWith(
      url.toString(),
      'dsh-session-session-export-controller.zip',
    )
    expect(controller.store.getSnapshot().bySession[SID]).toEqual({
      open: true, status: 'success', error: null,
    })
  })

  it('collapses concurrent gestures and preserves a dismissed dialog', async () => {
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = Promise.withResolvers<Response>()
    /** 中文说明：函数值 fetcher 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const fetcher = vi.fn(() => response.promise)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionLogDownloadController(fetcher, vi.fn())

    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = controller.download(SID)
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = controller.download(SID)
    expect(first).toBe(second)
    controller.dismiss(SID)
    response.resolve(new Response('zip', { status: 200 }))
    await first

    expect(fetcher).toHaveBeenCalledOnce()
    expect(controller.store.getSnapshot().bySession[SID]?.open).toBe(false)
    controller.dismiss(SID)
  })

  it('publishes HTTP and transport failures without leaking rejections', async () => {
    /** 中文说明：变量 http 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const http = new SessionLogDownloadController(
      async () => new Response('backend unavailable', { status: 500 }), vi.fn(),
    )
    await http.download(SID)
    expect(http.store.getSnapshot().bySession[SID]).toEqual({
      open: true,
      status: 'error',
      error: 'Export failed: HTTP 500 backend unavailable',
    })

    /** 中文说明：函数值 transport 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const transport = new SessionLogDownloadController(async () => { throw 'offline' }, vi.fn())
    await transport.download(SID)
    expect(transport.store.getSnapshot().bySession[SID]?.error).toBe('offline')

    transport.dismiss('absent' as SessionId)

    /** 中文说明：变量 emptyDetail 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const emptyDetail = new SessionLogDownloadController(
      async () => ({
        ok: false, status: 503, text: async () => { throw new Error('body unavailable') },
      }) as unknown as Response,
      vi.fn(),
    )
    await emptyDetail.download(SID)
    expect(emptyDetail.store.getSnapshot().bySession[SID]?.error).toBe('Export failed: HTTP 503')
  })

  it('aborts active fetches on disposal and rejects later requests', async () => {
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let signal: AbortSignal | undefined
    /** 中文说明：函数值 fetcher 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const fetcher = vi.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal ?? undefined
      signal?.addEventListener('abort', () => {
        reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
      }, { once: true })
    }))
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionLogDownloadController(fetcher, vi.fn())
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = controller.download(SID)

    await controller.dispose()

    await expect(pending).resolves.toBeUndefined()
    expect(signal?.aborted).toBe(true)
    await expect(controller.download(SID)).resolves.toBeUndefined()
    await controller.dispose()
  })

  it('uses the null-origin fallback and default browser operations', async () => {
    vi.stubGlobal('location', { origin: 'null' })
    /** 中文说明：函数值 fetcher 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const fetcher = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response('zip'))
    vi.stubGlobal('fetch', fetcher)
    /** 中文说明：函数值 click 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new SessionLogDownloadController()

    await controller.download(SID)

    expect((fetcher.mock.calls[0]?.[0] as URL).origin).toBe('http://dsh.internal')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'HEAD' })
    expect(click).toHaveBeenCalledOnce()
  })

  it('defaults dialog openness when state is externally cleared before settlement', async () => {
    /** 中文说明：变量 success 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const success = Promise.withResolvers<Response>()
    /** 中文说明：函数值 successful 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const successful = new SessionLogDownloadController(() => success.promise, vi.fn())
    /** 中文说明：变量 successRun 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const successRun = successful.download(SID)
    successful.store.set({ bySession: {} })
    success.resolve(new Response('zip'))
    await successRun
    expect(successful.store.getSnapshot().bySession[SID]?.open).toBe(true)

    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = Promise.withResolvers<Response>()
    /** 中文说明：函数值 failing 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const failing = new SessionLogDownloadController(() => failure.promise, vi.fn())
    /** 中文说明：变量 failureRun 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failureRun = failing.download(SID)
    failing.store.set({ bySession: {} })
    failure.reject(new Error('failed after clear'))
    await failureRun
    expect(failing.store.getSnapshot().bySession[SID]?.open).toBe(true)
  })
})

describe('browser download helpers', () => {
  it('sanitizes the archive filename and hands the URL to a download anchor', () => {
    /** 中文说明：函数值 click 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    expect(sessionLogZipFilename('a/b' as SessionId)).toBe('dsh-session-a_b.zip')
    downloadUrl('http://host/api/session.export?sessionId=a', 'archive.zip')
    expect(click).toHaveBeenCalledOnce()
    /** 中文说明：变量 anchor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.href).toBe('http://host/api/session.export?sessionId=a')
    expect(anchor.download).toBe('archive.zip')
  })
})
