/**
 * 文件职责：验证Hook 线协议的 runner.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Hook 线协议可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：构造事件与配置，驱动入口并断言结果。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { ShellExecRequest, ShellExecSpec, ShellExecutor, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { DEFAULT_HOOK_TIMEOUT_MS, runHook } from '@deepseek-ai/dsh-hook-protocol'
import type { RunHookOptions } from '@deepseek-ai/dsh-hook-protocol'

/**
 * A minimal stand-in for the bits of {@link ShellExecutor} that {@link runHook}
 * actually calls (`resolve` then `run`). `runHook` is pure plumbing over those
 * two methods, so a duck-typed recorder is the right test hook — the REAL
 * executor (dsh-bash-local) is exercised end-to-end by the hook-bridge plugins
 * that consume this library, not here.
 */
/** 中文说明：函数 recordingBash 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function recordingBash(run: (spec: ShellExecSpec) => Promise<ShellRunResult>): {
  bash: ShellExecutor
  specs: ShellExecSpec[]
} {
  /** 中文说明：测试局部值 specs，由紧邻初始化决定。 */
  const specs: ShellExecSpec[] = []
  /** 中文说明：测试局部值 bash，由紧邻初始化决定。 */
  const bash = {
    resolve(request: ShellExecRequest): ShellExecSpec {
      // Carry the request through verbatim, defaulting the required spec fields —
      // exactly what dsh-bash-local's resolve does for the fields runHook sets.
      return {
        command: request.command,
        workdir: request.workdir ?? '/stub',
        timeoutMs: request.timeoutMs ?? 0,
        stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
        ...request.signal ? { signal: request.signal } : {},
        ...request.stdin !== undefined ? { stdin: request.stdin } : {},
        ...request.env !== undefined ? { env: request.env } : {},
        sandboxPolicy: request.sandboxPolicy,
      }
    },
    async run(spec: ShellExecSpec): Promise<ShellRunResult> {
      specs.push(spec)
      return run(spec)
    },
  } as unknown as ShellExecutor
  return { bash, specs }
}

/** 中文说明：函数 result 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function result(over: Partial<ShellRunResult> = {}): ShellRunResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
    ...over,
  }
}

/** 中文说明：测试局部值 clock，由紧邻初始化决定。 */
const clock = () => { let t = 0; return () => (t += 5) } // +5ms per call → duration 5
/** 中文说明：测试局部值 testSignal，由紧邻初始化决定。 */
const testSignal = (): AbortSignal => new AbortController().signal

describe('runHook — payload + env + stdin plumbing', () => {
  it('requires an explicit caller-owned abort signal', () => {
    expectTypeOf<RunHookOptions['signal']>().toEqualTypeOf<AbortSignal>()
  })

  it('serializes the payload to stdin (with trailing newline when requested)', async () => {
    /** 中文说明：测试局部值 { bash, specs }，由紧邻初始化决定。 */
    const { bash, specs } = recordingBash(async () => result({ stdout: { text: '', truncated: false } }))
    await runHook(bash, { command: 'my-hook.sh' }, {
      payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash' },
      signal: testSignal(),
      defaultTimeoutMs: 60000,
      trailingNewline: true,
    }, clock())
    expect(specs[0]!.stdin).toBe(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }) + '\n')
    expect(specs[0]!.command).toBe('my-hook.sh')
  })

  it('omits the trailing newline when trailingNewline is false (Codex)', async () => {
    /** 中文说明：测试局部值 { bash, specs }，由紧邻初始化决定。 */
    const { bash, specs } = recordingBash(async () => result())
    await runHook(bash, { command: 'h' }, { payload: { a: 1 }, signal: testSignal(), defaultTimeoutMs: 1000, trailingNewline: false }, clock())
    expect(specs[0]!.stdin).toBe('{"a":1}')
  })

  it('threads env and cwd into the request', async () => {
    /** 中文说明：测试局部值 { bash, specs }，由紧邻初始化决定。 */
    const { bash, specs } = recordingBash(async () => result())
    await runHook(bash, { command: 'h' }, {
      payload: {}, env: { CLAUDE_PROJECT_DIR: '/proj' }, cwd: '/work', signal: testSignal(),
      defaultTimeoutMs: 1000, trailingNewline: true,
    }, clock())
    expect(specs[0]!.env).toEqual({ CLAUDE_PROJECT_DIR: '/proj' })
    expect(specs[0]!.workdir).toBe('/work')
  })

  it('a per-hook timeoutSec (seconds) overrides the default (ms)', async () => {
    /** 中文说明：测试局部值 { bash, specs }，由紧邻初始化决定。 */
    const { bash, specs } = recordingBash(async () => result())
    await runHook(bash, { command: 'h', timeoutSec: 3 }, { payload: {}, signal: testSignal(), defaultTimeoutMs: 60000, trailingNewline: true }, clock())
    expect(specs[0]!.timeoutMs).toBe(3000)
  })

  it('falls back to the default timeout when the hook sets none', async () => {
    /** 中文说明：测试局部值 { bash, specs }，由紧邻初始化决定。 */
    const { bash, specs } = recordingBash(async () => result())
    await runHook(bash, { command: 'h' }, { payload: {}, signal: testSignal(), defaultTimeoutMs: 60000, trailingNewline: true }, clock())
    expect(specs[0]!.timeoutMs).toBe(60000)
    expect(DEFAULT_HOOK_TIMEOUT_MS).toBe(600_000) // the CC/Codex reference default (10 minutes)
  })

  it('passes the abort signal through', async () => {
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 { bash, specs }，由紧邻初始化决定。 */
    const { bash, specs } = recordingBash(async () => result())
    await runHook(bash, { command: 'h' }, { payload: {}, signal: controller.signal, defaultTimeoutMs: 1000, trailingNewline: true }, clock())
    expect(specs[0]!.signal).toBe(controller.signal)
  })
})

describe('runHook — outcome decoding + duration', () => {
  it('decodes a clean exit with structured stdout and reports a duration', async () => {
    /** 中文说明：测试局部值 { bash }，由紧邻初始化决定。 */
    const { bash } = recordingBash(async () => result({
      exitCode: 0, stdout: { text: JSON.stringify({ decision: 'block', reason: 'no' }), truncated: false },
    }))
    /** 中文说明：测试局部值 { output, durationMs }，由紧邻初始化决定。 */
    const { output, durationMs } = await runHook(bash, { command: 'h' }, { payload: {}, signal: testSignal(), defaultTimeoutMs: 1000, trailingNewline: true }, clock())
    expect(output.decision).toBe('block')
    expect(output.reason).toBe('no')
    expect(durationMs).toBe(5)
  })

  it('a signal death (exitCode null) decodes as undefined exit (non-blocking error)', async () => {
    /** 中文说明：测试局部值 { bash }，由紧邻初始化决定。 */
    const { bash } = recordingBash(async () => result({ exitCode: null, signal: 'SIGKILL', stderr: { text: 'killed', truncated: false } }))
    /** 中文说明：测试局部值 { output }，由紧邻初始化决定。 */
    const { output } = await runHook(bash, { command: 'h' }, { payload: {}, signal: testSignal(), defaultTimeoutMs: 1000, trailingNewline: true }, clock())
    expect(output.exitCode).toBeUndefined()
    expect(output.decision).toBeUndefined()
    expect(output.stderr).toBe('killed')
  })

  it('an executor rejection (infra fault) becomes a non-blocking error, never throws', async () => {
    /** 中文说明：测试局部值 { bash }，由紧邻初始化决定。 */
    const { bash } = recordingBash(async () => { throw new Error('bad workdir: ENOENT') })
    /** 中文说明：测试局部值 { output }，由紧邻初始化决定。 */
    const { output } = await runHook(bash, { command: 'h' }, { payload: {}, signal: testSignal(), defaultTimeoutMs: 1000, trailingNewline: true }, clock())
    expect(output.exitCode).toBeUndefined()
    expect(output.stderr).toBe('bad workdir: ENOENT')
    expect(output.decision).toBeUndefined()
  })

  it('a non-Error rejection is stringified onto stderr', async () => {
    /** 中文说明：测试局部值 { bash }，由紧邻初始化决定。 */
    const { bash } = recordingBash(async () => { throw 'plain string fault' })
    /** 中文说明：测试局部值 { output }，由紧邻初始化决定。 */
    const { output } = await runHook(bash, { command: 'h' }, { payload: {}, signal: testSignal(), defaultTimeoutMs: 1000, trailingNewline: true }, clock())
    expect(output.stderr).toBe('plain string fault')
  })

  it('threads expectedEventName so a mismatched hookSpecificOutput block is discarded', async () => {
    /** 中文说明：测试局部值 { bash }，由紧邻初始化决定。 */
    const { bash } = recordingBash(async () => result({
      exitCode: 0,
      stdout: { text: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } }), truncated: false },
    }))
    /** 中文说明：测试局部值 { output }，由紧邻初始化决定。 */
    const { output } = await runHook(bash, { command: 'h' }, {
      payload: {}, signal: testSignal(), defaultTimeoutMs: 1000, trailingNewline: true, expectedEventName: 'Stop',
    }, clock())
    // A PreToolUse block on a Stop hook is malformed → its decision is discarded.
    expect(output.hookEventName).toBe('PreToolUse')
    expect(output.decision).toBeUndefined()
  })
})
