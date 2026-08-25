// @vitest-environment jsdom
/**
 * 文件职责：验证 dialog.client.spec.tsx 覆盖的会话日志导出行为与生命周期。
 * 技术维度：使用 TypeScript、Cordis 插件、Vitest、事件日志或异步传输。
 * 产品维度：保障 Agent 的会话日志导出能力稳定、可追踪且可恢复。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：跨进程数据不可信；持久化状态必须可重放；异步资源必须完全释放。
 * 新手阅读建议：先看导出类型和辅助函数，再读主流程，最后关注错误、恢复和清理。
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadDialog } from '../src/client/Dialog.tsx'
import type { SessionLogDownloadDialogProps } from '../src/client/Dialog.tsx'
import { en } from '../src/client/locales.ts'

/** 中文说明：常量 SID 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SID = 'session-export-dialog' as SessionId

/** 中文说明：函数 bench 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function bench(
  controller = new SessionLogDownloadController(
    async () => new Response('zip', { status: 200 }), vi.fn(),
  ),
) {
  /** 中文说明：函数值 dismiss 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  /** 中文说明：函数 useSessionLogDownload 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
  function useSessionLogDownload<T>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T): T {
    return useSyncExternalStore(
      listener => controller.store.subscribe(listener),
      () => selector(controller.store.getSnapshot()),
    )
  }
  /** 中文说明：函数值 t 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const t = (key: keyof typeof en): string => en[key]
  /** 中文说明：变量 props 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const props = { sessionId: SID, useSessionLogDownload, dismiss, t } as unknown as SessionLogDownloadDialogProps
  /** 中文说明：变量 view 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const view = render(<SessionLogDownloadDialog {...props} />)
  return { controller, dismiss, view }
}

afterEach(cleanup)

describe('SessionLogDownloadDialog', () => {
  it('shows a controller failure and closes it without reading Session history', async () => {
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = bench()
    act(() => {
      b.controller.store.set({
        bySession: { [SID]: { open: true, status: 'error', error: 'toolbar failed' } },
      })
    })
    /** 中文说明：变量 dialog 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dialog = await b.view.findByRole('dialog', { name: 'Session export failed' })
    expect(dialog.textContent).toContain('toolbar failed')
    /** 中文说明：变量 close 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const close = b.view.getAllByRole('button', { name: 'Close' })[0]
    if (close === undefined) throw new Error('Session export dialog has no close button')
    fireEvent.click(close)
    await waitFor(() => { expect(b.dismiss).toHaveBeenCalledWith(SID) })
  })

  it('renders the in-flight state and the settled browser download state', async () => {
    /** 中文说明：函数值 release 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let release!: (response: Response) => void
    /** 中文说明：函数值 pending 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const pending = new Promise<Response>((resolve) => { release = resolve })
    /** 中文说明：函数值 controller 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const controller = new SessionLogDownloadController(() => pending, vi.fn())
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = bench(controller)

    /** 中文说明：变量 download 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const download = controller.download(SID)
    expect(await b.view.findByRole('dialog', { name: 'Exporting Session' })).toBeTruthy()
    release(new Response('zip', { status: 200 }))
    await download
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })

  it('uses fallback copy when a failure has no detail', async () => {
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = bench()
    act(() => {
      b.controller.store.set({
        bySession: { [SID]: { open: true, status: 'error', error: '' } },
      })
    })
    /** 中文说明：变量 dialog 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dialog = await b.view.findByRole('dialog', { name: 'Session export failed' })
    expect(dialog.textContent).toContain('Could not start the Session export.')
    /** 中文说明：变量 close 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const close = b.view.getAllByRole('button', { name: 'Close' }).at(-1)
    if (close === undefined) throw new Error('Session export dialog has no footer action')
    fireEvent.click(close)
    await waitFor(() => { expect(b.dismiss).toHaveBeenCalledWith(SID) })
  })
})
