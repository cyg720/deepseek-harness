/**
 * Tests for the sandbox-policy home: the deployment default (mode +
 * workspaceRoot) the service exposes, and the per-session `sandbox/mode`
 * override kit (fold + write path) every enforcing capability reads.
 */
/*
 * 文件职责：验证 policy.spec.ts 覆盖的沙箱策略、平台隔离与失败行为。
 * 技术维度：使用 TypeScript、Vitest、平台进程接口和受控文件系统资源。
 * 产品维度：保障 Agent 执行命令时遵循预期权限并给出可诊断失败。
 * 逻辑维度：准备策略和临时资源，启动受限操作，再核对结果、错误与清理。
 * 关键边界：平台能力可能缺失；安全失败必须显式；进程与临时资源必须完全释放。
 * 新手阅读建议：先读平台条件和夹具，再看允许/拒绝场景，最后阅读清理逻辑。
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SandboxPolicyService, { SANDBOX_MODES, effectiveSandboxMode, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import SystemPrompt, { renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'

/** 中文说明：函数 mounted 承担本测试的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mounted(config: { mode?: 'read-only' | 'workspace-write' | 'danger-full-access'; workspaceRoot?: string } = {}) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SandboxPolicyService, config)
  return ctx
}

/** 中文说明：函数 session 承担本测试的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function session(id: string, cwd?: string): Session {
  /** 中文说明：变量 sessionId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sessionId = SessionId(id)
  return Session.create(sessionId, undefined, {
    version: 0,
    id: sessionId,
    createdAt: 0,
    ...cwd === undefined ? {} : { cwd },
  })
}

/** 中文说明：函数 agentFor 承担本测试的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function agentFor(activeSession: Session): Agent {
  return { session: activeSession } as unknown as Agent
}

/** 中文说明：函数 policyContext 承担本测试的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function policyContext(ctx: Context, activeSession: Session): Promise<string | undefined> {
  return (await ctx.systemPrompt.assemble({ agent: agentFor(activeSession) }))
    .contexts.find(context => context.name === 'sandbox:policy')?.text
}

describe('SandboxPolicyService', () => {
  it('defaults to read-only under the process cwd', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mounted()
    expect(ctx.sandboxPolicy.defaultMode).toBe('read-only')
    expect(ctx.sandboxPolicy.workspaceRoot).toBe(resolve(process.cwd()))
  })

  it('carries a configured mode and resolves the workspace root absolute', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mounted({ mode: 'workspace-write', workspaceRoot: '/ws/../ws/./sub' })
    expect(ctx.sandboxPolicy.defaultMode).toBe('workspace-write')
    expect(ctx.sandboxPolicy.workspaceRoot).toBe(resolve('/ws/../ws/./sub'))
  })

  it('resolves the deployment policy for an agentless call', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mounted({ mode: 'workspace-write', workspaceRoot: '/fallback' })
    expect(ctx.sandboxPolicy.resolve()).toEqual({
      mode: 'workspace-write',
      workspaceRoot: resolve('/fallback'),
    })
  })

  it('resolves each session mode and cwd together without changing the fallback', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mounted({ mode: 'workspace-write', workspaceRoot: '/fallback' })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = session('sess-first', '/projects/first')
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = session('sess-second', '/projects/second')
    setSandboxMode(second, 'read-only')

    expect(ctx.sandboxPolicy.resolve({ session: first })).toEqual({
      mode: 'workspace-write',
      workspaceRoot: resolve('/projects/first'),
      sessionId: 'sess-first',
    })
    expect(ctx.sandboxPolicy.resolve({ session: second })).toEqual({
      mode: 'read-only',
      workspaceRoot: resolve('/projects/second'),
      sessionId: 'sess-second',
    })
    expect(ctx.sandboxPolicy.overrideOf(first)).toBeUndefined()
    expect(ctx.sandboxPolicy.overrideOf(second)).toBe('read-only')
    expect(ctx.sandboxPolicy.resolve()).toEqual({
      mode: 'workspace-write',
      workspaceRoot: resolve('/fallback'),
    })
  })

  it.skipIf(process.platform === 'win32')('resolves a symlink-sensitive session cwd with POSIX component semantics', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-policy-cwd-'))
    try {
      /** 中文说明：变量 lexical 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const lexical = join(root, 'lexical')
      /** 中文说明：变量 physical 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const physical = join(root, 'physical')
      /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const child = join(physical, 'child')
      mkdirSync(lexical)
      mkdirSync(child, { recursive: true })
      /** 中文说明：变量 link 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const link = join(lexical, 'link')
      symlinkSync(child, link, 'dir')
      /** 中文说明：变量 cwd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const cwd = `${link}${sep}..`
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = await mounted({ mode: 'workspace-write', workspaceRoot: '/fallback' })

      expect(ctx.sandboxPolicy.resolve({ session: session('sess-symlink-parent', cwd) })).toEqual({
        mode: 'workspace-write',
        workspaceRoot: realpathSync.native(physical),
        sessionId: 'sess-symlink-parent',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lets an approved mode outrank the session mode while retaining its root', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mounted({ workspaceRoot: '/fallback' })
    /** 中文说明：变量 active 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const active = session('sess-approved', '/projects/approved')
    setSandboxMode(active, 'read-only')
    expect(ctx.sandboxPolicy.resolve({ session: active, mode: 'danger-full-access' })).toEqual({
      mode: 'danger-full-access',
      workspaceRoot: resolve('/projects/approved'),
      sessionId: 'sess-approved',
    })
  })

  it('uses the configured root when a session has no cwd', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mounted({ workspaceRoot: '/fallback' })
    expect(ctx.sandboxPolicy.resolve({ session: session('sess-no-cwd') }).workspaceRoot).toBe(resolve('/fallback'))
  })

  it('rejects a mode outside the closed vocabulary at load', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    // schemastery rejects the union violation when the plugin loads.
    await expect(ctx.plugin(SandboxPolicyService, { mode: 'yolo' as never })).rejects.toThrow()
  })

  it('disposes the service and context contribution from a child fiber (HMR safety)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SandboxPolicyService, {})
    expect(ctx.sandboxPolicy).toBeDefined()
    expect(await policyContext(ctx, session('sess-hmr'))).toContain('read-only')
    await fiber.dispose()
    expect(ctx.get('sandboxPolicy')).toBeUndefined()
    expect((await ctx.systemPrompt.assemble()).contexts.find(context => context.name === 'sandbox:policy')).toBeUndefined()
  })
})

describe('sandbox:policy request context', () => {
  /** 中文说明：函数 promptMounted 承担本测试的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
  async function promptMounted(config: { mode?: 'read-only' | 'workspace-write' | 'danger-full-access'; workspaceRoot?: string } = {}): Promise<Context> {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SandboxPolicyService, config)
    return ctx
  }

  it.each(['read-only', 'workspace-write', 'danger-full-access'] as const)('renders the exact %s policy without a capability inventory', async (mode) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await promptMounted({ mode, workspaceRoot: '/fallback' })
    /** 中文说明：变量 workspaceRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workspaceRoot = resolve('/projects/current')
    /** 中文说明：变量 expected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expected = {
      'read-only': 'Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.',
      'workspace-write': `Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(workspaceRoot)}. Some platform temporary areas may also be writable.`,
      'danger-full-access': 'Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.',
    } as const

    expect(await policyContext(ctx, session(`sess-${mode}`, '/projects/../projects/current'))).toBe(expected[mode])
  })

  it('keeps the complete rendered prompt byte-stable across TMPDIR changes', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await promptMounted({ mode: 'workspace-write' })
    /** 中文说明：变量 active 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const active = session('sess-tmpdir-stability', '/projects/current')
    /** 中文说明：变量 previous 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const previous = process.env.TMPDIR
    try {
      process.env.TMPDIR = '/tmp/first-host-temp'
      /** 中文说明：变量 firstAssembly 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const firstAssembly = await ctx.systemPrompt.assemble({ agent: agentFor(active) })
      /** 中文说明：变量 firstPrompt 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const firstPrompt = renderPrompt(firstAssembly)
      /** 中文说明：变量 firstContext 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const firstContext = renderContextSnapshot(firstAssembly)
      process.env.TMPDIR = '/tmp/second-host-temp'
      /** 中文说明：变量 secondAssembly 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const secondAssembly = await ctx.systemPrompt.assemble({ agent: agentFor(active) })
      expect(renderPrompt(secondAssembly)).toBe(firstPrompt)
      expect(renderContextSnapshot(secondAssembly)).toBe(firstContext)
      expect(firstContext).not.toContain('host-temp')
    } finally {
      if (previous === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = previous
    }
  })

  it('reflects the latest durable switch on the next assembly and stays byte-stable otherwise', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await promptMounted()
    /** 中文说明：变量 active 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const active = session('sess-switch', '/projects/current')
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = await policyContext(ctx, active)
    expect(await policyContext(ctx, active)).toBe(first)

    setSandboxMode(active, 'danger-full-access')
    /** 中文说明：变量 danger 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const danger = await policyContext(ctx, active)
    expect(danger).toBe('Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.')
    expect(await policyContext(ctx, active)).toBe(danger)

    setSandboxMode(active, 'workspace-write')
    expect(await policyContext(ctx, active)).toBe(`Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(resolve('/projects/current'))}. Some platform temporary areas may also be writable.`)
  })

  it('reconstructs resumed policy from the session log and omits diagnostics without an agent', async () => {
    /** 中文说明：变量 active 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const active = session('sess-resume', '/projects/current')
    setSandboxMode(active, 'workspace-write')
    /** 中文说明：变量 resumed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resumed = Session.create(active.id, active.events, active.header)
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await promptMounted({ mode: 'read-only' })

    expect(await policyContext(ctx, resumed)).toContain('workspace-write')
    expect((await ctx.systemPrompt.assemble()).contexts.find(context => context.name === 'sandbox:policy')?.text).toBe('')
  })
})

describe('the sandbox/mode session kit', () => {
  it('SANDBOX_MODES lists every mode for advertisement and validation', () => {
    expect(SANDBOX_MODES).toEqual(['read-only', 'workspace-write', 'danger-full-access'])
  })

  it('effectiveSandboxMode folds to the last switch, or undefined without one', () => {
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('sess-fold'))
    expect(effectiveSandboxMode(session.events)).toBeUndefined()
    setSandboxMode(session, 'workspace-write')
    setSandboxMode(session, 'read-only')
    expect(effectiveSandboxMode(session.events)).toBe('read-only')
  })

  it('setSandboxMode appends exactly one sandbox/mode event per switch', () => {
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('sess-write'))
    setSandboxMode(session, 'danger-full-access')
    /** 中文说明：函数值 modeEvents 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const modeEvents = session.events.filter(e => e.type === 'sandbox/mode')
    expect(modeEvents).toHaveLength(1)
    expect(modeEvents[0]?.data).toEqual({ mode: 'danger-full-access' })
  })
})
