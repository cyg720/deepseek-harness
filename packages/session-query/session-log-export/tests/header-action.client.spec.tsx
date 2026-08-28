// @vitest-environment jsdom
/**
 * 文件职责：验证 header-action.client.spec.tsx 覆盖的会话日志导出行为与生命周期。
 * 技术维度：使用 TypeScript、Cordis 插件、Vitest、事件日志或异步传输。
 * 产品维度：保障 Agent 的会话日志导出能力稳定、可追踪且可恢复。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：跨进程数据不可信；持久化状态必须可重放；异步资源必须完全释放。
 * 新手阅读建议：先看导出类型和辅助函数，再读主流程，最后关注错误、恢复和清理。
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadHeaderAction } from '../src/client/HeaderAction.tsx'
import type { SessionLogDownloadDialogProps } from '../src/client/Dialog.tsx'
import { en } from '../src/client/locales.ts'

/** 中文说明：常量 SID 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SID = 'session-export-header' as SessionId

/** 中文说明：函数 bindSessionExport 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function bindSessionExport(controller: SessionLogDownloadController) {
  return function useSessionLogDownload<T>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T): T {
    return useSyncExternalStore(
      listener => controller.store.subscribe(listener),
      () => selector(controller.store.getSnapshot()),
    )
  }
}

/** 中文说明：函数 bench 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function bench() {
  /** 中文说明：函数值 controller 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const controller = new SessionLogDownloadController(async () => new Response('zip'), vi.fn())
  /** 中文说明：函数值 request 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const request = vi.fn((sessionId: SessionId) => controller.download(sessionId))
  /** 中文说明：函数值 dismiss 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  /** 中文说明：变量 useSessionLogDownload 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const useSessionLogDownload = bindSessionExport(controller)
  /** 中文说明：变量 props 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const props = {
    sessionId: SID,
    useSessionLogDownload,
    request,
    dismiss,
    t: (key: keyof typeof en): string => en[key],
  } as unknown as SessionLogDownloadDialogProps
  /** 中文说明：变量 view 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const view = render(<SessionLogDownloadHeaderAction {...props} />)
  return { controller, request, view }
}

afterEach(cleanup)

describe('Session export Header action', () => {
  it('renders the 111×32 text capsule and downloads through the shared controller', async () => {
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = bench()
    /** 中文说明：变量 button 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const button = b.view.getByRole('button', { name: 'Session log' })
    expect(button.querySelector('svg')).not.toBeNull()
    fireEvent.click(button)
    await waitFor(() => { expect(b.request).toHaveBeenCalledWith(SID) })
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })

  it('disables the capsule while either entry path downloads this Session', async () => {
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = bench()
    /** 中文说明：函数值 release 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let release!: (response: Response) => void
    /** 中文说明：函数值 pending 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const pending = new Promise<Response>((resolve) => { release = resolve })
    /** 中文说明：函数值 controller 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const controller = new SessionLogDownloadController(() => pending, vi.fn())
    /** 中文说明：变量 useSessionLogDownload 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const useSessionLogDownload = bindSessionExport(controller)
    b.view.rerender(<SessionLogDownloadHeaderAction {...({
      sessionId: SID,
      useSessionLogDownload,
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      t: (key: keyof typeof en): string => en[key],
    } as unknown as SessionLogDownloadDialogProps)} />)

    /** 中文说明：变量 download 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const download = controller.download(SID)
    /** 中文说明：变量 button 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const button = b.view.getByRole('button', { name: 'Session log' })
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('true') })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    release(new Response('zip'))
    await download
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('false') })
  })
})
