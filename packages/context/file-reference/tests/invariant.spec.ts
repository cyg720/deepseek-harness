/**
 * 文件职责：验证文件引用能力定义包注册其无状态能力 invariant。
 * 技术维度：使用 Vitest 与真实 Cordis invariant 服务执行插件挂载。
 * 产品维度：保证共享 `@file` 语法和发现接口在诊断体系中有能力归属。
 * 逻辑维度：创建上下文、启用服务、挂载 companion 并断言解析成功。
 * 关键边界：本测试不要求具体文件系统提供者，也不执行引用发现。
 * 新手阅读建议：先区分能力定义和本地提供者，再看各自 invariant 测试。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantService from '@deepseek-ai/dsh-invariants'
import * as FileReferenceInvariant from '../src/invariant.ts'

/** 文件引用能力 invariant 测试套件；由 Vitest 自动调用。 */
describe('invariant companion', () => {
  /** 验证无状态能力 companion 成功注册；异步回调没有输入参数。 */
  it('registers the stateless seam under its package name', async () => {
    /** 当前用例专属的空 Cordis 上下文。 */
    const ctx = new Context()
    await ctx.plugin(InvariantService, { enabled: true })
    await expect(ctx.plugin(FileReferenceInvariant).await()).resolves.toBeDefined()
  })
})
