/**
 * 文件职责：验证 local.spec.ts 覆盖的终端会话行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的终端会话能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import type { TerminalSendOperation } from '@deepseek-ai/dsh-terminal'
import SandboxProvider from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local/src/resolve.ts'
import * as ptyLocal from '@deepseek-ai/dsh-terminal-bash'

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []

afterEach(async () => {
  /** 中文说明：该循环依次处理输入或事件；循环变量仅在当前循环中有效。 */
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  /** 中文说明：该循环依次处理输入或事件；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：class PassthroughSandbox 定义本测试所需的数据或行为，用于表达终端会话场景。 */
class PassthroughSandbox extends SandboxProvider {
  calls: { argv: readonly string[]; policy: SandboxPolicy }[] = []

  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    this.calls.push({ argv, policy })
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

/** 中文说明：函数 stubAgent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function stubAgent(ctx: Context, rawId: string): Agent {
  /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const id = SessionId(rawId)
  /** 中文说明：函数值 scope 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const scope = ctx.plugin(() => {})
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = Session.create(id)
  return {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(
  mode: 'danger-full-access' | 'workspace-write',
  timing: { idleSilenceMs?: number; handoffGraceMs?: number; timeoutMs?: number } = {},
  dialect: 'bash' | 'pwsh' = 'bash',
) {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-pty-local-'))
  roots.push(root)
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TerminalSessionService)
  await ctx.plugin(PassthroughSandbox)
  await ctx.plugin(SandboxPolicyService, { mode, workspaceRoot: root })
  await ctx.plugin(LocalSubprocessRuntime)
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(ptyLocal, {
    shellDialect: dialect,
    pollIntervalMs: 10,
    exactProbeAfterMs: 20,
    idleSilenceMs: timing.idleSilenceMs ?? 250,
    handoffGraceMs: timing.handoffGraceMs ?? 250,
    timeoutMs: timing.timeoutMs ?? 2_000,
    disposeGraceMs: 500,
    scrollbackLines: 100,
    scrollbackMaxBytes: 32_768,
    maxReadBytes: 16_384,
  })
  /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const agent = stubAgent(ctx, `agent-${mode}`)
  ctx.agents.register(agent)
  return { ctx, root, agent, fiber, sandbox: ctx.sandbox as PassthroughSandbox }
}

// TerminalSendOperation.append drops output once the operation settles, so this only
// observes a marker the child prints while `operation` is still active. A caller
// whose child is slow to print must raise the harness `timing` bounds too;
// extending this deadline alone cannot recover output the operation never collected.
/** 中文说明：函数 waitForOutput 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitForOutput(operation: TerminalSendOperation, expected: string, timeoutMs = 2_000): Promise<void> {
  /** 中文说明：变量 deadline 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const deadline = Date.now() + timeoutMs
  /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let output = ''
  while (!output.includes(expected) && Date.now() < deadline) {
    output += operation.readOutput().delta
    if (!output.includes(expected)) await new Promise(resolve => setTimeout(resolve, 10))
  }
  expect(output).toContain(expected)
}

// A send the test interrupts settles when bash returns to its prompt, so the
// kernel may publish the foreground handoff on either side of the silence
// bound. `handoffGraceMs` widens the window that wins the exact attribution but
// cannot remove the race on a loaded host, so these settles assert that the
// session became usable again, not which readiness tier observed it.
/** 中文说明：函数 expectReadyForNextSend 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function expectReadyForNextSend(waitReason: string): void {
  expect(['stdin_read', 'inferred_idle']).toContain(waitReason)
}

/** 中文说明：函数 processIsRunning 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (_missingProcess) {
    return false
  }
  if (process.platform !== 'linux') return true
  try {
    /** 中文说明：变量 stat 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    /** 中文说明：变量 state 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const state = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/, 1)[0]
    return !/^[ZXx]$/.test(state ?? '')
  } catch (_unreadableProcEntry) {
    return false
  }
}

// The real-shell suite drives a POSIX bash over the actual node-pty terminal;
// Windows has no bash, and its pwsh counterpart lives in the describe below.
describe.skipIf(process.platform === 'win32')('terminal-bash real shell', () => {
  it('persists cwd and environment across sends, scrubs secrets, and closes', async () => {
    /** 中文说明：变量 previous 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const previous = process.env.DSH_TEST_SECRET
    process.env.DSH_TEST_SECRET = 'must-not-leak'
    try {
      const { ctx, root, agent } = await harness('danger-full-access')
      /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const created = await ctx.terminals.spawn(agent, { type: 'shell', name: 'main', cwd: root })
      expect(created.motd).toContain('dsh> ')

      /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const first = ctx.terminals.startSend(agent, created.sessionId, { text: 'export KEEP=ok; cd /', submit: true })
      expect((await first.done).waitReason).toBe('stdin_read')
      /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const second = ctx.terminals.startSend(agent, created.sessionId, { text: 'printf "cwd=%s keep=%s secret=%s\\n" "$PWD" "$KEEP" "${DSH_TEST_SECRET-unset}"', submit: true })
      expect((await second.done).viewport).toContain('cwd=/ keep=ok secret=unset')

      expect(ctx.terminals.read(agent, created.sessionId, { offset: 0, count: 20 }).text).toContain('cwd=/ keep=ok secret=unset')
      expect(await ctx.terminals.kill(agent, created.sessionId)).toBe(true)
      expect(ctx.terminals.list(agent)).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.DSH_TEST_SECRET
      else process.env.DSH_TEST_SECRET = previous
    }
  }, 10_000)

  it('restores the controlled prompt after an in-shell PS1 override', async () => {
    // The silence tier is pushed beyond every assertion below, so each settle
    // proves prompt-based readiness survives the override rather than the
    // inferred_idle fallback absorbing a broken prompt.
    const { ctx, agent } = await harness('danger-full-access', {
      idleSilenceMs: 5_000,
      timeoutMs: 8_000,
    })
    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ctx.terminals.spawn(agent, { type: 'shell' })

    /** 中文说明：变量 override 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const override = ctx.terminals.startSend(agent, created.sessionId, { text: 'PS1=broken-prompt', submit: true })
    expect((await override.done).waitReason).toBe('stdin_read')

    /** 中文说明：变量 after 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const after = ctx.terminals.startSend(agent, created.sessionId, { text: 'printf "healed=[%s]\\n" "$PS1"', submit: true })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await after.done
    expect(result.waitReason).toBe('stdin_read')
    expect(result.viewport).toContain('healed=[dsh> ]')
    await ctx.terminals.kill(agent, created.sessionId)
  }, 20_000)

  it('wraps the exact shell argv under confined policy and unregisters on reload', async () => {
    const { ctx, root, agent, fiber, sandbox } = await harness('workspace-write')
    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ctx.terminals.spawn(agent, { type: 'shell' })
    expect(sandbox.calls).toEqual([{
      argv: ['/bin/bash', '--noprofile', '--norc', '-i'],
      policy: { mode: 'workspace-write', workspaceRoot: realpathSync.native(root), sessionId: 'agent-workspace-write' },
    }])
    await fiber.dispose()
    expect(ctx.terminals.listBackends()).toEqual([])
    expect(ctx.terminals.list(agent)).toHaveLength(1)
    await ctx.terminals.kill(agent, created.sessionId)
  }, 10_000)

  it('signals a foreground command and kills a TERM-ignoring background descendant', async () => {
    const { ctx, agent } = await harness('danger-full-access')
    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ctx.terminals.spawn(agent, { type: 'shell' })

    /** 中文说明：变量 foreground 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreground = ctx.terminals.startSend(agent, created.sessionId, { text: 'sleep 60', submit: true })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect((await ctx.terminals.signal(agent, created.sessionId, 'SIGINT')).delivered).toBe(true)
    expectReadyForNextSend((await foreground.done).waitReason)

    /** 中文说明：变量 background 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const background = ctx.terminals.startSend(agent, created.sessionId, {
      text: 'sh -c \'trap "" TERM; sleep 60\' & echo CHILD=$!',
      submit: true,
    })
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = (await background.done).viewport
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = /CHILD=(\d+)/.exec(output)?.[1]
    expect(child).toBeDefined()
    /** 中文说明：变量 pid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pid = Number(child)
    expect(() => process.kill(pid, 0)).not.toThrow()
    await ctx.terminals.kill(agent, created.sessionId)
    expect(() => process.kill(pid, 0)).toThrow()
  }, 10_000)

  it('quiesces a disowned same-session descendant after the shell exits naturally', async () => {
    const { ctx, root, agent } = await harness('danger-full-access')
    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ctx.terminals.spawn(agent, { type: 'shell' })
    /** 中文说明：变量 pidFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pidFile = join(root, 'disowned.pid')
    /** 中文说明：变量 pid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let pid: number | undefined
    try {
      /** 中文说明：变量 background 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const background = ctx.terminals.startSend(agent, created.sessionId, {
        text: `sh -c 'trap "" TERM; printf "%s" "$$" > "$1"; sleep 60' dsh "${pidFile}" & disown`,
        submit: true,
      })
      await background.done
      /** 中文说明：变量 pidDeadline 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const pidDeadline = Date.now() + 2_000
      /** 中文说明：变量 childPid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let childPid = 0
      while (childPid === 0 && Date.now() < pidDeadline) {
        if (existsSync(pidFile)) childPid = Number(readFileSync(pidFile, 'utf8'))
        if (childPid > 0) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(existsSync(pidFile), ctx.terminals.read(agent, created.sessionId, { offset: 0, count: 100 }).text).toBe(true)
      expect(childPid).toBeGreaterThan(0)
      pid = childPid
      expect(() => process.kill(childPid, 0)).not.toThrow()
      await ctx.terminals.startSend(agent, created.sessionId, { text: 'exit', submit: true }).done
      /** 中文说明：变量 deadline 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const deadline = Date.now() + 2_000
      while (ctx.terminals.list(agent)[0]?.status.kind !== 'exited' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(ctx.terminals.list(agent)[0]?.status.kind).toBe('exited')
      await ctx.terminals.kill(agent, created.sessionId)
      expect(processIsRunning(childPid)).toBe(false)
    } finally {
      if (pid !== undefined) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch (_alreadyReaped) {
          // Product cleanup is the expected path; this only contains a failed regression.
        }
      }
    }
  }, 10_000)

  it('cancels a slow-starting raw-mode foreground process with a real SIGINT', async () => {
    const { ctx, agent } = await harness('danger-full-access', {
      idleSilenceMs: 10_000,
      timeoutMs: 15_000,
    })
    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ctx.terminals.spawn(agent, { type: 'shell' })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 ready 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ready = 'RAW_READY'
    // Delay readiness beyond the shared harness's short send bound so this
    // process test owns enough slack for loaded macOS startup and shell echo.
    // The interactive shell echoes the command, so only child output may contain the readiness marker.
    /** 中文说明：变量 command 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const command = 'python3 -c \'import signal,sys,termios,time; signal.signal(signal.SIGINT, lambda *_: (print("SIGINT_SEEN", flush=True), sys.exit(0))); attrs=termios.tcgetattr(0); attrs[3] &= ~termios.ISIG; termios.tcsetattr(0, termios.TCSANOW, attrs); time.sleep(2.1); print("RAW_" + "READY", flush=True); time.sleep(60)\''
    expect(command).not.toContain(ready)
    /** 中文说明：变量 foreground 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreground = ctx.terminals.startSend(agent, created.sessionId, {
      text: command,
      submit: true,
      signal: controller.signal,
    })
    await waitForOutput(foreground, ready, 15_000)
    controller.abort()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await foreground.done
    expectReadyForNextSend(result.waitReason)
    /** 中文说明：变量 afterReady 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const afterReady = 'AFTER_SIGINT'
    /** 中文说明：变量 afterCommand 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const afterCommand = 'printf "AFTER_%s\\n" SIGINT'
    expect(afterCommand).not.toContain(afterReady)
    /** 中文说明：变量 after 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const after = ctx.terminals.startSend(agent, created.sessionId, {
      text: afterCommand,
      submit: true,
    })
    await waitForOutput(after, afterReady, 15_000)
    expectReadyForNextSend((await after.done).waitReason)
    await ctx.terminals.kill(agent, created.sessionId)
  }, 35_000)
})

/** 中文说明：变量 hasPwsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const hasPwsh = spawnSync(
  resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'],
  { encoding: 'utf8' },
).status === 0

describe.skipIf(!hasPwsh)('terminal-bash pwsh real shell', () => {
  it('bootstraps a persistent pwsh, persists state, and scrubs secrets', async () => {
    /** 中文说明：变量 previous 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const previous = process.env.DSH_TEST_SECRET
    process.env.DSH_TEST_SECRET = 'must-not-leak'
    try {
      const { ctx, root, agent } = await harness('danger-full-access', {
        idleSilenceMs: 300,
        handoffGraceMs: 300,
        timeoutMs: 8_000,
      }, 'pwsh')
      /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const created = await ctx.terminals.spawn(agent, { type: 'shell', name: 'main', cwd: root })
      expect(created.motd).toContain('dsh> ')

      /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const first = ctx.terminals.startSend(agent, created.sessionId, {
        text: '$env:KEEP = "ok"; Set-Location /',
        submit: true,
      })
      expect((await first.done).waitReason).toBe('stdin_read')
      /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const second = ctx.terminals.startSend(agent, created.sessionId, {
        text: 'Write-Output "keep=$env:KEEP secret=$env:DSH_TEST_SECRET"',
        submit: true,
      })
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await second.done
      expect(result.viewport).toContain('keep=ok')
      expect(result.viewport).toContain('secret=')
      expect(result.viewport).not.toContain('must-not-leak')

      expect(ctx.terminals.read(agent, created.sessionId, { offset: 0, count: 40 }).text).toContain('keep=ok')
      expect(await ctx.terminals.kill(agent, created.sessionId)).toBe(true)
      expect(ctx.terminals.list(agent)).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.DSH_TEST_SECRET
      else process.env.DSH_TEST_SECRET = previous
    }
  }, 30_000)

  it('pins UTF-8 output encoding so non-ASCII output survives the byte decode', async () => {
    const { ctx, root, agent } = await harness('danger-full-access', {
      idleSilenceMs: 300,
      handoffGraceMs: 300,
      timeoutMs: 8_000,
    }, 'pwsh')
    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ctx.terminals.spawn(agent, { type: 'shell', name: 'main', cwd: root })
    // The bootstrap itself must have pinned both encodings: the session byte
    // decode is UTF-8, so an un-pinned console writing its host code page
    // garbles every non-ASCII byte that follows.
    /** 中文说明：变量 pinned 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pinned = ctx.terminals.startSend(agent, created.sessionId, {
      text: '"console=" + [Console]::OutputEncoding.WebName + " out=" + $OutputEncoding.WebName',
      submit: true,
    })
    /** 中文说明：变量 pinnedResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pinnedResult = await pinned.done
    expect(pinnedResult.viewport).toContain('console=utf-8 out=utf-8')
    // Char codes keep the submitted line ASCII-only, so the assertion is a
    // pure output-decode check.
    /** 中文说明：变量 sent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sent = ctx.terminals.startSend(agent, created.sessionId, {
      text: "[Console]::Write([char]0x4E2D + [char]0x6587 + ' encoding-ok')",
      submit: true,
    })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await sent.done
    expect(result.viewport).toContain('中文 encoding-ok')
    await ctx.terminals.kill(agent, created.sessionId)
  }, 30_000)
})
