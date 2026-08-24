/**
 * 文件职责：验证 SQLite 会话持久化在 Zstandard 压缩无收益时保留原始文本。
 * 技术维度：使用 Vitest 模块模拟替换 node:zlib 压缩器，并构造达到阈值的会话事件。
 * 产品维度：避免会话数据库为更大的压缩帧付出额外存储和解压成本。
 * 逻辑维度：模拟压缩结果比输入多一字节，导入压缩逻辑，绑定大事件并断言 data 仍是字符串。
 * 关键边界：测试只覆盖“压缩后更大”分支；事件类型转换用于构造最小持久化输入。
 * 新手阅读建议：先看 zstdCompressSync 模拟如何制造无收益结果，再看 bindRecord 的最终类型断言。
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * 功能描述：把 node:zlib 的 Zstandard 压缩替换为始终比输入大一字节的测试实现。
 * 参数说明：importOriginal 加载真实模块；input 是当前待压缩的字节视图。
 * 返回值解释：返回保留真实导出但覆盖 zstdCompressSync 的模拟模块。
 * 使用示例：输入 N 字节时模拟压缩器返回 N+1 字节 Buffer。
 */
vi.mock('node:zlib', async (importOriginal) => {
  // actual：真实 node:zlib 模块，除压缩函数外的导出保持原行为。
  const actual = await importOriginal<typeof import('node:zlib')>()
  return {
    ...actual,
    zstdCompressSync: (input: ArrayBufferView) => Buffer.alloc(input.byteLength + 1),
  }
})

import { bindRecord, ZSTD_DATA_THRESHOLD_BYTES } from '../src/compression.ts'

// 测试组：覆盖 SQLite 压缩结果不比原文本小时的回退行为。
describe('SQLite compression fallback', () => {
  /**
   * 功能描述：确认达到压缩阈值的大事件在压缩无收益时仍以文本绑定。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：无返回值；绑定数据不是字符串时由 Vitest 报错。
   * 使用示例：压缩帧比原数据大一字节时 bindRecord(event).data 应为 string。
   */
  it('keeps large data as text when its Zstandard frame is not smaller', () => {
    // event：正文长度恰好达到压缩阈值的最小助手消息事件。
    const event = {
      type: 'assistant/message',
      seq: 0,
      time: 1,
      data: { text: 'x'.repeat(ZSTD_DATA_THRESHOLD_BYTES) },
    } as unknown as SessionEvent

    expect(typeof bindRecord(event).data).toBe('string')
  })
})
