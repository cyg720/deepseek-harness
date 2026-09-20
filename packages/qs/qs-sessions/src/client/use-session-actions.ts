/** 会话动作适配：创建期间合并重复请求，导航变化后不接管当前选择。 */
import type { ISessions, SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** 会话动作面。 */
export interface SessionActions {
  /**
   * 选择会话。
   * @param id - 目标会话。
   */
  open(id: SessionId): void
  /**
   * 新建会话并切过去（`create` 不改变当前会话，必须紧随 `open`）。
   * @param signal - 取消本地导航；不撤销 Host 创建。
   * @returns 新会话 id，或 undefined（失败已由调用方提示）。
   */
  create(signal: AbortSignal): Promise<SessionId | undefined>
  /**
   * 重命名会话。
   * @param id - 目标会话。
   * @param title - 新标题。
   * @returns 是否成功。
   */
  rename(id: SessionId, title: string): Promise<boolean>
  /**
   * 归档会话。
   * @param id - 目标会话。
   * @returns 是否成功。
   */
  archive(id: SessionId): Promise<boolean>
  /**
   * 判断某会话当前是否可归档（空闲、无待发任务、无待答复请求）。
   * @param id - 目标会话。
   * @param pending - 当前有待答复请求的会话集合。
   * @returns 可归档为 true。
   */
  canArchive(id: SessionId, pending: ReadonlySet<SessionId>): boolean
}

/** 会话动作实现所需的窄面依赖。 */
export interface SessionActionDeps {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  /** 读取会话快照；会话不在作用域时返回 undefined。 */
  readonly faceOf: (id: SessionId) => SessionFace | undefined
}

/**
 * 创建会话动作集。
 * @param deps - 会话与工作区服务面。
 * @returns 动作集。
 */
export function createSessionActions(deps: SessionActionDeps): SessionActions {
  let creation: Promise<SessionId | undefined> | undefined
  return {
    open(id: SessionId): void {
      deps.sessions.open(id)
    },

    create(signal: AbortSignal): Promise<SessionId | undefined> {
      if (signal.aborted) return Promise.resolve(undefined)
      if (creation !== undefined) return creation
      const initial = deps.sessions.list.getSnapshot().current
      let navigated = false
      const detach = deps.sessions.list.subscribe(() => {
        if (deps.sessions.list.getSnapshot().current !== initial) navigated = true
      })
      creation = deps.sessions.create({}).then((id) => {
        detach()
        if (!navigated && !signal.aborted) deps.sessions.open(id)
        return id
      }).catch((error: unknown) => {
        console.error('qs-sessions: create failed', error)
        return undefined
      }).finally(() => { detach(); creation = undefined })
      return creation
    },

    async rename(id: SessionId, title: string): Promise<boolean> {
      const face = deps.faceOf(id)
      if (face === undefined) return false
      const result = await face.rename(title)
      return result.ok
    },

    async archive(id: SessionId): Promise<boolean> {
      try {
        await deps.workspaces.archiveSession(id)
        return true
      } catch (error) {
        console.error('qs-sessions: archive failed', error)
        return false
      }
    },

    canArchive(id: SessionId, pending: ReadonlySet<SessionId>): boolean {
      if (pending.has(id)) return false
      const face = deps.faceOf(id)
      if (face === undefined) return false
      const snapshot = face.getSnapshot()
      return !snapshot.running && snapshot.queue.length === 0
    },
  }
}
