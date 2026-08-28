/**
 * `@earendil-works/pi-ai` stub, including its `/providers/all` and `/api/*.lazy`
 * subpaths. The package is Node-only (no `require`/`browser` conditions, Node
 * builtins plus five cloud SDKs in its transport layer) and `llm-pi-ai` imports it
 * statically at module scope, so the row cannot mount without it.
 *
 * Every symbol `llm-pi-ai` imports by name is present: a missing CommonJS symbol
 * would surface as `undefined` at call time instead of a link error. The three catalog readers
 * return empty collections rather than throwing — the row reads them while it
 * activates, and "this deployment ships no pi-ai provider" is the truth here.
 * Everything on a request path is loud.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 pi ai 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { notImplementedFail } from '../notImplementedFail.ts'

/**
 * 常量说明：MODULE 用于处理 MODULE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODULE = '@earendil-works/pi-ai'

/** Provider factory (unavailable).
 * @remarks 中文说明：常量说明：createProvider 用于创建 Provider 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const createProvider = notImplementedFail(MODULE, 'createProvider')

/** Model-list factory (unavailable).
 * @remarks 中文说明：常量说明：createModels 用于创建 Models 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const createModels = notImplementedFail(MODULE, 'createModels')

/** Thinking-level catalog (unavailable).
 * @remarks 中文说明：常量说明：getSupportedThinkingLevels 用于获取 Supported Thinking
 * Levels 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const getSupportedThinkingLevels = notImplementedFail(MODULE, 'getSupportedThinkingLevels')

/** Context-overflow predicate (unavailable).
 * @remarks 中文说明：常量说明：isContextOverflow 用于判断是否为 Context Overflow 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const isContextOverflow = notImplementedFail(MODULE, 'isContextOverflow')

/** Builtin provider ids of pi-ai 0.84.2, in catalog order.
 * @remarks 中文说明：常量说明：BUILTIN_PROVIDER_IDS 用于处理 BUILTIN_PROVIDER_IDS 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const BUILTIN_PROVIDER_IDS: readonly string[] = [
  'amazon-bedrock', 'ant-ling', 'anthropic', 'azure-openai-responses', 'baseten', 'cerebras',
  'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'deepseek', 'fireworks', 'github-copilot',
  'google', 'google-vertex', 'groq', 'huggingface', 'kimi-coding', 'minimax', 'minimax-cn',
  'mistral', 'moonshotai', 'moonshotai-cn', 'nvidia', 'openai', 'openai-codex', 'opencode',
  'opencode-go', 'openrouter', 'qwen-token-plan', 'qwen-token-plan-cn',
  'qwen-token-plan-individual', 'together',
  'vercel-ai-gateway', 'xai', 'xiaomi', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp', 'zai', 'zai-coding-cn',
]

/**
 * Installed catalog providers, read while `llm-pi-ai` activates. Each carries the
 * api-key auth marker the adapter filters on, and no models: the provider
 * directory therefore matches the served deployment while every request path
 * lands on a loud symbol above.
 * @returns one entry per builtin provider.
 * @remarks 中文说明：功能说明：处理 builtinProviders 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：unknown[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * builtinProviders()，并按返回类型处理结果。
 */
export function builtinProviders(): unknown[] {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
   * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
   */
  return BUILTIN_PROVIDER_IDS.map(id => ({
    id,
    name: id,
    auth: { apiKey: { type: 'api-key' } },
    models: [],
  }))
}

/**
 * Provider route ids of the installed catalog. `llm-pi-ai` registers the whole
 * catalog as configurable the moment it mounts and rejects an empty
 * registration, so these are pi-ai's real ids rather than an empty list.
 * @returns the builtin provider ids.
 * @remarks 中文说明：功能说明：获取 Builtin Providers 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：string[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * getBuiltinProviders()，并按返回类型处理结果。
 */
export function getBuiltinProviders(): string[] {
  return [...BUILTIN_PROVIDER_IDS]
}

/**
 * Models of one installed catalog provider.
 * @returns no models.
 * @remarks 中文说明：功能说明：获取 Builtin Models 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：unknown[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * getBuiltinModels()，并按返回类型处理结果。
 */
export function getBuiltinModels(): unknown[] {
  return []
}

/** Anthropic messages API binding (unavailable).
 * @remarks 中文说明：常量说明：anthropicMessagesApi 用于处理 anthropicMessagesApi 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const anthropicMessagesApi = notImplementedFail(MODULE, 'anthropicMessagesApi')

/** OpenAI completions API binding (unavailable).
 * @remarks 中文说明：常量说明：openAICompletionsApi 用于打开 AICompletions Api 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const openAICompletionsApi = notImplementedFail(MODULE, 'openAICompletionsApi')

/** OpenAI responses API binding (unavailable).
 * @remarks 中文说明：常量说明：openAIResponsesApi 用于打开 AIResponses Api 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const openAIResponsesApi = notImplementedFail(MODULE, 'openAIResponsesApi')

/** CommonJS interop marker: the worker loader hands `default` to default imports.
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  createProvider, createModels, getSupportedThinkingLevels, isContextOverflow, builtinProviders,
  getBuiltinModels, getBuiltinProviders, anthropicMessagesApi, openAICompletionsApi,
  openAIResponsesApi,
}
