/**
 * 文件职责：验证凭据授权的 memory.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证凭据授权在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'

/**
 * In-memory credentials provider for the authorization suite. Only the record
 * half is exercised — the seam's whole interest in this service is whether a
 * flow left a record behind — so the reference half answers "nothing stored".
 */
// TODO: near-duplicate of the record half of
// packages/credentials/credentials/tests/memory.ts; fold both into a shared
// test-support double when a third suite needs one.
/** 中文说明：类型或类 MemoryCredentials 约束服务或测试数据职责。 */
export class MemoryCredentials extends CredentialProvider {
  private readonly records = new Map<CredentialKey, CredentialRecord>()

  override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return Promise.resolve(undefined)
  }

  override describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: false, writable: true })
  }

  override set(_ref: CredentialRef, _value: string): Promise<void> {
    return Promise.resolve()
  }

  override unset(_ref: CredentialRef): Promise<void> {
    return Promise.resolve()
  }

  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(this.records.get(key))
  }

  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored = this.records.get(key)
    return Promise.resolve(stored === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: stored.kind, writable: true })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([key, record]) => ({ key, kind: record.kind })))
  }

  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    /** 中文说明：测试局部值 current，由紧邻初始化决定。 */
    const current = this.records.get(key)
    /** 中文说明：测试局部值 next，由紧邻初始化决定。 */
    const next = await mutate(current)
    if (next === undefined) return current
    this.records.set(key, next)
    this.ctx.emit('credentials/record-updated', key)
    return next
  }

  override deleteRecord(key: CredentialKey): Promise<void> {
    if (this.records.delete(key)) this.ctx.emit('credentials/record-updated', key)
    return Promise.resolve()
  }
}
