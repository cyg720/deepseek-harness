/**
 * 文件职责：验证 webhook/webhook 中 session spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WebhookDeliveryId,
  WebhookRuleId,
  WebhookSourceId,
  type VerifiedWebhookDelivery,
  type WebhookSessionRequest,
} from '../src/index.ts'
import { createWebhookSession } from '../src/session.ts'

interface HarnessOptions {
  failAt?: 'permission-resolve' | 'preset-resolve' | 'standing' | 'workspace' | 'agent' | 'attach' | 'permission-set' | 'title' | 'followup'
  failDetach?: boolean
  failDispose?: boolean
  abortAt?: 'workspace' | 'agent'
}

interface SessionHarness {
  readonly ctx: Context
  readonly calls: string[]
  readonly messages: unknown[]
  readonly modelListeners: Map<string, unknown>
  /**
   * 功能说明：处理 markRequestHeader 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 markRequestHeader()，并按返回类型处理结果。
   */
  markRequestHeader(): void
  readonly controller: AbortController
  readonly request: WebhookSessionRequest
}

/**
 * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const active: SessionHarness[] = []

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => {
  active.length = 0
})

/** Build a same-process fake around the private creation transaction.
 * @remarks 中文说明：功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（HarnessOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：SessionHarness；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * harness(options)，并按返回类型处理结果。 */
function harness(options: HarnessOptions = {}): SessionHarness {
  /**
   * 常量说明：calls 用于处理 calls 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const calls: string[] = []
  /**
   * 常量说明：messages 用于处理 messages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const messages: unknown[] = []
  /**
   * 常量说明：modelListeners 用于处理 modelListeners 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const modelListeners = new Map<string, unknown>()
  /**
   * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const controller = new AbortController()
  /**
   * 变量说明：requestHeader 用于处理 requestHeader 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let requestHeader: object | undefined
  /**
   * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const session = {
    id: 'webhook-session',
    header: { cwd: '/workspace' },
    requestHeader: () => requestHeader,
  }
  /**
   * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const agent = {
    id: 'webhook-session',
    session,
    /**
     * 功能说明：处理 followup 相关流程；使用场景由所在模块及调用位置决定。
     * @param message （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 followup(message)，并按返回类型处理结果。
     */
    followup(message: unknown) {
      calls.push('followup')
      if (options.failAt === 'followup') throw new Error('followup failed')
      messages.push(message)
    },
  }
  /**
   * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const handle = {
    agent,
    /**
     * 功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 dispose()，并按返回类型处理结果。
     */
    async dispose() {
      calls.push('dispose')
      if (options.failDispose) throw new Error('dispose failed')
    },
  }
  /**
   * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const workspace = {
    path: '/workspace',
    /**
     * 功能说明：处理 attachSession 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 attachSession()，并按返回类型处理结果。
     */
    async attachSession() {
      calls.push('attach')
      if (options.failAt === 'attach') throw new Error('attach failed')
    },
    /**
     * 功能说明：处理 detachSession 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 detachSession()，并按返回类型处理结果。
     */
    async detachSession() {
      calls.push('detach')
      if (options.failDetach) throw new Error('detach failed')
    },
  }
  /**
   * 常量说明：fake 用于处理 fake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fake = {
    logger: { warn: vi.fn() },
    permissionPresets: {
      /**
       * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
       * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 resolve(name)，并按返回类型处理结果。
       */
      resolve(name: string) {
        calls.push(`permission-resolve:${name}`)
        if (options.failAt === 'permission-resolve') throw new Error('permission resolve failed')
        return {}
      },
      /**
       * 功能说明：设置 set 相关流程；使用场景由所在模块及调用位置决定。
       * @param _session （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 set(_session, name)，并按返回类型处理结果。
       */
      set(_session: unknown, name: string) {
        calls.push(`permission-set:${name}`)
        if (options.failAt === 'permission-set') throw new Error('permission set failed')
      },
    },
    agentDefaultModel: {
      /**
       * 功能说明：处理 currentSelection 相关流程；使用场景由所在模块及调用位置决定。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 currentSelection()，并按返回类型处理结果。
       */
      currentSelection() {
        calls.push('default-model')
        return { provider: 'default-provider', model: 'default-model', reasoningEffort: 'high' }
      },
    },
    agentPresets: {
      /**
       * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
       * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 resolve(name)，并按返回类型处理结果。
       */
      async resolve(name: string) {
        calls.push(`preset-resolve:${name}`)
        if (options.failAt === 'preset-resolve') throw new Error('preset resolve failed')
        return { id: name }
      },
      /**
       * 功能说明：处理 standingKeyFor 相关流程；使用场景由所在模块及调用位置决定。
       * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 standingKeyFor(name)，并按返回类型处理结果。
       */
      async standingKeyFor(name: string) {
        calls.push(`standing:${name}`)
        if (options.failAt === 'standing') throw new Error('standing failed')
        return {}
      },
      /**
       * 功能说明：处理 mount 相关流程；使用场景由所在模块及调用位置决定。
       * @param _agentCtx （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 mount(_agentCtx, name)，并按返回类型处理结果。
       */
      async mount(_agentCtx: unknown, name: string) {
        calls.push(`mount:${name}`)
        return { id: name }
      },
    },
    workspaceRegistry: {
      /**
       * 功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。
       * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 create(path)，并按返回类型处理结果。
       */
      async create(path: string) {
        calls.push(`workspace:${path}`)
        if (options.failAt === 'workspace') throw new Error('workspace failed')
        if (options.abortAt === 'workspace') controller.abort(new Error('abort after workspace'))
        return workspace
      },
    },
    agents: {
      /**
       * 功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。
       * @param createOptions （{ setup?: (ctx: unknown) => Promise<void>
       * }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 create(createOptions)，并按返回类型处理结果。
       */
      async create(createOptions: { setup?: (ctx: unknown) => Promise<void> }) {
        calls.push('agent-create')
        if (options.failAt === 'agent') throw new Error('agent failed')
        await createOptions.setup?.({
          agent,
          /**
           * 功能说明：响应 on 相关流程；使用场景由所在模块及调用位置决定。
           * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
           * @param listener （unknown）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
           * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
           * @example 在完成前置校验后调用 on(event, listener)，并按返回类型处理结果。
           */
          on(event: string, listener: unknown) {
            modelListeners.set(event, listener)
            /**
             * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
             * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
             */
            return () => {}
          },
        })
        if (options.abortAt === 'agent') controller.abort(new Error('abort after agent'))
        return handle
      },
    },
    sessionTitle: {
      /**
       * 功能说明：处理 rename 相关流程；使用场景由所在模块及调用位置决定。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 rename()，并按返回类型处理结果。
       */
      rename() {
        calls.push('title')
        if (options.failAt === 'title') throw new Error('title failed')
        return {}
      },
    },
  }
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result: SessionHarness = {
    ctx: fake as unknown as Context,
    calls,
    messages,
    modelListeners,
    /**
     * 功能说明：处理 markRequestHeader 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 markRequestHeader()，并按返回类型处理结果。
     */
    markRequestHeader() { requestHeader = {} },
    controller,
    request: {
      workspacePath: '/workspace',
      title: 'Review PR',
      prompt: 'Review it',
      agentPreset: 'standard',
      permissionPreset: 'read-only',
    },
  }
  active.push(result)
  return result
}

/**
 * 常量说明：delivery 用于处理 delivery 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const delivery: VerifiedWebhookDelivery = {
  kind: 'github',
  source: WebhookSourceId('primary'),
  deliveryId: WebhookDeliveryId('delivery'),
  event: { action: 'ready_for_review' },
  receivedAt: 1,
}

/**
 * 功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。
 * @param test （SessionHarness）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param request （由 TypeScript 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 create(test, request)，并按返回类型处理结果。
 */
async function create(test: SessionHarness, request = test.request): Promise<void> {
  await createWebhookSession(
    test.ctx,
    delivery,
    WebhookRuleId('review'),
    request,
    test.controller.signal,
  )
}

/** Read the initial model-selection listener installed during Agent setup.
 * @remarks 中文说明：功能说明：处理 modelRequestListener 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：test（SessionHarness）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：( payload:
 * unknown, next: () => Promise<LlmCallConfig>, ) => Promise<…；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 modelRequestListener(test)，并按返回类型处理结果。 */
function modelRequestListener(test: SessionHarness): (
  payload: unknown,
  next: () => Promise<LlmCallConfig>,
) => Promise<LlmCallConfig> {
  /**
   * 常量说明：listener 用于处理 listener 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const listener = test.modelListeners.get('agent/request')
  if (typeof listener !== 'function') {
    throw new Error('webhook Session did not install its initial model selection')
  }
  return listener as (
    payload: unknown,
    next: () => Promise<LlmCallConfig>,
  ) => Promise<LlmCallConfig>
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('webhook Session creation', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preflights, mounts, attaches, configures, titles, and prompts in order', async () => {
    /**
     * 常量说明：test 用于处理 test 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const test = harness()
    await create(test)
    expect(test.calls).toEqual([
      'default-model',
      'permission-resolve:read-only',
      'preset-resolve:standard',
      'standing:standard',
      'workspace:/workspace',
      'agent-create',
      'mount:standard',
      'attach',
      'permission-set:read-only',
      'title',
      'followup',
    ])
    expect(test.messages).toHaveLength(1)
    expect(test.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Review it' }],
      source: {
        kind: 'webhook', provider: 'github', source: 'primary', deliveryId: 'delivery', ruleId: 'review',
      },
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses a complete explicit model without consulting the default', async () => {
    /**
     * 常量说明：test 用于处理 test 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const test = harness()
    await create(test, { ...test.request, model: { provider: 'p', model: 'm', maxTokens: 10 } })
    expect(test.calls).not.toContain('default-model')
    /**
     * 常量说明：withoutCap 用于处理 withoutCap 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const withoutCap = harness()
    await create(withoutCap, { ...withoutCap.request, model: { provider: 'p', model: 'm' } })
    expect(withoutCap.calls).not.toContain('default-model')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await expect(modelRequestListener(withoutCap)(undefined, async () => ({
      provider: 'p', model: 'm', reasoningEffort: ReasoningEffortId('inherited'),
    }))).resolves.toEqual({ provider: 'p', model: 'm' })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves default reasoning until the first request header is durable', async () => {
    /**
     * 常量说明：test 用于处理 test 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const test = harness()
    await create(test)
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = modelRequestListener(test)

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await expect(request(undefined, async () => ({
      provider: 'other-provider',
      model: 'default-model',
      reasoningEffort: ReasoningEffortId('other-provider-effort'),
    }))).resolves.toMatchObject({ reasoningEffort: 'other-provider-effort' })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await expect(request(undefined, async () => ({
      provider: 'default-provider',
      model: 'other-model',
      reasoningEffort: ReasoningEffortId('other-model-effort'),
    }))).resolves.toMatchObject({ reasoningEffort: 'other-model-effort' })

    /**
     * 常量说明：routed 用于处理 routed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const routed = await request(undefined, async () => ({
      provider: 'default-provider',
      model: 'default-model',
      reasoningEffort: ReasoningEffortId('inherited'),
    })) as unknown
    expect(routed).toEqual({
      provider: 'default-provider',
      model: 'default-model',
      reasoningEffort: 'high',
    })

    test.markRequestHeader()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await expect(request(undefined, async () => ({
      provider: 'later-provider',
      model: 'later-model',
      reasoningEffort: ReasoningEffortId('later'),
    }))).resolves.toEqual({
      provider: 'later-provider',
      model: 'later-model',
      reasoningEffort: 'later',
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
   * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：message（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, message)，
   * 并按返回类型处理结果。
   */
  it.each([
    [null, /must be null or a Session request object/],
    [{}, /workspacePath/],
    [{ workspacePath: 'relative', title: 't', prompt: 'p', agentPreset: 'a', permissionPreset: 'x' }, /must be absolute/],
    [{ workspacePath: '/w', title: ' ', prompt: 'p', agentPreset: 'a', permissionPreset: 'x' }, /title/],
    [{ workspacePath: '/w', title: 't', prompt: '', agentPreset: 'a', permissionPreset: 'x' }, /prompt/],
    [{ workspacePath: '/w', title: 't', prompt: 'p', agentPreset: '', permissionPreset: 'x' }, /agentPreset/],
    [{ workspacePath: '/w', title: 't', prompt: 'p', agentPreset: 'a', permissionPreset: '' }, /permissionPreset/],
    [{ workspacePath: '/w', title: 't', prompt: 'p', agentPreset: 'a', permissionPreset: 'x', model: null }, /model must be an object/],
    [{ workspacePath: '/w', title: 't', prompt: 'p', agentPreset: 'a', permissionPreset: 'x', model: {} }, /provider/],
    [{ workspacePath: '/w', title: 't', prompt: 'p', agentPreset: 'a', permissionPreset: 'x', model: { provider: 'p', model: 'm', maxTokens: 0 } }, /maxTokens/],
  ] as const)('rejects malformed rule result %# before side effects', async (request, message) => {
    /**
     * 常量说明：test 用于处理 test 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const test = harness()
    await expect(create(test, request as never)).rejects.toThrow(message)
    expect(test.calls).toEqual([])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：failAt（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(failAt)，并按返回类型处理结果。
   */
  it.each([
    'permission-resolve', 'preset-resolve', 'standing', 'workspace', 'agent', 'attach',
  ] as const)('contains a %s failure before prompt admission', async (failAt) => {
    /**
     * 常量说明：test 用于处理 test 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const test = harness({ failAt })
    await expect(create(test)).rejects.toThrow()
    expect(test.calls).not.toContain('followup')
    if (failAt === 'attach') expect(test.calls).toContain('dispose')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：failAt（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(failAt)，并按返回类型处理结果。
   */
  it.each(['permission-set', 'title', 'followup'] as const)(
    'detaches and disposes after a %s failure',
    async (failAt) => {
      /**
       * 常量说明：test 用于处理 test 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const test = harness({ failAt })
      await expect(create(test)).rejects.toThrow()
      expect(test.calls).toContain('detach')
      expect(test.calls).toContain('dispose')
    },
  )

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves the original failure while reporting rollback failures', async () => {
    /**
     * 常量说明：test 用于处理 test 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const test = harness({ failAt: 'title', failDetach: true, failDispose: true })
    await expect(create(test)).rejects.toThrow('title failed')
    expect((test.ctx.logger.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：abortAt（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(abortAt)，并按返回类型处理结果。
   */
  it.each(['workspace', 'agent'] as const)('honors cancellation after %s settlement', async (abortAt) => {
    /**
     * 常量说明：test 用于处理 test 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const test = harness({ abortAt })
    await expect(create(test)).rejects.toThrow(/abort after/)
    expect(test.calls).not.toContain('followup')
    if (abortAt === 'agent') expect(test.calls).toContain('dispose')
  })
})
