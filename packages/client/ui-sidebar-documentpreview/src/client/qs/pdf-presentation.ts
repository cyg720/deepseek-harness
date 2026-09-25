/** 双界面共享 PDF 页码状态及官方运行时；文档和画布仍由挂载的正文持有。 */
import { createPdfStore } from '../pdf/store.ts'
import { openPdf } from '../pdf/runtime.ts'
import { renderPdfPage } from '../pdf/document.ts'
import type { PdfBodyInjected } from '../pdf/PdfBody.tsx'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** 读取策略和 worker 生命周期沿用官方实现，QS 只替换呈现。 */
export interface PdfPresentation {
  readonly store: ReturnType<typeof createPdfStore>
  /** @param sessionId - 所属会话。 @param actions - 实例操作。 @returns 标签页码保留操作。 */
  readonly inject: (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createPdfStore>>) => PdfBodyInjected
  readonly open: typeof openPdf
  readonly render: typeof renderPdfPage
}
/**
 * 建立唯一页码状态与标签释放登记。
 * @returns 对外呈现能力及插件所有者调用的释放函数。
 */
export function createPdfPresentation(): { presentation: PdfPresentation; dispose: () => void } {
  const store = createPdfStore(), retained = new Map<AbortSignal, () => void>()
  const faces = new WeakMap<object, PdfBodyInjected>()
  const presentation: PdfPresentation = {
    store, open: openPdf, render: renderPdfPage,
    inject(_sessionId, actions) {
      let face = faces.get(actions)
      if (face === undefined) {
        face = { retainTab(tabId, signal) {
          if (signal.aborted) { actions.forget(tabId); return }
          if (retained.has(signal)) return
          const forget = () => {
            signal.removeEventListener('abort', forget)
            retained.delete(signal)
            actions.forget(tabId)
          }
          retained.set(signal, forget)
          signal.addEventListener('abort', forget, { once: true })
        } }
        faces.set(actions, face)
      }
      return face
    },
  }
  return { presentation, dispose: () => { for (const forget of retained.values()) forget() } }
}
