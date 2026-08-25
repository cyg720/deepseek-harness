/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-workspace`.
 * @module @deepseek-ai/dsh-workspace/invariant
 */
/*
 * 文件职责：实现 invariant.ts 覆盖的工作区实体与配置行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作区实体与配置能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** 中文说明：常量 PACKAGE_NAME 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-workspace'

/** Cordis companion plugin name. */
/* 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'workspace-invariant'
/** Service required before the companion can reserve package ownership. */
/* 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['invariants']

/**
 * Owned relationship: the registry's entity cache mirrors the workspace
 * domain's durable table. Every `domain/changed` for the `workspaces` table
 * must name a record the cache already holds an entity for (the registry
 * caches before the durable put and mutates only through cached entities).
 * A delete is valid only after the registry has removed the entity from its
 * cache, whether for create rollback or an explicit registration deletion;
 * deleting while the cache still publishes the entity proves a bypass.
 */
/* 中文说明：变量 install 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'workspace' || change.table !== 'workspaces') return
      if (change.operation === 'deleted') {
        if (ctx.workspaceRegistry.get(WorkspaceId(change.key)) !== undefined) {
          fail(
            `workspace record '${change.key}' was deleted while the registry cache still `
            + 'publishes it — some write path bypassed ctx.workspaceRegistry',
          )
        }
        return
      }
      if (ctx.workspaceRegistry.get(WorkspaceId(change.key)) === undefined) {
        fail(
          `workspace record '${change.key}' landed durably but the registry cache holds `
          + 'no entity for it — the cache and the domain table have diverged',
        )
      }
    })
  },
  { inject: ['workspaceRegistry'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 中文说明：函数值 apply 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
