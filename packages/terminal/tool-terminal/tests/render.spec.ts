/**
 * 文件职责：验证 render.spec.ts 覆盖的终端会话行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的终端会话能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */
import { describe, expect, it } from 'vitest'
import { TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import { boundTerminalText, renderList, renderRead, renderSend, renderSendRead, renderSpawn } from '@deepseek-ai/dsh-tool-terminal/src/render.ts'

describe('tool-terminal rendering', () => {
  it('renders spawn with and without names or MOTD', () => {
    expect(renderSpawn({ sessionId: TerminalSessionId('pty-1'), type: 'shell', status: { kind: 'running' }, motd: '' }, 1024))
      .toBe('started terminal session pty-1 [type: shell]\n(no startup output)')
    expect(renderSpawn({ sessionId: TerminalSessionId('pty-2'), name: 'main', type: 'shell', pid: 2, status: { kind: 'running' }, motd: 'ready' }, 1024))
      .toContain('pty-2 (main)')
  })

  it('renders running, exited, empty, and truncated sends', () => {
    expect(renderSend({ viewport: '', waitReason: 'timeout', sessionStatus: { kind: 'running' }, truncated: true }, 1024))
      .toBe('(no new output)\n[wait: timeout]\n[session: running]\n[output truncated]')
    expect(renderSend({ viewport: 'bye', waitReason: 'session_exit', sessionStatus: { kind: 'exited', exitCode: null, signal: 'SIGTERM' }, truncated: false }, 1024))
      .toContain('exited code=null signal=SIGTERM')
    expect(renderSend({ viewport: 'bye', waitReason: 'session_exit', sessionStatus: { kind: 'exited', exitCode: 2, signal: null }, truncated: false }, 1024))
      .toContain('exited code=2 signal=null')
    expect(renderSend({ viewport: 'bye', waitReason: 'session_exit', sessionStatus: { kind: 'exited', exitCode: null, signal: null }, truncated: false }, 1024))
      .toContain('exited code=null signal=null')
    expect(renderSendRead({ delta: '', truncated: true })).toBe('[output truncated]')
    expect(renderSendRead({ delta: 'x', truncated: true })).toBe('x\n[output truncated]')
    expect(renderSendRead({ delta: 'x\n', truncated: true })).toBe('x\n[output truncated]')
    expect(renderSendRead({ delta: 'x', truncated: false })).toBe('x')
  })

  it('renders history and every list status shape', () => {
    expect(renderRead({ text: '', totalLines: 0, lineBegin: 0, lineEnd: 0, truncated: true }, 1024))
      .toBe('(no retained output)\n[lines: 0-0 of 0]\n[output truncated]')
    expect(renderList([], 1024)).toBe('(no terminal sessions)')
    expect(renderList([
      { sessionId: TerminalSessionId('pty-1'), type: 'shell', status: { kind: 'running' } },
      { sessionId: TerminalSessionId('pty-2'), name: 'done', type: 'shell', pid: 9, status: { kind: 'exited', exitCode: 2, signal: null } },
      { sessionId: TerminalSessionId('pty-3'), type: 'shell', status: { kind: 'exited', exitCode: null, signal: 'SIGTERM' } },
      { sessionId: TerminalSessionId('pty-4'), type: 'shell', status: { kind: 'exited', exitCode: null, signal: null } },
    ], 1024)).toBe('pty-1 [shell] running\npty-2 (done) [shell] exited code=2 signal=null pid=9\npty-3 [shell] exited code=null signal=SIGTERM\npty-4 [shell] exited code=null signal=null')
  })

  it('bounds complete UTF-8 results while retaining terminal metadata when it fits', () => {
    /** 中文说明：变量 send 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const send = renderSend({
      viewport: `prefix-${'界'.repeat(40)}`,
      waitReason: 'stdin_read',
      sessionStatus: { kind: 'running' },
      truncated: false,
    }, 64)
    expect(Buffer.byteLength(send)).toBeLessThanOrEqual(64)
    expect(send).toContain('[wait: stdin_read]')
    expect(send).toContain('[output truncated]')

    /** 中文说明：变量 read 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const read = renderRead({
      text: 'x'.repeat(200), totalLines: 20, lineBegin: 0, lineEnd: 10, truncated: false,
    }, 48)
    expect(Buffer.byteLength(read)).toBeLessThanOrEqual(48)
    expect(read).toContain('[lines: 0-10 of 20]')

    expect(Buffer.byteLength(renderSpawn({
      sessionId: TerminalSessionId('pty-1'), type: 'shell', status: { kind: 'running' }, motd: 'x'.repeat(200),
    }, 32))).toBeLessThanOrEqual(32)

    /** 中文说明：变量 boundedSpawn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const boundedSpawn = renderSpawn({
      sessionId: TerminalSessionId('pty-1'), type: 'shell', status: { kind: 'running' }, motd: 'x'.repeat(200),
    }, 96)
    expect(boundedSpawn).toContain('started terminal session pty-1')
    expect(boundedSpawn).toContain('[output truncated]')

    expect(Buffer.byteLength(renderSend({
      viewport: 'x'.repeat(200), waitReason: 'stdin_read', sessionStatus: { kind: 'running' }, truncated: false,
    }, 8))).toBeLessThanOrEqual(8)
    expect(boundTerminalText('x'.repeat(200), 8)).toHaveLength(8)
    expect(boundTerminalText('x'.repeat(200), 32).endsWith('[output truncated]')).toBe(true)
  })
})
