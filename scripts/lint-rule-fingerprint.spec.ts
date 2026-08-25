/**
 * 文件职责：验证 lint-rule-fingerprint.spec.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from 'typescript'
import { describe, expect, it } from 'vitest'

/** 中文说明：type Rules 定义本测试所需的数据或行为，用于表达仓库脚本场景。 */
type Rules = Record<string, unknown>

/** 中文说明：interface Profile 定义本测试所需的数据或行为，用于表达仓库脚本场景。 */
interface Profile {
  readonly count: number
  readonly indexes: readonly number[]
  readonly sha256: string
}

// A one-time audit against eslint.config.mjs blob 696b08282885296830189fdafe7051a356806fc2
// mapped @typescript-eslint/* to typescript/* and four extension rules to their
// Oxlint core equivalents. These fingerprints pin the resulting repository
// snapshot; they do not re-evaluate that deleted baseline or track its preset.
/** 中文说明：变量 profiles 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const profiles = {
  source: {
    count: 88,
    indexes: [0, 1, 4, 5],
    sha256: 'da1dfd77cb6eb66be93d8d3820f9b9b68b7aa391c24680f8851c0910298f9e3b',
  },
  example: {
    count: 87,
    indexes: [0, 1, 2, 4, 5],
    sha256: '6a2606053bc1ec1de3b02611de88ea51d201dac13a1f193e4934d33c08b95f08',
  },
  test: {
    count: 83,
    indexes: [0, 3, 4, 5],
    sha256: '7995e14926a36c40bd65c474637735222a95fb030395681685f03060e50a7b78',
  },
} as const satisfies Record<string, Profile>

/** 中文说明：函数 isRecord 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 中文说明：函数 isUnknownArray 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/** 中文说明：函数 severity 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function severity(value: unknown): 0 | 1 | 2 {
  /** 中文说明：变量 level 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const level = isUnknownArray(value) ? value[0] : value
  if (level === 'off' || level === 0) return 0
  if (level === 'warn' || level === 'warning' || level === 1) return 1
  if (level === 'error' || level === 2) return 2
  throw new Error(`unsupported lint severity: ${JSON.stringify(level)}`)
}

/** 中文说明：函数 normalizedRules 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function normalizedRules(rules: Rules): Rules {
  return Object.fromEntries(Object.entries(rules)
    .filter(([, value]) => severity(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => {
      /** 中文说明：变量 options 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const options = isUnknownArray(value) ? value.slice(1) : []
      return [name, [severity(value), ...options]]
    }))
}

/** 中文说明：函数 mergedRules 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function mergedRules(overrides: readonly unknown[], indexes: readonly number[]): Rules {
  /** 中文说明：变量 merged 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const merged: Rules = {}
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const index of indexes) {
    /** 中文说明：变量 override 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const override = overrides[index]
    if (!isRecord(override) || !isRecord(override.rules)) {
      throw new Error(`.oxlintrc.json override ${index} must contain a rules object`)
    }
    Object.assign(merged, override.rules)
  }
  return normalizedRules(merged)
}

describe('Oxlint repository rule fingerprint', () => {
  /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const path = fileURLToPath(new URL('../.oxlintrc.json', import.meta.url))
  /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = parseConfigFileTextToJson(path, readFileSync(path, 'utf8'))
  if (result.error !== undefined) {
    throw new Error(flattenDiagnosticMessageText(result.error.messageText, '\n'))
  }
  /** 中文说明：变量 parsed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed: unknown = result.config
  if (!isRecord(parsed) || !Array.isArray(parsed.overrides)) {
    throw new Error('.oxlintrc.json must contain an overrides array')
  }
  /** 中文说明：变量 overrides 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const overrides: readonly unknown[] = parsed.overrides

  it('pins every override field', () => {
    expect(overrides).toHaveLength(8)
  })

  it.each(Object.entries(profiles))('pins the %s rule profile', (_name, profile) => {
    /** 中文说明：变量 rules 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rules = mergedRules(overrides, profile.indexes)
    /** 中文说明：变量 fingerprint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fingerprint = createHash('sha256').update(JSON.stringify(rules)).digest('hex')

    expect(Object.keys(rules)).toHaveLength(profile.count)
    expect(fingerprint).toBe(profile.sha256)
  })
})
