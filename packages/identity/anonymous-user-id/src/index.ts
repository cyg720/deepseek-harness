/**
 * Per-harness-home anonymous user id shared by telemetry and feedback.
 *
 * The id is a random UUID persisted as a bare line in `.anonymous-user-id` inside the
 * harness home resolved by {@link resolveDshHome} (`$DSH_HOME` > `~/.dsh`),
 * and never derived from the hostname, network address, git remote, or any
 * other identifying source. It is scoped to the harness home, not the
 * machine: every process sharing one `$DSH_HOME` reports the same id, and
 * deleting the file mints a fresh identity on the next launch.
 *
 * Reads and writes are synchronous so boot-time and command consumers can
 * use one API. The result is memoized per resolved file path: one process
 * touches the disk once, and a file deleted mid-run keeps the process's id
 * until the next launch.
 *
 * @module @deepseek-ai/dsh-anonymous-user-id
 */
/**
 * 文件职责：实现匿名身份的 index.ts 模块。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证匿名身份在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：注册能力，校验请求，更新状态并记录事件。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** A harness-home-scoped anonymous user id (random UUID v4). */
/** 中文说明：类型或类 AnonymousUserId 约束宿主、交互或任务数据职责。 */
export type AnonymousUserId = Branded<'AnonymousUserId'>

/** File inside the harness home storing the id: a bare UUID line, no wrapper format. */
/** 中文说明：服务局部值 解构结果，由紧邻初始化决定。 */
export const ANONYMOUS_USER_ID_FILE_NAME = '.anonymous-user-id'

/** 中文说明：服务局部值 UUID_PATTERN，由紧邻初始化决定。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ambient hooks for locating and generating the id; every field has a default. */
/** 中文说明：类型或类 AnonymousUserIdOptions 约束宿主、交互或任务数据职责。 */
export interface AnonymousUserIdOptions {
  /** Environment consulted for `DSH_HOME`; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** UUID generator; defaults to `crypto.randomUUID` (test hook). */
  randomUUID?: () => string
}

/** Process-lifetime memo keyed by resolved file path, so distinct test homes never share an id. */
/** 中文说明：服务局部值 memo，由紧邻初始化决定。 */
const memo = new Map<string, AnonymousUserId>()

/** Read a valid persisted id from the file, or `undefined` when absent/corrupt. */
/** 中文说明：函数 readPersistedId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function readPersistedId(file: string): AnonymousUserId | undefined {
  /** 中文说明：服务局部值 text: string，由紧邻初始化决定。 */
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    // Absent or unreadable: the caller mints and persists a fresh id.
    return undefined
  }
  /** 中文说明：服务局部值 value，由紧邻初始化决定。 */
  const value = text.trim()
  return UUID_PATTERN.test(value) ? (value as AnonymousUserId) : undefined
}

/**
 * Return the harness home's anonymous user id, creating and persisting one on
 * first use. A concurrent first launch is settled by an exclusive-create
 * write: the loser rereads the winner's id. (A reread landing in the winner's
 * narrow create-to-write window can still yield two per-process ids for that
 * run; the next launch converges on the persisted one.) Persistence is
 * best-effort — a write failure (read-only home) still returns a usable id
 * for the current run so feedback and telemetry are never blocked.
 * @param options - home-location and UUID-generation seams.
 * @returns the stable per-harness-home anonymous user id.
 */
/** 中文说明：函数 getOrCreateAnonymousUserId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function getOrCreateAnonymousUserId(options: AnonymousUserIdOptions = {}): AnonymousUserId {
  /** 中文说明：服务局部值 file，由紧邻初始化决定。 */
  const file = join(resolveDshHome(undefined, options.env ?? process.env), ANONYMOUS_USER_ID_FILE_NAME)
  /** 中文说明：服务局部值 cached，由紧邻初始化决定。 */
  const cached = memo.get(file)
  if (cached !== undefined) return cached

  /** 中文说明：服务局部值 id，由紧邻初始化决定。 */
  let id = readPersistedId(file)
  if (id === undefined) {
    /** 中文说明：服务局部值 generate，由紧邻初始化决定。 */
    const generate = options.randomUUID ?? randomUUID
    /** 中文说明：服务局部值 created，由紧邻初始化决定。 */
    const created = generate() as AnonymousUserId
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `${created}\n`, { encoding: 'utf8', flag: 'wx' })
      id = created
    } catch {
      // A wx refusal (EEXIST) covers both a concurrent winner and a
      // pre-existing corrupt file: the reread adopts a valid winner, and an
      // invalid reread falls through to the overwrite path. Non-EEXIST
      // failures (read-only home) land there too, accepted best-effort below.
      id = readPersistedId(file)
      if (id === undefined) {
        try {
          writeFileSync(file, `${created}\n`, 'utf8')
        } catch {
          // Best-effort persistence: keep the fresh id in memory even when the
          // home is unwritable, so this run still reports a consistent id.
        }
        id = created
      }
    }
  }
  memo.set(file, id)
  return id
}
