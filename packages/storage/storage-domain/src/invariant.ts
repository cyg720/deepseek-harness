/**
 * ================================ 文件注释 ================================
 * 【文件职责】storage-domain 包的"不变式伴生插件"（invariant companion）：注册一个
 * 运行时自检，保证每个 domain/changed 事件与发出它的领域的内存态一致。
 * 【技术维度】实现为 Cordis 伴生插件：用 ctx.on 订阅领域事件，通过 ctx.storage.form
 * 取回领域运行时，把事件快照与内存当前值逐字段比对，不一致就调用 fail 上报。
 * 【产品维度】这是仓库的"不变式自检"体系（dsh-invariants）的一部分：在开发/测试期
 * 捕获"写路径绕过了写链或发出过期值"这类内部错误，而不是等用户数据损坏才发现。
 * 【逻辑维度】按出现顺序：PACKAGE_NAME（注册名）→ name/inject（插件元信息）→ install
 * （自检逻辑：全局写比对 global 值、表写按 put/deleted 分支比对）→ apply（注册入口）。
 * 【关键边界】监听器以 { global: true } 注册（监听所有上下文）；事件是通知而非事务，
 * 所以自检只报告（fail）而不改动任何状态。
 * 【新手阅读建议】先看 install 里的 switch 分支理解三种自检，再看 apply 理解如何注册。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-storage-domain`: every
 * `domain/changed` event must agree with the emitting domain's authoritative
 * in-memory state (the owned event-stream ↔ mutable-data relationship of this
 * package). Writes emit strictly after mutating memory and the write chain
 * serializes them, so at emission time the event's snapshot equals the
 * current read — any divergence means a write path skipped the chain or
 * emitted a stale value.
 * @module @deepseek-ai/dsh-storage-domain/invariant
 */
/**
 * 模块总览：本文件是"不变式自检"插件。领域层约定"先改内存、再发事件"，本插件
 * 反向核对"事件值 == 当前内存值"，一旦不符就说明有写入路径绕过了规范流程。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from './events.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-storage-domain'

/** Cordis companion plugin name. */
/** 伴生插件在 Cordis 中的插件名。 */
export const name = 'storage-domain-invariant'
/** Service required before the companion can reserve package ownership. */
/** 依赖注入声明：必须先有 invariants 服务，本插件才能注册自检。 */
export const inject = ['invariants']

/** Install the change-event ↔ memory-state agreement check. */
/**
 * 安装"事件与内存态一致"自检：Object.assign 同时给函数挂上 inject 元信息，
 * 使 Cordis 注入 storage 服务后再执行。fail 由 dsh-invariants 框架注入，
 * 触发后由框架统一记录/上报。
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('domain/changed', (change: DomainChanged) => {
    const domain = ctx.storage.form('domain').get(change.domain)
    if (domain === undefined) {
      return fail(`domain/changed for '${change.domain}' emitted while that domain is not open`)
    }
    if (change.table === '') {
      // Global write: the event snapshot must be the current global value.
      // 中文说明：全局单例写入——事件快照必须等于当前 global 内存值。
      if (domain.global.get() !== change.value) {
        return fail(`domain/changed global value for '${change.domain}' differs from the in-memory global`)
      }
      return
    }
    const current = domain.table(change.table).get(change.key)
    switch (change.operation) {
      case 'deleted':
        // 中文说明：删除事件——记录此刻必须已不在内存中。
        if (current !== undefined) {
          return fail(
            `domain/changed deletion of '${change.domain}'.'${change.table}'['${change.key}'] `
            + 'emitted while the record is still in memory',
          )
        }
        return
      case 'put':
        // 中文说明：写入事件——事件快照必须等于当前内存记录。
        if (current !== change.value) {
          return fail(
            `domain/changed value for '${change.domain}'.'${change.table}'['${change.key}'] `
            + 'differs from the in-memory record',
          )
        }
        return
      default:
        change satisfies never
    }
  }, { global: true })
}, { inject: ['storage'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/**
 * 注册本包的不变式伴生插件。
 * @param ctx 携带 invariants 服务的 Cordis 上下文。
 * @returns 注册成功后的注销函数。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
