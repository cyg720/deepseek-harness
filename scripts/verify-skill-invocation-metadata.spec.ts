import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectSkillInvocationMetadataViolations } from './verify-skill-invocation-metadata.ts'

/** 本轮测试创建且等待清理的临时根目录列表。 */
const roots: string[] = []

/** 中文：每个用例后删除并清空所有已登记临时目录。 */
afterEach(() => {
  /** 当前从 roots 取出的待删除临时根目录。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文：创建并登记一个临时夹具根目录；无参数，返回绝对路径。 */
function fixtureRoot(): string {
  /** 当前用例新建的唯一临时目录。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-skill-invocation-metadata-'))
  roots.push(root)
  return root
}

/** 中文：在 root 写入名为 name 的技能；frontmatter 和 policy 分别注入两端元数据，无返回值。 */
function writeSkill(root: string, name: string, frontmatter: string, policy = ''): void {
  /** 当前技能的 .agents/skills 子目录。 */
  const directory = join(root, '.agents/skills', name)
  mkdirSync(join(directory, 'agents'), { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n${frontmatter}---\n\nTest.\n`)
  writeFileSync(
    join(directory, 'agents/openai.yaml'),
    `interface:\n  display_name: "Test"\n${policy}`,
  )
}

/** 中文：跨产品技能调用元数据门禁测试组。 */
describe('cross-product skill invocation metadata gate', () => {
  /** 中文：默认可自动调用和一致的手动技能都不应产生违规；无参数和返回值。 */
  it('accepts aligned default and manual-only policies', () => {
    /** 当前用例的临时仓库根目录。 */
    const root = fixtureRoot()
    writeSkill(root, 'default-skill', '')
    writeSkill(
      root,
      'manual-skill',
      'disable-model-invocation: true\nuser-invocable: true\n',
      'policy:\n  allow_implicit_invocation: false\n',
    )

    expect(collectSkillInvocationMetadataViolations(root)).toEqual([])
  })

  /** 中文：两端任一方向不一致都应产生精确诊断；无参数和返回值。 */
  it('rejects either direction of a manual-only policy mismatch', () => {
    /** 当前用例的临时仓库根目录。 */
    const root = fixtureRoot()
    writeSkill(root, 'claude-only', 'disable-model-invocation: true\n')
    writeSkill(root, 'codex-only', '', 'policy:\n  allow_implicit_invocation: false\n')

    expect(collectSkillInvocationMetadataViolations(root)).toEqual([
      '.agents/skills/claude-only: Claude Code manual-only=true but Codex manual-only=false',
      '.agents/skills/codex-only: Claude Code manual-only=false but Codex manual-only=true',
    ])
  })
})
/**
 * 中文说明：
 * - 文件职责：验证 Claude Code 与 Codex 的技能调用元数据门禁能接受一致配置并报告双向不一致。
 * - 技术维度：使用 Vitest、临时目录、同步文件系统 API 和最小 SKILL.md/YAML 夹具。
 * - 产品维度：保证同一技能在不同代理宿主中的自动或手动调用策略一致，避免意外触发。
 * - 逻辑维度：创建临时技能树，写入两套元数据，每个用例后删除，再比较违规消息列表。
 * - 关键边界：夹具只覆盖调用策略字段；临时目录必须登记到 roots 才能自动清理。
 * - 新手阅读建议：先看 writeSkill 生成的两个文件，再对比 aligned 与 mismatch 两组输入输出。
 */
