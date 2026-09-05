/**
 * 文件职责：验证 skill-filesystem-watcher.spec.ts 覆盖的技能发现与装载行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的技能发现与装载能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */
import { EventEmitter } from 'node:events'
import type { Stats } from 'node:fs'
import { mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'

/** 中文说明：interface FakeWatcherControl 定义本测试所需的数据或行为，用于表达技能发现与装载场景。 */
interface FakeWatcherControl {
  emitter: EventEmitter
  closeCalls: number
  options: Record<string, unknown>
  path: string
}

/** 中文说明：interface FakeWatchFileControl 定义本测试所需的数据或行为，用于表达技能发现与装载场景。 */
interface FakeWatchFileControl {
  path: string
  listener(current: Stats, previous: Stats): void
}

/** 中文说明：interface FakeStatGate 定义本测试所需的数据或行为，用于表达技能发现与装载场景。 */
interface FakeStatGate {
  started: PromiseWithResolvers<undefined>
  release: PromiseWithResolvers<undefined>
}

/** 中文说明：函数值 watcherHarness 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const watcherHarness = vi.hoisted(() => ({
  watchers: [] as FakeWatcherControl[],
  startupErrors: [] as Error[],
  closeErrors: 0,
  deferredReady: 0,
  watchFiles: [] as FakeWatchFileControl[],
  statGates: [] as FakeStatGate[],
}))

vi.mock('node:fs', async (importOriginal) => {
  /** 中文说明：变量 actual 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    watchFile(path: string, _options: unknown, listener: FakeWatchFileControl['listener']) {
      watcherHarness.watchFiles.push({ path, listener })
    },
    unwatchFile(path: string, listener: FakeWatchFileControl['listener']) {
      /** 中文说明：函数值 index 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const index = watcherHarness.watchFiles.findIndex(control => control.path === path && control.listener === listener)
      if (index !== -1) watcherHarness.watchFiles.splice(index, 1)
    },
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  /** 中文说明：变量 actual 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async stat(...args: Parameters<typeof actual.stat>) {
      /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const gate = watcherHarness.statGates.shift()
      if (gate !== undefined) {
        gate.started.resolve(undefined)
        await gate.release.promise
      }
      return await actual.stat(...args)
    },
  }
})

vi.mock('chokidar', () => ({
  default: {
    watch(path: unknown, options: Record<string, unknown>) {
      /** 中文说明：变量 emitter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const emitter = new EventEmitter() as EventEmitter & { close(): Promise<void> }
      /** 中文说明：变量 control 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const control: FakeWatcherControl = { emitter, closeCalls: 0, options, path: String(path) }
      emitter.close = async () => {
        control.closeCalls += 1
        if (watcherHarness.closeErrors > 0) {
          watcherHarness.closeErrors -= 1
          throw new Error('close failed')
        }
      }
      watcherHarness.watchers.push(control)
      queueMicrotask(() => {
        if (watcherHarness.deferredReady > 0) {
          watcherHarness.deferredReady -= 1
          return
        }
        /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const error = watcherHarness.startupErrors.shift()
        if (error === undefined) emitter.emit('ready')
        else emitter.emit('error', error)
      })
      return emitter
    },
  },
}))

/** 中文说明：变量 SkillFileSystem 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const SkillFileSystem = await import('../src/index.ts')

/** Every temp dir created by this file, removed after each test. */
const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(name: string): Promise<string> {
  const dir = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), `dsh-${name}-`)))
  tempDirs.push(dir)
  return dir
}

/** 中文说明：函数 writeSkill 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function writeSkill(root: string, name: string): Promise<void> {
  /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n\nBody.\n`)
}

/** 中文说明：函数 settle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  watcherHarness.watchers.length = 0
  watcherHarness.startupErrors.length = 0
  watcherHarness.closeErrors = 0
  watcherHarness.deferredReady = 0
  watcherHarness.watchFiles.length = 0
  watcherHarness.statGates.length = 0
})

describe('skill-filesystem watcher failures', () => {
  it('canonicalizes an existing root before opening its native watcher', async () => {
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = await tempDir('skill-watch-canonical-target')
    /** 中文说明：变量 aliasParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const aliasParent = await tempDir('skill-watch-canonical-alias')
    /** 中文说明：变量 alias 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const alias = join(aliasParent, 'alias')
    await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(alias, '.dsh/skills')
    await writeSkill(root, 'canonical-skill')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(alias, '.dsh'),
      agentsHome: join(alias, '.agents'),
      watch: true,
    })

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['canonical-skill'])
    expect(watcherHarness.watchers[0]?.path).toBe(await realpath(root))
    expect(watcherHarness.watchers[0]?.options.persistent).toBe(true)
    await fiber.dispose()
  })

  it('preserves a symlink root when link following is disabled', async () => {
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = await tempDir('skill-watch-link-target')
    /** 中文说明：变量 aliasParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const aliasParent = await tempDir('skill-watch-link-alias')
    /** 中文说明：变量 alias 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const alias = join(aliasParent, 'skills')
    await writeSkill(target, 'linked-skill')
    await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SkillFileSystem, {
      includeDefaultRoots: false,
      customSkillDirs: [alias],
      watch: true,
      watchFollowSymlinks: false,
    })

    try {
      expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['linked-skill'])
      expect(watcherHarness.watchers[0]?.path).toBe(alias)
      expect(watcherHarness.watchers[0]?.options.followSymlinks).toBe(false)
    } finally {
      await fiber.dispose()
      await rm(aliasParent, { recursive: true, force: true })
      await rm(target, { recursive: true, force: true })
    }
  })

  it('ignores missing-path probes until the observed path actually changes', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-missing-stable')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchPollIntervalMs: 10,
    })
    expect(await ctx.skills.snapshot()).toEqual({ skills: [], complete: true })
    expect(watcherHarness.watchFiles).toHaveLength(2)
    /** 中文说明：变量 invalidations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let invalidations = 0
    ctx.on('skills/change', () => { invalidations += 1 })

    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const control of watcherHarness.watchFiles) {
      control.listener({} as Stats, {} as Stats)
    }
    await settle()

    expect(invalidations).toBe(0)
    expect(watcherHarness.watchFiles).toHaveLength(2)
    await fiber.dispose()
  })

  it('keeps skills loadable across persistent watcher startup failures without caching them', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-start-error')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'retry-skill')
    watcherHarness.startupErrors.push(
      new Error('watch failed once'),
      new Error('watch failed twice'),
      new Error('watch failed three times'),
    )
    watcherHarness.closeErrors = 1
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchUsePolling: true,
      watchFollowSymlinks: false,
      watchPollIntervalMs: 10,
      watchStabilityThresholdMs: 20,
    })

    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'retry-skill' }],
      complete: false,
    })
    expect((await ctx.skills.get('retry-skill'))?.content).toBe('Body.')
    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'retry-skill' }],
      complete: false,
    })
    expect(watcherHarness.watchers).toHaveLength(3)
    expect(watcherHarness.watchers[0]?.options).toMatchObject({
      atomic: true,
      depth: 1,
      followSymlinks: false,
      usePolling: true,
      interval: 10,
      awaitWriteFinish: {
        stabilityThreshold: 20,
        pollInterval: 10,
      },
    })

    await fiber.dispose()
  })

  it('filters events, coalesces invalidation, recovers runtime errors, and contains late callbacks', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-runtime-error')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'watched-skill')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchPollIntervalMs: 10,
      watchStabilityThresholdMs: 20,
    })
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['watched-skill'])
    /** 中文说明：变量 invalidations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let invalidations = 0
    ctx.on('skills/change', () => { invalidations += 1 })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = watcherHarness.watchers[0]
    if (first === undefined) throw new Error('expected a root watcher')

    first.emitter.emit('change', join(first.path, 'notes.txt'))
    first.emitter.emit('change', join(home, 'outside.md'))
    first.emitter.emit('change', join(first.path, 'watched-skill/references.md'))
    first.emitter.emit('change', join(first.path, '.system/SKILL.md'))
    await settle()
    expect(invalidations).toBe(0)

    first.emitter.emit('change', join(first.path, 'watched-skill/SKILL.md'))
    first.emitter.emit('change', join(first.path, 'watched-skill/SKILL.md'))
    await settle()
    expect(invalidations).toBe(1)

    watcherHarness.closeErrors = 1
    watcherHarness.startupErrors.push(new Error('runtime rewatch failed'))
    first.emitter.emit('error', new Error('runtime watch failed'))
    await vi.waitFor(() => { expect(watcherHarness.watchers.length).toBeGreaterThanOrEqual(2) })
    expect(invalidations).toBeGreaterThanOrEqual(2)
    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'watched-skill' }],
      complete: true,
    })

    await fiber.dispose()
    first.emitter.emit('change', join(first.path, 'watched-skill/SKILL.md'))
    first.emitter.emit('error', new Error('late error'))
    await settle()
  })

  it('replaces a retained watcher when its root emits unlinkDir', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-root-unlink')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'removed-skill')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchPollIntervalMs: 10,
      watchStabilityThresholdMs: 20,
    })

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['removed-skill'])
    /** 中文说明：变量 original 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const original = watcherHarness.watchers[0]
    if (original === undefined) throw new Error('expected a root watcher')

    await rm(root, { recursive: true })
    original.emitter.emit('unlinkDir', original.path)
    await vi.waitFor(() => { expect(original.closeCalls).toBeGreaterThan(0) })
    await vi.waitFor(() => {
      expect(watcherHarness.watchFiles.some(control => control.path === original.path)).toBe(true)
    })

    await fiber.dispose()
  })

  it('re-probes a retained root after child unlink and observes immediate recreation', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-root-reprobe')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'old-skill')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchPollIntervalMs: 10,
      watchStabilityThresholdMs: 20,
    })

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['old-skill'])
    /** 中文说明：变量 original 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const original = watcherHarness.watchers[0]
    if (original === undefined) throw new Error('expected a root watcher')

    await rm(root, { recursive: true })
    original.emitter.emit('unlink', join(original.path, 'old-skill/SKILL.md'))
    await settle()
    expect(await ctx.skills.snapshot()).toEqual({ skills: [], complete: true })

    /** 中文说明：函数值 missingRoot 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const missingRoot = watcherHarness.watchFiles.find(control => control.path === original.path)
    expect(missingRoot).toBeDefined()
    await writeSkill(root, 'recreated-skill')
    missingRoot!.listener({} as Stats, {} as Stats)
    await vi.waitFor(() => { expect(watcherHarness.watchers).toHaveLength(2) })
    await settle()

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['recreated-skill'])
    await fiber.dispose()
  })

  it('settles an opening watcher when plugin disposal races its ready event', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-opening-dispose')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'racing-skill')
    watcherHarness.deferredReady = 1
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let provider!: InstanceType<typeof SkillFileSystem.FileSystemSkillProvider>
    /** 中文说明：函数值 disposeProvider 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposeProvider = ctx.skills.registerProvider((control) => {
      provider = new SkillFileSystem.FileSystemSkillProvider(ctx, control, {
        dshHome: join(home, '.dsh'),
        agentsHome: join(home, '.agents'),
        watch: true,
        watchPollIntervalMs: 10,
        watchStabilityThresholdMs: 20,
      })
      return provider
    })

    /** 中文说明：变量 discovery 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const discovery = provider.list({})
    await vi.waitFor(() => { expect(watcherHarness.watchers).toHaveLength(1) })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = watcherHarness.watchers[0]
    if (first === undefined) throw new Error('expected an opening root watcher')
    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = provider.dispose()

    await expect(discovery).rejects.toThrow('skill-filesystem watcher disposed')
    await disposal
    disposeProvider()
    await settle()
    expect(first.closeCalls).toBeGreaterThan(0)
  })

  it('closes an opening watcher when disposal wins the mode probe', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-probe-dispose')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'racing-skill')
    watcherHarness.deferredReady = 1
    /** 中文说明：变量 statGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const statGate: FakeStatGate = {
      started: Promise.withResolvers<undefined>(),
      release: Promise.withResolvers<undefined>(),
    }
    watcherHarness.statGates.push(statGate)
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let provider!: InstanceType<typeof SkillFileSystem.FileSystemSkillProvider>
    /** 中文说明：函数值 disposeProvider 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposeProvider = ctx.skills.registerProvider((control) => {
      provider = new SkillFileSystem.FileSystemSkillProvider(ctx, control, {
        dshHome: join(home, '.dsh'),
        agentsHome: join(home, '.agents'),
        watch: true,
        watchPollIntervalMs: 10,
        watchStabilityThresholdMs: 20,
      })
      return provider
    })

    /** 中文说明：变量 discovery 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const discovery = provider.list({})
    await statGate.started.promise
    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = provider.dispose()
    statGate.release.resolve(undefined)

    await expect(discovery).rejects.toThrow('skill-filesystem watcher disposed')
    await disposal
    expect(watcherHarness.watchers).toHaveLength(1)
    expect(watcherHarness.watchers[0]?.closeCalls).toBeGreaterThan(0)
    disposeProvider()
  })

  it('contains an opening watcher rejection during provider teardown', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-opening-reject')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'rejected-skill')
    watcherHarness.deferredReady = 1
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let provider!: InstanceType<typeof SkillFileSystem.FileSystemSkillProvider>
    /** 中文说明：函数值 disposeProvider 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposeProvider = ctx.skills.registerProvider((control) => {
      provider = new SkillFileSystem.FileSystemSkillProvider(ctx, control, {
        dshHome: join(home, '.dsh'),
        agentsHome: join(home, '.agents'),
        watch: true,
        watchPollIntervalMs: 10,
        watchStabilityThresholdMs: 20,
      })
      return provider
    })

    /** 中文说明：变量 discovery 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const discovery = provider.list({})
    await vi.waitFor(() => { expect(watcherHarness.watchers).toHaveLength(1) })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = watcherHarness.watchers[0]
    if (first === undefined) throw new Error('expected an opening root watcher')
    first.emitter.emit('error', new Error('opening failed during disposal'))
    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = provider.dispose()

    await expect(discovery).rejects.toThrow('opening failed during disposal')
    await disposal
    disposeProvider()
  })
})
