/**
 * Deterministic ladder coverage against a scriptable fake child: each
 * escalation tier's timing is driven exactly (the client suite exercises the
 * same ladder against real subprocesses end to end).
 */
/*
 * 文件职责：验证 dispose.spec.ts 覆盖的SDK 通信行为与生命周期。
 * 技术维度：使用 TypeScript、Cordis 插件、Vitest、事件日志或异步传输。
 * 产品维度：保障 Agent 的SDK 通信能力稳定、可追踪且可恢复。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：跨进程数据不可信；持久化状态必须可重放；异步资源必须完全释放。
 * 新手阅读建议：先看导出类型和辅助函数，再读主流程，最后关注错误、恢复和清理。
 */

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { disposeRuntimeProcess } from '../src/dispose.ts'

/** What fells a scripted {@link FakeChild}. */
/* 中文说明：type LethalTrigger 定义本测试所需的数据或行为，用于表达SDK 通信场景。 */
type LethalTrigger = 'eof' | NodeJS.Signals

/** Per-scenario script for a {@link FakeChild}. */
/* 中文说明：interface FakeChildScript 定义本测试所需的数据或行为，用于表达SDK 通信场景。 */
interface FakeChildScript {
  /**
   * The one trigger that makes the child exit (SIGKILL always does,
   * uncatchable, like a real process). Omitted: only SIGKILL fells it.
   */
  diesOn?: LethalTrigger
  /** Delay (ms) between the lethal trigger and the exit event. */
  delayMs?: number
  /** Complete the scripted exit inside the triggering call. */
  synchronousExit?: boolean
  /** `false` models a child spawned without a stdin pipe. */
  stdin?: boolean
}

/**
 * A scriptable stand-in for a ChildProcess carrying exactly the API the
 * ladder reads: `exitCode`/`signalCode`, `stdin.end()`, `kill()`, and the
 * `exit` event.
 */
/* 中文说明：class FakeChild 定义本测试所需的数据或行为，用于表达SDK 通信场景。 */
class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly kills: NodeJS.Signals[] = []
  stdinEnded = false
  readonly stdin: { end: () => void } | null

  constructor(private readonly script: FakeChildScript = {}) {
    super()
    this.stdin = script.stdin === false
      ? null
      : { end: () => { this.stdinEnded = true; this.maybeDie('eof') } }
  }

  kill(signal: NodeJS.Signals): boolean {
    this.kills.push(signal)
    this.maybeDie(signal)
    return true
  }

  private maybeDie(trigger: LethalTrigger): void {
    // SIGKILL is uncatchable — it always fells the child; any other trigger
    // only when the scenario scripts it as the lethal one.
    if (trigger !== 'SIGKILL' && this.script.diesOn !== trigger) return
    /** 中文说明：函数值 exit 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const exit = (): void => {
      if (trigger === 'eof') this.exitCode = 0
      else this.signalCode = trigger
      this.emit('exit', this.exitCode, this.signalCode)
    }
    if (this.script.synchronousExit === true) exit()
    else setTimeout(exit, this.script.delayMs ?? 0)
  }
}

/** The ladder takes a real ChildProcess; the fake carries the read surface. */
/* 中文说明：函数 asChild 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function asChild(fake: FakeChild): ChildProcess {
  return fake as unknown as ChildProcess
}

describe('disposeRuntimeProcess', () => {
  it('returns immediately for an already-exited child (no EOF, no signals)', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild()
    fake.exitCode = 0
    await disposeRuntimeProcess(asChild(fake), { disposeEofGraceMs: 1000, disposeGraceMs: 1000 })
    expect(fake.stdinEnded).toBe(false)
    expect(fake.kills).toEqual([])
  })

  it('returns immediately for a child already dead by signal', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild()
    fake.signalCode = 'SIGKILL'
    await disposeRuntimeProcess(asChild(fake), { disposeEofGraceMs: 1000, disposeGraceMs: 1000 })
    expect(fake.stdinEnded).toBe(false)
    expect(fake.kills).toEqual([])
  })

  it('tier 1: a cooperative child quiesces on stdin EOF — no signal is ever sent', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild({ diesOn: 'eof', delayMs: 5 })
    await disposeRuntimeProcess(asChild(fake), { disposeEofGraceMs: 1000, disposeGraceMs: 1000 })
    expect(fake.stdinEnded).toBe(true)
    expect(fake.kills).toEqual([])
    expect(fake.exitCode).toBe(0)
  })

  it('recognizes a child that exits synchronously on stdin EOF', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild({ diesOn: 'eof', synchronousExit: true })
    await disposeRuntimeProcess(asChild(fake), { disposeEofGraceMs: 1000, disposeGraceMs: 1000 })
    expect(fake.exitCode).toBe(0)
    expect(fake.listenerCount('exit')).toBe(0)
  })

  it('tier 2: a child that ignores EOF but honors SIGTERM dies on the middle rung', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild({ diesOn: 'SIGTERM', delayMs: 5 })
    await disposeRuntimeProcess(asChild(fake), { disposeEofGraceMs: 20, disposeGraceMs: 1000 }, 'linux')
    expect(fake.stdinEnded).toBe(true)
    expect(fake.kills).toEqual(['SIGTERM'])
    expect(fake.signalCode).toBe('SIGTERM')
    expect(fake.listenerCount('exit')).toBe(0)
  })

  it('recognizes a child that exits synchronously on SIGTERM', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild({ diesOn: 'SIGTERM', synchronousExit: true })
    await disposeRuntimeProcess(asChild(fake), { disposeEofGraceMs: 20, disposeGraceMs: 1000 }, 'linux')
    expect(fake.kills).toEqual(['SIGTERM'])
    expect(fake.signalCode).toBe('SIGTERM')
    expect(fake.listenerCount('exit')).toBe(0)
  })

  it('tier 3: a SIGTERM-trapping child is SIGKILLed, and dispose resolves only after the exit', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild({ delayMs: 5 }) // only SIGKILL fells it
    await disposeRuntimeProcess(asChild(fake), { disposeEofGraceMs: 20, disposeGraceMs: 20 }, 'linux')
    expect(fake.kills).toEqual(['SIGTERM', 'SIGKILL'])
    // Quiescence, not a request: at resolution the child has ACTUALLY exited
    // (the exit event landed, despite the scripted post-SIGKILL delay).
    expect(fake.signalCode).toBe('SIGKILL')
  })

  it('recognizes a child already gone when the final exit wait begins', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild({ synchronousExit: true })
    await disposeRuntimeProcess(asChild(fake), { disposeEofGraceMs: 20, disposeGraceMs: 20 }, 'linux')
    expect(fake.kills).toEqual(['SIGTERM', 'SIGKILL'])
    expect(fake.signalCode).toBe('SIGKILL')
  })

  it.each(['exitCode', 'signalCode'] as const)('accepts a late OS %s marker before the final forced wait', async (marker) => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild()
    vi.spyOn(fake, 'kill').mockImplementation((signal) => {
      fake.kills.push(signal)
      queueMicrotask(() => {
        if (marker === 'exitCode') fake.exitCode = 0
        else fake.signalCode = 'SIGTERM'
      })
      return true
    })

    await disposeRuntimeProcess(asChild(fake), { disposeEofGraceMs: 1, disposeGraceMs: 10 }, 'linux')
    expect(fake.kills).toEqual(['SIGTERM'])
  })

  it('walks the ladder for a child spawned without a stdin pipe', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild({ stdin: false, diesOn: 'SIGTERM', delayMs: 5 })
    await disposeRuntimeProcess(asChild(fake), { disposeEofGraceMs: 20, disposeGraceMs: 1000 }, 'linux')
    expect(fake.kills).toEqual(['SIGTERM'])
  })

  it('skips the redundant SIGTERM tier on Windows and awaits forced exit', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild({ diesOn: 'SIGTERM', delayMs: 5 })
    await disposeRuntimeProcess(asChild(fake), { disposeEofGraceMs: 20, disposeGraceMs: 1000 }, 'win32')
    expect(fake.kills).toEqual(['SIGKILL'])
    expect(fake.signalCode).toBe('SIGKILL')
  })

  it('propagates a forced-termination error without waiting for the grace', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild()
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
    vi.spyOn(fake, 'kill').mockImplementation((signal) => {
      fake.kills.push(signal)
      fake.emit('error', failure)
      return false
    })

    await expect(disposeRuntimeProcess(
      asChild(fake),
      { disposeEofGraceMs: 1, disposeGraceMs: 1000 },
      'win32',
    )).rejects.toBe(failure)
    expect(fake.kills).toEqual(['SIGKILL'])
    expect(fake.listenerCount('error')).toBe(0)
    expect(fake.listenerCount('exit')).toBe(0)
  })

  it('wraps a synchronous forced-termination exception and removes its listeners', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild()
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new Error('invalid signal state')
    vi.spyOn(fake, 'kill').mockImplementation(() => { throw failure })

    await expect(disposeRuntimeProcess(
      asChild(fake),
      { disposeEofGraceMs: 1, disposeGraceMs: 1000 },
      'win32',
    )).rejects.toMatchObject({ message: 'SIGKILL failed', cause: failure })
    expect(fake.listenerCount('error')).toBe(0)
    expect(fake.listenerCount('exit')).toBe(0)
  })

  it('bounds a refused forced termination that produces no error or exit', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild()
    vi.spyOn(fake, 'kill').mockImplementation((signal) => {
      fake.kills.push(signal)
      return false
    })

    await expect(disposeRuntimeProcess(
      asChild(fake),
      { disposeEofGraceMs: 1, disposeGraceMs: 10 },
      'win32',
    )).rejects.toThrow('runtime process did not exit within 10ms after SIGKILL was refused')
    expect(fake.listenerCount('error')).toBe(0)
    expect(fake.listenerCount('exit')).toBe(0)
  })

  it('bounds an accepted forced termination that never reports exit', async () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = new FakeChild()
    vi.spyOn(fake, 'kill').mockImplementation((signal) => {
      fake.kills.push(signal)
      return true
    })

    await expect(disposeRuntimeProcess(
      asChild(fake),
      { disposeEofGraceMs: 1, disposeGraceMs: 10 },
      'win32',
    )).rejects.toThrow('runtime process did not exit within 10ms after SIGKILL was accepted')
    expect(fake.listenerCount('error')).toBe(0)
    expect(fake.listenerCount('exit')).toBe(0)
  })
})
