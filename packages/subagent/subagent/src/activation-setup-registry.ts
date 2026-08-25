/*
 * ================================ 文件注释 ================================
 * 【文件职责】内部注册表：把部署方注入的能力（contribution）安装进每个可续聊子代理的
 *   未发布创建上下文（child context），并管理安装、回滚、子作用域清理与即时吊销。
 * 【技术维度】三类内部记录（Registration/Installation/TransactionState）维护
 *   注册↔安装↔子上下文 的关系；apply() 返回 AgentSetupCommit 供 Agent 发布边界消费；
 *   通过 Cordis effect 在子作用域销毁时自动释放安装。
 * 【产品维度】让宿主可以给续聊子代理统一附加能力（如额外工具），而不必让 continuation
 *   管理器知道有哪些能力存在——插件生命周期、未发布 setup、Activation 销毁三者在此对齐。
 * 【逻辑维度】按代码顺序：ContinuableSetupContribution 类型 → 三个内部接口 →
 *   SubagentActivationSetupRegistry 类（register/apply/releaseChild/releaseAll/release）。
 * 【关键边界】安装器抛错时回滚所有已安装项；贡献被吊销后，任何已快照的 apply() 都不能再安装；
 *   每个安装恰好释放一次（released 标记 + 双向索引删除）。
 * 【新手阅读建议】先读 apply() 的"事务 + 提交"结构，再看 release() 如何保证精确一次释放。
 * ==========================================================================
 */

/**
 * Internal registry of deployment capabilities composed into every continuable
 * child's unpublished creation context.
 *
 * A contribution grants a child-scoped capability without teaching the
 * continuation manager which capabilities exist. The manager owns residency;
 * this registry owns the join between plugin lifetime, unpublished setup, and
 * Activation disposal, so no installation outlives either owner and no removed
 * contribution can be installed after revocation reports completion.
 *
 * @module @deepseek-ai/dsh-subagent/activation-setup-registry
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentSetupCommit } from '@deepseek-ai/dsh-agent'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { SubagentError } from './error.ts'

/**
 * One deployment capability installed into a continuable child's unpublished
 * creation context. It composes synchronously before publication and returns
 * the disposer for exactly that installation.
 * @param childCtx - the child's unpublished scoped context.
 * @returns the disposer revoking this installation.
 */
export type ContinuableSetupContribution = (childCtx: Context) => () => void

// 中文：一条贡献的"存活注册"记录：removed 在吊销时置位（保证已快照的 apply 不再安装），
// installations 记录它当前安装到的所有子上下文。
/** One contribution's live registration. */
interface Registration {
  readonly contribution: ContinuableSetupContribution
  removed: boolean
  readonly installations: Set<Installation>
}

// 中文：一次"贡献 × 子上下文"的安装记录：dispose 是安装返回的撤销器，released 保证
// 恰好释放一次，transaction 在该子代理达到驻留前一直存在（提交时被清空）。
/** One contribution installed into one child context. */
interface Installation {
  readonly registration: Registration
  readonly childCtx: Context
  readonly dispose: () => void
  released: boolean
  /** Present until the child reaches residency. */
  transaction: TransactionState | undefined
}

// 中文：一个子代理的"一批安装"事务状态：installations 是本批记录，
// invalidated 在该批内任一安装被提前释放时置位（提交阶段据此拒绝发布）。
/** One child's provisioning batch. */
interface TransactionState {
  readonly installations: Installation[]
  invalidated: boolean
}

// 中文：重新读取可变的 removed 状态（安装器可能在自己安装期间吊销自己）。
/** Re-read mutable removal state after a contribution may have revoked itself. */
function isRemoved(registration: Registration): boolean {
  return registration.removed
}

/**
 * Owns continuable-child setup registrations, installations, rollback, child
 * cleanup, and immediate live revocation.
 */
// 中文：续聊子代理"部署能力安装"注册表：注册/安装/回滚/子作用域清理/即时吊销全部在此。
// 管理器负责驻留，本注册表负责"插件生命周期 ↔ 未发布 setup ↔ Activation 销毁"的对齐。
export class SubagentActivationSetupRegistry {
  // 中文：存活贡献集合（按安装顺序）；吊销即删除并释放其全部安装。
  /** Live contributions in installation order. */
  private readonly registrations = new Set<Registration>()
  // 中文：子上下文 → 该上下文上的安装集合，用于子作用域销毁时的整体释放。
  /** Child context to its live installations. */
  private readonly byChild = new Map<Context, Set<Installation>>()

  /**
   * Register one contribution.
   * @param contribution - synchronous child-scope installer.
   * @returns an idempotent registration undo.
   * @throws after attempting every installation when any disposer fails.
   */
  // 中文：注册一条贡献；返回的撤销器幂等：置 removed、从集合删除、并释放它已安装的
  // 全部安装。吊销先于释放完成，保证并发 apply 无法再安装它。
  register(contribution: ContinuableSetupContribution): () => void {
    const registration: Registration = { contribution, removed: false, installations: new Set() }
    this.registrations.add(registration)
    return () => {
      if (registration.removed) return
      // Close before disposal so a snapshotted apply() cannot install after
      // revocation reports completion.
      registration.removed = true
      this.registrations.delete(registration)
      this.releaseAll([...registration.installations], 'contribution removal')
    }
  }

  /**
   * Install every live contribution into one unpublished child context.
   * @param childCtx - the child's unpublished scoped context.
   * @returns the provisioning commit consumed at Agent publication.
   */
  // 中文：把所有存活贡献安装进一个未发布子上下文：先快照注册集合再逐个安装（安装器可能
  // 吊销自己，此时立即释放该安装并使本批事务失效）；任何安装器抛错则回滚本批已安装项；
  // 返回的 commit 在 Agent 发布边界消费，事务被吊销时 commit 抛 ACTIVATION_SETUP_REVOKED。
  apply(childCtx: Context): AgentSetupCommit {
    const state: TransactionState = { installations: [], invalidated: false }
    try {
      for (const registration of [...this.registrations]) {
        /* v8 ignore next -- only a synchronous re-entrant revocation of an
         * already-snapshotted registration reaches this guard. */
        if (registration.removed) continue
        const installation: Installation = {
          registration,
          childCtx,
          dispose: registration.contribution(childCtx),
          released: false,
          transaction: state,
        }
        registration.installations.add(installation)
        state.installations.push(installation)
        let indexed = this.byChild.get(childCtx)
        if (indexed === undefined) {
          indexed = new Set()
          this.byChild.set(childCtx, indexed)
        }
        indexed.add(installation)
        // An installer may revoke itself before its installation record exists.
        // Dispose that escaped record and invalidate the provisioning batch.
        if (isRemoved(registration)) this.release(installation)
      }
    } catch (error: unknown) {
      // Keep the installer failure authoritative, but attempt every rollback.
      try {
        this.releaseAll([...state.installations], 'setup rollback')
      } catch (releaseFailure: unknown) {
        /* v8 ignore next -- requires independent installer and rollback faults. */
        void releaseFailure
      }
      throw error
    }
    childCtx.effect(() => () => { this.releaseChild(childCtx) }, 'subagents.activationSetup()')
    return {
      commit: () => {
        if (state.invalidated) {
          throw new SubagentError(
            'a continuable-subagent setup contribution was revoked while this child was being built; '
            + 'the child was not established',
            'ACTIVATION_SETUP_REVOKED',
          )
        }
        for (const installation of state.installations) installation.transaction = undefined
      },
    }
  }

  /** Release every remaining installation owned by one disposed child scope. */
  // 中文：子作用域销毁时释放其全部安装（由 effect 注册的清理器调用）。
  private releaseChild(childCtx: Context): void {
    const indexed = this.byChild.get(childCtx) ?? []
    this.releaseAll([...indexed], 'child scope disposal')
  }

  /**
   * Release a batch completely before reporting disposer failures.
   * @param installations - records to release.
   * @param during - operation name for diagnostics.
   */
  // 中文：批量释放：逐个调用 release 并收集失败，全部尝试完后再统一抛
  // ACTIVATION_SETUP_RELEASE_FAILED（绝不让一个失败阻断其余释放）。
  private releaseAll(installations: readonly Installation[], during: string): void {
    const failures: unknown[] = []
    for (const installation of installations) {
      try {
        this.release(installation)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length === 0) return
    throw new SubagentError(
      `continuable-subagent setup ${during} failed to release ${failures.length} installation(s): `
      + failures.map(failure => errorChain(failure)).join('; '),
      'ACTIVATION_SETUP_RELEASE_FAILED',
    )
  }

  /** Drop one installation from both indices and dispose it exactly once. */
  // 中文：从两个索引中删除该安装并恰好释放一次：released 防重入，transaction 存在时
  // 把本批事务标记为失效（让 commit 拒绝发布），最后调用安装器返回的 dispose。
  private release(installation: Installation): void {
    if (installation.released) return
    installation.released = true
    installation.registration.installations.delete(installation)
    const indexed = this.byChild.get(installation.childCtx)
    /* v8 ignore next 4 -- every live installation is indexed until this method removes it. */
    if (indexed !== undefined) {
      indexed.delete(installation)
      if (indexed.size === 0) this.byChild.delete(installation.childCtx)
    }
    if (installation.transaction !== undefined) installation.transaction.invalidated = true
    installation.dispose()
  }
}

export default SubagentActivationSetupRegistry
