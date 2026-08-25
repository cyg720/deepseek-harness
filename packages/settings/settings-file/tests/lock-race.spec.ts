// A temp-file write failure cannot be timed from outside. The `fs/promises` API
// injects it once so the test can prove that the writer lock still releases.
/**
 * 文件职责：验证 lock-race.spec.ts 覆盖的设置存储行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的设置存储能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { FileSettingsProvider } from '../src/index.ts'

/** 中文说明：函数值 state 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const state = vi.hoisted(() => ({
  failTempWrite: false,
  failDocumentCreate: false,
  holdDocumentCreate: false,
  documentCreateStarted: undefined as (() => void) | undefined,
  continueDocumentCreate: undefined as Promise<void> | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  /** 中文说明：变量 actual 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: (async (path: unknown, ...rest: never[]) => {
      if (state.holdDocumentCreate && String(path).endsWith('settings.yaml')) {
        state.holdDocumentCreate = false
        state.documentCreateStarted!()
        await state.continueDocumentCreate!
      }
      if (state.failDocumentCreate && String(path).endsWith('settings.yaml')) {
        state.failDocumentCreate = false
        throw Object.assign(new Error('ENOSPC: injected document create failure'), { code: 'ENOSPC' })
      }
      if (state.failTempWrite && String(path).endsWith('.tmp')) {
        state.failTempWrite = false
        throw Object.assign(new Error('ENOSPC: injected writeFile failure'), { code: 'ENOSPC' })
      }
      return (actual.writeFile as (path: unknown, ...args: never[]) => Promise<void>)(path, ...rest)
    }) as typeof actual.writeFile,
  }
})

/** 中文说明：变量 AlphaSchema 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const AlphaSchema: z<{ value: number }> = z.object({ value: z.number().default(0) })

/** 中文说明：函数值 cleanups 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  state.failTempWrite = false
  state.failDocumentCreate = false
  state.holdDocumentCreate = false
  state.documentCreateStarted = undefined
  state.continueDocumentCreate = undefined
  while (cleanups.length > 0) await cleanups.pop()!()
})

/** 中文说明：函数 tempDir 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function tempDir(): Promise<string> {
  /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = await mkdtemp(join(tmpdir(), 'dsh-settings-lockrace-'))
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

describe('writer-lock failure cleanup', () => {
  it('skips publication when an in-flight document create completes during teardown', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = ctx.plugin(FileSettingsProvider, { path, watch: false })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber
    /** 中文说明：变量 settings 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const settings = ctx.settings
    settings.register(settingsNamespace('alpha'), AlphaSchema)
    /** 中文说明：变量 published 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const published: number[] = []
    ctx.on('settings/document-updated', (_ns, revision) => { published.push(revision) })
    /** 中文说明：函数值 markStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let markStarted!: () => void
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    /** 中文说明：函数值 releaseCreate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let releaseCreate!: () => void
    state.continueDocumentCreate = new Promise<void>((resolve) => { releaseCreate = resolve })
    state.documentCreateStarted = markStarted
    state.holdDocumentCreate = true

    /** 中文说明：变量 preparing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparing = settings.prepareDocument()
    await started
    /** 中文说明：变量 disposed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let disposed = false
    /** 中文说明：变量 disposing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposing = fiber.dispose()
    void disposing.then(() => { disposed = true })
    await vi.waitFor(() => {
      expect((settings as unknown as { closed: boolean }).closed).toBe(true)
    })
    expect(disposed).toBe(false)
    releaseCreate()
    await expect(preparing).resolves.toBe(path)
    await disposing
    expect(await readFile(path, 'utf8')).toBe('')
    expect(published).toEqual([])
  })

  it('surfaces an exclusive document-create failure and releases the lock', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, watch: false })
    state.failDocumentCreate = true
    await expect(ctx.settings.prepareDocument()).rejects.toThrow(/ENOSPC/)
    await expect(access(`${path}.lock`)).rejects.toThrow()
  })

  it('cleans up the temp file and releases the lock when the write fails mid-cycle', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await tempDir()
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'alpha:\n  value: 1\n')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot({ path, watch: false })
    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = ctx.settings.register(settingsNamespace('alpha'), AlphaSchema)
    state.failTempWrite = true
    await expect(scope.update({ value: 9 })).rejects.toThrow(/ENOSPC/)
    // The document is untouched and the writer lock was released on the way out.
    expect(await readFile(path, 'utf8')).toContain('value: 1')
    await expect(access(`${path}.lock`)).rejects.toThrow()
  })
})
