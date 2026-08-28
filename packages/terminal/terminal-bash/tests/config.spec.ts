/**
 * 文件职责：验证 config.spec.ts 覆盖的持久终端行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的持久终端能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { describe, expect, it } from 'vitest'
import type { Config } from '@deepseek-ai/dsh-terminal-bash/src/config.ts'
import { resolveConfig, validateConfig } from '@deepseek-ai/dsh-terminal-bash/src/config.ts'

/** 中文说明：函数 config 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function config(overrides: Partial<Config> = {}): Config {
  return {
    backendType: 'shell', shellDialect: 'bash', shellPath: '/bin/bash', shellArgs: [], rows: 40, cols: 160,
    scrollbackLines: 100, scrollbackMaxBytes: 1024, maxReadBytes: 512,
    pollIntervalMs: 10, exactProbeAfterMs: 20, idleSilenceMs: 100, handoffGraceMs: 50, timeoutMs: 1000,
    disposeGraceMs: 100,
    ...overrides,
  }
}

describe('terminal-bash config', () => {
  it('accepts resolved positive bounds', () => {
    expect(() => { validateConfig(config()) }).not.toThrow()
  })

  it('rejects empty names, invalid numbers, and a read cap above retention', () => {
    expect(() => { validateConfig(config({ backendType: '' })) }).toThrow('backendType')
    expect(() => { validateConfig(config({ shellPath: '' })) }).toThrow('shellPath')
    expect(() => { validateConfig(config({ rows: 0 })) }).toThrow('rows')
    expect(() => { validateConfig(config({ rows: 1.5 })) }).toThrow('rows')
    expect(() => { validateConfig(config({ maxReadBytes: 2048 })) }).toThrow('must not exceed')
  })

  it('rejects a handoff grace shorter than one readiness poll', () => {
    expect(() => { validateConfig(config({ handoffGraceMs: 9, pollIntervalMs: 10 })) }).toThrow('handoffGraceMs must be at least pollIntervalMs')
    expect(() => { validateConfig(config({ handoffGraceMs: 10, pollIntervalMs: 10 })) }).not.toThrow()
  })

})

describe('terminal-bash dialect resolution', () => {
  it('defaults bash argv to the interactive profile-free form', () => {
    const { shellPath, shellArgs, shellDialect } = resolveConfig({ backendType: 'shell', rows: 24, cols: 80 })
    expect(shellDialect).toBe('bash')
    expect(shellPath).toBe('/bin/bash')
    expect(shellArgs).toEqual(['--noprofile', '--norc', '-i'])
  })

  it('defaults pwsh argv to the interactive profile-free form and resolves the executable', () => {
    /** 中文说明：变量 resolved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = resolveConfig({ backendType: 'shell', shellDialect: 'pwsh', rows: 24, cols: 80 })
    expect(resolved.shellDialect).toBe('pwsh')
    expect(resolved.shellPath.length).toBeGreaterThan(0)
    expect(resolved.shellArgs).toEqual(['-NoLogo', '-NoProfile'])
  })

  it('lets an explicit shell specification win over the dialect defaults', () => {
    /** 中文说明：变量 resolved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = resolveConfig({
      backendType: 'shell', shellDialect: 'pwsh', shellPath: '/custom/pwsh', shellArgs: ['-NoProfile'], rows: 24, cols: 80,
    })
    expect(resolved.shellPath).toBe('/custom/pwsh')
    expect(resolved.shellArgs).toEqual(['-NoProfile'])
  })

  it('treats empty shell values as unset so Schemastery materialization cannot drop the dialect defaults', () => {
    // Schemastery materializes an absent optional array as `[]`; the resolver
    // must treat that shape like an unset value or a real bash spawn would
    // start non-interactive without the controlled prompt.
    /** 中文说明：变量 resolved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = resolveConfig({
      backendType: 'shell', shellDialect: 'bash', shellPath: '', shellArgs: [], rows: 24, cols: 80,
    })
    expect(resolved.shellPath).toBe('/bin/bash')
    expect(resolved.shellArgs).toEqual(['--noprofile', '--norc', '-i'])
  })

  it('validates the effective shell path, not only the raw one', () => {
    expect(() => { validateConfig(resolveConfig({ backendType: 'shell', shellDialect: 'bash', rows: 24, cols: 80 })) }).not.toThrow()
    expect(() => { validateConfig(resolveConfig({ backendType: 'shell', shellDialect: 'pwsh', rows: 24, cols: 80 })) }).not.toThrow()
  })
})
