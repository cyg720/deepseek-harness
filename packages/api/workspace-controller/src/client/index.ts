/** Workspace-specific adapter for the Gateway-owned snapshot stream lifecycle. */

/*
 * 文件说明：文件职责：实现 api/workspace-controller 中 index 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/workspace-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  RemoteSnapshotStream,
  RemoteStreamCarrierError,
  type ClientRemote,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { WorkspaceFollowFrame, WorkspaceFollowIncrement } from '../types.ts'
import type { WorkspaceFollowSink } from './model.ts'
import { ClientWorkspaceModel } from './model.ts'
import { WorkspaceController } from './service.ts'

export { ClientWorkspaceModel } from './model.ts'
export type {
  WorkspaceFollowSink, WorkspaceListPhase, WorkspaceRemote, WorkspaceSnapshot,
} from './model.ts'
export { WorkspaceController, WorkspaceCreateError } from './service.ts'
export type { IWorkspaces, WorkspaceSource } from './service.ts'
export type { WorkspaceId, WorkspaceView } from '../types.ts'

type WorkspaceBaselineFrame = Extract<WorkspaceFollowFrame, { type: 'baseline' }>

/** Gateway-owned snapshot stream configured for Workspace state. */
export type WorkspaceStateStream = RemoteSnapshotStream<
  WorkspaceBaselineFrame,
  WorkspaceFollowIncrement
>

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** React-free Client Workspace state and commands. */
    workspaces: import('./service.ts').IWorkspaces
  }
}

/** Required Client Remote services. */
export const inject = ['remote', 'remote.workspace']

/**
 * Install Client Workspace state, commands, and reconnecting follow control.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  const model = new ClientWorkspaceModel(ctx.remote.workspace)
  new WorkspaceController(ctx, model)
  const control = createWorkspaceStateStream(ctx.remote, {
    accept: model,
    carrierFailed: () => { model.handleCarrierFailure() },
    failed: (error) => { model.handleStreamFailure(error) },
  })
  control.start()
  ctx.effect(
    () => async () => { await control.dispose() },
    'workspace-controller.client.control',
  )
}

/** Domain sinks used by the Workspace state stream. */
export interface WorkspaceStateStreamOptions {
  /** Destinations for decoded Workspace state operations. */
  readonly accept: WorkspaceFollowSink
  /** Observe a retryable carrier loss before reconnection. */
  readonly carrierFailed?: (error: RemoteStreamCarrierError) => void
  /** Publish a terminal business or protocol failure. */
  readonly failed: (error: unknown) => void
}

/**
 * Create the reconnecting Workspace state stream.
 * @param remote - Client Remote face carrying the Workspace namespace and the stream factory.
 * @param options - Workspace state destinations.
 * @returns an unstarted stream owned by the Client Workspace runtime.
 */
export function createWorkspaceStateStream(
  remote: ClientRemote,
  options: WorkspaceStateStreamOptions,
): WorkspaceStateStream {
  const stream = remote.$stream<WorkspaceFollowFrame>({
    name: 'Workspace state stream',
    open: signal => remote.workspace.follow(signal),
    ended: accepted => accepted
      ? new RemoteStreamCarrierError('Workspace state stream ended without a terminal result')
      : new Error('Workspace state stream ended before its opening snapshot'),
    ...(options.carrierFailed === undefined ? {} : { carrierFailed: options.carrierFailed }),
  })
  return new RemoteSnapshotStream<WorkspaceBaselineFrame, WorkspaceFollowIncrement>(stream, {
    name: 'Workspace state stream',
    isSnapshot: (frame): frame is WorkspaceBaselineFrame => frame.type === 'baseline',
    replace: (frame) => { options.accept.replaceBaseline(frame.value) },
    update: (frame) => { acceptIncrement(options.accept, frame) },
    failed: options.failed,
  })
}

function acceptIncrement(accept: WorkspaceFollowSink, frame: WorkspaceFollowIncrement): void {
  switch (frame.type) {
    case 'upsert':
      accept.upsertView(frame.workspace)
      return
    case 'remove':
      accept.removeView(frame.workspaceId)
      return
    case 'order':
      accept.replaceOrder(frame.workspaceIds)
      return
    case 'archived':
      accept.replaceArchived(frame.archivedSessionIds)
      return
    /* v8 ignore next -- the generated Remote codec validates this closed union */
    default:
      return assertNever(frame)
  }
}

/* v8 ignore next 3 -- closed-union backstop after generated Remote validation */
function assertNever(value: never): never {
  throw new Error(`unreachable Workspace increment: ${JSON.stringify(value)}`)
}
