/** Contract behavior the seam itself owns: registration identity and typed failures. */
/*
 * 文件职责：验证目录选择能力接口拥有的服务注册身份和类型化错误字段。
 * 技术维度：使用 Vitest、Cordis 服务插件和最小 DirectoryPicker 子类测试抽象能力接口。
 * 产品维度：确保宿主目录选择器可被插件发现、随生命周期释放，并提供可处理的业务错误。
 * 逻辑维度：StubPicker 返回固定原生能力；用例分别检查服务注册/注销和错误名称、代码、路径、消息。
 * 关键边界：测试替身不打开真实系统对话框；能力 pick 始终返回 null。
 * 新手阅读建议：先看 StubPicker 如何实现抽象方法，再按两个用例理解服务与错误两类约定。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DirectoryPicker, DirectoryPickerError } from '../src/index.ts'
import type { DirectoryPickerCapability } from '../src/index.ts'

/** Minimal concrete backend: all a subclass owes the abstract class is capability(). */
/* 最小具体后端；演示子类只需实现 capability 即可成为 Cordis 目录选择服务。 */
class StubPicker extends DirectoryPicker {
  // 固定原生能力对象；pick 异步返回 null 表示用户未选择目录。
  private readonly stub: DirectoryPickerCapability = { kind: 'native', pick: async () => null }
  /** 返回测试能力。@returns 同一 stub 对象。@example new StubPicker(ctx).capability()。 */
  capability(): DirectoryPickerCapability {
    return this.stub
  }
}

// 目录选择能力接口测试套件。
describe('DirectoryPicker seam', () => {
  // 验证子类注册为服务并随 fiber 释放。
  it('registers a subclass as ctx.directoryPicker and leaves with its fiber', async () => {
    // 本用例独立 Cordis 上下文。
    const ctx = new Context()
    // StubPicker 插件 fiber。
    const fiber = ctx.plugin(StubPicker)
    await fiber.await()
    expect(ctx.get('directoryPicker')).toBeInstanceOf(StubPicker)
    expect(ctx.get('directoryPicker')!.capability().kind).toBe('native')
    await fiber.dispose()
    expect(ctx.get('directoryPicker')).toBeUndefined()
  })

  // 验证 DirectoryPickerError 保留业务代码、目标路径和可读消息。
  it('carries the business code and subject path on DirectoryPickerError', () => {
    // 模拟目标目录已存在的类型化失败。
    const failure = new DirectoryPickerError('directory-exists', '/home/u/x', '/home/u/x already exists')
    expect(failure.name).toBe('DirectoryPickerError')
    expect(failure.code).toBe('directory-exists')
    expect(failure.path).toBe('/home/u/x')
    expect(failure.message).toContain('already exists')
    expect(failure).toBeInstanceOf(Error)
  })
})
