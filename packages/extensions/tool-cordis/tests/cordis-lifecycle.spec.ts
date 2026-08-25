/**
 * 文件职责：验证Cordis 工具生命周期的 cordis-lifecycle.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证Cordis 工具生命周期在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
import { Context, CordisError, FiberState, type Fiber } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

/**
 * Direct regressions for the vendored Cordis ownership substrate used by
 * tool-cordis's dynamic plugin tree and every other harness plugin.
 */

describe('Cordis effect ownership', () => {
  it('makes an effect visible to a reentrant owner restart and awaits setup plus cleanup', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 setupGate，由紧邻初始化决定。 */
    const setupGate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 cleanupGate，由紧邻初始化决定。 */
    const cleanupGate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 cleanupStarted，由紧邻初始化决定。 */
    const cleanupStarted = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 restarted!: Promise<void>，由紧邻初始化决定。 */
    let restarted!: Promise<void>
    /** 中文说明：测试局部值 setupFinished，由紧邻初始化决定。 */
    let setupFinished = false
    /** 中文说明：测试局部值 cleanupFinished，由紧邻初始化决定。 */
    let cleanupFinished = false

    ctx.effect(async () => {
      restarted = ctx.fiber.restart()
      await setupGate.promise
      setupFinished = true
      return async () => {
        cleanupStarted.resolve(undefined)
        await cleanupGate.promise
        cleanupFinished = true
      }
    }, 'reentrant-restart')

    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    let settled = false
    void restarted.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    setupGate.resolve(undefined)
    await cleanupStarted.promise
    expect(setupFinished).toBe(true)
    await Promise.resolve()
    expect(settled).toBe(false)

    cleanupGate.resolve(undefined)
    await restarted
    expect(cleanupFinished).toBe(true)
    expect(ctx.fiber.getEffects()).toEqual([])
  })

  it('rolls back collected cleanup and its owner-list entry when setup throws synchronously', () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 cleanups，由紧邻初始化决定。 */
    let cleanups = 0

    expect(() => ctx.effect(function* () {
      yield () => { cleanups += 1 }
      throw new Error('setup failed')
    }, 'throwing-setup')).toThrow('setup failed')

    expect(cleanups).toBe(1)
    expect(ctx.fiber.getEffects()).toEqual([])
  })

  it('makes a reentrant owner restart await asynchronous rollback after synchronous setup failure', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 cleanupGate，由紧邻初始化决定。 */
    const cleanupGate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 cleanupStarted，由紧邻初始化决定。 */
    const cleanupStarted = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 restarted!: Promise<void>，由紧邻初始化决定。 */
    let restarted!: Promise<void>

    expect(() => ctx.effect(function* () {
      yield async () => {
        cleanupStarted.resolve(undefined)
        await cleanupGate.promise
      }
      restarted = ctx.fiber.restart()
      throw new Error('setup failed after restart')
    }, 'reentrant-throw')).toThrow('setup failed after restart')

    await cleanupStarted.promise
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    let settled = false
    void restarted.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    cleanupGate.resolve(undefined)
    await restarted
    expect(ctx.fiber.getEffects()).toEqual([])
  })

  it('keeps ordinary teardown synchronous and the public disposer single-shot', () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 cleanups，由紧邻初始化决定。 */
    let cleanups = 0
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = ctx.effect(() => () => { cleanups += 1 }, 'sync-effect')

    expect(dispose()).toBeUndefined()
    expect(cleanups).toBe(1)
    expect(dispose()).toBeUndefined()
    expect(cleanups).toBe(1)
    expect(ctx.fiber.getEffects()).toEqual([])
  })

  it('rejects cleanup-time registration while a restart is unloading', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let registrationError: unknown

    ctx.effect(() => () => {
      try {
        ctx.effect(() => () => {}, 'too-late')
      } catch (error) {
        registrationError = error
      }
    }, 'restart-cleanup')

    await ctx.fiber.restart()
    expect(registrationError).toBeInstanceOf(CordisError)
    expect((registrationError as CordisError).code).toBe('INACTIVE_EFFECT')
    expect(ctx.fiber.state).toBe(FiberState.ACTIVE)
    expect(ctx.fiber.getEffects()).toEqual([])
  })

  it('keeps effect registration legal while child fibers are PENDING and LOADING', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 pendingCleanup，由紧邻初始化决定。 */
    let pendingCleanup = false
    /** 中文说明：测试局部值 loadingCleanup，由紧邻初始化决定。 */
    let loadingCleanup = false

    ctx.on('internal/plugin', (fiber) => {
      if (fiber.name !== 'state-probe' || fiber.uid === null) return
      expect(fiber.state).toBe(FiberState.PENDING)
      fiber.ctx.effect(() => () => { pendingCleanup = true }, 'pending-effect')
    })

    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin({
      name: 'state-probe',
      apply(inner) {
        expect(inner.fiber.state).toBe(FiberState.LOADING)
        inner.effect(() => () => { loadingCleanup = true }, 'loading-effect')
      },
    })
    await fiber.dispose()

    expect(pendingCleanup).toBe(true)
    expect(loadingCleanup).toBe(true)
  })

  it('resolves dependencies that internal/plugin adds before child activation', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    ctx.provide('late-inject', {})
    /** 中文说明：测试局部值 applyCalls，由紧邻初始化决定。 */
    let applyCalls = 0

    ctx.on('internal/plugin', (fiber) => {
      if (fiber.name !== 'loader-shaped' || fiber.uid === null) return
      fiber.inject['late-inject'] = {}
    })

    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin({
      name: 'loader-shaped',
      apply() {
        applyCalls += 1
      },
    })

    expect(applyCalls).toBe(1)
    expect(fiber.state).toBe(FiberState.ACTIVE)
  })
})

describe('Cordis child publication ownership', () => {
  it('rolls back parent and runtime ownership when internal/plugin publication throws', () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 plugin，由紧邻初始化决定。 */
    const plugin = { name: 'publication-failure', apply() {} }
    ctx.on('internal/plugin', (fiber) => {
      if (fiber.name === plugin.name) throw new Error('publication failed')
    })

    expect(() => ctx.plugin(plugin)).toThrow('publication failed')
    expect(ctx.registry.has(plugin)).toBe(false)
  })

  it('contains teardown notification failures so ownership cleanup and peers complete', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 errors，由紧邻初始化决定。 */
    const errors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { errors.push(error) }) as typeof ctx.logger.error
    /** 中文说明：测试局部值 observed，由紧邻初始化决定。 */
    const observed: string[] = []
    ctx.on('internal/plugin', (fiber) => {
      if (fiber.name === 'contained-teardown' && fiber.uid === null) {
        throw new Error('broken teardown observer')
      }
    })
    ctx.on('internal/plugin', (fiber) => {
      if (fiber.name === 'contained-teardown' && fiber.uid === null) observed.push('disposed')
    })
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = await ctx.plugin({ name: 'contained-teardown', apply() {} })

    await expect(child.dispose()).resolves.toBeUndefined()
    expect(observed).toEqual(['disposed'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual(expect.objectContaining({ message: 'broken teardown observer' }))
    expect(child.uid).toBeNull()
  })

  it('makes a LOADING parent join child cleanup started before its unload snapshot', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 cleanupGate，由紧邻初始化决定。 */
    const cleanupGate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 cleanupStarted，由紧邻初始化决定。 */
    const cleanupStarted = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 ownerFiber!: Fiber，由紧邻初始化决定。 */
    let ownerFiber!: Fiber
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let ownerDisposal!: Promise<void>
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let childDisposal!: Promise<void>
    /** 中文说明：测试局部值 childFiber!: Fiber，由紧邻初始化决定。 */
    let childFiber!: Fiber

    ctx.on('internal/plugin', (fiber) => {
      if (fiber.name !== 'loading-child' || fiber.uid === null) return
      childFiber = fiber
      fiber.ctx.effect(() => async () => {
        cleanupStarted.resolve(undefined)
        await cleanupGate.promise
      }, 'loading-child-cleanup')
      ownerDisposal = ownerFiber.dispose()
      childDisposal = Promise.resolve(fiber.dispose())
    })

    /** 中文说明：测试局部值 ownerMount，由紧邻初始化决定。 */
    const ownerMount = ctx.plugin({
      name: 'loading-owner',
      apply(inner) {
        ownerFiber = inner.fiber
        inner.plugin({ name: 'loading-child', apply() {} })
      },
    })

    await cleanupStarted.promise
    /** 中文说明：测试局部值 ownerSettled，由紧邻初始化决定。 */
    let ownerSettled = false
    void ownerDisposal.then(() => { ownerSettled = true })
    await Promise.resolve()
    expect(ownerSettled).toBe(false)

    cleanupGate.resolve(undefined)
    await Promise.all([ownerDisposal, childDisposal, ownerMount])
    expect(childFiber.uid).toBeNull()
    expect(ownerFiber.uid).toBeNull()
  })

  it('lets parent disposal during internal/plugin await the unpublished child to quiescence', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 ownerCtx!: Context，由紧邻初始化决定。 */
    let ownerCtx!: Context
    /** 中文说明：测试局部值 owner，由紧邻初始化决定。 */
    const owner = await ctx.plugin({
      name: 'owner',
      apply(inner) {
        ownerCtx = inner
      },
    })

    /** 中文说明：测试局部值 cleanupGate，由紧邻初始化决定。 */
    const cleanupGate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 cleanupStarted，由紧邻初始化决定。 */
    const cleanupStarted = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 cleanupFinished，由紧邻初始化决定。 */
    let cleanupFinished = false
    /** 中文说明：测试局部值 childApplyCalls，由紧邻初始化决定。 */
    let childApplyCalls = 0
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let parentDisposal!: Promise<void>

    ctx.on('internal/plugin', (fiber) => {
      if (fiber.name !== 'child' || fiber.uid === null) return
      expect(fiber.state).toBe(FiberState.PENDING)
      fiber.ctx.effect(() => async () => {
        cleanupStarted.resolve(undefined)
        await cleanupGate.promise
        cleanupFinished = true
      }, 'pending-child-cleanup')
    })
    ctx.on('internal/plugin', (fiber) => {
      if (fiber.name !== 'child' || fiber.uid === null) return
      parentDisposal = owner.dispose()
    })

    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = ownerCtx.plugin({
      name: 'child',
      apply() {
        childApplyCalls += 1
      },
    })

    await cleanupStarted.promise
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    let settled = false
    void parentDisposal.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    cleanupGate.resolve(undefined)
    await parentDisposal
    expect(cleanupFinished).toBe(true)
    expect(childApplyCalls).toBe(0)
    expect(child.uid).toBeNull()
    expect(child.state).toBe(FiberState.DISPOSED)
  })
})
