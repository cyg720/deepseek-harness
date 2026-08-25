/**
 * 文件职责：验证凭据存储的 memory.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证凭据存储在真实组装、失败和清理场景中可靠。
 * 逻辑维度：构造服务或远程替身，驱动操作并断言结果。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */
import type { Context } from '@deepseek-ai/cordis'
import { CredentialProvider } from '../src/index.ts'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '../src/index.ts'

/**
 * In-memory credentials provider for interface and consumer tests: one
 * always-writable `memory` source seeded from plugin config.
 */
/* 中文说明：类型或类 MemoryCredentials 约束远程资源或测试数据职责。 */
export class MemoryCredentials extends CredentialProvider {
  private readonly store = new Map<string, string>()
  private readonly records = new Map<CredentialKey, CredentialRecord>()

  constructor(ctx: Context, seed: Record<string, string> = {}) {
    super(ctx)
    /** 中文说明：测试局部值 [key，由紧邻初始化决定。 */
    for (const [key, value] of Object.entries(seed)) this.store.set(key, value)
  }

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = this.store.get(ref)
    return Promise.resolve(value === undefined || value.length === 0
      ? undefined
      : { value, source: 'memory' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = this.store.get(ref)
    /** 中文说明：测试局部值 configured，由紧邻初始化决定。 */
    const configured = value !== undefined && value.length > 0
    return Promise.resolve({
      configured,
      ...configured ? { source: 'memory' } : {},
      writable: true,
    })
  }

  override set(ref: CredentialRef, value: string): Promise<void> {
    if (value.length === 0) {
      return Promise.reject(new Error('memory credentials: an empty value cannot be stored; use unset'))
    }
    this.store.set(ref, value)
    this.ctx.emit('credentials/reference-updated', ref)
    return Promise.resolve()
  }

  override unset(ref: CredentialRef): Promise<void> {
    if (this.store.delete(ref)) {
      this.ctx.emit('credentials/reference-updated', ref)
    }
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
    if (this.records.delete(key)) {
      this.ctx.emit('credentials/record-updated', key)
    }
    return Promise.resolve()
  }
}
