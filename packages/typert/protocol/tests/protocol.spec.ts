/**
 * 文件职责：验证 protocol.spec.ts 覆盖的Typert 类型系统行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的Typert 类型系统能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  bindTypertRemote,
  TypertRemoteService,
  Remote,
  RemoteScope,
  remoteMethods,
  type TypertClientEventListener,
  type TypertContext,
  /** 中文说明：type TypertForwardableEvent 定义本测试所需的数据或行为，用于表达Typert 类型系统场景。 */
  type TypertForwardableEvent,
  type TypertForwardableEventEntry,
  type TypertLookup,
  type TypertRemoteEvent,
} from '@deepseek-ai/dsh-typert-protocol'

interface MetaFixtureSubject {
  readonly subjectId: string
}

interface MetaFixtureRequest {
  readonly agent: MetaFixtureSubject
  readonly signal?: AbortSignal
  readonly nested: readonly [{ readonly owner?: MetaFixtureSubject }]
  readonly transform: (subject: MetaFixtureSubject) => Promise<MetaFixtureSubject | undefined>
}

declare module '@deepseek-ai/cordis' {
  /** 中文说明：interface Events 定义本测试所需的数据或行为，用于表达Typert 类型系统场景。 */
  interface Events {
    /**
     * Test-only one-way event: bound to no Scope and returning nothing.
     * @param value - marker payload.
     */
    'meta-fixture/forwardable'(value: string): void
    /**
     * Test-only Scope-bound event, which no carrier can deliver one-way.
     * @param value - marker payload.
     */
    'meta-fixture/scoped'(this: Context, value: string): void
    /**
     * Test-only scoped waterfall whose result can make the return trip.
     * @param value - marker payload.
     * @param next - delegates to the next listener.
     * @returns the claimed or delegated value.
     */
    'meta-fixture/waterfall'(
      this: Context,
      request: MetaFixtureRequest,
      next: () => Promise<string>,
    ): Promise<string>
    /**
     * Test-only answered event, whose result no one-way delivery can return.
     * @param value - marker payload.
     * @returns the replacement value.
     */
    'meta-fixture/answered'(value: string): string
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    metaFixture: TypertLookup<MetaFixtureSubject, string>
  }

  interface TypertContextMap {
    metaFixture: TypertContext<string>
  }

  /** 中文说明：interface TypertRemoteEventSelection 定义本测试所需的数据或行为，用于表达Typert 类型系统场景。 */
  interface TypertRemoteEventSelection extends
    Record<'meta-fixture/forwardable' | 'meta-fixture/waterfall' | 'meta-fixture/absent', true> {}
}

describe('typert-protocol Remote declarations', () => {
  it('binds a TypertRemoteService name and executes decorators through the Vitest source transform', async () => {
    /** 中文说明：class Goals 定义本测试所需的数据或行为，用于表达Typert 类型系统场景。 */
    class Goals extends TypertRemoteService {
      constructor(ctx: Context) {
        super(ctx, 'goals')
      }

      @Remote
      create(value: string): string {
        return value
      }

      @Remote({ mode: 'stream' })
      *watch(): Iterable<string> {
        yield 'value'
      }

      @RemoteScope('metaFixture')
      scoped(value: string): string {
        return value
      }
    }

    /** 中文说明：class NamespacedGoals 定义本测试所需的数据或行为，用于表达Typert 类型系统场景。 */
    class NamespacedGoals extends TypertRemoteService {
      constructor(ctx: Context) {
        super(ctx, 'internalGoals', { namespace: 'goals' })
      }
    }

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 goals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const goals = new Goals(ctx)
    /** 中文说明：变量 namespaced 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const namespaced = new NamespacedGoals(ctx)
    expect(goals.typertRemote).toEqual({ service: goals, serviceKey: 'goals', namespace: 'goals' })
    expect(namespaced.typertRemote).toEqual({
      service: namespaced,
      serviceKey: 'internalGoals',
      namespace: 'goals',
    })
    expect(remoteMethods(goals)).toEqual([
      { method: 'create', invocation: { kind: 'direct' } },
      { method: 'watch', mode: 'stream', invocation: { kind: 'direct' } },
      { method: 'scoped', invocation: { kind: 'context', context: 'metaFixture' } },
    ])
    await ctx.fiber.dispose()
  })

  it('executes standard decorator syntax through the TSX source launcher', () => {
    /** 中文说明：变量 fixture 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fixture = fileURLToPath(new URL('./fixtures/source-launch.ts', import.meta.url))
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = execFileSync(process.execPath, ['--import', 'tsx/esm', fixture], { encoding: 'utf8' })
    expect(JSON.parse(output)).toEqual([
      { method: 'create', invocation: { kind: 'direct' } },
      { method: 'scoped', invocation: { kind: 'context', context: 'agent' } },
    ])
  })

  it('keeps decorator markers in private module state', () => {
    /** 中文说明：class Goals 定义本测试所需的数据或行为，用于表达Typert 类型系统场景。 */
    class Goals {
      readonly typertRemote = bindTypertRemote(this, 'goals')

      create(agent: object, request: object): object {
        return { agent, request }
      }

      scoped(request: object): object {
        return request
      }
    }

    /** 中文说明：函数值 initializers 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const initializers: Array<(this: Goals) => void> = []
    Remote(
      Reflect.get(Goals.prototype, 'create') as (this: Goals, ...args: unknown[]) => unknown,
      methodContext('create', initializers),
    )
    RemoteScope('metaFixture')(
      Reflect.get(Goals.prototype, 'scoped') as (this: Goals, ...args: unknown[]) => unknown,
      methodContext('scoped', initializers),
    )

    /** 中文说明：变量 goals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const goals = new Goals()
    /** 中文说明：该循环依次处理输入或结果；循环变量仅在当前循环中有效。 */
    for (const initialize of initializers) initialize.call(goals)
    expect(goals.typertRemote).toEqual({ service: goals, serviceKey: 'goals', namespace: 'goals' })
    expect(Object.isFrozen(goals.typertRemote)).toBe(true)
    expect(remoteMethods(goals)).toEqual([
      { method: 'create', invocation: { kind: 'direct' } },
      { method: 'scoped', invocation: { kind: 'context', context: 'metaFixture' } },
    ])
    expect(Reflect.ownKeys(Goals)).toEqual(['length', 'name', 'prototype'])
    expect(Reflect.ownKeys(Goals.prototype)).toEqual(['constructor', 'create', 'scoped'])
  })

  it('keeps markers idempotent across instances and returns detached snapshots', () => {
    /** 中文说明：class Service 定义本测试所需的数据或行为，用于表达Typert 类型系统场景。 */
    class Service {
      run(value: string): string {
        return value
      }
    }

    /** 中文说明：函数值 initializers 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const initializers: Array<(this: Service) => void> = []
    Remote(
      Reflect.get(Service.prototype, 'run') as (this: Service, ...args: unknown[]) => unknown,
      methodContext('run', initializers),
    )

    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = new Service()
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = new Service()
    /** 中文说明：该循环依次处理输入或结果；循环变量仅在当前循环中有效。 */
    for (const initialize of initializers) {
      initialize.call(first)
      initialize.call(second)
    }
    /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const snapshot = remoteMethods(first)
    expect(remoteMethods(second)).toEqual(snapshot)
    ;(snapshot as unknown as { method: string }[])[0]!.method = 'changed'
    expect(remoteMethods(first)).toEqual([{ method: 'run', invocation: { kind: 'direct' } }])
  })

  it('supports explicit export names without exposing marker storage', () => {
    /** 中文说明：class Service 定义本测试所需的数据或行为，用于表达Typert 类型系统场景。 */
    class Service {
      run(value: string): string {
        return value
      }

      scoped(value: string): string {
        return value
      }
    }
    /** 中文说明：函数值 initializers 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const initializers: Array<(this: Service) => void> = []
    Remote('execute')(
      Reflect.get(Service.prototype, 'run') as (this: Service, ...args: unknown[]) => unknown,
      methodContext('run', initializers),
    )
    RemoteScope('metaFixture', 'inspect')(
      Reflect.get(Service.prototype, 'scoped') as (this: Service, ...args: unknown[]) => unknown,
      methodContext('scoped', initializers),
    )
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = new Service()
    /** 中文说明：该循环依次处理输入或结果；循环变量仅在当前循环中有效。 */
    for (const initialize of initializers) initialize.call(service)

    expect(remoteMethods(service)).toEqual([
      { method: 'run', exportName: 'execute', invocation: { kind: 'direct' } },
      { method: 'scoped', exportName: 'inspect', invocation: { kind: 'context', context: 'metaFixture' } },
    ])
    expect(remoteMethods({})).toEqual([])
    /** 中文说明：变量 prototypeLess 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prototypeLess: object = {}
    Reflect.setPrototypeOf(prototypeLess, null)
    expect(remoteMethods(prototypeLess)).toEqual([])
  })

  it('rejects malformed decorator calls and targets', () => {
    /** 中文说明：函数值 method 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const method: (this: object) => void = function (this: object): void {}
    expect(() => { (Remote as unknown as (value: typeof method) => void)(method) }).toThrow('context is missing')
    expect(() => Remote('bad/name')).toThrow('export name')
    expect(() => Remote('bad#name')).toThrow('export name')
    expect(() => Remote('bad name')).toThrow('export name')
    expect(() => Remote('.')).toThrow('export name')
    expect(() => Remote('..')).toThrow('export name')
    expect(() => Remote({ mode: 'unary' } as unknown as { mode: 'stream' })).toThrow('exactly mode')
    expect(() => Remote({ mode: 'stream', extra: true } as unknown as { mode: 'stream' })).toThrow('exactly mode')
    expect(() => RemoteScope('' as 'metaFixture')).toThrow('Scope key')
    expect(() => RemoteScope('metaFixture', 'bad/name')).toThrow('export name')

    /** 中文说明：该循环依次处理输入或结果；循环变量仅在当前循环中有效。 */
    for (const context of [
      { ...methodContext('run', []), private: true },
      { ...methodContext('run', []), static: true },
      { ...methodContext('run', []), name: Symbol('run') },
    ]) {
      expect(() => { Remote(method, context) })
        .toThrow('public instance method')
    }
  })

  it('rejects prototype-less initialization and conflicting markers', () => {
    /** 中文说明：函数值 method 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const method: (this: object) => void = function (this: object): void {}
    /** 中文说明：函数值 direct 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const direct: Array<(this: object) => void> = []
    Remote(method, methodContext('run', direct))
    /** 中文说明：变量 prototypeLess 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prototypeLess: object = {}
    Reflect.setPrototypeOf(prototypeLess, null)
    expect(() => { direct[0]!.call(prototypeLess) }).toThrow('without a prototype')

    const stream: Array<(this: object) => void> = []
    Remote({ mode: 'stream' })(method, methodContext('run', stream))
    const conflict = Object.create({}) as object
    direct[0]!.call(conflict)
    expect(() => { stream[0]!.call(conflict) }).toThrow('conflicting invocation markers')

    class Service {
      run(): void {}
    }
    /** 中文说明：函数值 conflicting 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const conflicting: Array<(this: Service) => void> = []
    Remote(
      Reflect.get(Service.prototype, 'run'),
      methodContext('run', conflicting),
    )
    RemoteScope('metaFixture')(
      Reflect.get(Service.prototype, 'run'),
      methodContext('run', conflicting),
    )
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = new Service()
    conflicting[0]!.call(service)
    expect(() => { conflicting[1]!.call(service) }).toThrow('conflicting invocation markers')
  })

  it('rejects ambiguous binding names', () => {
    expect(() => bindTypertRemote({}, '')).toThrow('service key')
    expect(() => bindTypertRemote({}, 'goals', { namespace: 'api/goals' })).toThrow('namespace')
    expect(() => bindTypertRemote({}, 'goals', { namespace: 'api goals' })).toThrow('namespace')
  })

  it('admits notifications and same-result scoped waterfalls selected from Cordis Events', () => {
    expectTypeOf<'meta-fixture/forwardable'>().toExtend<TypertForwardableEvent>()
    expectTypeOf<'meta-fixture/waterfall'>().toExtend<TypertForwardableEvent>()
    expectTypeOf<'meta-fixture/scoped'>().not.toExtend<TypertForwardableEvent>()
    expectTypeOf<'meta-fixture/answered'>().not.toExtend<TypertForwardableEvent>()

    expectTypeOf<'meta-fixture/forwardable'>().toExtend<TypertRemoteEvent>()
    expectTypeOf<'meta-fixture/waterfall'>().toExtend<TypertRemoteEvent>()
    expectTypeOf<'meta-fixture/scoped'>().not.toExtend<TypertRemoteEvent>()
    expectTypeOf<'meta-fixture/absent'>().not.toExtend<TypertRemoteEvent>()

    expectTypeOf<{ event: 'meta-fixture/forwardable'; mode: 'emit' }>()
      .toExtend<TypertForwardableEventEntry>()
    expectTypeOf<{ event: 'meta-fixture/waterfall'; mode: 'waterfall' }>()
      .toExtend<TypertForwardableEventEntry>()
    expectTypeOf<{ event: 'meta-fixture/waterfall'; mode: 'emit' }>()
      .not.toExtend<TypertForwardableEventEntry>()
  })

  it('derives Client Context arguments from the selected Cordis waterfall declaration', () => {
    type ExpectedListener = (
      this: Context,
      request: {
        readonly agent: Context
        readonly signal?: AbortSignal
        readonly nested: readonly [{ readonly owner?: MetaFixtureSubject }]
        readonly transform: (subject: MetaFixtureSubject) => Promise<MetaFixtureSubject | undefined>
      },
      next: () => Promise<string>,
    ) => Promise<string>

    expectTypeOf<TypertClientEventListener<'meta-fixture/waterfall'>>()
      .toEqualTypeOf<ExpectedListener>()
    expectTypeOf<TypertClientEventListener<'meta-fixture/forwardable'>>()
      .toEqualTypeOf<(value: string) => void>()
  })
})

/** 中文说明：函数 methodContext 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function methodContext<This extends object>(
  name: string,
  initializers: Array<(this: This) => void>,
): ClassMethodDecoratorContext<This, (this: This, ...args: unknown[]) => unknown> {
  return {
    kind: 'method',
    name,
    static: false,
    private: false,
    metadata: {},
    access: {
      has: object => name in object,
      get: object => (object as Record<string, unknown>)[name] as (this: This, ...args: unknown[]) => unknown,
    },
    addInitializer: (initializer) => { initializers.push(initializer) },
  }
}
