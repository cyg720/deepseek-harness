/**
 * 文件职责：验证 api/workspace-controller 中 transport client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  RemoteStream,
  RemoteStreamCarrierError,
  type RemoteStreamOptions,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import * as WorkspaceClientPlugin from '../src/client/index.ts'
import {
  ClientWorkspaceModel,
  createWorkspaceStateStream,
  WorkspaceController,
  WorkspaceCreateError,
  type WorkspaceFollowSink,
  type WorkspaceRemote,
} from '../src/client/index.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceFollowFrame,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceError,
  WorkspaceId,
  WorkspaceValue,
  WorkspaceView,
} from '../src/types.ts'

/**
 * 常量说明：AVAILABLE_CONNECTION 用于处理 AVAILABLE_CONNECTION 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const AVAILABLE_CONNECTION = {
  generation: {
    getSnapshot: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ id: 1, host: { home: '/home/fixture' } }),
    subscribe: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {},
  },
}

/**
 * 功能说明：处理 workspaceClient 相关流程；使用场景由所在模块及调用位置决定。
 * @param remote （WorkspaceRemote）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param connection （Pick<ConnectionHandle, 'generation'>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 workspaceClient(remote, connection)，并按返回类型处理结果。
 */
function workspaceClient(
  remote: WorkspaceRemote,
  connection: Pick<ConnectionHandle, 'generation'> = AVAILABLE_CONNECTION,
) {
  return {
    workspace: remote,
    $stream: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（RemoteStreamOptions<Item>
 * ）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(options)，并按返回类型处理结果。
 */ <Item>(options: RemoteStreamOptions<Item>) => new RemoteStream(connection, options),
  }
}

interface Generation {
  readonly frames: readonly WorkspaceFollowFrame[]
  readonly error?: unknown
  readonly hold?: boolean
  readonly afterAbort?: () => void
  readonly afterAbortError?: unknown
}

/**
 * 常量说明：baseline 用于处理 baseline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 baseline 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns Extract<WorkspaceFollowFrame, { type: 'baseline' }>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 baseline(id)，并按返回类型处理结果。
 */
const baseline = (id?: string): Extract<WorkspaceFollowFrame, { type: 'baseline' }> => ({
  type: 'baseline',
  value: {
    items: id === undefined ? [] : [{
      workspaceId: id as never,
      path: `/work/${id}`,
      title: id,
      sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    archivedSessionIds: [],
  },
})

/**
 * 常量说明：wid 用于处理 wid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 wid 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns WorkspaceId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 wid(id)，并按返回类型处理结果。
 */
const wid = (id: string): WorkspaceId => id as WorkspaceId
/**
 * 常量说明：sid 用于处理 sid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 sid 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns SessionId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sid(id)，并按返回类型处理结果。
 */
const sid = (id: string): SessionId => SessionId(id)

/**
 * 功能说明：处理 workspace 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param overrides （Partial<WorkspaceView>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns WorkspaceView；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 workspace(id, overrides)，并按返回类型处理结果。
 */
function workspace(id: string, overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    workspaceId: wid(id),
    path: `/work/${id}`,
    title: id,
    sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * 功能说明：处理 remoteOk 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RemoteResult<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 remoteOk(value)，并按返回类型处理结果。
 */
function remoteOk<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

/**
 * 功能说明：处理 remoteFailure 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （WorkspaceError）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RemoteResult<never>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 remoteFailure(error)，并按返回类型处理结果。
 */
function remoteFailure(error: WorkspaceError): RemoteResult<never> {
  return { ok: false, error }
}

/**
 * 功能说明：处理 accepts 相关流程；使用场景由所在模块及调用位置决定。
 * @param overrides （Partial<WorkspaceFollowSink>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns WorkspaceFollowSink；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 accepts(overrides)，并按返回类型处理结果。
 */
function accepts(overrides: Partial<WorkspaceFollowSink> = {}): WorkspaceFollowSink {
  /**
   * 常量说明：ignore 用于处理 ignore 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 ignore 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 ignore()，并按返回类型处理结果。
   */
  const ignore = (): void => {}
  return {
    replaceBaseline: ignore,
    upsertView: ignore,
    removeView: ignore,
    replaceOrder: ignore,
    replaceArchived: ignore,
    ...overrides,
  }
}

/**
 * 类说明：ScriptedWorkspaceRemote 用于集中封装 处理 ScriptedWorkspaceRemote 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/workspace-controller 在对应插件或业务生命周期内创建和调用。
 */
class ScriptedWorkspaceRemote implements WorkspaceRemote {
  /**
   * 常量说明：signals 用于处理 signals 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly signals: AbortSignal[] = []
  /**
   * 变量说明：calls 用于处理 calls 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  calls = 0

  /**
   * 功能说明：处理 ScriptedWorkspaceRemote 相关流程；使用场景由所在模块及调用位置决定。
   * @param generations （readonly Generation[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ScriptedWorkspaceRemote(generations) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly generations: readonly Generation[]) {}

  /**
   * 功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。
   * @param _request （WorkspaceCreateRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceCreateValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 create(_request)，并按返回类型处理结果。
   */
  create(_request: WorkspaceCreateRequest): Promise<RemoteResult<WorkspaceCreateValue>> {
    throw new Error('unused')
  }

  /**
   * 功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。
   * @param _request （WorkspaceRenameRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceValue>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rename(_request)，并按返回类型处理结果。
   */
  rename(_request: WorkspaceRenameRequest): Promise<RemoteResult<WorkspaceValue>> {
    throw new Error('unused')
  }

  /**
   * 功能说明：删除 delete 相关流程；使用场景由所在模块及调用位置决定。
   * @param _request （WorkspaceDeleteRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceDeleteValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 delete(_request)，并按返回类型处理结果。
   */
  delete(_request: WorkspaceDeleteRequest): Promise<RemoteResult<WorkspaceDeleteValue>> {
    throw new Error('unused')
  }

  /**
   * 功能说明：处理 insertBefore 相关流程；使用场景由所在模块及调用位置决定。
   * @param _request （WorkspaceInsertBeforeRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceOrderValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 insertBefore(_request)，并按返回类型处理结果。
   */
  insertBefore(_request: WorkspaceInsertBeforeRequest): Promise<RemoteResult<WorkspaceOrderValue>> {
    throw new Error('unused')
  }

  /**
   * 功能说明：处理 insertSessionBefore 相关流程；使用场景由所在模块及调用位置决定。
   * @param _request （WorkspaceInsertSessionBeforeRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceValue>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 insertSessionBefore(_request)，并按返回类型处理结果。
   */
  insertSessionBefore(_request: WorkspaceInsertSessionBeforeRequest): Promise<RemoteResult<WorkspaceValue>> {
    throw new Error('unused')
  }

  /**
   * 功能说明：处理 archiveSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param _request （WorkspaceArchiveSessionRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteResult<WorkspaceArchiveValue>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 archiveSession(_request)，并按返回类型处理结果。
   */
  archiveSession(_request: WorkspaceArchiveSessionRequest): Promise<RemoteResult<WorkspaceArchiveValue>> {
    throw new Error('unused')
  }

  /**
   * 功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （由 TypeScript 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<WorkspaceFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 follow(signal)，并按返回类型处理结果。
   */
  async *follow(signal = new AbortController().signal): AsyncIterable<WorkspaceFollowFrame> {
    /**
     * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const generation = this.generations[this.calls++]
    if (generation === undefined) throw new Error('no scripted Workspace generation')
    this.signals.push(signal)
    for (const /*
     * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ frame of generation.frames) yield frame
    if (generation.error !== undefined) throw generation.error
    if (generation.hold === true && !signal.aborted) {
      await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
          signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { resolve() }, { once: true })
        })
      generation.afterAbort?.()
      if (generation.afterAbortError !== undefined) throw generation.afterAbortError
    }
  }
}

/**
 * 类说明：CommandWorkspaceRemote 用于集中封装 处理 CommandWorkspaceRemote 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/workspace-controller 在对应插件或业务生命周期内创建和调用。
 */
class CommandWorkspaceRemote implements WorkspaceRemote {
  /**
   * 常量说明：create 用于创建 create 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly create = vi.fn<WorkspaceRemote['create']>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => Promise.resolve(remoteOk({
      workspace: workspace('created', { path: request.path }),
      created: true,
    })))

  /**
   * 常量说明：rename 用于处理 rename 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly rename = vi.fn<WorkspaceRemote['rename']>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => Promise.resolve(remoteOk({
      workspace: workspace(String(request.workspaceId), { title: request.title }),
    })))

  /**
   * 常量说明：delete 用于删除 delete 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly delete = vi.fn<WorkspaceRemote['delete']>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve(remoteOk({ deleted: true })))

  /**
   * 常量说明：insertBefore 用于处理 insertBefore 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly insertBefore = vi.fn<WorkspaceRemote['insertBefore']>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => Promise.resolve(remoteOk({
      workspaceIds: [request.workspaceId],
    })))

  /**
   * 常量说明：insertSessionBefore 用于处理 insertSessionBefore 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly insertSessionBefore = vi.fn<WorkspaceRemote['insertSessionBefore']>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => Promise.resolve(remoteOk({
      workspace: workspace(String(request.workspaceId), { sessionIds: [request.sessionId] }),
    })))

  /**
   * 常量说明：archiveSession 用于处理 archiveSession 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly archiveSession = vi.fn<WorkspaceRemote['archiveSession']>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
 */ request => Promise.resolve(remoteOk({
      archivedSessionIds: [request.sessionId],
    })))

  /**
   * 功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。
   * @param _signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<WorkspaceFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 follow(_signal)，并按返回类型处理结果。
   */
  async *follow(_signal?: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {}
}

/**
 * 功能说明：处理 waitFor 相关流程；使用场景由所在模块及调用位置决定。
 * @param check （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 waitFor(check)，并按返回类型处理结果。
 */
async function waitFor(check: () => void): Promise<void> {
  for (let /*
   * 变量说明：attempt 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ attempt = 0; attempt < 40; attempt++) {
    try {
      check()
      return
    } catch {
      await Promise.resolve()
    }
  }
  check()
}

/**
 * 功能说明：处理 provideClientServices 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param remote （WorkspaceRemote）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 provideClientServices(ctx, remote)，并按返回类型处理结果。
 */
function provideClientServices(ctx: Context, remote: WorkspaceRemote): void {
  /**
   * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const connection: ConnectionHandle = {
    isLoopback: true,
    generation: AVAILABLE_CONNECTION.generation,
    rpc: {
      call: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(new Error('unexpected generic RPC call')),
    },
    registerGenerationSource: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {},
    start: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ stop: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {} }),
  }
  ctx.reflect.provide('connection', connection)
  ctx.reflect.provide('remote', workspaceClient(remote, connection))
  ctx.reflect.provide('remote.workspace', remote)
}

describe('Workspace Controller Client apply', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('provides the Workspace service and stops its follow generation with the plugin fiber', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = new Context()
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedWorkspaceRemote([{ frames: [baseline('mounted')], hold: true }])
        provideClientServices(ctx, remote)
        /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const fiber = ctx.plugin(WorkspaceClientPlugin)
        await fiber
        await waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            expect(ctx.workspaces.list.getSnapshot()).toMatchObject({
              phase: 'ready',
              state: 'idle',
              items: [{ workspaceId: 'mounted' }],
            })
          })

        await fiber.dispose()

        expect(remote.signals[0]?.aborted).toBe(true)
        expect(ctx.get('workspaces')).toBeUndefined()
      })

    it('marks carrier loss while retrying and publishes a later protocol failure', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const ctx = new Context()
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedWorkspaceRemote([
          {
            frames: [baseline('old')],
            error: new RemoteStreamCarrierError('generation lost'),
          },
          { frames: [baseline('fresh'), baseline('duplicate')] },
        ])
        provideClientServices(ctx, remote)
        /**
     * 常量说明：carrierFailure 用于处理 carrierFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const carrierFailure = vi.spyOn(ClientWorkspaceModel.prototype, 'handleCarrierFailure')
        /**
     * 常量说明：streamFailure 用于处理 streamFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const streamFailure = vi.spyOn(ClientWorkspaceModel.prototype, 'handleStreamFailure')
        /**
     * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const fiber = ctx.plugin(WorkspaceClientPlugin)
        await fiber
        await waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            expect(ctx.workspaces.list.getSnapshot()).toMatchObject({
              phase: 'ready',
              state: 'error',
              items: [{ workspaceId: 'fresh' }],
              error: { code: 'internal', message: 'Workspace state stream emitted more than one opening snapshot' },
            })
          })

        expect(carrierFailure).toHaveBeenCalledOnce()
        expect(streamFailure).toHaveBeenCalledOnce()
        await fiber.dispose()
      })
  })

describe('Workspace state stream', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('delivers one baseline followed by increments', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：opening 用于处理 opening 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const opening = baseline('one')
        /**
     * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const workspace = opening.value.items[0]!
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedWorkspaceRemote([{
          frames: [
            opening,
            { type: 'upsert', workspace },
            { type: 'remove', workspaceId: workspace.workspaceId },
            { type: 'order', workspaceIds: [workspace.workspaceId] },
            { type: 'archived', archivedSessionIds: ['session-one' as never] },
          ],
          hold: true,
        }])
        /**
     * 常量说明：replaceBaseline 用于处理 replaceBaseline 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const replaceBaseline = vi.fn<WorkspaceFollowSink['replaceBaseline']>()
        /**
     * 常量说明：upsertView 用于处理 upsertView 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const upsertView = vi.fn<WorkspaceFollowSink['upsertView']>()
        /**
     * 常量说明：removeView 用于移除 View 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const removeView = vi.fn<WorkspaceFollowSink['removeView']>()
        /**
     * 常量说明：replaceOrder 用于处理 replaceOrder 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const replaceOrder = vi.fn<WorkspaceFollowSink['replaceOrder']>()
        /**
     * 常量说明：replaceArchived 用于处理 replaceArchived 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const replaceArchived = vi.fn<WorkspaceFollowSink['replaceArchived']>()
        /**
     * 常量说明：accept 用于处理 accept 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const accept = accepts({
          replaceBaseline,
          upsertView,
          removeView,
          replaceOrder,
          replaceArchived,
        })
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = createWorkspaceStateStream(workspaceClient(remote), {
          accept,
          failed: vi.fn(),
        })

        stream.start()
        stream.start()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(replaceArchived).toHaveBeenCalledOnce() })

        expect(replaceBaseline).toHaveBeenCalledWith(opening.value)
        expect(upsertView).toHaveBeenCalledWith(workspace)
        expect(removeView).toHaveBeenCalledWith(workspace.workspaceId)
        expect(replaceOrder).toHaveBeenCalledWith([workspace.workspaceId])
        expect(replaceArchived).toHaveBeenCalledWith(['session-one'])
        await stream.dispose()
        expect(remote.signals[0]?.aborted).toBe(true)
      })

    it('retains the old state across carrier loss and applies the replacement baseline', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：carrier 用于处理 carrier 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const carrier = new RemoteStreamCarrierError('socket lost')
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedWorkspaceRemote([
          { frames: [baseline('old')], error: carrier },
          { frames: [baseline('fresh')], hold: true },
        ])
        /**
     * 常量说明：replaceBaseline 用于处理 replaceBaseline 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const replaceBaseline = vi.fn<WorkspaceFollowSink['replaceBaseline']>()
        /**
     * 常量说明：carrierFailed 用于处理 carrierFailed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const carrierFailed = vi.fn()
        /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failed = vi.fn()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = createWorkspaceStateStream(workspaceClient(remote), {
          accept: accepts({ replaceBaseline }),
          carrierFailed,
          failed,
        })

        stream.start()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(replaceBaseline).toHaveBeenCalledTimes(2) })

        expect(replaceBaseline.mock.calls.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[value]（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([value])，并按返回类型处理结果。
 */ ([value]) => value.items[0]?.title)).toEqual(['old', 'fresh'])
        expect(carrierFailed).toHaveBeenCalledWith(carrier)
        expect(failed).not.toHaveBeenCalled()
        await stream.dispose()
      })

    it('classifies a normal end after the opening baseline as carrier loss', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedWorkspaceRemote([
          { frames: [baseline('old')] },
          { frames: [baseline('fresh')], hold: true },
        ])
        /**
     * 常量说明：replaceBaseline 用于处理 replaceBaseline 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const replaceBaseline = vi.fn<WorkspaceFollowSink['replaceBaseline']>()
        /**
     * 常量说明：carrierFailed 用于处理 carrierFailed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const carrierFailed = vi.fn()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = createWorkspaceStateStream(workspaceClient(remote), {
          accept: accepts({ replaceBaseline }),
          carrierFailed,
          failed: vi.fn(),
        })

        stream.start()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(replaceBaseline).toHaveBeenCalledTimes(2) })
        expect(carrierFailed.mock.calls[0]?.[0]).toMatchObject({
          message: 'Workspace state stream ended without a terminal result',
        })
        await stream.dispose()
      })

    it('suppresses callback failure after disposal begins', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failed = vi.fn()
        /**
     * 变量说明：closing 用于处理 closing 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let closing: Promise<void> | undefined
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = createWorkspaceStateStream(
          workspaceClient(new ScriptedWorkspaceRemote([{ frames: [baseline()] }])),
          {
            accept: accepts({
              replaceBaseline: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
                closing = stream.dispose()
                throw new Error('disposed callback')
              },
            }),
            failed,
          },
        )

        stream.start()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(closing).toBeDefined() })
        await closing
        expect(failed).not.toHaveBeenCalled()
      })

    it.each([
      {
        name: 'an increment before the baseline',
        frames: [{ type: 'remove', workspaceId: 'one' as never }] as WorkspaceFollowFrame[],
        message: 'update before its opening snapshot',
      },
      {
        name: 'a duplicate baseline',
        frames: [baseline(), baseline()] as WorkspaceFollowFrame[],
        message: 'more than one opening snapshot',
      },
      {
        name: 'a normal end before the baseline',
        frames: [] as WorkspaceFollowFrame[],
        message: 'ended before its opening snapshot',
      },
    ])('reports $name as a terminal failure', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ frames, message }（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ frames, message })，
 * 并按返回类型处理结果。
 */ async ({ frames, message }) => {
        /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failed = vi.fn()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = createWorkspaceStateStream(
          workspaceClient(new ScriptedWorkspaceRemote([{ frames }])),
          { accept: accepts(), failed },
        )

        stream.start()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(failed).toHaveBeenCalledOnce() })
        /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failure: unknown = failed.mock.calls[0]?.[0]
        expect(failure).toBeInstanceOf(Error)
        if (!(failure instanceof Error)) throw new Error('expected Workspace stream failure')
        expect(failure.message).toContain(message)
        await stream.dispose()
      })

    it('restarts a live generation without reporting cancellation as failure', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new ScriptedWorkspaceRemote([
          { frames: [baseline('first')], hold: true },
          { frames: [baseline('second')], hold: true },
        ])
        /**
     * 常量说明：replaceBaseline 用于处理 replaceBaseline 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const replaceBaseline = vi.fn<WorkspaceFollowSink['replaceBaseline']>()
        /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failed = vi.fn()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = createWorkspaceStateStream(workspaceClient(remote), {
          accept: accepts({ replaceBaseline }),
          failed,
        })

        stream.start()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(replaceBaseline).toHaveBeenCalledOnce() })
        stream.restart()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(replaceBaseline).toHaveBeenCalledTimes(2) })
        expect(failed).not.toHaveBeenCalled()
        await stream.dispose()
      })
  })

describe('WorkspaceController', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('publishes the model source and exposes successful Workspace commands', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new CommandWorkspaceRemote()
        /**
     * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const model = new ClientWorkspaceModel(remote)
        model.replaceBaseline({ items: [workspace('one')], archivedSessionIds: [] })
        /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const controller = new WorkspaceController(new Context(), model)

        expect(controller.list).toBe(model)
        await expect(controller.create({ path: '/work/created' })).resolves.toMatchObject({ workspaceId: 'created' })
        await expect(controller.rename(wid('one'), 'renamed')).resolves.toMatchObject({ title: 'renamed' })
        await expect(controller.insertBefore(wid('one'))).resolves.toBeUndefined()
        await expect(controller.insertSessionBefore(wid('one'), sid('session'))).resolves.toMatchObject({
          sessionIds: ['session'],
        })
        await expect(controller.archiveSession(sid('session'))).resolves.toBeUndefined()
        await expect(controller.delete(wid('one'))).resolves.toBeUndefined()
      })

    it('maps generated business failures to the command facade errors', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const remote = new CommandWorkspaceRemote()
        /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const controller = new WorkspaceController(new Context(), new ClientWorkspaceModel(remote))
        /**
     * 常量说明：missingWorkspace 用于处理 missingWorkspace 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const missingWorkspace: WorkspaceError = {
          code: 'workspace-not-found',
          message: 'gone',
          details: { workspaceId: wid('missing') },
        }
        /**
     * 常量说明：missingSession 用于处理 missingSession 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const missingSession: WorkspaceError = {
          code: 'session-not-found',
          message: 'missing session',
          details: { sessionId: sid('session') },
        }

        remote.create.mockResolvedValueOnce(remoteFailure({
          code: 'workspace-invalid-path',
          message: 'missing path',
          details: { path: '/missing' },
        }))
        /**
     * 常量说明：create 用于创建 create 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const create = controller.create({ path: '/missing' })
        await expect(create).rejects.toBeInstanceOf(WorkspaceCreateError)
        await expect(create).rejects.toThrow('workspace-invalid-path: missing path')

        remote.rename.mockResolvedValueOnce(remoteFailure(missingWorkspace))
        await expect(controller.rename(wid('missing'), 'name')).rejects.toThrow('workspace rename failed: workspace-not-found: gone')
        remote.delete.mockResolvedValueOnce(remoteFailure(missingWorkspace))
        await expect(controller.delete(wid('missing'))).rejects.toThrow('workspace delete failed: workspace-not-found: gone')
        remote.insertBefore.mockResolvedValueOnce(remoteFailure(missingWorkspace))
        await expect(controller.insertBefore(wid('missing'))).rejects.toThrow('workspace reorder failed: workspace-not-found: gone')
        remote.archiveSession.mockResolvedValueOnce(remoteFailure(missingSession))
        await expect(controller.archiveSession(sid('session'))).rejects.toThrow('workspace session archive failed: session-not-found: missing session')
        remote.insertSessionBefore.mockResolvedValueOnce(remoteFailure({
          code: 'workspace-move-invalid',
          message: 'invalid move',
          details: { workspaceId: wid('missing'), sessionId: sid('session') },
        }))
        await expect(controller.insertSessionBefore(wid('missing'), sid('session')))
          .rejects.toThrow('workspace move failed: workspace-move-invalid: invalid move')
      })
  })
