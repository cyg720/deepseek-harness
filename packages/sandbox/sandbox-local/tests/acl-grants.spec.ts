/**
 * windows-acl grant ownership through the real LocalSandboxProvider: one
 * standing capability per workspace plus one random, distinct, revocable
 * temp capability per live session/workspace pair. The Win32 grant surface
 * is mocked; native access checks live in sandbox-windows-acl's runner suite.
 */
/**
 * 文件职责：验证 acl-grants.spec.ts 覆盖的沙箱策略与本地隔离行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障沙箱策略与本地隔离在真实使用路径中稳定且可诊断。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、错误和清理。
 * 关键边界：平台能力可能不同；安全失败必须显式；异步资源必须等待完全停止。
 * 新手阅读建议：先读辅助函数，再看正常路径，最后阅读平台差异与失败用例。
 */

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'

/** Cross-file state shared with the vi.mock factory (hoisting contract). */
/** 中文说明：函数值 mockState 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const mockState = vi.hoisted(() => ({
  grants: [] as Array<{ writeSid: string; added: Array<{ path: string; standing: boolean }>; disposed: boolean }>,
  addFailure: undefined as Error | undefined,
  /** Restrict an add failure to standing (workspace) or revocable (temp). */
  addFailureStanding: undefined as boolean | undefined,
  createTempFailure: undefined as Error | undefined,
  disposeFailure: undefined as Error | undefined,
}))

vi.mock('@deepseek-ai/dsh-sandbox-windows-acl', () => {
  /** 中文说明：class MockAclWriteGrant 定义本测试所需的数据或行为，用于表达沙箱策略与本地隔离场景。 */
  class MockAclWriteGrant {
    readonly writeSid: string
    readonly added: Array<{ path: string; standing: boolean }> = []
    disposed = false
    constructor(writeSid: string) {
      this.writeSid = writeSid
      mockState.grants.push(this)
    }
    static create(writeSid: string): MockAclWriteGrant {
      if (writeSid.startsWith('TEMP:') && mockState.createTempFailure !== undefined) throw mockState.createTempFailure
      return new MockAclWriteGrant(writeSid)
    }
    add(path: string, standing = false): void {
      this.added.push({ path, standing })
      if (mockState.addFailure !== undefined
        && (mockState.addFailureStanding === undefined || mockState.addFailureStanding === standing)) {
        throw mockState.addFailure
      }
    }
    dispose(): void {
      if (mockState.disposeFailure !== undefined) throw mockState.disposeFailure
      this.disposed = true
    }
  }
  return {
    AclWriteGrant: MockAclWriteGrant,
    assertTempRootOutsideWorkspace: (workspaceRoot: string, tempRoot: string) => {
      /** 中文说明：变量 workspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const workspace = realpathSync.native(workspaceRoot)
      /** 中文说明：变量 temp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const temp = realpathSync.native(tempRoot)
      if (temp === workspace || temp.startsWith(`${workspace}${process.platform === 'win32' ? '\\' : '/'}`)) {
        throw new Error(`Windows ACL temp root must be outside the workspace: workspace=${workspaceRoot}; temp=${tempRoot}`)
      }
    },
    workspaceWriteSid: () => 'S-1-4-42-42',
    tempWriteSid: (path: string) => `TEMP:${path}`,
  }
})

/** 中文说明：常量 WORKSPACE_SID 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const WORKSPACE_SID = 'S-1-4-42-42'

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup() {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(LocalSandboxProvider, {})
  /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = { platform: 'win32', windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'] }
  return { ctx, sandbox, fiber }
}

/** 中文说明：函数 workspaceRoot 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function workspaceRoot(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-acl-grants-ws-'))
}

/** 中文说明：函数 flag 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function flag(argv: readonly string[], name: string): string | undefined {
  /** 中文说明：变量 index 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const index = argv.indexOf(name)
  return index < 0 ? undefined : argv[index + 1]
}

describe('windows-acl write grants (LocalSandboxProvider)', () => {
  /** 中文说明：变量 scratch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const scratch: string[] = []

  beforeEach(() => {
    mockState.grants = []
    mockState.addFailure = undefined
    mockState.addFailureStanding = undefined
    mockState.createTempFailure = undefined
    mockState.disposeFailure = undefined
  })

  /** 中文说明：函数值 cleanup 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const cleanup = () => {
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const grant of mockState.grants) {
      /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
      for (const added of grant.added) {
        if (!added.standing) rmSync(added.path, { recursive: true, force: true })
      }
    }
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  }

  it('workspace-write materializes one standing workspace grant and one private temp capability, then reuses both', async () => {
    try {
      const { sandbox, fiber } = await setup()
      /** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ws = workspaceRoot()
      scratch.push(ws)
      /** 中文说明：变量 policy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('sess-1') }

      /** 中文说明：变量 confined 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const confined = sandbox.confine(['pwsh', '/Command', 'x'], policy)
      /** 中文说明：变量 tempDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const tempDir = flag(confined.argv, '--temp')
      /** 中文说明：变量 tempSid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const tempSid = flag(confined.argv, '--temp-write-sid')
      expect(tempDir).toBeDefined()
      expect(basename(tempDir ?? '')).toMatch(/^dsh-[A-Za-z0-9_-]{6}$/u)
      expect(tempSid).toBe(`TEMP:${tempDir}`)
      expect(tempSid).not.toBe(WORKSPACE_SID)
      expect(confined.argv).toEqual([
        'node', 'windows-acl-runner.js',
        '--workspace', ws,
        '--temp', tempDir,
        '--mode', 'workspace-write',
        '--write-sid', WORKSPACE_SID,
        '--temp-write-sid', tempSid,
        '--',
        'pwsh', '/Command', 'x',
      ])
      expect(mockState.grants).toEqual([
        expect.objectContaining({ writeSid: WORKSPACE_SID, added: [{ path: ws, standing: true }], disposed: false }),
        expect.objectContaining({ writeSid: tempSid, added: [{ path: tempDir, standing: false }], disposed: false }),
      ])
      expect(existsSync(tempDir ?? '')).toBe(true)

      expect(sandbox.confine(['pwsh', '/Command', 'x'], policy).argv).toEqual(confined.argv)
      expect(mockState.grants).toHaveLength(2)

      await fiber.dispose()
      expect(mockState.grants.every(grant => grant.disposed)).toBe(true)
      expect(existsSync(tempDir ?? '')).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('read-only materializes no capability; upgrade creates them and downgrade leaves them reusable', async () => {
    try {
      const { sandbox, fiber } = await setup()
      /** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ws = workspaceRoot()
      scratch.push(ws)
      /** 中文说明：变量 readOnly 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const readOnly: SandboxPolicy = { mode: 'read-only', workspaceRoot: ws, sessionId: SessionId('switch') }
      /** 中文说明：变量 workspaceWrite 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const workspaceWrite: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('switch') }

      expect(sandbox.confine(['true'], readOnly).argv).toEqual([
        'node', 'windows-acl-runner.js',
        '--workspace', ws,
        '--temp', tmpdir(),
        '--mode', 'read-only',
        '--',
        'true',
      ])
      expect(mockState.grants).toHaveLength(0)

      /** 中文说明：变量 upgraded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const upgraded = sandbox.confine(['true'], workspaceWrite)
      expect(flag(upgraded.argv, '--temp-write-sid')).not.toBe(WORKSPACE_SID)
      expect(mockState.grants).toHaveLength(2)
      sandbox.confine(['true'], readOnly)
      expect(mockState.grants).toHaveLength(2)
      expect(mockState.grants.every(grant => !grant.disposed)).toBe(true)
      expect(sandbox.confine(['true'], workspaceWrite).argv).toEqual(upgraded.argv)

      await fiber.dispose()
    } finally {
      cleanup()
    }
  })

  it('a fresh provider gives a resumed session a new temp path and SID, so crash residue cannot collide', async () => {
    try {
      /** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ws = workspaceRoot()
      scratch.push(ws)
      /** 中文说明：变量 policy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('resumed') }
      /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const first = await setup()
      /** 中文说明：变量 firstConfined 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const firstConfined = first.sandbox.confine(['true'], policy)
      /** 中文说明：变量 firstTemp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const firstTemp = flag(firstConfined.argv, '--temp') ?? ''

      // The first provider remains live: model an unclean prior process whose
      // temp directory and ACE survived. A new provider must still proceed.
      /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const second = await setup()
      /** 中文说明：变量 secondConfined 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const secondConfined = second.sandbox.confine(['true'], policy)
      /** 中文说明：变量 secondTemp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const secondTemp = flag(secondConfined.argv, '--temp') ?? ''
      expect(secondTemp).not.toBe(firstTemp)
      expect(flag(secondConfined.argv, '--temp-write-sid')).not.toBe(flag(firstConfined.argv, '--temp-write-sid'))
      expect(existsSync(firstTemp)).toBe(true)
      expect(existsSync(secondTemp)).toBe(true)

      await second.fiber.dispose()
      await first.fiber.dispose()
    } finally {
      cleanup()
    }
  })

  it('forks and workspace changes receive distinct temp capabilities while each workspace grant is reused', async () => {
    try {
      const { sandbox, fiber } = await setup()
      /** 中文说明：变量 wsA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const wsA = workspaceRoot()
      /** 中文说明：变量 wsB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const wsB = workspaceRoot()
      scratch.push(wsA, wsB)
      /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const parent = sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: wsA, sessionId: SessionId('parent') })
      /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const child = sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: wsA, sessionId: SessionId('child') })
      /** 中文说明：变量 moved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const moved = sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: wsB, sessionId: SessionId('parent') })

      expect(flag(child.argv, '--temp')).not.toBe(flag(parent.argv, '--temp'))
      expect(flag(child.argv, '--temp-write-sid')).not.toBe(flag(parent.argv, '--temp-write-sid'))
      expect(flag(moved.argv, '--temp')).not.toBe(flag(parent.argv, '--temp'))
      expect(mockState.grants).toHaveLength(5) // workspace A + two temps + workspace B + one temp

      await fiber.dispose()
    } finally {
      cleanup()
    }
  })

  it('workspace grant failure disposes its SID, aggregates cleanup failure, and never creates a temp directory', async () => {
    try {
      const { sandbox } = await setup()
      /** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ws = workspaceRoot()
      scratch.push(ws)
      mockState.addFailureStanding = true
      mockState.addFailure = new Error('workspace grant exploded')
      expect(() => sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('workspace-fail'),
      })).toThrow('workspace grant exploded')
      expect(mockState.grants).toHaveLength(1)
      expect(mockState.grants[0]!.disposed).toBe(true)

      mockState.disposeFailure = new Error('workspace cleanup exploded')
      expect(() => sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('workspace-cleanup-fail'),
      })).toThrow(/workspace grant failed and its cleanup also failed/u)
      expect(mockState.grants).toHaveLength(2)
    } finally {
      cleanup()
    }
  })

  it('rejects a workspace containing the ambient temp root before any ACL mutation', async () => {
    const { sandbox } = await setup()
    expect(() => sandbox.confine(['true'], {
      mode: 'workspace-write', workspaceRoot: realpathSync.native(tmpdir()), sessionId: SessionId('overlap'),
    })).toThrow(/temp root must be outside the workspace/u)
    expect(mockState.grants).toHaveLength(0)
  })

  it('temp grant creation/add failures remove the random directory; cleanup failures aggregate', async () => {
    try {
      const { sandbox } = await setup()
      /** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ws = workspaceRoot()
      scratch.push(ws)

      mockState.createTempFailure = new Error('temp SID creation exploded')
      expect(() => sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('create-fail'),
      })).toThrow('temp SID creation exploded')
      expect(mockState.grants).toHaveLength(1) // workspace only; random temp was removed

      mockState.createTempFailure = undefined
      mockState.addFailureStanding = false
      mockState.addFailure = new Error('temp add exploded')
      expect(() => sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('add-fail'),
      })).toThrow('temp add exploded')
      /** 中文说明：变量 failedTempGrant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const failedTempGrant = mockState.grants.at(-1)
      expect(failedTempGrant?.disposed).toBe(true)
      expect(failedTempGrant?.added).toHaveLength(1)
      expect(existsSync(failedTempGrant?.added[0]?.path ?? '')).toBe(false)

      mockState.addFailureStanding = false
      mockState.addFailure = new Error('temp add exploded')
      sandbox.internals.rmTempDir = () => { throw new Error('temp rm exploded') }
      expect(() => sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('rm-fail'),
      })).toThrow(/temp grant materialization failed and its cleanup also failed/u)
      delete sandbox.internals.rmTempDir

      mockState.addFailureStanding = false
      mockState.addFailure = new Error('temp add exploded')
      mockState.disposeFailure = new Error('temp cleanup exploded')
      expect(() => sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('aggregate-fail'),
      })).toThrow(/temp grant materialization failed and its cleanup also failed/u)
    } finally {
      cleanup()
    }
  })

  it('agentless calls pass a temp root and no capabilities; the runner owns the private child lifecycle', async () => {
    try {
      const { sandbox, fiber } = await setup()
      /** 中文说明：变量 confined 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const confined = sandbox.confine(['pwsh', '/Command', 'x'], { mode: 'workspace-write', workspaceRoot: '/ws' })
      expect(confined.argv).toEqual([
        'node', 'windows-acl-runner.js',
        '--workspace', '/ws',
        '--temp', tmpdir(),
        '--mode', 'workspace-write',
        '--',
        'pwsh', '/Command', 'x',
      ])
      expect(mockState.grants).toHaveLength(0)
      await fiber.dispose()
    } finally {
      cleanup()
    }
  })

  it('provider teardown reports grant and directory cleanup failures without aborting teardown', async () => {
    try {
      const { ctx, sandbox, fiber } = await setup()
      /** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ws = workspaceRoot()
      scratch.push(ws)
      /** 中文说明：变量 confined 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const confined = sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('dispose'),
      })
      /** 中文说明：变量 tempDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const tempDir = flag(confined.argv, '--temp') ?? ''
      mockState.disposeFailure = new Error('revoke exploded')
      sandbox.internals.rmTempDir = () => { throw new Error('rm exploded') }
      /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)

      await fiber.dispose()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('cleanup completed with 3 failure(s)'))
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ message: 'revoke exploded' }))
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ message: 'rm exploded' }))
      expect(existsSync(tempDir)).toBe(true) // injected removal failed; test cleanup reclaims it
    } finally {
      cleanup()
    }
  })
})
