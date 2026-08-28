/**
 * Host Remote owner for the configuration surfaces over the settings-domain
 * seams. Two namespaces: `settings`, the redacted reads and writes of
 * `ctx.settings`, owned by the class below; and `credentials`, mounted from
 * here as its own plugin.
 *
 * @module @deepseek-ai/dsh-api-settings-controller
 * @remarks 文件说明：文件职责：实现 api/settings-controller 中 index 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/settings-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  InvalidPresetIdError,
  PresetExistsError,
  PresetNotWritableError,
  UnknownPresetError,
} from '@deepseek-ai/dsh-agent-presets'
import {
  canOpenNativePath,
  openNativePath,
  openNativeTextFile,
} from '@deepseek-ai/dsh-native-command'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsDescriptor, SettingsPathOp, SettingsProvider } from '@deepseek-ai/dsh-settings'
import type {
  SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-settings/types'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { CredentialsController } from './credentials.ts'
import type { AgentPresetDirectoryOpenValue, SettingsDocumentOpenValue } from './types.ts'

export { CredentialsController } from './credentials.ts'
export type * from './types.ts'

/**
 * 常量说明：settingsNamespaceRequestSchema 用于处理 settingsNamespaceRequestSchema
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const settingsNamespaceRequestSchema = z.object({ ns: z.string().min(1) })

/** Native document-opening policy. */
export interface Config {
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
}

/** Read abort state afresh after an awaited provider or opener call.
 * @remarks 中文说明：功能说明：判断是否为 Aborted 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isAborted(signal)，
 * 并按返回类型处理结果。 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** Host integrations replaceable by direct unit tests. */
export interface SettingsControllerInternals {
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  readonly openTextFile?: (path: string, signal: AbortSignal) => Promise<void>
  readonly canOpenPath?: () => boolean
}

/**
 * Project one redacted descriptor onto its wire view, field by field. The
 * Gateway returns a business result without decoding it, so a provider whose
 * descriptor carried extra enumerable properties would otherwise serialize them
 * to the caller.
 * @param descriptor - one descriptor read under `redactSecrets`.
 * @returns the same facts with nothing else attached.
 * @remarks 中文说明：功能说明：处理 namespaceView 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：descriptor（SettingsDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SettingsNamespaceView；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * namespaceView(descriptor)，并按返回类型处理结果。
 */
function namespaceView(descriptor: SettingsDescriptor): SettingsNamespaceView {
  return {
    ns: String(descriptor.ns),
    schema: descriptor.schema as JsonValue,
    value: descriptor.value as JsonValue,
    ...descriptor.base === undefined ? {} : { base: descriptor.base as JsonValue },
    ...descriptor.user === undefined ? {} : { user: descriptor.user as JsonValue },
    applies: descriptor.applies,
    secrets: (descriptor.secrets ?? []).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：secret（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(secret)，并按返回类型处理结果。
 */ secret => ({ path: [...secret.path], set: secret.set })),
    revision: descriptor.revision,
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `settings` Remote namespace. */
    settingsController: SettingsController
  }
}

/**
 * Host service backing the generated `ctx.remote.settings` namespace. Every
 * remote read uses `redactSecrets: true`, so a `role('secret')` field cannot
 * ride a response. Writes expose the settings service's merge, replacement,
 * and path-addressed operations, and classify every provider refusal as
 * `settings-conflict` or `settings-rejected` with the service's message.
 * @remarks 中文说明：类说明：SettingsController 用于集中封装 处理 SettingsController
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * api/settings-controller 在对应插件或业务生命周期内创建和调用。
 */
export class SettingsController extends TypertRemoteService {
  /**
   * 变量说明：Config 用于处理 Config 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  static Config: Schema<Config> = Schema.object({ nativeOpen: Schema.boolean() })

  /**
   * 常量说明：openPath 用于打开 Path 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly openPath: (path: string, signal: AbortSignal) => Promise<void>
  /**
   * 常量说明：openTextFile 用于打开 Text File 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly openTextFile: (path: string, signal: AbortSignal) => Promise<void>
  /**
   * 常量说明：canOpenPath 用于判断是否能够 Open Path 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly canOpenPath: () => boolean

  /**
   * Register the settings namespace and mount the credentials namespace beside
   * it. Both namespaces stay registered when a provider is absent so calls can
   * return the configuration API's actionable missing-provider diagnostic.
   * @param ctx - Host context where settings and credential providers may be mounted.
   * @remarks 中文说明：功能说明：处理 SettingsController 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
   * 参数说明：config（Config）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 参数说明：internals（SettingsControllerInternals）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * ；返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * SettingsController(ctx, config, internals) 创建实例，并在所属生命周期内使用。
   */
  constructor(ctx: Context, config: Config = {}, internals: SettingsControllerInternals = {}) {
    super(ctx, 'settingsController', { namespace: 'settings' })
    this.openPath = internals.openPath ?? openNativePath
    this.openTextFile = internals.openTextFile ?? openNativeTextFile
    this.canOpenPath = internals.canOpenPath
      ?? (/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => config.nativeOpen ?? (internals.openPath !== undefined || canOpenNativePath()))
    ctx.plugin(CredentialsController)
  }

  /**
   * Describe every registered namespace for a configuration page: redacted
   * layered values plus the serialized schema the page renders its form from.
   * @returns provider writability, local-document presence, and one view per namespace.
   * @throws TypertRemoteFailure when no settings provider is mounted.
   * @remarks 中文说明：功能说明：处理 describe 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：SettingsDescribeValue；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * describe()，并按返回类型处理结果。
   */
  @Remote
  describe(): SettingsDescribeValue {
    /**
     * 常量说明：settings 用于处理 settings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const settings = this.provider()
    return {
      writable: settings.writable,
      hasDocument: settings.documentPath !== undefined,
      namespaces: settings.describe({ redactSecrets: true }).map(namespaceView),
    }
  }

  /**
   * Report whether this deployment can open an authored Agent preset directory natively.
   * @returns true when the matching open operation is available.
   * @remarks 中文说明：功能说明：判断是否能够 Open Agent Preset Directory 相关流程；
   * 使用场景由所在模块及调用位置决定。；返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 canOpenAgentPresetDirectory()，并按返回类型处理结果。
   */
  @Remote
  canOpenAgentPresetDirectory(): boolean {
    return this.canOpenPath()
  }

  /**
   * Merge a patch into one namespace's stored user section.
   * @param ns - namespace key to write.
   * @param patch - fields to merge into the user section.
   * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
   * @returns the namespace's redacted view after the write.
   * @throws TypertRemoteFailure when the request is invalid, no provider is mounted, or the provider refuses the write.
   * @remarks 中文说明：功能说明：更新 update 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ns（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：patch（Record<string,
   * JsonValue>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：expectedRevision（number |
   * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SettingsNamespaceView>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 update(ns, patch, expectedRevision)，并按返回类型处理结果。
   */
  @Remote
  update(
    ns: string,
    patch: Record<string, JsonValue>,
    expectedRevision: number | undefined,
  ): Promise<SettingsNamespaceView> {
    return this.write(ns, 'update', patch, expectedRevision)
  }

  /**
   * Replace one namespace's stored user section wholesale.
   * @param ns - namespace key to write.
   * @param section - complete replacement user section.
   * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
   * @returns the namespace's redacted view after the write.
   * @throws TypertRemoteFailure when the request is invalid, no provider is mounted, or the provider refuses the write.
   * @remarks 中文说明：功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ns（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：section（Record<string, JsonValue>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：expectedRevision（number | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SettingsNamespaceView>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 replace(ns, section, expectedRevision)，并按返回类型处理结果。
   */
  @Remote
  replace(
    ns: string,
    section: Record<string, JsonValue>,
    expectedRevision: number | undefined,
  ): Promise<SettingsNamespaceView> {
    return this.write(ns, 'replace', section, expectedRevision)
  }

  /**
   * Apply path-addressed edits to one namespace's user section, resolved against
   * the section as stored rather than against whatever the caller last read,
   * then answer with that namespace's new redacted view.
   * @param ns - namespace key to write.
   * @param ops - the edits to apply, in order.
   * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
   * @returns the namespace's redacted view after the write.
   * @throws TypertRemoteFailure when the request is invalid, no provider is mounted, or the provider refuses the write.
   * @remarks 中文说明：功能说明：处理 mutate 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ns（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：ops（SettingsPathOpView[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：expectedRevision（number | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SettingsNamespaceView>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 mutate(ns, ops, expectedRevision)，并按返回类型处理结果。
   */
  @Remote
  async mutate(
    ns: string,
    ops: SettingsPathOpView[],
    expectedRevision: number | undefined,
  ): Promise<SettingsNamespaceView> {
    return this.write(ns, 'mutate', ops, expectedRevision)
  }

  /**
   * Materialize the provider-owned settings document and open it in a native text editor.
   * @param signal - caller lifetime; abort terminates preparation or the native command.
   * @returns confirmation after the native opener accepts the document.
   * @throws TypertRemoteFailure when no document exists, preparation fails, or opening fails.
   * @remarks 中文说明：功能说明：打开 Settings Document 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SettingsDocumentOpenValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 openSettingsDocument(signal)，并按返回类型处理结果。
   */
  @Remote
  async openSettingsDocument(signal: AbortSignal): Promise<SettingsDocumentOpenValue> {
    /**
     * 常量说明：settings 用于处理 settings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const settings = this.provider()
    if (isAborted(signal)) throw cancelled('settings document open was aborted')
    /**
     * 变量说明：path 用于处理 path 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let path: string | undefined
    try {
      path = await settings.prepareDocument()
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      if (isAborted(signal)) throw cancelled('settings document preparation was aborted')
      throw internal(`settings document preparation failed: ${messageOf(error)}`)
    }
    if (path === undefined) {
      throw internal('settings provider has no local document to open')
    }
    if (isAborted(signal)) throw cancelled('settings document open was aborted')
    try {
      await this.openTextFile(path, signal)
      return { opened: true }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      if (isAborted(signal)) throw cancelled('settings document open was aborted')
      throw internal(`path open failed: ${messageOf(error)}`)
    }
  }

  /**
   * Open one user-authored Agent preset directory or return its path when no native opener exists.
   * @param agentPreset - preset id resolved against Host-owned roots.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns an opened confirmation or the resolved directory for text display.
   * @throws TypertRemoteFailure when the preset is missing, read-only, invalid, or cannot be opened.
   * @remarks 中文说明：功能说明：打开 Agent Preset Directory 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：agentPreset（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<AgentPresetDirectoryOpenValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 openAgentPresetDirectory(agentPreset, signal)，
   * 并按返回类型处理结果。
   */
  @Remote
  async openAgentPresetDirectory(
    agentPreset: string,
    signal: AbortSignal,
  ): Promise<AgentPresetDirectoryOpenValue> {
    if (agentPreset.length === 0) {
      throw new TypertRemoteFailure({
        code: 'bad-request', message: 'agent preset id must not be empty', details: {},
      })
    }
    /**
     * 常量说明：presets 用于处理 presets 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) {
      throw new TypertRemoteFailure({
        code: 'agent-preset-not-found',
        message: 'this deployment composes no agent presets',
        details: { agentPreset, available: [] },
      })
    }
    /**
     * 变量说明：directory 用于处理 directory 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let directory: string
    try {
      /**
       * 常量说明：preset 用于处理 preset 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const preset = await presets.resolve(agentPreset)
      if (preset.trust !== 'user') {
        throw new PresetNotWritableError(preset.id, 'it ships with the deployment')
      }
      directory = dirname(preset.path)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      throw presetFailure(agentPreset, error)
    }
    if (!this.canOpenPath()) return { opened: false, path: directory }
    try {
      await this.openPath(directory, signal)
      return { opened: true }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      if (signal.aborted) throw cancelled('path open was aborted')
      throw internal(`path open failed: ${messageOf(error)}`)
    }
  }

  /**
   * 功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。
   * @param ns （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param mode （'update' | 'replace' | 'mutate'）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param input （Record<string, JsonValue> |
   * SettingsPathOpView[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param expectedRevision （number | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<SettingsNamespaceView>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 write(ns, mode, input, expectedRevision)，并按返回类型处理结果。
   */
  private async write(
    ns: string,
    mode: 'update' | 'replace' | 'mutate',
    input: Record<string, JsonValue> | SettingsPathOpView[],
    expectedRevision: number | undefined,
  ): Promise<SettingsNamespaceView> {
    /**
     * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parsed = settingsNamespaceRequestSchema.safeParse({ ns })
    if (!parsed.success) {
      throw new TypertRemoteFailure({
        code: 'bad-request',
        message: `invalid payload for settings.${mode}`,
        details: { issues: parsed.error.issues },
      })
    }
    /**
     * 常量说明：settings 用于处理 settings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const settings = this.provider()
    /**
     * 变量说明：branded 用于处理 branded 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let branded
    try {
      // A malformed name can address no registration, so it fails exactly as an
      // unregistered one does.
      branded = settingsNamespace(parsed.data.ns)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      throw rejected(ns, error)
    }
    try {
      if (mode === 'update') await settings.update(branded, input, expectedRevision)
      else if (mode === 'replace') await settings.replace(branded, input, expectedRevision)
      else await settings.mutate(branded, input as SettingsPathOp[], expectedRevision)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      throw rejected(ns, error)
    }
    /**
     * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const descriptor = settings.describe({ redactSecrets: true }).find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
 */ candidate => candidate.ns === branded)
    if (descriptor === undefined) {
      // The write committed but the namespace vanished before this read: only a
      // concurrent registrant disposal can produce it.
      throw new TypertRemoteFailure({
        code: 'internal',
        message: `settings namespace "${ns}" was disposed after the ${mode}`,
        details: {},
      })
    }
    return namespaceView(descriptor)
  }

  /** Resolve the optional provider or report how to supply it.
   * @remarks 中文说明：功能说明：处理 provider 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：SettingsProvider；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * provider()，并按返回类型处理结果。 */
  private provider(): SettingsProvider {
    /**
     * 常量说明：settings 用于处理 settings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      throw new TypertRemoteFailure({
        code: 'internal',
        message: 'settings service is absent: this deployment does not mount a settings provider (e.g. @deepseek-ai/dsh-settings-file) in its composition',
        details: {},
      })
    }
    return settings
  }
}

/**
 * 功能说明：处理 messageOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 messageOf(error)，并按返回类型处理结果。
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 功能说明：处理 internal 相关流程；使用场景由所在模块及调用位置决定。
 * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TypertRemoteFailure；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 internal(message)，并按返回类型处理结果。
 */
function internal(message: string): TypertRemoteFailure {
  return new TypertRemoteFailure({ code: 'internal', message, details: {} })
}

/**
 * 功能说明：处理 cancelled 相关流程；使用场景由所在模块及调用位置决定。
 * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TypertRemoteFailure；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cancelled(message)，并按返回类型处理结果。
 */
function cancelled(message: string): TypertRemoteFailure {
  return new TypertRemoteFailure({ code: 'cancelled', message, details: {} })
}

/**
 * 功能说明：处理 presetFailure 相关流程；使用场景由所在模块及调用位置决定。
 * @param agentPreset （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TypertRemoteFailure；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 presetFailure(agentPreset, error)，并按返回类型处理结果。
 */
function presetFailure(agentPreset: string, error: unknown): TypertRemoteFailure {
  if (error instanceof UnknownPresetError) {
    return new TypertRemoteFailure({
      code: 'agent-preset-not-found',
      message: error.message,
      details: { agentPreset: error.presetId, available: [...error.available] },
    })
  }
  if (error instanceof PresetNotWritableError) {
    return new TypertRemoteFailure({
      code: 'agent-preset-read-only',
      message: error.message,
      details: { agentPreset, reason: error.message },
    })
  }
  if (error instanceof InvalidPresetIdError || error instanceof PresetExistsError) {
    return new TypertRemoteFailure({
      code: 'agent-preset-invalid',
      message: error.message,
      details: { agentPreset, reason: error.message },
    })
  }
  if (error instanceof TypertRemoteFailure) return error
  return internal(`agent preset "${agentPreset}": ${String(error)}`)
}

/**
 * Classify one seam refusal. A stale writer is its own outcome, not a malformed
 * request: the client must re-read and re-apply rather than treat the write as
 * invalid.
 * @param ns - the namespace the write addressed.
 * @param error - whatever the seam threw.
 * @returns the failure to raise for that refusal.
 * @remarks 中文说明：功能说明：处理 rejected 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ns（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TypertRemoteFailure；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * rejected(ns, error)，并按返回类型处理结果。
 */
function rejected(ns: string, error: unknown): TypertRemoteFailure {
  if (error instanceof SettingsConflictError) {
    return new TypertRemoteFailure({
      code: 'settings-conflict',
      message: error.message,
      details: { ns, expected: error.expected, actual: error.actual },
    })
  }
  return new TypertRemoteFailure({
    code: 'settings-rejected',
    message: error instanceof Error ? error.message : String(error),
    details: { ns },
  })
}

export default SettingsController
