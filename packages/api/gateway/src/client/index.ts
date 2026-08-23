/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现"客户端投影"（Client projection）层的核心：把生成器产出的
 * Typert 远程描述符贡献集（contribution）挂载到客户端 Cordis 上，安装为
 * 类型化的 remote.<namespace> 服务；本地方法调用被转换为对 Connection
 * 载体的 /api RPC 调用，Host 转发的事件则被分发给订阅者。
 * 【技术维度】基于 Cordis Service 与 effect 生命周期：每个贡献集经
 * ctx.effect 注册、按命名空间分组安装；方法查找走"对象属性 + Map 记录"的
 * 真实映射，不依赖 JavaScript Proxy；参数经 codec 严格解码后通过
 * Connection 的 rpc.call 发出，取消信号与挂载令牌（MountToken）绑定。
 * 【产品维度】远程 BFF 的"客户端侧"：业务包（commands、settings 等）只需
 * 声明远程描述符，本模块负责把描述符变成可调用的本地方法并同步转发事件，
 * 让客户端代码以本地 Service 的方式使用 Host 能力。
 * 【逻辑维度】按出现顺序：内部数据结构（MountToken / ScopedProjection /
 * RemoteMethodRecord 等）→ 模块级类型（ClientRemote、RemoteEventListener）→
 * ClientRemoteService（挂载、订阅、派发、命名空间安装、调用转发）→
 * RemoteNamespaceService（命名空间服务的属性安装与移除）→ 工具函数
 * （installMethods、scopedProjection、requireStrictDescriptor、parse 等）。
 * 【关键边界】描述符必须使用严格（strict）codec（requireStrictDescriptor）；
 * 挂载后的方法随 effect 注销而卸载；同 namespace 下 direct / scoped 变体
 * 不能重复；命名空间名不能与 Cordis 已有服务或 Service 自带字段冲突。
 * 【新手阅读建议】先读 $mount 与 installNamespace 理解"贡献集如何变成
 * 可调用方法"，再读 invoke 理解"本地调用如何落到 Connection 载体"，最后看
 * RemoteNamespaceService.install 理解属性注入与 getter 的配合方式。
 * ==========================================================================
 */
/**
 * Client projection of generated Typert Remote descriptors. Contributions
 * install traced `remote.<namespace>` services; no JavaScript Proxy
 * participates in method lookup, invocation, or type exposure.
 */
// 英文模块注释的中文解释：本文件是"生成式 Typert 远程描述符的客户端投影"：
// 贡献集把追踪过的 remote.<namespace> 服务安装到客户端；方法查找、调用与
// 类型暴露全程不借助 JavaScript Proxy 魔法。

// 中文：导入 Cordis 的 Service 基类与类型，以及 Connection 载体的句柄类型、
// typert 协议层描述符 / 结果 / 编解码器 / 贡献集等类型，供本模块使用。
import { Service } from '@deepseek-ai/cordis'
import type { Context, Events } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  InvocationDescriptor,
  TypertClientRemote,
  RemoteResult,
  TypertCodec,
  TypertDisposer,
  TypertRemoteContribution,
  TypertRemoteEvent,
} from '@deepseek-ai/dsh-typert-protocol'

// 中文：挂载令牌——记录某个方法当前是否仍处于挂载状态；active 为 false
// 时调用会被拒绝（方法已随 effect 注销），abort 用于中止在途调用。
interface MountToken {
  active: boolean
  readonly abort: AbortController
}

// 中文：scoped 投影——描述符中"上下文参数"的调用说明：context 是 Host 端
// 上下文名，wire 是它在请求里对应的字段名，codec 是编解码器，parameterIndex
// 是它在参数列表里的下标（context 参数不入参数组）。
interface ScopedProjection {
  readonly context: string
  readonly wire: string
  readonly codec: TypertCodec
  readonly parameterIndex?: number
}

// 中文：直连方法记录：描述符 + 挂载令牌（direct 调用不走上下文投影）。
interface DirectMethod {
  readonly descriptor: InvocationDescriptor
  readonly token: MountToken
}

// 中文：scoped 方法记录：在直连记录之上追加投影信息。
interface ScopedMethod extends DirectMethod {
  readonly projection: ScopedProjection
}

// 中文：一个远程方法的记录表：同名的 direct 与 scoped 变体可以并存，
// 调用时按上下文解析结果决定走哪个变体。
interface RemoteMethodRecord {
  direct?: DirectMethod
  scoped?: ScopedMethod
}

// 中文：绑定后的上下文身份——把"从调用方上下文解析出的身份值"包装成
// 显式对象，便于与"未绑定"（undefined）区分。
interface BoundContextIdentity {
  readonly value: unknown
}

// 中文：一个已安装命名空间的服务句柄：service 是命名空间服务本身，
// dispose 用于在命名空间清空后卸载整个服务。
interface RemoteNamespaceHandle {
  readonly service: RemoteNamespaceService
  readonly dispose: TypertDisposer
}

/** One descriptor's mounted variants, for the group disposer to unwind. */
// 中文：一个描述符已安装的变体记录，供"整组卸载"时逆序回滚：
// direct / scoped 布尔标记哪些变体装过，token 用于中止与移除。
interface InstalledMethod {
  readonly descriptor: InvocationDescriptor
  readonly token: MountToken
  direct: boolean
  scoped: boolean
}

/** Typed Remote service augmented by generated direct namespaces. */
// 中文：客户端可用的类型化远程服务（即 ctx.remote 的类型），由生成器直接
// 命名空间类型扩充而成。
export type ClientRemote = TypertClientRemote

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by the Client assembly. */
    // 中文：Cordis 上下文上的远程服务成员（类型层面声明合并），运行时由
    // ClientRemoteService 实例提供。
    remote: ClientRemote
  }
}

/** Required Client services: the Typert registry and the existing Connection carrier. */
// 中文：本插件依赖的客户端服务：typert 注册表与既有的 Connection 载体。
export const inject = ['typert', 'connection']

/**
 * Install the typed Client Remote service.
 * @param ctx - Client Cordis root.
 */
// 中文：插件入口：在客户端 Cordis 根上下文中实例化 ClientRemoteService，
// 完成远程服务的注册与拦截器挂接。
export function apply(ctx: Context): void {
  new ClientRemoteService(ctx)
}

/** One subscribed listener after `$on` erased its per-event argument list. */
// 中文：订阅者监听函数的擦除形态：$on 只记录"可被任意参数调用的函数"，
// 具体的事件参数列表由 $dispatch 派发时还原。
type RemoteEventListener = (...args: never[]) => void

/**
 * One subscription, identified by the registration rather than by its listener:
 * two fibers may subscribe the same function object to the same event, and each
 * disposer must retire only its own registration.
 */
// 中文：一次订阅记录，按"注册本身"而非"监听函数"区分：两个协程可能把同一
// 函数对象订阅到同一事件上，各自的注销函数必须只移除自己的那一条记录。
interface RemoteEventSubscription {
  readonly listener: RemoteEventListener
}

// 中文：客户端远程服务本体——实现 TypertClientRemote 接口并作为 Cordis
// Service（键 'remote'）注册。职责：挂载贡献集、管理命名空间服务、维护
// 事件订阅并派发、把本地方法调用转发给 Connection 载体。
class ClientRemoteService extends Service implements TypertClientRemote {
  // 中文：创建本服务的根上下文（与调用方上下文区分，用于注册命名空间服务
  // 与访问 typert / connection 等依赖）。
  private readonly ownerCtx: Context
  // 中文：已安装的命名空间名 → 服务句柄，命名空间卸载（清空）后移除。
  private readonly namespaces = new Map<string, RemoteNamespaceHandle>()
  // 中文：事件名 → 订阅记录数组，供 $dispatch 按注册顺序派发。
  private readonly subscriptions = new Map<string, RemoteEventSubscription[]>()
  // 中文：挂载 / 卸载操作的串行化链：保证贡献集的挂载与卸载按提交顺序
  // 逐个执行，避免并发交错破坏命名空间状态。
  private mutations = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'remote')
    this.ownerCtx = ctx
    // 中文：注册一个根级 effect：根上下文销毁时清空全部事件订阅，
    // 防止监听器与已卸载的 Host 帧残留。
    ctx.effect(() => () => { this.subscriptions.clear() }, 'api-gateway.client.subscriptions')
  }

  // 中文：挂载一个贡献集（插件入口调用）。整个挂载过程放在调用方上下文的
  // effect 里，并串行进 mutations 队列；返回的注销函数会逆序卸载并同样
  // 排队，保证挂载与卸载的顺序与贡献集生命周期一致。
  async $mount(contribution: TypertRemoteContribution): ReturnType<TypertClientRemote['$mount']> {
    const callerCtx = this.ctx
    const owned = callerCtx.effect(async () => {
      const dispose = await this.enqueue(() => this.mountContribution(callerCtx, contribution))
      return () => this.enqueue(dispose)
    }, `api-gateway.client.$mount(${JSON.stringify(contribution.package)})`)
    await owned
    return async () => { await owned() }
  }

  // 中文：订阅一个被允许转发的 Host 事件。以"注册"为单位存入订阅表，
  // 返回的注销函数只移除自己那一条记录；注销由 effect 生命周期驱动。
  $on<Event extends TypertRemoteEvent>(
    event: Event,
    listener: Events[Event],
  ): ReturnType<TypertClientRemote['$on']> {
    // The table is keyed by the runtime event name, so the argument list this
    // signature pins per event cannot survive in it; `$deliver` restores it
    // from the frame the Host emitted for that same name.
    // 中文：订阅表只按"运行时事件名"做键，签名里按事件固定的参数列表无法
    // 存进表里；派发时由 $dispatch 按 Host 发出的同名帧还原参数。
    const subscription: RemoteEventSubscription = { listener }
    const owned = this.ctx.effect(() => {
      const listeners = this.listeners(event)
      listeners.push(subscription)
      return () => {
        const at = listeners.indexOf(subscription)
        /* v8 ignore next -- listener */
        if (at >= 0) listeners.splice(at, 1)
      }
    }, `api-gateway.client.$on(${JSON.stringify(event)})`)
    return () => { void owned() }
  }

  /**
   * Deliver one forwarded event in registration order, isolating a listener
   * that fails either synchronously or by rejecting a returned promise; see
   * {@link TypertClientRemote.$dispatch} for the caller contract.
   */
  // 中文：按注册顺序派发一条被转发的事件。先取快照再遍历：派发过程中新订阅
  // 或注销的监听器不影响本轮；单个监听器无论同步抛错还是返回的 Promise
  // 拒绝，都被隔离记录，不中断其余监听器。
  $dispatch(event: string, args: readonly unknown[]): void {
    const listeners = this.subscriptions.get(event)
    if (listeners === undefined) return
    // Snapshot: a listener may subscribe or dispose during delivery, and this
    // round's recipients are the ones registered when the frame arrived.
    // 中文：先复制一份监听器数组作快照——派发途中可能有监听器订阅或注销，
    // 本轮只投递给"帧到达时已注册"的那些。
    for (const { listener } of [...listeners]) {
      // 中文：单条监听器的错误兜底：把异常打印到控制台并继续，防止
      // 一条监听器拖垮整轮派发。
      const report = (error: unknown): void => {
        console.error(`client api: Remote event ${JSON.stringify(event)} listener threw:`, error)
      }
      try {
        /* oxlint-disable-next-line typescript/no-confusing-void-expression --
         * The declared return is void, so nobody awaits an async listener; the
         * runtime value is still a promise, and reading it is the only way to
         * keep its rejection inside this containment instead of surfacing as an
         * unhandled one. */
        const settled: unknown = listener(...args as never[])
        if (settled instanceof Promise) settled.catch(report)
      } catch (error) {
        report(error)
      }
    }
  }

  /** Subscriptions for one event name; empty arrays are retained, bounded by the Host's selection. */
  // 中文：取某事件名的订阅数组；没有则创建空数组并保留（空数组也占位，
  // 数量受 Host 允许转发的选择范围限制）。
  private listeners(event: string): RemoteEventSubscription[] {
    let listeners = this.subscriptions.get(event)
    if (listeners === undefined) {
      listeners = []
      this.subscriptions.set(event, listeners)
    }
    return listeners
  }

  // 中文：把操作串行进 mutations 链：无论前序操作成功与否都执行本次操作，
  // 并保证队列自身不因失败而中断（链尾总是一个已解决的 Promise）。
  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.mutations.then(operation, operation)
    this.mutations = result.then(() => undefined, () => undefined)
    return result
  }

  // 中文：挂载一个贡献集：先校验合法性，再向 typert 注册表登记贡献（供
  // Host 侧生成器 / 注册表感知），随后按命名空间分组逐个安装；任一组安装
  // 失败都会逆序回滚已装部分并撤销注册，保证不留半挂载状态。
  private async mountContribution(
    callerCtx: Context,
    contribution: TypertRemoteContribution,
  ): Promise<TypertDisposer> {
    this.validateContribution(contribution)
    const disposeRemote = callerCtx.typert.remotes.register(contribution)
    const groups = new Map<string, InvocationDescriptor[]>() // 中文：命名空间 → 该命名空间下的描述符组
    for (const descriptor of contribution.descriptors) {
      const group = groups.get(descriptor.namespace)
      if (group === undefined) groups.set(descriptor.namespace, [descriptor])
      else group.push(descriptor)
    }
    const installed: TypertDisposer[] = [] // 中文：每个命名空间的卸载函数，用于整体回滚
    try {
      for (const [namespace, descriptors] of groups) {
        installed.push(await this.installNamespace(namespace, descriptors))
      }
    } catch (error) {
      for (const dispose of installed.reverse()) await dispose()
      await disposeRemote()
      throw error
    }
    // 中文：整体卸载：逆序撤销各命名空间，再撤销注册表登记。
    return async () => {
      for (const dispose of installed.reverse()) await dispose()
      await disposeRemote()
    }
  }

  // 中文：校验贡献集在安装前的合法性：贡献集内部同一命名空间的方法不能
  // 重复（direct 与 scoped 各自计数）；不得与已挂载方法重名；新命名空间
  // 不能与 Remote 服务自带字段或 Cordis 已有服务 / 已有命名空间冲突；
  // 每个描述符必须是严格 codec（requireStrictDescriptor）。
  private validateContribution(contribution: TypertRemoteContribution): void {
    const direct = new Map<string, Set<string>>() // 中文：命名空间 → direct 方法名集合（贡献集内查重）
    const scoped = new Map<string, Set<string>>() // 中文：命名空间 → scoped 方法名集合（贡献集内查重）
    const add = (
      table: Map<string, Set<string>>,
      descriptor: InvocationDescriptor,
      kind: 'direct' | 'scoped',
    ): void => {
      // 中文：先查贡献集内部是否重复，再查是否与已挂载方法冲突。
      const methods = table.get(descriptor.namespace) ?? new Set<string>()
      if (methods.has(descriptor.method)) {
        throw new Error(`client api: contribution repeats ${kind} method ${endpointOf(descriptor)}`)
      }
      methods.add(descriptor.method)
      table.set(descriptor.namespace, methods)
      const namespace = this.namespaces.get(descriptor.namespace)?.service
      if (namespace?.has(kind, descriptor.method) === true) {
        throw new Error(`client api: ${kind} method ${endpointOf(descriptor)} is already mounted`)
      }
    }
    for (const descriptor of contribution.descriptors) {
      requireStrictDescriptor(descriptor)
      if (descriptor.invocation.kind === 'direct') add(direct, descriptor, 'direct')
      if (scopedProjection(descriptor) !== undefined) add(scoped, descriptor, 'scoped')
    }
    // 中文：对涉及的所有命名空间做"命名冲突"体检：新命名空间不能与
    // Remote 服务自身字段、Cordis 现有服务或已存在的 remote.<ns> 冲突。
    const namespaces = new Set([...direct.keys(), ...scoped.keys()])
    for (const namespace of namespaces) {
      const service = this.namespaces.get(namespace)?.service
      if (service === undefined) {
        if (namespace in this) {
          throw new Error(`client api: namespace ${JSON.stringify(namespace)} conflicts with the Remote service`)
        }
        const serviceKey = remoteServiceKey(namespace)
        const property = this.ownerCtx.reflect.props[serviceKey]
        if (property?.type === 'accessor' || this.ownerCtx.get(serviceKey) !== undefined) {
          throw new Error(`client api: namespace ${JSON.stringify(namespace)} conflicts with an existing Remote namespace`)
        }
      }
      // 中文：方法名不能与命名空间服务的自有成员重名（如 ctx、methods 等）。
      for (const method of new Set([...(direct.get(namespace) ?? []), ...(scoped.get(namespace) ?? [])])) {
        if (service === undefined) RemoteNamespaceService.assertMethodAvailable(namespace, method)
        else service.assertMethodAvailable(method)
      }
    }
  }

  /**
   * Mount one namespace's descriptor group with no visibility gap: a fresh
   * namespace installs its whole group synchronously inside its fiber's
   * apply, so a plugin parked on the namespace service never observes it
   * without the methods the same contribution carries; an existing namespace
   * takes the group in one synchronous step.
   * @param name - Remote namespace.
   * @param descriptors - Every contribution descriptor naming that namespace.
   * @returns disposer unmounting the group and the namespace once empty.
   */
  // 中文：安装一个命名空间的描述符组，且保证"无可见性缝隙"：全新命名空间
  // 会在其 fiber 的 apply 里同步装完整组方法，这样停靠在命名空间服务上的
  // 插件永远不会看到"服务在但方法不全"的中间态；已存在的命名空间则在一次
  // 同步步骤内并入新组。返回的卸载函数先逆序移除各方法，再在命名空间清空
  // 后整体卸载。
  private async installNamespace(
    name: string,
    descriptors: readonly InvocationDescriptor[],
  ): Promise<TypertDisposer> {
    let namespace = this.namespaces.get(name)
    let installed: InstalledMethod[]
    if (namespace === undefined) {
      ({ namespace, installed } = await this.createNamespace(name, descriptors))
    } else {
      installed = installMethods(namespace.service, descriptors)
    }
    const handle = namespace
    return async () => {
      // 中文：逆序回滚每个已安装方法：标记失效、中止在途调用、移除变体。
      for (const method of [...installed].reverse()) {
        /* v8 ignore next -- Cordis effect disposers are idempotent and invoke this cleanup at most once. */
        if (!method.token.active) continue
        method.token.active = false
        method.token.abort.abort()
        if (method.scoped) handle.service.remove('scoped', method.descriptor.method, method.token)
        if (method.direct) handle.service.remove('direct', method.descriptor.method, method.token)
      }
      await this.disposeNamespace(name, handle)
    }
  }

  // 中文：为全新命名空间创建服务：在 ownerCtx 下启动一个以 remote.<ns> 命名
  // 的 Cordis 插件 fiber，其 apply 中同步构造 RemoteNamespaceService 并装好
  // 描述符组；fiber 的 dispose 即整个服务的卸载通道。启动失败时先注销 fiber
  // 再抛错，避免残留半成品服务。
  private async createNamespace(
    name: string,
    descriptors: readonly InvocationDescriptor[],
  ): Promise<{ namespace: RemoteNamespaceHandle; installed: InstalledMethod[] }> {
    let service: RemoteNamespaceService | undefined
    let installed: InstalledMethod[] | undefined
    const fiber = this.ownerCtx.plugin({
      name: remoteServiceKey(name),
      apply: (ctx: Context) => {
        service = new RemoteNamespaceService(
          ctx,
          name,
          (direct, scoped, caller, args) => this.invokeMethod(direct, scoped, caller, args),
        )
        // Same synchronous window as the service registration: a dependent the
        // new service unparks runs only after the methods exist.
        // 中文：与服务注册处于同一同步窗口：被新服务唤醒的依赖方只会在
        // 方法装好之后才运行，保证其看到的服务永远"方法齐全"。
        installed = installMethods(service, descriptors)
      },
    })
    try {
      await fiber
    } catch (error) {
      await fiber.dispose()
      throw error
    }
    /* v8 ignore next 3 -- a settled namespace fiber synchronously constructs its Service and installs the group. */
    if (service === undefined || installed === undefined) {
      throw new Error(`client api: namespace ${JSON.stringify(name)} did not start`)
    }
    const namespace = { service, dispose: fiber.dispose }
    this.namespaces.set(name, namespace)
    return { namespace, installed }
  }

  // 中文：尝试卸载命名空间：仅当服务已无任何方法（empty）且当前句柄仍是最新
  // 注册的那个时才真正删除并 dispose，避免误拆别处新装的同名命名空间。
  private async disposeNamespace(name: string, namespace: RemoteNamespaceHandle): Promise<void> {
    if (!namespace.service.empty || this.namespaces.get(name) !== namespace) return
    this.namespaces.delete(name)
    await namespace.dispose()
  }

  // 中文：命名空间服务的方法调用入口（由属性 getter 注入的回调触发）。
  // 解析顺序：若调用方上下文能解析出 scoped 上下文身份 → 走 scoped 变体；
  // 否则有 direct 变体 → 走 direct；再退而求其次用 scoped 变体兜底；
  // 若方法已被卸载（两个变体都不存在）则抛错。
  private invokeMethod(
    direct: DirectMethod | undefined,
    scoped: ScopedMethod | undefined,
    callerCtx: Context,
    values: readonly unknown[],
  ): Promise<RemoteResult<unknown>> {
    if (scoped !== undefined) {
      // 中文：尝试从调用方上下文解析 scoped 上下文身份，命中即绑定该身份调用。
      const binder = this.ownerCtx.typert.contexts.getClient(scoped.projection.context)
      const identity = binder?.identity(callerCtx)
      if (identity !== undefined) {
        return this.invoke(
          scoped.descriptor,
          scoped.projection,
          scoped.token,
          callerCtx,
          values,
          { value: identity },
        )
      }
    }
    if (direct !== undefined) {
      return this.invoke(direct.descriptor, undefined, direct.token, callerCtx, values)
    }
    if (scoped !== undefined) {
      return this.invoke(scoped.descriptor, scoped.projection, scoped.token, callerCtx, values)
    }
    throw new Error('client api: Remote method is no longer mounted')
  }

  // 中文：执行一次远程调用的最终落点。流程：检查挂载状态 → 校验实参数目
  // → 组装命名参数对象（scoped 身份 + 业务参数，逐一经 codec 严格解析）→
  // 取 Connection 载体发起 /api RPC → 校验挂载是否仍存活 → 解析结果；
  // 调用方信号与挂载令牌信号合并（AbortSignal.any），任一中止即中止调用。
  private async invoke(
    descriptor: InvocationDescriptor,
    projection: ScopedProjection | undefined,
    token: MountToken,
    callerCtx: Context,
    values: readonly unknown[],
    boundIdentity?: BoundContextIdentity,
  ): Promise<RemoteResult<unknown>> {
    const endpoint = endpointOf(descriptor)
    if (!token.active) return withdrawn(endpoint) // 中文：方法已随 effect 注销，直接按"已撤回"处理
    // 中文：期望的业务参数个数 = 参数总数减去 scoped 身份参数（不入参数组）；
    // 若描述符支持取消且实参多一个，则末位是调用方提供的 AbortSignal。
    const expected = descriptor.parameters.length - (projection?.parameterIndex === undefined ? 0 : 1)
    const hasCallerSignal = descriptor.cancellation !== undefined && values.length === expected + 1
    if (values.length !== expected && !hasCallerSignal) {
      const contract = descriptor.cancellation === undefined
        ? `${String(expected)} argument(s)`
        : `${String(expected)} business argument(s) plus an optional AbortSignal`
      throw new Error(
        `client api: ${endpoint} expected ${contract}, got ${String(values.length)}`,
      )
    }
    const args = Object.create(null) as Record<string, unknown> // 中文：命名参数对象（无原型，避免键名碰撞）
    if (projection !== undefined) {
      // 中文：scoped 调用需要把上下文身份作为参数带上：优先用调用方传入的
      // 绑定身份，否则从调用方上下文现场解析；两种途径都拿不到身份就报错。
      const binder = boundIdentity === undefined
        ? this.ownerCtx.typert.contexts.getClient(projection.context)
        : undefined
      if (boundIdentity === undefined && binder === undefined) {
        throw new Error(`client api: ${endpoint} has no Client Context binder for ${JSON.stringify(projection.context)}`)
      }
      const identity = boundIdentity === undefined
        ? binder?.identity(callerCtx)
        : boundIdentity.value
      if (identity === undefined) {
        throw new Error(`client api: ${endpoint} requires a ${JSON.stringify(projection.context)} Context`)
      }
      args[projection.wire] = parse(projection.codec, identity, endpoint, projection.wire)
    }
    let valueIndex = 0 // 中文：实参数组下标（跳过 scoped 身份参数对应的那个位置）
    descriptor.parameters.forEach((parameter, parameterIndex) => {
      if (parameterIndex === projection?.parameterIndex) return
      const value = parse(parameter.codec, values[valueIndex], endpoint, parameter.wire)
      if (value !== undefined) args[parameter.wire] = value // 中文：undefined 参数不写入，等价于线上缺席
      valueIndex += 1
    })
    const connection = this.ownerCtx.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) throw new Error(`client api: ${endpoint} has no active Connection`)
    // 中文：合并"挂载令牌信号"与"调用方信号"：挂载撤销或调用方取消任一发生
    // 都中止请求；仅当方法支持取消时调用方信号才存在。
    const callerSignal = hasCallerSignal ? values[expected] as AbortSignal | undefined : undefined
    const signal = callerSignal === undefined
      ? token.abort.signal
      : AbortSignal.any([token.abort.signal, callerSignal])
    try {
      const result = await connection.rpc.call('/api', endpoint, { args }, signal)
      if (!mountActive(token)) return withdrawn(endpoint) // 中文：调用期间被卸载，结果作废
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, value: parse(descriptor.result, result.value, endpoint, 'result') }
    } catch (error) {
      // Carrier throws (offline, abort, a rejected result payload) are outcomes
      // of the call, not assembly faults, so they join the same error branch.
      // 中文：载体抛错（离线、中止、结果载荷被拒）都是"调用的结果"而非
      // 装配故障，因此统一并入同一错误分支处理。
      return carrierFailure(endpoint, error)
    }
  }
}

// 中文：命名空间服务的调用回调类型：由 ClientRemoteService.invokeMethod
// 实现，参数为当前方法的 direct / scoped 变体、调用方上下文与实参数组。
type InvokeRemote = (
  direct: DirectMethod | undefined,
  scoped: ScopedMethod | undefined,
  callerCtx: Context,
  args: readonly unknown[],
) => Promise<RemoteResult<unknown>>

// 中文：单个命名空间的服务对象（Service 键为 remote.<ns>）：把该命名空间
// 的方法作为自身属性暴露（getter 形式），属性读取时动态捕获当前变体并
// 委托给 invokeRemote 执行；同时维护方法记录表用于安装 / 移除 / 判空。
class RemoteNamespaceService extends Service {
  // 中文：方法名 → 变体记录表，是属性 getter 与调用路径的真相来源。
  private readonly methods = new Map<string, RemoteMethodRecord>()
  // 中文：本服务的命名空间名（如 'commands'），用于拼错误消息。
  private readonly namespace: string

  // 中文：静态检查方法名是否与"命名空间服务的保留成员"冲突：保留字段集
  // （REMOTE_NAMESPACE_FIELDS）或 Service 原型上的成员名都不允许被占用。
  static assertMethodAvailable(namespace: string, method: string): void {
    if (REMOTE_NAMESPACE_FIELDS.has(method) || method in RemoteNamespaceService.prototype) {
      throw new Error(`client api: method ${JSON.stringify(`${namespace}/${method}`)} conflicts with its namespace service`)
    }
  }

  constructor(
    ctx: Context,
    name: string,
    // 中文：调用回调（由 ClientRemoteService 注入），属性被访问时用于执行。
    private readonly invokeRemote: InvokeRemote,
  ) {
    super(ctx, remoteServiceKey(name))
    this.namespace = name
  }

  // 中文：实例级方法名检查：在静态检查之上，还拒绝"已被别的贡献占用过、
  // 但本实例 records 表里没有"的属性名（即实例上遗留的非本表属性）。
  assertMethodAvailable(method: string): void {
    RemoteNamespaceService.assertMethodAvailable(this.namespace, method)
    if (method in this && !this.methods.has(method)) {
      throw new Error(`client api: method ${JSON.stringify(`${this.namespace}/${method}`)} conflicts with its namespace service`)
    }
  }

  // 中文：命名空间是否已空（没有任何已安装方法）——供卸载判断使用。
  get empty(): boolean {
    return this.methods.size === 0
  }

  // 中文：查询某方法是否安装了指定种类的变体（direct 或 scoped）。
  has(kind: 'direct' | 'scoped', method: string): boolean {
    return this.methods.get(method)?.[kind] !== undefined
  }

  // 中文：安装 direct 变体（不涉及上下文投影）。
  installDirect(descriptor: InvocationDescriptor, token: MountToken): void {
    this.install(descriptor.method, 'direct', { descriptor, token })
  }

  // 中文：安装 scoped 变体（携带上下文投影信息）。
  installScoped(descriptor: InvocationDescriptor, projection: ScopedProjection, token: MountToken): void {
    this.install(descriptor.method, 'scoped', { descriptor, projection, token })
  }

  // 中文：核心安装逻辑（重载签名的实现）。方法首次安装时用 Object.defineProperty
  // 注入一个 getter 属性：读取即构造一个闭包函数，闭包捕获"调用时"的最新
  // 变体与调用方上下文后委托 invokeRemote——这样变体更新（重装）无需改属性。
  private install(method: string, kind: 'direct', value: DirectMethod): void
  private install(method: string, kind: 'scoped', value: ScopedMethod): void
  private install(method: string, kind: 'direct' | 'scoped', value: DirectMethod | ScopedMethod): void {
    this.assertMethodAvailable(method)
    let record = this.methods.get(method)
    const fresh = record === undefined
    record ??= {}
    if (fresh) {
      Object.defineProperty(this, method, {
        configurable: true,
        enumerable: true,
        get: function (this: RemoteNamespaceService): (...args: unknown[]) => Promise<RemoteResult<unknown>> {
          // 中文：getter 每次读取都取当前记录的快照，保证闭包看到最新变体。
          const callerCtx = this.ctx
          const current = this.methods.get(method)
          const direct = current?.direct
          const scoped = current?.scoped
          return (...args: unknown[]) => {
            return this.invokeRemote(direct, scoped, callerCtx, args)
          }
        },
      })
      this.methods.set(method, record)
    }
    if (kind === 'direct') record.direct = value
    else record.scoped = value as ScopedMethod
  }

  // 中文：移除某方法的指定变体；token 不匹配（说明已有更新变体顶替）则
  // 不动；变体全部移除后删除记录与注入属性，命名空间恢复可卸载状态。
  remove(kind: 'direct' | 'scoped', method: string, token: MountToken): void {
    const record = this.methods.get(method)
    const current = record?.[kind]
    /* v8 ignore next -- duplicate live variants are rejected before installation, so no newer token can replace this one. */
    if (record === undefined || current?.token !== token) return
    if (kind === 'direct') delete record.direct
    else delete record.scoped
    if (record.direct !== undefined || record.scoped !== undefined) return
    this.methods.delete(method)
    Reflect.deleteProperty(this, method)
  }
}

/**
 * Install one descriptor group on a namespace service, unwinding the partial
 * group when a descriptor is refused.
 * @param service - Namespace service taking the methods.
 * @param descriptors - Descriptor group of one contribution.
 * @returns per-descriptor records for the group disposer.
 */
// 中文：在命名空间服务上安装一组描述符；某个描述符被拒绝（抛错）时，逆序
// 回滚已装部分——置空令牌、中止调用、移除变体——再重新抛出，保证不留
// 半装状态。每个方法分配独立的挂载令牌（active + AbortController）。
function installMethods(
  service: RemoteNamespaceService,
  descriptors: readonly InvocationDescriptor[],
): InstalledMethod[] {
  const installed: InstalledMethod[] = []
  try {
    for (const descriptor of descriptors) {
      const method: InstalledMethod = {
        descriptor,
        token: { active: true, abort: new AbortController() },
        direct: false,
        scoped: false,
      }
      installed.push(method)
      // 中文：direct 调用装 direct 变体；描述符存在上下文投影（context 调用
      // 或 scope 选择）时再装 scoped 变体，二者可并存。
      if (descriptor.invocation.kind === 'direct') {
        service.installDirect(descriptor, method.token)
        method.direct = true
      }
      const projection = scopedProjection(descriptor)
      if (projection !== undefined) {
        service.installScoped(descriptor, projection, method.token)
        method.scoped = true
      }
    }
  } catch (error) {
    for (const method of [...installed].reverse()) {
      method.token.active = false
      method.token.abort.abort()
      if (method.scoped) service.remove('scoped', method.descriptor.method, method.token)
      if (method.direct) service.remove('direct', method.descriptor.method, method.token)
    }
    throw error
  }
  return installed
}

// 中文：命名空间服务的保留字段名集合——远程方法名不得与这些成员重名，
// 否则会破坏 Service 自身机制（ctx、methods、invokeRemote 等）。
const REMOTE_NAMESPACE_FIELDS = new Set(['ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace'])

// 中文：命名空间对应的 Cordis 服务键，形如 remote.<namespace>。
function remoteServiceKey(namespace: string): string {
  return `remote.${namespace}`
}

// 中文：由描述符拼规范端点标识 <namespace>/<method>。
function endpointOf(descriptor: Pick<InvocationDescriptor, 'namespace' | 'method'>): string {
  return `${descriptor.namespace}/${descriptor.method}`
}

// 中文：挂载令牌是否仍存活（用于调用返回后判断结果是否还有效）。
function mountActive(token: MountToken): boolean {
  return token.active
}

// 中文：从描述符推导 scoped 投影：context 调用直接用其上下文名 / wire /
// codec；否则在描述符声明了 scope 时，要求参数中恰好只有一个 lookup 参数
// 且其 wire 与 lookup 上下文与 scope 声明一致，把它作为投影载体。
// 推导不出合法投影返回 undefined。
function scopedProjection(descriptor: InvocationDescriptor): ScopedProjection | undefined {
  if (descriptor.invocation.kind === 'context') {
    return {
      context: descriptor.invocation.context,
      wire: descriptor.invocation.wire,
      codec: descriptor.invocation.codec,
    }
  }
  if (descriptor.scope === undefined) return undefined
  // 中文：筛出所有 lookup 来源参数（带参数下标），供投影选择。
  const lookupParameters = descriptor.parameters
    .map((parameter, index) => ({ parameter, index }))
    .filter(candidate => candidate.parameter.source === 'lookup')
  const selected = lookupParameters.length === 1 ? lookupParameters[0] : undefined
  if (selected === undefined
    || selected.parameter.wire !== descriptor.scope.wire
    || selected.parameter.lookup !== descriptor.scope.context) {
    throw new Error(
      `client api: generated Remote ${endpointOf(descriptor)} scope must select its only lookup parameter`,
    )
  }
  return {
    context: descriptor.scope.context,
    wire: descriptor.scope.wire,
    codec: selected.parameter.codec,
    parameterIndex: selected.index,
  }
}

// 中文：要求描述符整体使用严格 codec：结果、每个参数以及 context 调用时
// 的身份字段都必须声明为 strict，否则拒绝安装（客户端只信任严格描述符）。
function requireStrictDescriptor(descriptor: InvocationDescriptor): void {
  const endpoint = endpointOf(descriptor)
  requireStrictCodec(descriptor.result, endpoint, 'result')
  for (const parameter of descriptor.parameters) {
    requireStrictCodec(parameter.codec, endpoint, parameter.wire)
  }
  if (descriptor.invocation.kind === 'context') {
    requireStrictCodec(descriptor.invocation.codec, endpoint, descriptor.invocation.wire)
  }
}

// 中文：单个 codec 的严格性检查：mode 不是 'strict' 即抛错。
function requireStrictCodec(codec: TypertCodec, endpoint: string, field: string): void {
  if (codec.mode !== 'strict') {
    throw new Error(`client api: generated Remote ${endpoint} field ${JSON.stringify(field)} has no strict codec`)
  }
}

// 中文：用严格 schema 解析一个 wire 值（参数 / 结果 / 身份共用）；解析失败
// 包装成带端点与字段信息的错误，便于定位是哪个字段被拒。
function parse(codec: TypertCodec, value: unknown, endpoint: string, field: string): unknown {
  if (codec.mode !== 'strict') {
    throw new Error(`client api: generated Remote ${endpoint} field ${JSON.stringify(field)} has no strict codec`)
  }
  try {
    return codec.schema.parse(value)
  } catch (cause) {
    throw new Error(`client api: ${endpoint} rejected ${JSON.stringify(field)}`, { cause })
  }
}

/** The namespace retired before or during the call, so no request outcome exists. */
// 中文：命名空间在调用前或调用期间已注销，因此不存在任何请求结果——
// 一律返回 internal 失败的 RemoteResult（错误消息标明方法已卸载）。
function withdrawn(endpoint: string): RemoteResult<never> {
  return internalFailure(`client api: Remote method ${endpoint} is no longer mounted`)
}

// 中文：载体调用失败（抛错）的映射：取错误的 message 生成 internal 失败结果。
function carrierFailure(endpoint: string, error: unknown): RemoteResult<never> {
  return internalFailure(`client api: ${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`)
}

// 中文：构造 internal 失败结果的统一出口（ok: false + code 'internal'）。
function internalFailure(message: string): RemoteResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}
