/**
 * 文件职责：验证 service.spec.ts 覆盖的运行时不变量诊断行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障运行时不变量诊断在真实使用路径中稳定且可诊断。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、错误和清理。
 * 关键边界：平台能力可能不同；安全失败必须显式；异步资源必须等待完全停止。
 * 新手阅读建议：先读辅助函数，再看正常路径，最后阅读平台差异与失败用例。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import InvariantRegistry, {
  InvariantError,
  /** 中文说明：type Config 定义本测试所需的数据或行为，用于表达运行时不变量诊断场景。 */
  type Config,
} from '@deepseek-ai/dsh-invariants'

declare module '@deepseek-ai/cordis' {
  /** 中文说明：interface Context 定义本测试所需的数据或行为，用于表达运行时不变量诊断场景。 */
  interface Context {
    invariantProbe: InvariantProbeService
  }

  /** 中文说明：interface Events 定义本测试所需的数据或行为，用于表达运行时不变量诊断场景。 */
  interface Events {
    'invariants-test/ping'(): void
  }
}

/** 中文说明：class InvariantProbeService 定义本测试所需的数据或行为，用于表达运行时不变量诊断场景。 */
class InvariantProbeService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'invariantProbe')
  }
}

/** 中文说明：interface RuntimeRegistration 定义本测试所需的数据或行为，用于表达运行时不变量诊断场景。 */
interface RuntimeRegistration extends PromiseLike<() => void> {
  (): void | Promise<void>
}

/** 中文说明：interface InstalledRegistration 定义本测试所需的数据或行为，用于表达运行时不变量诊断场景。 */
interface InstalledRegistration {
  dispose(): Promise<void>
}

/** 中文说明：函数 runtimeRegistration 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function runtimeRegistration(registration: () => void): RuntimeRegistration {
  return registration as RuntimeRegistration
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(config: Config = {}): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>> }> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(InvariantRegistry, config)
  return { ctx, fiber }
}

/** 中文说明：函数 registerProbe 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function registerProbe(
  ctx: Context,
  packageName: string,
  probe: () => void,
): Promise<InstalledRegistration> {
  /** 中文说明：函数值 registration 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const registration = runtimeRegistration(ctx.invariants.register(packageName, (child) => {
    child.on('invariants-test/ping', probe, { global: true })
  }))
  await registration
  return {
    async dispose() { await registration() },
  }
}

describe('InvariantRegistry selection', () => {
  it('applies defaults when constructed directly without schema normalization', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = new InvariantRegistry(ctx)
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = vi.fn()
    /** 中文说明：函数值 registration 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const registration = runtimeRegistration(service.register('@deepseek-ai/dsh-session', (child) => {
      child.on('invariants-test/ping', probe, { global: true })
    }))
    await registration
    ctx.emit('invariants-test/ping')
    expect(probe).toHaveBeenCalledOnce()
    await registration()
  })

  it('enables registrations by default and treats empty lists as admit-all and exclude-none', async () => {
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const config of [{}, { package_allowlist: [], package_blocklist: [] }]) {
      const { ctx } = await setup(config)
      /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const probe = vi.fn()
      await registerProbe(ctx, '@deepseek-ai/dsh-session', probe)
      ctx.emit('invariants-test/ping')
      expect(probe).toHaveBeenCalledOnce()
    }
  })

  it('disables every installer while still reserving package ownership', async () => {
    const { ctx } = await setup({ enabled: false })
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = vi.fn()
    /** 中文说明：变量 registration 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registration = await registerProbe(ctx, '@deepseek-ai/dsh-session', probe)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-session', () => {}))
      .toThrow(/already registered/)
    ctx.emit('invariants-test/ping')
    expect(probe).not.toHaveBeenCalled()
    await registration.dispose()
  })

  it('uses unanchored, case-sensitive JavaScript regex sources', async () => {
    /** 中文说明：变量 unanchored 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unanchored = await setup({ package_allowlist: ['session'] })
    /** 中文说明：变量 unanchoredProbe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unanchoredProbe = vi.fn()
    await registerProbe(unanchored.ctx, '@deepseek-ai/dsh-session-extra', unanchoredProbe)
    unanchored.ctx.emit('invariants-test/ping')
    expect(unanchoredProbe).toHaveBeenCalledOnce()

    /** 中文说明：变量 anchored 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const anchored = await setup({ package_allowlist: ['^@deepseek-ai/dsh-session$'] })
    /** 中文说明：变量 anchoredProbe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const anchoredProbe = vi.fn()
    await registerProbe(anchored.ctx, '@deepseek-ai/dsh-session-extra', anchoredProbe)
    anchored.ctx.emit('invariants-test/ping')
    expect(anchoredProbe).not.toHaveBeenCalled()

    /** 中文说明：变量 caseSensitive 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const caseSensitive = await setup({ package_allowlist: ['Session'] })
    /** 中文说明：变量 caseProbe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const caseProbe = vi.fn()
    await registerProbe(caseSensitive.ctx, '@deepseek-ai/dsh-session', caseProbe)
    caseSensitive.ctx.emit('invariants-test/ping')
    expect(caseProbe).not.toHaveBeenCalled()
  })

  it('lets the blocklist override an allowlist match', async () => {
    const { ctx } = await setup({
      package_allowlist: ['^@deepseek-ai/dsh-'],
      package_blocklist: ['session'],
    })
    /** 中文说明：变量 sessionProbe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sessionProbe = vi.fn()
    /** 中文说明：变量 agentProbe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agentProbe = vi.fn()
    await registerProbe(ctx, '@deepseek-ai/dsh-session', sessionProbe)
    await registerProbe(ctx, '@deepseek-ai/dsh-agent', agentProbe)
    ctx.emit('invariants-test/ping')
    expect(sessionProbe).not.toHaveBeenCalled()
    expect(agentProbe).toHaveBeenCalledOnce()
  })

  it('accepts zero-match patterns for packages registered later', async () => {
    const { ctx } = await setup({ package_allowlist: ['^@later/invariants$'] })
    /** 中文说明：变量 now 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const now = vi.fn()
    /** 中文说明：变量 later 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const later = vi.fn()
    await registerProbe(ctx, '@deepseek-ai/dsh-session', now)
    await registerProbe(ctx, '@later/invariants', later)
    ctx.emit('invariants-test/ping')
    expect(now).not.toHaveBeenCalled()
    expect(later).toHaveBeenCalledOnce()
  })

  it('allows the same source in both lists and applies blocklist precedence', async () => {
    const { ctx } = await setup({ package_allowlist: ['agent'], package_blocklist: ['agent'] })
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = vi.fn()
    await registerProbe(ctx, '@deepseek-ai/dsh-agent', probe)
    ctx.emit('invariants-test/ping')
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('InvariantRegistry validation', () => {
  it.each([
    [{ package_allowlist: [''] }, /non-blank/],
    [{ package_allowlist: [' '] }, /non-blank/],
    [{ package_allowlist: [' session'] }, /surrounding whitespace/],
    [{ package_blocklist: ['session '] }, /surrounding whitespace/],
    [{ package_allowlist: ['session', 'session'] }, /duplicate regex/],
    [{ package_blocklist: ['agent', 'agent'] }, /duplicate regex/],
    [{ package_allowlist: ['['] }, /invalid regex/],
    [{ package_blocklist: ['('] }, /invalid regex/],
  ])('rejects malformed filter config %#', async (config, message) => {
    await expect((async () => {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(InvariantRegistry, config)
    })()).rejects.toThrow(message)
  })

  it.each(['', ' ', ' package', 'pack age', 'package\n'])('rejects malformed package name %j', async (packageName) => {
    const { ctx } = await setup()
    expect(() => ctx.invariants.register(packageName, () => {})).toThrow(/packageName/)
  })
})

describe('InvariantRegistry lifecycle', () => {
  it('honors the installer dependency API in its child fiber', async () => {
    const { ctx } = await setup()
    await ctx.plugin(InvariantProbeService)
    /** 中文说明：变量 registration 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let registration!: RuntimeRegistration
    await ctx.plugin({
      inject: ['invariants', 'invariantProbe'],
      apply(child: Context) {
        /** 中文说明：函数值 installer 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const installer = Object.assign((installerCtx: Context) => {
          expect(Object.keys(installerCtx.fiber.inject)).toContain('invariantProbe')
          expect(Object.keys(installerCtx.fiber.store ?? {})).toContain('invariantProbe')
          expect(installerCtx.invariantProbe).toBeInstanceOf(InvariantProbeService)
        }, { inject: ['invariantProbe'] })
        expect(installer.inject).toEqual(['invariantProbe'])
        registration = runtimeRegistration(child.invariants.register('@deepseek-ai/dsh-probe', installer))
        return Promise.resolve(registration)
      },
    })
    await registration
  })

  it('attributes failures to the registering package with the stable code', async () => {
    const { ctx } = await setup()
    /** 中文说明：函数值 registration 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const registration = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-session', (child, fail) => {
      child.on('invariants-test/ping', () => fail('seq must strictly increase'), { global: true })
    }))
    await registration
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      ctx.emit('invariants-test/ping')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InvariantError)
    expect(caught).toMatchObject({
      name: 'InvariantError',
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-session',
      message: 'invariant violated by "@deepseek-ai/dsh-session": seq must strictly increase',
    })
  })

  it('disposes the child fiber completely and permits HMR re-registration', async () => {
    const { ctx } = await setup()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = vi.fn()
    /** 中文说明：变量 firstRegistration 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstRegistration = await registerProbe(ctx, '@deepseek-ai/dsh-session', first)
    ctx.emit('invariants-test/ping')
    await firstRegistration.dispose()
    ctx.emit('invariants-test/ping')
    expect(first).toHaveBeenCalledOnce()

    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = vi.fn()
    await registerProbe(ctx, '@deepseek-ai/dsh-session', second)
    ctx.emit('invariants-test/ping')
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('reserves ownership until asynchronous child disposal completes', async () => {
    const { ctx } = await setup()
    /** 中文说明：函数值 finishDisposal 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let finishDisposal!: () => void
    /** 中文说明：函数值 disposalBarrier 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposalBarrier = new Promise<void>((resolve) => { finishDisposal = resolve })
    /** 中文说明：函数值 registration 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const registration = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-session', (child) => {
      child.effect(() => async () => { await disposalBarrier })
    }))
    await registration

    /** 中文说明：变量 disposing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposing = registration()
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-session', () => {}))
      .toThrow(/already registered/)
    finishDisposal()
    await disposing

    /** 中文说明：函数值 replacement 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const replacement = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-session', () => {}))
    await replacement
    await replacement()
  })

  it('rolls back listeners and ownership atomically when an installer fails', async () => {
    const { ctx } = await setup()
    /** 中文说明：变量 leaked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const leaked = vi.fn()
    /** 中文说明：函数值 failed 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const failed = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-session', (child) => {
      child.on('invariants-test/ping', leaked, { global: true })
      throw new Error('installer failed')
    }))
    await expect(Promise.resolve(failed)).rejects.toThrow('installer failed')
    ctx.emit('invariants-test/ping')
    expect(leaked).not.toHaveBeenCalled()

    /** 中文说明：变量 retry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const retry = vi.fn()
    await registerProbe(ctx, '@deepseek-ai/dsh-session', retry)
    ctx.emit('invariants-test/ping')
    expect(retry).toHaveBeenCalledOnce()
  })

  it('rolls back publication effects and ownership when child-fiber publication fails', async () => {
    const { ctx } = await setup()
    /** 中文说明：变量 leaked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const leaked = vi.fn()
    /** 中文说明：变量 rejectPublication 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let rejectPublication = true
    /** 中文说明：函数值 stopRejecting 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const stopRejecting = ctx.on('internal/plugin', (fiber) => {
      if (!rejectPublication || fiber.uid === null) return
      rejectPublication = false
      fiber.ctx.on('invariants-test/ping', leaked, { global: true })
      throw new Error('publication failed')
    })

    /** 中文说明：函数值 failed 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const failed = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-publication-probe', () => {}))
    await expect(Promise.resolve(failed)).rejects.toThrow('publication failed')
    ctx.emit('invariants-test/ping')
    expect(leaked).not.toHaveBeenCalled()
    stopRejecting()

    /** 中文说明：函数值 retry 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const retry = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-publication-probe', () => {}))
    await retry
    await retry()
  })

  it('joins asynchronous checks and rolls back their effects on failure', async () => {
    const { ctx } = await setup()
    /** 中文说明：变量 leaked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const leaked = vi.fn()
    /** 中文说明：函数值 failed 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const failed = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-async-probe', async (child, fail) => {
      child.on('invariants-test/ping', leaked, { global: true })
      await Promise.resolve()
      fail('asynchronous check failed')
    }))
    await expect(Promise.resolve(failed)).rejects.toThrow(/asynchronous check failed/)
    ctx.emit('invariants-test/ping')
    expect(leaked).not.toHaveBeenCalled()

    /** 中文说明：函数值 retry 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const retry = runtimeRegistration(ctx.invariants.register('@deepseek-ai/dsh-async-probe', async () => {
      await Promise.resolve()
    }))
    await retry
    await retry()
  })

  it('releases a synchronous reservation if the service fiber is already inactive', async () => {
    const { ctx, fiber } = await setup()
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = ctx.invariants
    await fiber.dispose()
    expect(() => service.register('@deepseek-ai/dsh-session', () => {})).toThrow(/inactive/i)
  })
})
