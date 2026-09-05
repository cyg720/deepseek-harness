/**
 * The launcher-to-app command line over a REAL Loader tree, mounted the way a
 * profile boot mounts it: Loader holds each row until its injections are
 * active, then resolves that row's config against its injection-ready context.
 */
/*
 * 文件职责：验证启动器内部命令行通过真实Loader树到达应用action，并影响后续条目配置解析。
 * 技术维度：使用Vitest、Commander、临时ESM插件、Cordis Loader/Include和!!js表达式执行集成测试。
 * 产品维度：确保应用参数覆盖配置值，帮助和错误触发受控退出，且依赖服务未就绪时条目保持等待。
 * 逻辑维度：定义示例命令与解析器，bootFixture生成两行插件组合，再覆盖成功、错误、帮助和服务顺序。
 * 关键边界：全局测试桥接变量和输出流在每次测试后恢复；临时插件只委托已导入的真实解析函数。
 * 新手阅读建议：先看demoCommand与resolveDemo，再跟随bootFixture的两行依赖关系，最后阅读终止型参数用例。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { Command } from 'commander'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exitOnStdinEnd, internals, parseCmdline, provideCmdline, type AppReady } from '../src/index.ts'

/** Every value one boot of the fixture tree observed. */
interface Observed {
  /** Config the reading row started with; absent means it never started. */
  /* 读取条目启动时得到的配置；缺失表示该条目未启动。 */
  started?: Record<string, unknown>
  /** 启动器收到的受控退出码序列。 */
  exits: number[]
  /** Commander写入stdout和stderr的合并文本。 */
  out: string
}

/** A booted fixture tree: what it observed, and its root for direct parser calls. */
interface Fixture {
  /** 整个夹具树观察到的状态。 */
  observed: Observed
  /** 已启动Loader树的根上下文。 */
  ctx: Context
}

// 所有已启动夹具的异步释放函数，afterEach依次调用。
const disposers: (() => Promise<void>)[] = []

/** Fixture tree roots, removed after their booted tree has been disposed. */
const tempDirs: string[] = []

const readyApp: AppReady = {
  onReady(listener) {
    listener()
    return () => {}
  },
}

function controlledAppReady(): { service: AppReady; commit(): void } {
  const listeners = new Set<() => void>()
  return {
    service: {
      onReady(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    commit() {
      for (const listener of [...listeners]) listener()
      listeners.clear()
    },
  }
}

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  internals.stdin = process.stdin
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/** In-memory stdin whose end edge and ended-before-bind state are controllable. */
class TestStdin extends EventEmitter {
  readableEnded = false

  end(): void {
    this.readableEnded = true
    this.emit('end')
  }
}

/** The fixture app's flag family: one `--port` its rows read from the service. */
/* 构造带--port选项且覆盖直接退出的示例Commander程序。 */
function demoCommand(): Command {
  return new Command().name('demo').exitOverride().option('--port <port>', 'listen port')
}

/** The fixture app's action body: the resolved values its rows read. */
/* 解析并验证示例--port值，返回供应用服务发布的数值。 */
const resolveDemo = (program: Command): { port?: number } => {
  // Commander解析出的可选端口字符串。
  const port = program.opts<{ port?: string }>().port
  if (port === undefined) return {}
  if (!/^\d+$/.test(port)) program.error(`error: --port must be a number, got ${JSON.stringify(port)}`)
  return { port: Number(port) }
}

/** A YAML `!!js` expression node, as the include parses one out of a patch file. */
/* 构造Include从YAML !!js标签产生的表达式节点。 */
const expression = (source: string): unknown => ({ __jsExpr: source })

/**
 * Mount a two-row composition the way a profile boot does: both rows at once,
 * with Loader ordering config resolution from their injections.
 * @param args - the invocation's inner arguments.
 * @param resolve - the app's action body; defaults to the fixture's own.
 * @returns the booted fixture.
 */
async function bootFixture(
  args: string[],
  resolve: (program: Command) => unknown = resolveDemo,
  options: { objectInject?: boolean; withoutProvider?: boolean } = {},
): Promise<Fixture> {
  // 当前夹具插件文件和cordis.yml所在的临时目录。
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cmdline-'))
  tempDirs.push(dir)
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'reader.mjs'), `
export const name = 'reader'
export const inject = ['demoStartup']
export function apply(ctx, config) { globalThis.__observed.started = config }
`)
  // The Loader imports a row through Node's own resolver, which cannot resolve
  // this workspace's sources; the row delegates to the real function the test
  // imported through the source-plane path mapping.
  writeFileSync(join(dir, 'startup.mjs'), `
export const name = 'demo-startup'
export const inject = ['cmdlineArgs']
export function apply(ctx) { return globalThis.__provideDemoArgs(ctx) }
`)
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  // 把Commander两条输出流合并记录到observed.out的写入器。
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  // 临时ESM插件与测试源码之间共享的全局桥接字段。
  const globals = globalThis as unknown as { __observed: Observed; __provideDemoArgs: (ctx: Context) => void }
  globals.__observed = observed
  globals.__provideDemoArgs = (ctx: Context) => {
    const program = demoCommand()
    program.action(() => { ctx.provide('demoStartup', resolve(program)) })
    parseCmdline(ctx, program)
  }

  // The composition, exactly as a profile delivers one: include patches whose
  // config carries `!!js` expressions.
  const composition: PatchOptions[] = [{
    insert: [
      ...options.withoutProvider === true
        ? []
        : [{ id: 'demo-startup', name: pathToFileURL(join(dir, 'startup.mjs')).href }],
      {
        id: 'reader',
        name: pathToFileURL(join(dir, 'reader.mjs')).href,
        inject: options.objectInject === true ? { demoStartup: { required: true } } : ['demoStartup'],
        config: { port: expression('ctx.demoStartup.port ?? 3080') },
      },
    ],
  }]
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(join(dir, 'cordis.yml')).href, patches: structuredClone(composition) },
  })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return { observed, ctx }
}

describe('parseCmdline', () => {
  it('lets a row read the flag value the app resolved', async () => {
    const { observed } = await bootFixture(['--port', '8080'])
    expect(observed.started).toEqual({ port: 8080 })
    expect(observed.exits).toEqual([])
  })

  it('leaves a row on the value written beside the expression when no flag names one', async () => {
    const { observed } = await bootFixture([])
    expect(observed.started).toEqual({ port: 3080 })
  })

  it('recognizes the Loader object form of a provider-service injection', async () => {
    const { observed } = await bootFixture(['--port', '8080'], resolveDemo, { objectInject: true })
    expect(observed.started).toEqual({ port: 8080 })
  })

  it('prints the app help, starts no reading row, and requests exit 0', async () => {
    const { observed } = await bootFixture(['--help'])
    expect(observed.out).toContain('Usage: demo')
    expect(observed.started).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it('rejects the invocation from the action without starting the app', async () => {
    const { observed } = await bootFixture(['--port', 'abc'])
    expect(observed.out).toContain('--port must be a number')
    expect(observed.started).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('rethrows an action failure that is not commander asking to exit', async () => {
    const { ctx } = await bootFixture([], resolveDemo, { withoutProvider: true })
    const program = demoCommand().action(() => { throw new Error('action exploded') })
    expect(() => { parseCmdline(ctx, program) }).toThrow('action exploded')
  })

  it('rethrows a thrown value that is not an object at all', async () => {
    const { ctx } = await bootFixture([], resolveDemo, { withoutProvider: true })
    const program = demoCommand().action(() => {
      const thrown: unknown = 'action threw a string'
      throw thrown
    })
    expect(() => { parseCmdline(ctx, program) }).toThrow('action threw a string')
  })

  it('runs the action without inspecting Loader rows or owning a service', async () => {
    const { ctx } = await bootFixture([], resolveDemo, { withoutProvider: true })
    let values: unknown
    const program = demoCommand()
    program.action(() => { values = resolveDemo(program) })
    parseCmdline(ctx, program)
    expect(values).toEqual({})
    expect(ctx.get('demoStartup')).toBeUndefined()
  })
})

describe('provideCmdline', () => {
  it('hands the app a snapshot the caller cannot mutate afterwards', () => {
    const ctx = new Context()
    const args = ['--resume', 'abc']
    provideCmdline(ctx, { args, exit: () => {} })
    args.push('--tampered')
    expect(ctx.cmdlineArgs?.get()).toEqual(['--resume', 'abc'])
  })

  it('refuses at load a program in which no command declares an action', async () => {
    const { ctx } = await bootFixture([], resolveDemo, { withoutProvider: true })
    expect(() => { parseCmdline(ctx, demoCommand()) })
      .toThrow('no command in the program declares an action')
  })

  it('routes a pre-registered subcommand rejection through the launcher exit request', () => {
    const ctx = new Context()
    const exits: number[] = []
    let err = ''
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    provideCmdline(ctx, { args: ['serve'], exit: code => void exits.push(code) })
    // The root declares no action of its own: the tree-wide guard accepts the
    // subcommand's, and the subcommand inherits the exit and output routing.
    const program = new Command().name('demo')
    const child = program.command('serve')
    child.action(() => { child.error('error: serve rejected') })
    parseCmdline(ctx, program)
    expect(err).toContain('serve rejected')
    expect(exits).toEqual([1])
  })

  it('fails loud when a parser runs without the launcher values', () => {
    const ctx = new Context()
    expect(() => { parseCmdline(ctx, demoCommand()) })
      .toThrow('the launcher must provide ctx.cmdlineArgs and ctx.appExit')
  })

  it('lets multiple parsers read the same immutable snapshot', () => {
    const ctx = new Context()
    provideCmdline(ctx, { args: ['--port', '8080'], exit: () => {} })
    const parseOnce = (): unknown => {
      let values: unknown
      const program = demoCommand()
      program.action(() => { values = resolveDemo(program) })
      parseCmdline(ctx, program)
      return values
    }
    expect(parseOnce()).toEqual({ port: 8080 })
    expect(parseOnce()).toEqual({ port: 8080 })
    expect(Object.isFrozen(ctx.cmdlineArgs?.get())).toBe(true)
  })
})

describe('exitOnStdinEnd', () => {
  it('requests bounded exit on EOF and removes the listener on disposal', async () => {
    const ctx = new Context()
    const stdin = new TestStdin()
    const exits: number[] = []
    internals.stdin = stdin
    provideCmdline(ctx, { args: [], exit: code => void exits.push(code), ready: readyApp })
    exitOnStdinEnd(ctx, 'test.stdin')
    stdin.end()
    expect(exits).toEqual([0])
    await ctx.fiber.dispose()
    stdin.emit('end')
    expect(exits).toEqual([0])
  })

  it('requests exit after binding to stdin that has already ended', async () => {
    const ctx = new Context()
    const stdin = new TestStdin()
    const exits: number[] = []
    stdin.readableEnded = true
    internals.stdin = stdin
    provideCmdline(ctx, { args: [], exit: code => void exits.push(code), ready: readyApp })
    exitOnStdinEnd(ctx, 'test.stdin')
    stdin.end()
    await Promise.resolve()
    expect(exits).toEqual([0])
  })

  it('cancels an already-ended stream before its queued EOF handler runs', async () => {
    const ctx = new Context()
    const stdin = new TestStdin()
    const exits: number[] = []
    let queued: (() => void) | undefined
    const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((listener) => { queued = listener })
    stdin.readableEnded = true
    internals.stdin = stdin
    try {
      provideCmdline(ctx, { args: [], exit: code => void exits.push(code), ready: readyApp })
      exitOnStdinEnd(ctx, 'test.stdin')
      await ctx.fiber.dispose()
      queued?.()
      expect(exits).toEqual([])
    } finally {
      queue.mockRestore()
    }
  })

  it('leaves protocol bytes buffered until the transport claims stdin', async () => {
    const ctx = new Context()
    const stdin = new PassThrough()
    const exits: number[] = []
    internals.stdin = stdin
    provideCmdline(ctx, { args: [], exit: code => void exits.push(code), ready: readyApp })
    exitOnStdinEnd(ctx, 'test.stdin')

    const frame = '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n'
    stdin.write(frame)
    expect(stdin.readableFlowing).not.toBe(true)
    let received = ''
    stdin.on('data', (chunk: Buffer) => { received += chunk.toString('utf8') })
    const ended = new Promise<void>((resolve) => { stdin.once('end', resolve) })
    stdin.end()
    await ended

    expect(received).toBe(frame)
    expect(exits).toEqual([0])
    await ctx.fiber.dispose()
  })

  it('waits for the launcher to commit successful startup after EOF', async () => {
    const ctx = new Context()
    const stdin = new TestStdin()
    const exits: number[] = []
    const ready = controlledAppReady()
    internals.stdin = stdin
    provideCmdline(ctx, { args: [], exit: code => void exits.push(code), ready: ready.service })
    exitOnStdinEnd(ctx, 'test.stdin')

    stdin.end()
    expect(exits).toEqual([])
    ready.commit()
    expect(exits).toEqual([0])
    await ctx.fiber.dispose()
  })

  it('fails loud without a launcher exit request', () => {
    internals.stdin = new TestStdin()
    expect(() => { exitOnStdinEnd(new Context(), 'test.stdin') }).toThrow('launcher must provide ctx.appExit and ctx.appReady')
  })

  it('fails loud without launcher startup readiness', () => {
    const ctx = new Context()
    internals.stdin = new TestStdin()
    provideCmdline(ctx, { args: [], exit: () => {} })
    expect(() => { exitOnStdinEnd(ctx, 'test.stdin') }).toThrow('launcher must provide ctx.appExit and ctx.appReady')
  })
})
