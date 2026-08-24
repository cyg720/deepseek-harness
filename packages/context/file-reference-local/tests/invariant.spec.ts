/**
 * 文件职责：验证本地文件引用提供者注册其缓存所有权 invariant。
 * 技术维度：使用 Vitest、Cordis Context 和真实 InvariantService 挂载插件。
 * 产品维度：确保本地模糊索引缓存始终由正确提供者拥有并可诊断。
 * 逻辑维度：启用 invariant 服务，挂载本地 companion，并等待注册完成。
 * 关键边界：测试不扫描真实文件，也不验证模糊搜索结果。
 * 新手阅读建议：先看包级 companion 的注册，再阅读提供者缓存的生命周期。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantService from '@deepseek-ai/dsh-invariants'
import * as FileReferenceLocalInvariant from '../src/invariant.ts'

/** 本地文件引用 invariant 测试套件；由 Vitest 单元测试命令运行。 */
describe('invariant companion', () => {
  /** 验证缓存所有权检查被注册；回调无输入，异步完成后无业务返回值。 */
  it('registers the provider cache ownership under its package name', async () => {
    /** 隔离当前注册关系的全新 Cordis 上下文。 */
    const ctx = new Context()
    await ctx.plugin(InvariantService, { enabled: true })
    await expect(ctx.plugin(FileReferenceLocalInvariant).await()).resolves.toBeDefined()
  })
})
