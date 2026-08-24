/**
 * 文件职责：验证客户端时区解析返回浏览器实际时区，并在运行时缺失时明确失败。
 * 技术维度：使用 Vitest 参数化测试、Intl.DateTimeFormat 和方法模拟覆盖正常与异常分支。
 * 产品维度：保证时间上下文显示准确，避免在未知时区下静默产生错误时间。
 * 逻辑维度：每个用例后恢复模拟；正常用例比较原生结果，异常用例模拟 undefined 与空字符串。
 * 关键边界：浏览器必须提供非空 IANA 时区名称；测试强制把缺失值转换为声明类型以验证运行时防线。
 * 新手阅读建议：先看正常路径，再观察 spyOn 如何只在失败用例中替换 resolvedOptions。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvedClientTimeZone } from '../src/client/time-zone.ts'

// 清理回调：每个用例结束后恢复所有 Intl 方法模拟，防止状态泄漏到后续测试。
afterEach(() => {
  vi.restoreAllMocks()
})

// 测试组：覆盖浏览器时区解析的成功和失败行为。
describe('browser time zone', () => {
  /**
   * 功能描述：确认辅助函数原样返回当前运行时解析的时区。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：无返回值；结果不一致时由 Vitest 报错。
   * 使用示例：浏览器报告 Asia/Shanghai 时辅助函数也应返回该值。
   */
  it('returns the runtime-resolved zone', () => {
    expect(resolvedClientTimeZone()).toBe(
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
  })

  /**
   * 功能描述：确认运行时返回 undefined 或空字符串时立即抛出明确错误。
   * 参数说明：timeZone 是参数化缺失样本，仅取 undefined 或空字符串。
   * 返回值解释：无返回值；未抛出预期消息时断言失败。
   * 使用示例：模拟 timeZone: '' 后调用 resolvedClientTimeZone() 应抛错。
   */
  it.each([undefined, ''])('fails loud when the runtime exposes no zone %#', (timeZone) => {
    // options：模拟前由真实 Intl 解析出的完整选项，用于只覆盖 timeZone 字段。
    const options = new Intl.DateTimeFormat().resolvedOptions()
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...options,
      timeZone: timeZone as string,
    })

    expect(() => resolvedClientTimeZone()).toThrow('browser time zone is unavailable')
  })
})
