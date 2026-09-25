/** 官方和 QS 预览共享内容、阅读位置及请求代次，切换呈现不另建读取控制器。 */
import { createTextStore } from '../store.ts'
import { textFace } from '../face.ts'
import { createReadPage } from '../rpc.ts'
import type { ReadDocumentBytes, WorkspaceFilesReadRemote } from '../rpc.ts'
import type { TextPreviewInjected } from '../TextPreview.tsx'
import type { DocumentPreviewRegistry } from '../document/registry.ts'
import { packHtml } from '../html/pack.ts'
import { createReadHtmlRelative } from '../html/read-relative.ts'
import type { ReadHtmlRelated } from '../html/read-relative.ts'
import { createHtmlDocument } from '../html/bootstrap.ts'

/** 正文注册共用同一 store；注入结果按 session 实例的稳定 actions 身份缓存。 */
export interface DocumentPreviewPresentation {
  readonly store: ReturnType<typeof createTextStore>
  readonly inject: (...args: Parameters<ReturnType<typeof textFace>>) => TextPreviewInjected
  /**
   * 按官方限制打包 HTML 静态依赖，不向隔离文档传递 Host 回调。
   * @param address - 原始文档地址，决定读取权限所属会话。
   * @param data - 完整 UTF-8 文档字节。
   * @param lifetime - 标签生命周期。
   * @param signal - 本次呈现生命周期。
   * @returns 用于不透明 iframe 的引导文档；读取或限额失败时拒绝。
   */
  readonly prepareHtml: (address: string, data: Uint8Array<ArrayBuffer>, lifetime: AbortSignal, signal: AbortSignal) => Promise<string>
}

/**
 * 将官方读取和渲染类型订阅绑定到双界面共用的预览状态。
 * @param remote - 已装配的分页文件读取接口。
 * @param readAll - 官方完整字节读取接口，沿用 Host 大小和权限限制。
 * @param previews - 官方六类预览注册表。
 * @param readRelated - 官方关联文件读取，仍由 Host 解析实际路径。
 * @returns 共享状态句柄和绑定一次的注入工厂。
 */
export function createDocumentPresentation(
  remote: WorkspaceFilesReadRemote, readAll: ReadDocumentBytes, previews: DocumentPreviewRegistry,
  readRelated: ReadHtmlRelated,
): DocumentPreviewPresentation {
  const store = createTextStore(), bind = textFace(createReadPage(remote), readAll)
  const source = { getSnapshot: previews.getSnapshot, subscribe: previews.subscribe }
  const faces = new WeakMap<object, TextPreviewInjected>()
  return {
    store,
    async prepareHtml(address, data, lifetime, signal) {
      const combined = AbortSignal.any([lifetime, signal])
      const bundle = await packHtml(data, createReadHtmlRelative(readRelated, address, lifetime), combined)
      combined.throwIfAborted()
      return createHtmlDocument(bundle)
    },
    inject(sessionId, actions) {
      let face = faces.get(actions)
      if (face === undefined) {
        face = { ...bind(sessionId, actions), hooks: { documentPreviews: source } }
        faces.set(actions, face)
      }
      return face
    },
  }
}
