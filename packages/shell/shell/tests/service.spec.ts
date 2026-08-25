/**
 * 文件职责：验证 service.spec.ts 覆盖的Shell 命令与沙箱行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的Shell 命令与沙箱能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellProcessRead, ShellRunResult } from '@deepseek-ai/dsh-shell'

/**
 * Minimal concrete executor: canned foreground results, a hand-built process
 * handle. The seam is TASK-FREE (start returns a {@link ShellProcess} handle;
 * task semantics live in `ctx.jobs`), so this stub is all an implementation
 * owes the abstract class.
 */
/** 中文说明：class StubExecutor 定义本测试所需的数据或行为，用于表达Shell 命令与沙箱场景。 */
class StubExecutor extends ShellExecutor {
  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? '/stub',
      timeoutMs: request.timeoutMs ?? 1000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      ...request.signal ? { signal: request.signal } : {},
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: 'ok', truncated: false },
      stderr: { text: '', truncated: false },
    }
  }

  start(): ShellProcess {
    /** 中文说明：变量 proc 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const proc: ShellProcess = {
      status: 'running',
      exitCode: null,
      signal: null,
      done: Promise.resolve(),
      readOutput: (): ShellProcessRead => ({ delta: '', lossy: false }),
      kill: (): boolean => {
        if (proc.status !== 'running') return false
        proc.status = 'killed'
        return true
      },
    }
    return proc
  }
}

describe('ShellExecutor service seam', () => {
  it('a concrete subclass registers as ctx.shell and serves the abstract API', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(StubExecutor)
    /** 中文说明：变量 spec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spec = ctx.shell.resolve({ command: 'echo hi' })
    expect(spec).toEqual({ command: 'echo hi', workdir: '/stub', timeoutMs: 1000, stdoutMaxBytes: 64_000, sandboxPolicy: undefined })

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.shell.run(spec)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.text).toBe('ok')

    /** 中文说明：变量 proc 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const proc = ctx.shell.start(spec)
    expect(proc.status).toBe('running')
    expect(proc.readOutput()).toEqual({ delta: '', lossy: false })
    expect(proc.kill()).toBe(true)
    expect(proc.kill()).toBe(false) // already settled → no-op
    await proc.done
  })

  it('reports no default sandbox mode from the task-free base seam', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(StubExecutor)
    expect(ctx.shell.sandboxMode).toBeUndefined()
  })

  it('loading a second implementation throws (one bash service per context — cordis standard)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(StubExecutor)
    /** 中文说明：class SecondExecutor 定义本测试所需的数据或行为，用于表达Shell 命令与沙箱场景。 */
    class SecondExecutor extends StubExecutor {}
    await expect(ctx.plugin(SecondExecutor)).rejects.toThrow(/service "shell" has been registered/)
  })
})
