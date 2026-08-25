/**
 * 文件职责：验证 tools.spec.ts 覆盖的终端会话行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的终端会话能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { renderToolsSdk } from '@deepseek-ai/dsh-tools'
import type { ToolSdkSchema } from '@deepseek-ai/dsh-tools/src/ts-types.ts'
import TerminalSessionService, { TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import type { TerminalBackend, TerminalBackendSession, TerminalSendOperation, TerminalSendRequest, TerminalSessionStatus, TerminalSignal } from '@deepseek-ai/dsh-terminal'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolTasks from '@deepseek-ai/dsh-tool-jobs'
import * as ToolPty from '@deepseek-ai/dsh-tool-terminal'

/** 中文说明：函数 fakeAgent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fakeAgent(ctx: Context, rawId: string): Agent {
  /** 中文说明：函数值 scope 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const scope = ctx.plugin(() => {})
  /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const id = SessionId(rawId)
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = Session.create(id)
  /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const agent: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return agent
}

/** 中文说明：class StubSession 定义本测试所需的数据或行为，用于表达终端会话场景。 */
class StubSession implements TerminalBackendSession {
  readonly motd = 'stub prompt'
  readonly pid = 42
  statusValue: TerminalSessionStatus = { kind: 'running' }
  operation: TerminalSendOperation | undefined
  autoSettle = true
  rejectOperation = false
  closeGate: PromiseWithResolvers<undefined> | undefined
  viewport = 'command output'
  delta = 'live output'
  deltaTruncated = false

  startSend(_request: TerminalSendRequest): TerminalSendOperation {
    /** 中文说明：函数值 settle 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let settle!: () => void
    /** 中文说明：函数值 reject 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let reject!: (error: unknown) => void
    /** 中文说明：变量 cancelled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let cancelled = false
    /** 中文说明：函数值 done 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const done = new Promise<void>((resolve, rejectPromise) => { settle = resolve; reject = rejectPromise }).then(() => ({
      viewport: cancelled ? '^C' : this.viewport,
      waitReason: 'stdin_read' as const,
      sessionStatus: this.statusValue,
      truncated: false,
    }))
    /** 中文说明：变量 operation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const operation: TerminalSendOperation = {
      done,
      readOutput: () => ({ delta: this.delta, truncated: this.deltaTruncated }),
      cancel: () => {
        if (cancelled) return false
        cancelled = true
        settle()
        return true
      },
    }
    this.operation = operation
    if (this.rejectOperation) queueMicrotask(() => { reject(new Error('operation failed')) })
    else if (this.autoSettle) queueMicrotask(settle)
    return operation
  }

  read() {
    return { text: 'history', totalLines: 1, lineBegin: 0, lineEnd: 1, truncated: false }
  }

  async signal(signal: TerminalSignal) {
    return { delivered: true as const, targetPgid: signal === 'SIGINT' ? 10 : 11 }
  }

  status() { return this.statusValue }

  async close() {
    if (this.closeGate !== undefined) await this.closeGate.promise
    this.statusValue = { kind: 'exited', exitCode: 0, signal: null }
  }
}

/** 中文说明：函数 stubBackend 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function stubBackend() {
  /** 中文说明：变量 sessions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sessions: StubSession[] = []
  /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const backend: TerminalBackend = {
    type: 'stub',
    async spawn() {
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = new StubSession()
      sessions.push(session)
      return session
    },
  }
  return { backend, sessions }
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(jobs: boolean, config: ToolPty.Config = {}) {
  /** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const base = await setupBase(jobs)
  await base.ctx.plugin(ToolPty, config)
  return base
}

/** 中文说明：函数 setupBase 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setupBase(jobs: boolean) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TerminalSessionService)
  /** 中文说明：变量 stub 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stub = stubBackend()
  ctx.terminals.registerBackend(stub.backend)
  if (jobs) {
    await ctx.plugin(LocalJobRegistry)
    await ctx.plugin(ToolTasks)
  }
  return { ctx, stub, agent: fakeAgent(ctx, jobs ? 'with-tasks' : 'foreground') }
}

/** 中文说明：变量 callNumber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let callNumber = 0
/** 中文说明：常量 TOOL_NAMES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TOOL_NAMES = ['terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list'] as const
/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal
/** 中文说明：函数 call 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function call(ctx: Context, name: string, args: unknown, agent?: Agent) {
  return ctx.tools.execute({ signal: testToolSignal, callId: CallId(`pty-call-${++callNumber}`), name, arguments: args, ...agent ? { agent } : {} })
}

/** 中文说明：函数 callWithSignal 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function callWithSignal(ctx: Context, name: string, args: unknown, agent: Agent, signal: AbortSignal) {
  return ctx.tools.execute({ callId: CallId(`pty-call-${++callNumber}`), name, arguments: args, agent, signal })
}

/** 中文说明：函数 text 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('tool-terminal foreground API', () => {
  it('registers exactly six schemas and drives the full owner-scoped lifecycle', async () => {
    const { ctx, agent } = await setup(false)
    expect(TOOL_NAMES.every(name => ctx.tools.get(name) !== undefined)).toBe(true)

    /** 中文说明：变量 spawned 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawned = await call(ctx, 'terminal_open', { type: 'stub', name: 'main' }, agent)
    expect(text(spawned)).toContain('started terminal session pty-1 (main)')
    expect(spawned).toMatchObject({
      isError: false,
      value: {
        sessionId: 'pty-1',
        name: 'main',
        type: 'stub',
        pid: 42,
        status: { kind: 'running' },
        motd: 'stub prompt',
      },
    })
    /** 中文说明：变量 listed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listed = await call(ctx, 'terminal_list', {}, agent)
    expect(text(listed)).toContain('pty-1 (main) [stub] running pid=42')
    expect(listed).toMatchObject({ isError: false, value: [{ sessionId: 'pty-1', name: 'main', type: 'stub', pid: 42, status: { kind: 'running' } }] })
    /** 中文说明：变量 read 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const read = await call(ctx, 'terminal_read', { sessionId: 'pty-1' }, agent)
    expect(text(read)).toContain('history\n[lines: 0-1 of 1]')
    expect(read).toMatchObject({ isError: false, value: { text: 'history', totalLines: 1, lineBegin: 0, lineEnd: 1, truncated: false } })
    /** 中文说明：变量 signalled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signalled = await call(ctx, 'terminal_signal', { sessionId: 'pty-1', signal: 'SIGINT' }, agent)
    expect(text(signalled)).toBe('delivered SIGINT to foreground process group 10')
    expect(signalled).toMatchObject({ isError: false, value: { delivered: true, targetPgid: 10 } })
    /** 中文说明：变量 sent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sent = await call(ctx, 'terminal_send', { sessionId: 'pty-1', text: 'echo hi' }, agent)
    expect(text(sent)).toContain('command output\n[wait: stdin_read]\n[session: running]')
    expect(sent).toMatchObject({
      isError: false,
      value: {
        kind: 'foreground',
        viewport: 'command output',
        waitReason: 'stdin_read',
        sessionStatus: { kind: 'running' },
        truncated: false,
      },
      meta: {
        viewport: 'command output',
        waitReason: 'stdin_read',
        sessionStatus: { kind: 'running' },
        truncated: false,
      },
    })
    /** 中文说明：变量 closed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const closed = await call(ctx, 'terminal_close', { sessionId: 'pty-1' }, agent)
    expect(text(closed)).toBe('closed terminal session pty-1')
    expect(closed).toMatchObject({ isError: false, value: { sessionId: 'pty-1', outcome: 'closed' } })
    /** 中文说明：变量 empty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const empty = await call(ctx, 'terminal_list', {}, agent)
    expect(text(empty)).toBe('(no terminal sessions)')
    expect(empty).toMatchObject({ isError: false, value: [] })
  })

  it('projects every terminal DTO into the generated Code Mode output map', async () => {
    const { ctx } = await setup(false)
    /** 中文说明：函数值 schemas 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const schemas = TOOL_NAMES.map((toolName): ToolSdkSchema => {
      /** 中文说明：变量 definition 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const definition = ctx.tools.get(toolName)
      if (definition === undefined) throw new Error(`missing terminal tool ${toolName}`)
      return {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        output: definition.output.schema,
      }
    })
    /** 中文说明：变量 sdk 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sdk = renderToolsSdk(schemas)
    /** 中文说明：变量 outputMapStart 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outputMapStart = sdk.indexOf('interface ToolOutputMap')
    /** 中文说明：变量 outputMapEnd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outputMapEnd = sdk.indexOf('\n\ntype ToolName', outputMapStart)

    expect(sdk.slice(outputMapStart, outputMapEnd)).toMatchInlineSnapshot(`
      "interface ToolOutputMap {
        terminal_close: {
          sessionId: string;
          outcome: "closed" | "already-closing";
        };
        terminal_list: ({
          sessionId: string;
          name?: string;
          type: string;
          pid?: number;
          status: {
            kind: "running";
          } | {
            kind: "exited";
            exitCode: number | null;
            signal: string | null;
          };
        })[];
        terminal_open: {
          sessionId: string;
          name?: string;
          type: string;
          pid?: number;
          status: {
            kind: "running";
          } | {
            kind: "exited";
            exitCode: number | null;
            signal: string | null;
          };
          motd: string;
        };
        terminal_read: {
          text: string;
          totalLines: number;
          lineBegin: number;
          lineEnd: number;
          truncated: boolean;
        };
        terminal_send: {
          kind: "background";
          jobId: string;
        } | {
          kind: "foreground";
          viewport: string;
          waitReason: "stdin_read" | "inferred_idle" | "timeout" | "session_exit";
          sessionStatus: {
            kind: "running";
          } | {
            kind: "exited";
            exitCode: number | null;
            signal: string | null;
          };
          truncated: boolean;
        };
        terminal_signal: {
          delivered: true;
          targetPgid: number;
        };
      }"
    `)
  })

  it('fails without an initiating agent and rejects background before writing', async () => {
    const { ctx, agent, stub } = await setup(false)
    expect((await call(ctx, 'terminal_open', { type: 'stub' })).isError).toBe(true)
    await call(ctx, 'terminal_open', { type: 'stub' }, agent)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, 'terminal_send', { sessionId: 'pty-1', text: 'sleep 1', run_in_background: true }, agent)
    expect(result.isError).toBe(true)
    expect(stub.sessions[0]?.operation).toBeUndefined()
  })

  it('validates required values and forwards optional spawn/read arguments', async () => {
    const { ctx, agent } = await setup(false)
    expect((await call(ctx, 'terminal_open', { type: '' }, agent)).isError).toBe(true)
    expect((await call(ctx, 'terminal_send', { sessionId: '', text: 'x' }, agent)).isError).toBe(true)
    expect((await call(ctx, 'terminal_send', { sessionId: 1, text: 'x' }, agent)).isError).toBe(true)
    expect((await call(ctx, 'terminal_send', { sessionId: 'pty-1', text: 1 }, agent)).isError).toBe(true)
    await call(ctx, 'terminal_open', { type: 'stub', name: 'named', cwd: '/tmp' }, agent)
    expect(text(await call(ctx, 'terminal_read', { sessionId: 'pty-1', offset: 2, count: 3 }, agent))).toContain('history')
  })

  it('declares terminal presentation only for foreground sends', async () => {
    const { ctx } = await setup(false)
    /** 中文说明：变量 definition 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const definition = ctx.tools.get('terminal_send')
    expect(definition?.presentCall?.({ sessionId: 'pty-1', text: 'python3' })).toMatchObject({ card: 'terminal', title: 'python3' })
    expect(definition?.presentCall?.({ sessionId: 'pty-1', text: 'make', run_in_background: true })).toMatchObject({ card: 'generic' })
    expect(definition?.presentCall?.({ sessionId: 'pty-1', text: '' })).toMatchObject({ card: 'terminal', title: '(send input)' })
    expect(definition?.presentResult?.({ sessionId: 'pty-1', text: 'x', run_in_background: true }, { content: [], isError: false })).toBeUndefined()
    expect(definition?.presentResult?.({ sessionId: 'pty-1', text: 'x' }, { content: [], isError: true })).toBeUndefined()
    expect(definition?.presentResult?.({ sessionId: 'pty-1', text: 'x' }, { content: [], isError: false })).toBeUndefined()
    expect(definition?.presentResult?.({ sessionId: 'pty-1', text: 'x' }, { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], isError: false })).toBeUndefined()
    expect(definition?.presentResult?.({ sessionId: 'pty-1', text: 'x' }, { content: [undefined as never], isError: false })).toBeUndefined()
    expect(definition?.presentResult?.({ sessionId: 'pty-1', text: 'x' }, { content: [{ type: 'text', text: 'ok' }], isError: false })).toEqual({ card: 'terminal', output: 'ok' })

    expect(ctx.tools.get('terminal_open')?.presentCall?.({ type: 'stub' })).toMatchObject({ card: 'generic', title: 'Open terminal stub' })
    expect(ctx.tools.get('terminal_open')?.presentCall?.({ type: 'stub', name: 'main' })).toMatchObject({ card: 'generic', title: 'Open terminal main' })
    expect(ctx.tools.get('terminal_read')?.presentCall?.({ sessionId: 'pty-1' })).toMatchObject({ card: 'generic', title: 'Read terminal pty-1' })
    expect(ctx.tools.get('terminal_signal')?.presentCall?.({ sessionId: 'pty-1', signal: 'SIGINT' })).toMatchObject({ card: 'generic', title: 'Signal terminal pty-1' })
    expect(ctx.tools.get('terminal_close')?.presentCall?.({ sessionId: 'pty-1' })).toMatchObject({ card: 'generic', title: 'Close terminal pty-1' })
    expect(ctx.tools.get('terminal_list')?.presentCall?.({})).toMatchObject({ card: 'generic', title: 'List terminal sessions' })
  })

  it('configuration-gates background sends and validates the final result bound', async () => {
    /** 中文说明：变量 disabled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disabled = await setup(true, { enableRunInBackground: false })
    /** 中文说明：变量 definition 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const definition = disabled.ctx.tools.get('terminal_send')
    expect(definition?.parameters).not.toHaveProperty('properties.run_in_background')
    expect(definition?.description).not.toContain('Background mode')
    await call(disabled.ctx, 'terminal_open', { type: 'stub' }, disabled.agent)
    expect((await call(disabled.ctx, 'terminal_send', {
      sessionId: 'pty-1', text: 'work', run_in_background: true,
    }, disabled.agent)).isError).toBe(true)

    /** 中文说明：变量 defaults 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const defaults = await setupBase(false)
    ToolPty.apply(defaults.ctx)
    expect(defaults.ctx.tools.get('terminal_send')?.parameters).toHaveProperty('properties.run_in_background')

    /** 中文说明：变量 invalid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalid = await setupBase(false)
    expect(() => { ToolPty.apply(invalid.ctx, { maxResultBytes: 0 }) }).toThrow('maxResultBytes')
    expect(() => { ToolPty.apply(invalid.ctx, { maxResultBytes: 63 }) }).toThrow('at least 64')
  })

  it('bounds normalized errors and preserves allocated ids at the minimum result cap', async () => {
    const { ctx, agent } = await setup(true, { maxResultBytes: 64 })
    /** 中文说明：变量 failed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failed = await call(ctx, 'terminal_open', { type: 'x'.repeat(1_000) }, agent)
    expect(failed.isError).toBe(true)
    expect(Buffer.byteLength(text(failed))).toBeLessThanOrEqual(64)
    expect(text(failed)).toContain('[output truncated]')

    /** 中文说明：变量 opened 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const opened = await call(ctx, 'terminal_open', { type: 'stub', name: 'n'.repeat(1_000) }, agent)
    expect(text(opened)).toContain('pty-1')
    expect(Buffer.byteLength(text(opened))).toBeLessThanOrEqual(64)
    /** 中文说明：变量 background 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const background = await call(ctx, 'terminal_send', {
      sessionId: 'pty-1', text: 'work', run_in_background: true,
    }, agent)
    expect(text(background)).toContain('pty-send-1')
    expect(Buffer.byteLength(text(background))).toBeLessThanOrEqual(64)
  })

  it('bounds terminal results after policy decisions and pipeline failures', async () => {
    const { ctx, agent } = await setup(false, { maxResultBytes: 64 })
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name === 'terminal_list') return { kind: 'deny', reason: 'd'.repeat(1_000) }
      if (exec.name === 'terminal_signal') throw new Error(`pre failed: ${'p'.repeat(1_000)}`)
      return next()
    })
    ctx.on('tools/execute', async (exec, next) => {
      if (exec.name === 'terminal_close') throw new Error(`around failed: ${'e'.repeat(1_000)}`)
      return next()
    })
    ctx.on('tools/post-execute', async (exec, _result, next) => {
      if (exec.name === 'terminal_open') {
        return { kind: 'accept', content: [{ type: 'text', text: 'a'.repeat(1_000) }] }
      }
      if (exec.name === 'terminal_read') {
        return { kind: 'block', feedback: [{ type: 'text', text: 'b'.repeat(1_000) }] }
      }
      if (exec.name === 'terminal_send') throw new Error(`post failed: ${'o'.repeat(1_000)}`)
      return next()
    })

    /** 中文说明：变量 denied 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const denied = await call(ctx, 'terminal_list', {}, agent)
    expect(denied.isError).toBe(true)
    expect(Buffer.byteLength(text(denied))).toBeLessThanOrEqual(64)
    expect(text(denied)).toContain('[output truncated]')

    /** 中文说明：变量 replaced 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replaced = await call(ctx, 'terminal_open', { type: 'stub' }, agent)
    expect(replaced.isError).toBe(false)
    expect(Buffer.byteLength(text(replaced))).toBeLessThanOrEqual(64)
    expect(text(replaced)).toContain('[output truncated]')

    /** 中文说明：变量 blocked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blocked = await call(ctx, 'terminal_read', { sessionId: 'pty-1' }, agent)
    expect(blocked.isError).toBe(true)
    expect(Buffer.byteLength(text(blocked))).toBeLessThanOrEqual(64)
    expect(text(blocked)).toContain('[output truncated]')

    /** 中文说明：变量 failures 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failures = [
      await call(ctx, 'terminal_signal', { sessionId: 'pty-1', signal: 'SIGINT' }, agent),
      await call(ctx, 'terminal_close', { sessionId: 'pty-1' }, agent),
      await call(ctx, 'terminal_send', { sessionId: 'pty-1', text: 'work' }, agent),
    ]
    /** 中文说明：该循环依次处理输入或事件；循环变量仅在当前循环中有效。 */
    for (const failure of failures) {
      expect(failure.isError).toBe(true)
      expect(Buffer.byteLength(text(failure))).toBeLessThanOrEqual(64)
      expect(text(failure)).toContain('[output truncated]')
    }
  })

  it('leaves a structured around-dispatch failure unchanged', async () => {
    const { ctx, agent } = await setup(false, { maxResultBytes: 64 })
    ctx.on('tools/execute', async (exec, next) => exec.name === 'terminal_list'
      ? { content: [], isError: true, error: { message: 'structured failure' } }
      : next())
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await call(ctx, 'terminal_list', {}, agent)
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([])
  })
})

describe('tool-terminal task integration', () => {
  it('registers a generic task and exposes incremental output', async () => {
    const { ctx, agent } = await setup(true)
    await call(ctx, 'terminal_open', { type: 'stub' }, agent)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await call(ctx, 'terminal_send', { sessionId: 'pty-1', text: 'build', run_in_background: true }, agent)
    expect(text(started)).toBe('started background job pty-send-1')
    expect(started).toMatchObject({ isError: false, value: { kind: 'background', jobId: 'pty-send-1' } })
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = await call(ctx, 'job_output', { job_id: 'pty-send-1', wait: true }, agent)
    expect(text(output)).toContain('live output')
    expect(text(output)).toContain('[status: completed, wait: stdin_read]')
  })

  it('bounds foreground and background results after terminal and task metadata', async () => {
    const { ctx, agent, stub } = await setup(true, { maxResultBytes: 64 })
    await call(ctx, 'terminal_open', { type: 'stub' }, agent)
    stub.sessions[0]!.viewport = '界'.repeat(100)
    /** 中文说明：变量 foreground 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreground = await call(ctx, 'terminal_send', { sessionId: 'pty-1', text: 'foreground' }, agent)
    expect(Buffer.byteLength(text(foreground))).toBeLessThanOrEqual(64)

    stub.sessions[0]!.delta = '界'.repeat(100)
    stub.sessions[0]!.deltaTruncated = true
    await call(ctx, 'terminal_send', { sessionId: 'pty-1', text: 'background', run_in_background: true }, agent)
    /** 中文说明：变量 background 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const background = await call(ctx, 'job_output', { job_id: 'pty-send-1', wait: true }, agent)
    expect(Buffer.byteLength(text(background))).toBeLessThanOrEqual(64)
    expect(text(background)).toContain('[status: completed')
    expect(text(background).match(/\[output truncated\]/g)).toHaveLength(1)
    expect(text(background)).toContain('[output truncated]\n[status: completed')
  })

  it('rejects pre-aborted background calls, maps job cancellation, and contains operation failure', async () => {
    const { ctx, agent, stub } = await setup(true)
    await call(ctx, 'terminal_open', { type: 'stub' }, agent)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort()
    expect((await callWithSignal(ctx, 'terminal_send', { sessionId: 'pty-1', text: 'x', run_in_background: true }, agent, controller.signal)).isError).toBe(true)

    stub.sessions[0]!.autoSettle = false
    expect(text(await call(ctx, 'terminal_send', { sessionId: 'pty-1', text: '', run_in_background: true }, agent))).toContain('pty-send-1')
    expect(text(await call(ctx, 'job_kill', { job_id: 'pty-send-1' }, agent))).toContain('requested cancellation')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(text(await call(ctx, 'job_output', { job_id: 'pty-send-1' }, agent))).toContain('[status: killed')

    stub.sessions[0]!.rejectOperation = true
    stub.sessions[0]!.autoSettle = false
    expect(text(await call(ctx, 'terminal_send', { sessionId: 'pty-1', text: 'bad', run_in_background: true }, agent))).toContain('pty-send-2')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(text(await call(ctx, 'job_output', { job_id: 'pty-send-2' }, agent))).toContain('[status: failed')
  })

  it('reports foreground cancellation after the terminal operation settles', async () => {
    const { ctx, agent, stub } = await setup(false)
    await call(ctx, 'terminal_open', { type: 'stub' }, agent)
    stub.sessions[0]!.autoSettle = false
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = callWithSignal(ctx, 'terminal_send', { sessionId: 'pty-1', text: 'sleep' }, agent, controller.signal)
    await Promise.resolve()
    controller.abort()
    stub.sessions[0]!.operation?.cancel()
    expect((await pending).isError).toBe(true)
  })

  it('renders the already-closing kill result', async () => {
    const { ctx, agent, stub } = await setup(false)
    await call(ctx, 'terminal_open', { type: 'stub' }, agent)
    stub.sessions[0]!.closeGate = Promise.withResolvers<undefined>()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = ctx.terminals.kill(agent, TerminalSessionId('pty-1'))
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = call(ctx, 'terminal_close', { sessionId: 'pty-1' }, agent)
    stub.sessions[0]!.closeGate?.resolve(undefined)
    await first
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await second
    expect(text(result)).toBe('terminal session pty-1 was already closing')
    expect(result).toMatchObject({ isError: false, value: { sessionId: 'pty-1', outcome: 'already-closing' } })
  })

  it('renders an exited session detail for background completion', async () => {
    const { ctx, agent, stub } = await setup(true)
    await call(ctx, 'terminal_open', { type: 'stub' }, agent)
    stub.sessions[0]!.statusValue = { kind: 'exited', exitCode: null, signal: null }
    await call(ctx, 'terminal_send', { sessionId: 'pty-1', text: 'exit', run_in_background: true }, agent)
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = await call(ctx, 'job_output', { job_id: 'pty-send-1', wait: true }, agent)
    expect(text(output)).toContain('session exited: unknown')
  })
})

describe('tool-terminal plugin shape', () => {
  it('is a named function plugin with no default export', () => {
    expect('default' in ToolPty).toBe(false)
    expect(ToolPty.name).toBe('tool-terminal')
    expect(ToolPty.inject).toEqual(['terminals', 'tools', 'systemPrompt'])
  })
})
