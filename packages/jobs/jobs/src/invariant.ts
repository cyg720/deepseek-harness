/** Package-owned background-job snapshot invariants. @module @deepseek-ai/dsh-jobs/invariant */
/**
 * 文件职责：实现后台任务的 invariant.ts 模块。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证后台任务在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：注册能力，校验请求，更新状态并记录事件。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { JobSnapshot } from './types.ts'

/** 中文说明：服务局部值 PACKAGE_NAME，由紧邻初始化决定。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-jobs'
/** 中文说明：服务局部值 TERMINAL_STATUSES，由紧邻初始化决定。 */
const TERMINAL_STATUSES = new Set(['completed', 'killed', 'failed'])

/** Cordis companion plugin name. */
/** 中文说明：服务局部值 name，由紧邻初始化决定。 */
export const name = 'jobs-invariant'
/** Service required before the companion can reserve package ownership. */
/** 中文说明：服务局部值 inject，由紧邻初始化决定。 */
export const inject = ['invariants']

/** Validate the cross-field relationships in one registry snapshot. */
/** 中文说明：函数 validateSnapshot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateSnapshot(snapshot: JobSnapshot, owner: Agent | undefined, fail: InvariantFailure): void {
  /** 中文说明：服务局部值 id，由紧邻初始化决定。 */
  const id = String(snapshot.id)
  /** 中文说明：服务局部值 prefix，由紧邻初始化决定。 */
  const prefix = `${snapshot.kind}-`
  /** 中文说明：服务局部值 ordinal，由紧邻初始化决定。 */
  const ordinal = Number(id.slice(prefix.length))
  if (snapshot.kind.length === 0 || !id.startsWith(prefix)
    || !Number.isSafeInteger(ordinal) || ordinal < 1) {
    fail(`job snapshot id ${JSON.stringify(id)} must be ${JSON.stringify(prefix)} followed by a positive ordinal`)
  }
  if (snapshot.label.length === 0) fail(`job ${JSON.stringify(id)} label must be non-empty`)
  if (!Number.isSafeInteger(snapshot.startedAt) || snapshot.startedAt < 0) {
    fail(`job ${JSON.stringify(id)} startedAt must be a non-negative epoch integer`)
  }

  /** 中文说明：服务局部值 terminal，由紧邻初始化决定。 */
  const terminal = TERMINAL_STATUSES.has(snapshot.status)
  if (terminal !== (snapshot.finishedAt !== undefined)) {
    fail(`job ${JSON.stringify(id)} finishedAt must be present exactly for a terminal status`)
  }
  if (snapshot.finishedAt !== undefined
    && (!Number.isSafeInteger(snapshot.finishedAt) || snapshot.finishedAt < snapshot.startedAt)) {
    fail(`job ${JSON.stringify(id)} finishedAt must be an epoch integer no earlier than startedAt`)
  }

  /** 中文说明：服务局部值 expectedOwner，由紧邻初始化决定。 */
  const expectedOwner = owner?.id
  if (snapshot.ownerSession !== expectedOwner) {
    fail(`job ${JSON.stringify(id)} ownerSession does not match its completion owner`)
  }
}

/** Install checks over current unowned records and every terminal snapshot. */
/** 中文说明：服务局部值 install，由紧邻初始化决定。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  /** 中文说明：服务局部值 snapshot，由紧邻初始化决定。 */
  for (const snapshot of ctx.jobs.list()) validateSnapshot(snapshot, undefined, fail)
  ctx.jobs.onJobDone((snapshot, owner) => { validateSnapshot(snapshot, owner, fail) })
}, { inject: ['jobs'] })

/**
 * Register the job-registry invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 中文说明：服务局部值 apply，由紧邻初始化决定。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
