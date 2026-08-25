/**
 * Keep Claude Code and Codex invocation metadata aligned for repository skills.
 * @module scripts/verify-skill-invocation-metadata
 */
/**
 * 文件职责：实现 verify-skill-invocation-metadata.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'

/** 中文说明：常量 ROOT 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ROOT = resolve(import.meta.dirname, '..')

/** Return an object-shaped YAML value, or undefined for every other shape. */
/** 中文说明：函数 asRecord 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Parse a skill's YAML frontmatter as an object. */
/** 中文说明：函数 parseSkillFrontmatter 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parseSkillFrontmatter(source: string): Record<string, unknown> {
  /** 中文说明：变量 lines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = source.split('\n')
  if (lines[0] !== '---') throw new Error('SKILL.md must start with YAML frontmatter')
  /** 中文说明：变量 end 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const end = lines.indexOf('---', 1)
  if (end < 0) throw new Error('SKILL.md frontmatter is not closed')
  /** 中文说明：变量 metadata 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const metadata = asRecord(load(lines.slice(1, end).join('\n')))
  if (metadata === undefined) throw new Error('SKILL.md frontmatter must be a YAML object')
  return metadata
}

/** Find repository skill directories that carry Codex product metadata. */
/** 中文说明：函数 skillDirectories 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function skillDirectories(root: string): string[] {
  /** 中文说明：变量 skillsRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const skillsRoot = resolve(root, '.agents/skills')
  if (!existsSync(skillsRoot)) return []
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(resolve(skillsRoot, entry.name, 'agents/openai.yaml')))
    .map(entry => entry.name)
    .sort()
}

/**
 * Report cross-product invocation-policy mismatches for repository skills.
 * @param root - Repository root containing `.agents/skills`.
 * @returns diagnostics for malformed metadata or policies that expose a skill differently.
 */
/** 中文说明：函数 collectSkillInvocationMetadataViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectSkillInvocationMetadataViolations(root: string): string[] {
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []

  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const skill of skillDirectories(root)) {
    /** 中文说明：变量 relativeRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const relativeRoot = `.agents/skills/${skill}`
    /** 中文说明：变量 skillFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const skillFile = resolve(root, relativeRoot, 'SKILL.md')
    /** 中文说明：变量 openaiFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const openaiFile = resolve(root, relativeRoot, 'agents/openai.yaml')
    if (!existsSync(skillFile)) {
      violations.push(`${relativeRoot}: agents/openai.yaml has no sibling SKILL.md`)
      continue
    }

    /** 中文说明：变量 frontmatter 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let frontmatter: Record<string, unknown>
    /** 中文说明：变量 openai 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let openai: Record<string, unknown>
    try {
      frontmatter = parseSkillFrontmatter(readFileSync(skillFile, 'utf8'))
    }
    catch (error) {
      violations.push(`${relativeRoot}/SKILL.md: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    try {
      /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const parsed = asRecord(load(readFileSync(openaiFile, 'utf8')))
      if (parsed === undefined) throw new Error('agents/openai.yaml must be a YAML object')
      openai = parsed
    }
    catch (error) {
      violations.push(`${relativeRoot}/agents/openai.yaml: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    /** 中文说明：变量 disableModelInvocation 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disableModelInvocation = frontmatter['disable-model-invocation']
    if (disableModelInvocation !== undefined && typeof disableModelInvocation !== 'boolean') {
      violations.push(`${relativeRoot}/SKILL.md: disable-model-invocation must be a boolean`)
      continue
    }
    /** 中文说明：变量 userInvocable 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const userInvocable = frontmatter['user-invocable']
    if (userInvocable !== undefined && typeof userInvocable !== 'boolean') {
      violations.push(`${relativeRoot}/SKILL.md: user-invocable must be a boolean`)
      continue
    }

    /** 中文说明：变量 policy 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const policy = asRecord(openai.policy)
    /** 中文说明：变量 allowImplicitInvocation 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const allowImplicitInvocation = policy?.allow_implicit_invocation
    if (allowImplicitInvocation !== undefined && typeof allowImplicitInvocation !== 'boolean') {
      violations.push(`${relativeRoot}/agents/openai.yaml: policy.allow_implicit_invocation must be a boolean`)
      continue
    }

    /** 中文说明：变量 claudeManualOnly 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const claudeManualOnly = disableModelInvocation === true
    /** 中文说明：变量 codexManualOnly 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const codexManualOnly = allowImplicitInvocation === false
    if (claudeManualOnly !== codexManualOnly) {
      violations.push(
        `${relativeRoot}: Claude Code manual-only=${String(claudeManualOnly)}`
        + ` but Codex manual-only=${String(codexManualOnly)}`,
      )
    }
    if (claudeManualOnly && userInvocable === false) {
      violations.push(`${relativeRoot}/SKILL.md: a manual-only skill must remain user-invocable`)
    }
  }

  return violations
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  /** 中文说明：变量 skills 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const skills = skillDirectories(ROOT)
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations = collectSkillInvocationMetadataViolations(ROOT)
  if (violations.length > 0) {
    process.stderr.write('verify-skill-invocation-metadata: violations found:\n')
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const violation of violations) process.stderr.write(`  ${violation}\n`)
    process.exit(1)
  }

  process.stdout.write(
    `verify-skill-invocation-metadata: ${String(skills.length)} cross-product skill policy pair(s) aligned.\n`,
  )
}
