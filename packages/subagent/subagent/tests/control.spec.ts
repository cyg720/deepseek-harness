// The browser-facing control surface: catalog assembly against the live Agent
// registry, prompt admission, and the stable failure codes each answers with.
// The durable listing, continuation, and interrupt primitives they wrap have
// their own specs, so each case scripts them.

/**
 * 文件职责：验证 subagent/subagent 中 control spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, {
  SubagentError,
  type SubagentListEntry,
  type SubagentPromptRequestId,
} from '@deepseek-ai/dsh-subagent'

/**
 * 常量说明：PARENT 用于处理 PARENT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PARENT = SessionId('parent')
/**
 * 常量说明：CHILD 用于处理 CHILD 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const CHILD = SessionId('child')
/**
 * 常量说明：OTHER 用于处理 OTHER 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const OTHER = SessionId('other')
/**
 * 常量说明：BROKEN 用于处理 BROKEN 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const BROKEN = SessionId('broken')
/**
 * 常量说明：REQUEST_ID 用于处理 REQUEST_ID 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const REQUEST_ID = 'req-1' as SubagentPromptRequestId
/**
 * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const signal = new AbortController().signal

/** The runtime plus a programmable live-Agent registry, omitted to compose none.
 * @remarks 中文说明：功能说明：处理 bench 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：live（Record<string, { status: 'running' | 'idle' }>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 bench(live)，并按返回类型处理结果。 */
async function bench(live?: Record<string, { status: 'running' | 'idle' }>) {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  if (live !== undefined) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（SessionId）：标识本次操作关联的唯一对象；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    ctx.provide('agents', { get: (id: SessionId) => live[id] } as never)
  }
  return { ctx, subagents: ctx.subagents }
}

/**
 * 功能说明：处理 childRow 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （SessionId）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param activity （'running' | 'inactive'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SubagentListEntry；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 childRow(id, activity)，并按返回类型处理结果。
 */
function childRow(id: SessionId, activity: 'running' | 'inactive'): SubagentListEntry {
  return { kind: 'child', id, mode: 'continuable', label: 'worker', activity, hasChildren: false }
}

/**
 * 功能说明：处理 promptRequest 相关流程；使用场景由所在模块及调用位置决定。
 * @param clientTimeZone （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 promptRequest(clientTimeZone)，并按返回类型处理结果。
 */
function promptRequest(clientTimeZone?: string) {
  return {
    requestId: REQUEST_ID,
    parentSessionId: PARENT,
    childSessionId: CHILD,
    mode: 'continuable' as const,
    content: [{ type: 'text' as const, text: 'continue' }],
    ...clientTimeZone === undefined ? {} : { clientTimeZone },
  }
}

/**
 * 功能说明：处理 emptyIdFailure 相关流程；使用场景由所在模块及调用位置决定。
 * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param field （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 emptyIdFailure(method, field)，并按返回类型处理结果。
 */
function emptyIdFailure(method: string, field: string) {
  return {
    code: 'bad-request',
    message: `invalid payload for ${method}`,
    details: {
      issues: [{
        origin: 'string',
        code: 'too_small',
        minimum: 1,
        inclusive: true,
        path: [field],
        message: 'Too small: expected string to have >=1 characters',
      }],
    },
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('subagent catalog Remote', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects an empty parent id before listing', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench()
    /**
     * 常量说明：listChildren 用于列出 Children 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const listChildren = vi.spyOn(subagents, 'listChildren')

    await expect(subagents.remoteExportList(SessionId(''), signal))
      .rejects.toMatchObject({ failure: emptyIdFailure('subagent.list', 'parentSessionId') })
    expect(listChildren).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('samples row activity from the live Agent driver and reports parent availability', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench({ [PARENT]: { status: 'idle' }, [CHILD]: { status: 'running' } })
    vi.spyOn(subagents, 'listChildren').mockResolvedValue([
      // The durable listing reports store presence; the browser row reports the driver.
      childRow(CHILD, 'inactive'),
      childRow(OTHER, 'running'),
      { kind: 'diagnostic', id: BROKEN, reason: 'corrupt' },
    ])

    await expect(subagents.remoteExportList(PARENT, signal)).resolves.toEqual({
      entries: [
        childRow(CHILD, 'running'),
        childRow(OTHER, 'inactive'),
        { kind: 'diagnostic', id: BROKEN, reason: 'corrupt' },
      ],
      parentAvailable: true,
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports every row inactive and the parent unavailable without an Agent registry', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench()
    vi.spyOn(subagents, 'listChildren').mockResolvedValue([childRow(CHILD, 'running')])

    await expect(subagents.remoteExportList(PARENT, signal)).resolves.toEqual({
      entries: [childRow(CHILD, 'inactive')],
      parentAvailable: false,
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports an unknown parent as unavailable while the registry serves other sessions', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench({ [CHILD]: { status: 'running' } })
    vi.spyOn(subagents, 'listChildren').mockResolvedValue([])

    await expect(subagents.remoteExportList(PARENT, signal))
      .resolves.toEqual({ entries: [], parentAvailable: false })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('separates cancellation, the missing projections capability, and an unexplained read failure', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench()
    /**
     * 常量说明：listChildren 用于列出 Children 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const listChildren = vi.spyOn(subagents, 'listChildren')

    /**
     * 常量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const aborted = new AbortController()
    aborted.abort()
    listChildren.mockRejectedValue(new Error('read stopped'))
    await expect(subagents.remoteExportList(PARENT, aborted.signal))
      .rejects.toMatchObject({ failure: { code: 'cancelled' } })

    listChildren.mockRejectedValue(new SubagentError('cancelled', 'CANCELLED'))
    await expect(subagents.remoteExportList(PARENT, signal))
      .rejects.toMatchObject({ failure: { code: 'cancelled' } })

    listChildren.mockRejectedValue(
      new SubagentError('no registry', 'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE'),
    )
    await expect(subagents.remoteExportList(PARENT, signal)).rejects.toMatchObject({
      failure: {
        code: 'subagent-projections-unavailable',
        message: expect.stringContaining('sessionProjections') as unknown as string,
      },
    })

    listChildren.mockRejectedValue(new Error('disk gone'))
    await expect(subagents.remoteExportList(PARENT, signal))
      .rejects.toMatchObject({ failure: { code: 'internal', message: 'subagent catalog read failed' } })
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('subagent prompt Remote', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects empty parent and child ids before delivery', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    /**
     * 常量说明：followup 用于处理 followup 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const followup = vi.spyOn(subagents, 'followup')

    /**
     * 常量说明：cases 用于处理 cases 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cases: readonly {
      readonly field: 'parentSessionId' | 'childSessionId'
      readonly request: ReturnType<typeof promptRequest>
    }[] = [
      { field: 'parentSessionId', request: { ...promptRequest(), parentSessionId: SessionId('') } },
      { field: 'childSessionId', request: { ...promptRequest(), childSessionId: SessionId('') } },
    ]
    /**
     * 变量说明：field、request 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const { field, request } of cases) {
      await expect(subagents.prompt(request, signal))
        .rejects.toMatchObject({ failure: emptyIdFailure('subagent.prompt', field) })
    }
    expect(followup).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('forwards non-text content blocks without narrowing them', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    /**
     * 常量说明：followup 用于处理 followup 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const followup = vi.spyOn(subagents, 'followup').mockResolvedValue('m-content' as MessageId)
    /**
     * 常量说明：content 用于处理 content 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const content = [{ type: 'reasoning' as const, text: 'retain this block' }]

    await expect(subagents.prompt({ ...promptRequest(), content }, signal))
      .resolves.toEqual({ messageId: 'm-content' })
    expect(followup.mock.calls[0]?.[2]).toEqual(content)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('delivers the content under the caller-minted identity and canonical browser zone', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    /**
     * 常量说明：followup 用于处理 followup 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const followup = vi.spyOn(subagents, 'followup').mockResolvedValue('m-1' as MessageId)

    await expect(subagents.prompt(promptRequest('Asia/Shanghai'), signal))
      .resolves.toEqual({ messageId: 'm-1' })
    expect(followup).toHaveBeenCalledWith(
      { status: 'idle' },
      CHILD,
      [{ type: 'text', text: 'continue' }],
      {
        source: { kind: 'user', rpcId: REQUEST_ID, clientTimeZone: 'Asia/Shanghai' },
        signal,
      },
    )
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('omits the zone from the durable source when the browser reported none', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    /**
     * 常量说明：followup 用于处理 followup 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const followup = vi.spyOn(subagents, 'followup').mockResolvedValue('m-2' as MessageId)

    await expect(subagents.prompt(promptRequest(), signal)).resolves.toEqual({ messageId: 'm-2' })
    expect(followup.mock.calls[0]?.[3].source).toEqual({ kind: 'user', rpcId: REQUEST_ID })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('accepts UTC and rejects an empty, untrimmed, malformed, or unknown zone', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    vi.spyOn(subagents, 'followup').mockResolvedValue('m-3' as MessageId)

    await expect(subagents.prompt(promptRequest('UTC'), signal)).resolves.toEqual({ messageId: 'm-3' })
    /**
     * 变量说明：zone 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const zone of ['', ' UTC', 'Shanghai', 'Nowhere/Nowhere']) {
      await expect(subagents.prompt(promptRequest(zone), signal)).rejects.toMatchObject({
        failure: { code: 'invalid-time-zone', details: { value: zone } },
      })
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses delivery when the exact parent Agent is not live', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench()
    /**
     * 常量说明：followup 用于处理 followup 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const followup = vi.spyOn(subagents, 'followup')

    await expect(subagents.prompt(promptRequest(), signal)).rejects.toMatchObject({
      failure: { code: 'subagent-parent-unavailable', details: { parentSessionId: PARENT } },
    })
    expect(followup).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('maps each admission failure onto its stable code and hides the rest', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    /**
     * 常量说明：followup 用于处理 followup 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const followup = vi.spyOn(subagents, 'followup')
    /**
     * 常量说明：cases 用于处理 cases 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cases: readonly [string, string][] = [
      ['NOT_RESUMABLE', 'subagent-not-resumable'],
      ['UNAUTHORIZED', 'subagent-unauthorized'],
      ['DRAINING', 'subagent-delivery-unavailable'],
      ['ACTIVATION_CLOSING', 'subagent-delivery-unavailable'],
      ['NO_PROVIDER', 'internal'],
    ]
    /**
     * 变量说明：thrown、code 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [thrown, code] of cases) {
      followup.mockRejectedValue(new SubagentError('refused', thrown))
      await expect(subagents.prompt(promptRequest(), signal))
        .rejects.toMatchObject({ failure: { code } })
    }

    followup.mockRejectedValue(new Error('inbox exploded'))
    await expect(subagents.prompt(promptRequest(), signal))
      .rejects.toMatchObject({ failure: { code: 'internal', message: 'subagent prompt failed' } })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('answers a caller-cancelled delivery as cancelled rather than a failure', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    /**
     * 常量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const aborted = new AbortController()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    vi.spyOn(subagents, 'followup').mockImplementation(() => {
      aborted.abort()
      return Promise.reject(new SubagentError('gone', 'NOT_RESUMABLE'))
    })

    await expect(subagents.prompt(promptRequest(), aborted.signal))
      .rejects.toMatchObject({ failure: { code: 'cancelled' } })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves a cancellation reported by the continuation operation', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench({ [PARENT]: { status: 'idle' } })
    vi.spyOn(subagents, 'followup')
      .mockRejectedValue(new SubagentError('stopped', 'CANCELLED'))

    await expect(subagents.prompt(promptRequest(), signal))
      .rejects.toMatchObject({ failure: { code: 'cancelled' } })
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('subagent interrupt Remote', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects empty child and parent ids before interrupting', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench()
    /**
     * 常量说明：interrupt 用于处理 interrupt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const interrupt = vi.spyOn(subagents, 'interrupt')

    /**
     * 变量说明：childSessionId、parentSessionId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [childSessionId, parentSessionId] of [
      [SessionId(''), PARENT],
      [CHILD, SessionId('')],
    ] as const) {
      /**
       * 常量说明：field 用于处理 field 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const field = childSessionId.length === 0 ? 'childSessionId' : 'parentSessionId'
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      expect(() => subagents.interruptByParent(childSessionId, parentSessionId, 'continuable'))
        .toThrow(expect.objectContaining({
          failure: emptyIdFailure('subagent.interrupt', field),
        }))
    }
    expect(interrupt).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('admits the parent-addressed interrupt and acknowledges it', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench()
    /**
     * 常量说明：interrupt 用于处理 interrupt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const interrupt = vi.spyOn(subagents, 'interrupt').mockReturnValue()

    expect(subagents.interruptByParent(CHILD, PARENT, 'continuable')).toEqual({ accepted: true })
    expect(interrupt).toHaveBeenCalledWith(CHILD, { kind: 'user', parentSessionId: PARENT })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('answers a foreign address as unauthorized and everything else as internal', async () => {
    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { subagents } = await bench()
    /**
     * 常量说明：interrupt 用于处理 interrupt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const interrupt = vi.spyOn(subagents, 'interrupt')

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    interrupt.mockImplementation(() => { throw new SubagentError('not yours', 'UNAUTHORIZED') })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => subagents.interruptByParent(CHILD, PARENT, 'continuable')).toThrow(
      expect.objectContaining({ failure: { code: 'subagent-unauthorized', message: expect.any(String) as unknown as string, details: { childSessionId: CHILD } } }),
    )

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    interrupt.mockImplementation(() => { throw new Error('boom') })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => subagents.interruptByParent(CHILD, PARENT, 'continuable')).toThrow(
      expect.objectContaining({ failure: { code: 'internal', message: 'subagent interrupt failed', details: {} } }),
    )
  })
})
