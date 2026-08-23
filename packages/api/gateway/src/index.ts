/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现 Typert RPC 网关的核心逻辑：把远程客户端发来的"命名端点
 * + 参数"请求，解析为具体的 Service 方法与业务实参，分发到 Host 端插件上
 * 执行，再把业务结果做边界校验后返回；同时作为 Connection 载体的 RPC
 * 处理器，拦截 /api 路径下的调用。
 * 【技术维度】基于 Cordis 的 Service 插件体系：TypertGatewayService 继承
 * Service 并注册为 ctx.typertGateway；通过 ctx.connection.rpc.intercept
 * 挂接 RPC 拦截器；描述符解析支持两条路径——严格生成描述符（typert 注册表
 * 里的 InvocationDescriptor）与 SRC 标记（源码上的 typertRemote 绑定反射）。
 * 【产品维度】远程 BFF 网关是"能力暴露层"：Host 端各插件（如 commands、
 * settings、llm）的能力经此网关暴露给远程客户端（IDE 扩展、ACP 等），
 * 客户端无需引入 Host 包即可调用；网关同时负责参数校验、上下文解析、
 * 查找（lookup）解析与 JSON 安全边界检查。
 * 【逻辑维度】按出现顺序：错误类型（TypertGatewayError 等）→ 网关服务类
 * TypertGatewayService（拦截器挂接 → 端点认领 → 描述符解析 → 参数与上下文
 * 解析 → 方法调用 → 结果解码）→ 模块级工具函数（RPC 失败映射、绑定校验、
 * 签名解析、参数精确匹配、JSON 安全断言）。
 * 【关键边界】args 必须与描述符精确匹配（assertExactArguments）；业务结果
 * 必须通过 JSON 安全校验（assertJsonValue），非有限数值、循环引用、符号
 * 属性等都会在边界被拒绝；SRC 回退只在没有严格定义时使用，且参数名必须
 * 是合法的简单标识符。
 * 【新手阅读建议】建议按调用链阅读：先看 invoke() 总览整条链路，再依次
 * 看 resolveDescriptor / resolveReceiverContext / resolveParameter 理解
 * 参数如何从 wire 值变成业务实参，最后看 assertJsonValue 理解 JSON 安全
 * 边界为什么存在。
 * ==========================================================================
 */
/**
 * Live Typert Remote dispatch over Cordis Services and registered providers.
 * Transport, request correlation, and response envelopes belong to Connection.
 * @module @deepseek-ai/dsh-api-gateway
 */
// 英文模块注释的中文解释：本文件是"活的" Typert 远程分发实现——通过
// Cordis 服务与已注册的 provider 完成调用；传输、请求关联与响应信封等
// 载体职责归属 Connection 包，本文件不涉及。

import { Context, Service, symbols } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import {
  remoteMethods,
  TypertLookupFailure,
  type InvocationDescriptor,
  type InvocationParameterDescriptor,
  type TypertCodec,
  type TypertGatewayBinding,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  InvokeRemoteRequest,
  TypertGateway,
  TypertGatewayErrorCode,
} from './types.ts'

// 中文：再导出 types.ts 的网关契约类型，让业务方从本入口一并取得。
export type {
  InvokeRemoteRequest,
  TypertGateway,
  TypertGatewayErrorCode,
} from './types.ts'

// 中文：网关错误的可选附加信息——cause 是被包裹的底层错误，field 标明
// 出错的具体 wire 字段名（仅当失败与特定字段相关时才有值）。
interface GatewayErrorOptions {
  readonly cause?: unknown
  readonly field?: string
}

// 中文：校验通过后的"已解析绑定"：binding 是 Service 源码上的 typertRemote
// 绑定对象，original 是去掉 Cordis 包装后的原始 Service 实例。
interface ResolvedBinding {
  readonly binding: TypertGatewayBinding
  readonly original: object
}

// 中文：Connection 载体 RPC 处理器的返回值类型，以及其失败分支的错误类型；
// 网关适配器以它为基准构造返回，保证与载体的响应信封形状一致。
type ConnectionRpcResult = Awaited<ReturnType<ConnectionRpcHandler>>
type ConnectionRpcError = Extract<ConnectionRpcResult, { readonly ok: false }>['error']
// 中文：一个永不触发的取消信号：方法不支持取消时，用它占住 AbortSignal
// 形参位置，让业务代码总能拿到可用信号对象，避免到处判空。
const NEVER_ABORTED_SIGNAL = new AbortController().signal

/** Dispatch failure produced outside the invoked business method. */
// 中文：网关分发失败异常——在"业务方法本身执行之外"（参数校验、上下文
// 解析、绑定校验等环节）出错时抛出，携带机器可读的错误码与端点信息；
// 业务代码抛出的错误则保留其原始类型，不包装成此类。
export class TypertGatewayError extends Error {
  /** Machine-readable failure category. */
  // 中文：机器可读的失败分类（对应 types.ts 中的错误码枚举）。
  readonly code: TypertGatewayErrorCode
  /** Canonical `<namespace>/<method>` endpoint. */
  // 中文：规范化的端点标识，形如 <namespace>/<method>，用于日志定位与
  // 错误上报；注意这里只是注释中的示例写法，不代表代码包含尖括号序列。
  readonly endpoint: string
  /** Affected wire field when the failure is field-specific. */
  // 中文：出错涉及的 wire 字段名；仅当失败与特定字段相关时才有值，否则为 undefined。
  readonly field: string | undefined

  /**
   * Construct a Gateway failure without embedding boundary values in its message.
   * @param code - stable failure category.
   * @param endpoint - canonical Remote endpoint.
   * @param message - correction-oriented diagnostic without sensitive values.
   * @param options - optional field and contained cause.
   */
  // 中文：构造网关失败异常。message 约定只写"指向修正方向"的诊断信息、
  // 不嵌入敏感值；cause 与 field 通过 options 传入，避免把边界值拼进消息。
  constructor(
    code: TypertGatewayErrorCode,
    endpoint: string,
    message: string,
    options: GatewayErrorOptions = {},
  ) {
    super(`typert gateway: ${endpoint}: ${message}`, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'TypertGatewayError'
    this.code = code
    this.endpoint = endpoint
    this.field = options.field
  }
}

/** Business invocation lost its carrier cancellation race. */
// 中文：业务调用在"载体取消竞态"中落败——调用已被取消、但业务方法仍
// 抛出了异常；此时以"已取消"而非业务错误对待，避免把过时结果误报为失败。
class RemoteInvocationCancelled extends Error {
  /**
   * @param endpoint - canonical Remote endpoint.
   * @param cause - business rejection observed after carrier cancellation.
   */
  // 中文：构造取消异常，消息里带端点名，cause 记录取消后观察到的业务拒绝原因。
  constructor(endpoint: string, cause: unknown) {
    super(`Remote invocation "${endpoint}" was aborted`, { cause })
    this.name = 'RemoteInvocationCancelled'
  }
}

/**
 * Resolve strict generated definitions or conservative SRC markers against
 * current Cordis Services and Typert providers.
 * @typert service typertGateway
 */
// 中文：网关服务类——同时实现 TypertGateway 接口并作为 Cordis Service 注册。
// 对每个远程端点，优先查"严格生成描述符"（typert 注册表），找不到再回退
// 到"保守的 SRC 标记"（源码反射）；@typert 标签声明它是 typert 服务网关。
export class TypertGatewayService extends Service implements TypertGateway {
  // 中文：静态声明依赖 typert 注册表服务，保证本服务启动前它已就绪。
  static inject = ['typert']

  // 中文：SRC 端点认领集合的缓存；在 Service 变更（internal/service 事件）
  // 时置空重建，undefined 表示"尚未收集或已失效"。
  private srcClaims: ReadonlySet<string> | undefined

  /**
   * Register the Gateway against the active Typert registry.
   * @param ctx - owning Host Context with Typert registry access.
   */
  // 中文：构造网关服务。super 以 'typertGateway' 为键注册 Service；监听
  // internal/service 事件（任何服务增删变化）使 SRC 认领缓存失效；再用
  // ctx.inject 声明对 connection 的依赖，一旦载体就绪就把 /api 路径的
  // RPC 拦截器挂上去（trusted-host 权威标记，表示本端是可信 Host）。
  constructor(ctx: Context) {
    super(ctx, 'typertGateway')
    ctx.on('internal/service', () => {
      this.srcClaims = undefined
    })
    ctx.inject(['connection'], (connectionCtx) => {
      connectionCtx.connection.rpc.intercept(
        '/api',
        endpoint => this.claimsEndpoint(endpoint),
        (endpoint, payload, signal) => this.dispatchRpc(endpoint, payload, signal),
        { authority: 'trusted-host' },
      )
    })
  }

  // 中文：判断某个端点是否属于本网关可认领的范围（供拦截器过滤用）：
  // 端点是合法的 "ns/method" 两段式，且要么已在 typert 注册表中（无论是否
  // 仍存活，hasSeen 也认），要么在 SRC 反射收集到的认领集合里。
  private claimsEndpoint(endpoint: string): boolean {
    const segments = endpoint.split('/')
    if (segments.length !== 2 || segments[0] === '' || segments[1] === '') return false
    if (this.ctx.typert.local.get(endpoint) !== undefined || this.ctx.typert.local.hasSeen(endpoint)) return true
    this.srcClaims ??= this.collectSrcClaims()
    return this.srcClaims.has(endpoint)
  }

  // 中文：扫描当前所有 Cordis Service，收集带 typertRemote 绑定的"SRC 端点
  // 认领集合"：每个绑定声明一个 namespace，其 remoteMethods 列出的每个
  // 方法（含 exportName 别名）都认领一个端点，结果缓存于 srcClaims。
  private collectSrcClaims(): ReadonlySet<string> {
    const claims = new Set<string>()
    for (const [serviceKey, definition] of Object.entries(this.ctx.reflect.props)) {
      if (definition.type !== 'service') continue
      const receiver = this.ctx.get(serviceKey) as unknown
      if (!isObject(receiver)) continue
      const original = originalOf(receiver)
      const binding = Reflect.get(original, 'typertRemote') as unknown
      if (!isObject(binding) || typeof Reflect.get(binding, 'namespace') !== 'string') continue
      const namespace = Reflect.get(binding, 'namespace') as string
      for (const candidate of remoteMethods(original)) {
        claims.add(endpointOf(namespace, candidate.exportName ?? candidate.method))
      }
    }
    return claims
  }

  /**
   * Invoke one live Remote method through strict generated reflection or SRC markers.
   * @param request - decoded endpoint and exact named wire arguments.
   * @returns the validated business result.
   * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
   */
  // 中文：调用一个存活的 Remote 方法（Host 侧入口）。流程：解析描述符 →
  // 校验参数集合 → 解析接收方上下文 → 取出 Service 实例并校验绑定 →
  // 逐个解析参数 → 反射调用方法 → 按描述符解码结果；任何非业务失败都
  // 以 TypertGatewayError 抛出，业务失败则原样上抛。
  async invoke(request: InvokeRemoteRequest): Promise<unknown> {
    const endpoint = endpointOf(request.namespace, request.method) // 中文：规范化端点标识，如 "commands/run"
    const descriptor = this.resolveDescriptor(request.namespace, request.method, endpoint) // 中文：解析出的调用描述符（严格或 SRC）
    assertExactArguments(request.args, descriptor, endpoint)
    const receiverContext = await this.resolveReceiverContext(descriptor, request.args, endpoint) // 中文：接收方上下文（context 调用时解析，否则就是 Host 根上下文）
    const receiver = receiverContext.get(descriptor.service) as unknown // 中文：从上下文取出描述符指定的 Service 实例
    if (!isObject(receiver)) {
      throw new TypertGatewayError(
        'service-unavailable',
        endpoint,
        `active Service ${JSON.stringify(descriptor.service)} is unavailable`,
      )
    }
    validateBinding(receiver, descriptor.service, descriptor.namespace, endpoint)
    const args = await Promise.all(descriptor.parameters.map(parameter =>
      this.resolveParameter(parameter, request.args, endpoint))) // 中文：把每个 wire 参数解析为业务实参（含 lookup 解析）
    if (descriptor.cancellation !== undefined) args.push(request.signal ?? NEVER_ABORTED_SIGNAL) // 中文：支持取消的方法追加信号实参，缺省用永不触发信号占位
    const implementation = descriptor.implementation ?? descriptor.method // 中文：实际方法名（SRC 别名场景与端点方法名不同）
    const method = Reflect.get(receiver, implementation) as unknown // 中文：从 Service 实例上取方法引用
    if (typeof method !== 'function') {
      throw new TypertGatewayError(
        'method-unavailable',
        endpoint,
        `active Service ${JSON.stringify(descriptor.service)} has no callable method ${JSON.stringify(implementation)}`,
      )
    }

    let result: unknown
    try {
      result = await Reflect.apply(method, receiver, args) as unknown // 中文：以 Service 为 this 调用业务方法
    } catch (error) {
      if (request.signal?.aborted === true) throw new RemoteInvocationCancelled(endpoint, error)
      throw error
    }
    // A weak descriptor declares no return type, so nothing returned is a void
    // result and rides the wire as an absent value field. A strict descriptor
    // keeps its schema: there, undefined has to be a declared result.
    // 中文：弱描述符不声明返回类型，因此"没有返回值"就是 void 结果，线上
    // 以缺失 value 字段表示；严格描述符保留 schema，此时 undefined 必须是
    // 其声明过的结果类型才放行，否则走 decode 边界校验。
    if (result === undefined && descriptor.result.mode !== 'strict') return result
    return decode(descriptor.result, result, 'result-invalid', endpoint, 'result')
  }

  // 中文：RPC 拦截器回调的薄包装，把载体传来的 (端点, 载荷, 信号) 交给
  // invokeRpc 处理，保持接口签名与 ConnectionRpcHandler 一致。
  private async dispatchRpc(
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<ConnectionRpcResult> {
    return this.invokeRpc(endpoint, payload, signal)
  }

  // 中文：把载体 RPC 载荷转成网关调用并返回载体信封。先做载荷形状校验
  // （必须是只含一个 args 字段的普通对象），再构造 InvokeRemoteRequest
  // 交给 invoke；成功时把业务结果放进 value 槽（void 结果不带 value），
  // 任何异常都映射为 ok: false 的错误信封，绝不让异常漏到载体层。
  private async invokeRpc(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult> {
    try {
      const segments = endpoint.split('/')
      if (segments.length !== 2 || segments[0] === '' || segments[1] === '') {
        throw new Error(`invalid Remote endpoint ${JSON.stringify(endpoint)}`)
      }
      const [namespace, method] = segments as [string, string]
      if (!isObject(payload)
        || !isPlainObject(payload)
        || Reflect.ownKeys(payload).length !== 1
        || !Object.hasOwn(payload, 'args')
        || !isObject(payload.args)
        || !isPlainObject(payload.args)) {
        throw new Error('Remote payload must contain exactly one plain-object args field')
      }
      const value = await this.invoke({
        namespace,
        method,
        args: payload.args,
        signal,
      })
      // A void or explicitly absent business result carries no `value` field;
      // JSON has no `undefined`, and the envelope's optional slot is the one
      // representation of absence that both args and results already use.
      // 中文：void 或显式缺失的业务结果不带 value 字段：JSON 里没有
      // undefined，信封的可选槽位正是参数与结果共用的"缺席"表示。
      return { ok: true, value }
    } catch (error) {
      return rpcFailure(error)
    }
  }

  // 中文：解析端点对应的调用描述符。优先用 typert 注册表里的严格定义；
  // 若该端点"曾经存在但已被撤回"（hasSeen 命中而 get 落空），则禁止回退
  // 到 SRC，直接报 definition-unavailable，防止客户端拿到过时语义。
  private resolveDescriptor(namespace: string, method: string, endpoint: string): InvocationDescriptor {
    const strict = this.ctx.typert.local.get(endpoint)
    if (strict !== undefined) return strict
    if (this.ctx.typert.local.hasSeen(endpoint)) {
      throw new TypertGatewayError(
        'definition-unavailable',
        endpoint,
        'its strict definition was withdrawn and SRC fallback is forbidden',
      )
    }
    return this.resolveSrcDescriptor(namespace, method, endpoint)
  }

  // 中文：走 SRC 回退：扫描所有 Service，找 typertRemote 绑定中 namespace
  // 匹配且方法名（或 exportName 别名）匹配的候选；候选唯一才返回，零个报
  // invocation-unavailable，多个报 ambiguous-endpoint（列出所有 Service 名）。
  private resolveSrcDescriptor(namespace: string, method: string, endpoint: string): InvocationDescriptor {
    const candidates: InvocationDescriptor[] = []
    for (const [serviceKey, definition] of Object.entries(this.ctx.reflect.props)) {
      if (definition.type !== 'service') continue
      const receiver = this.ctx.get(serviceKey) as unknown
      if (!isObject(receiver)) continue
      const original = originalOf(receiver)
      const value = Reflect.get(original, 'typertRemote') as unknown
      if (value === undefined) continue
      const binding = readBinding(value, original, serviceKey, endpoint)
      if (binding.namespace !== namespace) continue
      const marker = remoteMethods(original).find(candidate => (candidate.exportName ?? candidate.method) === method)
      if (marker === undefined) continue
      candidates.push(this.srcDescriptor(binding, marker, method, endpoint))
    }
    if (candidates.length === 0) {
      throw new TypertGatewayError('invocation-unavailable', endpoint, 'no active Remote method exports this endpoint')
    }
    if (candidates.length > 1) {
      throw new TypertGatewayError(
        'ambiguous-endpoint',
        endpoint,
        `multiple active Services export this endpoint: ${candidates.map(candidate => candidate.service).sort().join(', ')}`,
      )
    }
    return candidates[0] as InvocationDescriptor
  }

  // 中文：从 SRC 标记构造"弱描述符"：通过反射读取方法参数名，为每个参数
  // 决定 wire 名与来源（普通 json 或 lookup 查找）；若方法声明了 context
  // 调用则补充 invocation 信息。弱描述符全部使用 src-json 宽松编解码。
  private srcDescriptor(
    binding: TypertGatewayBinding,
    marker: ReturnType<typeof remoteMethods>[number],
    method: string,
    endpoint: string,
  ): InvocationDescriptor {
    const names = methodParameterNames(binding.service, marker.method, endpoint) // 中文：反射读出的方法形参名列表
    const signalIndex = names.indexOf('signal')
    if (signalIndex >= 0 && signalIndex !== names.length - 1) {
      throw new TypertGatewayError(
        'signature-invalid',
        endpoint,
        'SRC cancellation parameter signal must be the final parameter',
        { field: 'signal' },
      )
    }
    // 中文：名为 signal 的末位参数被识别为取消信号占位，其余参数才是业务参数。
    const cancellation = signalIndex >= 0
      ? { parameter: 'signal' as const }
      : undefined
    const businessNames = cancellation === undefined ? names : names.slice(0, -1)
    const parameters: InvocationParameterDescriptor[] = []
    const wires = new Set<string>() // 中文：已占用的 wire 名集合，用于检测冲突
    for (const name of businessNames) {
      // 中文：按参数名查 lookup 提供者定义；同名匹配多个提供者属签名错误。
      const matches = this.ctx.typert.lookups.definitions()
        .filter(definition => definition.parameter === name)
      if (matches.length > 1) {
        throw new TypertGatewayError(
          'signature-invalid',
          endpoint,
          `parameter ${JSON.stringify(name)} matches multiple lookup providers`,
          { field: name },
        )
      }
      const match = matches[0]
      // 中文：命中 lookup 定义则该参数走 lookup 来源（wire 名取提供者声明），
      // 否则就是普通 json 参数（wire 名与参数名相同）。
      const parameter: InvocationParameterDescriptor = match === undefined
        ? { name, wire: name, source: 'json', codec: { mode: 'src-json' } }
        : {
          name,
          wire: match.wire,
          source: 'lookup',
          lookup: match.key,
          codec: { mode: 'src-json' },
        }
      if (wires.has(parameter.wire)) {
        throw new TypertGatewayError(
          'signature-invalid',
          endpoint,
          `multiple parameters use wire field ${JSON.stringify(parameter.wire)}`,
          { field: parameter.wire },
        )
      }
      wires.add(parameter.wire)
      parameters.push(parameter)
    }

    // 中文：默认直连调用（direct）；若 SRC 标记声明 context 调用，则解析
    // Host 端上下文提供者并改造成 context 调用描述（wire 名取提供者声明）。
    let receiver: InvocationDescriptor['invocation'] = { kind: 'direct' }
    if (marker.invocation.kind === 'context') {
      const provider = this.ctx.typert.contexts.getHost(marker.invocation.context)
      if (provider === undefined) {
        throw new TypertGatewayError(
          'context-unavailable',
          endpoint,
          `Context provider ${JSON.stringify(marker.invocation.context)} is unavailable`,
        )
      }
      if (wires.has(provider.wire)) {
        throw new TypertGatewayError(
          'signature-invalid',
          endpoint,
          `Context identity conflicts with wire field ${JSON.stringify(provider.wire)}`,
          { field: provider.wire },
        )
      }
      receiver = {
        kind: 'context',
        context: marker.invocation.context,
        wire: provider.wire,
        codec: { mode: 'src-json' },
      }
    }

    // 中文：组装弱描述符：id 用 src:<serviceKey>#<endpoint> 标记来源，
    // implementation 仅在方法名与端点名不同（别名导出）时出现。
    return {
      id: `src:${binding.serviceKey}#${endpoint}`,
      service: binding.serviceKey,
      namespace: binding.namespace,
      method,
      ...(marker.method === method ? {} : { implementation: marker.method }),
      invocation: receiver,
      parameters,
      ...(cancellation === undefined ? {} : { cancellation }),
      result: { mode: 'src-json' },
    }
  }

  // 中文：解析"接收方上下文"——context 调用的目标是某个业务 Context（如
  // 某次会话）内的 Service，而不是 Host 根上下文。做法：取出 Host 端上下文
  // 提供者，核对 wire 名与类型符号（严格定义时）一致，用请求里的身份值
  // 调用 provider.resolve 得到目标 Context；解析失败按阶段映射错误码。
  private async resolveReceiverContext(
    descriptor: InvocationDescriptor,
    args: Readonly<Record<string, unknown>>,
    endpoint: string,
  ): Promise<Context> {
    if (descriptor.invocation.kind === 'direct') return this.ctx // 中文：direct 调用直接使用 Host 根上下文
    const invocation = descriptor.invocation
    const provider = this.ctx.typert.contexts.getHost(invocation.context)
    if (provider === undefined) {
      throw new TypertGatewayError(
        'context-unavailable',
        endpoint,
        `Context provider ${JSON.stringify(invocation.context)} is unavailable`,
      )
    }
    if (provider.wire !== invocation.wire
      || (invocation.codec.mode === 'strict' && provider.wireTypeSymbol !== invocation.codec.typeSymbol)) {
      throw new TypertGatewayError(
        'provider-mismatch',
        endpoint,
        `Context provider ${JSON.stringify(invocation.context)} does not match its strict definition`,
        { field: invocation.wire },
      )
    }
    // 中文：先从请求参数里取出身份值（wire 名对应字段）并做边界解码。
    const identity = decode(invocation.codec, args[invocation.wire], 'input-invalid', endpoint, invocation.wire)
    let context: Context | undefined
    try {
      context = await provider.resolve(identity)
    } catch (cause) {
      // 中文：lookup 策略失败（TypertLookupFailure）保持原样上抛，属于
      // 业务策略范畴；其余异常统一映射为 context-failed。
      if (cause instanceof TypertLookupFailure) throw cause
      throw new TypertGatewayError(
        'context-failed',
        endpoint,
        `Context provider ${JSON.stringify(invocation.context)} failed`,
        { cause, field: invocation.wire },
      )
    }
    if (context === undefined) {
      throw new TypertGatewayError(
        'context-not-found',
        endpoint,
        `Context provider ${JSON.stringify(invocation.context)} did not resolve the requested identity`,
        { field: invocation.wire },
      )
    }
    return context
  }

  // 中文：解析单个参数：从请求 args 中取 wire 值并做边界解码；json 参数
  // 解码后直接返回，lookup 参数还要经查找提供者（如 session 标识 → 会话）
  // 解析为业务身份；提供者缺失或解析失败分别映射对应错误码。
  private async resolveParameter(
    parameter: InvocationParameterDescriptor,
    args: Readonly<Record<string, unknown>>,
    endpoint: string,
  ): Promise<unknown> {
    // An absent field reached assertExactArguments' allowance, so this parameter
    // takes undefined; a present-but-undefined field is not JSON-safe input and
    // still fails decode. Lookup ids are never omissible, so absence here only
    // ever belongs to a json parameter.
    // 中文：字段缺席在 assertExactArguments 处已被允许，因此这里直接给
    // undefined；"字段存在但值是 undefined"不是合法 JSON 输入，仍会在解码
    // 时失败。lookup 标识永远不可省略，所以缺席只可能发生在 json 参数上。
    if (!Object.hasOwn(args, parameter.wire)) return undefined
    const value = decode(parameter.codec, args[parameter.wire], 'input-invalid', endpoint, parameter.wire)
    if (parameter.source === 'json') return value
    const key = parameter.lookup
    /* v8 ignore next -- registry validation rejects strict descriptors without a key, and SRC derivation always supplies one. */
    if (key === undefined) {
      throw new TypertGatewayError(
        'lookup-unavailable',
        endpoint,
        `lookup parameter ${JSON.stringify(parameter.name)} has no provider key`,
        { field: parameter.wire },
      )
    }
    const provider = this.ctx.typert.lookups.get(key)
    if (provider === undefined) {
      throw new TypertGatewayError(
        'lookup-unavailable',
        endpoint,
        `lookup provider ${JSON.stringify(key)} is unavailable`,
        { field: parameter.wire },
      )
    }
    if (provider.wire !== parameter.wire
      || (parameter.codec.mode === 'strict' && provider.wireTypeSymbol !== parameter.codec.typeSymbol)) {
      throw new TypertGatewayError(
        'provider-mismatch',
        endpoint,
        `lookup provider ${JSON.stringify(key)} does not match its strict definition`,
        { field: parameter.wire },
      )
    }
    let resolved: unknown
    try {
      resolved = await provider.resolve(value)
    } catch (cause) {
      // 中文：lookup 策略失败保持原样上抛；其余异常映射为 lookup-failed。
      if (cause instanceof TypertLookupFailure) throw cause
      throw new TypertGatewayError(
        'lookup-failed',
        endpoint,
        `lookup provider ${JSON.stringify(key)} failed`,
        { cause, field: parameter.wire },
      )
    }
    if (resolved === undefined) {
      throw new TypertGatewayError(
        'lookup-not-found',
        endpoint,
        `lookup provider ${JSON.stringify(key)} did not resolve the requested identity`,
        { field: parameter.wire },
      )
    }
    return resolved
  }
}

// 中文：把 invoke 链路抛出的异常映射成 Connection 载体的错误信封：
// 调用已取消 → code 'cancelled'；lookup 策略失败 → 透传其失败体；
// 其余一律归为 'internal'，message 只取错误信息本身。
function rpcFailure(error: unknown): ConnectionRpcResult {
  if (error instanceof RemoteInvocationCancelled) {
    return {
      ok: false,
      error: { code: 'cancelled', message: error.message, details: {} },
    }
  }
  if (error instanceof TypertLookupFailure) {
    return { ok: false, error: error.failure as ConnectionRpcError }
  }
  return {
    ok: false,
    error: {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}

// 中文：把命名空间与方法名拼成规范端点标识 <namespace>/<method>。
function endpointOf(namespace: string, method: string): string {
  return `${namespace}/${method}`
}

// 中文：在调用前校验 Service 实例确实携带 typertRemote 绑定：先剥掉 Cordis
// 包装拿到原始对象，再检查绑定存在性，随后交给 readBinding 做一致性核对；
// 返回解析后的绑定与原始对象，供后续反射使用。
function validateBinding(
  receiver: object,
  serviceKey: string,
  namespace: string,
  endpoint: string,
): ResolvedBinding {
  const original = originalOf(receiver)
  const value = Reflect.get(original, 'typertRemote') as unknown
  if (value === undefined) {
    throw new TypertGatewayError(
      'binding-invalid',
      endpoint,
      `Service ${JSON.stringify(serviceKey)} has no visible typertRemote binding`,
    )
  }
  return {
    binding: readBinding(value, original, serviceKey, endpoint, namespace),
    original,
  }
}

// 中文：核对 typertRemote 绑定的内部一致性：service 必须指向原始对象、
// serviceKey 必须匹配、namespace 必须是字符串且（给出时）与期望一致；
// 任何一项不符都视为"绑定不一致"错误，防止拿到被篡改或过期的绑定。
function readBinding(
  value: unknown,
  original: object,
  serviceKey: string,
  endpoint: string,
  namespace?: string,
): TypertGatewayBinding {
  if (!isObject(value)
    || Reflect.get(value, 'service') !== original
    || Reflect.get(value, 'serviceKey') !== serviceKey
    || typeof Reflect.get(value, 'namespace') !== 'string'
    || (namespace !== undefined && Reflect.get(value, 'namespace') !== namespace)) {
    throw new TypertGatewayError(
      'binding-invalid',
      endpoint,
      `Service ${JSON.stringify(serviceKey)} has an inconsistent typertRemote binding`,
    )
  }
  return value as unknown as TypertGatewayBinding
}

// 中文：剥离 Cordis 的 Service 包装：若实例上有 symbols.original 标记则取
// 原始对象（否则业务对象就是它自己），保证反射看到的是用户代码本体。
function originalOf(receiver: object): object {
  const original = Reflect.get(receiver, symbols.original) as unknown
  return isObject(original) ? original : receiver
}

// 中文：通过反射读取 Service 原型链上某方法的形参名列表（SRC 描述符需要
// 参数名来推断 wire 名）。逐层沿原型链找方法实现，找到后把函数的源码文本
// 中括号内的参数列表拆成标识符；要求每个参数都是唯一合法标识符，否则按
// 签名无效处理（不允许解构、默认值、rest 等复杂形式）。
function methodParameterNames(service: object, method: string, endpoint: string): readonly string[] {
  let prototype: object | null = Object.getPrototypeOf(service) as object | null
  let implementation: ((this: object, ...args: never[]) => unknown) | undefined
  while (prototype !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method)
    if (descriptor !== undefined) {
      if ('value' in descriptor && typeof descriptor.value === 'function') {
        implementation = descriptor.value as (this: object, ...args: never[]) => unknown
      }
      break
    }
    prototype = Object.getPrototypeOf(prototype) as object | null
  }
  if (implementation === undefined) {
    throw new TypertGatewayError(
      'method-unavailable',
      endpoint,
      `Remote marker has no prototype method ${JSON.stringify(method)}`,
    )
  }
  const source = Function.prototype.toString.call(implementation) // 中文：拿到方法的源码字符串（含参数列表）
  const open = source.indexOf('(')
  const close = source.indexOf(')', open + 1)
  /* v8 ignore next -- standard public class-method syntax always contains a parenthesized parameter list. */
  if (open < 0 || close < 0) return invalidSignature(endpoint, method)
  const body = source.slice(open + 1, close).trim() // 中文：括号内的参数区文本
  if (body.length === 0) return []
  const parts = body.split(',').map(part => part.trim())
  const names = new Set<string>() // 中文：用于去重与后续顺序保留
  for (const part of parts) {
    if (!/^[$A-Z_a-z][$\w]*$/u.test(part) || names.has(part)) return invalidSignature(endpoint, method)
    names.add(part)
  }
  return [...names]
}

// 中文：SRC 方法签名不合法的统一报错出口（返回 never，简化调用处流程）：
// 参数必须是无重复的简单标识符，不能出现解构、默认值或 rest 参数。
function invalidSignature(endpoint: string, method: string): never {
  throw new TypertGatewayError(
    'signature-invalid',
    endpoint,
    `SRC method ${JSON.stringify(method)} must use unique identifier parameters without destructuring, defaults, or rest`,
  )
}

// 中文：校验请求 args 与描述符的字段集合精确匹配：既不允许多余字段，
// 也不允许缺少必需字段（json 参数在描述符声明可缺省或处于 SRC 宽松模式
// 时允许缺失；lookup 标识永远不可省略）。不匹配时报出 missing / unexpected
// 明细，供调用方修正。
function assertExactArguments(
  args: Readonly<Record<string, unknown>>,
  descriptor: InvocationDescriptor,
  endpoint: string,
): void {
  if (!isPlainObject(args)) {
    throw new TypertGatewayError('arguments-invalid', endpoint, 'args must be a plain object')
  }
  const expected = new Set(descriptor.parameters.map(parameter => parameter.wire))
  if (descriptor.invocation.kind === 'context') expected.add(descriptor.invocation.wire) // 中文：context 调用还要求身份字段
  const actual = Reflect.ownKeys(args)
  const extra = actual.filter(key => typeof key !== 'string' || !expected.has(key))
  // A JSON field may be omitted when the strict descriptor declares absence,
  // and always under SRC: a weak descriptor reads parameter names from the
  // JavaScript signature and cannot see which are optional, so LIB is where an
  // omitted required argument is caught. Lookup ids are never omissible.
  // 中文：json 字段在严格描述符声明可缺省时、以及 SRC 宽松模式下都允许
  // 省略（弱描述符看不到 JS 签名的可选择性，缺失的必填参数由 LIB 层负责
  // 捕获）；lookup 标识永不可省略。
  const acceptsMissing = new Set(descriptor.parameters
    .filter(parameter => parameter.source === 'json'
      && (parameter.acceptsUndefined === true || parameter.codec.mode === 'src-json'))
    .map(parameter => parameter.wire))
  const missing = [...expected].filter(key => !Object.hasOwn(args, key) && !acceptsMissing.has(key))
  if (extra.length === 0 && missing.length === 0) return
  const clauses: string[] = []
  if (missing.length > 0) clauses.push(`missing ${missing.map(key => JSON.stringify(key)).join(', ')}`)
  if (extra.length > 0) clauses.push(`unexpected ${extra.map(key => JSON.stringify(String(key))).join(', ')}`)
  throw new TypertGatewayError('arguments-invalid', endpoint, `args fields do not match the descriptor: ${clauses.join('; ')}`)
}

// 中文：统一的边界解码器（参数与结果共用）：严格编解码先过 schema.parse，
// 其余（含严格模式解析后的值）再过 assertJsonValue 的 JSON 安全断言；
// 任一步失败都包装成 TypertGatewayError，code 区分输入（input-invalid）
// 与输出（result-invalid），field 指明具体字段。
function decode(
  codec: TypertCodec,
  value: unknown,
  code: 'input-invalid' | 'result-invalid',
  endpoint: string,
  field: string,
): unknown {
  try {
    if (codec.mode === 'strict') {
      value = codec.schema.parse(value)
      if (value === undefined) return value
    }
    assertJsonValue(value, new Set())
    return value
  } catch (cause) {
    throw new TypertGatewayError(
      code,
      endpoint,
      code === 'input-invalid'
        ? `wire field ${JSON.stringify(field)} failed boundary validation`
        : 'business result failed boundary validation',
      { cause, field },
    )
  }
}

// 中文：递归断言一个值是"JSON 安全"的：只允许 null / string / boolean /
// 有限 number / 纯数组 / 普通对象；拒绝非有限数值、非普通对象、符号属性、
// 稀疏或带装饰的数组、循环引用等。ancestors 记录当前递归路径上的对象，
// 用于检测循环；递归结束后回退，保证同层兄弟之间互不误判。
function assertJsonValue(value: unknown, ancestors: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new TypeError('non-finite number is not JSON-safe')
  }
  if (!isObject(value)) throw new TypeError(`${typeof value} is not JSON-safe`)
  if (ancestors.has(value)) throw new TypeError('cyclic value is not JSON-safe')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(value).length !== value.length) {
        throw new TypeError('sparse or decorated array is not JSON-safe')
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError('sparse array is not JSON-safe')
        assertJsonValue(value[index], ancestors)
      }
      return
    }
    if (!isPlainObject(value)) throw new TypeError('non-plain object is not JSON-safe')
    if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('symbol property is not JSON-safe')
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      /* v8 ignore next -- ownKeys() just returned this key; only a hostile same-process Proxy can delete it between operations. */
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError('non-data property is not JSON-safe')
      }
      assertJsonValue(descriptor.value, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
}

// 中文：判断值是否为"普通对象"：不是数组，且原型为 null 或 Object.prototype
// （排除类实例、Map 等带特殊原型的对象）。
function isPlainObject(value: object): value is Record<string, unknown> {
  if (Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === null || prototype === Object.prototype
}

// 中文：判断值是否为"对象或函数"（排除 null），用于反射前的最低门槛检查。
function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

// 中文：默认导出网关服务类，供 Cordis 装配（import TypertGatewayService）
// 或插件系统直接使用。
export default TypertGatewayService
