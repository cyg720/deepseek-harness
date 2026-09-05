/**
 * 文件职责：验证E2B 远程沙箱的 e2b.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证E2B 远程沙箱在真实组装、失败和清理场景中可靠。
 * 逻辑维度：构造服务或远程替身，驱动操作并断言结果。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Sandbox as SandboxType } from 'e2b'
import E2BRuntime, {
  e2bControlEnvs,
  FileType,
  SandboxNotFoundError,
  quoteE2BShellArg,
} from '@deepseek-ai/dsh-e2b'

/** 中文说明：测试局部值 sdk，由紧邻初始化决定。 */
const sdk = vi.hoisted(() => ({
  create: vi.fn(),
}))

vi.mock('e2b', async (importOriginal) => {
  /** 中文说明：测试局部值 actual，由紧邻初始化决定。 */
  const actual = await importOriginal<typeof import('e2b')>()
  // The mock replaces only the SDK's static factory surface and is never constructed.
  /** 中文说明：类型或类 FakeSandbox 约束远程资源或测试数据职责。 */
  // oxlint-disable-next-line typescript/no-extraneous-class -- The SDK contract is a class with a static factory.
  class FakeSandbox {
    static create(...args: unknown[]): unknown {
      return sdk.create(...args)
    }
  }
  return { ...actual, Sandbox: FakeSandbox }
})

/** 中文说明：类型或类 SandboxFixture 约束远程资源或测试数据职责。 */
interface SandboxFixture {
  sandbox: SandboxType
  makeDir: ReturnType<typeof vi.fn>
  getInfo: ReturnType<typeof vi.fn>
  run: Mock<RunCommand>
  kill: ReturnType<typeof vi.fn>
}

/** 中文说明：类型或类 RunCommand 约束远程资源或测试数据职责。 */
type RunCommand = (
  command: string,
  options?: { envs?: Record<string, string> },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

/** 中文说明：函数 fakeSandbox 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function fakeSandbox(id = 'sandbox-1'): SandboxFixture {
  /** 中文说明：测试局部值 makeDir，由紧邻初始化决定。 */
  const makeDir = vi.fn().mockResolvedValue(true)
  /** 中文说明：测试局部值 getInfo，由紧邻初始化决定。 */
  const getInfo = vi.fn().mockResolvedValue({ type: FileType.DIR })
  /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
  const run = vi.fn<RunCommand>().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
  /** 中文说明：测试局部值 kill，由紧邻初始化决定。 */
  const kill = vi.fn().mockResolvedValue(undefined)
  /** 中文说明：测试局部值 sandbox，由紧邻初始化决定。 */
  const sandbox = {
    sandboxId: id,
    files: { makeDir, getInfo },
    commands: { run },
    kill,
  } as unknown as SandboxType
  return { sandbox, makeDir, getInfo, run, kill }
}

beforeEach(() => {
  sdk.create.mockReset()
  vi.unstubAllEnvs()
})

describe('E2BRuntime', () => {
  it('gives each SDK login shell a fresh non-overridable control home', () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = e2bControlEnvs({ HOME: '/hostile', NPM_TOKEN: '' })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = e2bControlEnvs()

    expect(first.HOME).toMatch(/^\/\.dsh-e2b-control-/)
    expect(first).toEqual({ HOME: first.HOME, NPM_TOKEN: '' })
    expect(first.HOME).not.toBe(second.HOME)
  })

  it('creates one protected shared sandbox and kills it on default disposal', async () => {
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = fakeSandbox()
    sdk.create.mockResolvedValue(fixture.sandbox)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })

    /** 中文说明：测试局部值 service，由紧邻初始化决定。 */
    const service = ctx.e2b
    await expect(service.getSandbox()).resolves.toBe(fixture.sandbox)
    expect(service.cwd).toBe('/home/user/workspace')
    expect(service.runtimeRoot).toBe('/home/user/workspace/.dsh-e2b')
    expect(sdk.create).toHaveBeenCalledWith({
      apiKey: 'test-key',
      timeoutMs: 300_000,
      secure: true,
      lifecycle: { onTimeout: 'kill' },
    })
    expect(fixture.makeDir).toHaveBeenNthCalledWith(1, '/home/user/workspace')
    expect(fixture.makeDir).toHaveBeenNthCalledWith(2, '/home/user/workspace/.dsh-e2b')
    expect(fixture.getInfo).toHaveBeenCalledWith('/home/user/workspace/.dsh-e2b')
    /** 中文说明：测试局部值 runOptions，由紧邻初始化决定。 */
    const runOptions = fixture.run.mock.calls[0]?.[1]
    expect(runOptions?.envs?.HOME).toMatch(/^\/\.dsh-e2b-control-/)
    expect(fixture.run).toHaveBeenCalledWith(
      "chmod 700 -- '/home/user/workspace/.dsh-e2b'",
      { envs: { HOME: runOptions?.envs?.HOME } },
    )

    await fiber.dispose()
    expect(fixture.kill).toHaveBeenCalledOnce()
    await expect(service.getSandbox()).rejects.toThrow(/disposing/)
  })

  it('rejects handle acquisition when disposal starts during setup', async () => {
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = fakeSandbox()
    /** 中文说明：测试局部值 opening，由紧邻初始化决定。 */
    const opening = Promise.withResolvers<SandboxType>()
    sdk.create.mockReturnValue(opening.promise)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })

    /** 中文说明：测试局部值 acquisition，由紧邻初始化决定。 */
    const acquisition = ctx.e2b.getSandbox()
    /** 中文说明：测试局部值 disposing，由紧邻初始化决定。 */
    const disposing = fiber.dispose()
    opening.resolve(fixture.sandbox)

    await expect(acquisition).rejects.toThrow(/disposing/)
    await expect(disposing).resolves.toBeUndefined()
    expect(fixture.kill).toHaveBeenCalledOnce()
  })

  it('reads the key from the environment and honors the configured cwd and lifetime', async () => {
    vi.stubEnv('E2B_API_KEY', 'environment-key')
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = fakeSandbox('configured-sandbox')
    sdk.create.mockResolvedValue(fixture.sandbox)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(E2BRuntime, {
      cwd: '/workspace/project',
      timeoutMs: 60_000,
    })
    await ctx.e2b.getSandbox()

    expect(sdk.create).toHaveBeenCalledWith({
      apiKey: 'environment-key',
      timeoutMs: 60_000,
      secure: true,
      lifecycle: { onTimeout: 'kill' },
    })
    expect(ctx.e2b.cwd).toBe('/workspace/project')
    await fiber.dispose()
    expect(fixture.kill).toHaveBeenCalledOnce()
  })

  it('accepts a missing sandbox when disposal itself requests deletion', async () => {
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = fakeSandbox()
    fixture.kill.mockRejectedValue(new SandboxNotFoundError('already deleted'))
    sdk.create.mockResolvedValue(fixture.sandbox)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 errors，由紧邻初始化决定。 */
    const errors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { errors.push(error) }) as typeof ctx.logger.error
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })
    await ctx.e2b.getSandbox()

    await fiber.dispose()
    expect(fixture.kill).toHaveBeenCalledOnce()
    expect(errors).toEqual([])
  })

  it('does not classify other disposal failures as an already-gone sandbox', async () => {
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = fakeSandbox()
    /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
    const failure = new Error('disposition unknown')
    fixture.kill.mockRejectedValue(failure)
    sdk.create.mockResolvedValue(fixture.sandbox)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 errors，由紧邻初始化决定。 */
    const errors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { errors.push(error) }) as typeof ctx.logger.error
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })
    await ctx.e2b.getSandbox()
    await expect(fiber.dispose()).resolves.toBeUndefined()
    expect(fixture.kill).toHaveBeenCalledOnce()
    expect(errors).toContain(failure)
  })

  it('kills a newly created sandbox when remote directory setup fails', async () => {
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = fakeSandbox()
    fixture.makeDir.mockRejectedValueOnce(new Error('setup failed'))
    sdk.create.mockResolvedValue(fixture.sandbox)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })

    await expect(ctx.e2b.getSandbox()).rejects.toThrow('setup failed')
    expect(fixture.kill).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it('preserves the setup failure after its one rollback attempt fails', async () => {
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = fakeSandbox()
    fixture.run.mockRejectedValueOnce(new Error('chmod failed'))
    fixture.kill.mockRejectedValueOnce(new Error('cleanup failed'))
    sdk.create.mockResolvedValue(fixture.sandbox)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })
    await expect(ctx.e2b.getSandbox()).rejects.toThrow('chmod failed')
    expect(fixture.kill).toHaveBeenCalledOnce()

    await fiber.dispose()
    expect(fixture.kill).toHaveBeenCalledOnce()
  })

  it.each([
    ['symbolic link', { type: FileType.DIR, symlinkTarget: '/tmp/redirected' }],
    ['regular file', { type: FileType.FILE }],
  ])('rejects a reserved runtime root that is a %s', async (_label, info) => {
    /** 中文说明：测试局部值 fixture，由紧邻初始化决定。 */
    const fixture = fakeSandbox()
    fixture.getInfo.mockResolvedValueOnce(info)
    sdk.create.mockResolvedValue(fixture.sandbox)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })

    await expect(ctx.e2b.getSandbox()).rejects.toThrow('runtime root must be a real directory')
    expect(fixture.run).not.toHaveBeenCalled()
    expect(fixture.kill).toHaveBeenCalledOnce()
  })

  it.each([
    [{ apiKey: '' }, /configure apiKey/],
    [{ apiKey: 'x', cwd: 'relative' }, /absolute Linux path/],
    [{ apiKey: 'x', timeoutMs: 0 }, /positive finite/],
  ] as const)('fails self-contained configuration before opening E2B: %j', async (config, message) => {
    vi.stubEnv('E2B_API_KEY', '')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await expect(ctx.plugin(E2BRuntime, config)).rejects.toThrow(message)
    expect(sdk.create).not.toHaveBeenCalled()
  })

  it('requires a key when both config and the environment omit it', async () => {
    /** 中文说明：测试局部值 original，由紧邻初始化决定。 */
    const original = process.env.E2B_API_KEY
    delete process.env.E2B_API_KEY
    try {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = new Context()
      await expect(ctx.plugin(E2BRuntime, {})).rejects.toThrow(/configure apiKey/)
    } finally {
      if (original === undefined) delete process.env.E2B_API_KEY
      else process.env.E2B_API_KEY = original
    }
  })
})

describe('E2B helpers', () => {
  it('quotes opaque shell arguments without interpolation', () => {
    expect(quoteE2BShellArg("a'b $HOME")).toBe("'a'\"'\"'b $HOME'")
  })
})
