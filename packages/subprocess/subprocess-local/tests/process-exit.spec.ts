/**
 * 文件职责：验证 process-exit.spec.ts 覆盖的子进程管理行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子进程管理能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it, vi } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { createProcessInspector } from '../src/process-inspector.ts'
import type { ProcessIdentity, ProcessInspector } from '../src/process-inspector.ts'
import { taskkillProcessTree } from '../src/spawn.ts'

/** 中文说明：type ExitTrigger 定义本测试所需的数据或行为，用于表达子进程管理场景。 */
type ExitTrigger = 'direct' | 'uncaught-exception' | 'unhandled-rejection' | 'dispose'
/** 中文说明：type ManagedKind 定义本测试所需的数据或行为，用于表达子进程管理场景。 */
type ManagedKind = 'ordinary' | 'terminal'
/** 中文说明：interface TreeState 定义本测试所需的数据或行为，用于表达子进程管理场景。 */
interface TreeState { root: number; descendant: number }

/** 中文说明：变量 repoRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
/** 中文说明：变量 hostScript 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const hostScript = fileURLToPath(new URL('./fixtures/process-exit-host.ts', import.meta.url))
/** 中文说明：变量 scenarioTimeoutMs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const scenarioTimeoutMs = 30_000

/** 中文说明：函数 processExists 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

/** 中文说明：函数 readTree 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function readTree(path: string): Promise<TreeState> {
  return vi.waitFor(async () => {
    /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = await readFile(path, 'utf8')
    /** 中文说明：变量 state 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const state = JSON.parse(text) as Partial<TreeState>
    if (!Number.isSafeInteger(state.root) || !Number.isSafeInteger(state.descendant)
      || (state.root ?? 0) <= 0 || (state.descendant ?? 0) <= 0 || state.root === state.descendant) {
      throw new Error(`invalid managed-tree state: ${text}`)
    }
    return state as TreeState
  }, { interval: 10, timeout: scenarioTimeoutMs })
}

/** 中文说明：函数 captureIdentities 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function captureIdentities(inspector: ProcessInspector, state: TreeState): Promise<ProcessIdentity[]> {
  return vi.waitFor(() => {
    /** 中文说明：变量 expected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expected = new Set([state.root, state.descendant])
    /** 中文说明：函数值 identities 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const identities = inspector.processTree(state.root).filter(identity => expected.has(identity.pid))
    if (identities.length !== expected.size) throw new Error('managed tree is not fully observable yet')
    return identities
  }, { interval: 10, timeout: scenarioTimeoutMs })
}

/** 中文说明：函数 waitForGone 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitForGone(state: TreeState): Promise<void> {
  await Promise.all([state.root, state.descendant].map(pid => vi.waitFor(() => {
    if (processExists(pid)) throw new Error(`managed pid ${pid} is still alive`)
  }, { interval: 25, timeout: 10_000 })))
}

/** 中文说明：函数 cleanupTree 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function cleanupTree(state: TreeState | undefined, identities: ProcessIdentity[]): void {
  if (state === undefined) return
  if (process.platform === 'win32') {
    taskkillProcessTree(state.root)
    /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
    for (const pid of [state.descendant, state.root]) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch (_alreadyGone) {
        // The exact recorded process already exited.
      }
    }
    return
  }
  /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const inspector = createProcessInspector()
  /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
  for (const identity of identities) {
    try {
      inspector.signalProcess(identity, 'SIGKILL')
    } catch (_alreadyGone) {
      // Exact start identity prevents PID-reuse cleanup from reaching another process.
    }
  }
  if (identities.length === 0) {
    /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
    for (const pid of [state.descendant, state.root]) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch (_alreadyGone) {
        // The scenario failed before process identities became observable.
      }
    }
  }
}

/** 中文说明：函数 runScenario 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function runScenario(kind: ManagedKind, trigger: ExitTrigger) {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = await mkdtemp(join(tmpdir(), `dsh-subprocess-host-exit-${kind}-${trigger}-`))
  /** 中文说明：变量 launch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const launch = resolveExampleLaunch({
    srcBin: hostScript,
    mode: 'src',
    tsconfigPath: join(repoRoot, 'tsconfig.json'),
    configArgs: [kind, trigger, root],
  })
  /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const child = execa(launch.command, launch.args, {
    cwd: repoRoot,
    env: launch.env,
    stdin: 'ignore',
    reject: false,
    timeout: scenarioTimeoutMs,
  })
  /** 中文说明：变量 state 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let state: TreeState | undefined
  /** 中文说明：变量 identities 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let identities: ProcessIdentity[] = []
  /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let settled = false
  /** 中文说明：变量 treeGone 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let treeGone = false
  try {
    // The host validates tree.json before waiting for proceed, so observing it
    // is sufficient readiness; a second marker only adds a redundant Windows poll.
    state = await readTree(join(root, 'tree.json'))
    if (process.platform !== 'win32') identities = await captureIdentities(createProcessInspector(), state)
    await writeFile(join(root, 'proceed'), 'proceed')
    /** 中文说明：变量 outcome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcome = await child
    settled = true
    await waitForGone(state)
    treeGone = true
    /** 中文说明：变量 disposeCounts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeCounts = trigger === 'dispose'
      ? JSON.parse(await readFile(join(root, 'dispose.json'), 'utf8')) as {
        listenersBefore: number
        listenersAfterLoad: number
        listenersAfterDispose: number
      }
      : undefined
    return { outcome, disposeCounts }
  } finally {
    if (!settled) {
      child.kill('SIGKILL')
      await child.catch(() => {})
    }
    if (!treeGone) {
      cleanupTree(state, identities)
      if (state !== undefined) await waitForGone(state).catch(() => {})
    }
    await rm(root, { recursive: true, force: true })
  }
}

describe('synchronous cleanup on host exit', () => {
  it.each([
    { trigger: 'direct' as const, expectedCode: 23, diagnostic: undefined },
    { trigger: 'uncaught-exception' as const, expectedCode: 1, diagnostic: 'host-exit-uncaught-exception' },
    { trigger: 'unhandled-rejection' as const, expectedCode: 1, diagnostic: 'host-exit-unhandled-rejection' },
  ])('removes an ordinary managed tree after $trigger', { timeout: 45_000 }, async ({
    trigger,
    expectedCode,
    diagnostic,
  }) => {
    const { outcome } = await runScenario('ordinary', trigger)
    expect(outcome.exitCode).toBe(expectedCode)
    expect(outcome.signal).toBeUndefined()
    if (diagnostic !== undefined) expect(outcome.stderr).toContain(diagnostic)
  })

  it.skipIf(process.platform === 'win32')(
    'removes a terminal root and descendant after direct exit',
    { timeout: 45_000 },
    async () => {
      const { outcome } = await runScenario('terminal', 'direct')
      expect(outcome.exitCode).toBe(23)
      expect(outcome.signal).toBeUndefined()
    },
  )

  it('preserves normal terminate-and-join disposal and removes the exit listener', { timeout: 45_000 }, async () => {
    const { outcome, disposeCounts } = await runScenario('ordinary', 'dispose')
    expect(outcome.exitCode).toBe(0)
    expect(disposeCounts?.listenersAfterLoad).toBe((disposeCounts?.listenersBefore ?? 0) + 1)
    expect(disposeCounts?.listenersAfterDispose).toBe(disposeCounts?.listenersBefore)
  })
})
