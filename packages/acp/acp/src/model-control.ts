/** Standard ACP session configuration over one Agent's model selection.
 * @remarks 文件说明：文件职责：实现 acp/acp 中 model control 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 acp/acp 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionConfigOption, SessionConfigValueId } from '@agentclientprotocol/sdk'
import { installModelSelection, type ModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type LlmCallConfig, type LlmRuntime } from '@deepseek-ai/dsh-llm'

/**
 * 常量说明：MODEL_CONFIG_ID 用于处理 MODEL_CONFIG_ID 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const MODEL_CONFIG_ID = 'model'
/**
 * 常量说明：REASONING_CONFIG_ID 用于处理 REASONING_CONFIG_ID 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const REASONING_CONFIG_ID = 'reasoning_effort'
// DSH reasoning effort ids are non-empty, so the empty opaque ACP value is a disjoint provider-default choice.
/**
 * 常量说明：PROVIDER_DEFAULT_REASONING_VALUE 用于处理
 * PROVIDER_DEFAULT_REASONING_VALUE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const PROVIDER_DEFAULT_REASONING_VALUE = ''

interface ModelChoice {
  selection: ModelSelection
  value: SessionConfigValueId
}

interface ConfigState {
  choices: Map<SessionConfigValueId, ModelSelection>
  options: SessionConfigOption[]
}

/** Caller-correctable session configuration failure.
 * @remarks 中文说明：类说明：AcpModelConfigError 用于集中封装 处理 AcpModelConfigError
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 acp/acp
 * 在对应插件或业务生命周期内创建和调用。 */
export class AcpModelConfigError extends Error {
  /**
   * 功能说明：处理 AcpModelConfigError 相关流程；使用场景由所在模块及调用位置决定。
   * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new AcpModelConfigError(message) 创建实例，并在所属生命周期内使用。
   */
  constructor(message: string) {
    super(message)
    this.name = 'AcpModelConfigError'
  }
}

/** Project and mutate one Agent's provider/model/reasoning selection through ACP config options.
 * @remarks 中文说明：类说明：AcpModelControl 用于集中封装 处理 AcpModelControl 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 acp/acp 在对应插件或业务生命周期内创建和调用。 */
export class AcpModelControl {
  /** Scoped selection reference consumed by Agent request assembly.
   * @remarks 中文说明：常量说明：selection 用于处理 selection 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly selection: ModelSelectionRef
  /**
   * 变量说明：tail 用于处理 tail 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private tail = Promise.resolve()
  /**
   * 变量说明：selected 用于处理 selected 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private selected: ModelSelection | undefined
  /**
   * 变量说明：turnSelection 用于处理 turnSelection 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private turnSelection: { turn: number; selection: ModelSelection } | undefined
  /**
   * 变量说明：hasResolvedState 用于判断是否包含 Resolved State 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private hasResolvedState = false

  /**
   * 功能说明：处理 AcpModelControl 相关流程；使用场景由所在模块及调用位置决定。
   * @param llm （LlmRuntime）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param initial （ModelSelection | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new AcpModelControl(llm, initial) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly llm: LlmRuntime,
    initial: ModelSelection | undefined,
  ) {
    this.selected = initial
    /**
     * 常量说明：getCurrent 用于获取 Current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：获取 Current 相关流程；使用场景由所在模块及调用位置决定。
     * @returns ModelSelection | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 getCurrent()，并按返回类型处理结果。
     */
    const getCurrent = (): ModelSelection | undefined => this.turnSelection?.selection ?? this.selected
    /**
     * 常量说明：setCurrent 用于设置 Current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：设置 Current 相关流程；使用场景由所在模块及调用位置决定。
     * @param value （ModelSelection | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 setCurrent(value)，并按返回类型处理结果。
     */
    const setCurrent = (value: ModelSelection | undefined): void => { this.selected = value }
    this.selection = {
      /**
       * 功能说明：处理 current 相关流程；使用场景由所在模块及调用位置决定。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 current()，并按返回类型处理结果。
       */
      get current() { return getCurrent() },
      /**
       * 功能说明：处理 current 相关流程；使用场景由所在模块及调用位置决定。
       * @param value （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 current(value)，并按返回类型处理结果。
       */
      set current(value) { setCurrent(value) },
      assembled: undefined,
    }
  }

  /**
   * Install request/prompt consistency listeners in the unpublished Agent scope.
   * @param agentCtx - Agent scope that consumes this selection.
   * @remarks 中文说明：功能说明：处理 install 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：agentCtx（Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 install(agentCtx)，
   * 并按返回类型处理结果。
   */
  install(agentCtx: Context): void {
    installModelSelection(agentCtx, this.selection)
  }

  /**
   * Snapshot the selection attached to the next accepted ACP prompt.
   * @returns a detached future selection, or undefined when listeners supply the route.
   * @remarks 中文说明：功能说明：处理 snapshot 相关流程；使用场景由所在模块及调用位置决定。；返回值：ModelSelection
   * | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 snapshot()，
   * 并按返回类型处理结果。
   */
  snapshot(): ModelSelection | undefined {
    return this.selected === undefined ? undefined : { ...this.selected }
  }

  /**
   * Pin one admitted ACP message's selection for every step in its turn.
   * @param turn - admitted Agent turn.
   * @param selection - exact prompt-admission selection.
   * @remarks 中文说明：功能说明：处理 pinTurn 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：turn（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：selection（ModelSelection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 pinTurn(turn, selection)，
   * 并按返回类型处理结果。
   */
  pinTurn(turn: number, selection: ModelSelection): void {
    this.turnSelection = { turn, selection: { ...selection } }
  }

  /**
   * Release only the exact completed turn's routing override.
   * @param turn - completed Agent turn.
   * @remarks 中文说明：功能说明：处理 releaseTurn 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：turn（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseTurn(turn)，并按返回类型处理结果。
   */
  releaseTurn(turn: number): void {
    if (this.turnSelection?.turn === turn) this.turnSelection = undefined
  }

  /**
   * Return the complete standard config-option state after prior mutations settle.
   * @param signal - optional catalog and exact-model cancellation.
   * @returns all current standard configuration options.
   * @remarks 中文说明：功能说明：处理 options 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionConfigOption[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 options(signal)，并按返回类型处理结果。
   */
  options(signal?: AbortSignal): Promise<SessionConfigOption[]> {
    return this.serialize(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => (await this.state(signal)).options)
  }

  /**
   * Set one advertised option and return the complete resulting option state.
   * @param configId - standard option id.
   * @param value - opaque selected value returned by a previous option state.
   * @param signal - optional catalog and exact-model cancellation.
   * @returns all standard options after the serialized mutation.
   * @remarks 中文说明：功能说明：设置 set 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：configId（string）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionConfigOption[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 set(configId, value, signal)，并按返回类型处理结果。
   */
  set(configId: string, value: unknown, signal?: AbortSignal): Promise<SessionConfigOption[]> {
    return this.serialize(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        if (typeof value !== 'string') throw new AcpModelConfigError(`${configId} requires a select value`)
        /**
       * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const current = this.selected
        if (current === undefined) throw new AcpModelConfigError('this session has no model selection')
        if (configId === MODEL_CONFIG_ID) {
        /**
         * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const state = await this.state(signal)
          /**
         * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const selected = state.choices.get(value)
          if (selected === undefined) throw new AcpModelConfigError(`unknown model option: ${value}`)
          await this.resolveSelection(selected, signal)
          this.selected = selected
        } else if (configId === REASONING_CONFIG_ID) {
        /**
         * 常量说明：info 用于处理 info 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const info = await this.llm.resolveModelInfo(current.provider, current.model, signal)
          /**
         * 常量说明：providerDefault 用于处理 providerDefault 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
          const providerDefault = value === PROVIDER_DEFAULT_REASONING_VALUE
          && info.reasoning?.defaultEffort === undefined
          if (
            info.reasoning === undefined
          || (!providerDefault && !info.reasoning.efforts.some(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：effort（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(effort)，并按返回类型处理结果。
 */ effort => effort.id === value))
          ) {
            throw new AcpModelConfigError(`unknown reasoning effort for ${current.provider}/${current.model}: ${value}`)
          }
          this.selected = await this.resolveSelection({
            provider: current.provider,
            model: current.model,
            ...providerDefault ? {} : { reasoningEffort: ReasoningEffortId(value) },
          }, signal)
        } else {
          throw new AcpModelConfigError(`unknown session config option: ${configId}`)
        }
        return (await this.state(signal)).options
      })
  }

  /** Keep concurrent client mutations in receive order without wedging after rejection.
   * @remarks 中文说明：功能说明：序列化 serialize 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：operation（() => Promise<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<T>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * serialize(operation)，并按返回类型处理结果。 */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = this.tail.then(operation)
    this.tail = result.then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined)
    return result
  }

  /** Build detached model choices and the dependent reasoning option.
   * @remarks 中文说明：功能说明：处理 state 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ConfigState>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * state(signal)，并按返回类型处理结果。 */
  private async state(signal?: AbortSignal): Promise<ConfigState> {
    /**
     * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selected = this.selected
    if (selected === undefined) return { choices: new Map(), options: [] }
    /**
     * 变量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let resolved: ModelSelection
    /**
     * 变量说明：routeAvailable 用于处理 routeAvailable 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let routeAvailable = true
    try {
      resolved = await this.resolveSelection(selected, signal)
      this.hasResolvedState = true
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      if (!this.hasResolvedState) throw error
      resolved = selected
      routeAvailable = false
    }
    /**
     * 常量说明：choices 用于处理 choices 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const choices = new Map<SessionConfigValueId, ModelSelection>()
    /**
     * 常量说明：groups 用于处理 groups 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const groups = await Promise.all(this.llm.listProviders().map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：provider（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(provider)，并按返回类型处理结果。
 */ async (provider) => {
        try {
        /**
         * 常量说明：models 用于处理 models 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const models = await this.llm.listModels(provider.id)
          /**
         * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const entries = models.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：model（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(model)，并按返回类型处理结果。
 */ (model) => {
              /**
           * 常量说明：choice 用于处理 choice 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
              const choice: ModelChoice = {
                value: modelValue(provider.id, model.id),
                selection: { provider: provider.id, model: model.id },
              }
              choices.set(choice.value, choice.selection)
              return {
                value: choice.value,
                name: model.name,
                ...model.description === undefined ? {} : { description: model.description },
              }
            })
          return { group: provider.id, name: provider.name, options: entries }
        } catch (/*
 * 变量说明：_providerCatalogUnavailable 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ _providerCatalogUnavailable) {
          return { group: provider.id, name: provider.name, options: [] }
        }
      }))
    /**
     * 常量说明：currentValue 用于处理 currentValue 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const currentValue = modelValue(resolved.provider, resolved.model)
    if (!choices.has(currentValue)) {
      choices.set(currentValue, { provider: resolved.provider, model: resolved.model })
      /**
       * 变量说明：group 用于处理 group 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let group = groups.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
 */ item => item.group === resolved.provider)
      if (group === undefined) {
        group = { group: resolved.provider, name: resolved.provider, options: [] }
        groups.push(group)
      }
      group.options.unshift({ value: currentValue, name: resolved.model })
    }
    /**
     * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const options: SessionConfigOption[] = [{
      id: MODEL_CONFIG_ID,
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue,
      options: groups.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：group（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(group)，并按返回类型处理结果。
 */ group => group.options.length > 0),
    }]
    /**
     * 常量说明：info 用于处理 info 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const info = routeAvailable
      ? await this.llm.resolveModelInfo(resolved.provider, resolved.model, signal)
      : undefined
    if (info?.reasoning !== undefined) {
      options.push({
        id: REASONING_CONFIG_ID,
        name: 'Reasoning effort',
        category: 'thought_level',
        type: 'select',
        currentValue: resolved.reasoningEffort === undefined
          ? PROVIDER_DEFAULT_REASONING_VALUE
          : String(resolved.reasoningEffort),
        options: [
          ...info.reasoning.defaultEffort === undefined
            ? [{ value: PROVIDER_DEFAULT_REASONING_VALUE, name: 'Provider default' }]
            : [],
          ...info.reasoning.efforts.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：effort（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(effort)，并按返回类型处理结果。
 */ effort => ({
              value: String(effort.id),
              name: effort.name,
              ...effort.description === undefined ? {} : { description: effort.description },
            })),
        ],
      })
    }
    return { choices, options }
  }

  /** Validate an exact route and retain only Agent-owned selection fields.
   * @remarks 中文说明：功能说明：解析 Selection 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：selection（ModelSelection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ModelSelection>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 resolveSelection(selection, signal)，并按返回类型处理结果。 */
  private async resolveSelection(selection: ModelSelection, signal?: AbortSignal): Promise<ModelSelection> {
    /**
     * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const resolved: LlmCallConfig = await this.llm.resolveCallConfig(selection, signal)
    return {
      provider: resolved.provider,
      model: resolved.model,
      ...resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort },
    }
  }
}

/** Opaque ACP selector value carrying the full route identity.
 * @remarks 中文说明：功能说明：处理 modelValue 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：provider（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：model（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SessionConfigValueId；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * modelValue(provider, model)，并按返回类型处理结果。 */
function modelValue(provider: string, model: string): SessionConfigValueId {
  return JSON.stringify([provider, model])
}
