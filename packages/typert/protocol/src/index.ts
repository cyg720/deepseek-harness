/**
 * ================================ 文件注释 ================================
 * 【文件职责】typert 协议包的运行时入口：提供 Remote 方法装饰器（@Remote / @RemoteScope）、
 *             显式的服务到网关绑定（bindTypertRemote / TypertRemoteService），以及
 *             全部协议类型的统一再导出。装饰器只往私有模块状态里记标记，不做严格反射。
 * 【技术维度】标准 TC39 装饰器（ClassMethodDecoratorContext + addInitializer），配合
 *             WeakMap<原型, Map<方法名, 标记>> 记录"哪个方法可以被远程调用"；
 *             服务基类继承 Cordis 的 Service。严格反射（类型图生成）属于 generator 的职责。
 * 【产品维度】业务开发者用 @Remote 把一个服务方法"变成"可跨进程调用的远程方法，
 *             再继承 TypertRemoteService 使服务自带网关导出绑定；网关据此发现并路由方法。
 * 【逻辑维度】按代码顺序：① 端点分段名校验（isTypertRemoteSegment 及正则）；
 *             ② TypertLookupFailure 错误类型（携带适配器专属失败载荷）；③ 协议类型
 *             批量再导出；④ 网关绑定（bindTypertRemote / TypertRemoteService）；
 *             ⑤ 装饰器（Remote / RemoteScope）与标记读取（remoteMethods）；
 *             ⑥ 私有辅助：登记标记（mark）、冲突检测（sameInvocation）、名称校验。
 * 【关键边界】只记录"直连 / 作用域化"两种调用形态的标记；方法必须是公开实例方法且名字
 *             必须是字符串（private / static / symbol 名会被拒绝）。端点分段名只允许
 *             `[A-Za-z0-9_$.-]` 且不能是 "." 或 ".."，否则无法安全跨 RPC 传输。
 *             标记表是模块级私有状态，不随服务实例序列化，也不会被外部篡改。
 * 【新手阅读建议】先看 ⑤ 的 @Remote 装饰器与 ④ 的 TypertRemoteService（日常使用入口），
 *             再读 ⑥ 的 mark / sameInvocation 理解冲突检测，最后看 ① 的正则与校验。
 * ==========================================================================
 */

/**
 * Remote decorators and explicit Gateway bindings backed only by private
 * module state. Strict reflection remains a Typert compiler responsibility.
 * @module @deepseek-ai/dsh-typert-protocol
 */
// 中文导读：本文件含少量运行时代码（装饰器与绑定），其余是从 types.ts 再导出的纯类型。

import { Service, type Context } from '@deepseek-ai/cordis'
import type { TypertContextMap } from './types.ts'

// 中文：RPC 端点分段名的合法字符集（字母、数字、下划线、$、点、连字符）。取值依据是
// 共享 RPC carrier 的端点语法；单独的 "." 与 ".." 被排除，因为它们会被当作路径语义。
const TYPERT_REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/**
 * Test one generated Remote name against the Connection endpoint grammar.
 * @param value - namespace, method, lookup, or Context segment.
 * @returns whether the value can cross the shared RPC carrier unchanged.
 */
// 中文：判断一个名字（命名空间 / 方法 / 查找 key / Context 分段）能否原样穿过共享 RPC
// carrier：既不能是 "." 或 ".."，整串也必须完全匹配上面的合法字符集。
export function isTypertRemoteSegment(value: string): boolean {
  return value !== '.' && value !== '..' && TYPERT_REMOTE_SEGMENT_PATTERN.test(value)
}

/**
 * A lookup policy rejection whose typed payload belongs to the active boundary adapter.
 * Gateway adapters preserve this payload instead of collapsing it into an infrastructure failure.
 */
// 中文：查找策略拒绝请求时抛出的专用错误。错误里携带的 typed payload 属于当前生效的
// 边界适配器；网关适配器会原样保留这个载荷，而不是把它压扁成笼统的基础设施故障。
export class TypertLookupFailure<Failure = unknown> extends Error {
  /** Adapter-owned failure returned to the caller. */
  // 中文：适配器持有的失败对象，原样返回给调用方。
  readonly failure: Failure

  /**
   * Wrap one adapter failure without exposing the rejected identity.
   * @param failure - typed failure owned by the active boundary adapter.
   */
  // 中文：包装一个适配器失败，同时刻意不暴露被拒绝的身份（避免向错误栈泄露内部 id）。
  constructor(failure: Failure) {
    super('Typert lookup policy rejected the requested identity')
    this.name = 'TypertLookupFailure'
    this.failure = failure
  }
}

// 中文：把 types.ts 里定义的协议类型整体再导出，外部只需 import 本包即可拿到全部类型；
// 这些类型只有类型层含义，编译后会被擦除，不产生运行时代码。
export type {
  InvocationDescriptor,
  InvocationParameterDescriptor,
  InvocationSourceLocation,
  RemoteFailure,
  RemoteResult,
  TypertClientRemote,
  TypertClientContextBinder,
  TypertCodec,
  TypertContext,
  TypertContextMap,
  TypertContextRegistry,
  TypertContextWire,
  TypertDisposer,
  TypertForwardableEvent,
  TypertHostContextProvider,
  TypertHostContextResolver,
  TypertLocalRegistry,
  TypertLookup,
  TypertLookupDefinition,
  TypertLookupHost,
  TypertLookupMap,
  TypertLookupProvider,
  TypertLookupResolver,
  TypertLookupRegistry,
  TypertLookupWire,
  TypertRemoteScopeApi,
  TypertRemoteScopeMap,
  TypertRemoteScopeNamespace,
  TypertRemoteContribution,
  TypertRemoteEvent,
  TypertRemoteEventSelection,
  TypertRemoteMap,
  TypertRemoteNamespace,
  TypertRemoteNamespaceMap,
  TypertRemoteRegistry,
  TypertRegistryChange,
  TypertRegistryListener,
  TypertSchema,
  TypertRegistryContract,
} from './types.ts'

/** Options for an explicit Service-to-Gateway binding. */
// 中文：显式"服务 → 网关"绑定的可选参数：目前只有 namespace，用来覆盖默认的线上命名空间
// （不填时直接用 Cordis 服务键作为命名空间）。
export interface TypertGatewayBindingOptions {
  /** Wire namespace; defaults to the Cordis service key. */
  // 中文：线上命名空间；缺省时默认等于 Cordis 服务键。
  readonly namespace?: string
}

/** Visible declaration that one Service participates in Typert Gateway export. */
// 中文：一个服务"参与 Typert 网关导出"的可见声明：记录服务实例、Cordis 服务键与线上
// 命名空间。网关做源码模式发现时读取这个字段。
export interface TypertGatewayBinding<Service extends object = object> {
  readonly service: Service
  readonly serviceKey: string
  readonly namespace: string
}

/** Invocation mode recorded by a Remote method decorator. */
// 中文：Remote 方法装饰器记录的调用形态：direct = 直接调用服务实例；
// context = 需要从某个作用域 Context 解析接收者（context 字段是 Context 种类 key）。
export type RemoteInvocationMarker =
  | { readonly kind: 'direct' }
  | { readonly kind: 'context'; readonly context: string }

/** One decorator marker discovered for a live Service instance. */
// 中文：在一个活的 Service 实例上发现的"单个装饰器标记"：方法名、可选的导出名
// （导出名与实现成员名不同时才存在）以及调用形态。
export interface RemoteMethodMarker {
  /** Public instance method carrying the implementation. */
  // 中文：承载实现的公开实例方法名。
  readonly method: string
  /** Endpoint method when it differs from the implementation member. */
  // 中文：线上端点方法名；与实现成员名不同时才存在（别名场景）。
  readonly exportName?: string
  readonly invocation: RemoteInvocationMarker
}

// 中文：内部类型——标准方法装饰器的函数签名：入参是被装饰方法与其装饰器上下文，返回 void
// （标记只记入私有状态，不替换方法本身）。
type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
) => void

// 中文：内部类型——装饰器上下文里与本包相关的最小子集：方法是否私有 / 静态、方法名，
// 以及 addInitializer（注册"实例初始化时执行"的回调，用于真正写入标记）。
interface RemoteInitializerContext<This extends object> {
  readonly private: boolean
  readonly static: boolean
  readonly name: string | symbol
  addInitializer(initializer: (this: This) => void): void
}

// 中文：内部类型——实际存进 WeakMap 的标记形态：导出名可选 + 冻结的调用形态。
interface StoredRemoteMethodMarker {
  readonly exportName?: string
  readonly invocation: RemoteInvocationMarker
}

// 中文：模块级私有标记表：以"类原型对象"为键、方法名为键值，记录每个原型上哪些方法被
// 装饰器标记为可远程调用。用 WeakMap 使原型被回收时表项自动释放，避免内存泄漏。
const markers = new WeakMap<object, Map<string, StoredRemoteMethodMarker>>()

/**
 * Bind one visible Service field to a Cordis key and Remote namespace.
 * @param service - owning Service instance, normally `this`.
 * @param serviceKey - exact Cordis service key.
 * @param options - optional distinct wire namespace.
 * @returns a frozen, inspectable binding with no compiler-injected metadata.
 */
// 中文：把服务实例绑定到 Cordis 键与线上命名空间，返回一个冻结、可检查的绑定对象
// （不携带任何编译器注入的元数据）。serviceKey 与 namespace 都会先做端点分段名校验。
export function bindTypertRemote<Service extends object>(
  service: Service,
  serviceKey: string,
  options: TypertGatewayBindingOptions = {},
): TypertGatewayBinding<Service> {
  validateName('service key', serviceKey)
  // 中文：命名空间缺省时直接复用服务键，保证零配置也能导出。
  const namespace = options.namespace ?? serviceKey
  validateName('namespace', namespace)
  return Object.freeze({ service, serviceKey, namespace })
}

/** Cordis Service base that exposes its registered name through Typert Gateway. */
// 中文：Cordis Service 的 typert 版基类：构造时自动完成"注册服务 + 绑定同名网关导出"，
// 业务服务继承它即可获得自描述能力（this.typertRemote 供网关发现）。
export abstract class TypertRemoteService<out T = never> extends Service<T> {
  /** Visible binding consumed by the Gateway's source-mode discovery. */
  // 中文：可见绑定，网关源码模式发现时读取；指向本实例、注册用的服务键与线上命名空间。
  readonly typertRemote: TypertGatewayBinding<this>

  /**
   * Register the Service and bind the same key to Typert Gateway.
   * @param ctx - owning Cordis Context.
   * @param serviceKey - exact Cordis service key and default wire namespace.
   * @param options - optional distinct wire namespace.
   */
  // 中文：注册服务，并以同一个键绑定到 Typert 网关（命名空间可单独覆盖）。
  // this.name 是 Service 基类里"本实例注册时所用的服务名"，与 serviceKey 一致。
  protected constructor(ctx: Context, serviceKey: string, options: TypertGatewayBindingOptions = {}) {
    super(ctx, serviceKey)
    this.typertRemote = bindTypertRemote(this, this.name, options)
  }
}

/**
 * Mark one public instance method as a direct Remote invocation.
 * @param _method - decorated method; retained only by the class itself.
 * @param context - standard decorator context used to schedule private marking.
 */
// 中文：把"一个公开实例方法"标记为直连远程调用（@Remote 的无参用法），例如：
// @Remote() 或 @Remote 装饰在方法上，网关即可发现并直接调用它。
export function Remote<This extends object, Args extends unknown[], Result>(
  _method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void
/**
 * Mark one public instance method under a distinct exported method name.
 * @param exportName - Remote endpoint method, without a namespace or slash.
 * @returns a standard method decorator.
 */
// 中文：把方法标记为远程调用，并给它一个与实现名不同的线上导出名（@Remote('别名') 用法）。
export function Remote(exportName: string): RemoteMethodDecorator
// 中文：实现体根据第一个参数类型分流：字符串 = 带别名用法（返回装饰器工厂）；
// 函数 = 无参用法（此时 context 必须存在，否则说明装饰器被当作普通函数误用，抛 TypeError）。
export function Remote<This extends object, Args extends unknown[], Result>(
  methodOrExportName: string | ((this: This, ...args: Args) => Result),
  context?: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void | RemoteMethodDecorator {
  if (typeof methodOrExportName === 'string') {
    validateName('Remote export name', methodOrExportName)
    return function <DecoratorThis extends object, DecoratorArgs extends unknown[], DecoratorResult>(
      _method: (this: DecoratorThis, ...args: DecoratorArgs) => DecoratorResult,
      decoratorContext: ClassMethodDecoratorContext<
        DecoratorThis,
        (this: DecoratorThis, ...args: DecoratorArgs) => DecoratorResult
      >,
    ): void {
      addMarkerInitializer(decoratorContext, { kind: 'direct' }, methodOrExportName)
    }
  }
  if (context === undefined) throw new TypeError('typert-protocol: Remote decorator context is missing')
  addMarkerInitializer(context, { kind: 'direct' })
}

/**
 * Create a decorator for a method resolved from one Remote Scope.
 * @param key - scope key declared through the Context map.
 * @param exportName - optional Remote export name; defaults to the method name.
 * @returns a standard method decorator that records only private module state.
 */
// 中文：生成"作用域化远程调用"装饰器：方法被调用时，接收者从某个 Remote Scope 解析
// （key 必须在 TypertContextMap 里声明过）。用法示例：@RemoteScope('用户会话')。
export function RemoteScope(
  key: Extract<keyof TypertContextMap, string>,
  exportName?: string,
): RemoteMethodDecorator {
  validateName('Scope key', key)
  if (exportName !== undefined) validateName('Remote export name', exportName)
  return function <This extends object, Args extends unknown[], Result>(
    _method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): void {
    addMarkerInitializer(context, { kind: 'context', context: key }, exportName)
  }
}

/**
 * Read Remote markers attached to a live Service by decorator initializers.
 * The returned snapshot cannot mutate the private marker table.
 * @param service - live Service instance.
 * @returns markers in class declaration order.
 */
// 中文：读取某个活 Service 实例上、由装饰器初始化器写入的远程方法标记快照。
// 返回的数组是新的（快照），修改它不会影响私有标记表。网关发现远程方法时调用它。
export function remoteMethods(service: object): readonly RemoteMethodMarker[] {
  // 中文：标记以"类原型对象"为键登记，因此从实例取原型再去查表；原型为 null 时无标记可读。
  const prototype = Object.getPrototypeOf(service) as object | null
  if (prototype === null) return []
  return [...(markers.get(prototype) ?? [])].map(([method, marker]) => ({ method, ...marker }))
}

// 中文：装饰器标记的公共写入路径：校验装饰目标合法（公开实例方法、字符串名）后，
// 把真正写表的动作延后到"实例初始化时"执行（通过 addInitializer 注册）。
function addMarkerInitializer<This extends object>(
  context: RemoteInitializerContext<This>,
  invocation: RemoteInvocationMarker,
  exportName?: string,
): void {
  if (context.private || context.static || typeof context.name !== 'string') {
    throw new TypeError('typert-protocol: Remote decorators require a public instance method with a string name')
  }
  const method = context.name
  context.addInitializer(function (this: This) {
    const prototype = Object.getPrototypeOf(this) as object | null
    if (prototype === null) {
      throw new TypeError(`typert-protocol: cannot mark Remote method "${method}" on an object without a prototype`)
    }
    mark(prototype, method, invocation, exportName)
  })
}

// 中文：向某个原型的标记表写入一条记录；同名方法被重复标记时，若标记完全相同则幂等跳过，
// 否则抛冲突错误，避免一个方法被声明成两种互相矛盾的调用形态。
function mark(
  prototype: object,
  method: string,
  invocation: RemoteInvocationMarker,
  exportName?: string,
): void {
  let table = markers.get(prototype)
  if (table === undefined) {
    table = new Map()
    markers.set(prototype, table)
  }
  const marker: StoredRemoteMethodMarker = {
    ...(exportName === undefined || exportName === method ? {} : { exportName }),
    invocation: Object.freeze(invocation),
  }
  const current = table.get(method)
  if (current !== undefined) {
    if (current.exportName === marker.exportName && sameInvocation(current.invocation, invocation)) return
    throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`)
  }
  table.set(method, Object.freeze(marker))
}

// 中文：比较两次标记的调用形态是否一致：直连就是直连；作用域化则要求 context key 也相同。
function sameInvocation(left: RemoteInvocationMarker, right: RemoteInvocationMarker): boolean {
  return left.kind === right.kind
    && (left.kind === 'direct' || (right.kind === 'context' && left.context === right.context))
}

// 中文：校验某个名字是合法的 RPC 端点分段，否则抛 TypeError；subject 用于拼出清晰的报错文案。
function validateName(subject: string, value: string): void {
  if (!isTypertRemoteSegment(value)) {
    throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`)
  }
}
