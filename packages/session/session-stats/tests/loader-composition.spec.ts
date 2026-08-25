/**
 * REAL-composition proof: the shipped YAML shape (session + projection
 * registry + session-stats) boots through the vendored Loader, the function
 * plugin's namespace survives (no default export), and a full logged turn
 * serves `{turns: 1, steps: 1}` through the composed registry.
 */
/**
 * 文件职责：验证 loader-composition.spec.ts 覆盖的会话投影统计行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话投影统计状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionStatsPlugin from '@deepseek-ai/dsh-session-stats'

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let root: string | undefined
/** 中文说明：变量 context 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** 中文说明：函数 loadYaml 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-session-stats-loader-'))
  /** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  /** 中文说明：变量 modules 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-session-stats', SessionStatsPlugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads the shipped session-stats YAML shape and serves whole-log counts', async () => {
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-session-stats'",
    ])

    /** 中文说明：变量 unloaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = loaded.sessions.create(SessionId('composed'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(loaded.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1 })
  })

  it('keeps the function-plugin namespace free of a default export', () => {
    // A default export beside the named form makes the Loader discard the
    // namespace (postmortem 0001) — pin its absence.
    expect('default' in SessionStatsPlugin).toBe(false)
  })
})
