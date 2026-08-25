/**
 * Load-time validation and routed-model policy resolution for compaction-basic.
 *
 * @module @deepseek-ai/dsh-compaction-basic/config
 */
/*
 * 文件职责：实现上下文压缩的 config 模块。
 * 技术维度：TypeScript、Cordis 插件、Worker/JSON 协议和严格类型。
 * 产品维度：为产品提供上下文压缩能力。
 * 逻辑维度：解析配置或协议，执行核心流程并返回结构化结果。
 * 关键边界：跨线程和模型输入属于不可信边界；资源与事件注册必须清理。
 * 新手阅读建议：先读导出类型与配置，再跟踪入口和错误分支。
 */

import { deepFreeze } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type {
  BasicCompactionConfig,
  CompactionPolicyConfig,
  ModelCompactPolicyConfig,
  ResolvedCompactSpec,
  ResolvedConfig,
  ResolvedRetention,
  ResolvedTargetPolicy,
} from './types.ts'

/** Default request-pressure fraction for every routed model. */
/* 中文说明：运行时局部值 DEFAULT_THRESHOLD_RATIO，由紧邻初始化决定。 */
const DEFAULT_THRESHOLD_RATIO = 0.8

/** Default verbatim-tail fraction for every routed model. */
/* 中文说明：运行时局部值 DEFAULT_RETAIN_RATIO，由紧邻初始化决定。 */
const DEFAULT_RETAIN_RATIO = 0.16

/** Fields shared by top-level defaults and exact-target overrides. */
/* 中文说明：运行时局部值 POLICY_CONFIG_KEYS，由紧邻初始化决定。 */
const POLICY_CONFIG_KEYS = [
  'thresholdRatio',
  'retainRatio',
  'retainTokens',
  'summarizationProvider',
  'summarizationModel',
  'maxTokens',
  'compactionRetries',
  'maxOverflowRetries',
] as const

/** Complete public top-level configuration key set. */
/* 中文说明：运行时局部值 BASIC_COMPACT_CONFIG_KEYS，由紧邻初始化决定。 */
const BASIC_COMPACT_CONFIG_KEYS: ReadonlySet<string> = new Set([
  ...POLICY_CONFIG_KEYS,
  'modelPolicies',
  'auto',
])

/** Complete exact-target override key set. */
/* 中文说明：运行时局部值 MODEL_POLICY_KEYS，由紧邻初始化决定。 */
const MODEL_POLICY_KEYS: ReadonlySet<string> = new Set([
  'provider',
  'model',
  ...POLICY_CONFIG_KEYS,
])

/** Target-specific pressure configuration failure eligible for warning suppression. */
/* 中文说明：类型或类 TargetPressureConfigError 约束协议数据或模块职责。 */
export class TargetPressureConfigError extends Error {
  /**
   * @param targetKey - exact provider/model route used as the warning key.
   * @param message - actionable configuration failure detail.
   */
  constructor(readonly targetKey: string, message: string) {
    super(message)
  }
}

/**
 * Resolve and validate service defaults plus exact-target partial overrides.
 * @param config - untrusted plugin configuration after Loader normalization.
 * @returns detached immutable defaults and validated exact-target overrides.
 */
/*
 * 中文说明：函数 resolveConfig 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param config 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function resolveConfig(config: BasicCompactionConfig = {}): ResolvedConfig {
  validateKeys(config, BASIC_COMPACT_CONFIG_KEYS, 'BasicCompactionConfig')
  validatePolicy(config, 'BasicCompactionConfig')
  if (config.auto !== undefined && typeof config.auto !== 'boolean') {
    throw new Error('BasicCompactionConfig: auto must be a boolean')
  }

  /** 中文说明：运行时局部值 thresholdRatio，由紧邻初始化决定。 */
  const thresholdRatio = config.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO
  /** 中文说明：运行时局部值 retention，由紧邻初始化决定。 */
  const retention = resolveRetention(config, { retainRatio: DEFAULT_RETAIN_RATIO })
  validateRatioRetention(thresholdRatio, retention, 'BasicCompactionConfig')
  /** 中文说明：运行时局部值 modelPolicies，由紧邻初始化决定。 */
  const modelPolicies = resolveModelPolicies(config.modelPolicies)
  /** 中文说明：运行时局部值 [index，由紧邻初始化决定。 */
  for (const [index, policy] of modelPolicies.entries()) {
    validateRatioRetention(
      policy.thresholdRatio ?? thresholdRatio,
      resolveRetention(policy, retention),
      `BasicCompactionConfig: modelPolicies[${index}]`,
    )
  }

  return deepFreeze({
    thresholdRatio,
    ...retention,
    summarizationProvider: config.summarizationProvider ?? '',
    summarizationModel: config.summarizationModel ?? '',
    maxTokens: config.maxTokens ?? 8192,
    compactionRetries: config.compactionRetries ?? 1,
    maxOverflowRetries: config.maxOverflowRetries ?? 1,
    modelPolicies,
    auto: config.auto ?? true,
  })
}

/**
 * Merge the exact provider/model override over the validated default policy.
 * @param config - validated service defaults and override table.
 * @param target - exact durable provider/model route to match.
 * @returns detached immutable policy before model-capacity scaling.
 */
/*
 * 中文说明：函数 resolveTargetPolicy 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param config 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param target 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function resolveTargetPolicy(
  config: ResolvedConfig,
  target: Pick<LlmCallConfig, 'provider' | 'model'>,
): ResolvedTargetPolicy {
  /** 中文说明：运行时局部值 override，由紧邻初始化决定。 */
  const override = config.modelPolicies.find(policy => (
    policy.provider === target.provider && policy.model === target.model
  ))
  /** 中文说明：运行时局部值 inheritedRetention，由紧邻初始化决定。 */
  const inheritedRetention: ResolvedRetention = config.retainTokens === undefined
    ? { retainRatio: config.retainRatio }
    : { retainTokens: config.retainTokens }
  return deepFreeze({
    target: { provider: target.provider, model: target.model },
    thresholdRatio: override?.thresholdRatio ?? config.thresholdRatio,
    ...resolveRetention(override ?? {}, inheritedRetention),
    summarizationProvider: override?.summarizationProvider ?? config.summarizationProvider,
    summarizationModel: override?.summarizationModel ?? config.summarizationModel,
    maxTokens: override?.maxTokens ?? config.maxTokens,
    compactionRetries: override?.compactionRetries ?? config.compactionRetries,
    maxOverflowRetries: override?.maxOverflowRetries ?? config.maxOverflowRetries,
  })
}

/**
 * Scale one routed policy into concrete token budgets for its model capacity.
 * @param policy - merged policy for the exact routed target.
 * @param contextWindow - positive adapter-owned capacity for that target.
 * @returns detached immutable pressure and retention budgets.
 */
/*
 * 中文说明：函数 resolveCompactSpec 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param policy 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param contextWindow 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function resolveCompactSpec(
  policy: ResolvedTargetPolicy,
  contextWindow: number,
): ResolvedCompactSpec {
  /** 中文说明：运行时局部值 targetKey，由紧邻初始化决定。 */
  const targetKey = `${policy.target.provider}/${policy.target.model}`
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
    throw new TargetPressureConfigError(
      targetKey,
      `BasicCompactionConfig: contextWindow (${contextWindow}) must be a positive integer`,
    )
  }
  /** 中文说明：运行时局部值 thresholdTokens，由紧邻初始化决定。 */
  const thresholdTokens = Math.floor(contextWindow * policy.thresholdRatio)
  /** 中文说明：运行时局部值 retainTokens，由紧邻初始化决定。 */
  const retainTokens = policy.retainTokens === undefined
    ? Math.floor(contextWindow * policy.retainRatio)
    : policy.retainTokens
  if (retainTokens >= thresholdTokens) {
    throw new TargetPressureConfigError(
      targetKey,
      `BasicCompactionConfig: ${policy.target.provider}/${policy.target.model} retainTokens `
      + `(${retainTokens}) must be less than threshold tokens ${thresholdTokens}`,
    )
  }
  return deepFreeze({
    target: { ...policy.target },
    contextWindow,
    thresholdRatio: policy.thresholdRatio,
    thresholdTokens,
    retainTokens,
    summarizationProvider: policy.summarizationProvider,
    summarizationModel: policy.summarizationModel,
    maxTokens: policy.maxTokens,
    compactionRetries: policy.compactionRetries,
    maxOverflowRetries: policy.maxOverflowRetries,
  })
}

/** Choose an explicit retention form or inherit the already-resolved fallback. */
/* 中文说明：函数 resolveRetention 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function resolveRetention(
  config: CompactionPolicyConfig,
  fallback: ResolvedRetention,
): ResolvedRetention {
  if (config.retainTokens !== undefined) return { retainTokens: config.retainTokens }
  if (config.retainRatio !== undefined) return { retainRatio: config.retainRatio }
  return fallback
}

/** Reject a capacity-independent retention conflict at plugin load. */
/* 中文说明：函数 validateRatioRetention 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateRatioRetention(
  thresholdRatio: number,
  retention: ResolvedRetention,
  name: string,
): void {
  if (retention.retainRatio !== undefined && retention.retainRatio >= thresholdRatio) {
    throw new Error(
      `${name}: retainRatio (${retention.retainRatio}) must be less than `
      + `the resolved thresholdRatio (${thresholdRatio})`,
    )
  }
}

/** Validate, detach, and reject duplicate exact-target policies. */
/* 中文说明：函数 resolveModelPolicies 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function resolveModelPolicies(configured: unknown): ModelCompactPolicyConfig[] {
  if (configured === undefined) return []
  if (!Array.isArray(configured)) {
    throw new Error('BasicCompactionConfig: modelPolicies must be an array')
  }
  /** 中文说明：运行时局部值 seen，由紧邻初始化决定。 */
  const seen = new Set<string>()
  return configured.map((source: unknown, index) => {
    /** 中文说明：运行时局部值 name，由紧邻初始化决定。 */
    const name = `BasicCompactionConfig: modelPolicies[${index}]`
    assertModelPolicy(source, name)
    /** 中文说明：运行时局部值 key，由紧邻初始化决定。 */
    const key = `${source.provider}\u0000${source.model}`
    if (seen.has(key)) {
      throw new Error(
        `BasicCompactionConfig: duplicate model policy for ${source.provider}/${source.model}`,
      )
    }
    seen.add(key)
    return { ...source }
  })
}

/** Validate one untrusted exact-target override and narrow its public type. */
/* 中文说明：函数 assertModelPolicy 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertModelPolicy(
  source: unknown,
  name: string,
): asserts source is ModelCompactPolicyConfig {
  if (!isUnknownRecord(source)) throw new Error(`${name} must be an object`)
  validateKeys(source, MODEL_POLICY_KEYS, name)
  assertNonEmptyString(`${name}.provider`, source.provider)
  assertNonEmptyString(`${name}.model`, source.model)
  validatePolicy(source, name)
}

/** Validate the fields common to defaults and exact-target partial overrides. */
/* 中文说明：函数 validatePolicy 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validatePolicy(
  config: CompactionPolicyConfig | Record<string, unknown>,
  name: string,
): void {
  /** 中文说明：运行时局部值 thresholdRatio，由紧邻初始化决定。 */
  const thresholdRatio = config.thresholdRatio
  /** 中文说明：运行时局部值 retainRatio，由紧邻初始化决定。 */
  const retainRatio = config.retainRatio
  /** 中文说明：运行时局部值 retainTokens，由紧邻初始化决定。 */
  const retainTokens = config.retainTokens
  /** 中文说明：运行时局部值 maxTokens，由紧邻初始化决定。 */
  const maxTokens = config.maxTokens
  /** 中文说明：运行时局部值 compactionRetries，由紧邻初始化决定。 */
  const compactionRetries = config.compactionRetries
  /** 中文说明：运行时局部值 maxOverflowRetries，由紧邻初始化决定。 */
  const maxOverflowRetries = config.maxOverflowRetries
  if (thresholdRatio !== undefined) assertRatio(`${name}.thresholdRatio`, thresholdRatio)
  if (retainRatio !== undefined) assertRatio(`${name}.retainRatio`, retainRatio)
  if (retainTokens !== undefined) assertNonNegativeInteger(`${name}.retainTokens`, retainTokens)
  if (retainRatio !== undefined && retainTokens !== undefined) {
    throw new Error(`${name}: retainRatio and retainTokens are mutually exclusive`)
  }
  if (maxTokens !== undefined) assertPositiveInteger(`${name}.maxTokens`, maxTokens)
  if (compactionRetries !== undefined) {
    assertNonNegativeInteger(`${name}.compactionRetries`, compactionRetries)
  }
  if (maxOverflowRetries !== undefined) {
    assertNonNegativeInteger(`${name}.maxOverflowRetries`, maxOverflowRetries)
  }

  validateSummarizationPair(config, name)
}

/** Require one scope to omit, clear, or replace the summarization target as a pair. */
/* 中文说明：函数 validateSummarizationPair 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateSummarizationPair(
  config: CompactionPolicyConfig | Record<string, unknown>,
  name: string,
): void {
  /** 中文说明：运行时局部值 provider，由紧邻初始化决定。 */
  const provider = config.summarizationProvider
  /** 中文说明：运行时局部值 model，由紧邻初始化决定。 */
  const model = config.summarizationModel
  if (provider !== undefined && typeof provider !== 'string') {
    throw new Error(`${name}.summarizationProvider must be a string`)
  }
  if (model !== undefined && typeof model !== 'string') {
    throw new Error(`${name}.summarizationModel must be a string`)
  }
  if (provider === undefined && model === undefined) return
  if (provider === undefined || model === undefined
    || (provider.length === 0) !== (model.length === 0)) {
    throw new Error(
      `${name}: summarizationProvider and summarizationModel must be set together `
      + 'as an empty or non-empty pair',
    )
  }
}

/** Reject stale or misspelled keys before defaults can hide them. */
/* 中文说明：函数 validateKeys 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateKeys(config: object, keys: ReadonlySet<string>, name: string): void {
  /** 中文说明：运行时局部值 key，由紧邻初始化决定。 */
  for (const key of Object.keys(config)) {
    if (!keys.has(key)) throw new Error(`${name}: unknown key "${key}"`)
  }
}

/** 中文说明：函数 isUnknownRecord 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 中文说明：函数 assertNonEmptyString 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertNonEmptyString(name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
}

/** 中文说明：函数 assertPositiveInteger 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertPositiveInteger(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} (${String(value)}) must be a positive integer`)
  }
}

/** 中文说明：函数 assertNonNegativeInteger 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertNonNegativeInteger(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} (${String(value)}) must be a non-negative integer`)
  }
}

/** 中文说明：函数 assertRatio 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assertRatio(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} (${String(value)}) must be a number in (0, 1]`)
  }
}
