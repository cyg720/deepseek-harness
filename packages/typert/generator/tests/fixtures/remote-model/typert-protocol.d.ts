/**
 * 文件职责：验证 typert/generator 中 typert protocol d 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  export interface TypertLookup<Host, Wire> {
    readonly host: Host
    readonly wire: Wire
  }

  export interface TypertContext<Wire> {
    readonly wire: Wire
  }

  export interface TypertLookupMap {}
  export interface TypertContextMap {}
  export interface TypertRemoteMap {}
  export interface TypertRemoteScopeMap {}

  export interface RemoteFailure {
    readonly code: string
    readonly message: string
    readonly details: object
  }

  export type RemoteResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: RemoteFailure }

  export type TypertRemoteNamespace<Namespace extends string> = {
    [Endpoint in keyof TypertRemoteMap as Endpoint extends `${Namespace}/${infer Method}`
      ? Method
      : never]: TypertRemoteMap[Endpoint]
  }

  export interface TypertRemoteNamespaceMap {}

  export interface TypertRemoteContribution {
    readonly package: string
    readonly descriptors: readonly unknown[]
  }

  /**
   * 类说明：TypertRemoteService 用于集中封装 处理 TypertRemoteService 相关状态与行为。
   * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
   * 使用场景：由 typert/generator 在对应插件或业务生命周期内创建和调用。
   */
  export abstract class TypertRemoteService {
    /**
     * 常量说明：typertRemote 用于处理 typertRemote 相关数据，作用于成员；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    readonly typertRemote: {
      readonly service: TypertRemoteService
      readonly serviceKey: string
      readonly namespace: string
    }
    /**
     * 功能说明：处理 TypertRemoteService 相关流程；使用场景由所在模块及调用位置决定。
     * @param ctx （unknown）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
     * @param serviceKey （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param options （{ readonly namespace?: string }）：提供本次操作使用的配置选项；
     * 必须满足声明的类型及调用时序要求。
     * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 通过 new TypertRemoteService(ctx, serviceKey, options) 创建实例，
     * 并在所属生命周期内使用。
     */
    protected constructor(
      ctx: unknown,
      serviceKey: string,
      options?: { readonly namespace?: string },
    )
  }

  /**
   * 功能说明：处理 bindTypertRemote 相关流程；使用场景由所在模块及调用位置决定。
   * @param service （Service）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param serviceKey （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param options （{ readonly namespace?: string }）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @returns { readonly service: Service; readonly serviceKey: string;
   * readonly na…；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 bindTypertRemote(service, serviceKey, options)，
   * 并按返回类型处理结果。
   */
  export function bindTypertRemote<Service extends object>(
    service: Service,
    serviceKey: string,
    options?: { readonly namespace?: string },
  ): { readonly service: Service; readonly serviceKey: string; readonly namespace: string }

  /**
   * 功能说明：处理 Remote 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （(this: This, ...args: Args) => Result）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param context （ClassMethodDecoratorContext<This, (this: This, ...args:
   * Arg…）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 Remote(method, context)，并按返回类型处理结果。
   */
  export function Remote<This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): void

  /**
   * 功能说明：处理 Remote 相关流程；使用场景由所在模块及调用位置决定。
   * @param option （string | { readonly mode: 'stream' }）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @returns <This extends object, Args extends unknown[], Result>( method:
   * (this:…；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 Remote(option)，并按返回类型处理结果。
   */
  export function Remote(option: string | { readonly mode: 'stream' }):
  <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void

  /**
   * 功能说明：处理 RemoteScope 相关流程；使用场景由所在模块及调用位置决定。
   * @param key （Extract<keyof TypertContextMap, string>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param exportName （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns <This extends object, Args extends unknown[], Result>( method:
   * (this:…；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 RemoteScope(key, exportName)，并按返回类型处理结果。
   */
  export function RemoteScope(key: Extract<keyof TypertContextMap, string>, exportName?: string):
  <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void
}
