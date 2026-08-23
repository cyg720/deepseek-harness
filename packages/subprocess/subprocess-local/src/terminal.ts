/** Local node-pty terminal-process implementation for the subprocess seam. */
/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现子进程缝的本地终端进程：LocalTerminalHandle 把 node-pty 的 PTY 会话
 * 包装为 SubprocessTerminalHandle，负责输出转发、退出事实、前台组检查/发信号与
 * 整会话树拆解（后代先 SIGTERM→SIGKILL，再终止 shell）。
 * 【技术维度】node-pty 事件（onData/onExit）驱动；进程表检查经 process-inspector.ts；
 * 身份围栏（rootIdentity 与各后代的 started）防 PID 复用误杀；Windows 拆解用
 * taskkill 树终止并补充 settleExitIfGone（外部 taskkill 不触发 node-pty 退出通知时
 * 手动落定 done）。
 * 【产品维度】持久化终端（bash/pwsh persistent 工具）与终端原语的本地后端：
 * 命令回显/提示符/滚动区都真实、Ctrl-C 可投递（\x03）、拆解不留孤儿进程。
 * 【逻辑维度】构造（输出与退出转发）→ write/inspectForeground/signalForeground →
 * terminate（closeOnce：后代终止→shell 终止→再后代终止→落定 done）→ 宿主退出
 * 同步强杀（terminateForHostExit）。
 * 【关键边界】handle 契约要求落定后无 write/检查/信号在途——本地因全部同步得以
 * 成立，首个真正异步步骤必须补操作跟踪；Windows 信号子集限制；SIGKILL 直指 shell
 * 被拒绝（须用 terminate）。
 * 【新手阅读建议】先看 done 的落定路径（onExit + settleExitIfGone），再看
 * descendants/unionMembers 的后代收养与身份围栏，最后看 stopDescendants 的升级终止。
 * ==========================================================================
 */

import { Buffer } from 'node:buffer'
import { constants } from 'node:os'
import { PassThrough } from 'node:stream'
import type { IDisposable, IPty } from 'node-pty'
import type {
  SubprocessOutcome,
  SubprocessTerminalForeground,
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
} from '@deepseek-ai/dsh-subprocess'
import type { ProcessIdentity, ProcessInspector } from './process-inspector.ts'

/** 简单延时工具（拆解等待用）。 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 把 node-pty 的数字信号转为 NodeJS.Signals 名称（0/未定义视为无信号）。 */
function signalName(number: number | undefined): NodeJS.Signals | null {
  if (number === undefined || number === 0) return null
  for (const [name, value] of Object.entries(constants.signals)) {
    if (value === number) return name as NodeJS.Signals
  }
  return null
}

/**
 * A local terminal whose process-session ownership stays below the PTY backend.
 * The seam's terminate() promise — no write, inspection, or signal in flight
 * after settlement — holds here without operation tracking only because every
 * handle call completes synchronously under the hood (node-pty write, ps-based
 * inspection). A first genuinely asynchronous step in any handle call must add
 * the tracking a remote provider needs.
 */
/**
 * 本地终端：进程会话所有权保持在 PTY 后端之下。契约要求的 terminate() promise
 * （落定后无 write/检查/信号在途）在这里无需操作跟踪即成立，因为每个句柄调用
 * 底层都是同步完成的（node-pty write、ps 检查）。任何句柄调用出现第一个真正的
 * 异步步骤时，必须补上远程提供者所需的操作跟踪。
 */
export class LocalTerminalHandle implements SubprocessTerminalHandle {
  readonly pid: number
  readonly output = new PassThrough()
  readonly done: Promise<SubprocessOutcome>

  private readonly outcome = Promise.withResolvers<SubprocessOutcome>()
  private readonly dataDisposable: IDisposable
  private readonly exitDisposable: IDisposable
  private cleanup: Promise<void> | undefined
  private exited = false
  private trackedDescendants: ProcessIdentity[] = []
  /** The spawned shell's start identity; scans stop adopting members once the root pid no longer carries it. */
  /** 被 spawn 的 shell 的启动身份；根 pid 不再携带该身份后，扫描停止收养新成员。 */
  private readonly rootIdentity: ProcessIdentity | undefined

  /**
   * @param terminal - allocated node-pty process.
   * @param inspector - platform process/session operations.
   * @param graceMs - TERM-to-KILL and exit-wait grace.
   * @param platform - host platform; defaults to the running platform, injectable for deterministic tests.
   */
  constructor(
    private readonly terminal: IPty,
    private readonly inspector: ProcessInspector,
    private readonly graceMs: number,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.pid = terminal.pid
    this.rootIdentity = inspector.processTree(this.pid).find(member => member.pid === this.pid)
    this.done = this.outcome.promise
    // 输出转发：node-pty 的 onData 写到 PassThrough 流。
    this.dataDisposable = terminal.onData((data) => { this.output.write(Buffer.from(data, 'utf8')) })
    // 退出落定：首次 onExit 后结束输出流并解析退出事实（exitSignal 0/undefined 视为正常退出）。
    this.exitDisposable = terminal.onExit(({ exitCode, signal: exitSignal }) => {
      if (this.exited) return
      this.exited = true
      this.output.end()
      this.outcome.resolve({
        exitCode: exitSignal === undefined || exitSignal === 0 ? exitCode : null,
        signal: signalName(exitSignal),
      })
    })
  }

  // node-pty writes synchronously; the seam returns a promise for remote transports.
  // node-pty 的 write 是同步的；契约返回 promise 是为远程传输保留（注释置于 pragma 上方）。
  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  async write(data: string): Promise<void> {
    if (this.exited) throw new Error('terminal process has exited')
    this.terminal.write(data)
  }

  // Local inspection is synchronous; the seam returns a promise for remote transports.
  // 本地检查是同步的；契约返回 promise 是为远程传输保留（注释置于 pragma 上方）。
  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  async inspectForeground(): Promise<SubprocessTerminalForeground | undefined> {
    this.descendants()
    const processGroupId = this.inspector.foregroundPgid(this.pid)
    if (processGroupId === undefined) return undefined
    return {
      processGroupId,
      inputWaiting: this.inspector.isStdinWaiting(processGroupId),
    }
  }

  /** 给前台进程组发信号；SIGKILL 直指 shell 被拒绝（应整体终止会话）；Windows 上 SIGINT 用 \x03 输入投递。 */
  async signalForeground(signal: SubprocessTerminalSignal): Promise<number> {
    const foreground = await this.inspectForeground()
    if (foreground === undefined) {
      throw new Error(`cannot resolve foreground process group for terminal ${this.pid}`)
    }
    if (signal === 'SIGKILL' && foreground.processGroupId === this.pid) {
      throw new Error('refusing to SIGKILL the terminal shell; terminate the terminal session instead')
    }
    if (this.platform === 'win32') {
      if (signal === 'SIGINT') {
        // Windows has no process-group signalling: a `\x03` input write is the
        // Ctrl-C delivery path conhost turns into a console-wide CTRL_C event
        // for attached processes. node-pty's signal kills throw on Windows, so
        // no signal ever reaches the inspector.
        // Windows 无进程组信号：\x03 输入写入是 Ctrl-C 投递路径，conhost 会把它转为
        // 附加进程的控制台级 CTRL_C 事件；node-pty 的 signal kill 在 Windows 上会抛，
        // 因此信号永不抵达检查器。
        this.terminal.write('\x03')
        return foreground.processGroupId
      }
      if (signal === 'SIGTSTP' || signal === 'SIGHUP') {
        throw new Error(`signal ${signal} is unsupported on Windows; only SIGINT, SIGTERM, and SIGKILL are available`)
      }
    }
    this.inspector.signalGroup(foreground.processGroupId, signal)
    return foreground.processGroupId
  }

  /** 幂等终止：首次调用启动 closeOnce 并缓存；失败时允许重试。 */
  terminate(): Promise<void> {
    if (this.cleanup !== undefined) return this.cleanup
    const cleanup = this.closeOnce()
    this.cleanup = cleanup
    void cleanup.catch(() => { this.cleanup = undefined })
    return cleanup
  }

  /**
   * Force-terminate the observable session synchronously during Node's exit
   * event. This does not claim quiescence and does not replace terminate().
   */
  /**
   * 在 Node 退出事件期间同步强制终止可观测会话。这不声称静默，也不替代 terminate()。
   */
  terminateForHostExit(): void {
    this.forceStopDescendants()
    this.forceStopShell()
    this.forceStopDescendants()
  }

  /** 强杀 shell：优先按身份发 SIGKILL（覆盖退出竞态与 PID 复用），无身份时退回 node-pty kill。 */
  private forceStopShell(): void {
    if (this.exited) return
    if (this.rootIdentity !== undefined) {
      try {
        this.inspector.signalProcess(this.rootIdentity, 'SIGKILL')
      } catch (_rootExitedDuringHostExit) {
        // Exact identity signalling contains both exit races and PID reuse.
        // 精确身份发信号同时覆盖退出竞态与 PID 复用。
      }
      return
    }
    try {
      this.terminal.kill('SIGKILL')
    } catch (_unidentifiedShellExitedDuringHostExit) {
      // Without a captured identity, node-pty is the only root kill primitive.
      // 未捕获到身份时，node-pty 是唯一的根终止原语。
    }
  }

  /** 过滤出仍然存活的成员（按身份复核）。 */
  private survivors(members: ProcessIdentity[]): ProcessIdentity[] {
    return members.filter(member => this.inspector.isAlive(member))
  }

  /**
   * 收养后代：仅当数值根 pid 仍携带被 spawn shell 的启动身份时才收养新扫描到的成员
   * （shell 死后，被复用的 pid 的树/会话不得把无关进程的孩子捐给本会话的信号）；
   * 已收养成员保留自己的启动身份，每次发信号都复核。
   */
  private descendants(): ProcessIdentity[] {
    // Adopt newly scanned members only while the numeric root pid provably
    // still carries the spawned shell's start identity: after the shell dies,
    // a recycled pid's tree and session must not donate an unrelated
    // process's children to this session's signalling. Already-adopted
    // members keep their own start identities, which every signal rechecks.
    // 仅当数值根 pid 可证明仍携带被 spawn shell 的启动身份时才收养新成员：shell 死后，
    // 被复用的 pid 的树与会话不得把无关进程的孩子捐给本会话的信号；已收养成员保留
    // 自己的启动身份，每次信号都会复核。
    const tree = this.inspector.processTree(this.pid)
    const root = tree.find(member => member.pid === this.pid)
    const rootVerified = this.rootIdentity !== undefined
      && root !== undefined
      && root.started === this.rootIdentity.started
    this.trackedDescendants = this.survivors(this.unionMembers(
      this.trackedDescendants,
      ...rootVerified ? [tree, this.inspector.processSession(this.pid)] : [],
    ).filter(member => member.pid !== this.pid))
    return this.trackedDescendants
  }

  /** 在宽限期内轮询等待成员退出，返回仍存活的成员。 */
  private async waitForMembers(members: ProcessIdentity[]): Promise<ProcessIdentity[]> {
    const until = Date.now() + this.graceMs
    let survivors = this.survivors(members)
    while (survivors.length > 0 && Date.now() < until) {
      await delay(Math.min(25, Math.max(1, until - Date.now())))
      survivors = this.survivors(members)
    }
    return survivors
  }

  /** 向成员逐个发信号；同一 tick 内已退出的进程静默跳过（身份已复核）。 */
  private signalMembers(members: ProcessIdentity[], signal: 'SIGTERM' | 'SIGKILL'): void {
    for (const member of members) {
      try {
        this.inspector.signalProcess(member, signal)
      } catch (_alreadyExitedDuringSignal) {
        // The exact process identity is rechecked; a same-tick exit is success.
        // 精确进程身份已复核；同一 tick 内的退出视为成功。
      }
    }
  }

  /** 宿主退出时的后代强杀：最后一次进程表扫描失败时保留已捕获身份。 */
  private forceStopDescendants(): void {
    let members = this.trackedDescendants
    try {
      members = this.descendants()
    } catch (_processTableUnavailableDuringHostExit) {
      // Preserve already-captured identities when a final process-table scan fails.
      // 最后一次进程表扫描失败时，保留已捕获的身份。
    }
    this.signalMembers(members, 'SIGKILL')
  }

  /** 按 "pid:started" 去重合并多个身份组。 */
  private unionMembers(...groups: ProcessIdentity[][]): ProcessIdentity[] {
    const members: ProcessIdentity[] = []
    const seen = new Set<string>()
    for (const group of groups) {
      for (const member of group) {
        const key = `${member.pid}:${member.started}`
        if (seen.has(key)) continue
        seen.add(key)
        members.push(member)
      }
    }
    return members
  }

  /** 后代终止：SIGTERM → 等待 → 新收养 → SIGKILL → 等待，返回最终幸存者。 */
  private async stopDescendants(): Promise<ProcessIdentity[]> {
    const captured = this.descendants()
    this.signalMembers(captured, 'SIGTERM')
    const capturedSurvivors = await this.waitForMembers(captured)
    const members = this.unionMembers(capturedSurvivors, this.descendants())
    this.signalMembers(members, 'SIGKILL')
    const survivors = await this.waitForMembers(members)
    return this.survivors(this.unionMembers(survivors, this.descendants()))
  }

  /** shell 终止：POSIX 按 SIGTERM → 等待 → SIGKILL → 等待；Windows 走 stopShellWindows。 */
  private async stopShell(): Promise<void> {
    if (this.platform === 'win32') {
      await this.stopShellWindows()
      return
    }
    if (!this.exited) {
      try {
        this.terminal.kill('SIGTERM')
      } catch (_topLevelAlreadyExitedDuringTerm) {
        // The exit callback is authoritative.
        // 退出回调才是权威事实。
      }
      await Promise.race([this.done.then(() => undefined), delay(this.graceMs)])
    }
    if (!this.exited) {
      try {
        this.terminal.kill('SIGKILL')
      } catch (_topLevelAlreadyExitedDuringKill) {
        // The exit callback is authoritative.
        // 退出回调才是权威事实。
      }
      await Promise.race([this.done.then(() => undefined), delay(this.graceMs)])
    }
    if (!this.exited) throw new Error(`terminal cleanup failed; surviving pid: ${this.pid}`)
  }

  /**
   * Windows shell 终止：node-pty 的 kill(signal) 在 Windows 抛错、裸 kill() 委托的
   * console-list agent 在父进程无控制台时失败，因此拆解路径用 taskkill 树终止，
   * 并像每个后代一样以 shell 启动身份围栏；根身份未命中时回退到裸 kill。taskkill
   * 终止也不会可靠触发 node-pty 的退出通知，所以各级用检查器验证 shell 消失，
   * 而不是只等 done。
   */
  private async stopShellWindows(): Promise<void> {
    // node-pty's Windows kill(signal) throws ("Signals not supported on
    // windows"), and its bare kill() delegates to a console-list agent that
    // fails when the parent has no console. taskkill tree escalation is the
    // teardown path, fenced on the shell's start identity like every
    // descendant; a root identity miss falls back to the bare kill. taskkill
    // termination also does not reliably fire node-pty's exit notification
    // (the same console-list agent), so the tiers verify the shell's absence
    // through the inspector instead of waiting on `done` alone.
    // node-pty 的 Windows kill(signal) 抛错（"Signals not supported on windows"），
    // 裸 kill() 委托的 console-list agent 在父进程无控制台时失败，因此拆解路径用
    // taskkill 树终止，并像每个后代一样以 shell 启动身份围栏；根身份未命中回退裸 kill。
    // taskkill 终止也不可靠触发 node-pty 退出通知（同一 console-list agent），
    // 所以各级经检查器验证 shell 消失，而非只等 done。
    const shellGone = (): boolean =>
      this.exited || (this.rootIdentity !== undefined && !this.inspector.isAlive(this.rootIdentity))
    if (!shellGone() && this.rootIdentity !== undefined) {
      this.inspector.signalProcess(this.rootIdentity, 'SIGTERM')
      await this.waitForWindowsShellExit()
    }
    if (!shellGone() && this.rootIdentity === undefined) {
      try {
        this.terminal.kill()
      } catch (_topLevelAlreadyExitedDuringKill) {
        // The exit callback is authoritative.
        // 退出回调才是权威事实。
      }
      await Promise.race([this.done.then(() => undefined), delay(this.graceMs)])
    }
    if (!shellGone() && this.rootIdentity !== undefined) {
      this.inspector.signalProcess(this.rootIdentity, 'SIGKILL')
      await this.waitForWindowsShellExit()
    }
    if (!shellGone()) throw new Error(`terminal cleanup failed; surviving pid: ${this.pid}`)
  }

  /** 在宽限期内等待 Windows shell 消失（经检查器验证身份，而非只等退出通知）。 */
  private async waitForWindowsShellExit(): Promise<void> {
    const until = Date.now() + this.graceMs
    while (!this.exited && Date.now() < until) {
      if (this.rootIdentity !== undefined && !this.inspector.isAlive(this.rootIdentity)) return
      await delay(Math.min(25, Math.max(1, until - Date.now())))
    }
  }

  /** 一次性完整拆解：后代终止 → shell 终止 → 再后代终止 → 落定 done → 释放事件监听。 */
  private async closeOnce(): Promise<void> {
    let survivors = await this.stopDescendants()
    if (survivors.length > 0) {
      throw new Error(`terminal cleanup failed; surviving pids: ${survivors.map(member => member.pid).join(', ')}`)
    }
    await this.stopShell()
    survivors = await this.stopDescendants()
    if (survivors.length > 0) {
      throw new Error(`terminal cleanup failed; surviving pids: ${survivors.map(member => member.pid).join(', ')}`)
    }
    this.settleExitIfGone()
    this.dataDisposable.dispose()
    this.exitDisposable.dispose()
  }

  /**
   * Windows 上被外部 taskkill 的 shell 可能永不触发 node-pty 退出通知（其
   * console-list agent 在无父控制台时失败），使 done 与所有等待者永远无法落定。
   * 拆解刚经检查器验证了 shell 不存在，因此缺失退出事件本身就是结果。
   */
  private settleExitIfGone(): void {
    // An externally taskkilled Windows shell may never fire node-pty's exit
    // notification (its console-list agent fails without a parent console),
    // which would leave `done` — and every consumer awaiting it — unsettled
    // forever. Teardown has just verified the shell's absence through the
    // inspector, so a missing exit event is itself the outcome.
    // 被外部 taskkill 的 Windows shell 可能永不触发 node-pty 退出通知（其 console-list
    // agent 在无父控制台时失败），让 done 与所有等待者永远无法落定。拆解刚经检查器
    // 验证了 shell 不存在，因此缺失退出事件本身就是结果。
    if (this.platform !== 'win32') return
    if (this.exited) return
    /* v8 ignore next -- stopShellWindows() verified the shell is gone or threw;
       the identity re-check is a defensive fence for a future caller. */
    if (this.rootIdentity !== undefined && this.inspector.isAlive(this.rootIdentity)) return
    this.exited = true
    this.output.end()
    this.outcome.resolve({ exitCode: null, signal: null })
  }
}
