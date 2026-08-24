/**
 * 文件职责：保留 DeepSeek 原生 web_search 真实接口探针，验证可引用来源线协议。
 * 技术维度：使用 Vitest 条件套件、显式跳过用例、环境配置和真实搜索提供者。
 * 产品维度：供人工或专项诊断确认搜索端点能返回来源，但不作为不稳定的合并门禁。
 * 逻辑维度：构造固定选项 provider，按密钥选择套件，显式跳过的用例发起查询并检查来源 URL。
 * 关键边界：用例始终 it.skip；真实端点可能无结构化来源，所以不能用作可靠 CI 信号。
 * 新手阅读建议：先看 searchProvider，再理解 apiKey/maybe 与 it.skip 的两层禁用，最后看 provider 配置。
 */
import { describe, expect, it } from 'vitest'
import {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
} from '@deepseek-ai/dsh-web-search-deepseek'

/** Construct the provider over a fixed options value; production passes a live thunk. */
/** 用固定选项构造测试提供者；生产代码传入实时读取选项的 thunk。 */
import type { DeepSeekSearchProviderOptions } from '@deepseek-ai/dsh-web-search-deepseek'

// 固定选项提供者工厂；options 是完整搜索配置，返回新的 DeepSeekSearchProvider。
const searchProvider = (options: DeepSeekSearchProviderOptions): DeepSeekSearchProvider =>
  new DeepSeekSearchProvider(() => options)

/**
 * Disabled real-API probe for the DeepSeek search provider. The live endpoint
 * can complete without structured source blocks, so this is not a reliable
 * merge signal. Its body remains because mocks cannot confirm the wire shape.
 */
/** 当前环境 API 密钥；只决定套件是否有资格运行，不会解除 it.skip。 */
const apiKey = process.env.DEEPSEEK_API_KEY
// 有非空密钥时使用 describe，否则整个套件标记跳过。
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

// DeepSeek 搜索真实接口套件。
maybe('DeepSeekSearchProvider real API', () => {
  // 显式禁用的不稳定探针；人工启用时检查来源可引用。
  it.skip('returns citeable sources for a live query via native web_search', async () => {
    // 真实搜索提供者，环境可覆盖端点和模型，其他值采用包默认常量。
    const provider = searchProvider({
      apiKey: apiKey!,
      baseURL: process.env.DEEPSEEK_SEARCH_BASE_URL ?? DEEPSEEK_DEFAULT_BASE_URL,
      model: process.env.DEEPSEEK_SEARCH_MODEL ?? DEEPSEEK_DEFAULT_MODEL,
      apiVersion: DEEPSEEK_DEFAULT_API_VERSION,
      maxTokens: DEEPSEEK_DEFAULT_MAX_TOKENS,
      maxUses: DEEPSEEK_DEFAULT_MAX_USES,
    })
    // 真实查询结果。
    const result = await provider.search({ query: 'What is DeepSeek Harness?', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    // 当前来源；URL 必须使用 HTTP(S)。
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 60_000)
})
