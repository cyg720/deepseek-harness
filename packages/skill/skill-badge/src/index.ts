/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是 dsh-skill-badge 包：把仓库内置的 dsh-badge 技能（一个 Markdown 徽章
 *             文件）作为一份"打包技能"注册进 ctx.skills 注册表。
 * 【技术维度】实现 SkillProvider 接口的只读提供者：list() 返回唯一候选，get() 读取资源文件
 *             内容返回完整技能定义；使用 import.meta.url 定位同包资源。
 * 【产品维度】用户创建 PR/MR 或文档时，模型可通过 skill 工具加载徽章技能，产出官方
 *             "powered by dsh" 徽章，保证对外输出带品牌归属。
 * 【逻辑维度】常量定义（名称/资源/描述/候选）→ 构造 provider 对象 → 导出插件三要素 →
 *             apply() 里注册。
 * 【关键边界】技能正文只在 get() 时才读文件，list() 只返回元数据；rank 使用打包技能的标准
 *             优先级 BUNDLED_SKILL_RANK，避免覆盖用户自定义技能。
 * 【新手阅读建议】这是"单技能静态提供者"的最小完整示例，可对照 dsh-skill 的 SkillProvider
 *             接口阅读。
 * ==========================================================================
 */
/**
 * Bundled `dsh-badge` skill provider.
 *
 * @module @deepseek-ai/dsh-skill-badge
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

// 提供者名：注册进 ctx.skills 时使用的唯一标识。
const PROVIDER_NAME = 'dsh-badge'
// 技能正文文件的 URL（指向本包 assets 目录下的 dsh-badge.md）。
const SKILL_BODY_URL = new URL('../assets/dsh-badge.md', import.meta.url)
// 资源基准目录：技能正文中出现的相对路径都相对它解析。
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
// 调用策略：模型与用户两种入口都开放。
const INVOCATION = { modelInvocable: true, userInvocable: true } as const
// 技能描述：模型据此判断何时应加载该技能。
const DESCRIPTION = 'Add the official “powered by dsh” badge to documents, pull requests, merge requests, and other content produced with DeepSeek Harness. Use whenever creating a pull request or merge request. Also use when the user asks for a dsh badge, powered-by-dsh attribution, or a reusable dsh badge asset or snippet.'
// 唯一候选：list() 返回的静态元数据，get() 再据此加载正文。
const CANDIDATE: SkillCandidate = {
  name: 'dsh-badge',
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

// 只读提供者：候选固定一份，正文在 get() 时才从磁盘读取。
const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/** Cordis plugin name. */
// 插件名，供加载器日志与诊断使用。
export const name = 'skill-badge'
/** Service required by the bundled provider. */
// 声明依赖：需要 skills 服务（注册表）就绪。
export const inject = ['skills']

/** Register the bundled `dsh-badge` provider on `ctx.skills`. */
// 插件入口 apply：把只读提供者注册进 ctx.skills 注册表。
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
