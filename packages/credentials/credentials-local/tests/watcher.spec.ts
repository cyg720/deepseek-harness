/**
 * 文件职责：验证凭据存储的 watcher.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证凭据存储在真实组装、失败和清理场景中可靠。
 * 逻辑维度：构造服务或远程替身，驱动操作并断言结果。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '../src/index.ts'

/** 中文说明：测试局部值 fsHarness，由紧邻初始化决定。 */
const fsHarness = vi.hoisted(() => ({
  nextReadError: undefined as NodeJS.ErrnoException | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  /** 中文说明：测试局部值 actual，由紧邻初始化决定。 */
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (async (path: unknown, ...rest: never[]) => {
      /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
      const error = fsHarness.nextReadError
      if (error !== undefined) {
        fsHarness.nextReadError = undefined
        throw error
      }
      return (actual.readFile as (path: unknown, ...args: never[]) => Promise<unknown>)(path, ...rest)
    }) as typeof actual.readFile,
  }
})

/** Credential documents are seeded owner-only, exactly as the provider creates them. */
/* 中文说明：函数 writeCredentials 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function writeCredentials(file: string, text: string): Promise<void> {
  return writeFile(file, text, { mode: 0o600 })
}

// chokidar is the nondeterministic OS boundary: faking it lets these tests
// drive the event pipeline (error events, races with unreadable files)
// deterministically. Real end-to-end watching stays covered by local.spec.ts.
vi.mock('chokidar', async () => {
  /** 中文说明：测试局部值 { EventEmitter }，由紧邻初始化决定。 */
  const { EventEmitter } = await import('node:events')
  /** 中文说明：类型或类 FakeWatcher 约束远程资源或测试数据职责。 */
  class FakeWatcher extends EventEmitter {
    close = vi.fn(() => Promise.resolve())
  }
  /** 中文说明：测试局部值 instances，由紧邻初始化决定。 */
  const instances: Array<{ path: string; options: unknown; watcher: InstanceType<typeof FakeWatcher> }> = []
  return {
    watch: vi.fn((path: string, options: unknown) => {
      /** 中文说明：测试局部值 watcher，由紧邻初始化决定。 */
      const watcher = new FakeWatcher()
      instances.push({ path, options, watcher })
      return watcher
    }),
    __instances: instances,
  }
})

/** 中文说明：类型或类 FakeChokidar 约束远程资源或测试数据职责。 */
interface FakeChokidar {
  __instances: Array<{
    path: string
    options: { awaitWriteFinish: { stabilityThreshold: number; pollInterval: number } }
    watcher: import('node:events').EventEmitter
  }>
}

/** 中文说明：函数 fakeInstances 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function fakeInstances(): Promise<FakeChokidar['__instances']> {
  /** 中文说明：测试局部值 chokidar，由紧邻初始化决定。 */
  const chokidar = await import('chokidar') as unknown as FakeChokidar
  return chokidar.__instances
}

/** 中文说明：测试局部值 KEY，由紧邻初始化决定。 */
const KEY = credentialRef('DSH_CRED_PIPE')

/** 中文说明：测试局部值 cleanups，由紧邻初始化决定。 */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  fsHarness.nextReadError = undefined
  while (cleanups.length > 0) await cleanups.pop()!()
  ;(await fakeInstances()).length = 0
})

/** 中文说明：函数 tempDir 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function tempDir(): Promise<string> {
  /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-watch-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** 中文说明：函数 boot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function boot(config: ConstructorParameters<typeof LocalCredentialProvider>[1]): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = ctx.plugin(LocalCredentialProvider, config)
  cleanups.push(async () => {
    await fiber.dispose()
  })
  await fiber
  return ctx
}

describe('watcher pipeline', () => {
  it('clamps the write-settle poll interval for a zero debounce', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    await boot({ path: join(dir, '.credentials.yaml'), debounceMs: 0 })
    /** 中文说明：测试局部值 [instance]，由紧邻初始化决定。 */
    const [instance] = await fakeInstances()
    expect(instance!.options.awaitWriteFinish).toEqual({ stabilityThreshold: 0, pollInterval: 1 })
  })

  it('survives a watcher error and keeps publishing later edits', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：测试局部值 [instance]，由紧邻初始化决定。 */
    const [instance] = await fakeInstances()

    instance!.watcher.emit('error', new Error('watch backend failure'))
    expect(await ctx.credentials.resolve(KEY)).toBeUndefined()

    await writeCredentials(path, 'version: 1\nrefs:\n  DSH_CRED_PIPE: arrived\n')
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(async () => {
      expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'arrived', source: 'file' })
    })
  })

  it('keeps the last good snapshot when the file turns unreadable at runtime', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, 'version: 1\nrefs:\n  DSH_CRED_PIPE: good\n')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, debounceMs: 5 })

    await chmod(path, 0o000)
    cleanups.push(() => chmod(path, 0o600))
    /** 中文说明：测试局部值 [instance]，由紧邻初始化决定。 */
    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'change', path)
    // The warn-and-keep path is asynchronous; give the serialized refresh a turn.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'good', source: 'file' })
  })

  it('keeps the last good snapshot when the read fails after its permission check', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, 'version: 1\nrefs:\n  DSH_CRED_PIPE: good\n')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    fsHarness.nextReadError = Object.assign(new Error('version: 1\nrefs:\n  EACCES: injected read failure\n'), { code: 'EACCES' })

    /** 中文说明：测试局部值 [instance]，由紧邻初始化决定。 */
    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(() => {
      expect(fsHarness.nextReadError).toBeUndefined()
    })
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'good', source: 'file' })
  })

  it('keeps the reload queue alive after an invariant violation escapes the fan-out', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：测试局部值 arm，由紧邻初始化决定。 */
    let arm = true
    ctx.on('credentials/reference-updated', () => {
      if (!arm) return
      throw Object.assign(new Error('forged relation'), { code: 'INVARIANT' })
    })
    /** 中文说明：测试局部值 [instance]，由紧邻初始化决定。 */
    const [instance] = await fakeInstances()

    await writeCredentials(path, 'version: 1\nrefs:\n  DSH_CRED_PIPE: first\n')
    instance!.watcher.emit('all', 'change', path)
    // The snapshot commits before the fan-out, so the value lands even though
    // the listener threw out of the refresh.
    await vi.waitFor(async () => {
      expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'first', source: 'file' })
    })

    arm = false
    await writeCredentials(path, 'version: 1\nrefs:\n  DSH_CRED_PIPE: second\n')
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(async () => {
      expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'second', source: 'file' })
    })
  })

  it('quiesces the refresh pipeline before dispose completes', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, 'version: 1\nrefs:\n  DSH_CRED_PIPE: initial\n')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin(LocalCredentialProvider, { path, debounceMs: 5 })
    await fiber
    /** 中文说明：测试局部值 disposed，由紧邻初始化决定。 */
    let disposed = false
    /** 中文说明：测试局部值 postDisposeCommits，由紧邻初始化决定。 */
    let postDisposeCommits = 0
    ctx.on('credentials/reference-updated', () => {
      if (disposed) postDisposeCommits += 1
    })

    await writeCredentials(path, 'version: 1\nrefs:\n  DSH_CRED_PIPE: changed\n')
    /** 中文说明：测试局部值 [instance]，由紧邻初始化决定。 */
    const [instance] = await fakeInstances()
    // Two queued refreshes: dispose interrupts one mid-flight and the other
    // before it starts, so both closed guards must hold.
    instance!.watcher.emit('all', 'change', path)
    instance!.watcher.emit('all', 'change', path)
    await fiber.dispose()
    disposed = true
    instance!.watcher.emit('all', 'change', path)
    instance!.watcher.emit('ready')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(postDisposeCommits).toBe(0)
  })

  it('empties the snapshot when the document is deleted and emits the removals', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, 'version: 1\nrefs:\n  DSH_CRED_PIPE: doomed\n')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: string[] = []
    ctx.on('credentials/reference-updated', (ref) => {
      seen.push(ref)
    })

    await rm(path)
    /** 中文说明：测试局部值 [instance]，由紧邻初始化决定。 */
    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'unlink', path)
    await vi.waitFor(async () => {
      expect(await ctx.credentials.resolve(KEY)).toBeUndefined()
    })
    expect(seen).toEqual([KEY])
  })

  it('keeps the last good snapshot when an external edit makes the document invalid', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, 'version: 1\nrefs:\n  DSH_CRED_PIPE: a\n')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: string[] = []
    ctx.on('credentials/reference-updated', (ref) => {
      seen.push(ref)
    })

    // A key the seam cannot address is a rejection, not preserved content:
    // this document holds nothing but credentials. A live reload must warn
    // and keep serving the last good snapshot rather than take the process
    // down or silently drop the entry it could not validate.
    await writeCredentials(path, 'version: 1\nrefs:\n  BAD-KEY: 2\n  DSH_CRED_PIPE: b\n')
    /** 中文说明：测试局部值 [instance]，由紧邻初始化决定。 */
    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'change', path)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'a', source: 'file' })
    expect(seen).toEqual([])

    // Repairing the document resumes publishing.
    await writeCredentials(path, 'version: 1\nrefs:\n  DSH_CRED_PIPE: b\n')
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(async () => {
      expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'b', source: 'file' })
    })
    expect(seen).toEqual([KEY])
  })

  it('treats an event for a still-absent file as a no-op', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：测试局部值 [instance]，由紧邻初始化决定。 */
    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'add', path)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(await ctx.credentials.resolve(KEY)).toBeUndefined()
  })

  it('reconciles at watcher ready so a change during setup is not missed', async () => {
    /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
    const dir = await tempDir()
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, '.credentials.yaml')
    await writeCredentials(path, `version: 1\nrefs:\n  ${KEY}: a\n`)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    // Written after the initial load but before the watcher became active:
    // no 'all' event will ever fire for it.
    await writeCredentials(path, `version: 1\nrefs:\n  ${KEY}: written-before-ready\n`)
    /** 中文说明：测试局部值 [instance]，由紧邻初始化决定。 */
    const [instance] = await fakeInstances()
    instance!.watcher.emit('ready')
    await vi.waitFor(async () => {
      expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'written-before-ready', source: 'file' })
    })
  })
})
