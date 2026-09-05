/**
 * 文件职责：验证 tools.spec.ts 覆盖的Shell 命令与沙箱行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的Shell 命令与沙箱能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import type {
  TerminalBackend,
  TerminalBackendSession,
  TerminalReadRequest,
  TerminalSendOperation,
  TerminalSendRequest,
  TerminalSessionStatus,
  TerminalSignal,
  TerminalWaitReason,
} from '@deepseek-ai/dsh-terminal'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolBashPersistent from '@deepseek-ai/dsh-tool-bash-persistent'

/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []
/** 中文说明：变量 callNumber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let callNumber = 0

afterEach(async () => {
  /** 中文说明：该循环依次处理测试数据；循环变量仅在当前循环中有效。 */
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/** 中文说明：函数 agent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function agent(ctx: Context, cwd: string | undefined): Agent {
  /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const id = SessionId(`persistent-bash-owner-${callNumber}`)
  /** 中文说明：函数值 scope 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const scope = ctx.plugin(() => {})
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    isSeeded: false,
    ...cwd === undefined ? {} : { cwd },
  })
  /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value: Agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

/** 中文说明：函数 text 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** 中文说明：函数 call 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function call(
  ctx: Context,
  owner: Agent | undefined,
  command: string,
  signal = new AbortController().signal,
) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`persistent-bash-${++callNumber}`),
    name: 'bash',
    arguments: { command },
    ...owner === undefined ? {} : { agent: owner },
  })
}

/** 中文说明：type StubMode 定义本测试所需的数据或行为，用于表达Shell 命令与沙箱场景。 */
type StubMode =
  | 'normal'
  | 'prompt-only'
  | 'prompt-crlf'
  | 'empty-read'
  | 'stalled-read'
  | 'exit'
  | 'signal-exit'
  | 'unknown-exit'
  | 'wait-for-abort'
  | 'end-on-abort'
  | 'idle-then-normal'
  | 'large'
  | 'nonzero'
  | 'torn-status'
  | 'finish-torn-status'
  | 'end-only'
  | 'init-exit'
  | 'init-timeout'
  | 'spawn-error'
  | 'send-error'
  | 'prompt-after-idle'
  | 'incremental-fallback'
  | 'empty-page-after-latest'
  | 'paged-scrollback'
  | 'exit-after-send'

/** 中文说明：class StubPtySession 定义本测试所需的数据或行为，用于表达Shell 命令与沙箱场景。 */
class StubPtySession implements TerminalBackendSession {
  readonly motd = 'stub> '
  readonly pid = 123
  statusValue: TerminalSessionStatus = { kind: 'running' }
  scrollback = this.motd
  closed: string[] = []
  mode: StubMode
  sends = 0
  pendingText = ''
  historyTruncated = false
  throwOnSend = false

  constructor(mode: StubMode) {
    this.mode = mode
  }

  startSend(request: TerminalSendRequest): TerminalSendOperation {
    this.sends += 1
    if (request.text.startsWith('stty -echo')) {
      if (this.mode === 'init-exit') {
        this.statusValue = { kind: 'exited', exitCode: 1, signal: null }
        return this.operation(Promise.resolve(this.result('', 'session_exit')))
      }
      if (this.mode === 'init-timeout') {
        return this.operation(Promise.resolve(this.result('', 'timeout')))
      }
      return this.operation(Promise.resolve(this.result(this.motd, 'stdin_read')))
    }
    if (this.mode === 'send-error') throw new Error('stub send failed')
    if (this.throwOnSend) throw new Error('PTY session has exited')
    if (this.mode === 'wait-for-abort' || this.mode === 'end-on-abort') {
      /** 中文说明：函数值 done 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const done = new Promise<ReturnType<StubPtySession['result']>>((resolve) => {
        request.signal?.addEventListener('abort', () => {
          /** 中文说明：变量 start 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const start = /__DSH_PERSISTENT_BASH_START_[^_]+(?:-[^_]+)*__/.exec(request.text)?.[0]
          /** 中文说明：变量 end 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const end = /__DSH_PERSISTENT_BASH_END_[^:]+:/.exec(request.text)?.[0]
          /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const output = this.mode === 'end-on-abort'
            ? `${start ?? ''}\ninterrupted\n${end ?? ''}130\n${this.motd}`
            : 'partial output'
          this.scrollback += output
          resolve(this.result(output, 'stdin_read'))
        }, { once: true })
      })
      return this.operation(done)
    }
    if (this.mode === 'idle-then-normal') {
      this.mode = 'normal'
      this.pendingText = request.text
      return this.operation(Promise.resolve(this.result('', 'inferred_idle')))
    }
    if (this.mode === 'prompt-after-idle') {
      if (request.text.length > 0) {
        /** 中文说明：变量 start 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const start = /__DSH_PERSISTENT_BASH_START_[^_]+(?:-[^_]+)*__/.exec(request.text)?.[0]
        /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const output = `${start ?? ''}\npartial syntax output\n`
        this.scrollback += output
        return this.operation(Promise.resolve(this.result(output, 'inferred_idle')))
      }
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = `bash: syntax error\n${this.motd}`
      this.scrollback += output
      return this.operation(Promise.resolve(this.result(output, 'stdin_read')))
    }
    if (this.mode === 'prompt-only' || this.mode === 'prompt-crlf') {
      /** 中文说明：变量 newline 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const newline = this.mode === 'prompt-crlf' ? '\r\n' : '\n'
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = `bash: syntax error${newline}${this.motd}${newline}`
      this.scrollback += output
      return this.operation(Promise.resolve(this.result(output, 'stdin_read')))
    }
    /** 中文说明：变量 sent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sent = request.text.length > 0 ? request.text : this.pendingText
    this.pendingText = ''
    /** 中文说明：变量 start 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const start = /__DSH_PERSISTENT_BASH_START_[^_]+(?:-[^_]+)*__/.exec(sent)?.[0]
    /** 中文说明：变量 end 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const end = /__DSH_PERSISTENT_BASH_END_[^:]+:/.exec(sent)?.[0]
    if (this.mode === 'incremental-fallback') {
      /** 中文说明：变量 incremental 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const incremental = `${start ?? ''}\nincrement\n${this.motd}`
      return this.operation(Promise.resolve(this.result(this.motd, 'stdin_read')), incremental)
    }
    if (this.mode === 'exit-after-send') {
      // A fast `exit` settles the send while the exit event is still in
      // flight; the shell flips to exited before the tool's next poll,
      // exactly like the real backend. The tool must re-observe status
      // instead of sending.
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = `${start ?? ''}\n`
      this.scrollback += output
      /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const settled = this.result(output, 'inferred_idle')
      this.statusValue = { kind: 'exited', exitCode: 9, signal: null }
      this.throwOnSend = true
      return this.operation(Promise.resolve(settled))
    }
    if (this.mode === 'torn-status') {
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = `${start ?? ''}\nhello from stub\n${end ?? ''}`
      this.scrollback += output
      this.mode = 'finish-torn-status'
      return this.operation(Promise.resolve(this.result(output, 'inferred_idle')))
    }
    if (this.mode === 'finish-torn-status') {
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = `7\n${this.motd}`
      this.scrollback += output
      return this.operation(Promise.resolve(this.result(output, 'stdin_read')))
    }
    if (this.mode === 'end-only') {
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = `recovered output\n${end ?? ''}0\n${this.motd}`
      this.scrollback += output
      return this.operation(Promise.resolve(this.result(output, 'stdin_read')))
    }
    /** 中文说明：变量 commandOutput 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commandOutput = this.mode === 'large'
      ? 'x'.repeat(100)
      : this.mode === 'nonzero' ? '' : 'hello from stub'
    /** 中文说明：变量 exitCode 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exitCode = this.mode === 'nonzero' ? 7 : 0
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = `${start ?? ''}\n${commandOutput}\n${end ?? ''}${exitCode}\n${this.motd}`
    this.scrollback += output
    if (this.mode === 'exit' || this.mode === 'signal-exit' || this.mode === 'unknown-exit') {
      /** 中文说明：变量 exitedOutput 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const exitedOutput = `${start ?? ''}\nhello from stub\n`
      this.scrollback = this.scrollback.slice(0, -output.length) + exitedOutput
      this.statusValue = this.mode === 'signal-exit'
        ? { kind: 'exited', exitCode: null, signal: 'SIGTERM' }
        : this.mode === 'exit'
          ? { kind: 'exited', exitCode: 9, signal: null }
          : { kind: 'exited', exitCode: null, signal: null }
      return this.operation(Promise.resolve(this.result(exitedOutput, 'session_exit')))
    }
    return this.operation(Promise.resolve(this.result(output, 'stdin_read')))
  }

  read(request: TerminalReadRequest) {
    if (this.mode === 'empty-read') {
      return { text: '', totalLines: 0, lineBegin: 0, lineEnd: 0, truncated: false }
    }
    if (this.mode === 'stalled-read') {
      return { text: 'stalled', totalLines: 1, lineBegin: 0, lineEnd: 0, truncated: false }
    }
    if (this.mode === 'empty-page-after-latest' && (request.offset ?? 0) > 0) {
      return { text: '', totalLines: 2, lineBegin: 1, lineEnd: 1, truncated: false }
    }
    /** 中文说明：变量 lines 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lines = this.scrollback.split('\n')
    if (this.mode === 'paged-scrollback') {
      /** 中文说明：变量 offset 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const offset = request.offset ?? 0
      /** 中文说明：变量 end 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const end = lines.length - offset
      /** 中文说明：变量 start 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const start = Math.max(0, end - 3)
      /** 中文说明：变量 returnedLines 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const returnedLines = end - start
      return {
        text: lines.slice(start, end).join('\n'),
        totalLines: lines.length,
        lineBegin: offset,
        lineEnd: offset + returnedLines,
        truncated: this.historyTruncated,
      }
    }
    return {
      text: this.scrollback,
      totalLines: this.mode === 'empty-page-after-latest' ? lines.length + 1 : lines.length,
      lineBegin: 0,
      lineEnd: this.mode === 'empty-page-after-latest' ? 1 : lines.length,
      truncated: this.historyTruncated,
    }
  }

  signal(_signal: TerminalSignal) {
    return Promise.resolve({ delivered: true as const, targetPgid: 123 })
  }

  status() {
    return this.statusValue
  }

  async close(reason: string) {
    this.closed.push(reason)
    this.statusValue = { kind: 'exited', exitCode: 0, signal: null }
  }

  private result(viewport: string, waitReason: TerminalWaitReason) {
    return { viewport, waitReason, sessionStatus: this.statusValue, truncated: false }
  }

  private operation(done: Promise<ReturnType<StubPtySession['result']>>, delta = ''): TerminalSendOperation {
    return {
      done,
      readOutput: () => ({ delta, truncated: false }),
      cancel: () => false,
    }
  }
}

/** 中文说明：函数 stubBackend 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function stubBackend(initialMode: StubMode = 'normal') {
  /** 中文说明：变量 sessions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sessions: StubPtySession[] = []
  /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const backend: TerminalBackend = {
    type: 'stub',
    async spawn() {
      if (initialMode === 'spawn-error') throw new Error('stub spawn failed')
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = new StubPtySession(initialMode)
      sessions.push(session)
      return session
    },
  }
  return { backend, sessions }
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(
  config: ToolBashPersistent.Config = { backendType: 'stub' },
  initialMode: StubMode = 'normal',
) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TerminalSessionService)
  /** 中文说明：变量 stub 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stub = stubBackend(initialMode)
  ctx.terminals.registerBackend(stub.backend)
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(ToolBashPersistent, config)
  return { ctx, stub, fiber, owner: agent(ctx, '/workspace') }
}

describe('tool-bash-persistent', () => {
  it('registers a configurable schema and reuses one owner shell', async () => {
    const { ctx, owner, stub, fiber } = await setup({
      backendType: 'stub',
      description: 'deployment-specific persistent shell',
    })
    /** 中文说明：变量 schema 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const schema = ctx.tools.schemas()[0]
    expect(ctx.tools.schemas().map(item => item.name)).toEqual(['bash'])
    expect(schema?.description).toBe('deployment-specific persistent shell')
    expect(schema?.parameters).toMatchObject({
      required: ['command'],
      properties: { command: { type: 'string' } },
    })
    expect(ctx.tools.get('bash')?.presentCall?.({ command: 'pwd' }))
      .toEqual({ card: 'terminal', title: 'pwd' })

    expect(text(await call(ctx, owner, 'echo one'))).toBe('hello from stub')
    expect(text(await call(ctx, owner, 'echo two'))).toBe('hello from stub')
    expect(stub.sessions).toHaveLength(1)
    expect(stub.sessions[0]?.sends).toBe(3)

    /** 中文说明：变量 ownerWithoutCwd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ownerWithoutCwd = agent(ctx, undefined)
    expect(text(await call(ctx, ownerWithoutCwd, 'pwd'))).toBe('hello from stub')
    expect(stub.sessions).toHaveLength(2)

    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.tools.get('bash')).toBeUndefined()
  })

  it('handles inferred idle, stdin_read fallback, shell exit, clipping, and cleanup', async () => {
    const { ctx, owner, stub, fiber } = await setup({
      backendType: 'stub',
      maxOutputChars: 10,
    })
    await call(ctx, owner, 'warm up')
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = stub.sessions[0]!

    session.mode = 'idle-then-normal'
    expect(text(await call(ctx, owner, 'silent then complete'))).toContain('hello from')

    session.mode = 'incremental-fallback'
    session.scrollback = ''
    expect(text(await call(ctx, owner, 'incremental fallback'))).toContain('increment')

    session.mode = 'prompt-only'
    /** 中文说明：变量 promptFallback 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const promptFallback = text(await call(ctx, owner, 'bad {'))
    expect(promptFallback).toContain('bash: synt')

    session.mode = 'prompt-crlf'
    session.scrollback = ''
    /** 中文说明：变量 crlfPromptFallback 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const crlfPromptFallback = text(await call(ctx, owner, 'bad {'))
    expect(crlfPromptFallback).toContain('bash: synt')

    session.mode = 'end-only'
    session.scrollback = ''
    /** 中文说明：变量 missingStart 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missingStart = text(await call(ctx, owner, 'recover marker'))
    expect(missingStart).toContain('recovered')
    expect(missingStart).toContain('beginning of this command output was dropped')
    expect(missingStart).toContain('<response clipped>')

    session.mode = 'large'
    expect(text(await call(ctx, owner, 'large'))).toContain('<response clipped>')

    session.mode = 'nonzero'
    expect(text(await call(ctx, owner, 'false'))).toBe('[exit code: 7]')

    session.mode = 'exit'
    /** 中文说明：变量 exited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exited = text(await call(ctx, owner, 'exit'))
    expect(exited).toContain('hello from')
    expect(exited).toContain('[shell exited: code 9]')
    expect(exited).not.toContain('[exit code: 9]')
    expect(exited).toContain('next bash call starts from the workspace')
    expect(session.closed).toContain('persistent bash shell exited')

    await call(ctx, owner, 'new shell')
    expect(stub.sessions).toHaveLength(2)
    /** 中文说明：变量 replacement 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replacement = stub.sessions[1]!
    replacement.mode = 'signal-exit'
    expect(text(await call(ctx, owner, 'kill shell')))
      .toContain('[shell killed by signal: SIGTERM]')

    await call(ctx, owner, 'another shell')
    expect(stub.sessions).toHaveLength(3)
    /** 中文说明：变量 externallyClosed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const externallyClosed = ctx.terminals.list(owner)[0]?.sessionId
    expect(externallyClosed).toBeDefined()
    await ctx.terminals.kill(owner, externallyClosed!, 'external cleanup')
    await fiber.dispose()
    expect(stub.sessions[2]?.closed).toEqual(['external cleanup'])
  })

  it('waits for status digits after a torn completion marker', async () => {
    const { ctx, owner, stub } = await setup({ backendType: 'stub', maxOutputChars: 1_000 })
    await call(ctx, owner, 'warm up')
    stub.sessions[0]!.mode = 'torn-status'
    stub.sessions[0]!.scrollback = ''

    expect(text(await call(ctx, owner, 'torn status'))).toBe('hello from stub\n[exit code: 7]')
  })

  it('reports the exit path when the shell exits between send settlement and the next poll', async () => {
    const { ctx, owner, stub } = await setup({ backendType: 'stub' })
    await call(ctx, owner, 'warm up')
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = stub.sessions[0]!
    session.mode = 'exit-after-send'

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = text(await call(ctx, owner, 'exit'))
    expect(result).toContain('[shell exited: code 9]')
    expect(result).toContain('next bash call starts from the workspace')
    expect(session.closed).toContain('persistent bash shell exited')

    expect(text(await call(ctx, owner, 'echo "$PWD"'))).toBe('hello from stub')
    expect(stub.sessions).toHaveLength(2)
  })

  it('reports a shell exit when the backend has no code or signal', async () => {
    const { ctx, owner, stub } = await setup({ backendType: 'stub' })
    await call(ctx, owner, 'warm up')
    stub.sessions[0]!.mode = 'unknown-exit'

    expect(text(await call(ctx, owner, 'exit without status'))).toContain('[shell exited]')
  })

  it('marks a short missing-prefix result and tolerates exhausted scrollback pages', async () => {
    const { ctx, owner, stub } = await setup({ backendType: 'stub', maxOutputChars: 1_000 })
    await call(ctx, owner, 'warm up')
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = stub.sessions[0]!

    session.mode = 'end-only'
    session.scrollback = ''
    expect(text(await call(ctx, owner, 'missing start')))
      .toContain('beginning of this command output was dropped')

    session.mode = 'empty-read'
    expect(text(await call(ctx, owner, 'empty page'))).toContain('hello from stub')

    session.mode = 'stalled-read'
    expect(text(await call(ctx, owner, 'stalled page'))).toContain('hello from stub')

    session.mode = 'empty-page-after-latest'
    expect(text(await call(ctx, owner, 'empty continuation page'))).toContain('hello from stub')
  })

  it('assembles retained output across backward scrollback pages', async () => {
    const { ctx, owner, stub } = await setup({ backendType: 'stub', maxOutputChars: 1_000 })
    await call(ctx, owner, 'warm up')
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = stub.sessions[0]!
    session.mode = 'paged-scrollback'
    session.scrollback = 'older one\nolder two\nolder three\nolder four\n'

    expect(text(await call(ctx, owner, 'paged output'))).toBe('hello from stub')
  })

  it('returns a stdin_read fallback reached after multiple polling rounds', async () => {
    const { ctx, owner, stub } = await setup({ backendType: 'stub', maxOutputChars: 1_000 })
    await call(ctx, owner, 'warm up')
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = stub.sessions[0]!
    session.mode = 'prompt-after-idle'
    session.scrollback = ''
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = text(await call(ctx, owner, 'bad {'))
    expect(result).toContain('partial syntax output')
    expect(result).toContain('bash: syntax error')
    // The backend owns the prompt text, so the fallback retains it verbatim.
    expect(result.endsWith('stub> ')).toBe(true)
    expect(result).not.toContain('DSH_PERSISTENT_BASH_START')
  })

  it('does not attribute old scrollback truncation to a complete current command', async () => {
    const { ctx, owner, stub } = await setup({ backendType: 'stub', maxOutputChars: 1_000 })
    await call(ctx, owner, 'warm up')
    stub.sessions[0]!.historyTruncated = true
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = text(await call(ctx, owner, 'short command'))
    expect(result).toBe('hello from stub')
    expect(result).not.toContain('<response clipped>')
    expect(result).not.toContain('beginning of this command output was dropped')
  })

  it('closes a timed-out shell and reports bounded partial output', async () => {
    const { ctx, owner, stub } = await setup({ backendType: 'stub', timeoutMs: 10 })
    await call(ctx, owner, 'warm up')
    stub.sessions[0]!.mode = 'wait-for-abort'
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, owner, 'hang')
    expect(text(result)).toContain('timed out after 0 seconds or experienced an OOM error')
    expect(text(result)).toContain('partial output')
    expect(text(result)).toContain('next bash call starts from the workspace')
    expect(stub.sessions[0]?.closed).toContain('persistent bash command timed out')
  })

  it.each(['wait-for-abort', 'end-on-abort'] as const)(
    'cancels %s work, resets the shell, and releases a queued call',
    async (mode) => {
      const { ctx, owner, stub } = await setup({ backendType: 'stub', timeoutMs: 5_000 })
      await call(ctx, owner, 'warm up')
      stub.sessions[0]!.mode = mode
      /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const controller = new AbortController()
      /** 中文说明：变量 cancelled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const cancelled = call(ctx, owner, 'hang', controller.signal)
      /** 中文说明：变量 queued 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const queued = call(ctx, owner, 'after cancellation')
      setTimeout(() => {
        controller.abort(new Error('caller stopped'))
      }, 5)

      expect((await cancelled).isError).toBe(true)
      expect(text(await queued)).toBe('hello from stub')
      expect(stub.sessions[0]?.closed).toContain('persistent bash command aborted')
      expect(stub.sessions).toHaveLength(2)
    },
  )

  it.each(['init-exit', 'init-timeout'] as const)(
    'fails initialization and closes the unusable shell for %s',
    async (mode) => {
      const { ctx, owner, stub } = await setup({ backendType: 'stub' }, mode)
      expect((await call(ctx, owner, 'pwd')).isError).toBe(true)
      expect(stub.sessions[0]?.closed).toContain('persistent bash initialization failed')
    },
  )

  it('clears a failed spawn without trying to close an unpublished shell', async () => {
    const { ctx, owner, stub } = await setup({ backendType: 'stub' }, 'spawn-error')
    expect((await call(ctx, owner, 'pwd')).isError).toBe(true)
    expect(stub.sessions).toHaveLength(0)
  })

  it('resets a cached shell after startSend fails', async () => {
    const { ctx, owner, stub } = await setup()
    await call(ctx, owner, 'warm up')
    stub.sessions[0]!.mode = 'send-error'
    expect((await call(ctx, owner, 'fails')).isError).toBe(true)
    expect(stub.sessions[0]?.closed).toContain('persistent bash send failed')
    expect(text(await call(ctx, owner, 'recovers'))).toBe('hello from stub')
    expect(stub.sessions).toHaveLength(2)
  })

  it('cancels and awaits a pending shell spawn when the plugin is disposed', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(TerminalSessionService)
    /** 中文说明：变量 spawnStarted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawnStarted = Promise.withResolvers<undefined>()
    /** 中文说明：变量 spawnAborted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawnAborted = Promise.withResolvers<undefined>()
    ctx.terminals.registerBackend({
      type: 'slow',
      spawn: spec => new Promise((_resolve, reject) => {
        spawnStarted.resolve(undefined)
        spec.signal?.addEventListener('abort', () => {
          spawnAborted.resolve(undefined)
          /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const reason: unknown = spec.signal?.reason
          reject(reason instanceof Error
            ? reason
            : new Error('slow PTY spawn aborted', { cause: reason }))
        }, { once: true })
      }),
    })
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(ToolBashPersistent, { backendType: 'slow' })
    /** 中文说明：变量 owner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = agent(ctx, '/workspace')
    /** 中文说明：变量 running 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const running = call(ctx, owner, 'pwd')
    await spawnStarted.promise
    await fiber.dispose()
    await spawnAborted.promise
    expect((await running).isError).toBe(true)
    expect(ctx.terminals.list(owner)).toEqual([])
  })

  it('rejects invalid config and invalid calls', async () => {
    const { ctx, owner, stub } = await setup()
    expect((await call(ctx, undefined, 'pwd')).isError).toBe(true)
    expect(text(await call(ctx, owner, ' '))).toContain('command must be a non-empty string')

    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort(new Error('caller stopped'))
    expect((await call(ctx, owner, 'pwd', controller.signal)).isError).toBe(true)
    expect(stub.sessions).toHaveLength(0)

    expect(() => {
      ToolBashPersistent.apply(new Context(), { backendType: '' })
    }).toThrow('backendType must be non-empty')
    expect(() => {
      ToolBashPersistent.apply(new Context(), { timeoutMs: 0 })
    }).toThrow('timeoutMs must be a positive safe integer')
    expect(() => {
      ToolBashPersistent.apply(new Context(), { maxOutputChars: 0 })
    }).toThrow('maxOutputChars must be a positive safe integer')
    expect(() => {
      ToolBashPersistent.apply(new Context(), { description: ' ' })
    }).toThrow('description must be non-empty')
  })
})
