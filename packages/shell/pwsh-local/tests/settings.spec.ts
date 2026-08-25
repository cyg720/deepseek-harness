/** The shared `bash` settings section as the pwsh executor family resolves it. */
/*
 * 文件职责：验证 settings.spec.ts 覆盖的Shell 命令与沙箱行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的Shell 命令与沙箱能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { SHELL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-shell'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { PwshLocalExecutor } from '@deepseek-ai/dsh-pwsh-local'

/** The smallest real provider: one in-memory document, always writable. */
/* 中文说明：class MemorySettings 定义本测试所需的数据或行为，用于表达Shell 命令与沙箱场景。 */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** 中文说明：函数 boot 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function boot(config: ConstructorParameters<typeof PwshLocalExecutor>[1] = {}): Promise<{
  ctx: Context
  settingsFiber: Fiber
  executorFiber: Fiber
  pwsh: PwshLocalExecutor
}> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  /** 中文说明：变量 settingsFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  /** 中文说明：变量 executorFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const executorFiber = ctx.plugin(PwshLocalExecutor, { timeoutMs: 60_000, ...config })
  await executorFiber.await()
  return { ctx, settingsFiber, executorFiber, pwsh: ctx.shell as PwshLocalExecutor }
}

describe('pwsh executor over the bash settings section', () => {
  it('resolves the user layer over the composition entry', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await boot()
    expect(bench.pwsh.config.timeoutMs).toBe(60_000)

    await bench.ctx.settings.update(SHELL_SETTINGS_NAMESPACE, { timeoutMs: 5_000 })

    expect(bench.pwsh.config.timeoutMs).toBe(5_000)
    await bench.ctx.fiber.dispose()
  })

  it('refuses a stored value the constructor would have rejected', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await boot()

    await expect(bench.ctx.settings.update(SHELL_SETTINGS_NAMESPACE, { timeoutMs: 0 }))
      .rejects.toThrow(/pwsh-local: timeoutMs must be a positive finite number/)

    expect(bench.pwsh.config.timeoutMs).toBe(60_000)
    await bench.ctx.fiber.dispose()
  })

  it('re-resolves the executable when the stored path changes', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await boot({ pwshPath: '/opt/first/pwsh' })
    expect(bench.pwsh.pwshPath).toBe('/opt/first/pwsh')

    await bench.ctx.settings.update(SHELL_SETTINGS_NAMESPACE, { pwshPath: '/opt/second/pwsh' })

    expect(bench.pwsh.pwshPath).toBe('/opt/second/pwsh')
    await bench.ctx.fiber.dispose()
  })

  it('keeps the resolved executable when an unrelated field changes', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await boot({ pwshPath: '/opt/first/pwsh' })
    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = bench.pwsh.pwshPath

    await bench.ctx.settings.update(SHELL_SETTINGS_NAMESPACE, { timeoutMs: 5_000 })

    expect(bench.pwsh.pwshPath).toBe(before)
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await boot({ pwshPath: '/opt/first/pwsh' })
    await bench.ctx.settings.update(SHELL_SETTINGS_NAMESPACE, { timeoutMs: 5_000, pwshPath: '/opt/second/pwsh' })
    expect(bench.pwsh.config.timeoutMs).toBe(5_000)
    expect(bench.pwsh.pwshPath).toBe('/opt/second/pwsh')

    await bench.settingsFiber.dispose()

    expect(bench.pwsh.config.timeoutMs).toBe(60_000)
    expect(bench.pwsh.pwshPath).toBe('/opt/first/pwsh')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the executor unloads', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('shell')

    await bench.executorFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('shell')
    await bench.ctx.fiber.dispose()
  })
})
