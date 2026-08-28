/**
 * Host owner of the `credentials` Remote namespace: the reference half of
 * `ctx.credentials` as a browser configuration page reads and writes it.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/credentials.ts
 * @remarks 文件说明：文件职责：实现 api/settings-controller 中 credentials 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/settings-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

/**
 * Fan-out bound on one remote `describe` batch. A settings page asks about the
 * references its own rows name, so this is far above any real page and still
 * keeps one authenticated request from starting unbounded provider work.
 * @remarks 中文说明：常量说明：MAX_DESCRIBE_REFS 用于处理 MAX_DESCRIBE_REFS 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MAX_DESCRIBE_REFS = 64

/**
 * 常量说明：credentialRefSchema 用于处理 credentialRefSchema 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const credentialRefSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
/**
 * 常量说明：describeRequestSchema 用于处理 describeRequestSchema 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const describeRequestSchema = z.object({
  refs: z.array(credentialRefSchema).max(MAX_DESCRIBE_REFS),
})
/**
 * 常量说明：setRequestSchema 用于设置 Request Schema 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const setRequestSchema = z.object({ ref: credentialRefSchema, value: z.string().min(1) })
/**
 * 常量说明：unsetRequestSchema 用于处理 unsetRequestSchema 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const unsetRequestSchema = z.object({ ref: credentialRefSchema })

/** Parse the domain constraints that are more specific than generated TypeScript codecs.
 * @remarks 中文说明：功能说明：解析 Request 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：method（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：schema（z.ZodType<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：T；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseRequest(method, schema, value)，
 * 并按返回类型处理结果。 */
function parseRequest<T>(method: string, schema: z.ZodType<T>, value: unknown): T {
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new TypertRemoteFailure({
      code: 'bad-request',
      message: `invalid payload for ${method}`,
      details: { issues: parsed.error.issues },
    })
  }
  return parsed.data
}

/**
 * Copy exactly the fields {@link CredentialInfo} declares. The Gateway returns
 * a business result without decoding it, so a provider whose `describe` carried
 * extra enumerable properties would otherwise serialize them to the caller.
 * @param info - the provider's answer for one reference.
 * @returns the same facts with nothing else attached.
 * @remarks 中文说明：功能说明：处理 projectCredentialInfo 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：info（CredentialInfo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：CredentialInfo；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * projectCredentialInfo(info)，并按返回类型处理结果。
 */
function projectCredentialInfo(info: CredentialInfo): CredentialInfo {
  return {
    configured: info.configured,
    ...info.source === undefined ? {} : { source: info.source },
    writable: info.writable,
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `credentials` Remote namespace. */
    credentialsController: CredentialsController
  }
}

/**
 * Host service backing the generated `ctx.remote.credentials` namespace. It
 * carries every wire obligation the credential seam itself does not: the batch
 * fan-out bound, the field-by-field view projection, the reference-grammar
 * guard, and the refusal mapping. Secret values cross in one direction only —
 * no method here returns one.
 * @remarks 中文说明：类说明：CredentialsController 用于集中封装 处理 CredentialsController
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * api/settings-controller 在对应插件或业务生命周期内创建和调用。
 */
export class CredentialsController extends TypertRemoteService {
  /** @param ctx - Host context where a credential provider may be mounted.
   * @remarks 中文说明：功能说明：处理 CredentialsController 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new CredentialsController(ctx)
   * 创建实例，并在所属生命周期内使用。 */
  constructor(ctx: Context) {
    super(ctx, 'credentialsController', { namespace: 'credentials' })
  }

  /**
   * Describe several references for one configuration surface. Batched because
   * a settings page describes every reference its rows name at once, and one
   * round trip keeps those rows from settling separately.
   * @param refs - reference names, at most {@link MAX_DESCRIBE_REFS}; a name outside the grammar rejects the whole call as `bad-request`.
   * @returns one view per requested name, keyed by that name.
   * @throws TypertRemoteFailure when the request is invalid or no credential provider is mounted.
   * @remarks 中文说明：功能说明：处理 describe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：refs（string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<Record<string, CredentialInfo>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 describe(refs)，并按返回类型处理结果。
   */
  @Remote
  async describe(refs: string[]): Promise<Record<string, CredentialInfo>> {
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = parseRequest('credentials.describe', describeRequestSchema, { refs })
    /**
     * 常量说明：branded 用于处理 branded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const branded = request.refs.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ref（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ref)，并按返回类型处理结果。
 */ ref => [ref, credentialRef(ref)] as const)
    /**
     * 常量说明：credentials 用于处理 credentials 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const credentials = this.provider()
    /**
     * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entries = await Promise.all(branded.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[ref, key]（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([ref, key])，并按返回类型处理结果。
 */ async ([ref, key]) =>
        [ref, projectCredentialInfo(await credentials.describe(key))] as const))
    return Object.fromEntries(entries)
  }

  /**
   * Store one value from a configuration surface. The value crosses the wire in
   * this direction only: no read path returns it.
   * @param ref - reference name to store under.
   * @param value - the non-empty secret value.
   * @throws TypertRemoteFailure when the request is invalid, no provider is mounted, or the provider refuses the write.
   * @remarks 中文说明：功能说明：设置 set 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ref（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 set(ref, value)，
   * 并按返回类型处理结果。
   */
  @Remote
  async set(ref: string, value: string): Promise<void> {
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = parseRequest('credentials.set', setRequestSchema, { ref, value })
    /**
     * 常量说明：branded 用于处理 branded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const branded = credentialRef(request.ref)
    /**
     * 常量说明：credentials 用于处理 credentials 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const credentials = this.provider()
    await this.write(request.ref, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => credentials.set(branded, request.value))
  }

  /**
   * Remove one reference from a configuration surface.
   * @param ref - reference name to remove.
   * @throws TypertRemoteFailure when the request is invalid, no provider is mounted, or the provider refuses the write.
   * @remarks 中文说明：功能说明：处理 unset 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ref（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 unset(ref)，并按返回类型处理结果。
   */
  @Remote
  async unset(ref: string): Promise<void> {
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = parseRequest('credentials.unset', unsetRequestSchema, { ref })
    /**
     * 常量说明：branded 用于处理 branded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const branded = credentialRef(request.ref)
    /**
     * 常量说明：credentials 用于处理 credentials 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const credentials = this.provider()
    await this.write(request.ref, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => credentials.unset(branded))
  }

  /** Resolve the optional provider or report how to supply it.
   * @remarks 中文说明：功能说明：处理 provider 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：CredentialProvider；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * provider()，并按返回类型处理结果。 */
  private provider(): CredentialProvider {
    /**
     * 常量说明：credentials 用于处理 credentials 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) {
      throw new TypertRemoteFailure({
        code: 'internal',
        message: 'credentials service is absent: this deployment does not mount a credential provider (e.g. @deepseek-ai/dsh-credentials-local) in its composition',
        details: {},
      })
    }
    return credentials
  }

  /**
   * Run one remote write and report every refusal as `credential-rejected`
   * carrying the seam's own message: a read-only source shadowing the reference
   * is what a configuration surface must show verbatim. Callers brand the
   * reference before entering, so a name outside the grammar never reaches this
   * path and fails the same way it does on the read side. The details name only
   * the reference, so no failure path can carry the value back out.
   * @remarks 中文说明：功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ref（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：write（() =>
   * Promise<void>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 write(ref, write)，
   * 并按返回类型处理结果。
   */
  private async write(ref: string, write: () => Promise<void>): Promise<void> {
    try {
      await write()
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      throw new TypertRemoteFailure({
        code: 'credential-rejected',
        message: error instanceof Error ? error.message : String(error),
        details: { ref },
      })
    }
  }
}

export default CredentialsController
