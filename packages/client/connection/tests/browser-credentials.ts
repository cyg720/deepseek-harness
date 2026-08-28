/**
 * 文件职责：验证 client/connection 中 browser credentials 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'

/** Mutable credential-record double for Connection authentication tests.
 * @remarks 中文说明：类说明：RecordCredentials 用于集中封装 处理 RecordCredentials 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 client/connection
 * 在对应插件或业务生命周期内创建和调用。 */
export class RecordCredentials {
  /**
   * 变量说明：record 用于处理 record 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  record: CredentialRecord | undefined
  /**
   * 变量说明：discardWrites 用于处理 discardWrites 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  discardWrites = false
  /**
   * 变量说明：reads 用于处理 reads 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  reads = 0
  /**
   * 变量说明：modifies 用于处理 modifies 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  modifies = 0

  /**
   * 功能说明：读取 Record 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<CredentialRecord | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 readRecord()，并按返回类型处理结果。
   */
  readRecord(): Promise<CredentialRecord | undefined> {
    this.reads += 1
    return Promise.resolve(this.record)
  }

  /**
   * 功能说明：处理 modifyRecord 相关流程；使用场景由所在模块及调用位置决定。
   * @param _key （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param mutate （(current: CredentialRecord | undefined) =>
   * Promise<Credenti…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<CredentialRecord | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 modifyRecord(_key, mutate)，并按返回类型处理结果。
   */
  async modifyRecord(
    _key: unknown,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    this.modifies += 1
    /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const next = await mutate(this.record)
    if (this.discardWrites) return undefined
    if (next !== undefined) this.record = next
    return this.record
  }

  /**
   * 功能说明：删除 Record 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 deleteRecord()，并按返回类型处理结果。
   */
  deleteRecord(): Promise<void> {
    this.record = undefined
    return Promise.resolve()
  }
}

/** Provide the record operations Connection needs during authentication setup.
 * @remarks 中文说明：功能说明：处理 provideBrowserCredentials 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * provideBrowserCredentials(ctx)，并按返回类型处理结果。 */
export function provideBrowserCredentials(ctx: Context): void {
  ctx.provide('credentials', new RecordCredentials() as unknown as CredentialProvider)
}
