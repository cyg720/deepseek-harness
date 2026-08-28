/**
 * Host directory-picking Remote owner: capability gating, cancellation, and the
 * stable wire failure vocabulary over the `ctx.directoryPicker` seam.
 * @remarks 文件说明：文件职责：实现 api/workspace-controller 中 directory picker 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/workspace-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapabilities } from '@deepseek-ai/dsh-host-directory-picker'
// The seam owns the listing declaration; the generator requires the reference
// site to name that package rather than this package's re-export of it.
import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { DirectoryPickerErrorDetailsMap } from './types.ts'

/**
 * 常量说明：createDirectoryRequestSchema 用于创建 Directory Request Schema 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const createDirectoryRequestSchema = z.object({
  path: z.string(),
  name: z.string(),
}).refine(
  /*
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
   * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
   */ request => request.name.trim() !== '' && request.name !== '.' && request.name !== '..'
    && !/[/\\]/.test(request.name),
  { message: 'host.createDirectory requires a single non-blank path segment name' },
)

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host directory-picking Remote namespace owner. */
    directoryPickerController: DirectoryPickerController
  }
}

/**
 * Host service backing the generated `ctx.remote.directoryPicker` namespace. The
 * seam it exports is abstract and therefore never a Loader entry of its own, so
 * this controller carries the wire verbs: one composed backend serves either the
 * native chooser or the browse primitives, and a verb the composition cannot
 * serve is refused rather than approximated.
 * @remarks 中文说明：类说明：DirectoryPickerController 用于集中封装 处理
 * DirectoryPickerController 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 api/workspace-controller 在对应插件或业务生命周期内创建和调用。
 */
export class DirectoryPickerController extends TypertRemoteService {
  /**
   * 变量说明：inject 用于处理 inject 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  static inject = ['directoryPicker']

  /** @param ctx - Host context carrying the composed directory-picking backend.
   * @remarks 中文说明：功能说明：处理 DirectoryPickerController 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * DirectoryPickerController(ctx) 创建实例，并在所属生命周期内使用。 */
  constructor(ctx: Context) {
    super(ctx, 'directoryPickerController', { namespace: 'directoryPicker' })
  }

  /**
   * Open the host's OS chooser for a Remote caller.
   * @param signal - caller lifetime; abort terminates the chooser.
   * @returns the chosen absolute path, or null when the operator cancels.
   * @remarks 中文说明：功能说明：处理 pick 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：Promise<string
   * | null>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 pick(signal)，
   * 并按返回类型处理结果。
   */
  @Remote('pick')
  async pick(signal: AbortSignal): Promise<string | null> {
    /**
     * 常量说明：capability 用于处理 capability 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const capability = this.requireCapability('native', 'pick')
    try {
      return await capability.pick(signal)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      throw cancellableFailure(error, signal, 'directory picker was aborted', 'directory picker failed')
    }
  }

  /**
   * List one directory level for a Remote caller's in-app browser.
   * @param path - absolute directory to list; absent lists the home directory.
   * @param signal - caller lifetime; abort stops the backend's scan instead of
   *   letting it outlive a disconnected caller.
   * @returns the level's listing with its ancestry.
   * @remarks 中文说明：功能说明：列出 list 相关流程；使用场景由所在模块及调用位置决定。；参数说明：path（string |
   * undefined）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<DirectoryListing>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 list(path, signal)，并按返回类型处理结果。
   */
  @Remote('list')
  async list(path: string | undefined, signal: AbortSignal): Promise<DirectoryListing> {
    /**
     * 常量说明：capability 用于处理 capability 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const capability = this.requireCapability('browse', 'list')
    try {
      return await capability.list(path, signal)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      throw cancellableFailure(error, signal, 'directory listing was aborted')
    }
  }

  /**
   * Create one child directory for a Remote caller's in-app browser.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment.
   * @returns the created directory's absolute path.
   * @remarks 中文说明：功能说明：创建 Directory 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<string>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 createDirectory(path,
   * name)，并按返回类型处理结果。
   */
  @Remote('createDirectory')
  async createDirectory(path: string, name: string): Promise<string> {
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = createDirectoryRequestSchema.safeParse({ path, name })
    if (!request.success) {
      throw pickerFailureOf(
        'bad-request',
        'invalid payload for host.createDirectory',
        { issues: request.error.issues },
      )
    }
    /**
     * 常量说明：capability 用于处理 capability 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const capability = this.requireCapability('browse', 'createDirectory')
    try {
      return await capability.createDirectory(request.data.path, request.data.name)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      throw browseFailure(error)
    }
  }

  /** Resolve the capability one wire verb needs, or refuse with the kind this backend serves.
   * @remarks 中文说明：功能说明：处理 requireCapability 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：kind（Kind）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：method（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：DirectoryPickerCapabilities[Kind]；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 requireCapability(kind, method)，并按返回类型处理结果。 */
  private requireCapability<Kind extends keyof DirectoryPickerCapabilities>(
    kind: Kind,
    method: string,
  ): DirectoryPickerCapabilities[Kind] {
    /**
     * 常量说明：capability 用于处理 capability 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const capability = this.ctx.directoryPicker.capability()
    if (capability.kind !== kind) {
      throw pickerFailureOf(
        'directory-picker-unavailable',
        `directoryPicker.${method} needs the ${kind} capability; the composed picker serves "${capability.kind}"`,
        { capability: capability.kind },
      )
    }
    return capability as DirectoryPickerCapabilities[Kind]
  }
}

/**
 * Raise one entry of the picking wire failure vocabulary.
 * @param code - the failure code a caller discriminates on.
 * @param message - operator-facing description.
 * @param details - the payload this code carries.
 * @returns the failure to throw across the Remote boundary.
 * @remarks 中文说明：功能说明：处理 pickerFailureOf 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：code（Code）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：message（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：details（DirectoryPickerErrorDetailsMap[Code]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：TypertRemoteFailure；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 pickerFailureOf(code, message, details)，并按返回类型处理结果。
 */
function pickerFailureOf<Code extends keyof DirectoryPickerErrorDetailsMap>(
  code: Code,
  message: string,
  details: DirectoryPickerErrorDetailsMap[Code],
): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}

/**
 * Classify a browse-primitive rejection: the seam's own closed codes carry the
 * path they are about, and anything else stays an infrastructure failure.
 * @param error - the primitive's rejection.
 * @returns the failure to throw across the Remote boundary.
 * @remarks 中文说明：功能说明：处理 browseFailure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TypertRemoteFailure；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * browseFailure(error)，并按返回类型处理结果。
 */
function browseFailure(error: unknown): TypertRemoteFailure {
  if (error instanceof DirectoryPickerError) {
    return pickerFailureOf(error.code, error.message, { path: error.path })
  }
  return pickerFailureOf('internal', errorMessage(error), {})
}

/**
 * Classify a cancellable primitive's rejection. An abort is the caller's own
 * timeout or disconnect, not a backend failure, so it answers `cancelled`
 * before the business classification runs.
 * @param error - the primitive's rejection.
 * @param signal - the caller lifetime the primitive ran under.
 * @param cancelled - operator-facing text for the abort outcome.
 * @param failed - prefix for a non-seam failure, when the verb has no closed codes.
 * @returns the failure to throw across the Remote boundary.
 * @remarks 中文说明：功能说明：处理 cancellableFailure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
 * 参数说明：cancelled（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：failed（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TypertRemoteFailure；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * cancellableFailure(error, signal, cancelled, failed)，并按返回类型处理结果。
 */
function cancellableFailure(
  error: unknown,
  signal: AbortSignal,
  cancelled: string,
  failed?: string,
): TypertRemoteFailure {
  if (signal.aborted) return pickerFailureOf('cancelled', cancelled, {})
  if (failed === undefined) return browseFailure(error)
  return pickerFailureOf('internal', `${failed}: ${errorMessage(error)}`, {})
}

/**
 * 功能说明：处理 errorMessage 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 errorMessage(error)，并按返回类型处理结果。
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
