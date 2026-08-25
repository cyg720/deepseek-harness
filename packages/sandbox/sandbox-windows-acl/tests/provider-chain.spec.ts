/**
 * The win32 chain's argv contract, denial dialect, and runner-failure rules,
 * exercised through the REAL LocalSandboxProvider.confine() with an injected
 * platform and runner argv prefix. Platform-independent assertions: they run
 * in every CI lane (Windows included, where sandbox-local's own POSIX-only
 * suites are excluded) — the end-to-end runner behavior lives in
 * runner.spec.ts on win32 hosts.
 */
/**
 * 文件职责：验证 provider-chain.spec.ts 覆盖的沙箱安全与权限隔离行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用沙箱安全与权限隔离时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */

import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'

/** 中文说明：常量 RO 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const RO: SandboxPolicy = { mode: 'read-only', workspaceRoot: '/ws' }
/** 中文说明：常量 WW 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const WW: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: '/ws' }

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(internals: LocalSandboxProvider['internals']) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = internals
  return sandbox
}

describe('windows-acl win32 chain (LocalSandboxProvider)', () => {
  it('agentless workspace-write: runner argv prefix, temp root, mode flag, partial enforcement, ACL denial dialect', async () => {
    /** 中文说明：函数值 probeWindowsAcl 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const probeWindowsAcl = vi.fn(() => true)
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = await setup({
      platform: 'win32',
      windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'],
      probeWindowsAcl,
    })
    /** 中文说明：变量 confined 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const confined = sandbox.confine(['pwsh', '/Command', 'x'], WW)
    expect(confined.argv).toEqual([
      'node', 'windows-acl-runner.js',
      '--workspace', '/ws',
      '--temp', tmpdir(),
      '--mode', 'workspace-write',
      '--',
      'pwsh', '/Command', 'x',
    ])
    expect(confined.enforcement).toBe('partial')
    expect(confined.denialSignatures).toEqual(['access is denied', 'access to the path', 'permission denied'])
    expect(confined.runnerFailureRules).toEqual([{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] }])
    // A sole candidate is selected unprobed.
    expect(probeWindowsAcl).not.toHaveBeenCalled()
  })

  it('read-only: same runner and contract, read-only mode flag', async () => {
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = await setup({ platform: 'win32', windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'] })
    /** 中文说明：变量 confined 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const confined = sandbox.confine(['true'], RO)
    expect(confined.argv.slice(-4)).toEqual(['--mode', 'read-only', '--', 'true'])
    expect(confined.enforcement).toBe('partial')
    expect(confined.runnerFailureRules).toEqual([{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] }])
  })
})
