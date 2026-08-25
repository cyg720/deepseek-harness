/**
 * 文件职责：验证 service.spec.ts 覆盖的子代理工具行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子代理工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { type Agent } from '@deepseek-ai/dsh-agent'

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import SubagentRuntime, {
  foldSubagentDescriptor,
  snapshotSubagentDescriptor,
  SUBAGENT_DESCRIPTOR_VERSION,
  SubagentError,
  assertSubagentMaxDepth,
  /** 中文说明：type ResolvedSubagentStartRequest 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
  type ResolvedSubagentStartRequest,
  /** 中文说明：type SubagentCapabilities 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
  type SubagentCapabilities,
  /** 中文说明：type SubagentProvider 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
  type SubagentProvider,
  /** 中文说明：type SubagentResult 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
  type SubagentResult,
  /** 中文说明：type SubagentRun 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
  type SubagentRun,
  /** 中文说明：type SubagentRunEndInfo 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
  type SubagentRunEndInfo,
  /** 中文说明：type SubagentStartRequest 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
  type SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'

/** 中文说明：函数 fakeParent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fakeParent(id = 'parent-1'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

/** 中文说明：常量 ALL_CAPS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ALL_CAPS: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
/** 中文说明：常量 NO_CAPS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const NO_CAPS: SubagentCapabilities = { outputSchema: false, depthLimit: false, toolFilter: false, persona: false }

/** 中文说明：函数 baseRequest 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function baseRequest(overrides: Partial<SubagentStartRequest> = {}): SubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'do a thing' }],
    parent: fakeParent(),
    signal: new AbortController().signal,
    ...overrides,
  }
}

/** 中文说明：class StubProvider 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
class StubProvider implements SubagentProvider {
  readonly inheritsParentContext = false
  startCount = 0
  lastRequest: ResolvedSubagentStartRequest | undefined

  constructor(
    readonly name: string,
    readonly capabilities: SubagentCapabilities = ALL_CAPS,
    private readonly outcome: SubagentResult = {
      output: [{ type: 'text', text: 'ok' }],
      stopReason: 'completed',
    },
  ) {}

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    this.startCount += 1
    this.lastRequest = request
    return {
      id: SessionId(`child:${this.name}:${request.parent.id}`),
      localAgent: undefined,
      result: Promise.resolve(this.outcome),
      async dispose() {},
    }
  }
}

/** 中文说明：函数 service 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function service(): Promise<{ ctx: Context; subagents: SubagentRuntime }> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  return { ctx, subagents: ctx.subagents }
}

describe('SubagentRuntime', () => {
  it('registers, lists, looks up, starts, and removes providers', async () => {
    const { ctx, subagents } = await service()
    /** 中文说明：变量 added 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const added: string[] = []
    /** 中文说明：变量 removed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const removed: string[] = []
    ctx.on('subagent/provider-added', provider => void added.push(provider.name))
    ctx.on('subagent/provider-removed', name => void removed.push(name))
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider = new StubProvider('alpha')

    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = subagents.registerProvider(provider)
    expect(subagents.list()).toEqual(['alpha'])
    expect(subagents.getProvider('alpha')).toBe(provider)
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await subagents.start('alpha', baseRequest())
    await expect(run.result).resolves.toMatchObject({ stopReason: 'completed' })
    expect(provider.startCount).toBe(1)

    dispose()
    expect(added).toEqual(['alpha'])
    expect(removed).toEqual(['alpha'])
    expect(subagents.getProvider('alpha')).toBeUndefined()
  })

  it('rolls registration back when provider-added throws', async () => {
    const { ctx, subagents } = await service()
    ctx.on('subagent/provider-added', () => { throw new Error('added boom') })
    expect(() => { subagents.registerProvider(new StubProvider('alpha')) }).toThrow('added boom')
    expect(subagents.getProvider('alpha')).toBeUndefined()
  })

  it('rejects duplicate and absent provider names with typed errors', async () => {
    const { subagents } = await service()
    subagents.registerProvider(new StubProvider('dup'))
    expect(() => { subagents.registerProvider(new StubProvider('dup')) })
      .toThrow(expect.objectContaining({ code: 'DUPLICATE_PROVIDER' }))
    await expect(subagents.start('missing', baseRequest()))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' })
  })

  it('resolves the one-shot descriptor and exposes no provider continuation operations', async () => {
    const { subagents } = await service()
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider = new StubProvider('one-shot')
    subagents.registerProvider(provider)
    /** 中文说明：变量 request 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const request = baseRequest()
    await subagents.start('one-shot', request)

    expect(provider.lastRequest).toEqual({
      ...request,
      descriptor: {
        version: SUBAGENT_DESCRIPTOR_VERSION,
        mode: 'one-shot',
        provider: 'one-shot',
      },
    })
    expect(provider.lastRequest).not.toBe(request)
    expectTypeOf<Parameters<SubagentRuntime['start']>[1]>().toExtend<SubagentStartRequest>()
    expect('resume' in subagents).toBe(false)
    expect('resume' in provider).toBe(false)
  })

  it('does not expose manager teardown and treats public drains as no-ops when no manager was bound', async () => {
    const { subagents } = await service()
    // Without `ctx.agents` no manager exists, so nothing was ever materialized.
    expect('drainContinuable' in subagents).toBe(false)
    await expect(subagents.drainContinuableDescendants([])).resolves.toBeUndefined()
    await expect(subagents.drainContinuableChildren(fakeParent(), [SessionId('child')])).resolves.toBeUndefined()
  })

  it('treats interrupt as an accepted no-op when no manager was bound', async () => {
    const { subagents } = await service()
    // Without a continuation manager no live Activation can exist, so there is
    // nothing to stop and nothing to authorize against.
    expect(() => { subagents.interrupt(SessionId('child'), {
      kind: 'user',
      parentSessionId: SessionId('parent-1'),
    }) }).not.toThrow()
  })

  it('rejects continuable operations when their runtime services are absent', async () => {
    const { subagents } = await service()
    await expect(subagents.startContinuable({
      provider: 'unused',
      label: 'unused child',
      request: baseRequest(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'CONTINUATION_UNAVAILABLE' })
    await expect(subagents.followup(
      fakeParent(),
      SessionId('child'),
      [{ type: 'text', text: 'hello' }],
      { source: { kind: 'user' }, signal: new AbortController().signal },
    )).rejects.toMatchObject({ code: 'CONTINUATION_UNAVAILABLE' })
  })

  it.each([
    ['outputSchema', { outputSchema: { type: 'object', properties: {} } }],
    ['depthLimit', { maxDepth: 1 }],
    ['toolFilter', { toolFilter: { deny: ['bash'] } }],
    ['persona', { persona: 'reviewer' }],
  ] as const)('rejects unsupported %s before provider startup', async (_capability, override) => {
    const { subagents } = await service()
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider = new StubProvider('weak', NO_CAPS)
    subagents.registerProvider(provider)
    await expect(subagents.start('weak', baseRequest(override)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(provider.startCount).toBe(0)
  })

  it('validates depth and schema semantics before provider startup', async () => {
    const { subagents } = await service()
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider = new StubProvider('strong')
    subagents.registerProvider(provider)
    await expect(subagents.start('strong', baseRequest({ maxDepth: -1 })))
      .rejects.toThrow('non-negative safe integer')
    await expect(subagents.start('strong', baseRequest({ outputSchema: { type: 'string' } as never })))
      .rejects.toThrow()
    expect(provider.startCount).toBe(0)
    expect(() => { assertSubagentMaxDepth(undefined) }).not.toThrow()
  })

  it('publishes lifecycle only after async provider start and keeps parent scope', async () => {
    const { ctx, subagents } = await service()
    /** 中文说明：变量 ready 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ready = Promise.withResolvers<SubagentRun>()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = Promise.withResolvers<SubagentResult>()
    subagents.registerProvider({
      name: 'deferred',
      capabilities: NO_CAPS,
      inheritsParentContext: false,
      start: () => ready.promise,
    })
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = fakeParent('delegator')
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events: string[] = []
    /** 中文说明：变量 keys 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const keys: unknown[] = []
    /** 中文说明：变量 runIds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runIds: string[] = []
    ctx.on('subagent/start', function (info) { events.push('start'); keys.push(carrierKeyOf(this)); runIds.push(info.runId) })
    ctx.on('subagent/end', function (info) { events.push('end'); keys.push(carrierKeyOf(this)); runIds.push(info.runId) })

    /** 中文说明：变量 starting 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const starting = subagents.start('deferred', baseRequest({ parent }))
    await Promise.resolve()
    expect(events).toEqual([])
    ready.resolve({ id: SessionId('child'), localAgent: undefined, result: result.promise, async dispose() {} })
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await starting
    expect(events).toEqual(['start'])
    result.resolve({ output: [{ type: 'text', text: 'answer' }], stopReason: 'completed' })
    await run.result
    await Promise.resolve()
    expect(events).toEqual(['start', 'end'])
    expect(keys).toEqual([parent, parent])
    expect(runIds[0]).toBe(runIds[1])
  })

  it('mints distinct lifecycle identities when provider and child ids repeat', async () => {
    const { ctx, subagents } = await service()
    subagents.registerProvider(new StubProvider('reused'))
    /** 中文说明：变量 runIds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runIds: string[] = []
    ctx.on('subagent/start', info => void runIds.push(info.runId))

    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = await subagents.start('reused', baseRequest())
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = await subagents.start('reused', baseRequest())
    await Promise.all([first.result, second.result])

    expect(runIds).toHaveLength(2)
    expect(new Set(runIds).size).toBe(2)
  })

  it('emits no run lifecycle when provider startup rejects', async () => {
    const { ctx, subagents } = await service()
    subagents.registerProvider({
      name: 'failed',
      capabilities: NO_CAPS,
      inheritsParentContext: false,
      start: async () => { throw new Error('setup rolled back') },
    })
    /** 中文说明：变量 lifecycle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lifecycle = vi.fn()
    ctx.on('subagent/start', lifecycle)
    ctx.on('subagent/end', lifecycle)
    await expect(subagents.start('failed', baseRequest())).rejects.toThrow('setup rolled back')
    expect(lifecycle).not.toHaveBeenCalled()
  })

  it('emits an enriched end event and maps result rejection to error telemetry', async () => {
    const { ctx, subagents } = await service()
    /** 中文说明：变量 completed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const completed = new StubProvider('completed', NO_CAPS, {
      output: [{ type: 'text', text: 'answer' }],
      stopReason: 'completed',
    })
    subagents.registerProvider(completed)
    /** 中文说明：变量 ended 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ended = vi.fn()
    ctx.on('subagent/end', ended)
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await subagents.start('completed', baseRequest())
    await run.result
    await Promise.resolve()
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'completed',
      lastAssistantMessage: [{ type: 'text', text: 'answer' }],
      stopReason: 'completed',
    }))

    // The lifecycle event omits lastAssistantMessage when output is empty,
    // matching the continuable epoch event.
    /** 中文说明：变量 silent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const silent = new StubProvider('silent', NO_CAPS, { output: [], stopReason: 'completed' })
    subagents.registerProvider(silent)
    /** 中文说明：变量 silentRun 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const silentRun = await subagents.start('silent', baseRequest())
    await silentRun.result
    await Promise.resolve()
    /** 中文说明：函数值 silentEnd 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const silentEnd = ended.mock.calls.map(call => call[0] as SubagentRunEndInfo).find(info => info.provider === 'silent')
    expect(silentEnd).toBeDefined()
    expect('lastAssistantMessage' in silentEnd!).toBe(false)

    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = Promise.withResolvers<SubagentResult>()
    subagents.registerProvider({
      name: 'infra',
      capabilities: NO_CAPS,
      inheritsParentContext: false,
      async start() {
        return { id: SessionId('infra-child'), localAgent: undefined, result: failure.promise, async dispose() {} }
      },
    })
    /** 中文说明：变量 failedRun 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedRun = await subagents.start('infra', baseRequest())
    failure.reject(new Error('transport'))
    await expect(failedRun.result).rejects.toThrow('transport')
    await Promise.resolve()
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({ provider: 'infra', stopReason: 'error' }))
  })

  it('contains synchronous and asynchronous lifecycle observer failures', async () => {
    const { ctx, subagents } = await service()
    /** 中文说明：变量 warnings 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => void warnings.push(String(message))) as typeof ctx.logger.warn
    /** 中文说明：变量 heard 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const heard: string[] = []
    ctx.on('subagent/provider-removed', () => { throw new Error('sync boom') })
    // Runtime listeners may return thenables even though the declaration's observable result is void.
    // oxlint-disable-next-line typescript/no-misused-promises -- exercises rejected-listener containment
    ctx.on('subagent/provider-removed', async () => { throw new Error('async boom') })
    ctx.on('subagent/provider-removed', () => { throw { toString: () => { throw new Error('coercion') } } })
    ctx.on('subagent/provider-removed', name => void heard.push(name))
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = subagents.registerProvider(new StubProvider('contained'))

    dispose()
    await Promise.resolve()
    expect(heard).toEqual(['contained'])
    expect(warnings.some(message => message.includes('sync boom'))).toBe(true)
    expect(warnings.some(message => message.includes('async boom'))).toBe(true)
    expect(warnings.some(message => message.includes('<unrenderable thrown value>'))).toBe(true)
  })

  it('SubagentError participates in the harness error taxonomy', () => {
    /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const error = new SubagentError('boom', 'NO_PROVIDER')
    expect(error).toBeInstanceOf(HarnessError)
    expect(error.name).toBe('SubagentError')
    expect(error.code).toBe('NO_PROVIDER')
  })
})

describe('subagent descriptors', () => {
  /** 中文说明：函数值 event 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const event = (data: unknown): SessionEvent<'subagent/descriptor'> => ({
    type: 'subagent/descriptor',
    data,
  } as unknown as SessionEvent<'subagent/descriptor'>)

  it('omits absent fields, recovers a complete payload, and rejects unsupported versions', () => {
    expect(foldSubagentDescriptor([])).toBeUndefined()
    /** 中文说明：变量 minimal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const minimal = snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'spawn' })
    expect(minimal).toEqual({
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'one-shot',
      provider: 'spawn',
    })
    expect(foldSubagentDescriptor([event(minimal)])).toEqual(minimal)
    expect(snapshotSubagentDescriptor({
      mode: 'one-shot',
      provider: 'spawn',
      label: 'child work',
    })).toEqual({ ...minimal, label: 'child work' })
    /** 中文说明：变量 complete 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const complete = {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable' as const,
      provider: 'spawn',
      label: 'complete child',
      agentProvider: 'deepseek',
      agentModel: 'chat',
      persona: 'reviewer',
      toolFilter: { allow: ['read'], deny: ['bash'] },
    }
    expect(snapshotSubagentDescriptor({
      mode: 'continuable',
      provider: complete.provider,
      label: complete.label,
      agentProvider: complete.agentProvider,
      agentModel: complete.agentModel,
      persona: complete.persona,
      toolFilter: complete.toolFilter,
    })).toEqual(complete)
    expect(foldSubagentDescriptor([event(complete)])).toEqual(complete)
    expect(foldSubagentDescriptor([
      event({
        version: SUBAGENT_DESCRIPTOR_VERSION,
        mode: 'continuable',
        provider: 'spawn',
        label: 'l',
        toolFilter: { allow: ['read'] },
      }),
    ])).toMatchObject({ toolFilter: { allow: ['read'] } })
    expect(foldSubagentDescriptor([
      event({
        version: SUBAGENT_DESCRIPTOR_VERSION,
        mode: 'continuable',
        provider: 'spawn',
        label: 'l',
        toolFilter: { deny: ['bash'] },
      }),
    ])).toMatchObject({ toolFilter: { deny: ['bash'] } })
    expect(foldSubagentDescriptor([
      event({ version: SUBAGENT_DESCRIPTOR_VERSION + 1, provider: 'spawn' }),
    ])).toBeUndefined()
    expect(() => snapshotSubagentDescriptor({
      mode: 'continuable',
      provider: 'spawn',
      label: 'bad',
      toolFilter: { deny: [Symbol('not-json')] as unknown as string[] },
    })).toThrow('not losslessly JSON-serializable')
  })

  it.each([
    ['string payload', 'invalid', 'payload must be an object'],
    ['null payload', null, 'payload must be an object'],
    ['array payload', [], 'payload must be an object'],
    ['missing version', { provider: 'spawn' }, 'version must be a number'],
    ['string version', { version: '1', provider: 'spawn' }, 'version must be a number'],
    ['missing mode', { version: SUBAGENT_DESCRIPTOR_VERSION }, 'mode must be "one-shot" or "continuable"'],
    ['invalid mode', { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'later' }, 'mode must be "one-shot" or "continuable"'],
    ['unknown one-shot field', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'one-shot',
      provider: 'spawn',
      label: 'l',
      persona: 'reviewer',
    }, 'payload has unknown field "persona"'],
    ['invalid one-shot label', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'one-shot',
      provider: 'spawn',
      label: 7,
    }, 'label must be a string'],
    ['unknown payload field', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      extra: true,
    }, 'payload has unknown field "extra"'],
    ['missing provider', { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable' }, 'provider must be a string'],
    ['missing label', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
    }, 'label must be a string'],
    ['invalid label', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 7,
    }, 'label must be a string'],
    ['invalid provider', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 7,
    }, 'provider must be a string'],
    ['invalid agent provider', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      agentProvider: 7,
    }, 'agentProvider must be a string'],
    ['invalid agent model', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      agentModel: [],
    }, 'agentModel must be a string'],
    ['invalid persona', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      persona: {},
    }, 'persona must be a string'],
    ['non-object tool filter', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      toolFilter: [],
    }, 'toolFilter must be an object'],
    ['unknown tool-filter field', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      toolFilter: { except: ['bash'] },
    }, 'toolFilter has unknown field "except"'],
    ['empty tool filter', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      toolFilter: {},
    }, 'toolFilter must declare allow and/or deny'],
    ['non-array allow list', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      toolFilter: { allow: 'read' },
    }, 'toolFilter.allow must be an array of strings'],
    ['non-string deny item', {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'l',
      toolFilter: { deny: [7] },
    }, 'toolFilter.deny must be an array of strings'],
  ])('rejects a malformed persisted descriptor: %s', (_case, data, detail) => {
    expect(() => foldSubagentDescriptor([event(data)])).toThrow(detail)
  })
})
