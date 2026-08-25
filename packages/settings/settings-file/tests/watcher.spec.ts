/**
 * 文件职责：验证 watcher.spec.ts 覆盖的设置存储行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的设置存储能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { FileSettingsProvider } from '../src/index.ts'

// chokidar is the nondeterministic OS boundary: faking it lets these tests
// drive the event pipeline (error events, races with unreadable files)
// deterministically. Real end-to-end watching stays covered by local.spec.ts.
vi.mock('chokidar', async () => {
  const { EventEmitter } = await import('node:events')
  /** 中文说明：class FakeWatcher 定义本测试所需的数据或行为，用于表达设置存储场景。 */
  class FakeWatcher extends EventEmitter {
    close = vi.fn(() => Promise.resolve())
  }
  /** 中文说明：变量 instances 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const instances: Array<{ path: string; options: unknown; watcher: InstanceType<typeof FakeWatcher> }> = []
  return {
    watch: vi.fn((path: string, options: unknown) => {
      /** 中文说明：变量 watcher 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const watcher = new FakeWatcher()
      instances.push({ path, options, watcher })
      return watcher
    }),
    __instances: instances,
  }
})

/** 中文说明：interface FakeChokidar 定义本测试所需的数据或行为，用于表达设置存储场景。 */
interface FakeChokidar {
  __instances: Array<{
    path: string
    options: { awaitWriteFinish: { stabilityThreshold: number; pollInterval: number } }
    watcher: import('node:events').EventEmitter
  }>
}

/** 中文说明：函数 fakeInstances 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function fakeInstances(): Promise<FakeChokidar['__instances']> {
  /** 中文说明：变量 chokidar 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chokidar = await import('chokidar') as unknown as FakeChokidar
  return chokidar.__instances
}

/** 中文说明：变量 ThemeSchema 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const ThemeSchema: z<{ theme: string }> = z.object({
  theme: z.string().default('dark'),
})

/** 中文说明：函数值 cleanups 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  ;(await fakeInstances()).length = 0
})

/** 中文说明：函数 tempDir 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function tempDir(): Promise<string> {
  /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = await mkdtemp(join(tmpdir(), 'dsh-settings-watch-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** 中文说明：函数 boot 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function boot(config: ConstructorParameters<typeof FileSettingsProvider>[1]): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = ctx.plugin(FileSettingsProvider, config)
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

describe('watcher pipeline', () => {
  it('clamps the write-settle poll interval for a zero debounce', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    await boot({ path: join(dir, 'settings.yaml'), debounceMs: 0 })
    const [instance] = await fakeInstances()
    expect(instance!.options.awaitWriteFinish).toEqual({ stabilityThreshold: 0, pollInterval: 1 })
  })

  it('survives a watcher error and keeps publishing later edits', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const [instance] = await fakeInstances()

    instance!.watcher.emit('error', new Error('watch backend failure'))
    expect(scope.get()).toEqual({ theme: 'dark' })

    await writeFile(path, 'ui-theme:\n  theme: light\n')
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(() => {
      expect(scope.get()).toEqual({ theme: 'light' })
    })
  })

  it('keeps the last good document when the file turns unreadable at runtime', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)

    await chmod(path, 0o000)
    cleanups.push(() => chmod(path, 0o600))
    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'change', path)
    // The warn-and-keep path is asynchronous; give the serialized refresh a turn.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(scope.get()).toEqual({ theme: 'light' })
  })

  it('keeps the reload queue alive after an invariant violation escapes a commit', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    /** 中文说明：变量 arm 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let arm = true
    ctx.on('settings/updated', () => {
      if (!arm) return
      throw Object.assign(new Error('forged relation'), { code: 'INVARIANT' })
    })
    const [instance] = await fakeInstances()

    await writeFile(path, 'ui-theme:\n  theme: broken-commit\n')
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(() => {
      expect(scope.get().theme).toBe('broken-commit')
    })

    arm = false
    await writeFile(path, 'ui-theme:\n  theme: recovered\n')
    instance!.watcher.emit('all', 'change', path)
    await vi.waitFor(() => {
      expect(scope.get().theme).toBe('recovered')
    })
  })

  it('quiesces the refresh pipeline before dispose completes', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = ctx.plugin(FileSettingsProvider, { path, debounceMs: 5 })
    await fiber
    ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    /** 中文说明：变量 disposed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposed = false
    /** 中文说明：变量 postDisposeCommits 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let postDisposeCommits = 0
    ctx.on('settings/updated', () => {
      if (disposed) postDisposeCommits += 1
    })

    await writeFile(path, 'ui-theme:\n  theme: darker\n')
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

  it('treats an event for a still-absent file as a no-op', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    const [instance] = await fakeInstances()
    instance!.watcher.emit('all', 'add', path)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(scope.get()).toEqual({ theme: 'dark' })
  })

  it('folds an unobserved external edit into a write instead of overwriting it', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：变量 theme 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const theme = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    /** 中文说明：变量 editor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const editor = ctx.settings.register(settingsNamespace('editor'), z.object({
      tabWidth: z.number().default(2),
    }))
    // The external edit has landed on disk but its watcher event has not
    // fired yet (a debounce window, or a missed event): the write must fold
    // it in, not resurrect the stale document.
    await writeFile(path, 'ui-theme:\n  theme: light\neditor:\n  tabWidth: 8\n')
    await theme.update({ theme: 'darker' })
    /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = await readFile(path, 'utf8')
    expect(text).toContain('tabWidth: 8')
    expect(text).toContain('theme: darker')
    // The fold published the unobserved section before the write committed.
    expect(editor.get()).toEqual({ tabWidth: 8 })
  })

  it('reconciles at watcher ready so a change during setup is not missed', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    // Written after the initial load but before the watcher became active:
    // no 'all' event will ever fire for it.
    await writeFile(path, 'ui-theme:\n  theme: written-before-ready\n')
    const [instance] = await fakeInstances()
    instance!.watcher.emit('ready')
    await vi.waitFor(() => {
      expect(scope.get().theme).toBe('written-before-ready')
    })
  })

  it('fails a write loud when the on-disk document turned invalid unobserved', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'ui-theme:\n  theme: light\n')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, debounceMs: 5 })
    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = ctx.settings.register(settingsNamespace('ui-theme'), ThemeSchema)
    /** 中文说明：变量 broken 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const broken = 'ui-theme: [unclosed\n  flow: {\n'
    await writeFile(path, broken)
    await expect(scope.update({ theme: 'darker' })).rejects.toThrow(/invalid document/)
    // The user's manual edit stays on disk untouched and the cache keeps the
    // last good value.
    expect(await readFile(path, 'utf8')).toBe(broken)
    expect(scope.get()).toEqual({ theme: 'light' })
  })
})
