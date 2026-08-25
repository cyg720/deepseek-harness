/**
 * ================================ 文件注释 ================================
 * 【文件职责】客户端本地的 Workspace（工作区）实体：把"用户想创建工作区"
 *   的本地意图与"Host 已创建工作区"的服务端视图统一成一个可观察对象，
 *   身份在物化（materialize）前后保持不变。
 * 【技术维度】React 无关的可观察快照模型：内部持有 view / intent 两种
 *   状态源，通过 Notifier 实现订阅与缓存失效，兼容 ObservableSnapshot 契约。
 * 【产品维度】用户在客户端发起创建或打开工作区时，界面需要立即反映
 *   "准备中/创建中/失败"状态，同时等待 Host 后台真实创建完成。
 * 【逻辑维度】构造时区分输入类型（本地意图 or 已有 Host 视图）；
 *   materialize() 调用 Host 创建 API 并共享进行中的 Promise；
 *   adopt() 采纳新视图；subscribe/getSnapshot 服务订阅与读取。
 * 【关键边界】adopt 不允许替换不同 workspaceId 的视图；materialize 在
 *   已物化实例上返回 undefined；失败保留 error 供界面展示。
 * 【新手阅读建议】先读 sessions/notifier.ts 理解通知机制，再看本类状态流转。
 * ==========================================================================
 */
/** React-free Workspace entity with a client-local materialization lifecycle. */
/* 无 React 依赖的 Workspace 实体，具有客户端本地的物化（materialization）生命周期。 */

import type {
  IApiClient, RpcResult, WorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { transportError } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ObservableSnapshot } from '../contract/store.ts'
import { Notifier } from '../sessions/notifier.ts'

/** Host input retained by a local Workspace until materialization succeeds. */
/* 本地 Workspace 在物化成功前保留的 Host 创建输入：目前只有路径。 */
export type WorkspaceCreateInput = { path: string }

/** Observable state of a client-local Workspace intent. */
/* 客户端本地 Workspace 意图的可观察状态：名字 + 阶段 + 可选错误。 */
export interface WorkspaceIntentSnapshot {
  name: string
  phase: 'ready' | 'creating'
  error?: string
}

/** A Workspace is either a local intent or a materialized Host view. */
/* 工作区快照：要么是本地意图，要么是已物化的 Host 视图（同一时刻只存在一种）。 */
export interface WorkspaceSnapshot {
  view: WorkspaceView | undefined
  intent: WorkspaceIntentSnapshot | undefined
}

/** 内部类型：一次物化意图（创建输入 + 可观察快照），仅在物化完成前存在。 */
interface WorkspaceIntent {
  input: WorkspaceCreateInput
  snapshot: WorkspaceIntentSnapshot
}

/**
 * Observable Workspace object whose identity survives Host materialization.
 * Local instances retain their create input and failure state; materialized
 * instances expose the latest Host view.
 */
/*
 * 可观察的 Workspace 对象：对象身份在 Host 物化前后保持不变。
 * 本地实例保留创建输入与失败状态；已物化实例暴露最新的 Host 视图。
 */
export class Workspace implements ObservableSnapshot<WorkspaceSnapshot> {
  private view: WorkspaceView | undefined // 已物化的 Host 视图；物化前为 undefined
  private intent: WorkspaceIntent | undefined // 本地意图；已物化后清空
  private materialization: Promise<RpcResult<{ workspace: WorkspaceView; created: boolean }>> | null = null // 进行中的物化 Promise，重入时共享
  private snapshotCache: WorkspaceSnapshot // 快照缓存：通知失效时重建
  private readonly notifier = new Notifier(() => {
    this.snapshotCache = this.buildSnapshot() // 失效回调里用当前 view/intent 重建缓存
  })

  /**
   * @param api - shared wire client.
   * @param source - local create input or an existing Host Workspace view.
   */
  /*
   * 构造 Workspace：source 若是已有 Host 视图则直接采纳；否则包装为本地意图。
   * @param api 共享的远程调用客户端（wire client）。
   * @param source 本地创建输入（WorkspaceCreateInput）或已有的 Host 工作区视图。
   */
  constructor(private readonly api: IApiClient, source: WorkspaceCreateInput | WorkspaceView) {
    if ('workspaceId' in source) {
      this.view = source
    } else {
      this.intent = {
        input: source,
        snapshot: { name: intentName(source), phase: 'ready' },
      }
    }
    this.snapshotCache = this.buildSnapshot()
  }

  /**
   * Materialize this local Workspace through the Host create API.
   * Re-entry shares the in-flight completion; a materialized instance returns undefined.
   * @returns the Host result, or undefined when this Workspace is already materialized.
   */
  /*
   * 通过 Host 创建 API 物化本工作区：重入共享进行中的 Promise；
   * 已物化的实例调用返回 undefined。
   * @returns Host 的创建结果，或 undefined（本实例已物化）。
   */
  materialize(): Promise<RpcResult<{ workspace: WorkspaceView; created: boolean }>> | undefined {
    if (this.materialization !== null) return this.materialization
    const intent = this.intent
    if (intent === undefined) return undefined
    intent.snapshot = { name: intent.snapshot.name, phase: 'creating' }
    this.notifier.notifyNow()
    const completion = this.completeMaterialization(intent).finally(() => {
      if (this.materialization === completion) this.materialization = null
    })
    this.materialization = completion
    return completion
  }

  /**
   * Adopt a Host view without replacing this Workspace object.
   * An existing materialized identity accepts updates only for the same Workspace id.
   * @param view - latest Host projection.
   */
  /*
   * 采纳一份 Host 视图而不替换本 Workspace 对象。
   * 已物化的身份只接受同一 workspaceId 的更新。
   * @param view 最新的 Host 投影。
   */
  adopt(view: WorkspaceView): void {
    if (this.view !== undefined && this.view.workspaceId !== view.workspaceId) {
      throw new Error('cannot adopt a different Workspace id')
    }
    this.view = view
    this.intent = undefined
    this.notifier.markDirty()
  }

  /**
   * Subscribe to Workspace snapshot invalidation.
   * @param listener - snapshot invalidation callback.
   * @returns unsubscribe function.
   */
  /*
   * 订阅工作区快照的失效通知。
   * @param listener 快照失效回调（不携带新快照，需再调 getSnapshot 读取）。
   * @returns 取消订阅函数。
   */
  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  /**
   * Read the cached Workspace snapshot after flushing pending notifications.
   * @returns the cached Workspace snapshot.
   */
  /*
   * 先冲刷待处理的通知，再读取缓存的工作区快照。
   * @returns 缓存的工作区快照。
   */
  getSnapshot(): WorkspaceSnapshot {
    this.notifier.ensureFresh()
    return this.snapshotCache
  }

  /**
   * 完成一次物化的内部流程：调用 Host 创建 API，成功则采纳视图，
   * 失败则把错误写回意图快照并通知订阅者。
   * @param intent 发起物化时的意图对象，用于校验物化期间是否被替换。
   * @returns Host 创建调用的 RPC 结果。
   */
  private async completeMaterialization(
    intent: WorkspaceIntent,
  ): Promise<RpcResult<{ workspace: WorkspaceView; created: boolean }>> {
    let result: RpcResult<{ workspace: WorkspaceView; created: boolean }>
    try {
      result = (await this.api.workspace.create(intent.input)).result
    } catch (error) {
      result = transportError(error) // 网络/传输异常包装成标准 RPC 错误形态
    }
    if (this.intent !== intent) return result // 物化期间意图已被替换（如已采纳新视图），丢弃过期结果
    if (result.ok) {
      this.adopt(result.value.workspace)
    } else {
      intent.snapshot = {
        name: intent.snapshot.name,
        phase: 'ready',
        error: `${result.error.code}: ${result.error.message}`,
      }
      this.notifier.markDirty()
    }
    return result
  }

  /** 用当前 view/intent 组装对外快照。 */
  private buildSnapshot(): WorkspaceSnapshot {
    return { view: this.view, intent: this.intent?.snapshot }
  }
}

/**
 * 从创建输入路径推导展示名。
 * @param input 本地创建输入（含 path）。
 * @returns 去掉结尾分隔符后路径的最后一段；空路径时回退为原输入路径。
 */
function intentName(input: WorkspaceCreateInput): string {
  const trimmed = input.path.replace(/[\\/]+$/, '') // 去掉结尾的 \ 或 /（兼容 Windows 与 Unix 风格）
  return trimmed.split(/[\\/]/).pop() ?? input.path
}
