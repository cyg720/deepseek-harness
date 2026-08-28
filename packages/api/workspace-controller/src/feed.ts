/** Reconnect-safe Workspace baseline and increment producer.
 * @remarks 文件说明：文件职责：实现 api/workspace-controller 中 feed 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/workspace-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type { Workspace, WorkspaceRecord } from '@deepseek-ai/dsh-workspace'
import {
  workspaceDomainState,
  workspaceRecord,
  WorkspaceId,
} from '@deepseek-ai/dsh-workspace'
import type {
  WorkspaceBaseline,
  WorkspaceFollowFrame,
  WorkspaceView,
} from './types.ts'

/**
 * Project one authoritative Workspace entity into its Remote value.
 * @param workspace - authoritative registry entity.
 * @returns detached Workspace projection for Remote consumers.
 * @remarks 中文说明：功能说明：处理 workspaceView 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：workspace（Workspace）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：WorkspaceView；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * workspaceView(workspace)，并按返回类型处理结果。
 */
export function workspaceView(workspace: Workspace): WorkspaceView {
  return {
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

/**
 * 功能说明：处理 changedWorkspaceView 相关流程；使用场景由所在模块及调用位置决定。
 * @param workspaceId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns WorkspaceView；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 changedWorkspaceView(workspaceId, value)，并按返回类型处理结果。
 */
function changedWorkspaceView(workspaceId: string, value: unknown): WorkspaceView {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record: WorkspaceRecord = workspaceRecord.parse(value)
  return {
    workspaceId: WorkspaceId(workspaceId),
    path: record.path,
    title: record.title,
    sessionIds: [...record.sessionIds],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Owns Workspace domain observation and all active follow generations.
 * @remarks 中文说明：类说明：WorkspaceFeed 用于集中封装 处理 WorkspaceFeed 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/workspace-controller
 * 在对应插件或业务生命周期内创建和调用。 */
export class WorkspaceFeed {
  /**
   * 常量说明：followers 用于处理 followers 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly followers = new Set<WorkspaceFollower>()
  /**
   * 变量说明：knownIds 用于处理 knownIds 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private knownIds: Set<string>
  /**
   * 变量说明：order 用于处理 order 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private order: readonly string[]
  /**
   * 变量说明：archived 用于处理 archived 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private archived: readonly string[]

  /** @param ctx - Host context containing the authoritative Workspace registry.
   * @remarks 中文说明：功能说明：处理 WorkspaceFeed 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new WorkspaceFeed(ctx) 创建实例，
   * 并在所属生命周期内使用。 */
  constructor(private readonly ctx: Context) {
    /**
     * 常量说明：baseline 用于处理 baseline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const baseline = ctx.workspaceRegistry.list()
    this.knownIds = new Set(baseline.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：workspace（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(workspace)，并按返回类型处理结果。
 */ workspace => String(workspace.id)))
    this.order = baseline.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：workspace（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(workspace)，并按返回类型处理结果。
 */ workspace => String(workspace.id))
    this.archived = ctx.workspaceRegistry.archivedSessionIds.map(String)
    ctx.on('domain/changed', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：change（DomainChanged）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(change)，并按返回类型处理结果。
 */ (change: DomainChanged) => { this.changed(change) })
    ctx.effect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
          for (const /*
       * 变量说明：follower 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ follower of this.followers) follower.close()
          this.followers.clear()
        }, 'workspace-controller.feed')
  }

  /**
   * Read the complete current projection synchronously.
   * @returns all active Workspaces and archived Session identities.
   * @remarks 中文说明：功能说明：处理 baseline 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：WorkspaceBaseline；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * baseline()，并按返回类型处理结果。
   */
  baseline(): WorkspaceBaseline {
    return {
      items: this.ctx.workspaceRegistry.list().map(workspaceView),
      archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds],
    }
  }

  /**
   * Open one generation beginning with a complete baseline.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   * @remarks 中文说明：功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：AsyncIterable<WorkspaceFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 follow(signal)，并按返回类型处理结果。
   */
  async *follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    signal.throwIfAborted()
    /**
     * 常量说明：follower 用于处理 follower 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const follower = new WorkspaceFollower()
    this.followers.add(follower)
    try {
      yield { type: 'baseline', value: this.baseline() }
      yield* follower.read(signal)
    } finally {
      this.followers.delete(follower)
      follower.close()
    }
  }

  /**
   * 功能说明：处理 changed 相关流程；使用场景由所在模块及调用位置决定。
   * @param change （DomainChanged）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 changed(change)，并按返回类型处理结果。
   */
  private changed(change: DomainChanged): void {
    if (change.domain !== 'workspace') return
    if (change.table === '') {
      if (change.operation !== 'put') return
      /**
       * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const state = workspaceDomainState.parse(change.value)
      /**
       * 常量说明：nextOrder 用于处理 nextOrder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const nextOrder = state.workspaceIds.map(String)
      /**
       * 常量说明：orderChanged 用于处理 orderChanged 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const orderChanged = !sameStrings(this.order, nextOrder)
      for (const /*
       * 变量说明：id 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ id of state.workspaceIds) {
        if (this.knownIds.has(id)) continue
        /**
         * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const workspace = this.ctx.workspaceRegistry.get(id)
        if (workspace === undefined) {
          throw new Error(`committed Workspace registry references missing Workspace "${id}"`)
        }
        this.knownIds.add(id)
        this.publish({ type: 'upsert', workspace: workspaceView(workspace) })
      }
      this.order = nextOrder
      if (orderChanged) this.publish({ type: 'order', workspaceIds: [...state.workspaceIds] })
      /**
       * 常量说明：nextArchived 用于处理 nextArchived 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const nextArchived = state.archivedSessionIds.map(String)
      if (!sameStrings(this.archived, nextArchived)) {
        this.archived = nextArchived
        this.publish({ type: 'archived', archivedSessionIds: [...state.archivedSessionIds] })
      }
      return
    }
    if (change.table !== 'workspaces') return
    if (change.operation === 'deleted') {
      if (!this.knownIds.delete(change.key)) return
      this.publish({ type: 'remove', workspaceId: WorkspaceId(change.key) })
      return
    }
    if (!this.knownIds.has(change.key)) return
    this.publish({
      type: 'upsert',
      workspace: changedWorkspaceView(change.key, change.value),
    })
  }

  /**
   * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （Exclude<WorkspaceFollowFrame, { readonly type: 'baseline'
   * }>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publish(frame)，并按返回类型处理结果。
   */
  private publish(frame: Exclude<WorkspaceFollowFrame, { readonly type: 'baseline' }>): void {
    for (const /*
     * 变量说明：follower 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ follower of this.followers) follower.push(frame)
  }
}

/**
 * 功能说明：处理 sameStrings 相关流程；使用场景由所在模块及调用位置决定。
 * @param left （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param right （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sameStrings(left, right)，并按返回类型处理结果。
 */
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value, index)，并按返回类型处理结果。
 */ (value, index) => value === right[index])
}

/**
 * 类说明：WorkspaceFollower 用于集中封装 处理 WorkspaceFollower 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/workspace-controller 在对应插件或业务生命周期内创建和调用。
 */
class WorkspaceFollower {
  /**
   * 常量说明：frames 用于处理 frames 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly frames: WorkspaceFollowFrame[] = []
  /**
   * 变量说明：waiting 用于处理 waiting 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private waiting: (() => void) | undefined
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 push 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （WorkspaceFollowFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 push(frame)，并按返回类型处理结果。
   */
  push(frame: WorkspaceFollowFrame): void {
    /* v8 ignore next -- closed followers are removed before later publication can reach them. */
    if (this.closed) return
    this.frames.push(frame)
    this.waiting?.()
  }

  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.waiting?.()
  }

  /**
   * 功能说明：读取 read 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<WorkspaceFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 read(signal)，并按返回类型处理结果。
   */
  async *read(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    while (!this.closed && !signal.aborted) {
      /**
       * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const frame = this.frames.shift()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await this.wait(signal)
    }
  }

  /**
   * 功能说明：处理 wait 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 wait(signal)，并按返回类型处理结果。
   */
  private wait(signal: AbortSignal): Promise<void> {
    return new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
      /**
       * 常量说明：finish 用于处理 finish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 finish 相关流程；使用场景由所在模块及调用位置决定。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 finish()，并按返回类型处理结果。
       */
        const finish = (): void => {
          signal.removeEventListener('abort', finish)
          /* v8 ignore next -- one read owns the sole installed wait callback. */
          if (this.waiting === finish) this.waiting = undefined
          resolve()
        }
        this.waiting = finish
        signal.addEventListener('abort', finish, { once: true })
        /* v8 ignore next -- native signals and the private queue cannot change during this synchronous setup. */
        if (signal.aborted || this.closed || this.frames.length > 0) finish()
      })
  }
}
