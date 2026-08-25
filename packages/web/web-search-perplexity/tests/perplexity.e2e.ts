/**
 * 文件职责：通过真实 Perplexity API 冒烟验证搜索提供者能返回答案与来源。
 * 技术维度：使用 Vitest 条件跳过、环境变量配置和异步 HTTP 提供者调用。
 * 产品维度：在具备密钥的环境中确认联网搜索集成仍可实际使用。
 * 逻辑维度：读取密钥决定运行或跳过，创建提供者，发起查询并验证正文与来源 URL。
 * 关键边界：没有 PERPLEXITY_API_KEY 时自跳过；测试依赖外部网络并设置 30 秒上限。
 * 新手阅读建议：先看 apiKey 和 maybe 的跳过机制，再跟踪 provider 配置与 result 断言。
 */
import { describe, expect, it } from 'vitest'
import { PerplexitySearchProvider, PERPLEXITY_DEFAULT_BASE_URL, PERPLEXITY_DEFAULT_MAX_TOKENS, PERPLEXITY_DEFAULT_MODEL } from '@deepseek-ai/dsh-web-search-perplexity'

/**
 * Real-API smoke for the Perplexity search provider. Self-skips without
 * `$PERPLEXITY_API_KEY`, per the with-key e2e policy in docs/testing.md.
 */
/* 真实接口测试所需密钥；未配置时不应把环境问题报告为产品失败。 */
const apiKey = process.env.PERPLEXITY_API_KEY
// 条件测试套件函数；有非空密钥时运行 describe，否则使用 describe.skip。
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

// Perplexity 真实 API 套件；回调无参数，执行条件由 maybe 决定。
maybe('PerplexitySearchProvider real API', () => {
  // 发起一次真实查询并检查答案与来源；异步返回 Promise<void>，30 秒后超时。
  it('returns a generated answer and sources for a live query', async () => {
    // 搜索提供者实例；密钥必须存在，其他字段允许环境覆盖或采用包默认值。
    const provider = new PerplexitySearchProvider({
      apiKey: apiKey!,
      baseURL: process.env.PERPLEXITY_BASE_URL ?? PERPLEXITY_DEFAULT_BASE_URL,
      model: process.env.PERPLEXITY_MODEL ?? PERPLEXITY_DEFAULT_MODEL,
      maxTokens: PERPLEXITY_DEFAULT_MAX_TOKENS,
    })
    // 实时搜索结果；期望包含非空正文和至多请求数量的来源记录。
    const result = await provider.search({ query: 'What is DeepSeek Harness?', maxResults: 5 })
    expect(result.content ?? '').not.toBe('')
    // 逐个来源记录；source.url 必须是可识别的 HTTP 或 HTTPS 地址。
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
