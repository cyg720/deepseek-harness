/**
 * Remote decorators and explicit Gateway bindings backed by versioned
 * descriptors carried on decorated class prototypes. Strict reflection
 * remains a Typert compiler responsibility.
 * @module @deepseek-ai/dsh-typert-protocol
 */

/*
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

import { Service, type Context } from '@deepseek-ai/cordis'
import type { TypertContextMap } from './types.ts'

export { RemoteError, remoteErrorOf } from './remote-error.ts'

const TYPERT_REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/**
 * Test one generated Remote name against the Connection endpoint grammar.
 * @param value - namespace, method, lookup, or Context segment.
 * @returns whether the value can cross the shared RPC carrier unchanged.
 */
export function isTypertRemoteSegment(value: string): boolean {
  return value !== '.' && value !== '..' && TYPERT_REMOTE_SEGMENT_PATTERN.test(value)
}

export type {
  InvocationDescriptor,
  InvocationParameterDescriptor,
  InvocationSourceLocation,
  RemoteErrorCode,
  RemoteErrorDetailsMap,
  RemoteFailure,
  RemoteResult,
  TypertClientEventListener,
  TypertClientRemote,
  TypertClientContextAdapter,
  TypertCodec,
  TypertContext,
  TypertContextAdapter,
  TypertContextMap,
  TypertContextRegistry,
  TypertContextWire,
  TypertDisposer,
  TypertForwardableEvent,
  TypertForwardableEventEntry,
  TypertHostContextAdapter,
  TypertHostContextIdentity,
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
export interface TypertGatewayBindingOptions {
  /** Wire namespace; defaults to the Cordis service key. */
  readonly namespace?: string
}

/** Visible declaration that one Service participates in Typert Gateway export. */
export interface TypertGatewayBinding<Service extends object = object> {
  readonly service: Service
  readonly serviceKey: string
  readonly namespace: string
}

/** Invocation mode recorded by a Remote method decorator. */
export type RemoteInvocationMarker =
  | { readonly kind: 'direct' }
  | { readonly kind: 'context'; readonly context: string }

/** One decorator marker discovered for a live Service instance. */
export interface RemoteMethodMarker {
  /** Public instance method carrying the implementation. */
  readonly method: string
  /** Endpoint method when it differs from the implementation member. */
  readonly exportName?: string
  /** Stream methods yield many independently validated result items. */
  readonly mode?: 'stream'
  readonly invocation: RemoteInvocationMarker
}

/** Options for a non-unary Remote method. */
export interface RemoteMethodOptions {
  /** Deliver each Iterable item over the shared logical-stream carrier. */
  readonly mode: 'stream'
}

type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
) => void

interface RemoteInitializerContext<This extends object> {
  readonly private: boolean
  readonly static: boolean
  readonly name: string | symbol
  addInitializer(initializer: (this: This) => void): void
}

interface StoredRemoteMethodMarker {
  readonly exportName?: string
  readonly mode?: 'stream'
  readonly invocation: RemoteInvocationMarker
}

interface StoredRemoteMethod extends StoredRemoteMethodMarker {
  readonly method: string
}

interface RemoteMethodDescriptorV1 {
  readonly version: 1
  readonly methods: readonly StoredRemoteMethod[]
}

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/**
 * Bind one visible Service field to a Cordis key and Remote namespace.
 * @param service - owning Service instance, normally `this`.
 * @param serviceKey - exact Cordis service key.
 * @param options - optional distinct wire namespace.
 * @returns a frozen, inspectable binding with no compiler-injected metadata.
 */
export function bindTypertRemote<Service extends object>(
  service: Service,
  serviceKey: string,
  options: TypertGatewayBindingOptions = {},
): TypertGatewayBinding<Service> {
  validateName('service key', serviceKey)
  const namespace = options.namespace ?? serviceKey
  validateName('namespace', namespace)
  return Object.freeze({ service, serviceKey, namespace })
}

/** Cordis Service base that exposes its registered name through Typert Gateway. */
export abstract class TypertRemoteService<out T = never> extends Service<T> {
  /** Visible binding consumed by the Gateway's source-mode discovery. */
  readonly typertRemote: TypertGatewayBinding<this>

  /**
   * Register the Service and bind the same key to Typert Gateway.
   * @param ctx - owning Cordis Context.
   * @param serviceKey - exact Cordis service key and default wire namespace.
   * @param options - optional distinct wire namespace.
   */
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
export function Remote<This extends object, Args extends unknown[], Result>(
  _method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void
/**
 * Mark one public instance method under an exported name or as a logical stream.
 * @param option - endpoint method name or stream delivery mode.
 * @returns a standard method decorator.
 */
export function Remote(option: string | RemoteMethodOptions): RemoteMethodDecorator
export function Remote<This extends object, Args extends unknown[], Result>(
  methodExportOrOptions: string | RemoteMethodOptions | ((this: This, ...args: Args) => Result),
  context?: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void | RemoteMethodDecorator {
  if (typeof methodExportOrOptions === 'string') {
    validateName('Remote export name', methodExportOrOptions)
    return remoteDecorator({ kind: 'direct' }, undefined, methodExportOrOptions)
  }
  if (typeof methodExportOrOptions === 'object') {
    if (remoteOptionMode(methodExportOrOptions) !== 'stream'
      || Reflect.ownKeys(methodExportOrOptions).length !== 1) {
      throw new TypeError('typert-protocol: Remote options must contain exactly mode: "stream"')
    }
    return remoteDecorator({ kind: 'direct' }, 'stream')
  }
  if (context === undefined) throw new TypeError('typert-protocol: Remote decorator context is missing')
  addMarkerInitializer(context, { kind: 'direct' })
}

function remoteOptionMode(options: object): unknown {
  return Reflect.get(options, 'mode') as unknown
}

function remoteDecorator(
  invocation: RemoteInvocationMarker,
  mode?: 'stream',
  exportName?: string,
): RemoteMethodDecorator {
  return function <This extends object, Args extends unknown[], Result>(
    _method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): void {
    addMarkerInitializer(context, invocation, mode, exportName)
  }
}

/**
 * Create a decorator for a method resolved from one Remote Scope.
 * @param key - scope key declared through the Context map.
 * @param exportName - optional Remote export name; defaults to the method name.
 * @returns a standard method decorator that records a versioned prototype descriptor.
 */
export function RemoteScope(
  key: Extract<keyof TypertContextMap, string>,
  exportName?: string,
): RemoteMethodDecorator {
  validateName('Scope key', key)
  if (exportName !== undefined) validateName('Remote export name', exportName)
  return remoteDecorator({ kind: 'context', context: key }, undefined, exportName)
}

/**
 * Read Remote markers attached to a live Service's class prototype.
 * The returned snapshot cannot mutate the stored descriptor.
 * @param service - live Service instance.
 * @returns markers in class declaration order.
 */
export function remoteMethods(service: object): readonly RemoteMethodMarker[] {
  const prototype = Object.getPrototypeOf(service) as object | null
  if (prototype === null) return []
  return (readRemoteMethodDescriptor(prototype)?.methods ?? []).map(marker => ({ ...marker }))
}

function readRemoteMethodDescriptor(prototype: object): RemoteMethodDescriptorV1 | undefined {
  const property = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR)
  if (property === undefined) return undefined
  const descriptor: unknown = property.value
  if (descriptor === null || typeof descriptor !== 'object') {
    throw new TypeError('typert-protocol: Remote method descriptor must be an object')
  }
  const version: unknown = Reflect.get(descriptor, 'version')
  if (version !== 1) {
    throw new TypeError(`typert-protocol: unsupported Remote method descriptor version ${String(version)}`)
  }
  const methods: unknown = Reflect.get(descriptor, 'methods')
  if (!Array.isArray(methods)) {
    throw new TypeError('typert-protocol: Remote method descriptor methods must be an array')
  }
  return descriptor as RemoteMethodDescriptorV1
}

function addMarkerInitializer<This extends object>(
  context: RemoteInitializerContext<This>,
  invocation: RemoteInvocationMarker,
  mode?: 'stream',
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
    mark(prototype, method, invocation, mode, exportName)
  })
}

function mark(
  prototype: object,
  method: string,
  invocation: RemoteInvocationMarker,
  mode?: 'stream',
  exportName?: string,
): void {
  const descriptor = readRemoteMethodDescriptor(prototype)
  const marker: StoredRemoteMethod = Object.freeze({
    method,
    ...(exportName === undefined || exportName === method ? {} : { exportName }),
    ...(mode === undefined ? {} : { mode }),
    invocation: Object.freeze(invocation),
  })
  const current = descriptor?.methods.find(candidate => candidate.method === method)
  if (current !== undefined) {
    if (current.exportName === marker.exportName
      && current.mode === marker.mode
      && sameInvocation(current.invocation, invocation)) return
    throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`)
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([...(descriptor?.methods ?? []), marker]),
    } satisfies RemoteMethodDescriptorV1),
  })
}

function sameInvocation(left: RemoteInvocationMarker, right: RemoteInvocationMarker): boolean {
  if (left.kind === 'direct') return right.kind === 'direct'
  if (right.kind === 'direct') return false
  return left.context === right.context
}

function validateName(subject: string, value: string): void {
  if (!isTypertRemoteSegment(value)) {
    throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`)
  }
}
