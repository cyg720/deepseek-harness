/**
 * 文件职责：验证 local.spec.ts 覆盖的子进程管理行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子进程管理能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { basename, dirname, relative, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { childEnv } from '../src/spawn.ts'

/** 中文说明：函数 spec 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function spec(command: string, overrides: Partial<SubprocessSpawnSpec> = {}): SubprocessSpawnSpec {
  // Windows has no bash; the suite's simple commands translate to node one-liners.
  /** 中文说明：变量 argv 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const argv = process.platform === 'win32'
    ? [process.execPath, '-e', {
      'echo managed': 'console.log("managed")',
      'sleep 60': 'setTimeout(() => {}, 60000)',
      'true': '',
    }[command] ?? command]
    : ['bash', '-c', command]
  return {
    argv,
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64_000, spill: { maxBytes: 64 * 1024 * 1024 } },
      stderr: { maxBytes: 64_000, spill: { maxBytes: 64 * 1024 * 1024 } },
    },
    graceMs: 200,
    ...overrides,
  }
}

describe('LocalSubprocessRuntime', () => {
  it('places the host-exit finalizer before listeners that predate the service', async () => {
    /** 中文说明：变量 baseline 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const baseline = new Set(process.listeners('exit'))
    /** 中文说明：变量 prior 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prior = vi.fn()
    process.on('exit', prior)
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      /** 中文说明：变量 listeners 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const listeners = process.listeners('exit')
      /** 中文说明：函数值 finalizer 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const finalizer = listeners.find(candidate => !baseline.has(candidate) && candidate !== prior)
      expect(finalizer).toBeTypeOf('function')
      expect(listeners.indexOf(finalizer!)).toBeLessThan(listeners.indexOf(prior))
    } finally {
      process.off('exit', prior)
      await fiber.dispose()
    }
  })

  it('keeps the host-exit finalizer active until normal disposal reaches quiescence', async () => {
    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = new Set(process.listeners('exit'))
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：函数值 listener 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const listener = process.listeners('exit').find(candidate => !before.has(candidate))
    expect(listener).toBeTypeOf('function')

    /** 中文说明：函数值 finishExit 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let finishExit!: () => void
    /** 中文说明：函数值 exited 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const exited = new Promise<void>((resolve) => { finishExit = resolve })
    /** 中文说明：变量 terminate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminate = vi.fn()
    /** 中文说明：变量 terminateForHostExit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminateForHostExit = vi.fn()
    /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const live = (ctx.subprocess as unknown as {
      live: Set<{
        done: Promise<{ exitCode: number; signal: null }>
        terminate(): void
        terminateForHostExit(): void
        waitForExit(): Promise<boolean>
      }>
    }).live
    live.add({
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate,
      terminateForHostExit,
      waitForExit: async () => { await exited; return true },
    })

    /** 中文说明：变量 disposed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposed = false
    /** 中文说明：函数值 disposing 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposing = fiber.dispose().then(() => { disposed = true })
    await new Promise(resolve => setImmediate(resolve))
    expect(disposed).toBe(false)
    expect(live.size).toBe(1)
    listener?.(0)
    expect(terminate).toHaveBeenCalledOnce()
    expect(terminateForHostExit).toHaveBeenCalledOnce()

    finishExit()
    await disposing
    expect(live.size).toBe(0)
    expect(process.listeners('exit')).not.toContain(listener)
  })

  it('contains each host-exit termination failure and continues with the other targets', async () => {
    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = new Set(process.listeners('exit'))
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：函数值 listener 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const listener = process.listeners('exit').find(candidate => !before.has(candidate))
    expect(listener).toBeTypeOf('function')
    /** 中文说明：函数值 ordinaryFailure 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ordinaryFailure = vi.fn(() => { throw new Error('ordinary failed') })
    /** 中文说明：变量 ordinarySuccess 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ordinarySuccess = vi.fn()
    /** 中文说明：函数值 terminalFailure 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const terminalFailure = vi.fn(() => { throw new Error('terminal failed') })
    /** 中文说明：变量 terminalSuccess 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminalSuccess = vi.fn()
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = ctx.subprocess as unknown as {
      live: Set<{ terminateForHostExit(): void }>
      terminals: Set<{ terminateForHostExit(): void }>
    }
    service.live.add({ terminateForHostExit: ordinaryFailure })
    service.live.add({ terminateForHostExit: ordinarySuccess })
    service.terminals.add({ terminateForHostExit: terminalFailure })
    service.terminals.add({ terminateForHostExit: terminalSuccess })

    expect(() => { listener?.(0) }).not.toThrow()
    expect(ordinaryFailure).toHaveBeenCalledOnce()
    expect(ordinarySuccess).toHaveBeenCalledOnce()
    expect(terminalFailure).toHaveBeenCalledOnce()
    expect(terminalSuccess).toHaveBeenCalledOnce()

    service.live.clear()
    service.terminals.clear()
    await fiber.dispose()
  })

  it('resolves absolute and PATH executables and honors lookup cancellation', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    expect(await ctx.subprocess.resolveExecutable(process.execPath)).toBe(process.execPath)
    expect(await ctx.subprocess.resolveExecutable(basename(process.execPath), {
      PATH: dirname(process.execPath),
    })).toBe(process.execPath)
    expect(await ctx.subprocess.resolveExecutable(basename(process.execPath), {
      PATH: relative(process.cwd(), dirname(process.execPath)) || '.',
    })).toBe(process.execPath)
    await expect(ctx.subprocess.resolveExecutable('')).rejects.toThrow('must be non-empty')
    await expect(ctx.subprocess.resolveExecutable('./bin/tsserver'))
      .rejects.toThrow('is a relative path')
    await expect(ctx.subprocess.resolveExecutable('node_modules/.bin/server'))
      .rejects.toThrow('is a relative path')
    await expect(ctx.subprocess.resolveExecutable('dsh-command-that-does-not-exist', { PATH: '' }))
      .rejects.toThrow('was not found on PATH')
    await expect(ctx.subprocess.resolveExecutable('/dsh-absolute-command-that-does-not-exist'))
      .rejects.toThrow('is not an executable file')
    await expect(ctx.subprocess.resolveExecutable(process.cwd()))
      .rejects.toThrow('is not an executable file')
    await expect(ctx.subprocess.resolveExecutable(process.execPath, {}, AbortSignal.abort('stop')))
      .rejects.toBe('stop')
    await fiber.dispose()
  })

  it('builds Windows executable candidates with case-insensitive overrides', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = ctx.subprocess as LocalSubprocessRuntime
    /** 中文说明：变量 candidates 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const candidates = (service as unknown as {
      executableCandidates(command: string, env: NodeJS.ProcessEnv): string[]
    }).executableCandidates.bind(service)
    /** 中文说明：变量 platform 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      expect(Object.keys(childEnv()).filter(key => key.toUpperCase() === 'PATH')).toHaveLength(1)
      /** 中文说明：变量 explicit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const explicit = childEnv({ Path: '/bin', PathExt: '.EXE;.CMD' })
      expect(Object.keys(explicit).filter(key => key.toUpperCase() === 'PATH')).toEqual(['Path'])
      expect(Object.keys(explicit).filter(key => key.toUpperCase() === 'PATHEXT')).toEqual(['PathExt'])
      expect(candidates('tool', explicit)).toEqual([resolve('/bin', 'tool.EXE'), resolve('/bin', 'tool.CMD')])
      expect(candidates('tool', { Path: '/ambient', PATH: '/explicit', PATHEXT: '.EXE' }))
        .toEqual([resolve('/explicit', 'tool.EXE')])
      expect(candidates('tool.exe', {})).toEqual([resolve(process.cwd(), 'tool.exe')])
      expect(candidates('tool', { PATH: '/bin' })).toHaveLength(4)
      await expect(ctx.subprocess.resolveExecutable(String.raw`bin\server.exe`))
        .rejects.toThrow('is a relative path')
    } finally {
      platform.mockRestore()
      await fiber.dispose()
    }
  })

  it('validates terminal allocation inputs before allocating a PTY', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const base: SubprocessTerminalSpawnSpec = {
      argv: ['bash'], cwd: process.cwd(), rows: 24, cols: 80, graceMs: 10,
    }
    await expect(ctx.subprocess.spawnTerminal({ ...base, argv: [] })).rejects.toThrow('must contain a program')
    await expect(ctx.subprocess.spawnTerminal({ ...base, argv: [''] })).rejects.toThrow('must contain a program')
    await expect(ctx.subprocess.spawnTerminal({ ...base, signal: AbortSignal.abort('stop') })).rejects.toBe('stop')
    await fiber.dispose()
  })

  it('terminates and joins an owned terminal during disposal', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：函数值 terminate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const terminate = vi.fn(async () => {})
    /** 中文说明：变量 terminal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminal: SubprocessTerminalHandle = {
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: async () => {},
      inspectForeground: async () => undefined,
      signalForeground: async () => 1,
      terminate,
    }
    /** 中文说明：变量 terminals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminals = (ctx.subprocess as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals
    terminals.add(terminal)
    await fiber.dispose()
    expect(terminate).toHaveBeenCalledOnce()
    expect(terminals.size).toBe(0)
  })

  it('waits for every terminal cleanup and aggregates teardown failures', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = ctx.subprocess
    /** 中文说明：变量 firstFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstFailure = new Error('first cleanup failure')
    /** 中文说明：变量 secondFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondFailure = new Error('second cleanup failure')
    /** 中文说明：变量 disposalErrors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposalErrors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
    /** 中文说明：变量 failedTerminal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedTerminal: SubprocessTerminalHandle = {
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: async () => {},
      inspectForeground: async () => undefined,
      signalForeground: async () => 1,
      terminate: vi.fn(async () => { throw firstFailure }),
    }
    /** 中文说明：变量 secondFailedTerminal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondFailedTerminal: SubprocessTerminalHandle = {
      ...failedTerminal,
      terminate: vi.fn(async () => { throw secondFailure }),
    }
    /** 中文说明：函数值 finishCleanup 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let finishCleanup!: () => void
    /** 中文说明：函数值 cleanup 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })
    /** 中文说明：变量 drainingTerminal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drainingTerminal: SubprocessTerminalHandle = {
      ...failedTerminal,
      terminate: vi.fn(() => cleanup),
    }
    /** 中文说明：变量 terminals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminals = (service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals
    terminals.add(failedTerminal)
    terminals.add(secondFailedTerminal)
    terminals.add(drainingTerminal)

    /** 中文说明：变量 disposed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposed = false
    /** 中文说明：函数值 disposing 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposing = fiber.dispose().then(() => { disposed = true })
    await new Promise(resolve => setImmediate(resolve))
    expect(disposed).toBe(false)
    finishCleanup()
    await disposing
    expect(terminals.size).toBe(0)
    expect(disposalErrors).toHaveLength(1)
    expect(disposalErrors[0]).toMatchObject({
      errors: [firstFailure, secondFailure],
      message: 'local subprocess teardown failed',
    })
  })

  it('reports one cleanup failure without wrapping it', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new Error('single cleanup failure')
    /** 中文说明：变量 disposalErrors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposalErrors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const service = ctx.subprocess
    /** 中文说明：变量 terminal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminal: SubprocessTerminalHandle = {
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: async () => {},
      inspectForeground: async () => undefined,
      signalForeground: async () => 1,
      terminate: vi.fn(async () => { throw failure }),
    }
    /** 中文说明：变量 terminals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminals = (service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals
    terminals.add(terminal)

    await fiber.dispose()

    expect(disposalErrors).toEqual([failure])
  })

  it('force-terminates remaining targets before releasing a failed disposal', async () => {
    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = new Set(process.listeners('exit'))
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：函数值 listener 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const listener = process.listeners('exit').find(candidate => !before.has(candidate))
    expect(listener).toBeTypeOf('function')
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new Error('cleanup failed')
    /** 中文说明：函数值 terminateForHostExit 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const terminateForHostExit = vi.fn(() => {
      expect(process.listeners('exit')).toContain(listener)
    })
    /** 中文说明：变量 terminal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminal = {
      terminate: vi.fn(async () => { throw failure }),
      terminateForHostExit,
    }
    /** 中文说明：变量 terminals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminals = (ctx.subprocess as unknown as { terminals: Set<typeof terminal> }).terminals
    terminals.add(terminal)

    await fiber.dispose()

    expect(terminateForHostExit).toHaveBeenCalledOnce()
    expect(terminals.size).toBe(0)
    expect(process.listeners('exit')).not.toContain(listener)
  })

  it('releases a terminal after top-level exit reaches quiescence', async () => {
    /** 中文说明：函数值 exitListener 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = {
      foregroundPgid: () => undefined,
      isStdinWaiting: () => false,
      snapshot: () => ({ tree: () => [], session: () => [], alive: () => false }),
      isAlive: () => false,
      signalGroup: () => {},
      signalProcess: () => {},
    }
    /** 中文说明：变量 terminal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminal = {
      pid: 123,
      onData: () => ({ dispose: () => {} }),
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        exitListener = listener
        return { dispose: () => {} }
      },
      write: () => {},
      kill: () => {},
    }
    vi.resetModules()
    vi.doMock('node-pty', () => ({ spawn: () => terminal }))
    vi.doMock('../src/process-inspector.ts', async importOriginal => ({
      ...await importOriginal<typeof import('../src/process-inspector.ts')>(),
      createProcessInspector: () => inspector,
    }))
    try {
      const { default: IsolatedLocalSubprocessRuntime } = await import('../src/index.ts')
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fiber = await ctx.plugin(IsolatedLocalSubprocessRuntime)
      /** 中文说明：变量 service 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const service = ctx.subprocess as InstanceType<typeof IsolatedLocalSubprocessRuntime>
      /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const handle = await ctx.subprocess.spawnTerminal({
        argv: ['shell'], cwd: process.cwd(), rows: 24, cols: 80, graceMs: 1,
      })
      expect((service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals.size).toBe(1)
      exitListener?.({ exitCode: 0 })
      await handle.done
      await new Promise(resolve => setImmediate(resolve))
      expect((service as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals.size).toBe(0)
      await fiber.dispose()
    } finally {
      vi.doUnmock('node-pty')
      vi.doUnmock('../src/process-inspector.ts')
      vi.resetModules()
    }
  })

  it('retains a terminal whose automatic cleanup fails', async () => {
    /** 中文说明：函数值 exitListener 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined
    /** 中文说明：变量 terminal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const terminal = {
      pid: 123,
      onData: () => ({ dispose: () => {} }),
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        exitListener = listener
        return { dispose: () => {} }
      },
      write: () => {},
      kill: () => {},
    }
    vi.resetModules()
    vi.doMock('node-pty', () => ({ spawn: () => terminal }))
    try {
      const { default: IsolatedLocalSubprocessRuntime } = await import('../src/index.ts')
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      /** 中文说明：变量 disposalErrors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const disposalErrors: unknown[] = []
      ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
      /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fiber = await ctx.plugin(IsolatedLocalSubprocessRuntime)
      /** 中文说明：变量 alive 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const alive = new Set([124])
      ;(ctx.subprocess as InstanceType<typeof IsolatedLocalSubprocessRuntime>).terminalInspector = {
        foregroundPgid: () => 123,
        isStdinWaiting: () => false,
        snapshot: () => ({
          tree: () => [{ pid: 123, started: 'shell' }, { pid: 124, started: 'child' }],
          session: () => [],
          alive: identity => alive.has(identity.pid),
        }),
        isAlive: identity => alive.has(identity.pid),
        signalGroup: () => {},
        signalProcess: () => {},
      }
      /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const handle = await ctx.subprocess.spawnTerminal({
        argv: ['shell'], cwd: process.cwd(), rows: 24, cols: 80, graceMs: 1,
      })
      exitListener?.({ exitCode: 0 })
      await handle.done
      await new Promise(resolve => setTimeout(resolve, 10))
      expect((ctx.subprocess as unknown as { terminals: Set<SubprocessTerminalHandle> }).terminals.size).toBe(1)
      await fiber.dispose()
      expect(disposalErrors).toHaveLength(1)
    } finally {
      vi.doUnmock('node-pty')
      vi.resetModules()
    }
  })

  it('registers as ctx.subprocess and spawns managed handles', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = ctx.subprocess.spawn(spec('echo managed'))
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await handle.done
    expect(result.exitCode).toBe(0)
    expect(handle.collected.stdout!.readFrom(0).text).toBe('managed\n')
    await fiber.dispose()
  })

  it('disposal kills still-running processes and awaits their exit', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = ctx.subprocess.spawn(spec('sleep 60'))
    await fiber.dispose()
    /** 中文说明：变量 outcome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcome = await handle.done
    // Windows teardown terminates through taskkill, which reports no signal.
    expect(outcome.signal).toBe(process.platform === 'win32' ? null : 'SIGTERM')
  })

  it('a settled process leaves the live set (disposal does not re-kill it)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = ctx.subprocess.spawn(spec('true'))
    /** 中文说明：变量 outcome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcome = await handle.done
    expect(outcome.exitCode).toBe(0)
    await fiber.dispose()
  })

  it('disposal tolerates a handle whose spawn already failed', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = ctx.subprocess.spawn(spec('true', { cwd: '/nonexistent-dir-dsh-subprocess-test' }))
    await expect(handle.done).rejects.toThrow()
    await fiber.dispose()
  })

  it('disposal contains a spawn-failure rejection that races teardown', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    // Dispose before the rejection continuation removes the handle from the
    // live set, so teardown itself must swallow the rejected done.
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = ctx.subprocess.spawn(spec('true', { cwd: '/nonexistent-dir-dsh-subprocess-test' }))
    await fiber.dispose()
    await expect(handle.done).rejects.toThrow()
  })

  it('loading a second implementation throws (one processes service per context — cordis standard)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    /** 中文说明：class SecondManager 定义本测试所需的数据或行为，用于表达子进程管理场景。 */
    class SecondManager extends LocalSubprocessRuntime {}
    await expect(ctx.plugin(SecondManager)).rejects.toThrow(/service "subprocess" has been registered/)
  })
})
