/**
 * 文件职责：验证 service.spec.ts 覆盖的子进程管理行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子进程管理能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { scrubbedParentEnv, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutputRead,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

/**
 * Minimal concrete service: a hand-built handle. The seam is spawn-only —
 * defaulting, shell semantics, and deadlines belong to callers — so this stub
 * is all an implementation owes the abstract class.
 */
/** 中文说明：class StubSubprocessRuntime 定义本测试所需的数据或行为，用于表达子进程管理场景。 */
class StubSubprocessRuntime extends SubprocessRuntime {
  async resolveExecutable(command: string): Promise<string> {
    return `/bin/${command}`
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    /** 中文说明：变量 read 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const read: SubprocessOutputRead = { text: '', nextOffset: 0, lossy: false }
    /** 中文说明：变量 collected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const collected = spec.stdio.stdout !== 'pipe' && spec.stdio.stdout !== 'inherit'
      ? { stdout: { readFrom: () => read } }
      : {}
    return {
      pid: spec.argv.length,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected,
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }

  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return {
      pid: spec.argv.length,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: async () => {},
      inspectForeground: async () => ({ processGroupId: 1, inputWaiting: true }),
      signalForeground: async () => 1,
      terminate: async () => {},
    }
  }
}

describe('SubprocessRuntime seam', () => {
  it('a concrete subclass registers as ctx.subprocess and serves the abstract API', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = ctx.subprocess.spawn({
      argv: ['true'],
      cwd: '/stub',
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1 }, stderr: 'inherit' },
      graceMs: 1,
    })
    expect(handle.pid).toBe(1)
    expect(handle.collected.stdout!.readFrom(0)).toEqual({ text: '', nextOffset: 0, lossy: false })
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    /** 中文说明：变量 outcome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcome = await handle.done
    expect(outcome.exitCode).toBe(0)
  })

  it('loading a second implementation throws (one subprocess service per context — cordis standard)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(StubSubprocessRuntime)
    /** 中文说明：class SecondService 定义本测试所需的数据或行为，用于表达子进程管理场景。 */
    class SecondService extends StubSubprocessRuntime {}
    await expect(ctx.plugin(SecondService)).rejects.toThrow(/service "subprocess" has been registered/)
  })

  it('scrubbedParentEnv drops credential-shaped and DSH_ names (case-insensitively) but keeps PATH', () => {
    process.env.DSH_SCRUB_PROBE = 'stale'
    process.env.dsh_scrub_probe_lower = 'stale'
    process.env.SCRUB_PROBE_TOKEN = 'secret'
    process.env.SCRUB_PROBE_PASSWORD = 'secret'
    process.env.SCRUB_PROBE_PLAIN = 'visible'
    try {
      /** 中文说明：变量 env 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const env = scrubbedParentEnv()
      expect(env.DSH_SCRUB_PROBE).toBeUndefined()
      expect(env.dsh_scrub_probe_lower).toBeUndefined()
      expect(env.SCRUB_PROBE_TOKEN).toBeUndefined()
      expect(env.SCRUB_PROBE_PASSWORD).toBeUndefined()
      expect(env.SCRUB_PROBE_PLAIN).toBe('visible')
      expect(env.PATH).toBeDefined()
    } finally {
      delete process.env.DSH_SCRUB_PROBE
      delete process.env.dsh_scrub_probe_lower
      delete process.env.SCRUB_PROBE_TOKEN
      delete process.env.SCRUB_PROBE_PASSWORD
      delete process.env.SCRUB_PROBE_PLAIN
    }
  })
})
