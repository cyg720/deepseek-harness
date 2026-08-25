/**
 * 文件职责：验证 terminal.spec.ts 覆盖的子进程管理行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子进程管理能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IDisposable, IPty } from 'node-pty'
import { LocalTerminalHandle } from '@deepseek-ai/dsh-subprocess-local/src/terminal.ts'
import type {
  ProcessIdentity,
  ProcessInspector,
} from '@deepseek-ai/dsh-subprocess-local/src/process-inspector.ts'
import type { SubprocessTerminalSignal } from '@deepseek-ai/dsh-subprocess'

/** 中文说明：class FakePty 定义本测试所需的数据或行为，用于表达子进程管理场景。 */
class FakePty {
  pid = 123
  readonly writes: string[] = []
  readonly kills: string[] = []
  autoExitOnKill = true
  throwKill = false
  onKill?: () => void
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()

  readonly onData = (listener: (data: string) => void): IDisposable => {
    this.dataListeners.add(listener)
    return { dispose: () => { this.dataListeners.delete(listener) } }
  }

  readonly onExit = (listener: (event: { exitCode: number; signal?: number }) => void): IDisposable => {
    this.exitListeners.add(listener)
    return { dispose: () => { this.exitListeners.delete(listener) } }
  }

  emitData(data: string): void {
    /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
    for (const listener of this.dataListeners) listener(data)
  }

  emitExit(exitCode = 0, signal?: number): void {
    /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
    for (const listener of this.exitListeners) listener({ exitCode, ...signal === undefined ? {} : { signal } })
  }

  write(data: string): void { this.writes.push(data) }

  kill(signal?: string): void {
    if (this.throwKill) throw new Error('process raced')
    this.kills.push(signal ?? 'SIGHUP')
    this.onKill?.()
    if (this.autoExitOnKill) this.emitExit(0, signal === 'SIGKILL' ? 9 : 15)
  }

  asPty(): IPty {
    return this as unknown as IPty
  }
}

/** 中文说明：class FakeInspector 定义本测试所需的数据或行为，用于表达子进程管理场景。 */
class FakeInspector implements ProcessInspector {
  pgid: number | undefined = 456
  waiting = false
  /** The shell's own row, present like the real /proc- and ps-backed scans; tests recycle or drop it. */
  root: ProcessIdentity | undefined = { pid: 123, started: 'shell' }
  members: ProcessIdentity[] = []
  sessionMembers: ProcessIdentity[] = []
  readonly alive = new Set<number>()
  readonly groups: Array<[number, SubprocessTerminalSignal]> = []
  readonly processes: Array<[number, 'SIGTERM' | 'SIGKILL']> = []
  throwGroup = false
  throwProcess = false
  removeOnSignal = true

  foregroundPgid() { return this.pgid }
  isStdinWaiting() { return this.waiting }
  processTree() { return this.root === undefined ? this.members : [this.root, ...this.members] }
  processSession() { return this.sessionMembers }
  isAlive(identity: ProcessIdentity) { return this.alive.has(identity.pid) }
  signalGroup(pgid: number, signal: SubprocessTerminalSignal) {
    if (this.throwGroup) throw new Error('group failed')
    this.groups.push([pgid, signal])
  }
  signalProcess(identity: ProcessIdentity, signal: 'SIGTERM' | 'SIGKILL') {
    // Mirrors the real inspectors' alive-gated signalling.
    if (!this.alive.has(identity.pid)) return
    if (this.throwProcess) throw new Error('process raced')
    if (!this.isAlive(identity)) return
    this.processes.push([identity.pid, signal])
    if (this.removeOnSignal) this.alive.delete(identity.pid)
  }
}

afterEach(() => { vi.useRealTimers() })

/** 中文说明：函数 makeHandle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function makeHandle(pty: FakePty, inspector: ProcessInspector, graceMs: number): LocalTerminalHandle {
  // The suite pins POSIX signalling semantics deterministically on every host;
  // the win32 branches get their own platform-explicit tests below.
  return new LocalTerminalHandle(pty.asPty(), inspector, graceMs, 'linux')
}

describe('LocalTerminalHandle', () => {
  it('force-kills descendants around the shell during synchronous host exit', () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = { pid: 124, started: 'first' }
    /** 中文说明：变量 late 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const late = { pid: 125, started: 'late' }
    inspector.members = [first]
    inspector.alive.add(pty.pid)
    inspector.alive.add(first.pid)
    /** 中文说明：变量 signalProcess 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signalProcess = inspector.signalProcess.bind(inspector)
    inspector.signalProcess = (identity, signal) => {
      signalProcess(identity, signal)
      if (identity.pid === pty.pid) {
        inspector.members = [first, late]
        inspector.alive.add(late.pid)
      }
    }
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)

    handle.terminateForHostExit()
    expect(inspector.processes).toEqual([
      [first.pid, 'SIGKILL'],
      [pty.pid, 'SIGKILL'],
      [late.pid, 'SIGKILL'],
    ])
    expect(pty.kills).toEqual([])

    pty.emitExit()
    handle.terminateForHostExit()
    expect(pty.kills).toEqual([])
  })

  it('uses captured identities and contains shell races when final inspection fails', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 captured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const captured = { pid: 124, started: 'captured' }
    inspector.members = [captured]
    inspector.alive.add(pty.pid)
    inspector.alive.add(captured.pid)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)
    await handle.inspectForeground()
    inspector.processTree = () => { throw new Error('process table unavailable') }
    inspector.throwProcess = true

    expect(() => { handle.terminateForHostExit() }).not.toThrow()
    expect(inspector.processes).toEqual([])
    expect(pty.kills).toEqual([])
  })

  it('uses node-pty only when the shell start identity was unavailable', () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    inspector.root = undefined
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)

    handle.terminateForHostExit()
    expect(pty.kills).toEqual(['SIGKILL'])

    /** 中文说明：变量 racingPty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const racingPty = new FakePty()
    /** 中文说明：变量 racingInspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const racingInspector = new FakeInspector()
    racingInspector.root = undefined
    racingPty.throwKill = true
    /** 中文说明：变量 racingHandle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const racingHandle = new LocalTerminalHandle(racingPty.asPty(), racingInspector, 10)
    expect(() => { racingHandle.terminateForHostExit() }).not.toThrow()
  })

  it('does not signal a recycled terminal root before its delayed exit callback', () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    inspector.alive.add(pty.pid)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10)
    inspector.root = { pid: pty.pid, started: 'recycled' }
    inspector.isAlive = identity => identity.started === 'recycled'

    handle.terminateForHostExit()

    expect(inspector.processes).toEqual([])
    expect(pty.kills).toEqual([])
  })

  it('bridges terminal bytes, foreground control, and signalled exit facts', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    inspector.waiting = true
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 10)
    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks: Buffer[] = []
    handle.output.on('data', (chunk: Buffer) => { chunks.push(chunk) })

    pty.emitData('hello €')
    await handle.write('input\r')
    expect(pty.writes).toEqual(['input\r'])
    expect(await handle.inspectForeground()).toEqual({ processGroupId: 456, inputWaiting: true })
    expect(await handle.signalForeground('SIGINT')).toBe(456)
    expect(inspector.groups).toEqual([[456, 'SIGINT']])

    pty.emitExit(7, 9)
    pty.emitExit(0)
    expect(await handle.done).toEqual({ exitCode: null, signal: 'SIGKILL' })
    await handle.terminate()
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello €')
  })

  it('rejects unsafe foreground signals and writes after exit', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 10)
    inspector.pgid = handle.pid
    await expect(handle.signalForeground('SIGKILL')).rejects.toThrow('terminate the terminal session')
    inspector.pgid = undefined
    expect(await handle.inspectForeground()).toBeUndefined()
    await expect(handle.signalForeground('SIGTERM')).rejects.toThrow('cannot resolve')

    pty.emitExit(3)
    expect(await handle.done).toEqual({ exitCode: 3, signal: null })
    await handle.terminate()
    await expect(handle.write('late')).rejects.toThrow('has exited')
  })

  it('keeps the shell alive until forced descendants leave', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    inspector.members = [{ pid: 124, started: 'child' }]
    inspector.alive.add(124)
    inspector.removeOnSignal = false
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 20)

    /** 中文说明：变量 quiescent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const quiescent = handle.terminate()
    expect(handle.terminate()).toBe(quiescent)
    await vi.advanceTimersByTimeAsync(20)
    expect(inspector.processes).toContainEqual([124, 'SIGKILL'])
    expect(pty.kills).toEqual([])

    inspector.alive.delete(124)
    await vi.advanceTimersByTimeAsync(20)
    await quiescent
    expect(pty.kills).toEqual(['SIGTERM'])
  })

  it('keeps an early exit wait pending through descendant cleanup', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    inspector.members = [{ pid: 124, started: 'child' }]
    inspector.alive.add(124)
    inspector.removeOnSignal = false
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 20)
    pty.emitExit()
    /** 中文说明：变量 waiting 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const waiting = handle.terminate()
    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    void waiting.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(10)
    expect(settled).toBe(false)

    inspector.alive.delete(124)
    await vi.advanceTimersByTimeAsync(20)
    await waiting
  })

  it('cleans a same-session descendant after the top-level shell exits naturally', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 disowned 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disowned = { pid: 124, started: 'disowned' }
    inspector.processSession = () => inspector.alive.has(disowned.pid) ? [disowned] : []
    inspector.alive.add(124)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 20)

    pty.emitExit()

    await handle.terminate()
    expect(inspector.processes).toEqual([[124, 'SIGTERM']])
  })

  it('retains an inspected descendant after it reparents away from the shell', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 descendant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const descendant = { pid: 124, started: 'observed' }
    inspector.members = [descendant]
    inspector.alive.add(descendant.pid)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 20)

    await handle.inspectForeground()
    inspector.members = []
    pty.emitExit()

    await handle.terminate()
    expect(inspector.processes).toEqual([[124, 'SIGTERM']])
  })

  it('does not adopt the children of a recycled shell pid', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 10)

    pty.emitExit()
    /** 中文说明：变量 imposterChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const imposterChild = { pid: 999, started: 'imposter-child' }
    inspector.root = { pid: 123, started: 'imposter' }
    inspector.members = [imposterChild]
    inspector.alive.add(imposterChild.pid)

    await handle.terminate()
    expect(inspector.processes).toEqual([])
  })

  it('adopts nothing when the shell identity was never observable', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    inspector.root = undefined
    /** 中文说明：变量 orphan 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const orphan = { pid: 321, started: 'unverifiable' }
    inspector.members = [orphan]
    inspector.alive.add(orphan.pid)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 10)

    await handle.terminate()
    expect(inspector.processes).toEqual([])
    expect(pty.kills).toEqual(['SIGTERM'])
  })

  it('rescans for descendants forked during TERM', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = { pid: 123, started: 'shell' }
    /** 中文说明：变量 reads 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let reads = 0
    inspector.processTree = () => {
      reads += 1
      if (reads === 1) return [root]
      if (reads === 2) {
        inspector.alive.add(124)
        return [root, { pid: 124, started: 'first' }]
      }
      if (reads === 3) {
        inspector.alive.add(125)
        return [root, { pid: 125, started: 'late' }]
      }
      return []
    }
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 10)
    await handle.terminate()
    expect(inspector.processes).toEqual([[124, 'SIGTERM'], [125, 'SIGKILL']])
    expect(pty.kills).toEqual(['SIGTERM'])
  })

  it('sweeps a same-session descendant forked while the shell handles TERM', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 late 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const late = { pid: 124, started: 'shell-term-trap' }
    pty.onKill = () => {
      inspector.sessionMembers = [late]
      inspector.alive.add(late.pid)
    }
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 10)

    await handle.terminate()

    expect(inspector.processes).toEqual([[late.pid, 'SIGTERM']])
    expect(pty.kills).toEqual(['SIGTERM'])
  })

  it('retries failed cleanup after a surviving descendant leaves', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 late 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const late = { pid: 124, started: 'shell-term-survivor' }
    inspector.removeOnSignal = false
    pty.onKill = () => {
      inspector.sessionMembers = [late]
      inspector.alive.add(late.pid)
    }
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 10)

    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = handle.terminate()
    /** 中文说明：变量 failed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failed = expect(first).rejects.toThrow('surviving pids: 124')
    await vi.advanceTimersByTimeAsync(25)
    await failed

    inspector.alive.delete(late.pid)
    /** 中文说明：变量 retry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const retry = handle.terminate()
    expect(retry).not.toBe(first)
    await retry
    expect(inspector.processes).toEqual([[late.pid, 'SIGTERM'], [late.pid, 'SIGKILL']])
  })

  it('retains captured descendants after reparenting', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 captured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const captured = { pid: 124, started: 'captured' }
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = { pid: 123, started: 'shell' }
    /** 中文说明：变量 reads 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let reads = 0
    inspector.alive.add(captured.pid)
    inspector.processTree = () => { reads += 1; return reads === 1 ? [root] : reads === 2 ? [root, captured] : [] }
    inspector.signalProcess = (identity, signal) => {
      inspector.processes.push([identity.pid, signal])
      if (signal === 'SIGKILL') inspector.alive.delete(identity.pid)
    }
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 20)
    /** 中文说明：变量 quiescent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const quiescent = handle.terminate()
    await vi.advanceTimersByTimeAsync(25)
    await quiescent
    expect(inspector.processes).toEqual([[124, 'SIGTERM'], [124, 'SIGKILL']])
  })

  it('reports a top-level process that ignores escalation', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    pty.autoExitOnKill = false
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, new FakeInspector(), 10)
    /** 中文说明：变量 failed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failed = expect(handle.terminate()).rejects.toThrow('surviving pid: 123')
    await vi.advanceTimersByTimeAsync(25)
    await failed
    expect(pty.kills).toEqual(['SIGTERM', 'SIGKILL'])

    pty.emitExit(0, 999)
    expect(await handle.done).toEqual({ exitCode: null, signal: null })
    await handle.terminate()
  })

  it('contains process races while reporting surviving descendants', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    pty.throwKill = true
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    inspector.members = [{ pid: 124, started: 'child' }]
    inspector.alive.add(124)
    inspector.throwProcess = true
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = makeHandle(pty, inspector, 1)
    await expect(handle.terminate()).rejects.toThrow('surviving pids: 124')
  })
})

describe('LocalTerminalHandle on Windows', () => {
  /** 中文说明：变量 win32 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const win32 = 'win32' as NodeJS.Platform

  it('delivers SIGINT as a Ctrl-C input write without inspector signalling', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10, win32)
    await expect(handle.signalForeground('SIGINT')).resolves.toBe(456)
    expect(pty.writes).toEqual(['\x03'])
    expect(inspector.groups).toEqual([])
  })

  it('rejects SIGTSTP and SIGHUP as unavailable on Windows', async () => {
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(new FakePty().asPty(), new FakeInspector(), 10, win32)
    await expect(handle.signalForeground('SIGTSTP')).rejects.toThrow('unsupported on Windows')
    await expect(handle.signalForeground('SIGHUP')).rejects.toThrow('unsupported on Windows')
  })

  it('routes SIGTERM through the inspector tree with the pseudo foreground group', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10, win32)
    await expect(handle.signalForeground('SIGTERM')).resolves.toBe(456)
    expect(inspector.groups).toEqual([[456, 'SIGTERM']])
    expect(pty.writes).toEqual([])
  })

  it('still refuses to SIGKILL the terminal shell on Windows', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10, win32)
    inspector.pgid = handle.pid
    await expect(handle.signalForeground('SIGKILL')).rejects.toThrow('terminate the terminal session')
  })

  it('escalates the shell through taskkill tiers instead of node-pty signal kills', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    inspector.alive.add(123)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10, win32)
    /** 中文说明：变量 quiescent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const quiescent = handle.terminate()
    await vi.advanceTimersByTimeAsync(5)
    expect(inspector.processes).toEqual([[123, 'SIGTERM']])
    expect(pty.kills).toEqual([])

    pty.emitExit()
    await quiescent
    expect(inspector.processes).toEqual([[123, 'SIGTERM']])
    expect(pty.kills).toEqual([])
  })

  it('reports a shell that survives both taskkill tiers', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    inspector.alive.add(123)
    inspector.removeOnSignal = false
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10, win32)
    /** 中文说明：变量 failed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failed = expect(handle.terminate()).rejects.toThrow('surviving pid: 123')
    await vi.advanceTimersByTimeAsync(25)
    await failed
    expect(inspector.processes).toEqual([[123, 'SIGTERM'], [123, 'SIGKILL']])
    expect(pty.kills).toEqual([])

    pty.emitExit()
    await handle.terminate()
  })

  it('skips taskkill escalation entirely when the shell already exited', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    inspector.alive.add(123)
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10, win32)
    pty.emitExit()
    await handle.terminate()
    expect(inspector.processes).toEqual([])
    expect(pty.kills).toEqual([])
  })

  it('falls back to the bare node-pty kill when the shell identity was never observable', async () => {
    /** 中文说明：变量 pty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pty = new FakePty()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new FakeInspector()
    inspector.root = undefined
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = new LocalTerminalHandle(pty.asPty(), inspector, 10, win32)
    await handle.terminate()
    expect(pty.kills).toHaveLength(1)
    expect(inspector.processes).toEqual([])
  })
})
