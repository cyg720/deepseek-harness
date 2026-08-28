/**
 * 文件职责：验证 test-invariants.spec.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context, FiberState, Service, ValidationError } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { packageInvariantOwners } from './package-invariants.ts'
import {
  TEST_INVARIANT_READY_SERVICE,
  testInvariantCompanionPaths,
  testInvariantCompanions,
  /** 中文说明：type TestInvariantCompanion 定义本测试所需的数据或行为，用于表达仓库脚本场景。 */
  type TestInvariantCompanion,
  usesManualInvariantTree,
} from './test-invariants.ts'

declare module '@deepseek-ai/cordis' {
  /** 中文说明：interface Context 定义本测试所需的数据或行为，用于表达仓库脚本场景。 */
  interface Context {
    testInvariantProbe: TestInvariantProbe
  }
}

/** 中文说明：class TestInvariantProbe 定义本测试所需的数据或行为，用于表达仓库脚本场景。 */
class TestInvariantProbe extends Service {
  constructor(ctx: Context) {
    super(ctx, 'testInvariantProbe')
  }
}

/** 中文说明：函数 deferred 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  /** 中文说明：函数值 resolve 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  let resolve!: () => void
  /** 中文说明：函数值 promise 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** 中文说明：函数 requiredConfig 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function requiredConfig() {
  return z.object({
    requiredValue: z.string().required(),
  })
}

/** 中文说明：函数 invalidConfigApply 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function invalidConfigApply(): never {
  throw new Error('invalid plugin apply executed')
}

/** 中文说明：函数 rejectionOf 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function rejectionOf(fiber: ReturnType<Context['plugin']>): Promise<unknown> {
  return fiber.then(
    () => undefined,
    (error: unknown) => error,
  )
}

/** 中文说明：函数 expectRequiredConfigValidation 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function expectRequiredConfigValidation(error: unknown): void {
  expect(error).toBeInstanceOf(ValidationError)
  expect(error).toHaveProperty('message', expect.stringMatching(/requiredValue/))
}

/** 中文说明：函数 withFakeCompanions 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function withFakeCompanions(
  create: (path: string, index: number) => () => Promise<TestInvariantCompanion>,
  run: () => Promise<void>,
): Promise<void> {
  /** 中文说明：函数值 mutable 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const mutable = testInvariantCompanions as Record<string, () => Promise<TestInvariantCompanion>>
  /** 中文说明：变量 originals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const originals = Object.entries(mutable)
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const [index, [path]] of originals.entries()) {
    mutable[path] = create(path, index)
  }
  try {
    await run()
  } finally {
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const [path, load] of originals) {
      mutable[path] = load
    }
  }
}

/** 中文说明：函数 withDelayedFirstCompanion 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function withDelayedFirstCompanion(
  run: (control: { readonly started: Promise<void>; readonly release: () => void }) => Promise<void>,
): Promise<void> {
  /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const started = deferred()
  /** 中文说明：变量 release 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const release = deferred()
  await withFakeCompanions(
    (_path, index) => async () => ({
      name: `test-invariant-${index}`,
      inject: ['invariants'],
      async apply() {
        if (index === 0) {
          started.resolve()
          await release.promise
        }
        return () => {}
      },
    }),
    () => run({ started: started.promise, release: release.resolve }),
  )
}

describe('global test invariant host', () => {
  it('uses one exhaustive topology to reserve every package name with enabled checks', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(TestInvariantProbe)

    /** 中文说明：变量 owners 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owners = packageInvariantOwners(process.cwd())
    expect(Object.keys(testInvariantCompanions)).toHaveLength(owners.length)
    /** 中文说明：变量 unreserved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unreserved: string[] = []
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const owner of owners) {
      try {
        /** 中文说明：函数值 dispose 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const dispose = ctx.invariants.register(owner.packageName, () => {})
        unreserved.push(owner.packageName)
        dispose()
      } catch (error) {
        expect(error).toHaveProperty(
          'message',
          `invariants: package "${owner.packageName}" is already registered`,
        )
      }
    }
    expect(unreserved).toEqual([])
  })

  it('mounts the owning package companion while leaving non-package roots service-only', () => {
    expect(testInvariantCompanionPaths('/repo/packages/core/tools/tests/tools.spec.ts'))
      .toEqual(['../packages/core/tools/src/invariant.ts'])
    expect(testInvariantCompanionPaths('/repo/apps/cli/tests/profiles/headless/example.spec.ts')).toEqual([])
    expect(testInvariantCompanionPaths('/repo/scripts/test-invariants.spec.ts'))
      .toEqual(Object.keys(testInvariantCompanions).sort())
  })

  it('loads and executes every source companion through the real Loader setup', async () => {
    /** 中文说明：函数值 owners 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const owners = new Map(packageInvariantOwners(process.cwd()).map(owner => [owner.sourcePath, owner.packageName]))
    /** 中文说明：变量 registrations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registrations = new Map<string, string>()
    /** 中文说明：变量 loader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：函数值 register 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const register = vi.fn((_packageName: string, installer: InvariantInstaller) => {
      expect(typeof installer).toBe('function')
      return () => {}
    })
    /** 中文说明：变量 fakeContext 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fakeContext = { invariants: { register } } as unknown as Context
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const [rawPath, load] of Object.entries(testInvariantCompanions)) {
      /** 中文说明：变量 companion 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const companion = await load()
      /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const path = rawPath.replace(/^\.\.\//, '')
      expect(companion.default, path).toBeUndefined()
      /** 中文说明：变量 unwrapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const unwrapped = loader.unwrapExports(companion) as typeof companion
      expect(unwrapped, path).toBe(companion)
      expect(typeof unwrapped.name, path).toBe('string')
      expect(unwrapped.inject, path).toContain('invariants')
      expect(typeof unwrapped.apply, path).toBe('function')
      await unwrapped.apply(fakeContext)
      /** 中文说明：变量 call 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const call = register.mock.calls.at(-1)
      if (call === undefined) throw new Error(`${path}: companion did not register`)
      registrations.set(path, call[0])
    }
    expect(registrations).toEqual(owners)
  })

  it('recognizes focused invariant suites without a package inventory', () => {
    expect(usesManualInvariantTree('/repo/packages/core/session/tests/invariant.spec.ts')).toBe(true)
    expect(usesManualInvariantTree('/repo/packages/core/session/tests/request-invariant-hmr.spec.ts')).toBe(true)
    expect(usesManualInvariantTree('C:\\repo\\packages\\runtime-diagnostics\\invariants\\tests\\service.spec.ts')).toBe(true)
    expect(usesManualInvariantTree('/repo/packages/examples/agent-spine-demo/tests/agent-core.spec.ts')).toBe(true)
    expect(usesManualInvariantTree('/repo/packages/core/session/tests/session.spec.ts')).toBe(false)
  })

  it('preserves config validation failures without starting the rejected plugin', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 apply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const apply = vi.fn(invalidConfigApply)
    /** 中文说明：变量 plugin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plugin = {
      apply,
      Config: requiredConfig(),
    }

    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = ctx.plugin(plugin, {})
    /** 中文说明：变量 firstError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstError = await rejectionOf(fiber)
    expectRequiredConfigValidation(firstError)
    await ctx.plugin(TestInvariantProbe)
    /** 中文说明：变量 secondError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondError = await rejectionOf(fiber)
    expect(secondError).toBe(firstError)
    expect(fiber.state).toBe(FiberState.DISPOSED)
    expect(apply).not.toHaveBeenCalled()
  })

  it('disposes invalid config after delayed invariant readiness', async () => {
    await withDelayedFirstCompanion(
      async ({ started, release }) => {
        /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ctx = new Context()
        /** 中文说明：变量 apply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const apply = vi.fn(invalidConfigApply)
        /** 中文说明：变量 plugin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const plugin = {
          apply,
          Config: requiredConfig(),
        }

        /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const fiber = ctx.plugin(plugin, {})
        /** 中文说明：变量 returnedError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const returnedError = rejectionOf(fiber)
        await started
        expect(fiber.state).toBe(FiberState.PENDING)
        expect(apply).not.toHaveBeenCalled()

        release()
        expectRequiredConfigValidation(await returnedError)
        expect(fiber.state).toBe(FiberState.DISPOSED)
        expect(apply).not.toHaveBeenCalled()
      },
    )
  })

  it('retains a valid plugin failure after delayed invariant readiness', async () => {
    await withDelayedFirstCompanion(
      async ({ started, release }) => {
        /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ctx = new Context()
        /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const failure = new Error('valid plugin apply failed')
        /** 中文说明：变量 apply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const apply = vi.fn(function validConfigApply() {
          throw failure
        })
        /** 中文说明：变量 plugin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const plugin = {
          apply,
          Config: z.object({}),
        }

        /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const fiber = ctx.plugin(plugin, {})
        /** 中文说明：变量 returnedError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const returnedError = rejectionOf(fiber)
        await started
        expect(fiber.state).toBe(FiberState.PENDING)
        expect(apply).not.toHaveBeenCalled()

        release()
        expect(await returnedError).toBe(failure)
        expect(fiber.state).toBe(FiberState.FAILED)
        expect(apply).toHaveBeenCalledOnce()
        expect(ctx.registry.has(plugin)).toBe(true)
        expect(ctx.registry.get(plugin)?.fibers).toHaveLength(1)
      },
    )
  })

  it('holds a root plugin until every lazy companion is active, then permits nested startup', async () => {
    /** 中文说明：变量 delayedStarted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const delayedStarted = deferred()
    /** 中文说明：变量 releaseDelayed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseDelayed = deferred()
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    /** 中文说明：变量 delayedCompanion 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let delayedCompanion: TestInvariantCompanion | undefined
    /** 中文说明：变量 companionNestedApply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const companionNestedApply = vi.fn(function companionNestedApply() {})

    await withFakeCompanions(
      (path, index) => async () => {
        /** 中文说明：变量 companion 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const companion: TestInvariantCompanion = {
          name: `test-invariant-${index}`,
          inject: ['invariants'],
          async apply(companionCtx) {
            order.push(`companion-start:${path}`)
            if (index === 0) {
              delayedStarted.resolve()
              await releaseDelayed.promise
            }
            if (index === 1) await companionCtx.plugin(companionNestedApply)
            order.push(`companion-active:${path}`)
            return () => {}
          },
        }
        if (index === 0) delayedCompanion = companion
        return companion
      },
      async () => {
        /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ctx = new Context()
        ctx.provide('testInvariantTargetDependency', true)
        /** 中文说明：变量 nestedFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        let nestedFiber: ReturnType<Context['plugin']> | undefined
        /** 中文说明：变量 nestedApply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const nestedApply = vi.fn(function nestedApply() {
          order.push('nested')
        })
        /** 中文说明：变量 targetApply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const targetApply = Object.assign(vi.fn(function targetApply(targetCtx: Context) {
          order.push('target')
          nestedFiber = targetCtx.plugin(nestedApply)
        }), {
          inject: ['testInvariantTargetDependency'],
        })

        /** 中文说明：变量 targetFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const targetFiber = ctx.plugin(targetApply)
        expect(ctx.registry.get(targetApply)?.callback).toBe(targetApply)
        expect(targetFiber.inject).toEqual({
          testInvariantTargetDependency: null,
          [TEST_INVARIANT_READY_SERVICE]: null,
        })

        await delayedStarted.promise
        await Promise.resolve()
        await Promise.resolve()
        expect(targetApply).not.toHaveBeenCalled()

        releaseDelayed.resolve()
        await targetFiber
        if (nestedFiber === undefined) throw new Error('target did not register its nested plugin')
        await nestedFiber

        expect(targetFiber.state).toBe(FiberState.ACTIVE)
        expect(targetApply).toHaveBeenCalledOnce()
        expect(nestedApply).toHaveBeenCalledOnce()
        expect(companionNestedApply).toHaveBeenCalledOnce()
        /** 中文说明：变量 targetIndex 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const targetIndex = order.indexOf('target')
        expect(targetIndex).toBeGreaterThan(-1)
        expect(order.slice(0, targetIndex)).toHaveLength(Object.keys(testInvariantCompanions).length * 2)
        expect(order.at(-1)).toBe('nested')

        if (delayedCompanion === undefined) throw new Error('delayed companion did not load')
        await ctx.plugin(InvariantRegistry, { enabled: true })
        await ctx.plugin(delayedCompanion)
        expect(ctx.registry.get(InvariantRegistry)?.fibers).toHaveLength(1)
        expect(ctx.registry.get(delayedCompanion)?.fibers).toHaveLength(1)
      },
    )
  })

  it('holds plugins registered on a root-derived context until companion readiness', async () => {
    await withDelayedFirstCompanion(
      async ({ started, release }) => {
        /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ctx = new Context()
        /** 中文说明：变量 rootApply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const rootApply = vi.fn(function rootApply() {})
        /** 中文说明：变量 derivedApply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const derivedApply = vi.fn(function derivedApply() {})
        /** 中文说明：变量 derived 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const derived = ctx.extend()
          .isolate('testInvariantDerived')
          .intercept('testInvariantDerived', {})

        /** 中文说明：变量 rootFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const rootFiber = ctx.plugin(rootApply)
        /** 中文说明：变量 derivedFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const derivedFiber = derived.plugin(derivedApply)

        await started
        await Promise.resolve()
        await Promise.resolve()
        expect(rootApply).not.toHaveBeenCalled()
        expect(derivedApply).not.toHaveBeenCalled()
        expect(derivedFiber.inject).toEqual({
          [TEST_INVARIANT_READY_SERVICE]: null,
        })

        release()
        await Promise.all([rootFiber, derivedFiber])
        expect(rootFiber.state).toBe(FiberState.ACTIVE)
        expect(derivedFiber.state).toBe(FiberState.ACTIVE)
        expect(rootApply).toHaveBeenCalledOnce()
        expect(derivedApply).toHaveBeenCalledOnce()
      },
    )
  })

  it('holds a child registered externally on a pending target context', async () => {
    await withDelayedFirstCompanion(
      async ({ started, release }) => {
        /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ctx = new Context()
        /** 中文说明：变量 targetApply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const targetApply = vi.fn(function targetApply() {})
        /** 中文说明：变量 childApply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const childApply = vi.fn(function childApply() {})

        /** 中文说明：变量 targetFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const targetFiber = ctx.plugin(targetApply)
        /** 中文说明：变量 childFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const childFiber = targetFiber.ctx.plugin(childApply)

        await started
        await Promise.resolve()
        await Promise.resolve()
        expect(targetFiber.state).toBe(FiberState.PENDING)
        expect(childFiber.state).toBe(FiberState.PENDING)
        expect(targetApply).not.toHaveBeenCalled()
        expect(childApply).not.toHaveBeenCalled()
        expect(childFiber.inject).toEqual({
          [TEST_INVARIANT_READY_SERVICE]: null,
        })

        release()
        await Promise.all([targetFiber, childFiber])
        expect(targetFiber.state).toBe(FiberState.ACTIVE)
        expect(childFiber.state).toBe(FiberState.ACTIVE)
        expect(targetApply).toHaveBeenCalledOnce()
        expect(childApply).toHaveBeenCalledOnce()
      },
    )
  })

  it.each(['load', 'startup'] as const)(
    'rejects a target when a lazy companion fails during %s without starting the target',
    async (phase) => {
      /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const failure = new Error(`test invariant companion ${phase} failed`)
      await withFakeCompanions(
        (_path, index) => phase === 'load' && index === 0
          ? async () => { throw failure }
          : async () => ({
            name: `test-invariant-${index}`,
            inject: ['invariants'],
            async apply() {
              if (phase === 'startup' && index === 0) throw failure
              return () => {}
            },
          }),
        async () => {
          /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const ctx = new Context()
          /** 中文说明：变量 targetApply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const targetApply = vi.fn(function targetApply() {})
          /** 中文说明：变量 targetFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const targetFiber = ctx.plugin(targetApply)

          await expect(targetFiber).rejects.toBe(failure)
          expect(targetApply).not.toHaveBeenCalled()
          expect(targetFiber.state).toBe(FiberState.PENDING)
          await expect(targetFiber.dispose()).resolves.toBeUndefined()
          expect(targetFiber.state).toBe(FiberState.DISPOSED)
        },
      )
    },
  )

  it('disposes a pending target without waiting for companion readiness', async () => {
    await withDelayedFirstCompanion(
      async ({ started, release }) => {
        /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ctx = new Context()
        /** 中文说明：变量 targetApply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const targetApply = vi.fn(function targetApply() {})
        /** 中文说明：变量 targetFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const targetFiber = ctx.plugin(targetApply)

        await started
        await expect(targetFiber.dispose()).resolves.toBeUndefined()
        expect(targetFiber.state).toBe(FiberState.DISPOSED)
        expect(targetApply).not.toHaveBeenCalled()

        release()
        await targetFiber
        expect(targetApply).not.toHaveBeenCalled()
      },
    )
  })
})
