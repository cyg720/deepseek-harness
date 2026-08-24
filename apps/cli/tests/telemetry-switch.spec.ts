/**
 * 文件职责：验证 CLI 的遥测硬禁用环境开关如何生成配置补丁。
 * 技术维度：使用 Vitest 覆盖 undefined、空字符串、任意非空字符串和无遥测组合。
 * 产品维度：给用户一个简单且失败关闭的隐私开关，同时尊重未设置时的配置选择。
 * 逻辑维度：未设置或空值不覆盖配置；任何非空值禁用遥测；组合无遥测行时不生成补丁。
 * 关键边界：值不按布尔文本解析，'0'、'false'、'no' 也表示硬禁用。
 * 新手阅读建议：重点比较空字符串与看似假值的非空字符串，理解开关判断的是“是否非空”。
 */
import { describe, expect, it } from 'vitest'
import { resolveTelemetryPatch } from '../src/profile-boot.ts'

// 测试组：覆盖 resolveTelemetryPatch 的三类组合状态。
describe('resolveTelemetryPatch', () => {
  /** 功能描述：确认未设置或空开关不覆盖配置；参数：无；返回：无补丁；示例：undefined。 */
  it('preserves the configured telemetry mode when the hard-disable switch is unset or empty', () => {
    expect(resolveTelemetryPatch(undefined, true)).toBeUndefined()
    expect(resolveTelemetryPatch('', true)).toBeUndefined()
  })

  /** 功能描述：确认任意非空值都禁用遥测；参数：value 为当前样本；返回：禁用补丁。 */
  it('disables on ANY non-empty value, including falsy-looking ones', () => {
    // value：当前非空环境变量样本，包括看似假值的文本。
    for (const value of ['1', '0', 'false', 'no']) {
      expect(resolveTelemetryPatch(value, true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    }
  })

  /** 功能描述：确认无遥测行的组合无需补丁；参数：无；返回：undefined；示例：自定义 profile。 */
  it('is trivially satisfied by a composition without the telemetry row', () => {
    // A custom profile need not mount telemetry: nothing exports, so the
    // privacy switch has nothing to disable and generates no patch.
    // 自定义 profile 可以不装配遥测；没有对应导出时隐私开关无需生成任何补丁。
    expect(resolveTelemetryPatch('1', false)).toBeUndefined()
    expect(resolveTelemetryPatch(undefined, false)).toBeUndefined()
  })
})
