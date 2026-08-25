/*
 * ================================ 文件注释 ================================
 * 【文件职责】typert 运行时注册中心：登记生成的类型反射、远程调用描述，以及依赖反转
 *             的 lookup / Context 提供者。它不做任何 TypeScript 分析或 schema 生成
 *             （那些属于 generator 与 loader 的职责）。
 * 【技术维度】继承 Cordis Service 注册为 ctx.typert；内部由若干 Store 组合：
 *             DescriptorStore（本地 / 远程调用描述，按端点与 id 双索引 + 历史集合）、
 *             RemoteStore（按包去重的远程贡献）、LookupStore（对象查找提供者 +
 *             可覆盖解析器）、ContextStore（Host 解析器 + Client 绑定器）；所有变更
 *             经 ChangeSource 广播（含订阅生命周期与观察者错误隔离）。
 * 【产品维度】这是"类型图"的运行时侧：业务包（经 loader）把生成清单注册进来，
 *             网关与消费方从这里查询 schema、远程方法与对象身份解析能力。
 * 【逻辑维度】按代码顺序：① 键构造工具（typertKey / typertPackageKey / typertEndpoint）；
 *             ② 内部数据结构与 ChangeSource（变更广播）；③ DescriptorStore（调用描述
 *             存储）；④ RemoteStore（远程贡献）；⑤ LookupStore（查找提供者）；
 *             ⑥ ContextStore（上下文提供者）；⑦ TypertRegistry（注册中心主体：
 *             register / get / resolve / list / getPackage / listPackages / toJSONSchema）；
 *             ⑧ 校验工具（validateInvocation / validateCodec / validateWireName /
 *             validateSegment / validateNonempty）。
 * 【关键边界】重复身份（包面、schema、调用端点 / id、提供者 key）一律拒绝；注册与
 *             撤销通过 Cordis effect 原子完成；名字校验分两类：键 / 包名只要求非空且
 *             不含 #，而线字段名要求是合法 RPC 分段字符。
 * 【新手阅读建议】先读 TypertRegistry.register 看"一次贡献如何落库"，再读
 *             DescriptorStore / LookupStore 理解内部结构，最后看 ChangeSource
 *             理解订阅与错误隔离。
 * ==========================================================================
 */

/**
 * Runtime registry for generated Typert reflection, Remote invocations, and
 * dependency-inverted lookup/Context providers. It performs no TypeScript
 * analysis or schema generation.
 * @module @deepseek-ai/dsh-typert-registry
 */
// 中文导读：本文件是 typert 的"运行时数据中心"：generator 在编译期产出清单，
// loader 在运行时导入并校验清单，最终都汇入这里的 TypertRegistry。

import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type {
  InvocationDescriptor,
  TypertClientContextBinder,
  TypertContextMap,
  TypertContextRegistry,
  TypertContextWire,
  TypertDisposer,
  TypertHostContextProvider,
  TypertHostContextResolver,
  TypertLocalRegistry,
  TypertLookupHost,
  TypertLookupDefinition,
  TypertLookupMap,
  TypertLookupProvider,
  TypertLookupResolver,
  TypertLookupRegistry,
  TypertLookupWire,
  TypertRemoteContribution,
  TypertRemoteRegistry,
  TypertRegistryChange,
  TypertRegistryListener,
  TypertRegistryContract,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  TypertContribution,
  TypertFace,
  TypertPackageFilter,
  TypertPackageRecord,
  TypertSchemaFilter,
  TypertSchemaRecord,
} from './types.ts'

/**
 * Compose the global key of one generated schema.
 * @param packageName - contributing npm package.
 * @param name - schema export name.
 * @returns `<package>#<name>`.
 */
// 中文：拼出单个生成 schema 的全局键：`<包名>#<导出名>`（# 分隔，查询与去重都用它）。
export function typertKey(packageName: string, name: string): string {
  return `${packageName}#${name}`
}

/**
 * Compose the identity of one package-face model.
 * @param packageName - contributing npm package.
 * @param face - independently compiled face.
 * @returns `<package>#<face>`.
 */
// 中文：拼出"某个包的某个面"模型的身份键：`<包名>#<面>`。
export function typertPackageKey(packageName: string, face: TypertFace): string {
  return `${packageName}#${face}`
}

/**
 * Compose the endpoint key used by local and Remote invocation registries.
 * @param descriptor - invocation whose namespace and method form the endpoint.
 * @returns `<namespace>/<method>`.
 */
// 中文：拼出本地与远程调用注册表共用的端点键：`<命名空间>/<方法>`。
export function typertEndpoint(descriptor: Pick<InvocationDescriptor, 'namespace' | 'method'>): string {
  return `${descriptor.namespace}/${descriptor.method}`
}

// 中文：内部结构——调用描述条目：描述本体 + 登记它的所有者对象（撤销时校验归属）。
interface DescriptorEntry {
  readonly descriptor: InvocationDescriptor
  readonly owner: object
}

// 中文：内部结构——提供者条目：提供者本体 + 登记它的所有者对象。
interface ProviderEntry<Provider> {
  readonly provider: Provider
  readonly owner: object
}

// 中文：观察者出错的汇报回调：接收变更对象与错误（由注册中心记日志，不影响其他监听者）。
type ReportObserverError = (change: TypertRegistryChange, error: unknown) => void

// 中文：变更广播源：维护监听器集合，订阅绑定到调用方纤维的生命周期（随纤维销毁自动
// 退订）；emit 时逐个通知，单个监听器抛错只汇报不中断其余监听器。
class ChangeSource {
  private readonly listeners = new Set<TypertRegistryListener>()

  constructor(private readonly report: ReportObserverError) {}

  // 中文：订阅一个监听器：注册进集合，返回的 disposer 随调用方纤维生命周期自动退订。
  subscribe(ctx: Context, listener: TypertRegistryListener): TypertDisposer {
    const { listeners } = this
    return ctx.effect(function* () {
      listeners.add(listener)
      yield () => { listeners.delete(listener) }
    }, 'typert registry subscription')
  }

  // 中文：广播一次变更：遍历快照逐个通知，监听器抛错交给 report 处理（隔离）。
  emit(change: TypertRegistryChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change)
      } catch (error) {
        this.report(change, error)
      }
    }
  }
}

// 中文：调用描述存储：本地（本进程生成）与远程（贡献）共用。按端点与 id 双索引；
// history 记录"曾见过的端点"（hasSeen 语义，撤销后仍算见过）；commit / withdraw
// 成对出现并由所有者对象保证归属。
class DescriptorStore {
  private readonly entries = new Map<string, DescriptorEntry>()
  private readonly ids = new Map<string, DescriptorEntry>()
  private readonly history = new Set<string>()
  private readonly changes: ChangeSource

  constructor(
    private readonly kind: 'local' | 'remote',
    report: ReportObserverError,
  ) {
    this.changes = new ChangeSource(report)
  }

  // 中文：校验一批描述可提交：逐个校验结构合法，且端点与 id 在"本批内 + 已注册表里"
  // 都不得重复。
  validate(descriptors: readonly InvocationDescriptor[]): void {
    const endpoints = new Set<string>()
    const ids = new Set<string>()
    for (const descriptor of descriptors) {
      validateInvocation(descriptor)
      const endpoint = typertEndpoint(descriptor)
      if (endpoints.has(endpoint) || this.entries.has(endpoint)) {
        throw new Error(`typert: ${this.kind} endpoint "${endpoint}" is already registered`)
      }
      if (ids.has(descriptor.id) || this.ids.has(descriptor.id)) {
        throw new Error(`typert: ${this.kind} invocation id "${descriptor.id}" is already registered`)
      }
      endpoints.add(endpoint)
      ids.add(descriptor.id)
    }
  }

  // 中文：把一批描述写入存储并广播变更（每条端点一条通知）。
  commit(owner: object, descriptors: readonly InvocationDescriptor[]): void {
    for (const descriptor of descriptors) {
      const entry = { descriptor, owner }
      const endpoint = typertEndpoint(descriptor)
      this.entries.set(endpoint, entry)
      this.ids.set(descriptor.id, entry)
      this.history.add(endpoint)
    }
    for (const descriptor of descriptors) {
      this.changes.emit({ kind: this.kind, key: typertEndpoint(descriptor) })
    }
  }

  // 中文：按所有者撤销一批描述：只删"属于该所有者"的条目（重复注册已被拒绝，因此
  // 不会有后来者覆盖条目），被删端点广播移除通知。
  withdraw(owner: object, descriptors: readonly InvocationDescriptor[]): void {
    const removed: string[] = []
    for (const descriptor of descriptors) {
      const endpoint = typertEndpoint(descriptor)
      const entry = this.entries.get(endpoint)
      /* v8 ignore next -- duplicate registration is rejected, so no later owner can replace this entry before its effect disposes. */
      if (entry?.owner !== owner) continue
      this.entries.delete(endpoint)
      /* v8 ignore next -- ids and endpoints are committed and withdrawn together under the same unique owner. */
      if (this.ids.get(descriptor.id) === entry) this.ids.delete(descriptor.id)
      removed.push(endpoint)
    }
    for (const endpoint of removed) this.changes.emit({ kind: this.kind, key: endpoint })
  }

  // 中文：按端点查活描述。
  get(endpoint: string): InvocationDescriptor | undefined {
    return this.entries.get(endpoint)?.descriptor
  }

  // 中文：报告端点是否在本注册表生命周期内出现过（撤销过也算）。
  hasSeen(endpoint: string): boolean {
    return this.history.has(endpoint)
  }

  // 中文：按注册顺序返回全部活描述。
  list(): readonly InvocationDescriptor[] {
    return [...this.entries.values()].map(entry => entry.descriptor)
  }

  // 中文：订阅后续变更。
  subscribe(ctx: Context, listener: TypertRegistryListener): TypertDisposer {
    return this.changes.subscribe(ctx, listener)
  }
}

// 中文：远程贡献存储：按包名去重（同一包只能注册一次 Remote 贡献），描述复用
// DescriptorStore；register 通过 Cordis effect 原子完成"占包名 + 提交描述"，
// 撤销时按所有者精确清理。
class RemoteStore {
  private readonly packages = new Map<string, object>()

  constructor(private readonly descriptors: DescriptorStore) {}

  // 中文：对外视图：把内部实现包成协议要求的 TypertRemoteRegistry 接口。
  view(ctx: Context): TypertRemoteRegistry {
    return {
      register: contribution => this.register(ctx, contribution),
      get: endpoint => this.descriptors.get(endpoint),
      list: () => this.descriptors.list(),
      subscribe: listener => this.descriptors.subscribe(ctx, listener),
    }
  }

  // 中文：注册一份远程贡献：包名必须合法且未注册；描述先校验再提交。
  private register(ctx: Context, contribution: TypertRemoteContribution): TypertDisposer {
    validateSegment('Remote package name', contribution.package)
    if (this.packages.has(contribution.package)) {
      throw new Error(`typert: Remote package "${contribution.package}" is already registered`)
    }
    this.descriptors.validate(contribution.descriptors)
    const owner = {}
    const { packages, descriptors } = this
    return ctx.effect(function* () {
      packages.set(contribution.package, owner)
      descriptors.commit(owner, contribution.descriptors)
      yield () => {
        /* v8 ignore else -- duplicate package registration is rejected, so this effect remains the package's unique owner. */
        if (packages.get(contribution.package) === owner) packages.delete(contribution.package)
        descriptors.withdraw(owner, contribution.descriptors)
      }
    }, `typert.remotes.register(${JSON.stringify(contribution.package)})`)
  }
}

// 中文：对象查找存储：providers 是拥有包注册的默认提供者；resolvers 是组合方
// configure 的临时覆盖解析器（优先于默认 resolve）；definitions 保留"稳定线声明"
//（提供者卸载后仍在，供 codec / 生成逻辑查询）。
class LookupStore {
  private readonly providers = new Map<string, ProviderEntry<TypertLookupProvider>>()
  private readonly resolvers = new Map<string, ProviderEntry<LookupResolverEntry>>()
  private readonly definitions = new Map<string, TypertLookupDefinition>()
  private readonly changes: ChangeSource

  constructor(report: ReportObserverError) {
    this.changes = new ChangeSource(report)
  }

  // 中文：对外视图：包成协议要求的 TypertLookupRegistry 接口（注册 / 配置 / 查询 /
  // 枚举 / 订阅）。
  view(ctx: Context): TypertLookupRegistry {
    return {
      register: <K extends Extract<keyof TypertLookupMap, string>>(
        key: K,
        provider: TypertLookupProvider<
          TypertLookupHost<TypertLookupMap[K]>,
          TypertLookupWire<TypertLookupMap[K]>
        >,
      ) => this.register(ctx, key, provider),
      configure: <K extends Extract<keyof TypertLookupMap, string>>(
        key: K,
        resolver: TypertLookupResolver<
          TypertLookupHost<TypertLookupMap[K]>,
          TypertLookupWire<TypertLookupMap[K]>
        >,
      ) => this.configure(ctx, key, resolver),
      get: key => this.get(key),
      definitions: () => [...this.definitions.values()],
      keys: () => [...this.providers.keys()],
      subscribe: listener => this.changes.subscribe(ctx, listener),
    }
  }

  // 中文：查一个 key 的生效提供者：有覆盖解析器时返回"静态字段 + 覆盖 resolve"的
  // 合成提供者，否则返回默认提供者。
  private get(key: string): TypertLookupProvider | undefined {
    const provider = this.providers.get(key)?.provider
    if (provider === undefined) return undefined
    const resolver = this.resolvers.get(key)?.provider
    if (resolver === undefined) return provider
    return {
      parameter: provider.parameter,
      wire: provider.wire,
      hostTypeSymbol: provider.hostTypeSymbol,
      wireTypeSymbol: provider.wireTypeSymbol,
      resolve: id => resolver.resolve(id),
    }
  }

  // 中文：临时覆盖某 key 的解析策略：只允许配置一次（重复配置失败）；生效期间 get
  // 返回合成提供者，撤销后恢复默认。
  private configure<Host, Wire>(
    ctx: Context,
    key: string,
    resolver: TypertLookupResolver<Host, Wire>,
  ): TypertDisposer {
    validateSegment('lookup key', key)
    if (this.resolvers.has(key)) throw new Error(`typert: lookup "${key}" resolver is already configured`)
    const owner = {}
    // The map erases each merge-declared Wire type; restore it only at the
    // typed configure() boundary so strict function variance remains sound.
    // 中文：Map 会擦除每个合并声明的 Wire 类型；只在带类型的 configure() 边界处恢复它，
    // 从而保证严格函数方差（strict function variance）仍然成立。
    const entry: ProviderEntry<LookupResolverEntry> = {
      provider: { resolve: async id => resolver(id as Wire) },
      owner,
    }
    const { resolvers, changes } = this
    return ctx.effect(function* () {
      resolvers.set(key, entry)
      changes.emit({ kind: 'lookup', key })
      yield () => {
        /* v8 ignore next -- duplicate configuration is rejected, so this effect remains the key's unique owner. */
        if (resolvers.get(key) !== entry) return
        resolvers.delete(key)
        changes.emit({ kind: 'lookup', key })
      }
    }, `typert.lookups.configure(${JSON.stringify(key)})`)
  }

  // 中文：注册一个默认提供者：字段名与类型符号做合法性校验；同 key 重复注册失败；
  // 若 key 已有"稳定线声明"且新声明的静态字段与之不同，视为本生命周期内改动，失败。
  private register<Host, Wire>(ctx: Context, key: string, provider: TypertLookupProvider<Host, Wire>): TypertDisposer {
    validateSegment('lookup key', key)
    validateSegment('lookup parameter', provider.parameter)
    validateWireName('lookup wire field', provider.wire)
    validateNonempty('lookup Host type symbol', provider.hostTypeSymbol)
    validateNonempty('lookup wire type symbol', provider.wireTypeSymbol)
    if (this.providers.has(key)) throw new Error(`typert: lookup "${key}" is already registered`)
    const definition: TypertLookupDefinition = {
      key,
      parameter: provider.parameter,
      wire: provider.wire,
      hostTypeSymbol: provider.hostTypeSymbol,
      wireTypeSymbol: provider.wireTypeSymbol,
    }
    const known = this.definitions.get(key)
    if (known !== undefined && !lookupDefinitionEquals(known, definition)) {
      throw new Error(`typert: lookup "${key}" changed its wire declaration during this registry lifetime`)
    }
    const owner = {}
    const entry: ProviderEntry<TypertLookupProvider> = { provider, owner }
    const { definitions, providers, changes } = this
    return ctx.effect(function* () {
      definitions.set(key, definition)
      providers.set(key, entry)
      changes.emit({ kind: 'lookup', key })
      yield () => {
        /* v8 ignore next -- duplicate registration is rejected, so this effect remains the key's unique owner. */
        if (providers.get(key) !== entry) return
        providers.delete(key)
        changes.emit({ kind: 'lookup', key })
      }
    }, `typert.lookups.register(${JSON.stringify(key)})`)
  }
}

// 中文：内部结构——覆盖解析器条目（统一擦除 Wire 泛型后的形态）。
interface LookupResolverEntry {
  resolve(id: unknown): Promise<unknown>
}

// 中文：比较两份查找定义的静态字段是否一致（parameter / wire / 类型符号全等）。
function lookupDefinitionEquals(left: TypertLookupDefinition, right: TypertLookupDefinition): boolean {
  return left.parameter === right.parameter
    && left.wire === right.wire
    && left.hostTypeSymbol === right.hostTypeSymbol
    && left.wireTypeSymbol === right.wireTypeSymbol
}

// 中文：上下文存储：hosts 是 Host 侧"按 id 还原 Context"的提供者；hostResolvers 是
// 组合方 configureHost 的覆盖解析器；clients 是 Client 侧"从调用 Context 读出身份"
// 的绑定器。
class ContextStore {
  private readonly hosts = new Map<string, ProviderEntry<TypertHostContextProvider>>()
  private readonly hostResolvers = new Map<string, ProviderEntry<HostContextResolverEntry>>()
  private readonly clients = new Map<string, ProviderEntry<TypertClientContextBinder>>()
  private readonly changes: ChangeSource

  constructor(report: ReportObserverError) {
    this.changes = new ChangeSource(report)
  }

  // 中文：对外视图：包成协议要求的 TypertContextRegistry 接口。
  view(ctx: Context): TypertContextRegistry {
    return {
      registerHost: <K extends Extract<keyof TypertContextMap, string>>(
        key: K,
        provider: TypertHostContextProvider<TypertContextWire<TypertContextMap[K]>>,
      ) => this.registerHost(ctx, key, provider),
      configureHost: <K extends Extract<keyof TypertContextMap, string>>(
        key: K,
        resolver: TypertHostContextResolver<TypertContextWire<TypertContextMap[K]>>,
      ) => this.configureHost(ctx, key, resolver),
      registerClient: <K extends Extract<keyof TypertContextMap, string>>(
        key: K,
        binder: TypertClientContextBinder<TypertContextWire<TypertContextMap[K]>>,
      ) => this.registerClient(ctx, key, binder),
      getHost: key => this.getHost(key),
      getClient: key => this.clients.get(key)?.provider,
      subscribe: listener => this.changes.subscribe(ctx, listener),
    }
  }

  // 中文：查一个 key 的生效 Host 提供者：有覆盖解析器时返回"静态字段 + 覆盖 resolve"
  // 的合成提供者，否则返回默认提供者。
  private getHost(key: string): TypertHostContextProvider | undefined {
    const provider = this.hosts.get(key)?.provider
    if (provider === undefined) return undefined
    const resolver = this.hostResolvers.get(key)?.provider
    if (resolver === undefined) return provider
    return {
      wire: provider.wire,
      wireTypeSymbol: provider.wireTypeSymbol,
      resolve: id => resolver.resolve(id),
    }
  }

  // 中文：临时覆盖某 key 的 Host 解析策略（只能配置一次，撤销后恢复默认）。
  private configureHost<Wire>(
    ctx: Context,
    key: string,
    resolver: TypertHostContextResolver<Wire>,
  ): TypertDisposer {
    validateSegment('Context key', key)
    if (this.hostResolvers.has(key)) throw new Error(`typert: host-context "${key}" resolver is already configured`)
    const entry: ProviderEntry<HostContextResolverEntry> = {
      provider: { resolve: async id => resolver(id as Wire) },
      owner: {},
    }
    const { hostResolvers, changes } = this
    return ctx.effect(function* () {
      hostResolvers.set(key, entry)
      changes.emit({ kind: 'host-context', key })
      yield () => {
        /* v8 ignore next -- duplicate configuration is rejected, so this effect remains the key's unique owner. */
        if (hostResolvers.get(key) !== entry) return
        hostResolvers.delete(key)
        changes.emit({ kind: 'host-context', key })
      }
    }, `typert.contexts.configureHost(${JSON.stringify(key)})`)
  }

  // 中文：注册 Host 侧提供者（按 id 还原 Context）：校验 key 与线字段名 / 类型符号。
  private registerHost<Wire>(ctx: Context, key: string, provider: TypertHostContextProvider<Wire>): TypertDisposer {
    validateSegment('Context key', key)
    validateWireName('Context wire field', provider.wire)
    validateNonempty('Context wire type symbol', provider.wireTypeSymbol)
    return this.registerProvider(ctx, this.hosts, 'host-context', key, provider)
  }

  // 中文：注册 Client 侧绑定器（从调用 Context 读出身份）：只需校验 key。
  private registerClient<Wire>(ctx: Context, key: string, binder: TypertClientContextBinder<Wire>): TypertDisposer {
    validateSegment('Context key', key)
    return this.registerProvider(ctx, this.clients, 'client-context', key, binder)
  }

  // 中文：通用提供者注册：同 key 重复注册失败；写入表 + 广播，撤销时校验归属后清理。
  private registerProvider<Provider>(
    ctx: Context,
    table: Map<string, ProviderEntry<Provider>>,
    kind: 'host-context' | 'client-context',
    key: string,
    provider: Provider,
  ): TypertDisposer {
    if (table.has(key)) throw new Error(`typert: ${kind} provider "${key}" is already registered`)
    const entry: ProviderEntry<Provider> = { provider, owner: {} }
    const { changes } = this
    return ctx.effect(function* () {
      table.set(key, entry)
      changes.emit({ kind, key })
      yield () => {
        /* v8 ignore next -- duplicate registration is rejected, so this effect remains the key's unique owner. */
        if (table.get(key) !== entry) return
        table.delete(key)
        changes.emit({ kind, key })
      }
    }, `typert.contexts.register(${JSON.stringify(key)})`)
  }
}

// 中文：内部结构——Host 覆盖解析器条目（统一擦除 Wire 泛型后的形态）。
interface HostContextResolverEntry {
  resolve(id: unknown): Promise<Context | undefined>
}

/**
 * Registry of generated schemas, package reflection, invocations, and Remote
 * dependency providers.
 * @typert service typert
 */
// 中文：注册中心主体：登记生成的 schema、包反射、调用描述与 Remote 依赖提供者。
// 以 Cordis Service 身份注册为 ctx.typert；内部组合四个 Store（schema / 包模型直接
// 用 Map，调用描述走 DescriptorStore，远程走 RemoteStore，查找与上下文走
// LookupStore / ContextStore）。
export class TypertRegistry extends Service implements TypertRegistryContract {
  // 中文：schema 记录表（全局键 → 记录）。
  private readonly schemas = new Map<string, TypertSchemaRecord>()
  // 中文：包模型记录表（包面键 → 记录）。
  private readonly packages = new Map<string, TypertPackageRecord>()
  private readonly localStore: DescriptorStore
  private readonly remoteStore: RemoteStore
  private readonly lookupStore: LookupStore
  private readonly contextStore: ContextStore

  constructor(ctx: Context) {
    super(ctx, 'typert')
    // 中文：观察者报错统一记警告日志（监听器抛错不影响其余监听器）。
    const report: ReportObserverError = (change, error) => {
      ctx.logger.warn(`typert: ${change.kind} observer for "${change.key}" failed`)
      ctx.logger.warn(error)
    }
    this.localStore = new DescriptorStore('local', report)
    this.remoteStore = new RemoteStore(new DescriptorStore('remote', report))
    this.lookupStore = new LookupStore(report)
    this.contextStore = new ContextStore(report)
  }

  /** Current-environment invocation definitions. */
  // 中文：当前环境的本地调用定义视图（get / hasSeen / list / subscribe）。
  get local(): TypertLocalRegistry {
    const ctx = this.ctx
    return {
      get: endpoint => this.localStore.get(endpoint),
      hasSeen: endpoint => this.localStore.hasSeen(endpoint),
      list: () => this.localStore.list(),
      subscribe: listener => this.localStore.subscribe(ctx, listener),
    }
  }

  /** Consumer-selected Remote definitions. */
  // 中文：消费端选中的远程定义视图。
  get remotes(): TypertRemoteRegistry {
    return this.remoteStore.view(this.ctx)
  }

  /** Host object lookup providers. */
  // 中文：Host 对象查找提供者视图。
  get lookups(): TypertLookupRegistry {
    return this.lookupStore.view(this.ctx)
  }

  /** Host Context providers and Client Context binders. */
  // 中文：Host Context 提供者与 Client Context 绑定器视图。
  get contexts(): TypertContextRegistry {
    return this.contextStore.view(this.ctx)
  }

  /**
   * Register one generated contribution atomically for the calling fiber.
   * Duplicate package-face identities, schemas, invocation ids, or endpoints
   * reject the whole batch.
   * @param contribution - generated schemas, reflection, and Host invocations.
   * @returns the exact effect disposer that removes this contribution.
   */
  // 中文：为调用纤维"原子"注册一份生成的贡献：先校验包面、schema、调用描述（任何重复
  // 都会让整批失败），再通过 Cordis effect 一次性写入；返回的 disposer 精确撤销本贡献。
  register(contribution: TypertContribution): TypertDisposer {
    const packageRecord = this.validatePackage(contribution)
    const schemaRecords = this.validateSchemas(contribution)
    const invocations = contribution.invocations
    this.localStore.validate(invocations)
    const owner = {}
    const { schemas, packages, localStore } = this
    return this.ctx.effect(function* () {
      packages.set(packageRecord.key, packageRecord)
      for (const record of schemaRecords) schemas.set(record.key, record)
      localStore.commit(owner, invocations)
      yield () => {
        /* v8 ignore else -- duplicate package-face registration is rejected, so this effect remains its unique owner. */
        if (packages.get(packageRecord.key) === packageRecord) packages.delete(packageRecord.key)
        for (const record of schemaRecords) {
          /* v8 ignore else -- duplicate schema registration is rejected, so this contribution remains each record's unique owner. */
          if (schemas.get(record.key) === record) schemas.delete(record.key)
        }
        localStore.withdraw(owner, invocations)
      }
    }, 'typert.register()')
  }

  /**
   * Look up one schema by `<package>#<name>`.
   * @param key - global schema key.
   * @returns the live schema record, or `undefined` when absent.
   */
  // 中文：按全局键查一个活 schema 记录；不存在返回 undefined。
  get(key: string): TypertSchemaRecord | undefined {
    return this.schemas.get(key)
  }

  /**
   * Resolve one required schema.
   * @param key - global schema key.
   * @returns the live schema record.
   * @throws when the key is malformed, the package face is absent, or the schema is not contributed.
   */
  // 中文：解析一个"必需"的 schema：查不到时给出分层次的诊断——键格式非法、包已注册但
  // 没有这个 schema、包根本没注册，三种情况各报各的错，绝不静默。
  resolve(key: string): TypertSchemaRecord {
    const record = this.schemas.get(key)
    if (record !== undefined) return record
    const hash = key.indexOf('#')
    if (hash <= 0 || hash === key.length - 1) {
      throw new Error(`typert: invalid schema key "${key}" — expected "<package>#<name>"`)
    }
    const packageName = key.slice(0, hash)
    if ([...this.packages.values()].some(candidate => candidate.package === packageName)) {
      throw new Error(
        `typert: cannot resolve "${key}" — package "${packageName}" is registered but contributes no schema named "${key.slice(hash + 1)}"`,
      )
    }
    throw new Error(`typert: cannot resolve "${key}" — package "${packageName}" has no registered contribution`)
  }

  /**
   * Enumerate live schemas in registration order.
   * @param filter - optional package and face restriction.
   * @returns matching schema records.
   */
  // 中文：按注册顺序枚举活 schema，可选按包 / 面过滤。
  list(filter: TypertSchemaFilter = {}): TypertSchemaRecord[] {
    return [...this.schemas.values()].filter(record => matches(record, filter))
  }

  /**
   * Look up generated reflection for one package face.
   * @param packageName - exact npm package name.
   * @param face - face to query; defaults to the host runtime.
   * @returns the live package record, or `undefined` when absent.
   */
  // 中文：按包名（与可选面，默认 host）查生成的反射模型。
  getPackage(packageName: string, face: TypertFace = 'host'): TypertPackageRecord | undefined {
    return this.packages.get(typertPackageKey(packageName, face))
  }

  /**
   * Enumerate generated package reflection in registration order.
   * @param filter - optional package and face restriction.
   * @returns matching package records.
   */
  // 中文：按注册顺序枚举包反射模型，可选按包 / 面过滤。
  listPackages(filter: TypertPackageFilter = {}): TypertPackageRecord[] {
    return [...this.packages.values()].filter(record => matches(record, filter))
  }

  /**
   * Project a live Zod schema to JSON Schema without caching the result.
   * @param key - global schema key.
   * @param params - Zod projection parameters.
   * @returns a fresh JSON Schema document.
   */
  // 中文：把活 Zod schema 投影成 JSON Schema（每次返回新文档，不缓存）。
  toJSONSchema(key: string, params?: z.core.ToJSONSchemaParams): z.core.JSONSchema.BaseSchema {
    return z.toJSONSchema(this.resolve(key).schema, params)
  }

  // 中文：校验一份贡献的"包面身份"：包名合法、面必须是 host / client、包面键不得重复。
  private validatePackage(contribution: TypertContribution): TypertPackageRecord {
    validateSegment('package name', contribution.package)
    const face: unknown = contribution.face
    if (face !== 'host' && face !== 'client') {
      throw new Error(`typert: invalid face ${JSON.stringify(face)} — expected "host" or "client"`)
    }
    const key = typertPackageKey(contribution.package, contribution.face)
    if (this.packages.has(key)) {
      throw new Error(`typert: package face "${key}" is already registered`)
    }
    return {
      package: contribution.package,
      face,
      key,
      model: contribution.model,
    }
  }

  // 中文：校验一份贡献的 schema 列表：schema 名合法、全局键在本批内与已注册表里都
  // 不得重复；返回带身份的活记录列表。
  private validateSchemas(contribution: TypertContribution): TypertSchemaRecord[] {
    const records: TypertSchemaRecord[] = []
    const batch = new Set<string>()
    for (const schema of contribution.schemas) {
      validateSegment('schema name', schema.name)
      const key = typertKey(contribution.package, schema.name)
      if (batch.has(key) || this.schemas.has(key)) {
        throw new Error(`typert: schema "${key}" is already registered`)
      }
      batch.add(key)
      records.push({
        ...schema,
        package: contribution.package,
        face: contribution.face,
        key,
      })
    }
    return records
  }
}

// 中文：按过滤器匹配记录（包 / 面都可选）。
function matches(
  record: { readonly package: string; readonly face: TypertFace },
  filter: { readonly package?: string; readonly face?: TypertFace },
): boolean {
  return (filter.package === undefined || record.package === filter.package)
    && (filter.face === undefined || record.face === filter.face)
}

// 中文：校验一条调用描述：id 非空；service / namespace / method 等按"线字段名"规则；
// 参数 wire 全局唯一、lookup 参数不能接受 undefined 且必须带 lookup 键、JSON 参数
// 不得带 lookup 键；cancellation 只能是 signal；scope 必须选中唯一的 lookup 参数且
// 不能与 context 接收者并存；结果与参数 codec 都必须是合法 codec。
function validateInvocation(descriptor: InvocationDescriptor): void {
  validateNonempty('invocation id', descriptor.id)
  validateSegment('invocation service key', descriptor.service)
  validateWireName('invocation namespace', descriptor.namespace)
  validateWireName('invocation method', descriptor.method)
  if (descriptor.implementation !== undefined) {
    validateWireName('invocation implementation method', descriptor.implementation)
  }
  validateCodec(descriptor.result, `${descriptor.id} result`)
  const wires = new Set<string>()
  for (const parameter of descriptor.parameters) {
    validateWireName('parameter name', parameter.name)
    validateWireName('parameter wire field', parameter.wire)
    if (wires.has(parameter.wire)) {
      throw new Error(`typert: invocation "${descriptor.id}" repeats wire field "${parameter.wire}"`)
    }
    wires.add(parameter.wire)
    if (parameter.source === 'lookup') {
      if (parameter.acceptsUndefined !== undefined) {
        throw new Error(`typert: invocation "${descriptor.id}" lookup parameter "${parameter.name}" cannot accept undefined`)
      }
      if (parameter.lookup === undefined) {
        throw new Error(`typert: invocation "${descriptor.id}" lookup parameter "${parameter.name}" has no lookup key`)
      }
      validateSegment('lookup key', parameter.lookup)
    } else if (parameter.lookup !== undefined) {
      throw new Error(`typert: invocation "${descriptor.id}" JSON parameter "${parameter.name}" declares a lookup key`)
    }
    validateCodec(parameter.codec, `${descriptor.id} parameter ${parameter.name}`)
  }
  const cancellation = descriptor.cancellation as { readonly parameter: string } | undefined
  if (cancellation !== undefined && cancellation.parameter !== 'signal') {
    throw new Error(`typert: invocation "${descriptor.id}" cancellation parameter must be "signal"`)
  }
  // 中文：scope 投影只允许在直连调用上，且必须恰好选中唯一的 lookup 参数。
  if (descriptor.scope !== undefined) {
    if (descriptor.invocation.kind !== 'direct') {
      throw new Error(`typert: invocation "${descriptor.id}" Context receiver cannot declare a direct scope projection`)
    }
    validateSegment('scope Context key', descriptor.scope.context)
    validateWireName('scope wire field', descriptor.scope.wire)
    const lookups = descriptor.parameters.filter(candidate => candidate.source === 'lookup')
    const parameter = lookups.length === 1 ? lookups[0] : undefined
    if (parameter === undefined || parameter.wire !== descriptor.scope.wire
      || parameter.lookup !== descriptor.scope.context) {
      throw new Error(
        `typert: invocation "${descriptor.id}" scope wire "${descriptor.scope.wire}" must select its only lookup parameter`,
      )
    }
  }
  // 中文：context 接收者：key 合法、wire 字段名合法且不与参数 wire 冲突、codec 合法。
  if (descriptor.invocation.kind === 'context') {
    validateSegment('Context key', descriptor.invocation.context)
    validateWireName('Context wire field', descriptor.invocation.wire)
    if (wires.has(descriptor.invocation.wire)) {
      throw new Error(`typert: invocation "${descriptor.id}" repeats wire field "${descriptor.invocation.wire}"`)
    }
    validateCodec(descriptor.invocation.codec, `${descriptor.id} Context`)
  }
}

// 中文：校验一个 codec：src-json 模式免检；strict 模式要求非空 typeSymbol 且 schema
// 有 parse 方法。
function validateCodec(codec: InvocationDescriptor['result'], subject: string): void {
  if (codec.mode === 'src-json') return
  validateNonempty(`${subject} type symbol`, codec.typeSymbol)
  if (typeof codec.schema.parse !== 'function') {
    throw new Error(`typert: ${subject} strict codec has no parse() method`)
  }
}

// 中文：线字段名校验：不能是 "." / ".."，且只能由 RPC 端点分段字符组成。
function validateWireName(subject: string, value: string): void {
  if (value === '.' || value === '..' || !/^[A-Za-z0-9_$.-]+$/.test(value)) {
    throw new Error(`typert: invalid ${subject} "${value}" — must contain only RPC endpoint segment characters`)
  }
}

// 中文：键 / 包名校验：非空且不含 #（# 是 schema 键的分隔符，键本身不得包含）。
function validateSegment(subject: string, value: string): void {
  if (value.length === 0 || value.includes('#')) {
    throw new Error(`typert: invalid ${subject} "${value}" — must be nonempty and must not contain "#"`)
  }
}

// 中文：非空校验（用于类型符号等只要求非空的字段）。
function validateNonempty(subject: string, value: string): void {
  if (value.length === 0) throw new Error(`typert: invalid ${subject} — must be nonempty`)
}

export default TypertRegistry
