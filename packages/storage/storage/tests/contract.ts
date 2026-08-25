/**
 * Shared KV-backend conformance suite. Each backend's spec file calls
 * {@link runKvBackendContract} with a factory bound to its own medium; the
 * suite asserts every clause of the `src/backend.ts` contract so both
 * backends are held to identical semantics.
 * @module
 */
/**
 * 文件职责：验证 contract.ts 覆盖的持久化存储行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的持久化存储能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */

import { describe, expect, it } from 'vitest'
import type { KvUnitDescriptor, StorageBackend } from '../src/backend.ts'

/** One conformance run: a fresh backend plus a way to reopen the same medium (crash simulation). */
/** 中文说明：interface KvBackendContractHarness 定义本测试所需的数据或行为，用于表达持久化存储场景。 */
export interface KvBackendContractHarness {
  /** The backend under test, freshly created over an empty medium. */
  backend: StorageBackend
  /** Open a NEW backend instance over the SAME medium, as after a process restart. */
  reopen(): Promise<StorageBackend>
}

/** 中文说明：常量 DESCRIPTOR 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DESCRIPTOR: KvUnitDescriptor = {
  name: 'contract_unit',
  version: 3,
  tables: ['alpha', 'beta'],
  hasGlobal: true,
}

/**
 * Run the shared conformance suite against one backend implementation.
 * @param label - Suite label, e.g. `json` / `sqlite`.
 * @param create - Factory producing a fresh harness per test.
 */
/** 中文说明：函数 runKvBackendContract 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
export function runKvBackendContract(label: string, create: () => Promise<KvBackendContractHarness>) {
  describe(`kv backend contract: ${label}`, () => {
    it('opens a missing unit as empty and serves loadAll immediately', async () => {
      const { backend } = await create()
      /** 中文说明：变量 unit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const unit = await backend.kv!.open(DESCRIPTOR)
      /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const snapshot = await unit.loadAll()
      expect(snapshot.tables).toEqual({ alpha: {}, beta: {} })
      expect(snapshot.global).toBeNull()
      await backend.close()
    })

    it('round-trips records and global durably across reopen', async () => {
      /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const harness = await create()
      /** 中文说明：变量 unit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const unit = await harness.backend.kv!.open(DESCRIPTOR)
      await unit.putRecord('alpha', 'k1', { n: 1 })
      await unit.putRecord('alpha', 'k2', { n: 2 })
      await unit.putRecord('beta', 'weird key / with:stuff', { ok: true })
      await unit.setGlobal({ counter: 7 })
      await harness.backend.close()

      /** 中文说明：变量 reopened 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const reopened = await harness.reopen()
      /** 中文说明：变量 unit2 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const unit2 = await reopened.kv!.open(DESCRIPTOR)
      /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const snapshot = await unit2.loadAll()
      expect(snapshot.tables['alpha']).toEqual({ k1: { n: 1 }, k2: { n: 2 } })
      expect(snapshot.tables['beta']).toEqual({ 'weird key / with:stuff': { ok: true } })
      expect(snapshot.global).toEqual({ counter: 7 })
      await reopened.close()
    })

    it('putRecord overwrites and deleteRecord is idempotent', async () => {
      const { backend } = await create()
      /** 中文说明：变量 unit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const unit = await backend.kv!.open(DESCRIPTOR)
      await unit.putRecord('alpha', 'k', { v: 'old' })
      await unit.putRecord('alpha', 'k', { v: 'new' })
      await unit.deleteRecord('alpha', 'k')
      await unit.deleteRecord('alpha', 'k')
      await unit.deleteRecord('alpha', 'never-existed')
      /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const snapshot = await unit.loadAll()
      expect(snapshot.tables['alpha']).toEqual({})
      await backend.close()
    })

    it('rejects a version mismatch on reopen without touching the data', async () => {
      /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const harness = await create()
      /** 中文说明：变量 unit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const unit = await harness.backend.kv!.open(DESCRIPTOR)
      await unit.putRecord('alpha', 'k', { v: 1 })
      await harness.backend.close()

      /** 中文说明：变量 reopened 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const reopened = await harness.reopen()
      await expect(reopened.kv!.open({ ...DESCRIPTOR, version: 4 })).rejects.toMatchObject({
        name: 'StorageError',
        code: 'version-mismatch',
      })
      // Original version still opens and still holds the data.
      /** 中文说明：变量 unit2 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const unit2 = await reopened.kv!.open(DESCRIPTOR)
      expect((await unit2.loadAll()).tables['alpha']).toEqual({ k: { v: 1 } })
      await reopened.close()
    })

    it('rejects operations after unit close, and close is idempotent', async () => {
      const { backend } = await create()
      /** 中文说明：变量 unit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const unit = await backend.kv!.open(DESCRIPTOR)
      await unit.close()
      await unit.close()
      await expect(unit.putRecord('alpha', 'k', {})).rejects.toMatchObject({ code: 'closed' })
      await expect(unit.loadAll()).rejects.toMatchObject({ code: 'closed' })
      await backend.close()
      await backend.close()
    })
  })
}
