/**
 * 文件职责：验证 client/ui-workspace 中 workspaces service client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ISessions, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ClientRemote, DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { DirectoryBrowseError, UiWorkspaceService } from '../src/client/navigation.ts'

/**
 * 常量说明：sid 用于处理 sid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 sid 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns SessionId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sid(id)，并按返回类型处理结果。
 */
const sid = (id: string): SessionId => SessionId(id)
/**
 * 常量说明：wid 用于处理 wid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 wid 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns WorkspaceId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 wid(id)，并按返回类型处理结果。
 */
const wid = (id: string): WorkspaceId => id as WorkspaceId

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * 功能说明：处理 workspace 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param sessionIds （readonly SessionId[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param createdAt （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns WorkspaceView；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 workspace(id, sessionIds, createdAt)，并按返回类型处理结果。
 */
function workspace(
  id: string,
  sessionIds: readonly SessionId[] = [],
  createdAt = '2026-01-01T00:00:00.000Z',
): WorkspaceView {
  return {
    workspaceId: wid(id),
    path: `/w/${id}`,
    title: id,
    sessionIds,
    createdAt,
    updatedAt: createdAt,
  }
}

/**
 * 功能说明：处理 summary 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param overrides （Partial<SessionSummary>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionSummary；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 summary(id, overrides)，并按返回类型处理结果。
 */
function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(id),
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...overrides,
  }
}

/**
 * 功能说明：处理 sessionState 相关流程；使用场景由所在模块及调用位置决定。
 * @param summaries （readonly SessionSummary[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param current （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param phase （SessionListState['phase']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionListState；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sessionState(summaries, current, phase)，并按返回类型处理结果。
 */
function sessionState(
  summaries: readonly SessionSummary[] = [],
  current?: SessionId,
  phase: SessionListState['phase'] = 'ready',
): SessionListState {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
   */
  return {
    ids: summaries.map(item => item.id),
    byId: Object.fromEntries(summaries.map(item => [item.id, item])),
    current,
    phase,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

/**
 * 功能说明：处理 workspaceState 相关流程；使用场景由所在模块及调用位置决定。
 * @param items （WorkspaceSnapshot['items']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param archivedSessionIds （readonly SessionId[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param phase （WorkspaceSnapshot['phase']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns WorkspaceSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 workspaceState(items, archivedSessionIds, phase)，
 * 并按返回类型处理结果。
 */
function workspaceState(
  items: WorkspaceSnapshot['items'] = [],
  archivedSessionIds: readonly SessionId[] = [],
  phase: WorkspaceSnapshot['phase'] = 'ready',
): WorkspaceSnapshot {
  return {
    items,
    archivedSessionIds,
    phase,
    state: phase === 'ready' ? 'idle' : 'loading',
    error: null,
  }
}

/**
 * 类说明：MutableSource 用于集中封装 处理 MutableSource 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 client/ui-workspace 在对应插件或业务生命周期内创建和调用。
 */
class MutableSource<T> {
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<() => void>()

  /**
   * 功能说明：处理 MutableSource 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new MutableSource(value) 创建实例，并在所属生命周期内使用。
   */
  constructor(private value: T) {}

  /**
   * 功能说明：获取 Snapshot 相关流程；使用场景由所在模块及调用位置决定。
   * @returns T；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getSnapshot()，并按返回类型处理结果。
   */
  getSnapshot(): T {
    return this.value
  }

  /**
   * 功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。
   * @param listener （() => void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
   * @returns () => void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 功能说明：设置 set 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 set(value)，并按返回类型处理结果。
   */
  set(value: T): void {
    this.value = value
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * 功能说明：更新 update 相关流程；使用场景由所在模块及调用位置决定。
   * @param update （(value: T) => T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 update(update)，并按返回类型处理结果。
   */
  update(update: (value: T) => T): void {
    this.set(update(this.value))
  }

  /**
   * 功能说明：处理 listenersSnapshot 相关流程；使用场景由所在模块及调用位置决定。
   * @returns readonly (() => void)[]；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 listenersSnapshot()，并按返回类型处理结果。
   */
  listenersSnapshot(): readonly (() => void)[] {
    return [...this.listeners]
  }
}

/**
 * 类说明：FakeSessions 用于集中封装 处理 FakeSessions 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 client/ui-workspace 在对应插件或业务生命周期内创建和调用。
 */
class FakeSessions {
  /**
   * 常量说明：list 用于列出 list 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly list: MutableSource<SessionListState>
  /**
   * 常量说明：create 用于创建 create 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly create: ReturnType<typeof vi.fn<ISessions['create']>>
  /**
   * 常量说明：open 用于打开 open 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly open: ReturnType<typeof vi.fn<(id: SessionId) => void>>
  /**
   * 常量说明：clear 用于处理 clear 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly clear: ReturnType<typeof vi.fn<() => void>>

  /**
   * 功能说明：处理 FakeSessions 相关流程；使用场景由所在模块及调用位置决定。
   * @param initial （SessionListState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new FakeSessions(initial) 创建实例，并在所属生命周期内使用。
   */
  constructor(initial: SessionListState) {
    this.list = new MutableSource(initial)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（由 TypeScript
     * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(options)，并按返回类型处理结果。
     */
    this.create = vi.fn<ISessions['create']>(async options =>
      options?.sessionId ?? sid(`created-${String(options?.workspaceId ?? 'none')}`))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（SessionId）：标识本次操作关联的唯一对象；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    this.open = vi.fn((id: SessionId) => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
       */
      this.list.update(state => ({ ...state, current: id }))
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.clear = vi.fn(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
       */
      this.list.update(state => ({ ...state, current: undefined }))
    })
  }
}

/**
 * 类说明：FakeWorkspaces 用于集中封装 处理 FakeWorkspaces 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 client/ui-workspace 在对应插件或业务生命周期内创建和调用。
 */
class FakeWorkspaces implements IWorkspaces {
  /**
   * 常量说明：list 用于列出 list 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly list: MutableSource<WorkspaceSnapshot>
  /**
   * 常量说明：archiveCalls 用于处理 archiveCalls 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly archiveCalls: SessionId[] = []
  /**
   * 变量说明：onArchive 用于响应 Archive 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Archive 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onArchive(sessionId)，并按返回类型处理结果。
   */
  onArchive: IWorkspaces['archiveSession'] = async (sessionId) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
     */
    this.list.update(state => ({
      ...state,
      archivedSessionIds: [...state.archivedSessionIds, sessionId],
    }))
  }

  /**
   * 常量说明：create 用于创建 create 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  declare readonly create: IWorkspaces['create']
  /**
   * 常量说明：rename 用于处理 rename 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  declare readonly rename: IWorkspaces['rename']
  /**
   * 常量说明：delete 用于删除 delete 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  declare readonly delete: IWorkspaces['delete']
  /**
   * 常量说明：insertBefore 用于处理 insertBefore 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  declare readonly insertBefore: IWorkspaces['insertBefore']
  /**
   * 常量说明：insertSessionBefore 用于处理 insertSessionBefore 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  declare readonly insertSessionBefore: IWorkspaces['insertSessionBefore']

  /**
   * 功能说明：处理 FakeWorkspaces 相关流程；使用场景由所在模块及调用位置决定。
   * @param initial （WorkspaceSnapshot）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new FakeWorkspaces(initial) 创建实例，并在所属生命周期内使用。
   */
  constructor(initial: WorkspaceSnapshot) {
    this.list = new MutableSource(initial)
  }

  /**
   * 功能说明：处理 archiveSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 archiveSession(sessionId)，并按返回类型处理结果。
   */
  archiveSession(sessionId: SessionId): Promise<void> {
    this.archiveCalls.push(sessionId)
    return this.onArchive(sessionId)
  }
}

/**
 * 常量说明：listing 用于处理 listing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const listing: DirectoryListing = {
  path: '/home/u',
  home: '/home/u',
  crumbs: [{ name: '/', path: '/', hidden: false }],
  entries: [{ name: 'project', path: '/home/u/project', hidden: false }],
  truncated: false,
}

/** The directory-picking Remote namespace, recorded and scripted per case.
 * @remarks 中文说明：类说明：FakeDirectoryPicker 用于集中封装 处理 FakeDirectoryPicker
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/ui-workspace
 * 在对应插件或业务生命周期内创建和调用。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(path, name)，并按返回类型处理结果。
 */
class FakeDirectoryPicker {
  /**
   * 常量说明：calls 用于处理 calls 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly calls: { method: string; payload: unknown }[] = []

  /**
   * 变量说明：onPick 用于响应 Pick 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Pick 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onPick()，并按返回类型处理结果。
   */
  onPick: () => Promise<RemoteResult<string | null>> = () => Promise.resolve({ ok: true, value: null })
  /**
   * 变量说明：onList 用于响应 List 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 List 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onList()，并按返回类型处理结果。
   */
  onList: () => Promise<RemoteResult<DirectoryListing>> = () => Promise.resolve({ ok: true, value: listing })
  /**
   * 变量说明：onCreateDirectory 用于响应 Create Directory 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   * 功能说明：响应 Create Directory 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onCreateDirectory()，并按返回类型处理结果。
   */
  onCreateDirectory: () => Promise<RemoteResult<string>> =
    () => Promise.resolve({ ok: true, value: '/home/u/new' })

  /**
   * 常量说明：remote 用于处理 remote 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly remote: ClientRemote['directoryPicker'] = {
    pick: () => this.record('pick', {}, this.onPick()),
    list: (path?: string) => this.record('list', { path }, this.onList()),
    createDirectory: (path: string, name: string) =>
      this.record('createDirectory', { path, name }, this.onCreateDirectory()),
  }

  /**
   * 功能说明：处理 callsOf 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown[]；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 callsOf(method)，并按返回类型处理结果。
   */
  callsOf(method: string): unknown[] {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    return this.calls.filter(call => call.method === method).map(call => call.payload)
  }

  /**
   * 功能说明：处理 record 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param payload （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param result （Promise<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 record(method, payload, result)，并按返回类型处理结果。
   */
  private record<T>(method: string, payload: unknown, result: Promise<T>): Promise<T> {
    this.calls.push({ method, payload })
    return result
  }
}

interface BenchOptions {
  readonly workspaces?: WorkspaceSnapshot
  readonly sessions?: SessionListState
}

/**
 * 功能说明：处理 bench 相关流程；使用场景由所在模块及调用位置决定。
 * @param options （BenchOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 bench(options)，并按返回类型处理结果。
 */
function bench(options: BenchOptions = {}) {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  /**
   * 常量说明：directoryPicker 用于处理 directoryPicker 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const directoryPicker = new FakeDirectoryPicker()
  /**
   * 常量说明：workspaces 用于处理 workspaces 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const workspaces = new FakeWorkspaces(options.workspaces ?? workspaceState([], [], 'pending'))
  /**
   * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sessions = new FakeSessions(options.sessions ?? sessionState([], undefined, 'pending'))
  /**
   * 常量说明：uiWorkspace 用于处理 uiWorkspace 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const uiWorkspace = new UiWorkspaceService(
    ctx,
    directoryPicker.remote,
    workspaces,
    sessions as unknown as ISessions,
  )
  return { ctx, directoryPicker, sessions, uiWorkspace, workspaces }
}

/**
 * 功能说明：处理 flush 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 flush()，并按返回类型处理结果。
 */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('UiWorkspaceService', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reuses only an unarchived member blank and coalesces concurrent creation', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = bench()
    /**
     * 常量说明：memberBlank 用于处理 memberBlank 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const memberBlank = sid('member-blank')
    /**
     * 常量说明：archivedBlank 用于处理 archivedBlank 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const archivedBlank = sid('archived-blank')
    /**
     * 常量说明：summaries 用于处理 summaries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const summaries: readonly SessionSummary[] = [
      summary('stray', { blank: true, cwd: '/w/alpha' }),
      summary('member-blank', { blank: true, cwd: '/w/alpha' }),
      summary('active', { cwd: '/w/beta' }),
      summary('archived-blank', { blank: true, cwd: '/w/gamma' }),
    ]
    b.workspaces.list.set(workspaceState([
      workspace('alpha', [memberBlank]),
      workspace('beta', [sid('active')]),
      workspace('gamma', [archivedBlank]),
    ], [archivedBlank]))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    b.sessions.list.set({
      ...sessionState(summaries, memberBlank),
      ids: [sid('missing'), ...summaries.map(item => item.id)],
    })

    await expect(Promise.all([
      b.uiWorkspace.connectWorkspace(wid('alpha')),
      b.uiWorkspace.connectWorkspace(wid('alpha')),
    ])).resolves.toEqual([memberBlank, memberBlank])
    expect(b.sessions.create).not.toHaveBeenCalled()

    /**
     * 常量说明：creation 用于处理 creation 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const creation = Promise.withResolvers<SessionId>()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    b.sessions.create.mockImplementation(() => creation.promise)
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = b.uiWorkspace.connectWorkspace(wid('beta'))
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = b.uiWorkspace.connectWorkspace(wid('beta'))
    expect(b.sessions.create).toHaveBeenCalledTimes(1)
    creation.resolve(sid('fresh-beta'))
    await expect(Promise.all([first, second])).resolves.toEqual([sid('fresh-beta'), sid('fresh-beta')])

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（由 TypeScript
     * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(options)，并按返回类型处理结果。
     */
    b.sessions.create.mockImplementation(async options => sid(`fresh-${String(options?.workspaceId)}`))
    await expect(b.uiWorkspace.connectWorkspace(wid('gamma'))).resolves.toBe(sid('fresh-gamma'))
    expect(b.sessions.create).toHaveBeenLastCalledWith({ workspaceId: wid('gamma') })
    await expect(b.uiWorkspace.connectWorkspace(wid('ghost')))
      .rejects.toThrow('uiWorkspace.connectWorkspace: unknown workspace ghost')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('targets an explicit, current-session, then recent Workspace and reports failed starts', async () => {
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = summary('current', { cwd: '/w/current-home', updatedAt: 1 })
    /**
     * 常量说明：recent 用于处理 recent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const recent = summary('recent', { cwd: '/w/recent-home', updatedAt: 2 })
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = bench({
      sessions: sessionState([current, recent], current.id),
      workspaces: workspaceState([
        workspace('current-home', [current.id]),
        workspace('recent-home', [recent.id]),
      ]),
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（由 TypeScript
     * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(options)，并按返回类型处理结果。
     */
    b.sessions.create.mockImplementation(async options => sid(`opened-${String(options?.workspaceId)}`))

    b.uiWorkspace.startSession(wid('recent-home'))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenLastCalledWith(sid('opened-recent-home'))
    })

    b.sessions.open(current.id)
    b.uiWorkspace.startSession()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenLastCalledWith(sid('opened-current-home'))
    })

    b.sessions.clear()
    b.uiWorkspace.startSession()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenLastCalledWith(sid('opened-recent-home'))
    })

    /**
     * 常量说明：empty 用于处理 empty 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const empty = bench()
    empty.uiWorkspace.startSession()
    expect(empty.sessions.clear).toHaveBeenCalledOnce()

    /**
     * 常量说明：warning 用于处理 warning 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    b.sessions.create.mockRejectedValueOnce(new Error('create failed'))
    b.uiWorkspace.startSession(wid('recent-home'))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith('new session failed:', expect.any(Error))
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('opens the recent Workspace after both baselines arrive', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = bench()
    b.sessions.create.mockResolvedValue(sid('initial'))

    /**
     * 常量说明：stableFirst 用于处理 stableFirst 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const stableFirst = workspace('stable-first', [], '2026-01-01T00:00:00.000Z')
    /**
     * 常量说明：recent 用于处理 recent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const recent = workspace('recent', [], '2026-01-02T00:00:00.000Z')
    b.workspaces.list.set(workspaceState([stableFirst, recent]))
    expect(b.sessions.create).not.toHaveBeenCalled()
    b.sessions.list.set(sessionState())

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenCalledWith(sid('initial'))
    })
    expect(b.sessions.create).toHaveBeenCalledWith({ workspaceId: wid('recent') })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    expect(b.workspaces.list.getSnapshot().items.map(item => item.workspaceId)).toEqual([
      wid('stable-first'), wid('recent'),
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses Workspace creation time when members are absent and preserves Host tie order', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = bench()
    b.sessions.create.mockResolvedValue(sid('initial'))

    b.workspaces.list.set(workspaceState([
      workspace('newest', [sid('missing')], '2026-03-01T00:00:00.000Z'),
      workspace('same-time', [], '2026-03-01T00:00:00.000Z'),
      workspace('older', [], '2026-01-01T00:00:00.000Z'),
    ]))
    b.sessions.list.set(sessionState())

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenCalledWith(sid('initial'))
    })
    expect(b.sessions.create).toHaveBeenCalledWith({ workspaceId: wid('newest') })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('retries failed initial selection and never overwrites a later selection', async () => {
    /**
     * 常量说明：warning 用于处理 warning 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = bench()
    /**
     * 变量说明：attempts 用于处理 attempts 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let attempts = 0
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    b.sessions.create.mockImplementation(() => ++attempts === 1
      ? Promise.reject(new Error('attach exploded'))
      : Promise.resolve(sid('retry')))
    b.workspaces.list.set(workspaceState([workspace('recent')]))
    b.sessions.list.set(sessionState())
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith('initial workspace selection failed:', expect.any(Error))
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
     */
    b.workspaces.list.update(state => ({ ...state, items: [...state.items] }))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(b.sessions.open).toHaveBeenCalledWith(sid('retry'))
    })
    expect(attempts).toBe(2)

    /**
     * 常量说明：changed 用于处理 changed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const changed = bench()
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = Promise.withResolvers<SessionId>()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    changed.sessions.create.mockImplementation(() => pending.promise)
    changed.workspaces.list.set(workspaceState([workspace('recent')]))
    changed.sessions.list.set(sessionState())
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(changed.sessions.create).toHaveBeenCalledOnce() })
    changed.sessions.open(sid('manual'))
    pending.resolve(sid('automatic'))
    await flush()
    expect(changed.sessions.open).toHaveBeenCalledTimes(1)
    expect(changed.sessions.open).toHaveBeenCalledWith(sid('manual'))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('stops initial navigation when its Cordis lifetime is disposed', async () => {
    /**
     * 常量说明：success 用于处理 success 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const success = bench()
    /**
     * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const resolved = Promise.withResolvers<SessionId>()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    success.sessions.create.mockImplementation(() => resolved.promise)
    success.workspaces.list.set(workspaceState([workspace('recent')]))
    success.sessions.list.set(sessionState())
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(success.sessions.create).toHaveBeenCalledOnce() })
    await success.ctx.fiber.dispose()
    resolved.resolve(sid('late'))
    await flush()
    expect(success.sessions.open).not.toHaveBeenCalled()
    success.workspaces.list.set(workspaceState([workspace('ignored')]))
    expect(success.sessions.create).toHaveBeenCalledOnce()

    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = bench()
    /**
     * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rejected = Promise.withResolvers<SessionId>()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    failure.sessions.create.mockImplementation(() => rejected.promise)
    failure.workspaces.list.set(workspaceState([workspace('recent')]))
    failure.sessions.list.set(sessionState())
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(failure.sessions.create).toHaveBeenCalledOnce() })
    /**
     * 常量说明：staleReconciles 用于处理 staleReconciles 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const staleReconciles = failure.workspaces.list.listenersSnapshot()
    /**
     * 常量说明：warning 用于处理 warning 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await failure.ctx.fiber.dispose()
    rejected.reject(new Error('late failure'))
    await flush()
    /**
     * 变量说明：reconcile 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const reconcile of staleReconciles) reconcile()
    expect(warning).not.toHaveBeenCalled()
    expect(failure.sessions.create).toHaveBeenCalledOnce()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('clears a current Session only after it enters the archive baseline', () => {
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = summary('current')
    /**
     * 常量说明：idle 用于处理 idle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const idle = summary('idle')
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = bench({
      sessions: sessionState([current, idle], current.id),
      workspaces: workspaceState([workspace('one', [current.id, idle.id])]),
    })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
     */
    b.workspaces.list.update(state => ({ ...state, archivedSessionIds: [idle.id] }))
    expect(b.sessions.clear).not.toHaveBeenCalled()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
     */
    b.workspaces.list.update(state => ({ ...state, archivedSessionIds: [current.id] }))
    expect(b.sessions.clear).toHaveBeenCalledOnce()

    b.sessions.open(idle.id)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
     */
    b.workspaces.list.update(state => ({ ...state, archivedSessionIds: [idle.id] }))
    expect(b.sessions.clear).toHaveBeenCalledTimes(2)

    /**
     * 常量说明：archived 用于处理 archived 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const archived = bench({
      sessions: sessionState([current], current.id),
      workspaces: workspaceState([workspace('one', [current.id])], [current.id]),
    })
    expect(archived.sessions.clear).toHaveBeenCalledOnce()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('forwards archive commands and preserves failures', async () => {
    /**
     * 常量说明：idle 用于处理 idle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const idle = sid('idle')
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = bench()

    await b.uiWorkspace.archiveSession(idle)
    expect(b.workspaces.archiveCalls).toEqual([idle])

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    b.workspaces.onArchive = () => Promise.reject(new Error('archive rejected'))
    await expect(b.uiWorkspace.archiveSession(idle)).rejects.toThrow('archive rejected')
    expect(b.workspaces.archiveCalls).toEqual([idle, idle])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('passes directory operations to the Host and preserves structured browse failures', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = bench()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    b.directoryPicker.onPick = () => Promise.resolve({ ok: true, value: '/w/alpha' })
    await expect(b.uiWorkspace.pickDirectory()).resolves.toBe('/w/alpha')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    b.directoryPicker.onPick = () => Promise.resolve({ ok: true, value: null })
    await expect(b.uiWorkspace.pickDirectory()).resolves.toBeNull()
    expect(b.directoryPicker.callsOf('pick')).toEqual([{}, {}])

    await expect(b.uiWorkspace.listDirectory()).resolves.toEqual(listing)
    await expect(b.uiWorkspace.listDirectory('/home/u')).resolves.toEqual(listing)
    expect(b.directoryPicker.callsOf('list')).toEqual([{ path: undefined }, { path: '/home/u' }])
    await expect(b.uiWorkspace.createDirectory('/home/u', 'new')).resolves.toBe('/home/u/new')
    expect(b.directoryPicker.callsOf('createDirectory')).toEqual([{ path: '/home/u', name: 'new' }])
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    b.directoryPicker.onPick = () => Promise.resolve({
      ok: false, error: { code: 'internal', message: 'no chooser', details: {} },
    })
    await expect(b.uiWorkspace.pickDirectory()).rejects.toThrow('directory picker failed: no chooser')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    b.directoryPicker.onList = () => Promise.resolve({
      ok: false, error: { code: 'directory-unreadable', message: 'denied', details: { path: '/private' } },
    })
    /**
     * 常量说明：listFailure 用于列出 Failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const listFailure = b.uiWorkspace.listDirectory('/private')
    await expect(listFailure).rejects.toBeInstanceOf(DirectoryBrowseError)
    await expect(listFailure).rejects.toMatchObject({ rpcError: { code: 'directory-unreadable' } })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    b.directoryPicker.onCreateDirectory = () => Promise.resolve({
      ok: false, error: { code: 'directory-exists', message: 'taken', details: { path: '/home/u/new' } },
    })
    await expect(b.uiWorkspace.createDirectory('/home/u', 'new')).rejects.toMatchObject({
      rpcError: { code: 'directory-exists' },
    })
  })
})
