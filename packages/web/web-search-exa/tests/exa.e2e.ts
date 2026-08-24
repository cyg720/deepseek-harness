/**
 * 文件职责：使用真实 Exa API 对搜索提供者执行带密钥自跳过的端到端冒烟测试。
 * 技术维度：使用 Vitest 条件测试组、环境变量和真实 ExaSearchProvider 网络请求。
 * 产品维度：验证部署凭据与供应商接口能返回可供用户打开的搜索来源。
 * 逻辑维度：读取密钥决定运行或跳过，构建默认配置提供者，发起查询并验证来源 URL。
 * 关键边界：没有 EXA_API_KEY 时自跳过；测试依赖外网和真实配额，超时为 30 秒。
 * 新手阅读建议：先看 maybe 如何选择 describe，再看 provider 配置和最终 URL 循环断言。
 */
import { describe, expect, it } from 'vitest'
import { ExaSearchProvider, EXA_DEFAULT_BASE_URL, EXA_DEFAULT_HIGHLIGHTS_PER_RESULT, EXA_DEFAULT_SEARCH_TYPE } from '@deepseek-ai/dsh-web-search-exa'

/**
 * Real-API smoke for the Exa search provider. Self-skips without `$EXA_API_KEY`
 * (CI has no secrets), per the with-key e2e policy in docs/testing.md.
 */
/** 真实 API 冒烟测试；按测试策略在缺少 EXA_API_KEY 的 CI 中自动跳过。 */
// apiKey：可选 Exa API 密钥；只有非空时才执行真实网络测试。
const apiKey = process.env.EXA_API_KEY
// maybe：有密钥时为 describe，否则为 describe.skip。
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

// 条件测试组：只在可用密钥环境中访问 Exa。
maybe('ExaSearchProvider real API', () => {
  /** 功能描述：确认真实查询返回至少一个 HTTP(S) 来源；参数：无；返回：异步完成；示例：搜索 DeepSeek Harness。 */
  it('returns sources for a live query', async () => {
    // provider：使用密钥、可选基础 URL 和仓库默认搜索参数的真实 Exa 提供者。
    const provider = new ExaSearchProvider({
      apiKey: apiKey!,
      baseURL: process.env.EXA_BASE_URL ?? EXA_DEFAULT_BASE_URL,
      searchType: EXA_DEFAULT_SEARCH_TYPE,
      highlightsPerResult: EXA_DEFAULT_HIGHLIGHTS_PER_RESULT,
    })
    // result：最多五条 DeepSeek Harness 搜索结果。
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    // source：当前返回来源，每个 URL 都必须使用 HTTP 或 HTTPS。
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
