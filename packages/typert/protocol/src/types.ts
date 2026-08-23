/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义 typert 协议层的全部核心数据结构：Host 对象与线格式（wire）标识的
 *             类型级关联、远程调用描述（InvocationDescriptor）、运行时各注册中心的
 *             接口契约。业务包、generator 生成的 Remote 产物、Host 网关与 Client
 *             实现共同依赖本文件，它是跨进程通信的"契约层"。
 * 【技术维度】几乎全部是 TypeScript 类型层面声明（interface / type / unique symbol）。
 *             用 unique symbol 做幻影类型（phantom type）品牌字段，用声明合并
 *             （declaration merging）提供可扩展映射表；大量使用条件类型与模板字符串
 *             类型在编译期做模式匹配（如从端点字符串拆出命名空间）。
 * 【产品维度】一端是暴露方法的 Host 服务，另一端是调用方法的 Client 消费者，双方不共享
 *             运行时代码，只要共同遵守这里的描述结构即可远程通信，是类型安全的 RPC 契约。
 * 【逻辑维度】按代码顺序：① 品牌类型与提取类型（TypertLookup / TypertContext 等）；
 *             ② 可合并映射表（LookupMap / ContextMap / RemoteMap / RemoteScopeMap）；
 *             ③ 失败与结果信封（RemoteFailure / RemoteResult）；④ 单个调用完整描述
 *             （InvocationDescriptor 及其子结构）；⑤ 客户端能力接口
 *             （TypertClientRemote 的 $mount / $on / $dispatch）；⑥ 四类运行时注册中心
 *             接口（本地 / 远程 / 查找 / 上下文）；⑦ 模块扩充把 typert 挂到 Cordis Context。
 * 【关键边界】本文件只描述结构、不含实现；RemoteFailure.code 故意用开放 string 而非封闭
 *             联合类型，避免反向依赖 carrier 包。unique symbol 与 readonly 防止外部
 *             伪造标识或篡改契约；解析不到的标识一律用 undefined 表达。
 * 【新手阅读建议】先读 ④ 的 InvocationDescriptor（一次远程调用长什么样），再看 ① 品牌类型
 *             与 ③ 结果信封，最后浏览 ⑥ 注册中心接口（由 registry 包实现，generator
 *             生成的代码消费它们）。
 * ==========================================================================
 */

/**
 * Compiler-independent Typert protocol shared by business packages, generated
 * Remote artifacts, the Host Gateway, and Client API implementations.
 * @module @deepseek-ai/dsh-typert-protocol/types
 */
// 中文导读：下面所有声明都是"纯类型"，运行时不存在对应对象；真正干活的是 generator
// （按这些结构生成代码）、loader（重建类型图）与 registry（登记对象 ↔ 标识）。

import type { Context, Events } from '@deepseek-ai/cordis'

// 中文：三个 unique symbol 是幻影类型（phantom type）标记，只存在于类型层面、不参与运行。
// 它们分别给 Host 对象、线格式标识、Context 标识打上互不相同的品牌，让同名类型参数不会混用。
declare const LOOKUP_HOST: unique symbol
declare const LOOKUP_WIRE: unique symbol
declare const CONTEXT_WIRE: unique symbol

/** Type-level association between a Host object and its wire identity. */
// 中文：把"宿主进程内的对象"与其"跨进程传输用的线格式标识"在类型层面绑定为一对，
// 例如文件句柄对象 ↔ 它的字符串 id。Host / Wire 只是类型占位，不产生任何运行时值。
export interface TypertLookup<Host, Wire> {
  readonly [LOOKUP_HOST]: Host
  readonly [LOOKUP_WIRE]: Wire
}

/** Extract the Host object associated with one lookup declaration. */
// 中文：从 TypertLookup<Host, Wire> 里取出 Host 那个类型参数（条件类型 + infer 推导），
// 供 generator 生成代码与 registry 登记时使用，避免在多个地方手写同样的泛型提取。
export type TypertLookupHost<Lookup> = Lookup extends TypertLookup<infer Host, infer _Wire> ? Host : never

/** Extract the wire identity associated with one lookup declaration. */
// 中文：与 TypertLookupHost 对称：取出线格式标识类型参数 Wire。
export type TypertLookupWire<Lookup> = Lookup extends TypertLookup<infer _Host, infer Wire> ? Wire : never

/** Type-level association between a scoped Context kind and its wire identity. */
// 中文：与 TypertLookup 同套路，但绑定的对象是"作用域化 Context"——按调用上下文区分
// 身份的服务，例如把"当前用户的会话 Context"与"会话 id"在类型层面绑定。
export interface TypertContext<Wire> {
  readonly [CONTEXT_WIRE]: Wire
}

/** Extract the wire identity associated with one scoped Context declaration. */
// 中文：从 TypertContext<Wire> 里取出 Wire 类型参数，是 TypertContextWire 的提取工具。
export type TypertContextWire<ContextType> = ContextType extends TypertContext<infer Wire> ? Wire : never

/** Merge-extensible Host object lookup declarations. */
// 中文：可扩展的查找声明映射表：业务包通过声明合并（interface 合并）往里添加条目，
// 每加一个 key 就多一种"对象 ↔ 线格式 id"的查找关系；generator 生成的代码也向这里补充。
export interface TypertLookupMap {}

/** Merge-extensible scoped Context declarations. */
// 中文：可扩展的作用域 Context 声明表：声明"有哪些作用域化 Context 种类"，键是种类名。
export interface TypertContextMap {}

/** Merge-extensible direct Remote method signatures generated for consumers. */
// 中文：可扩展的"直连 Remote 方法签名"映射表：generator 为每个导出的远程方法在此
// 生成 `<namespace>/<method>: 签名` 条目，消费端据此获得类型安全的调用入口。
export interface TypertRemoteMap {}

/**
 * One Remote call's failure as the carrier reported it. `code` stays open here:
 * the closed RPC code union belongs to the carrier package, which already
 * depends on this one, so naming it would invert that edge.
 */
// 中文：一次远程调用的失败结果（由承载 RPC 传输的 carrier 包上报）。code 故意用开放的
// string 而不是封闭联合类型：封闭的 RPC 错误码集合属于 carrier 包，若在这里定义会形成
// protocol 反向依赖 carrier 的依赖环。message 给人读，details 给程序做结构化处理。
export interface RemoteFailure {
  readonly code: string
  readonly message: string
  readonly details: object
}

/**
 * What every generated Remote method resolves to. The Remote face itself folds
 * carrier failures into the error branch, so no consumer wraps a call to
 * recover one; only assembly faults (arity, an unmounted method, a missing
 * Context binder) still reject.
 * @template T - the Host method's business result.
 */
// 中文：所有生成的 Remote 方法统一返回的"结果信封"：成功时 ok: true 携带业务值，
// 失败时 ok: false 携带 RemoteFailure。消费方只需判断 ok 字段，不必自己捕获 carrier 异常
// ——Remote 面已把 carrier 失败折叠进错误分支；只有装配错误（参数数量不对、方法未挂载、
// 缺少 Context 绑定器）才会以 Promise 拒绝的方式抛出。
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailure }

/** Merge-extensible scoped Remote method signatures generated for consumers. */
// 中文：与 TypertRemoteMap 对称的"作用域化 Remote 方法签名"表：键形如
// `ContextKey:Namespace/方法`，供按调用上下文区分的远程调用使用。
export interface TypertRemoteScopeMap {}

/**
 * Cordis event names whose shape a one-way Remote delivery can carry: unbound
 * from any Scope and returning `void`. Which ones are actually forwarded is the
 * Host assembly's selection; this predicate only excludes shapes the carrier
 * cannot represent.
 */
// 中文：筛选出"可以被单向远程转发"的 Cordis 事件名集合：用条件类型遍历 Events 映射表，
// 只保留『this 类型为 unknown（不绑定具体作用域）且返回 void』的事件。具体转发哪些由
// Host 装配方决定，这里只是排除 carrier 无法表达的事件形态。
export type TypertForwardableEvent = {
  [Event in keyof Events]: unknown extends ThisParameterType<Events[Event]>
    ? ReturnType<Events[Event]> extends void ? Event : never
    : never
}[keyof Events]

/** Merge-extensible forwarding selection declared once by the Host assembly. */
// 中文：可扩展的转发选择声明表：Host 装配方在这里声明一次"要转发哪些事件"，
// 消费端才能用 $on 订阅到对应事件。
export interface TypertRemoteEventSelection {}

/** Legal `$on` keys: selected events that exist in the current compilation face. */
// 中文：$on 允许订阅的事件名 = 「已声明转发」与「当前编译面中真实存在」两个集合的交集。
export type TypertRemoteEvent = Extract<keyof Events, keyof TypertRemoteEventSelection>

/**
 * Resolve one direct Remote namespace from the generated flat endpoint map.
 * @template Namespace - wire namespace before the endpoint slash.
 */
// 中文：从扁平的端点映射表 TypertRemoteMap 中，按 `Namespace/方法` 前缀拆分，组装出一个
// 按方法名分组、可直接调用的命名空间对象（用模板字符串类型在编译期做模式匹配）。
export type TypertRemoteNamespace<Namespace extends string> = {
  [Endpoint in keyof TypertRemoteMap as Endpoint extends `${Namespace}/${infer Method}`
    ? Method
    : never]: TypertRemoteMap[Endpoint]
}

/**
 * Resolve one scoped Remote namespace across every generated Context kind.
 * The calling Cordis Context supplies the concrete identity at runtime.
 * @template Namespace - wire namespace between the Context prefix and method.
 */
// 中文：作用域化的命名空间版本：从 TypertRemoteScopeMap 中按 `ContextKey:Namespace/方法`
// 拆分出某个命名空间；具体身份（哪个 Context）由调用时的 Cordis Context 在运行时提供。
export type TypertRemoteScopeNamespace<
  Namespace extends string,
  ContextKey extends string = string,
> = {
  [Endpoint in keyof TypertRemoteScopeMap as Endpoint extends `${ContextKey}:${Namespace}/${infer Method}`
    ? Method
    : never]: TypertRemoteScopeMap[Endpoint]
}

// 中文：内部辅助类型——从 `ContextKey:Namespace/方法` 形式的端点字符串里抽出命名空间段。
type TypertRemoteScopeNamespaceKey<
  ContextKey extends string,
  Endpoint = keyof TypertRemoteScopeMap,
> = Endpoint extends `${ContextKey}:${infer Namespace}/${string}` ? Namespace : never

/** Generated scoped Remote namespaces available to one Context kind. */
// 中文：为某个 ContextKey 聚合出它名下全部作用域化命名空间，组装成可调用的 Api 集合，
// 供该 Context 种类对应的消费代码使用。
export type TypertRemoteScopeApi<ContextKey extends string> = {
  [Namespace in TypertRemoteScopeNamespaceKey<ContextKey>]:
  TypertRemoteScopeNamespace<Namespace, ContextKey>
}

/** Merge-extensible direct namespace surface generated for Client Remote services. */
// 中文：可扩展的直连命名空间面：generator 为 Client 侧 Remote 服务生成命名空间对象时
// 向这里补充条目，使 TypertClientRemote 拥有各命名空间的方法。
export interface TypertRemoteNamespaceMap {}

/** Awaitable disposer returned by Cordis-owned Typert registrations. */
// 中文：统一的"撤销函数"类型：Cordis 生态里注册资源后都会返回一个可 await 的 disposer，
// 调用它即可精确撤销本次注册（例如卸载一个 Remote 贡献或取消一次订阅）。
export type TypertDisposer = () => Promise<void>

// 中文：内部辅助类型——取一个对象的键中属于 string 的那部分（排除 number / symbol 键）。
type StringKeyOf<Value> = Extract<keyof Value, string>

/** Minimal runtime-schema capability carried by strict generated codecs. */
// 中文：运行时"模式校验"能力的最小接口：strict 模式生成的编解码器带一个 schema，
// 在进程边界（如消息进来时）调用 parse 校验并转换值，保证进入业务代码的数据可信。
export interface TypertSchema<Output = unknown> {
  /**
   * Parse and validate one boundary value.
   * @param value - untrusted boundary value.
   * @returns the validated value.
   */
  // 中文：校验并转换一个不可信的边界值，返回通过校验后的值。
  parse(value: unknown): Output
}

/** Codec attached to one invocation parameter or result. */
// 中文：挂在某个调用参数或返回值上的编解码器描述，二选一：
// strict = 携带类型符号与 schema 的严格校验模式；src-json = 源码直通 JSON，不做额外校验。
export type TypertCodec =
  | {
    // 中文：严格模式：跨边界先 parse 再放行。
    readonly mode: 'strict'
    // 中文：规范类型符号（供严格生成与诊断引用）。
    readonly typeSymbol: string
    // 中文：实际执行校验与转换的 schema。
    readonly schema: TypertSchema
  }
  | {
    // 中文：源码直通 JSON：值本来就是 JSON 兼容数据，无需校验。
    readonly mode: 'src-json'
  }

/** One ordered business parameter in a Remote invocation. */
// 中文：一次远程调用里"一个按顺序排列的业务参数"的完整描述，包含名字、线上键、
// 值来源（JSON 或查找）、边界编解码器等信息，是生成客户端调用代码的最小单元。
export interface InvocationParameterDescriptor {
  /** Source-level parameter name. */
  // 中文：参数在源文件里的名字（供诊断与生成代码引用）。
  readonly name: string
  /** Required key in the wire `args` object. */
  // 中文：该参数在线上传输时 args 对象里的键名（可能与源码名不同，见 wire 映射）。
  readonly wire: string
  /** Whether the value is JSON or requires a registered Host lookup. */
  // 中文：值来源：json = 直接 JSON 传输；lookup = 只传一个 id，由注册中心还原成 Host 对象。
  readonly source: 'json' | 'lookup'
  /** Lookup key when `source` is `lookup`. */
  // 中文：source 为 lookup 时，指向查找注册表（TypertLookupMap）里对应声明的 key。
  readonly lookup?: string
  /** Boundary codec for the wire representation. */
  // 中文：边界编解码器：值进出进程边界时如何校验 / 转换。
  readonly codec: TypertCodec
  /** Missing wire fields decode to `undefined` only for an explicitly declared `T | undefined`. */
  // 中文：只有参数显式声明为 `T | undefined` 时才允许线上缺省，此时缺省解码为 undefined。
  readonly acceptsUndefined?: true
}

/** Source position retained for diagnostics from generated definitions. */
// 中文：源文件位置（文件、行、列），仅在生成的定义里保留用于诊断，例如报错时定位到声明处。
export interface InvocationSourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

/** Carrier-independent description of one exported method invocation. */
// 中文：一个导出方法调用的"载体无关"完整描述：id 全局稳定，service 指明所属 Cordis 服务，
// namespace/method 组成线上端点，invocation 说明接收者选择方式，parameters/result 描述
// 参数与返回值的编解码。generator 生成它，registry 登记它，网关据它路由。
export interface InvocationDescriptor {
  /** Globally stable generated identity. */
  // 中文：生成的全局稳定标识，用于跨进程唯一引用这个调用描述。
  readonly id: string
  /** Cordis service key owning the method. */
  // 中文：拥有该方法的 Cordis 服务键。
  readonly service: string
  /** Wire namespace, defaulting to the service key. */
  // 中文：线上命名空间，缺省等于 service key。
  readonly namespace: string
  /** Public instance method name. */
  // 中文：公开实例方法名，即消费端实际调用的方法名。
  readonly method: string
  /** Service member invoked when the exported method name is an alias. */
  // 中文：当导出的方法名是别名时，记录真正承载实现的成员名。
  readonly implementation?: string
  /** Receiver selection mode. */
  // 中文：接收者选择方式：direct = 直接调用服务实例；context = 先从调用上下文解析出具体对象。
  readonly invocation:
    | { readonly kind: 'direct' }
    | {
      readonly kind: 'context'
      // 中文：Context 种类标识（声明在 TypertContextMap 里的 key）。
      readonly context: string
      // 中文：承载 Context 身份的线上字段名。
      readonly wire: string
      // 中文：Context 身份值的边界编解码器。
      readonly codec: TypertCodec
    }
  /** Optional consuming-Context projection for one direct lookup parameter. */
  // 中文：可选的作用域投影：把某一个 lookup 参数替换成调用方 Context 提供的身份，
  // 这样调用方不必显式传 id，系统从调用上下文自动带入。
  readonly scope?: {
    /** Context kind whose Client binder supplies the identity. */
    // 中文：提供身份的 Context 种类（由 Client 侧 binder 负责解析）。
    readonly context: string
    /** Lookup parameter wire field replaced by the Context identity. */
    // 中文：被替换掉的 lookup 参数的线上字段名。
    readonly wire: string
  }
  /** Ordered business parameters. */
  // 中文：按顺序排列的业务参数描述列表。
  readonly parameters: readonly InvocationParameterDescriptor[]
  /** Transport cancellation injected after business parameters instead of entering wire args. */
  // 中文：传输层取消信号：作为保留的最后一个宿主方法参数注入，不进入线上 args。
  readonly cancellation?: {
    /** Reserved final Host method parameter. */
    // 中文：保留参数名固定为 signal。
    readonly parameter: 'signal'
  }
  /** Codec for the resolved method result. */
  // 中文：返回值的边界编解码器。
  readonly result: TypertCodec
  /** Source declaration used only for diagnostics. */
  // 中文：源声明位置，仅供诊断。
  readonly sourceLocation?: InvocationSourceLocation
}

/** Generated Host contract selected explicitly by a Client assembly. */
// 中文：一次"显式选中的 Host 契约"：包含拥有这些 Remote 方法的 npm 包名，以及从该包
// 生成的全部调用描述（descriptors）。客户端装配时通过 $mount 一次性挂载整个贡献。
export interface TypertRemoteContribution {
  /** npm package that owns the Remote methods. */
  // 中文：拥有这些 Remote 方法的 npm 包名。
  readonly package: string
  /** Consumer-side invocation descriptors generated from that package. */
  // 中文：从该包生成的、供消费端使用的调用描述列表。
  readonly descriptors: readonly InvocationDescriptor[]
}

/** Client Remote capability implemented by the Gateway and consumed by Remote assemblies. */
// 中文：客户端侧 Remote 能力接口——由 Gateway（网关）实现、供远端装配消费。
// 三个入口：$mount 挂载一份 Host 贡献；$on 订阅被转发过来的 Host 事件；
// $dispatch 由 carrier 的 Host 帧汇入口调用，把解码后的帧分发给订阅表。
export interface TypertClientRemote extends TypertRemoteNamespaceMap {
  /**
   * Mount one generated Host-for-Client contribution in the caller's fiber.
   * @param contribution - explicitly selected Remote package artifact.
   * @returns disposer after namespace services and concrete methods are ready.
   */
  // 中文：在当前调用纤维（fiber）里挂载一份生成的 Host-for-Client 贡献；返回的
  // disposer 在命名空间服务与具体方法就绪后可用，调用它即可精确卸载这份贡献。
  $mount(contribution: TypertRemoteContribution): Promise<TypertDisposer>
  /**
   * Subscribe to one forwarded Host event; delivery is one-way, in registration
   * order, and isolates a throwing listener from the rest.
   * @template Event - forwarded event name selected by the Host assembly.
   * @param event - forwarded Host event name, unchanged on the wire.
   * @param listener - receives the Host's argument list as declared by Cordis `Events`.
   * @returns disposer owned by the calling fiber.
   */
  // 中文：订阅一个被转发过来的 Host 事件。投递是单向的、按注册顺序进行，且某个监听器
  // 抛错不会影响其他监听器。返回的 disposer 属于调用方纤维（随纤维销毁而撤销）。
  $on<Event extends TypertRemoteEvent>(event: Event, listener: Events[Event]): () => void
  /**
   * Hand one decoded forwarded frame to the subscription table. The carrier
   * owning the Host frame sink calls this; a consumer subscribes with
   * {@link TypertClientRemote.$on} and never calls it.
   *
   * `event` is a plain string because this is the wire boundary: the name is
   * whatever the Host assembly's allowlist selected, and one nobody subscribed
   * to is dropped silently.
   * @param event - forwarded Host event name, exactly as the Host emitted it.
   * @param args - the Host argument list, already JSON-decoded.
   */
  // 中文：把一帧已解码的转发数据交给订阅表。只有 carrier 的 Host 帧汇入口会调用它，
  // 消费方请用 $on 订阅、不要直接调用。event 用普通 string 是因为这里是线边界：
  // 名字就是 Host 装配白名单放行的那个，没人订阅的名字会被静默丢弃。
  $dispatch(event: string, args: readonly unknown[]): void
}

/**
 * Resolve one validated wire identity, synchronously or asynchronously.
 * @param id - validated wire identity.
 * @returns the Host object, or `undefined` when unavailable.
 */
// 中文：把一个已验证的线格式标识解析成 Host 对象（同步返回或返回 Promise 皆可）。
// 解析不到时返回 undefined。这是"对象 ↔ id"查找的核心回调形状，被查找提供者默认策略
// 与组合（composition）自定义解析器共用。
export type TypertLookupResolver<Host = unknown, Wire = unknown> = (
  id: Wire,
) => Host | undefined | Promise<Host | undefined>

/** Runtime provider for one declared Host object lookup. */
// 中文：某个已声明"对象查找"的运行时提供者：拥有包（owning package）注册它之后，
// 系统就能把线格式 id 还原成真实对象。parameter / wire 描述字段映射，
// hostTypeSymbol / wireTypeSymbol 是给 strict 代码生成用的规范类型符号。
export interface TypertLookupProvider<Host = unknown, Wire = unknown> {
  /** Source parameter name recognized by the SRC weak parser. */
  // 中文：源参数名（SRC 弱解析器能识别的名字）。
  readonly parameter: string
  /** Wire field replacing the Host object parameter. */
  // 中文：替换 Host 对象参数的线上字段名。
  readonly wire: string
  /** Canonical Host type symbol used by strict generation. */
  // 中文：规范 Host 类型符号（strict 生成时引用）。
  readonly hostTypeSymbol: string
  /** Canonical wire type symbol used by strict generation. */
  // 中文：规范线格式类型符号（strict 生成时引用）。
  readonly wireTypeSymbol: string
  /**
   * Resolve a wire identity through the provider's default policy.
   * @param id - validated wire identity.
   * @returns the object, `undefined` when unavailable, or either asynchronously.
   */
  // 中文：按提供者默认策略解析一个线格式标识；返回对象、undefined，或异步地返回二者之一。
  resolve(id: Wire): Host | undefined | Promise<Host | undefined>
}

/** Stable wire declaration retained after a lookup provider unloads. */
// 中文：查找提供者卸载后仍会保留的"稳定线声明"：key / parameter / wire / 类型符号等
// 静态信息与提供者生命周期无关，卸载后依然可查（供 codec 或生成逻辑使用）。
export interface TypertLookupDefinition {
  /** Merge-declared lookup key. */
  // 中文：合并声明的查找 key。
  readonly key: string
  /** Source parameter name recognized by the SRC weak parser. */
  // 中文：源参数名（SRC 弱解析器能识别的名字）。
  readonly parameter: string
  /** Wire field replacing the Host object parameter. */
  // 中文：替换 Host 对象参数的线上字段名。
  readonly wire: string
  /** Canonical Host type symbol used by strict generation. */
  // 中文：规范 Host 类型符号（strict 生成时引用）。
  readonly hostTypeSymbol: string
  /** Canonical wire type symbol used by strict generation. */
  // 中文：规范线格式类型符号（strict 生成时引用）。
  readonly wireTypeSymbol: string
}

/** Host resolver for one scoped Remote kind. */
// 中文：某个作用域化 Remote 种类的 Host 解析器：把线格式的 Context 身份解析成
// 活着的 Cordis 作用域 Context 对象，供 context 模式的远程调用定位接收者。
export interface TypertHostContextProvider<Wire = unknown> {
  /** Wire field carrying the Context identity. */
  // 中文：承载 Context 身份的线上字段名。
  readonly wire: string
  /** Canonical wire type symbol used by strict generation. */
  // 中文：规范线格式类型符号（strict 生成时引用）。
  readonly wireTypeSymbol: string
  /**
   * Resolve a wire identity to its live scoped Context.
   * @param id - validated wire identity.
   * @returns the scoped Context, or `undefined` when unavailable.
   */
  // 中文：把线格式身份解析成活的作用域 Context；解析不到时返回 undefined。
  resolve(id: Wire): Context | undefined | Promise<Context | undefined>
}

/** Composition-owned resolver replacing one Host Context provider's default lookup policy. */
// 中文：由组合（composition，即装配方）拥有的解析器函数：通过 configureHost 临时替换
// 某个 Host Context 提供者的默认解析策略（例如换成自定义鉴权后的解析逻辑）。
export type TypertHostContextResolver<Wire = unknown> = (
  id: Wire,
) => Context | undefined | Promise<Context | undefined>

/** Client resolver for the identity carried by the calling scoped Context. */
// 中文：客户端侧的"身份绑定器"：从调用方的作用域 Context 里读出远程身份，
// 由每个接入方实现（例如从 ctx 的会话字段里取用户 id）。
export interface TypertClientContextBinder<Wire = unknown> {
  /**
   * Read the Remote identity represented by a calling Context.
   * @param ctx - Context rebound by the Cordis service tracker.
   * @returns the wire identity, or `undefined` when the Context has the wrong scope.
   */
  // 中文：读取调用方 Context 所代表的远程身份；当 Context 作用域不对时返回 undefined。
  identity(ctx: Context): Wire | undefined
}

/** Notification emitted after a Typert runtime registry changes. */
// 中文：运行时注册中心发生变化后发出的变更通知：kind 表示哪一类注册表
// （本地 / 远程 / 查找 / Host 上下文 / Client 上下文），key 表示具体条目。
export interface TypertRegistryChange {
  readonly kind: 'local' | 'remote' | 'lookup' | 'host-context' | 'client-context'
  readonly key: string
}

/** Listener for one Typert runtime registry. */
// 中文：注册中心变更的监听器函数类型：入参是一条变更通知（TypertRegistryChange）。
export type TypertRegistryListener = (change: TypertRegistryChange) => void

/** Current-environment invocation definitions. */
// 中文：当前环境（本进程）的调用定义注册表：generator 生成的本地描述在这里登记与查询。
// hasSeen 记录某个端点是否在本 Typert 服务生命周期内出现过——即使后来撤销了也算"见过"。
export interface TypertLocalRegistry {
  /**
   * Look up one invocation by `<namespace>/<method>`.
   * @param endpoint - canonical endpoint.
   * @returns the live descriptor, or `undefined` when absent.
   */
  // 中文：按 `<namespace>/<method>` 规范端点查一个调用描述；不存在时返回 undefined。
  get(endpoint: string): InvocationDescriptor | undefined
  /**
   * Report whether a strict definition has existed during this Typert Service lifetime.
   * @param endpoint - canonical endpoint.
   * @returns `true` after the endpoint has been registered at least once, even if withdrawn.
   */
  // 中文：报告某个端点是否在本 Typert 服务生命周期内登记过严格定义（撤销过也算 true）。
  hasSeen(endpoint: string): boolean
  /** @returns a registration-order snapshot of local descriptors. */
  // 中文：返回按注册顺序排列的本地描述快照。
  list(): readonly InvocationDescriptor[]
  /**
   * Observe later local-definition changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  // 中文：订阅后续的本地定义变更；返回的 disposer 用于取消订阅。
  subscribe(listener: TypertRegistryListener): TypertDisposer
}

/** Consumer-selected Remote contribution registry. */
// 中文：消费端选中的 Remote 贡献注册表：远程贡献通过 register 挂到当前 Cordis 纤维上，
// 端点查询走 get / list，变更观察走 subscribe，卸载时用返回的 disposer 精确撤销。
export interface TypertRemoteRegistry {
  /**
   * Register one generated contribution for the calling Cordis fiber.
   * @param contribution - generated Remote descriptors.
   * @returns disposer withdrawing the exact contribution.
   */
  // 中文：为当前调用纤维注册一份生成的 Remote 贡献；返回撤销这份贡献的 disposer。
  register(contribution: TypertRemoteContribution): TypertDisposer
  /**
   * Look up one Remote descriptor by endpoint.
   * @param endpoint - canonical endpoint.
   * @returns the descriptor, or `undefined` when unmounted.
   */
  // 中文：按端点查一个远程调用描述；未挂载时返回 undefined。
  get(endpoint: string): InvocationDescriptor | undefined
  /** @returns a registration-order snapshot of Remote descriptors. */
  // 中文：返回按注册顺序排列的远程描述快照。
  list(): readonly InvocationDescriptor[]
  /**
   * Observe later Remote contribution changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  // 中文：订阅后续的远程贡献变更；返回的 disposer 用于取消订阅。
  subscribe(listener: TypertRegistryListener): TypertDisposer
}

/** Runtime registry for Host object lookup providers. */
// 中文：Host 对象查找提供者的运行时注册中心：提供者按合并声明的 key 注册；
// configure 可临时替换某 key 的解析策略（可先于提供者注册——配置期可能还没有可用提供者，
// 此时 get 依然返回 undefined，直到提供者真正注册）。
export interface TypertLookupRegistry {
  /**
   * Register one provider under its merge-declared key.
   * @param key - lookup key.
   * @param provider - owning package's live resolver.
   * @returns disposer withdrawing the exact provider.
   */
  // 中文：在合并声明的 key 下注册一个提供者；返回精确撤销该提供者的 disposer。
  register<K extends StringKeyOf<TypertLookupMap>>(
    key: K,
    provider: TypertLookupProvider<
      TypertLookupHost<TypertLookupMap[K]>,
      TypertLookupWire<TypertLookupMap[K]>
    >,
  ): TypertDisposer
  /**
   * Replace one provider's default resolution policy while this contribution is active.
   * Configuration may precede provider registration; without a live provider, `get()` remains unavailable.
   * @param key - lookup key whose wire declaration remains provider-owned.
   * @param resolver - composition-owned resolver used by every lookup of this key.
   * @returns disposer restoring the provider's default resolver.
   */
  // 中文：在该贡献生效期间替换某 key 的默认解析策略（组合方自定义）。配置可以先于提供者
  // 注册；没有活提供者时 get() 依然不可用。返回的 disposer 恢复提供者的默认解析器。
  configure<K extends StringKeyOf<TypertLookupMap>>(
    key: K,
    resolver: TypertLookupResolver<
      TypertLookupHost<TypertLookupMap[K]>,
      TypertLookupWire<TypertLookupMap[K]>
    >,
  ): TypertDisposer
  /**
   * Look up one provider by runtime key.
   * @param key - descriptor lookup key.
   * @returns the live provider, or `undefined` when absent.
   */
  // 中文：按运行时 key 查一个提供者；不存在时返回 undefined。
  get(key: string): TypertLookupProvider | undefined
  /** @returns lookup declarations observed during this Typert Service lifetime. */
  // 中文：返回本 Typert 服务生命周期内观察到的全部查找声明。
  definitions(): readonly TypertLookupDefinition[]
  /** @returns a snapshot of registered provider keys. */
  // 中文：返回已注册提供者 key 的快照。
  keys(): readonly string[]
  /**
   * Observe later lookup changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  // 中文：订阅后续的查找变更；返回的 disposer 用于取消订阅。
  subscribe(listener: TypertRegistryListener): TypertDisposer
}

/** Runtime registry for Host Context resolvers and Client Context binders. */
// 中文：Context 解析器的运行时注册中心：Host 侧 registerHost / configureHost 管理
// "按 id 还原 Context"，Client 侧 registerClient 管理"从调用 Context 读出身份"。
export interface TypertContextRegistry {
  /**
   * Register a Host Context resolver.
   * @param key - merge-declared Context key.
   * @param provider - owning package's Host resolver.
   * @returns disposer withdrawing the exact provider.
   */
  // 中文：注册一个 Host Context 解析器（按 id 还原 Context）；返回撤销它的 disposer。
  registerHost<K extends StringKeyOf<TypertContextMap>>(
    key: K,
    provider: TypertHostContextProvider<TypertContextWire<TypertContextMap[K]>>,
  ): TypertDisposer
  /**
   * Override one Host Context key's identity policy for the calling fiber.
   * Configuration may precede provider registration and restores the provider's default resolver on disposal.
   * @param key - merge-declared Context key.
   * @param resolver - composition-owned resolver used by every Host Context lookup of this key.
   * @returns disposer restoring the provider's default resolver.
   */
  // 中文：为调用纤维覆盖某 Host Context key 的身份策略；配置可先于提供者注册，撤销时
  // 恢复提供者的默认解析器。返回的 disposer 用于执行这次恢复。
  configureHost<K extends StringKeyOf<TypertContextMap>>(
    key: K,
    resolver: TypertHostContextResolver<TypertContextWire<TypertContextMap[K]>>,
  ): TypertDisposer
  /**
   * Register a Client Context identity binder.
   * @param key - merge-declared Context key.
   * @param binder - Client scope identity resolver.
   * @returns disposer withdrawing the exact binder.
   */
  // 中文：注册一个 Client Context 身份绑定器（从调用 Context 读出身份）；返回撤销它的 disposer。
  registerClient<K extends StringKeyOf<TypertContextMap>>(
    key: K,
    binder: TypertClientContextBinder<TypertContextWire<TypertContextMap[K]>>,
  ): TypertDisposer
  /**
   * Look up a Host Context resolver.
   * @param key - descriptor Context key.
   * @returns the provider, or `undefined` when absent.
   */
  // 中文：按 key 查 Host Context 解析器；不存在时返回 undefined。
  getHost(key: string): TypertHostContextProvider | undefined
  /**
   * Look up a Client Context binder.
   * @param key - descriptor Context key.
   * @returns the binder, or `undefined` when absent.
   */
  // 中文：按 key 查 Client Context 绑定器；不存在时返回 undefined。
  getClient(key: string): TypertClientContextBinder | undefined
  /**
   * Observe later Context provider changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  // 中文：订阅后续的 Context 提供者变更；返回的 disposer 用于取消订阅。
  subscribe(listener: TypertRegistryListener): TypertDisposer
}

/** Minimal Typert runtime consumed through dependency inversion. */
// 中文：依赖反转用的最小 Typert 运行时契约：把四类注册表聚合在一起挂在
// Cordis Context.typert 上。业务代码只依赖这个接口，不依赖具体实现包。
export interface TypertRegistryContract {
  readonly local: TypertLocalRegistry
  readonly remotes: TypertRemoteRegistry
  readonly lookups: TypertLookupRegistry
  readonly contexts: TypertContextRegistry
}

// 中文：通过 Cordis 的模块扩充（declaration merging），给每个 Cordis Context 增加
// typert 属性（类型为 TypertRegistryContract）。这样 ctx.typert.local 等入口对所有业务包可见。
declare module '@deepseek-ai/cordis' {
  interface Context {
    typert: TypertRegistryContract
  }
}
