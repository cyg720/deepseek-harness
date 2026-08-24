/**
 * 文件职责：验证 SQLite 存储后端注册其解释为空的 invariant companion。
 * 技术维度：使用 Vitest 与真实 Cordis InvariantRegistry 装载后端 companion。
 * 产品维度：保证 SQLite KV 后端在运行时诊断体系中有清晰包归属。
 * 逻辑维度：创建上下文、启用注册表、挂载 SQLite companion 并等待成功。
 * 关键边界：测试不打开数据库，也不验证 KV 读写或事务行为。
 * 新手阅读建议：先看空 installer 的理由，再阅读 SQLite 后端的实际测试。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as StorageSqliteInvariant from '../src/invariant.ts'

/** SQLite 存储 invariant 测试套件；由 Vitest 自动执行。 */
describe('invariant companion', () => {
  /** 验证解释为空的 companion 成功注册；异步回调无参数。 */
  it('registers under the package name with an explained-empty installer', async () => {
    /** 当前用例独享的空 Cordis 上下文。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(StorageSqliteInvariant).await()).resolves.toBeDefined()
  })
})
