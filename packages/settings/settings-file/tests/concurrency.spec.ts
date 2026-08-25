// Cross-instance and writer-lock behavior: two providers on one document are
// the in-process equivalent of two dsh processes sharing a harness home —
// neither knows the other's cache, so only the read-modify-write cycle under
// the `<file>.lock` sibling keeps both namespaces alive on disk.
/**
 * 文件职责：验证 concurrency.spec.ts 覆盖的设置存储行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的设置存储能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { chmod, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { FileSettingsProvider } from '../src/index.ts'

/** 中文说明：变量 AlphaSchema 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const AlphaSchema: z<{ value: number }> = z.object({ value: z.number().default(0) })
/** 中文说明：变量 BetaSchema 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const BetaSchema: z<{ value: number }> = z.object({ value: z.number().default(0) })

/** 中文说明：函数值 cleanups 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

/** 中文说明：函数 tempDir 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function tempDir(): Promise<string> {
  /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = await mkdtemp(join(tmpdir(), 'dsh-settings-lock-'))
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

describe('cross-instance writes', () => {
  it('keeps both namespaces when two providers write the same document concurrently', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = await boot({ path, watch: false })
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = await boot({ path, watch: false })
    /** 中文说明：变量 alpha 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const alpha = first.settings.register(settingsNamespace('alpha'), AlphaSchema)
    /** 中文说明：变量 beta 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beta = second.settings.register(settingsNamespace('beta'), BetaSchema)
    /** 中文说明：变量 rounds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rounds = [1, 2, 3, 4, 5]
    await Promise.all([
      (async () => { for (const value of rounds) await alpha.update({ value }) })(),
      (async () => { for (const value of rounds) await beta.update({ value }) })(),
    ])
    /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = await readFile(path, 'utf8')
    expect(text).toContain('alpha:')
    expect(text).toContain('beta:')
    // A third instance resolves both final values from the shared document.
    /** 中文说明：变量 third 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const third = await boot({ path, watch: false })
    expect(third.settings.register(settingsNamespace('alpha'), AlphaSchema).get()).toEqual({ value: 5 })
    expect(third.settings.register(settingsNamespace('beta'), BetaSchema).get()).toEqual({ value: 5 })
  })
})

describe('writer lock', () => {
  it('waits for a busy writer lock instead of failing', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, watch: false })
    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = ctx.settings.register(settingsNamespace('alpha'), AlphaSchema)
    await writeFile(`${path}.lock`, 'holder\n')
    /** 中文说明：函数值 release 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const release = setTimeout(() => { void rm(`${path}.lock`, { force: true }) }, 120)
    cleanups.push(async () => { clearTimeout(release) })
    await scope.update({ value: 7 })
    expect(await readFile(path, 'utf8')).toContain('value: 7')
  })

  it('does not steal an old writer lock', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'alpha:\n  value: 4\n')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, watch: false })
    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = ctx.settings.register(settingsNamespace('alpha'), AlphaSchema)
    /** 中文说明：变量 lockPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lockPath = `${path}.lock`
    await writeFile(lockPath, 'slow-holder\n')
    /** 中文说明：变量 past 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const past = (Date.now() - 60_000) / 1000
    await utimes(lockPath, past, past)

    await expect(scope.update({ value: 9 })).rejects.toThrow(/timed out waiting for the writer lock/)
    expect(await readFile(path, 'utf8')).toContain('value: 4')
    expect(await readFile(lockPath, 'utf8')).toBe('slow-holder\n')
  }, 10_000)

  it.skipIf(process.platform === 'win32')('surfaces a non-contention lock failure as the write error', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, watch: false })
    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = ctx.settings.register(settingsNamespace('alpha'), AlphaSchema)
    await chmod(dir, 0o500)
    cleanups.push(() => chmod(dir, 0o700))
    await expect(scope.update({ value: 1 })).rejects.toThrow(/EACCES|permission/)
  })
})
