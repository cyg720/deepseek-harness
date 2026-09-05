

/**
 * Process plumbing for the local subprocess service: detached process-tree
 * spawn with per-stream stdio dispositions, tail-keep collection with spill
 * files, tree-scoped signalling (POSIX groups; Windows taskkill), and the
 * SIGTERM→SIGKILL escalation. This layer reacts to an abort signal; callers
 * own deadlines, teardown ladders, and cause classification.
 * @module dsh-subprocess-local/spawn
 */

/*
 * 【文件职责】实现本地进程启动、输出尾部及溢出收集、进程树信号和终止升级；
 * 期限和停止原因由调用者持有。
 */

import { type ChildProcess, type SpawnOptions, spawn, spawnSync } from 'node:child_process'
import type { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, rmdirSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleepMs } from 'node:timers/promises'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {
  CollectedOutput,
  SubprocessCollect,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputMode,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { linuxProcessGroupHasLiveMembers } from './process-inspector.ts'

type SpawnProcess = (
  program: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

/**
 * Build a child environment: explicit caller entries override the scrubbed
 * parent base using the target platform's environment-key semantics. A string
 * deliberately restores or overrides an entry; an explicit `undefined`
 * tombstone removes an ordinary ambient entry.
 * @param extra - explicit caller entries and tombstones, merged after the scrub.
 * @returns the environment to hand to `spawn` for the child process.
 */
/*
 * 构建子进程环境：显式调用方条目按目标平台的环境键语义覆盖擦除后的父环境基线。
 * 字符串刻意恢复或覆盖某条目；显式 undefined 墓碑删除某个普通环境条目。
 * @param extra 显式调用方条目与墓碑，在擦除后合并
 * @returns 交给 spawn 的子进程环境
 */
export function childEnv(extra?: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const env = scrubbedParentEnv()
  if (process.platform !== 'win32') return { ...env, ...extra }
  let entries: [string, string | undefined][] = Object.entries(env)
  // Windows 环境键大小写不敏感：合并时先按大写匹配剔除同名旧条目再追加。
  for (const [key, value] of Object.entries(extra ?? {})) {
    const normalized = key.toUpperCase()
    entries = entries.filter(([inherited]) => inherited.toUpperCase() !== normalized)
    entries.push([key, value])
  }
  return Object.fromEntries(entries)
}

/** Injectable process, spill, and platform operations. */
export interface SpawnInternals {
  /** Process spawner (defaults to `node:child_process` `spawn`). */
  spawn?: SpawnProcess
  /** Directory for spill files (defaults to the OS temp dir). */
  /* 溢出文件目录（缺省为 OS 临时目录）。 */
  spillDir?: string
  /** Windows tree-termination runner (defaults to `taskkill /PID <pid> /T /F`). */
  /* Windows 树终止运行器（缺省为 taskkill /PID <pid> /T /F）。 */
  taskkill?: (pid: number) => void
  /** Host platform override for signalling decisions. */
  /* 信号决策用的宿主平台覆盖。 */
  platform?: NodeJS.Platform
  /** Linux process-group member probe (defaults to `/proc` inspection). */
  /* Linux 进程组成员探测（缺省经 /proc 检查）。 */
  linuxProcessGroupHasLiveMembers?: (processGroupId: number) => boolean | undefined
}

/**
 * Local-only synchronous final termination used by the owning service during
 * host exit and as the last fallback after failed normal disposal. It is
 * intentionally absent from the public subprocess seam.
 */
/*
 * 仅本地使用的同步最终终止：宿主退出时由所属服务调用，也是正常拆解失败后的最后
 * 兜底。刻意不出现在公开子进程缝上。
 */
export interface LocalSubprocessHandle extends SubprocessHandle {
  /** Force-terminate the current tree synchronously without starting timers or waits. */
  /* 同步强杀当前树，不启动定时器也不等待。 */
  terminateForHostExit(): void
}

/**
 * Liveness-poll cadence for tree-exit waits. The timer stays ref'd: an
 * awaited teardown must keep the event loop alive until the tree really
 * exits, or the parent can exit while claiming quiescence and orphan the
 * survivors it promised to reap.
 */
/*
 * 树退出等待的存活轮询节奏。定时器保持 ref：被等待的拆解必须让事件循环活到树真正
 * 退出，否则父进程可能一边声称静默一边退出，把承诺收割的幸存者变成孤儿。
 */
function sleepTick(): Promise<void> {
  return sleepMs(15)
}

let spillCounter = 0
let defaultSpillDir: string | undefined

/**
 * The default spill location: a private (0700) per-process directory under
 * the OS tmpdir, created lazily. Predictable world-readable paths would let
 * other local users read command output or pre-create symlinks. At a
 * JavaScript-observable process exit the directory is removed only when it
 * holds no completed spill file (spill files are retained as full-output
 * recovery artifacts until an external cleanup).
 */
/*
 * 默认溢出位置：OS 临时目录下私密（0700）的按进程目录，惰性创建。可预测的全局
 * 可读路径会让本机其它用户读到命令输出或预创建符号链接。
 */
function privateSpillDir(): string {
  defaultSpillDir ??= mkdtempSync(join(tmpdir(), 'dsh-subprocess-'))
  return defaultSpillDir
}

// The per-process spill directory is removed at process exit when it holds no
// completed spill file: a directory that never spilled is empty and is safe to
// remove, while a directory holding completed spill files keeps them (their
// content is retained until an external cleanup). A SIGKILLed process cannot
// run this at all; its residue is left to OS temp hygiene.
/* v8 ignore next 4 -- exit listeners run after the coverage dump; removal is verified by the CI /tmp residue measurement. */
process.once('exit', () => {
  if (defaultSpillDir === undefined) return
  try { rmdirSync(defaultSpillDir) } catch { /* best-effort: ENOENT/ENOTEMPTY/EBUSY/EPERM must not change the exit code. */ }
})

/**
 * Collects one stream with a bounded in-memory tail. With a spill cap, on
 * first overflow a spill file is created and every chunk (including those
 * already collected) is appended there while the full stream remains within
 * the cap; without one, only the in-memory tail is ever retained (the
 * diagnostic-tail shape — a language server's stderr).
 *
 * Tail-keep rationale (pi/OpenCode): errors and final results cluster at the
 * end of command output; the spill file covers the head.
 */
/*
 * 以有界内存尾部收集一个流。带 spill 上限时，首次溢出会创建溢出文件并把每个块
 * （含已收集的）追加进去，只要整流仍在预算内；不带 spill 时只保留内存尾部
 * （诊断尾部形状——如语言服务器的 stderr）。
 *
 * 保留尾部的理由（pi/OpenCode）：错误与最终结果集中在命令输出末尾；溢出文件补头部。
 */
export class OutputCollector {
  private chunks: Buffer[] = []
  private bytes = 0
  private dropped = false
  private spillFd: number | undefined
  private spillFile: string | undefined
  private spillDisabled: boolean
  /** Total bytes ever pushed (not just retained). */
  /* 累计推入的字节总数（不只保留的）。 */
  private total = 0

  constructor(
    private readonly maxBytes: number,
    private readonly maxSpillBytes: number | undefined,
    private readonly label: string,
    private readonly spillDir: string,
  ) {
    this.spillDisabled = maxSpillBytes === undefined
  }

  /**
   * Ingest one stream chunk, counting it toward the whole-stream total. On
   * first overflow of the in-memory cap a spill file is opened (when spilling
   * is enabled) and every chunk (already-collected ones included) is appended
   * there from then on; the in-memory tail then drops whole chunks from its
   * head (or the head of a single over-cap chunk) until it fits the cap again.
   * @param chunk - the raw bytes from one stream 'data' event.
   */
  /*
   * 摄入一个流块，计入整流总量。内存上限首次溢出时（启用落盘时）打开溢出文件，
   * 此后每个块（含已收集的）都追加进去；内存尾部则从头部丢弃整块（或单个超限块的
   * 头部），直到重新适配上限。
   * @param chunk 一次流 data 事件的原始字节
   */
  push(chunk: Buffer): void {
    this.total += chunk.length
    const overflows = this.bytes + chunk.length > this.maxBytes
    if (!this.spillDisabled && (overflows || this.spillFd !== undefined)) this.spillAll(chunk)
    this.chunks.push(chunk)
    this.bytes += chunk.length
    while (this.bytes > this.maxBytes) {
      const head = this.chunks[0] as Buffer
      const excess = this.bytes - this.maxBytes
      if (head.length <= excess) {
        // Drop the whole head chunk (length ≥ 1 is guaranteed while over cap).
        // 丢弃整个头部块（超限时长度 ≥ 1 有保证）。
        this.chunks.shift()
        this.bytes -= head.length
      } else {
        // Trim the head so the retained window is byte-exact at the cap — a
        // diagnostic tail (an LSP server's stderr) must hold the LAST
        // maxBytes regardless of how the stream was chunked.
        // 裁剪头部使保留窗口在上限处字节精确——诊断尾部（如 LSP 服务器 stderr）
        // 必须无论流如何分块都持有最后 maxBytes 字节。
        this.chunks[0] = head.subarray(excess)
        this.bytes -= excess
      }
      this.dropped = true
    }
  }

  /** Open the spill file lazily and append `chunk` (and any prior chunks once). */
  /* 惰性打开溢出文件并追加 chunk（历史块只写一次）。 */
  private spillAll(chunk: Buffer): void {
    if (this.maxSpillBytes !== undefined && this.total > this.maxSpillBytes) {
      this.discardSpill()
      return
    }
    if (this.spillFd === undefined) {
      // Random suffix + O_EXCL + no-follow-equivalent ('wx' fails on any
      // existing path, symlink or not) + owner-only mode: defeats spill-path
      // prediction and symlink planting in shared tmp dirs.
      // 随机后缀 + O_EXCL + 不跟随等价（'wx' 对任何已存在路径都失败，无论是否符号
      // 链接）+ 仅属主模式：在共享临时目录中防溢出路径预测与符号链接植入。
      this.spillFile = join(
        this.spillDir,
        `dsh-subprocess-${process.pid}-${++spillCounter}-${randomBytes(6).toString('hex')}-${this.label}.log`,
      )
      this.spillFd = openSync(this.spillFile, 'wx', 0o600)
      for (const prior of this.chunks) writeSync(this.spillFd, prior)
    }
    writeSync(this.spillFd, chunk)
  }

  /** Stop spilling and remove the file once it can no longer hold the complete stream. */
  /* 溢出文件无法再装下完整流时停止落盘并删除文件。 */
  private discardSpill(): void {
    const fd = this.spillFd
    const file = this.spillFile
    this.spillFd = undefined
    this.spillFile = undefined
    this.spillDisabled = true
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // Retain the descriptor so finalize can retry the failed close.
        // 保留描述符，让 finalize 重试失败的关闭。
        this.spillFd = fd
      }
    }
    if (file !== undefined) {
      try {
        unlinkSync(file)
      } catch {
        // A failed unlink leaves at most maxSpillBytes behind, never an unbounded file.
        // 删除失败最多留下 maxSpillBytes，绝不留下无界文件。
      }
    }
  }

  /**
   * Incremental read in whole-stream byte coordinates: returns everything
   * pushed since `fromByte`. When `fromByte` has already slid out of the
   * in-memory tail window, the read is `lossy` — it returns the whole
   * retained tail and the gap is only recoverable from the spill file.
   * @param fromByte - whole-stream offset to resume from (a prior read's `nextOffset`; 0 for the first read).
   * @returns the delta text, the offset for the next read, the `lossy` flag, and the spill path when one was created.
   */
  /*
   * 以整流字节坐标增量读取：返回自 fromByte 以来推入的全部内容。fromByte 已滑出内存
   * 尾部窗口时读取是 lossy 的——返回整个保留尾部，缺口只能从溢出文件恢复。
   * @param fromByte 要续接的整流偏移（上次读取的 nextOffset；首次读取为 0）
   * @returns 增量文本、下次读取偏移、lossy 标志与（创建时的）溢出文件路径
   */
  readFrom(fromByte: number): { text: string; nextOffset: number; lossy: boolean; spillPath?: string } {
    const windowStart = this.total - this.bytes
    const buffer = Buffer.concat(this.chunks)
    const lossy = fromByte < windowStart
    const slice = lossy ? buffer : buffer.subarray(fromByte - windowStart)
    return {
      text: slice.toString('utf8'),
      nextOffset: this.total,
      lossy,
      ...this.spillFile !== undefined ? { spillPath: this.spillFile } : {},
    }
  }

  /**
   * Close the spill file once the stream has ended. A failed close (delayed
   * writeback fault) stops advertising the spill path — the file may be
   * missing its tail — while every in-memory read keeps working. Idempotent;
   * the spawn path seals both collectors at settlement so reads after exit
   * never point at a still-open file.
   */
  /*
   * 流结束后关闭溢出文件。关闭失败（延迟写回故障）时停止宣传溢出路径——文件可能
   * 缺尾部——而内存读取不受影响。幂等；spawn 路径在落定时封存两个收集器，退出后的
   * 读取不会指向仍打开的文件。
   */
  seal(): void {
    if (this.spillFd === undefined) return
    try {
      closeSync(this.spillFd)
    } catch {
      // A delayed writeback failure makes the spill unreliable; keep the
      // in-memory result but stop advertising that file.
      // 延迟写回失败使溢出不可靠；保留内存结果但停止宣传该文件。
      this.spillFile = undefined
    }
    this.spillFd = undefined
  }

  /**
   * Seal the spill file and return the final output.
   * @returns the final collected output: tail text, truncation flag, and the spill path when intact.
   */
  /*
   * 封存溢出文件并返回最终输出。
   * @returns 最终收集输出：尾部文本、截断标志与（完好时的）溢出文件路径
   */
  finalize(): CollectedOutput {
    this.seal()
    return {
      text: Buffer.concat(this.chunks).toString('utf8'),
      truncated: this.dropped,
      ...this.spillFile !== undefined ? { spillPath: this.spillFile } : {},
    }
  }
}

/**
 * Send `sig` to a detached POSIX process group. Never throws: delivery races
 * process exit and may run in a timer callback, so failures are contained and
 * a non-positive pid is a no-op.
 * @param pid - the group leader's pid; non-positive means the spawn failed and the call is a no-op.
 * @param sig - the signal to deliver to the whole group.
 */
/*
 * 向分离的 POSIX 进程组发信号。永不抛错：投递与进程退出竞态且可能在定时器回调中
 * 运行，因此失败被收敛；非正 pid 为空操作。
 * @param pid 组首进程 pid；非正表示 spawn 失败，调用为空操作
 * @param sig 要发给整组的信号
 */
export function killGroup(pid: number, sig: NodeJS.Signals): void {
  if (pid <= 0) return
  try {
    process.kill(-pid, sig)
  } catch {
    // Swallow: see contract above.
    // 吞掉：见上方契约。
  }
}

/**
 * Terminate one Windows process tree with `taskkill /T /F`. Contained like
 * POSIX group signalling — delivery races tree exit, so an absent tree, a
 * nonzero status, or a missing taskkill binary must not break idempotent
 * teardown.
 * @param pid - root process id; non-positive is a no-op.
 */
/*
 * 用 taskkill /T /F 终止一个 Windows 进程树。与 POSIX 组信号一样收敛错误——投递与
 * 树退出竞态，因此树不存在、非零状态或 taskkill 二进制缺失都不能破坏幂等拆解。
 * @param pid 根进程 id；非正为空操作
 */
export function taskkillProcessTree(pid: number): void {
  if (pid <= 0) return
  // Outcome deliberately unchecked: an already-absent tree (status 128), exit
  // races, and a missing taskkill binary (spawnSync reports, never throws) are
  // as tolerable here as ESRCH is for a POSIX group signal.
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  })
}

/**
 * Signal a detached process tree with platform-correct semantics: POSIX
 * signals the negative process-group id and falls back to the direct child
 * when the group is gone; Windows terminates the tree via taskkill (any
 * signal value force-terminates — Node maps signals to TerminateProcess).
 */
/*
 * 以平台正确的语义给分离进程树发信号：POSIX 发负进程组 id、组消失时回退到直接子
 * 进程；Windows 经 taskkill 终止整树（任何信号值都强制终止——Node 把信号映射为
 * TerminateProcess）。
 */
function signalTree(
  platform: NodeJS.Platform,
  pid: number,
  sig: NodeJS.Signals,
  child: ChildProcess,
  taskkill: (pid: number) => void,
): void {
  if (platform === 'win32') {
    taskkill(pid)
    return
  }
  /* v8 ignore next -- kill/terminate gate on treeAlive(), which is false for pid -1; this guard protects direct callers only. */
  if (pid <= 0) return
  try {
    process.kill(-pid, sig)
  } catch {
    /* v8 ignore start -- the fallback needs a live child whose group signal fails
       (EPERM-style), which POSIX CI cannot stage; the swallow keeps teardown idempotent. */
    try {
      child.kill(sig)
    } catch {
      // The direct child already exited; teardown remains idempotent.
      // 直接子进程已退出；拆解保持幂等。
    }
    /* v8 ignore stop */
  }
}

/**
 * Spawn one isolated detached process tree with the spec's per-stream stdio
 * dispositions. Runtime exits resolve `done` as {@link SubprocessOutcome};
 * only spawn failures reject.
 * @param spec - fully resolved argv, cwd, stdio, grace, cancellation, environment.
 * @param internals - test-only spill-directory, platform, and taskkill overrides.
 * @returns live subprocess handle.
 * @throws when `graceMs` cannot be represented by one Node timer.
 */
/*
 * 按规格的逐流 stdio 配置 spawn 一个隔离的分离进程树。运行时退出以 SubprocessOutcome
 * 解析 done；只有 spawn 失败才 reject。
 * @param spec 完全解析的 argv、cwd、stdio、宽限期、取消与环境
 * @param internals 仅测试用的溢出目录、平台与 taskkill 覆盖
 * @returns 存活子进程句柄
 * @throws graceMs 无法由一个 Node 定时器表示时
 */
export function spawnSubprocess(spec: SubprocessSpawnSpec, internals: SpawnInternals = {}): LocalSubprocessHandle {
  if (!Number.isFinite(spec.graceMs) || spec.graceMs <= 0 || spec.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`subprocess graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const spillDir = internals.spillDir ?? privateSpillDir()
  const platform = internals.platform ?? process.platform
  const spawnProcess = internals.spawn ?? spawn
  const taskkill = internals.taskkill ?? taskkillProcessTree
  const linuxGroupHasLiveMembers = internals.linuxProcessGroupHasLiveMembers ?? linuxProcessGroupHasLiveMembers

  if (spec.signal?.aborted) {
    throw new Error(`aborted before spawn: ${String(spec.signal.reason ?? 'aborted')}`)
  }
  const [program, ...args] = spec.argv
  if (program === undefined || program.length === 0) {
    throw new Error('invalid argv: expected a non-empty program name at argv[0]')
  }

  const isCollect = (mode: SubprocessOutputMode): mode is SubprocessCollect =>
    mode !== 'pipe' && mode !== 'inherit'
  const outMode = spec.stdio.stdout
  const errMode = spec.stdio.stderr
  const stdinMode = spec.stdio.stdin

  const env = childEnv(spec.env)
  const child = spawnProcess(program, args, {
    cwd: spec.cwd,
    env,
    stdio: [
      stdinMode === 'ignore' ? 'ignore' : 'pipe',
      outMode === 'inherit' ? 'inherit' : 'pipe',
      errMode === 'inherit' ? 'inherit' : 'pipe',
    ],
    // `detached` gives teardown a tree root on POSIX (its own process group);
    // Windows terminates by root pid through taskkill /T instead.
    detached: platform !== 'win32',
    windowsHide: platform === 'win32',
  })

  const collectStream = (mode: SubprocessOutputMode, stream: Readable | null, label: string): OutputCollector | undefined => {
    if (!isCollect(mode) || stream === null) return undefined
    const collector = new OutputCollector(mode.maxBytes, mode.spill?.maxBytes, label, spillDir)
    stream.on('data', (chunk: Buffer) => { collector.push(chunk) })
    return collector
  }
  const stdoutCollector = collectStream(outMode, child.stdout, 'stdout')
  const stderrCollector = collectStream(errMode, child.stderr, 'stderr')

  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let treeExitObserved = false
  let treeExitObservation: Promise<void> | undefined
  let settled = false

  // Failed spawns use pid -1 so signalling remains a no-op.
  // 失败的 spawn 用 pid -1，使发信号保持为空操作。
  const pid = child.pid ?? -1

  /** Whether the detached tree's root (or POSIX group) is still alive. */
  /* 分离树的根（或 POSIX 组）是否仍然存活。 */
  const treeAlive = (): boolean => {
    /* v8 ignore next -- only a timer callback already queued when the observer settles can enter here;
       the guard is the final defense against probing an id after its tree was confirmed absent. */
    if (treeExitObserved) return false
    if (pid <= 0) return false
    if (platform === 'win32') {
      // Windows has no group-liveness probe; the direct child's exit is the
      // observable boundary (taskkill /T already took the tree with it).
      // Windows 无组存活探测；直接子进程的退出是可观测边界（taskkill /T 已带走整树）。
      return child.exitCode === null && child.signalCode === null
    }
    try {
      process.kill(-pid, 0)
      // A group containing only unreaped zombies still answers kill(0), but
      // it can execute no work and cannot be signalled into quiescence. Only
      // inspect after direct-child settlement so live-process polls remain a
      // syscall rather than repeated process-table scans.
      // 只含未收割僵尸的组仍会应答 kill(0)，但它无法执行任何工作、也无法被信号驱入
      // 静默。只在直接子进程落定后才做此检查，让存活轮询保持为系统调用而非反复
      // 扫描进程表。
      if (settled && platform === 'linux' && linuxGroupHasLiveMembers(pid) === false) return false
      return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      /* v8 ignore next 2 -- POSIX reports an absent group as ESRCH; child-reaping timing
         makes observing the other arm platform-dependent. */
      if (code === 'ESRCH') return false
      /* v8 ignore start -- EPERM and non-POSIX negative-pid failures are platform defenses; CI runs
         tree-lifecycle tests on POSIX hosts where absence reports ESRCH. */
      if (code === 'EPERM') return true
      return child.exitCode === null && child.signalCode === null
      /* v8 ignore stop */
    }
  }

  /**
   * Start or reuse the handle's single whole-tree exit observer. The first
   * confirmed absence is a permanent no-more-signals boundary: it cancels a
   * pending escalation before this process-group id can be reused.
   */
  /*
   * 启动或复用句柄的单一整树退出观察者。首次确认树消失是永久的"不再发信号"边界：
   * 它会取消挂起的升级，防止本进程组 id 被复用后继续被信号。
   */
  const observeTreeExit = (): Promise<void> => {
    treeExitObservation ??= (async () => {
      while (treeAlive()) await sleepTick()
      treeExitObserved = true
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      graceTimer = undefined
    })()
    return treeExitObservation
  }

  // The escalation's tier primitive (not on the handle — terminate() is the
  // only consumer-facing termination verb). Guards on TREE liveness, not
  // outcome settlement: a TERM-trapping helper can outlive the settled direct
  // child and must stay signalable, while a fully-dead tree (possible pid
  // reuse) must not be re-signalled by a later tier.
  // 升级的层级原语（不在句柄上——terminate() 才是消费者面向的唯一终止动词）。
  // 以树的存活为守卫而非结果落定：TERM 陷阱辅助进程可能比已落定的直接子进程活得
  // 久，必须保持可信号；而完全死掉的树（可能 PID 复用）不得被后续层级再信号。
  const kill = (sig: NodeJS.Signals): void => {
    /* v8 ignore next -- the shared exit observer cancels the ordinary dead-tree timer;
       this remains the timer/death race guard and cannot be staged deterministically. */
    if (!treeAlive()) return
    signalTree(platform, pid, sig, child, taskkill)
  }

  const terminate = (): void => {
    if (treeExitObserved || graceTimer !== undefined) return
    // Observe from the first termination tier onward, even when inherited
    // pipes delay `done` and no consumer has begun its own teardown wait.
    // 从第一层终止起就开始观察整树，即使继承管道延迟 done 且没有消费者开始
    // 自己的拆解等待。
    void observeTreeExit()
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- observer can record absence before its first await.
    if (treeExitObserved) return
    kill('SIGTERM')
    // The escalation must survive direct-child settlement — the leader dying
    // does not mean the tree died — so settle does not clear this timer, and
    // kill() re-probes tree liveness before force-killing. It stays ref'd:
    // the pending SIGKILL is a commitment, and a parent exiting before it
    // fires would orphan a trapped survivor. Self-bounds at graceMs.
    // 升级必须跨越直接子进程落定——leader 死亡不代表整树死亡——因此 settle 不清除
    // 该定时器，kill() 会在强杀前重新探测树存活。它保持 ref：挂起的 SIGKILL 是承诺，
    // 父进程在其触发前退出会让被陷阱的幸存者变孤儿。以 graceMs 自我限制。
    graceTimer = setTimeout(() => { kill('SIGKILL') }, spec.graceMs)
  }

  // 宿主退出兜底：直接 SIGKILL（不启动定时器/等待）。
  const terminateForHostExit = (): void => {
    kill('SIGKILL')
  }

  // The caller owns timeout classification; this layer only reacts to abort.
  // 调用方拥有超时分类；本层只对 abort 作反应。
  const onAbort = (): void => { terminate() }
  spec.signal?.addEventListener('abort', onAbort, { once: true })

  // Batch stdin is written and closed up front; process exit and captured
  // output remain authoritative, so write errors (EPIPE) are best-effort.
  // 批量 stdin 先写入并关闭；进程退出与捕获输出仍是权威事实，因此写入错误（EPIPE）
  // 尽力而为。
  if (typeof stdinMode === 'object' && child.stdin !== null) {
    child.stdin.on('error', () => { /* stdin write is best-effort; outcome rides on exit/output. */ })
    child.stdin.end(stdinMode.data)
  }

  const done = new Promise<SubprocessOutcome>((resolve, reject) => {
    let pipeDrainTimer: ReturnType<typeof setTimeout> | undefined
    const settle = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      // Only harness-collected pipes are force-closed at the drain boundary;
      // a 'pipe'-mode stream belongs to the caller and closes with the child.
      // 只在排空边界强制关闭 harness 收集的管道；'pipe' 模式流归调用方，随子进程关闭。
      if (stdoutCollector !== undefined) child.stdout?.destroy()
      if (stderrCollector !== undefined) child.stderr?.destroy()
      stdoutCollector?.seal()
      stderrCollector?.seal()
      cleanup()
      resolve({ exitCode, signal })
    }
    child.on('error', (error) => {
      // No meaningful close outcome follows a spawn failure.
      // spawn 失败后没有有意义的 close 结果。
      settled = true
      cleanup()
      reject(error)
    })
    child.on('exit', (exitCode, signal) => {
      // A surviving descendant that inherited a pipe must not hold the
      // outcome open indefinitely: after exit, the same bounded grace that
      // governs kills also bounds the close wait.
      // 继承管道存活的子进程不能无限期撑开结果：退出后，与杀进程相同的有限宽限期
      // 也约束关闭等待。
      pipeDrainTimer = setTimeout(() => {
        settle(exitCode, signal)
      }, spec.graceMs)
    })
    child.on('close', settle)
    function cleanup(): void {
      // graceTimer deliberately NOT cleared: the SIGKILL escalation must be
      // able to reach tree survivors after the direct child settles.
      // 刻意不清除 graceTimer：SIGKILL 升级必须能在直接子进程落定后到达树幸存者。
      if (pipeDrainTimer !== undefined) clearTimeout(pipeDrainTimer)
      spec.signal?.removeEventListener('abort', onAbort)
    }
  })

  /** 等待整树退出：无信号时等观察者；带信号时与中止竞争。 */
  const waitForExit = async (signal?: AbortSignal): Promise<boolean> => {
    const observed = observeTreeExit()
    if (treeExitObserved) return true
    if (signal?.aborted) return false
    if (signal === undefined) {
      await observed
      return true
    }
    const aborted = Promise.withResolvers<boolean>()
    const onAbort = (): void => { aborted.resolve(false) }
    signal.addEventListener('abort', onAbort, { once: true })
    /* v8 ignore next -- closes the event-loop race between the preceding aborted check and listener registration. */
    if (signal.aborted) onAbort()
    try {
      return await Promise.race([observed.then(() => true), aborted.promise])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  return {
    pid,
    /* v8 ignore start -- pipe-mode fds exist on every spawn Node returns; the null-coalesces guard a nonconforming ChildProcess only. */
    stdin: stdinMode === 'pipe' ? child.stdin ?? undefined : undefined,
    stdout: outMode === 'pipe' ? child.stdout ?? undefined : undefined,
    stderr: errMode === 'pipe' ? child.stderr ?? undefined : undefined,
    /* v8 ignore stop */
    collected: {
      ...stdoutCollector !== undefined ? { stdout: stdoutCollector } : {},
      ...stderrCollector !== undefined ? { stderr: stderrCollector } : {},
    },
    done,
    terminate,
    terminateForHostExit,
    waitForExit,
  }
}
