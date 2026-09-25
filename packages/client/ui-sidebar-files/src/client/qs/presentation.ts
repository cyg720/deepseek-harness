/** 官方与 QS 文件树共用状态和请求代次，呈现注册不复制读取控制器。 */
import { createFilesStore } from '../store.ts'
import { createList, filesFace } from '../face.ts'
import type { FilesInjected, WorkspaceFilesListRemote } from '../face.ts'

/** 同一 store 句柄按 session 解析，inject 按其稳定 actions 身份复用。 */
export interface SidebarFilesPresentation {
  readonly store: ReturnType<typeof createFilesStore>
  readonly inject: ReturnType<typeof filesFace>
}

/**
 * 绑定官方目录读取接口；两个界面刷新同一目录时共享最新请求代次。
 * @param remote - 已装配的工作区文件 Remote。
 * @returns 官方与二开正文注册使用的同一状态句柄和注入工厂。
 */
export function createFilesPresentation(remote: WorkspaceFilesListRemote): SidebarFilesPresentation {
  const store = createFilesStore()
  const createFace = filesFace(createList(remote))
  const faces = new WeakMap<object, FilesInjected>()
  return {
    store,
    inject(sessionId, actions) {
      let face = faces.get(actions)
      if (face === undefined) {
        face = createFace(sessionId, actions)
        faces.set(actions, face)
      }
      return face
    },
  }
}
