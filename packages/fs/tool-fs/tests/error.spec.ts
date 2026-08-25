/**
 * Unit tests for the model-facing error remediation: the remedy appended to
 * guarded-mutation failures, code preservation, and passthrough behavior.
 */
/*
 * 文件职责：验证面向模型的文件系统错误会补充可操作修复建议，同时保留错误代码和无关值。
 * 技术维度：使用 Vitest 和 FsError 类型覆盖错误包装、cause 链与引用透传。
 * 产品维度：帮助模型在版本过期或未观察文件时采取正确的重新读取步骤。
 * 逻辑维度：分别测试陈旧版本、未观察、其他 FsError 和普通 Error 四条路径。
 * 关键边界：只改写两个可修复代码；其他错误必须保持同一对象引用。
 * 新手阅读建议：先比较前两个用例的追加文案，再看后两个用例为何要求对象完全相同。
 */

import { describe, expect, it } from 'vitest'
import { FsError } from '@deepseek-ai/dsh-fs'
import { remediateFsError } from '../src/error.ts'

// 文件系统错误修复测试套件。
describe('remediateFsError', () => {
  // 验证陈旧版本错误追加重新读取建议并保留代码和 cause。
  it('appends the re-read remedy to FS_STALE_VERSION, preserving the code and chaining the cause', () => {
    // 原始陈旧版本错误。
    const original = new FsError('cannot edit "x": file changed since it was read', 'FS_STALE_VERSION')
    // 修复后的 FsError，应为新对象并以 original 为 cause。
    const remedied = remediateFsError(original) as FsError
    expect(remedied).toBeInstanceOf(FsError)
    expect(remedied.message).toBe('cannot edit "x": file changed since it was read — re-read the file, then retry')
    expect(remedied.code).toBe('FS_STALE_VERSION')
    expect(remedied.cause).toBe(original)
  })

  // 验证未观察错误提示先读取文件。
  it('appends the read remedy to FS_NOT_OBSERVED', () => {
    // 补充读取建议后的错误。
    const remedied = remediateFsError(new FsError('edit requires reading "x" first', 'FS_NOT_OBSERVED')) as FsError
    expect(remedied.message).toBe('edit requires reading "x" first — read the file, then retry')
    expect(remedied.code).toBe('FS_NOT_OBSERVED')
  })

  // 验证其他文件系统错误代码不被改写。
  it('leaves other FsError codes untouched', () => {
    // 不属于修复范围的原始错误，应原样返回。
    const original = new FsError('no match anywhere', 'FS_EDIT_NOT_FOUND')
    expect(remediateFsError(original)).toBe(original)
  })

  // 验证非 FsError 值不被包装。
  it('leaves non-FsError values untouched', () => {
    // 普通 Error，应保持同一引用。
    const original = new Error('boom')
    expect(remediateFsError(original)).toBe(original)
  })
})
