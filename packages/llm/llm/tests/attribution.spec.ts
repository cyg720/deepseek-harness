/**
 * 文件职责：验证 LLM 请求归属身份从包清单取版本，并正确生成 User-Agent 与归属请求头。
 * 技术维度：使用 Vitest、createRequire 读取 package.json 和白标 AppIdentity 测试全部覆盖点。
 * 产品维度：让上游提供者识别 DeepSeek Harness 或二次发行产品，而不泄露动态私有信息。
 * 逻辑维度：检查默认身份，测试默认/自定义 userAgent，再测试默认/自定义 attributionHeaders。
 * 关键边界：身份只含静态公开事实；默认仅发送 user-agent，不添加提供者特定头。
 * 新手阅读建议：先看 manifest/forkIdentity，再按 APP_IDENTITY、userAgent、headers 三组断言阅读。
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { APP_IDENTITY, attributionHeaders, userAgent } from '@deepseek-ai/dsh-llm'
import type { AppIdentity } from '@deepseek-ai/dsh-llm'

// 从当前包 package.json 读取的清单版本。
const manifest = createRequire(import.meta.url)('../package.json') as { version: string }

/** A white-label identity exercising every override hook. */
/** 覆盖所有身份字段的白标测试样本。 */
const forkIdentity: AppIdentity = {
  product: 'fork-agent',
  version: '9.9.9',
  url: 'https://example.com/fork-agent',
}

// 默认应用身份测试套件。
describe('APP_IDENTITY', () => {
  // 验证版本来自清单而非手抄常量。
  it('sources the version from the package manifest, never a hand-copied constant', () => {
    expect(APP_IDENTITY.version).toBe(manifest.version)
  })

  // 验证只包含三个公开静态字段。
  it('carries only static public product facts', () => {
    expect(APP_IDENTITY).toEqual({
      product: 'deepseek-harness',
      version: manifest.version,
      url: 'https://github.com/deepseek-ai/deepseek-harness',
    })
  })
})

// User-Agent 格式测试套件。
describe('userAgent', () => {
  // 验证默认 product/version 和 +url 注释。
  it('renders product/version with the +url comment', () => {
    expect(userAgent()).toBe(
      `deepseek-harness/${manifest.version} (+https://github.com/deepseek-ai/deepseek-harness)`,
    )
  })

  // 验证自定义身份完整替换默认值。
  it('renders a custom identity', () => {
    expect(userAgent(forkIdentity)).toBe('fork-agent/9.9.9 (+https://example.com/fork-agent)')
  })
})

// 归属请求头测试套件。
describe('attributionHeaders', () => {
  // 验证默认只有中立 User-Agent。
  it('defaults to the provider-neutral baseline: User-Agent and nothing else', () => {
    expect(attributionHeaders()).toEqual({ 'user-agent': userAgent() })
  })

  // 验证自定义身份也只映射到 User-Agent。
  it('maps a custom identity onto the User-Agent header only', () => {
    expect(attributionHeaders(forkIdentity)).toEqual({
      'user-agent': 'fork-agent/9.9.9 (+https://example.com/fork-agent)',
    })
  })
})
