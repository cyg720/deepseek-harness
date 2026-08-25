/*
 * ================================ 文件注释 ================================
 * 【文件职责】按会话键控的命令目录缓存：每个会话一条缓存（单飞拉取、软/硬失效、
 *             epoch 守卫），把宿主的 command.list 结果缓存到浏览器侧。
 * 【技术维度】Map<SessionId, Entry>；每个 Entry 维护状态机（cold/pending/ready/failed）、
 *             纪元号（只允许最新一次拉取发布结果）与等待者队列；ensureReady 强等待。
 * 【产品维度】支撑 / 命令菜单的即时打开：目录数据已预热时无需等待网络往返。
 * 【逻辑维度】status/resolve 同步查询；invalidateAll 软失效（后台重拉、旧快照继续服务）；
 *             resetConnected 重连硬重置并预热；warm 懒预热；refresh 发起单飞拉取；
 *             ensureReady 强等待到可服务或失败。
 * 【关键边界】每次拉取都有 epoch 守卫，过期结果不发布；失败时丢弃快照并报错。
 * 【新手阅读建议】先看 Entry 与 DirectoryStatus 状态机，再读 refresh/ensureReady 的循环。
 * ==========================================================================
 */
/**
 * Command-directory cache keyed by session: one entry per served catalog —
 * every session is agent-backed, so `command.list({sessionId})` is the only
 * request fields. Each entry keeps the single-flight / soft-hard invalidation
 * / epoch-guard behavior of the original global cache; the session-key axis
 * is the only extra dimension.
 */
import type { CommandDescriptor } from '@deepseek-ai/dsh-commands/types'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

export type { CommandDescriptor } from '@deepseek-ai/dsh-commands/types'

/**
 * cold = never pulled; pending = pull in flight with nothing servable;
 * ready = snapshot serving (a soft-invalidate repull keeps this status);
 * failed = last winning pull rejected, snapshot dropped.
 */
// 目录缓存条目状态：cold 从未拉取；pending 拉取中且无可服务数据；
// ready 快照可服务（软失效后台重拉保持该状态）；failed 最近一次拉取失败、快照已丢弃。
export type DirectoryStatus = 'cold' | 'pending' | 'ready' | 'failed'

/** Injected pull (the service binds command.list off the root connection). */
// 注入的拉取函数：由服务绑定宿主命令列表 RPC，供缓存按会话拉取。
export type FetchCommands = (sessionId: SessionId) => Promise<readonly CommandDescriptor[]>

/** One session key's cache cell. */
// 一个会话键的缓存单元：状态、命令快照、纪元号、最近错误与等待者队列。
class Entry {
  state: DirectoryStatus = 'cold'
  commands: readonly CommandDescriptor[] = []
  /** Bumped at each pull start; only the latest pull may publish its outcome. */
  epoch = 0
  lastError: unknown
  waiters: Array<() => void> = []
}

/** The session-keyed directory cache. Plain class — the owning service wires events and RPC. */
// 按会话键控的命令目录缓存：纯类实现，事件与 RPC 由宿主服务接线。
export class CommandDirectory {
  private readonly entries = new Map<SessionId, Entry>()

  constructor(private readonly fetchCommands: FetchCommands) {}

  /**
   * Current cache status for one session.
   * @param sessionId - session key.
   * @returns the entry status (cold when never touched).
   */
  // 查询某会话的缓存状态；从未触碰过的会话返回 cold。
  status(sessionId: SessionId): DirectoryStatus {
    return this.entries.get(sessionId)?.state ?? 'cold'
  }

  /**
   * Synchronous exact-name lookup over one session's hot snapshot.
   * @param sessionId - session key.
   * @param name - command name without the leading slash.
   * @returns the descriptor, or undefined when absent or the entry is not ready.
   */
  resolve(sessionId: SessionId, name: string): CommandDescriptor | undefined {
    const entry = this.entries.get(sessionId)
    if (entry === undefined || entry.state !== 'ready') return undefined
    return entry.commands.find(c => c.name === name)
  }

  /** Soft invalidation (commands-changed): background repull on every touched key; ready snapshots keep serving. */
  // 软失效：对所有已触碰的会话键后台重拉；ready 快照在重拉期间继续服务。
  invalidateAll(): void {
    for (const key of this.entries.keys()) void this.refresh(key)
  }

  /**
   * Hard reset on reconnect: every entry drops its snapshot (the agent world
   * may have changed shape across the generation) and prewarms.
   */
  // 重连硬重置：所有条目丢弃快照（跨代际 agent 世界可能已变化）并预热。
  resetConnected(): void {
    for (const [key, entry] of this.entries) {
      entry.state = 'cold'
      entry.commands = []
      void this.refresh(key)
    }
  }

  /**
   * Fire-and-forget prewarm of one session (the command source's scope-birth
   * warm hook lands here).
   * @param sessionId - session key.
   */
  // 后台预热：冷态或失败态时发起一次拉取（命令源的会话出生 warm 钩子落在这里）。
  warm(sessionId: SessionId): void {
    const entry = this.entry(sessionId)
    if (entry.state === 'cold' || entry.state === 'failed') void this.refresh(sessionId)
  }

  /**
   * Start one pull for one session. Publishes ready/failed only while it is
   * still the key's latest pull (epoch guard); a ready snapshot is not
   * demoted while the pull flies.
   * @param sessionId - session key.
   * @returns settled when this pull's outcome is published or discarded.
   */
  // 发起一次拉取：只在仍是最新一次（epoch 守卫）时发布 ready/failed；ready 快照不因拉取而降级。
  async refresh(sessionId: SessionId): Promise<void> {
    const entry = this.entry(sessionId)
    const epoch = ++entry.epoch
    if (entry.state !== 'ready') entry.state = 'pending'
    try {
      const commands = await this.fetchCommands(sessionId)
      if (epoch !== entry.epoch) return
      entry.commands = commands
      entry.state = 'ready'
      entry.lastError = undefined
    } catch (error) {
      if (epoch !== entry.epoch) return
      entry.commands = []
      entry.state = 'failed'
      entry.lastError = error
    } finally {
      if (epoch === entry.epoch) notifyWaiters(entry)
    }
  }

  /**
   * Strong-wait until one session's catalog is servable (the enter-
   * adjudication "directory must be reached" rule): ready returns at once;
   * cold/failed launch a fresh pull; pending joins the flying one. Rejects
   * when the awaited pull fails or the signal aborts.
   * @param sessionId - session key.
   * @param signal - attempt-scoped abort (the SubmitAttempt signal).
   * @returns the hot command snapshot.
   */
  // 强等待到目录可服务：ready 直接返回；cold/failed 发起新拉取；pending 挂到进行中的拉取；
  // 拉取失败或信号中止时抛错。
  async ensureReady(sessionId: SessionId, signal: AbortSignal): Promise<readonly CommandDescriptor[]> {
    const entry = this.entry(sessionId)
    while (true) {
      if (entry.state === 'ready') return entry.commands
      if (entry.state !== 'pending') void this.refresh(sessionId)
      await settled(entry, signal)
      if (entry.state === 'failed') {
        throw new Error(`command directory warmup failed: ${entry.lastError instanceof Error ? entry.lastError.message : String(entry.lastError)}`)
      }
      // Still pending (the awaited pull was superseded) → wait for the winner.
    }
  }

  private entry(sessionId: SessionId): Entry {
    let entry = this.entries.get(sessionId)
    if (entry === undefined) {
      entry = new Entry()
      this.entries.set(sessionId, entry)
    }
    return entry
  }
}

/** One settlement tick for one entry: resolves at the next winning publish, rejects on abort. */
function settled(entry: Entry, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const waiter = (): void => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const onAbort = (): void => {
      entry.waiters = entry.waiters.filter(w => w !== waiter)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    entry.waiters.push(waiter)
  })
}

function notifyWaiters(entry: Entry): void {
  const woken = entry.waiters
  entry.waiters = []
  for (const wake of woken) wake()
}

/** Normalize an abort into an Error rejection. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('command directory wait aborted')
}
