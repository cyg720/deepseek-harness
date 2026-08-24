import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillBadge from '@deepseek-ai/dsh-skill-badge'

/** 中文：技能徽章包的注册、加载和资源完整性测试组。 */
describe('dsh-skill-badge', () => {
  /** 中文：装载并释放徽章技能，检查元数据与正文；无参数和返回值。 */
  it('registers and disposes the bundled badge skill', async () => {
    /** 本用例的 Cordis 上下文。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 徽章插件生命周期句柄，用于验证 dispose 会撤销注册。 */
    const fiber = await ctx.plugin(SkillBadge)
    /** assets 目录的本地绝对路径。 */
    const resourcePath = fileURLToPath(new URL('../assets/', import.meta.url))

    expect(await ctx.skills.list()).toEqual([{
      name: 'dsh-badge',
      description: 'Add the official “powered by dsh” badge to documents, pull requests, merge requests, and other content produced with DeepSeek Harness. Use whenever creating a pull request or merge request. Also use when the user asks for a dsh badge, powered-by-dsh attribution, or a reusable dsh badge asset or snippet.',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dsh-badge',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: resourcePath },
    }])
    /** 按技能名取得的已解析技能。 */
    const loaded = await ctx.skills.get('dsh-badge')
    expect(loaded?.content).toContain('Preserve the badge\'s 121×20 dimensions')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: resourcePath })

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  /** 中文：校验官方 PNG 的宽高和 SHA-256；无参数和返回值。 */
  it('ships the official 726×120 PNG unchanged', async () => {
    /** 官方徽章 PNG 的完整字节内容。 */
    const image = await readFile(new URL('../assets/dsh-badge.png', import.meta.url))
    expect(image.readUInt32BE(16)).toBe(726)
    expect(image.readUInt32BE(20)).toBe(120)
    expect(createHash('sha256').update(image).digest('hex')).toBe(
      'f2c4f5ec9cbe847c0c763545c4d839efa8485bc74203733d0a0e8259f233c653',
    )
  })
})
/**
 * 中文说明：
 * - 文件职责：验证内置 dsh 徽章技能的注册生命周期、资源路径、说明内容和官方 PNG 完整性。
 * - 技术维度：使用 Vitest、Cordis 插件、Node 文件读取、URL 转路径和 SHA-256 哈希。
 * - 产品维度：确保代理生成文档或 PR 时能稳定提供官方“powered by dsh”徽章资源。
 * - 逻辑维度：第一组用例验证技能装载与释放，第二组读取图片并校验尺寸和内容摘要。
 * - 关键边界：哈希和尺寸是冻结资产约束；资源有意变化时必须同步更新断言。
 * - 新手阅读建议：先观察 ctx.skills.list/get 的技能模型，再看图片字节偏移和哈希如何防止误改。
 */
