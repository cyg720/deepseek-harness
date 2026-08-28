/**
 * 文件职责：验证 Web 回放脚手架的技能发现不会读取宿主机器上的环境技能目录。
 * 技术维度：使用 Vitest、临时目录、环境变量隔离、真实 Cordis 组合和智能体预设。
 * 产品维度：保证测试结果不受开发者个人技能安装影响，避免机器间出现隐蔽差异。
 * 逻辑维度：创建三组诱饵技能，临时指向环境变量，启动脚手架并创建智能体，确认诱饵均不可见。
 * 关键边界：环境变量必须在 finally 中恢复；智能体和脚手架必须释放；只检查组合后智能体作用域。
 * 新手阅读建议：先读 writeSkill 如何创建诱饵，再跟踪环境变量替换，最后看 scoped skills.list 断言。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-skill'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

/** 在 root 下创建名为 name 的最小技能，无返回值。示例：await writeSkill(dir, 'ambient-dsh')。 */
async function writeSkill(root: string, name: string): Promise<void> {
  /** 当前诱饵技能包的目录路径。 */
  const bundle = join(root, name)
  await mkdir(bundle, { recursive: true })
  await writeFile(join(bundle, 'SKILL.md'), `---
name: ${name}
description: Must not enter the Web replay scaffold
---

Ambient host state.
`)
}

it('isolates replay skill discovery from every ambient host root', async () => {
  /** 容纳全部宿主诱饵技能根的临时目录。 */
  const ambient = await mkdtemp(join(tmpdir(), 'dsh-web-ambient-skills-'))
  /** 模拟用户 DSH_HOME 的目录。 */
  const dshHome = join(ambient, 'dsh-home')
  /** 模拟代理兼容技能根的目录。 */
  const agentsHome = join(ambient, 'agents-home')
  /** 模拟内置技能根的目录。 */
  const bundled = join(ambient, 'bundled')
  await Promise.all([
    writeSkill(join(dshHome, 'skills'), 'ambient-dsh'),
    writeSkill(join(agentsHome, 'skills'), 'ambient-agents'),
    writeSkill(bundled, 'ambient-bundled'),
  ])

  /** 测试前的 DSH_HOME 值，用于恢复。 */
  const originalDshHome = process.env.DSH_HOME
  /** 测试前的 DSH_AGENTS_HOME 值，用于恢复。 */
  const originalAgentsHome = process.env.DSH_AGENTS_HOME
  /** 测试前的内置技能目录值，用于恢复。 */
  const originalBundled = process.env.DSH_BUNDLED_SKILL_DIR
  process.env.DSH_HOME = dshHome
  process.env.DSH_AGENTS_HOME = agentsHome
  process.env.DSH_BUNDLED_SKILL_DIR = bundled
  /** 当前脚手架引用，便于失败时仍安全清理。 */
  let scaffold: WebScaffold | undefined
  try {
    scaffold = await launchWebScaffold()
    const ctx = scaffold.ctx
    // Local skill discovery belongs to the agent's preset LAYER of the host
    // registry, so the roots under test are only reachable through a composed
    // agent's view — the same scope the `skills/list` Remote resolves for a
    // browser request about a session.
    const handle = await ctx.agents.create({
      sessionId: SessionId('hermetic-skills'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    try {
      const skills = ctx.get('skills')
      if (skills === undefined) throw new Error('the composition mounts no skill registry')
      const names = (await skills.list({ cwd: scaffold.workspaceCwd, scope: handle.agent })).map(skill => skill.name)
      expect(names).not.toContain('ambient-dsh')
      expect(names).not.toContain('ambient-agents')
      expect(names).not.toContain('ambient-bundled')
    } finally {
      await handle.dispose()
    }
  } finally {
    try {
      await scaffold?.close()
    } finally {
      if (originalDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = originalDshHome
      if (originalAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME
      else process.env.DSH_AGENTS_HOME = originalAgentsHome
      if (originalBundled === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR
      else process.env.DSH_BUNDLED_SKILL_DIR = originalBundled
      await rm(ambient, { recursive: true, force: true })
    }
  }
})
