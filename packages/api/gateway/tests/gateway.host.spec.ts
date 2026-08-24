/**
 * 文件职责：验证 Typert Host 网关从严格描述符到 Cordis 服务调用及 HTTP/RPC 传输的完整装配。
 * 技术维度：使用 Vitest、Cordis Service 装饰器、Zod、模拟连接和临时 HTTP 服务器执行宿主侧集成测试。
 * 产品维度：保证远程业务调用被正确认领、校验、取消和错误映射，未认领接口继续交给其他路由。
 * 逻辑维度：定义多种服务与错误夹具，注册查找和上下文提供者，再覆盖调用、冲突、缓存、回滚和 HTTP 分发。
 * 关键边界：只有 Typert 严格定义与服务绑定一致时才能公开；错误描述符必须在接收真实请求前失败。
 * 新手阅读建议：先看 GoalService 与描述符的对应关系，再看模拟连接拦截器，最后阅读失败类服务为何被拒绝。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { Context, Service, symbols } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { apply as applyConnection, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import type { WebServer, WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  bindTypertRemote,
  Remote,
  RemoteScope,
  TypertLookupFailure,
  type InvocationDescriptor,
  type TypertContext,
  type TypertLookup,
  type TypertLookupProvider,
} from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry, { type TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService, { TypertGatewayError } from '@deepseek-ai/dsh-api-gateway'

/** 网关查找测试使用的最小代理业务对象。 */
interface FixtureAgent {
  readonly id: string
}

/** 带调用作用域标记的测试 Context。 */
interface MarkedContext extends Context {
  readonly fixtureScope?: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    gatewayFixture: TypertLookup<FixtureAgent, string>
    gatewayFixtureAlias: TypertLookup<FixtureAgent, string>
  }

  interface TypertContextMap {
    gatewayFixture: TypertContext<string>
  }
}

// 不声明服务、事件和对象的最小 Typert 模型贡献。
const emptyModel: TypertContribution['model'] = {
  services: [],
  events: [],
  objects: [],
}

/** 提供直接、作用域、透传和失败方法的主要网关业务夹具。 */
class GoalService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'goals')
  readonly calls: string[] = []
  lastSignal: AbortSignal | undefined
  nextResult: unknown = undefined
  businessError: Error | undefined

  constructor(ctx: Context) {
    super(ctx, 'goals')
  }

  @Remote
  create(agent: FixtureAgent, request: { readonly title: string }, signal: AbortSignal): unknown {
    this.calls.push('create')
    this.lastSignal = signal
    return {
      agentId: agent.id,
      title: request.title,
      scope: (this.ctx as MarkedContext).fixtureScope ?? 'root',
    }
  }

  @RemoteScope('gatewayFixture')
  rename(request: { readonly title: string }): unknown {
    this.calls.push('rename')
    return { title: request.title, scope: (this.ctx as MarkedContext).fixtureScope ?? 'root' }
  }

  @Remote
  passthrough(value: unknown): unknown {
    this.calls.push('passthrough')
    return this.nextResult === undefined ? value : this.nextResult
  }

  @Remote
  maybe(value: string | null | undefined): string | null | undefined {
    this.calls.push('maybe')
    return value
  }

  @Remote
  fail(request: unknown): never {
    void request
    this.calls.push('fail')
    throw this.businessError ?? new Error('fixture business failure')
  }

  strictOnly(request: { readonly title: string }): unknown {
    this.calls.push('strictOnly')
    return this.nextResult === undefined ? request : this.nextResult
  }
}

/** 模拟连接拦截器返回的成功或失败 RPC 结果。 */
type FakeRpcResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }

/** 模拟连接保存的异步 RPC 处理函数。 */
type FakeRpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<FakeRpcResult>

/** 记录网关注册的频道、认领函数和处理器的连接服务夹具。 */
class FakeConnectionService extends Service {
  channel: string | undefined
  authority: string | undefined
  matches: ((endpoint: string) => boolean) | undefined
  handler: FakeRpcHandler | undefined

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }

  get rpc() {
    const owner = this.ctx
    return {
      intercept: (
        channel: string,
        matches: (endpoint: string) => boolean,
        handler: FakeRpcHandler,
        options: { readonly authority: string },
      ) =>
        owner.effect(() => {
          this.channel = channel
          this.authority = options.authority
          this.matches = matches
          this.handler = handler
          return () => {
            this.channel = undefined
            this.authority = undefined
            this.matches = undefined
            this.handler = undefined
          }
        }),
    }
  }
}

/** 创建仅实现路由注册能力的内存 WebServer 夹具。 */
function fakeHttpServer(routes: WebRoute[]): Pick<WebServer, 'register' | 'tapIndex' | 'port'> {
  return {
    register(route) {
      if (routes.some(candidate => candidate.kind === route.kind && candidate.path === route.path)) {
        throw new Error(`duplicate route ${route.path}`)
      }
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    tapIndex: () => () => {},
    port: 0,
  }
}

/** 在随机本地端口启动单一路由，返回访问地址和关闭函数。 */
async function serveRoute(route: WebRoute): Promise<{ readonly origin: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    void route.handler(request, response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined || error === null) resolve()
        else reject(error)
      })
    }),
  }
}

/** 第一个共享命名空间服务，用于验证多服务所有权冲突。 */
class FirstSharedService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'firstShared', { namespace: 'shared' })

  constructor(ctx: Context) {
    super(ctx, 'firstShared')
  }

  @Remote
  run(value: string): string {
    return value
  }
}

/** 第二个共享命名空间服务，用于验证重复命名空间拒绝。 */
class SecondSharedService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'secondShared', { namespace: 'shared' })

  constructor(ctx: Context) {
    super(ctx, 'secondShared')
  }

  @Remote
  run(value: string): string {
    return value
  }
}

/** 带默认参数的方法夹具，用于验证不支持的参数语法。 */
class DefaultParameterService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'defaultParameter', { namespace: 'invalid-default' })

  constructor(ctx: Context) {
    super(ctx, 'defaultParameter')
  }

  @Remote
  run(value = 'fallback'): string {
    return value
  }
}

/** 带解构参数的方法夹具，用于验证参数名无法稳定投影时拒绝。 */
class DestructuredParameterService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'destructuredParameter', { namespace: 'invalid-destructure' })

  constructor(ctx: Context) {
    super(ctx, 'destructuredParameter')
  }

  @Remote
  run({ value }: { readonly value: string }): string {
    return value
  }
}

/** 带剩余参数的方法夹具，用于验证可变参数不进入远程定义。 */
class RestParameterService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'restParameter', { namespace: 'invalid-rest' })

  constructor(ctx: Context) {
    super(ctx, 'restParameter')
  }

  @Remote
  run(...values: readonly unknown[]): string {
    return values.map(String).join(',')
  }
}

/** 取消信号不在末尾的方法夹具，用于验证签名约束。 */
class NonFinalSignalService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'nonFinalSignal', { namespace: 'invalid-signal' })

  constructor(ctx: Context) {
    super(ctx, 'nonFinalSignal')
  }

  @Remote
  run(signal: AbortSignal, value: string): string {
    return signal.aborted ? '' : value
  }
}

/** 远程绑定信息与服务不一致的夹具。 */
class WrongBindingService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'notWrongBinding', { namespace: 'wrong-binding' })

  constructor(ctx: Context) {
    super(ctx, 'wrongBinding')
  }

  @Remote
  run(value: string): string {
    return value
  }
}

/** 同时由普通导出和远程声明占用方法的冲突夹具。 */
class ExportedMethodService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'exportedMethod', { namespace: 'exported' })

  constructor(ctx: Context) {
    super(ctx, 'exportedMethod')
  }

  @Remote('execute')
  run(value: string): string {
    return value
  }
}

/** 缺少有效远程方法名的服务夹具。 */
class EmptyMethodService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'emptyMethod', { namespace: 'empty' })

  constructor(ctx: Context) {
    super(ctx, 'emptyMethod')
  }

  @Remote
  ping(): string {
    return 'pong'
  }
}

/** 多个参数映射到同一线字段的冲突夹具。 */
class CollidingWireService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'collidingWire', { namespace: 'colliding-wire' })

  constructor(ctx: Context) {
    super(ctx, 'collidingWire')
  }

  @Remote
  run(agent: FixtureAgent, agentId: string): string {
    return `${agent.id}:${agentId}`
  }
}

/** 上下文标识与业务参数争用线字段的冲突夹具。 */
class ContextWireService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'contextWire', { namespace: 'context-wire' })

  constructor(ctx: Context) {
    super(ctx, 'contextWire')
  }

  @RemoteScope('gatewayFixture')
  run(agentId: string): string {
    return agentId
  }
}

/** 不提供远程绑定的无关服务，用于触发服务集合版本变化。 */
class NoBindingService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'noBinding')
  }

  run(value: string): string {
    return value
  }
}

/** 统计绑定读取次数的服务，用于验证网关认领缓存失效。 */
class ObservedClaimService extends Service {
  private readonly binding = bindTypertRemote(this, 'observedClaim', { namespace: 'observed-claim' })
  bindingReads = 0

  constructor(ctx: Context) {
    super(ctx, 'observedClaim')
  }

  get typertRemote() {
    this.bindingReads += 1
    return this.binding
  }

  @Remote
  run(value: string): string {
    return value
  }
}

/** 描述符引用不存在实现方法时使用的失败夹具。 */
class MissingMethodService extends Service {
  readonly typertRemote = bindTypertRemote(this, 'missingMethod', { namespace: 'missing-method' })

  constructor(ctx: Context) {
    super(ctx, 'missingMethod')
  }

  @Remote
  run(value: string): string {
    return value
  }
}

/** 声明远程方法的基类，用于验证继承方法解析。 */
class InheritedMethodBase extends Service {
  readonly typertRemote = bindTypertRemote(this, 'inheritedMethod', { namespace: 'inherited' })

  constructor(ctx: Context) {
    super(ctx, 'inheritedMethod')
  }

  @Remote
  run(value: string): string {
    return value
  }
}

/** 继承远程方法而不重写的具体服务夹具。 */
class InheritedMethodService extends InheritedMethodBase {}

describe('TypertGatewayService', () => {
  it('invokes a strict direct method with schema decoding and a live lookup', async () => {
    const { ctx, service } = await setup()
    const agent = { id: 'agent-1' }
    registerAgentLookup(ctx, agent)
    registerStrict(ctx, [createDescriptor()])
    const caller = ctx.extend({ fixtureScope: 'direct-caller' })
    const abort = new AbortController()

    await expect(caller.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: '  ship  ' } },
      signal: abort.signal,
    })).resolves.toEqual({ agentId: 'agent-1', title: 'ship', scope: 'direct-caller' })
    expect(service.calls).toEqual(['create'])
    expect(service.lastSignal).toBe(abort.signal)

    await expect(caller.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: 'again' } },
    })).resolves.toEqual({ agentId: 'agent-1', title: 'again', scope: 'direct-caller' })
    expect(service.lastSignal).toBeInstanceOf(AbortSignal)
    expect(service.lastSignal?.aborted).toBe(false)
  })

  it('resolves strict Remote Scope identity without adding a business argument', async () => {
    const { ctx, service } = await setup()
    const scoped = ctx.extend({ fixtureScope: 'agent-scope' })
    ctx.typert.contexts.registerHost('gatewayFixture', contextProvider(scoped))
    registerStrict(ctx, [renameDescriptor()])

    await expect(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'rename',
      args: { agentId: 'agent-1', request: { title: 'land' } },
    })).resolves.toEqual({ title: 'land', scope: 'agent-scope' })
    expect(service.calls).toEqual(['rename'])
  })

  it('derives SRC direct lookup and JSON parameters from marker and parameter names', async () => {
    const { ctx, service } = await setup()
    const agent = { id: 'agent-1' }
    registerAgentLookup(ctx, agent)
    const caller = ctx.extend({ fixtureScope: 'direct-src' })
    const abort = new AbortController()

    await expect(caller.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: 'ship' } },
      signal: abort.signal,
    })).resolves.toEqual({ agentId: 'agent-1', title: 'ship', scope: 'direct-src' })
    expect(service.lastSignal).toBe(abort.signal)
  })

  it('does not downgrade an observed SRC lookup after its provider unloads', async () => {
    const { ctx, service } = await setup()
    const dispose = registerAgentLookup(ctx, { id: 'agent-1' })
    await dispose()

    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: 'ship' } },
    }), 'lookup-unavailable')
    expect(service.calls).toEqual([])
  })

  it('derives SRC Remote Scope identity and preserves the scoped Proxy receiver', async () => {
    const { ctx } = await setup()
    const scoped = ctx.extend({ fixtureScope: 'agent-src' })
    ctx.typert.contexts.registerHost('gatewayFixture', contextProvider(scoped))

    await expect(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'rename',
      args: { agentId: 'agent-1', request: { title: 'land' } },
    })).resolves.toEqual({ title: 'land', scope: 'agent-src' })
  })

  it('derives exported, empty, inherited, and distinct-namespace SRC methods', async () => {
    const ctx = await setupGateway()
    await ctx.plugin(ExportedMethodService)
    await ctx.plugin(EmptyMethodService)
    await ctx.plugin(InheritedMethodService)

    await expect(ctx.typertGateway.invoke({
      namespace: 'exported', method: 'execute', args: { value: 'ship' },
    })).resolves.toBe('ship')
    await expect(ctx.typertGateway.invoke({
      namespace: 'empty', method: 'ping', args: {},
    })).resolves.toBe('pong')
    await expect(ctx.typertGateway.invoke({
      namespace: 'inherited', method: 'run', args: { value: 'land' },
    })).resolves.toBe('land')
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'other', method: 'absent', args: {},
    }), 'invocation-unavailable')
  })

  it('rejects SRC wire collisions and unavailable Context providers', async () => {
    const colliding = await setupGateway()
    await colliding.plugin(CollidingWireService)
    registerAgentLookup(colliding, { id: 'agent-1' })
    await expectCode(colliding.typertGateway.invoke({
      namespace: 'colliding-wire',
      method: 'run',
      args: { agentId: 'agent-1' },
    }), 'signature-invalid')

    const missing = await setup()
    await expectCode(missing.ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'rename',
      args: { agentId: 'agent-1', request: { title: 'land' } },
    }), 'context-unavailable')

    const contextCollision = await setupGateway()
    await contextCollision.plugin(ContextWireService)
    contextCollision.typert.contexts.registerHost('gatewayFixture', contextProvider(contextCollision.extend()))
    await expectCode(contextCollision.typertGateway.invoke({
      namespace: 'context-wire',
      method: 'run',
      args: { agentId: 'agent-1' },
    }), 'signature-invalid')
  })

  it('re-reads Service and providers on every strict invocation', async () => {
    const { ctx, serviceFiber } = await setup()
    const agent = { id: 'agent-1' }
    const disposeLookup = registerAgentLookup(ctx, agent)
    registerStrict(ctx, [createDescriptor()])

    await disposeLookup()
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: 'ship' } },
    }), 'lookup-unavailable')

    registerAgentLookup(ctx, agent)
    await serviceFiber.dispose()
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: 'ship' } },
    }), 'service-unavailable')
  })

  it('re-reads and contains Context providers', async () => {
    const { ctx } = await setup()
    const scoped = ctx.extend()
    const dispose = ctx.typert.contexts.registerHost('gatewayFixture', contextProvider(scoped))
    registerStrict(ctx, [renameDescriptor()])

    await dispose()
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'rename',
      args: { agentId: 'agent-1', request: { title: 'land' } },
    }), 'context-unavailable')

    ctx.typert.contexts.registerHost('gatewayFixture', {
      ...contextProvider(scoped),
      resolve: () => { throw new Error('provider failed') },
    })
    const error = await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'rename',
      args: { agentId: 'agent-1', request: { title: 'land' } },
    }), 'context-failed')
    expect(error.cause).toEqual(new Error('provider failed'))
  })

  it('preserves a Host Context policy rejection for the active RPC adapter', async () => {
    const { ctx } = await setup()
    const rejection = new TypertLookupFailure({ code: 'agent-busy', message: 'owned', details: { reason: 'subagent' } })
    ctx.typert.contexts.registerHost('gatewayFixture', {
      ...contextProvider(ctx.extend()),
      resolve: async () => { throw rejection },
    })
    registerStrict(ctx, [renameDescriptor()])

    await expect(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'rename',
      args: { agentId: 'agent-1', request: { title: 'land' } },
    })).rejects.toBe(rejection)
  })

  it('reports Context provider metadata mismatch and unresolved identities', async () => {
    const { ctx } = await setup()
    registerStrict(ctx, [renameDescriptor()])
    const scoped = ctx.extend()
    const mismatch = ctx.typert.contexts.registerHost('gatewayFixture', {
      ...contextProvider(scoped),
      wire: 'differentAgentId',
    })
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'rename',
      args: { agentId: 'agent-1', request: { title: 'land' } },
    }), 'provider-mismatch')
    await mismatch()

    ctx.typert.contexts.registerHost('gatewayFixture', {
      ...contextProvider(scoped),
      resolve: () => undefined,
    })
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'rename',
      args: { agentId: 'agent-1', request: { title: 'land' } },
    }), 'context-not-found')
  })

  it('contains lookup provider failures and missing identities', async () => {
    const { ctx } = await setup()
    registerStrict(ctx, [createDescriptor()])
    const throwing = ctx.typert.lookups.register('gatewayFixture', {
      ...agentLookup({ id: 'agent-1' }),
      resolve: async () => { throw new Error('lookup failed') },
    })
    const failure = await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: 'ship' } },
    }), 'lookup-failed')
    expect(failure.cause).toEqual(new Error('lookup failed'))
    await throwing()

    const missing = ctx.typert.lookups.register('gatewayFixture', {
      ...agentLookup({ id: 'agent-1' }),
      resolve: () => Promise.resolve(undefined),
    })
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: 'ship' } },
    }), 'lookup-not-found')
    await missing()

    ctx.typert.lookups.register('gatewayFixture', {
      ...agentLookup({ id: 'agent-1' }),
      resolve: async id => ({ id }),
    })
    await expect(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: 'ship' } },
    })).resolves.toMatchObject({ agentId: 'agent-1', title: 'ship' })
  })

  it('never downgrades an observed strict endpoint after definition disposal', async () => {
    const { ctx } = await setup()
    const dispose = registerStrict(ctx, [passthroughDescriptor()])
    await dispose()

    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'passthrough',
      args: { value: 'would pass through SRC' },
    }), 'definition-unavailable')
  })

  it('seeds the no-downgrade guard from definitions present before Gateway startup', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    const dispose = registerStrict(ctx, [passthroughDescriptor()])
    await ctx.plugin(TypertGatewayService)
    await ctx.plugin(GoalService)
    await dispose()

    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'passthrough',
      args: { value: 'would pass through SRC' },
    }), 'definition-unavailable')
  })

  it('retains the no-downgrade guard across Gateway Service reloads', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    const gatewayFiber = ctx.plugin(TypertGatewayService)
    await gatewayFiber
    await ctx.plugin(GoalService)
    const dispose = registerStrict(ctx, [passthroughDescriptor()])
    await dispose()

    await gatewayFiber.dispose()
    await ctx.plugin(TypertGatewayService)

    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'passthrough',
      args: { value: 'would pass through SRC' },
    }), 'definition-unavailable')
  })

  it('rejects ambiguous SRC endpoints independently of reflection order', async () => {
    const ctx = await setupGateway()
    await ctx.plugin(FirstSharedService)
    await ctx.plugin(SecondSharedService)

    const error = await expectCode(ctx.typertGateway.invoke({
      namespace: 'shared',
      method: 'run',
      args: { value: 'ship' },
    }), 'ambiguous-endpoint')
    expect(error.message).toContain('firstShared, secondShared')
  })

  it('rejects SRC signatures that cannot map one wire field to each position', async () => {
    const cases = [
      { plugin: DefaultParameterService, namespace: 'invalid-default', args: { value: 'x' } },
      { plugin: DestructuredParameterService, namespace: 'invalid-destructure', args: { value: { value: 'x' } } },
      { plugin: RestParameterService, namespace: 'invalid-rest', args: { values: ['x'] } },
      { plugin: NonFinalSignalService, namespace: 'invalid-signal', args: { value: 'x' } },
    ] as const
    for (const testCase of cases) {
      const ctx = await setupGateway()
      await ctx.plugin(testCase.plugin)
      await expectCode(ctx.typertGateway.invoke({
        namespace: testCase.namespace,
        method: 'run',
        args: testCase.args,
      }), 'signature-invalid')
    }
  })

  it('rejects a SRC parameter matching more than one lookup provider', async () => {
    const { ctx } = await setup()
    const provider = agentLookup({ id: 'agent-1' })
    ctx.typert.lookups.register('gatewayFixture', provider)
    ctx.typert.lookups.register('gatewayFixtureAlias', provider)

    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: 'ship' } },
    }), 'signature-invalid')
  })

  it('requires exact wire fields before invoking business code', async () => {
    const { ctx, service } = await setup()
    registerAgentLookup(ctx, { id: 'agent-1' })

    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { request: { title: 'ship' } },
    }), 'arguments-invalid')
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: 'ship' }, optional: true },
    }), 'arguments-invalid')
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: [] as unknown as Record<string, unknown>,
    }), 'arguments-invalid')
    expect(service.calls).toEqual([])
  })

  it('distinguishes strict input and result validation failures', async () => {
    const { ctx, service } = await setup()
    registerStrict(ctx, [strictOnlyDescriptor()])

    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'strictOnly',
      args: { request: { title: 1 } },
    }), 'input-invalid')

    service.nextResult = { title: 1 }
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'strictOnly',
      args: { request: { title: 'ship' } },
    }), 'result-invalid')
  })

  it('rejects non-JSON values after strict codec validation', async () => {
    const { ctx, service } = await setup()
    const descriptor = strictOnlyDescriptor()
    registerStrict(ctx, [{
      ...descriptor,
      result: strictCodec('@fixture/gateway#UnknownResult', z.unknown()),
    }])
    service.nextResult = 1n

    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'strictOnly',
      args: { request: { title: 'ship' } },
    }), 'result-invalid')
  })

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    Symbol('value'),
    () => 'value',
    new Date(0),
    new Map(),
    [, 'sparse'],
  ])('rejects non-JSON SRC input %#', async (value) => {
    const { ctx } = await setup()
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'passthrough',
      args: { value },
    }), 'input-invalid')
  })

  it('admits an omitted SRC field and hands the Host method undefined', async () => {
    const { ctx, service } = await setup()
    // A weak descriptor reads parameter names from the JavaScript signature and
    // cannot see which are optional, so an absent field is admitted; the case
    // above keeps an explicitly undefined field rejected.
    await expect(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'passthrough',
      args: {},
    })).resolves.toBeUndefined()
    expect(service.calls).toContain('passthrough')
  })

  it('rejects cyclic SRC input and non-JSON SRC results', async () => {
    const { ctx, service } = await setup()
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'passthrough',
      args: { value: cyclic },
    }), 'input-invalid')

    service.nextResult = new Date(0)
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'passthrough',
      args: { value: null },
    }), 'result-invalid')
  })

  it('accepts dense JSON and rejects decorated arrays and object properties', async () => {
    const { ctx } = await setup()
    await expect(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'passthrough',
      args: { value: [1, { nested: true }] },
    })).resolves.toEqual([1, { nested: true }])

    const sparseWithExtra = Array(1) as unknown[] & { extra?: boolean }
    sparseWithExtra.extra = true
    const symbolArray = [1]
    Object.defineProperty(symbolArray, Symbol('extra'), { value: true })
    const symbolObject = { value: true }
    Object.defineProperty(symbolObject, Symbol('extra'), { value: true })
    const hidden = {}
    Object.defineProperty(hidden, 'value', { value: true, enumerable: false })
    const accessor = {}
    Object.defineProperty(accessor, 'value', { get: () => true, enumerable: true })
    for (const value of [sparseWithExtra, symbolArray, symbolObject, hidden, accessor]) {
      await expectCode(ctx.typertGateway.invoke({
        namespace: 'goals', method: 'passthrough', args: { value },
      }), 'input-invalid')
    }
  })

  it('validates strict provider identity against generated wire metadata', async () => {
    const { ctx } = await setup()
    ctx.typert.lookups.register('gatewayFixture', {
      ...agentLookup({ id: 'agent-1' }),
      wire: 'differentAgentId',
    })
    registerStrict(ctx, [createDescriptor()])

    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'create',
      args: { agentId: 'agent-1', request: { title: 'ship' } },
    }), 'provider-mismatch')
  })

  it('validates binding identity and active method availability', async () => {
    const ctx = await setupGateway()
    await ctx.plugin(WrongBindingService)
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'wrong-binding',
      method: 'run',
      args: { value: 'ship' },
    }), 'binding-invalid')

    await ctx.plugin(GoalService)
    registerStrict(ctx, [{ ...passthroughDescriptor(), method: 'missing' }])
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'missing',
      args: { value: 'ship' },
    }), 'method-unavailable')
  })

  it('requires a visible binding and supports explicitly provided plain Services', async () => {
    const ctx = await setupGateway()
    await ctx.plugin(NoBindingService)
    registerStrict(ctx, [{
      ...passthroughDescriptor(),
      id: '@fixture/gateway#no-binding/run',
      service: 'noBinding',
      namespace: 'no-binding',
      method: 'run',
    }])
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'no-binding', method: 'run', args: { value: 'ship' },
    }), 'binding-invalid')

    const plain: {
      typertRemote?: ReturnType<typeof bindTypertRemote>
      run(value: string): string
    } = { run: value => value }
    plain.typertRemote = bindTypertRemote(plain, 'plainRemote', { namespace: 'plain' })
    ctx.provide('plainRemote', plain)
    ctx.typert.register({
      package: '@fixture/plain',
      face: 'host',
      schemas: [],
      model: emptyModel,
      invocations: [{
        ...passthroughDescriptor(),
        id: '@fixture/plain#plain/run',
        service: 'plainRemote',
        namespace: 'plain',
        method: 'run',
      }],
    })
    await expect(ctx.typertGateway.invoke({
      namespace: 'plain', method: 'run', args: { value: 'land' },
    })).resolves.toBe('land')
  })

  it('reports a SRC marker whose prototype implementation disappeared', async () => {
    const ctx = await setupGateway()
    await ctx.plugin(MissingMethodService)
    const descriptor = Object.getOwnPropertyDescriptor(MissingMethodService.prototype, 'run')!
    Object.defineProperty(MissingMethodService.prototype, 'run', {
      configurable: true,
      value: 42,
    })
    try {
      await expectCode(ctx.typertGateway.invoke({
        namespace: 'missing-method', method: 'run', args: { value: 'ship' },
      }), 'method-unavailable')
    } finally {
      Object.defineProperty(MissingMethodService.prototype, 'run', descriptor)
    }
  })

  it('preserves business exception identity after invocation begins', async () => {
    const { ctx, service } = await setup()
    const failure = new Error('business identity')
    service.businessError = failure

    await expect(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'fail',
      args: { request: { reason: 'fixture' } },
    })).rejects.toBe(failure)
  })

  it('reports an absent endpoint without retaining receiver state', async () => {
    const { ctx } = await setup()
    await expectCode(ctx.typertGateway.invoke({
      namespace: 'goals',
      method: 'absent',
      args: {},
    }), 'invocation-unavailable')
  })

  it('mounts a shared /api interceptor through an optional Connection and returns existing RPC results', async () => {
    const ctx = new Context().extend({ fixtureScope: 'rpc-caller' })
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(FakeConnectionService)
    const gatewayFiber = ctx.plugin(TypertGatewayService)
    await gatewayFiber
    await ctx.plugin(GoalService)
    const connection = rawConnection(ctx)
    expect(connection).toMatchObject({ channel: '/api', authority: 'trusted-host' })

    registerAgentLookup(ctx, { id: 'agent-1' })
    registerStrict(ctx, [createDescriptor(), maybeDescriptor()])
    expect(connection.matches?.('goals/create')).toBe(true)
    expect(connection.matches?.('goals/passthrough')).toBe(true)
    expect(connection.matches?.('goals')).toBe(false)
    expect(connection.matches?.('goals/missing')).toBe(false)
    expect(connection.matches?.('legacy/list')).toBe(false)
    const abort = new AbortController()
    const signal = abort.signal
    const handler = connection.handler
    if (handler === undefined) throw new Error('fixture Connection did not retain the /api interceptor')
    await expect(handler('goals/create', {
      args: { agentId: 'agent-1', request: { title: 'ship' } },
    }, signal)).resolves.toEqual({
      ok: true,
      value: { agentId: 'agent-1', title: 'ship', scope: 'rpc-caller' },
    })
    const service = rawGoalService(ctx)
    expect(service.lastSignal).toBe(signal)
    abort.abort(new Error('client disconnected'))
    expect(service.lastSignal?.aborted).toBe(true)
    const invalid = await handler('goals/create', { invalid: true }, signal)
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    if (invalid.ok) throw new Error('invalid Remote payload unexpectedly succeeded')
    expect(invalid.error.message).toMatch(/exactly one plain-object args field/)

    await expect(handler('goals/maybe', { args: {} }, signal)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    await expect(handler('goals/maybe', { args: { value: null } }, signal)).resolves.toEqual({
      ok: true,
      value: null,
    })

    for (const endpoint of ['goals', '/create', 'goals/', 'goals/create/extra']) {
      const result = await handler(endpoint, { args: {} }, signal)
      expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
      if (result.ok) throw new Error('invalid Remote endpoint unexpectedly succeeded')
      expect(result.error.message).toContain('invalid Remote endpoint')
    }
    for (const payload of [null, [], { args: {}, extra: true }, { only: true }, { args: null }, { args: [] }]) {
      const result = await handler('goals/create', payload, signal)
      expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
      if (result.ok) throw new Error('invalid Remote payload unexpectedly succeeded')
      expect(result.error.message).toContain('plain-object args field')
    }

    service.businessError = 'non-error failure' as unknown as Error
    await expect(handler(
      'goals/fail',
      { args: { request: null } },
      new AbortController().signal,
    )).resolves.toEqual({
      ok: false,
      error: { code: 'internal', message: 'non-error failure', details: {} },
    })

    // A business rejection observed while the carrier signal is already aborted
    // is the caller's cancellation, not an internal gateway fault.
    const cancelledCall = new AbortController()
    cancelledCall.abort(new Error('client disconnected'))
    service.businessError = new Error('fixture business failure')
    await expect(handler(
      'goals/fail',
      { args: { request: null } },
      cancelledCall.signal,
    )).resolves.toEqual({
      ok: false,
      error: {
        code: 'cancelled',
        message: 'Remote invocation "goals/fail" was aborted',
        details: {},
      },
    })

    await gatewayFiber.dispose()
    expect(connection.handler).toBeUndefined()
  })

  it('preserves a lookup policy rejection through the Connection RPC result', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(FakeConnectionService)
    await ctx.plugin(TypertGatewayService)
    await ctx.plugin(GoalService)
    registerStrict(ctx, [createDescriptor()])
    const failure = {
      code: 'agent-busy',
      message: 'session is owned by subagent routing',
      details: { reason: 'use subagent delivery for this child session' },
    }
    ctx.typert.lookups.register('gatewayFixture', {
      ...agentLookup({ id: 'agent-1' }),
      resolve: () => { throw new TypertLookupFailure(failure) },
    })
    const handler = rawConnection(ctx).handler
    if (handler === undefined) throw new Error('fixture Connection did not retain the /api interceptor')

    await expect(handler('goals/create', {
      args: { agentId: 'agent-1', request: { title: 'ship' } },
    }, new AbortController().signal)).resolves.toEqual({ ok: false, error: failure })
  })

  it('caches SRC ownership until the Cordis Service set changes', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(FakeConnectionService)
    await ctx.plugin(TypertGatewayService)
    const observedFiber = ctx.plugin(ObservedClaimService)
    await observedFiber
    const connection = rawConnection(ctx)
    const observed = ctx.get('observedClaim') as unknown as ObservedClaimService & {
      [symbols.original]?: ObservedClaimService
    }
    const service = observed[symbols.original] ?? observed

    expect(connection.matches?.('legacy/list')).toBe(false)
    expect(connection.matches?.('legacy/list')).toBe(false)
    expect(service.bindingReads).toBe(1)
    expect(connection.matches?.('observed-claim/run')).toBe(true)
    expect(connection.matches?.('observed-claim/run')).toBe(true)
    expect(service.bindingReads).toBe(1)

    const unrelatedFiber = ctx.plugin(NoBindingService)
    await unrelatedFiber
    expect(connection.matches?.('legacy/list')).toBe(false)
    expect(service.bindingReads).toBe(2)

    await observedFiber.dispose()
    expect(connection.matches?.('observed-claim/run')).toBe(false)
    await unrelatedFiber.dispose()
  })

  it('dispatches claimed invocations through /api and leaves unclaimed endpoints to its fallback', async () => {
    const ctx = new Context().extend({ fixtureScope: 'http-caller' })
    const routes: WebRoute[] = []
    ctx.provide('webServer', fakeHttpServer(routes) as WebServer)
    const connectionFiber = ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
    await connectionFiber
    await ctx.plugin(TypertRegistry)
    const gatewayFiber = ctx.plugin(TypertGatewayService)
    await gatewayFiber
    const goalFiber = ctx.plugin(GoalService)
    await goalFiber
    const removeLookup = registerAgentLookup(ctx, { id: 'agent-1' })
    const removeStrict = registerStrict(ctx, [createDescriptor()])
    let strictActive = true
    expect(routes).toHaveLength(1)
    const server = await serveRoute(routes[0]!)

    try {
      const response = await fetch(`${server.origin}/api/goals/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'rpc-http',
          method: 'goals/create',
          payload: { args: { agentId: 'agent-1', request: { title: '  ship  ' } } },
        }),
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        type: 'server-response',
        rpcId: 'rpc-http',
        result: {
          ok: true,
          value: { agentId: 'agent-1', title: 'ship', scope: 'http-caller' },
        },
      })

      const invalid = await fetch(`${server.origin}/api/goals/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'rpc-invalid',
          method: 'goals/create',
          payload: { invalid: true },
        }),
      })
      expect(invalid.status).toBe(200)
      const invalidBody = await invalid.json() as unknown
      expect(invalidBody).toMatchObject({
        type: 'server-response',
        rpcId: 'rpc-invalid',
        result: {
          ok: false,
          error: { code: 'internal' },
        },
      })
      expect(JSON.stringify(invalidBody)).toContain('plain-object args field')

      await removeStrict()
      strictActive = false
      const withdrawn = await fetch(`${server.origin}/api/goals/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'rpc-withdrawn',
          method: 'goals/create',
          payload: { args: { agentId: 'agent-1', request: { title: 'ship' } } },
        }),
      })
      expect(withdrawn.status).toBe(200)
      const withdrawnBody = await withdrawn.json() as unknown
      expect(withdrawnBody).toMatchObject({
        type: 'server-response',
        rpcId: 'rpc-withdrawn',
        result: {
          ok: false,
          error: { code: 'internal' },
        },
      })
      expect(JSON.stringify(withdrawnBody)).toContain('strict definition was withdrawn')

      const unclaimed = await fetch(`${server.origin}/api/legacy/list`, { method: 'POST' })
      expect(unclaimed.status).toBe(404)
    } finally {
      await server.close()
      if (strictActive) await removeStrict()
      await removeLookup()
      await goalFiber.dispose()
      await gatewayFiber.dispose()
      await connectionFiber.dispose()
    }
    expect(routes).toHaveLength(0)
  })
})

/** 装配网关和 GoalService，并返回可检查的原始服务及 fiber。 */
async function setup(): Promise<{
  readonly ctx: Context
  readonly service: GoalService
  readonly serviceFiber: ReturnType<Context['plugin']>
}> {
  const ctx = await setupGateway()
  const serviceFiber = ctx.plugin(GoalService)
  await serviceFiber
  return { ctx, service: rawGoalService(ctx), serviceFiber }
}

/** 创建只挂载 Typert 注册表和 Host 网关的最小上下文。 */
async function setupGateway(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService)
  return ctx
}

/** 从 Cordis 代理服务中取得测试需要检查的原始 GoalService。 */
function rawGoalService(ctx: Context): GoalService {
  const receiver = ctx.get('goals') as unknown as GoalService & { [symbols.original]?: GoalService }
  return receiver[symbols.original] ?? receiver
}

/** 从 Cordis 代理服务中取得模拟连接的原始实例。 */
function rawConnection(ctx: Context): FakeConnectionService {
  const receiver = ctx.get('connection') as unknown as FakeConnectionService & {
    [symbols.original]?: FakeConnectionService
  }
  return receiver[symbols.original] ?? receiver
}

/** 向 Host 面注册一组严格调用描述符并返回异步注销器。 */
function registerStrict(ctx: Context, descriptors: readonly InvocationDescriptor[]): () => Promise<void> {
  return ctx.typert.register({
    package: '@fixture/gateway',
    face: 'host',
    schemas: [],
    model: emptyModel,
    invocations: descriptors,
  })
}

/** 注册把固定代理标识解析为业务代理对象的查找提供者。 */
function registerAgentLookup(ctx: Context, agent: FixtureAgent): () => Promise<void> {
  return ctx.typert.lookups.register('gatewayFixture', agentLookup(agent))
}

/** 构造 FixtureAgent 与线协议字符串标识之间的查找提供者。 */
function agentLookup(agent: FixtureAgent): TypertLookupProvider<FixtureAgent, string> {
  return {
    parameter: 'agent',
    wire: 'agentId',
    hostTypeSymbol: '@fixture/domain#Agent',
    wireTypeSymbol: '@fixture/domain#AgentId',
    resolve: id => id === agent.id ? agent : undefined,
  }
}

/** 构造把固定代理标识解析为调用 Context 的作用域提供者。 */
function contextProvider(context: Context) {
  return {
    wire: 'agentId',
    wireTypeSymbol: '@fixture/domain#AgentId',
    resolve: (id: string) => id === 'agent-1' ? context : undefined,
  }
}

/** 将类型符号和 Zod 模式包装为严格 Typert 编解码描述。 */
function strictCodec(typeSymbol: string, schema: z.ZodType): InvocationDescriptor['result'] {
  return { mode: 'strict', typeSymbol, schema }
}

/** 构造 GoalService.create 的直接远程调用描述符。 */
function createDescriptor(): InvocationDescriptor {
  return {
    id: '@fixture/gateway#goals/create',
    service: 'goals',
    namespace: 'goals',
    method: 'create',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'agent',
        wire: 'agentId',
        source: 'lookup',
        lookup: 'gatewayFixture',
        codec: strictCodec('@fixture/domain#AgentId', z.string()),
      },
      {
        name: 'request',
        wire: 'request',
        source: 'json',
        codec: strictCodec('@fixture/gateway#CreateRequest', z.object({
          title: z.string().transform(value => value.trim()),
        })),
      },
    ],
    cancellation: { parameter: 'signal' },
    result: strictCodec('@fixture/gateway#CreateResult', z.object({
      agentId: z.string(),
      title: z.string(),
      scope: z.string(),
    })),
  }
}

/** 构造从 Host Context 取得代理作用域的 rename 描述符。 */
function renameDescriptor(): InvocationDescriptor {
  return {
    id: '@fixture/gateway#goals/rename',
    service: 'goals',
    namespace: 'goals',
    method: 'rename',
    invocation: {
      kind: 'context',
      context: 'gatewayFixture',
      wire: 'agentId',
      codec: strictCodec('@fixture/domain#AgentId', z.string()),
    },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: strictCodec('@fixture/gateway#RenameRequest', z.object({ title: z.string() })),
    }],
    result: strictCodec('@fixture/gateway#RenameResult', z.object({
      title: z.string(),
      scope: z.string(),
    })),
  }
}

/** 构造使用源 JSON 透传模式的调用描述符。 */
function passthroughDescriptor(): InvocationDescriptor {
  return {
    id: '@fixture/gateway#goals/passthrough',
    service: 'goals',
    namespace: 'goals',
    method: 'passthrough',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'value',
      wire: 'value',
      source: 'json',
      codec: { mode: 'src-json' },
    }],
    result: { mode: 'src-json' },
  }
}

/** 构造输入和输出复用同一严格对象模式的描述符。 */
function strictOnlyDescriptor(): InvocationDescriptor {
  const value = strictCodec('@fixture/gateway#StrictValue', z.object({ title: z.string() }))
  return {
    id: '@fixture/gateway#goals/strictOnly',
    service: 'goals',
    namespace: 'goals',
    method: 'strictOnly',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: value }],
    result: value,
  }
}

function maybeDescriptor(): InvocationDescriptor {
  // 同时接受字符串、null 和 undefined 的严格编解码说明。
  const value = strictCodec(
    '@fixture/gateway#MaybeValue',
    z.union([z.string(), z.null(), z.undefined()]),
  )
  return {
    id: '@fixture/gateway#goals/maybe',
    service: 'goals',
    namespace: 'goals',
    method: 'maybe',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'value',
      wire: 'value',
      source: 'json',
      acceptsUndefined: true,
      codec: value,
    }],
    result: value,
  }
}

/** 执行失败 Promise 并断言其 TypertGatewayError 错误码。 */
async function expectCode(
  promise: Promise<unknown>,
  code: TypertGatewayError['code'],
): Promise<TypertGatewayError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(TypertGatewayError)
    expect(error).toMatchObject({ code })
    return error as TypertGatewayError
  }
  throw new Error(`expected TypertGatewayError ${code}`)
}
