/**
 * 文件职责：验证目标管理的 goal.e2e.ts 行为与安全边界。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证目标管理操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：构造请求与状态，驱动服务并断言输出和清理。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { decodeGoalChange } from '@deepseek-ai/dsh-goal'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

/** 中文说明：测试局部值 binScript，由紧邻初始化决定。 */
const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/headless-driver.ts', import.meta.url))
/** 中文说明：测试局部值 configPath，由紧邻初始化决定。 */
const configPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/goal-domain/cordis.yml',
  import.meta.url,
))
/** 中文说明：测试局部值 repoTsconfig，由紧邻初始化决定。 */
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** 中文说明：函数 jsonlFiles 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function jsonlFiles(dir: string): Promise<string[]> {
  /** 中文说明：测试局部值 entries，由紧邻初始化决定。 */
  const entries = await readdir(dir, { withFileTypes: true })
  /** 中文说明：测试局部值 paths，由紧邻初始化决定。 */
  const paths = await Promise.all(entries.map(async (entry) => {
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

describe('goal domain through a real cordis.yml and headless process', () => {
  it('persists the Loader-mounted snapshot without starting a goal round', async () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    let events: SessionEvent[] = []
    /** 中文说明：测试局部值 { stdout, stderr }，由紧邻初始化决定。 */
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'goal-domain',
      tempDirPrefix: 'goal-domain-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'prove the persisted goal domain'],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        /** 中文说明：测试局部值 logs，由紧邻初始化决定。 */
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        /** 中文说明：测试局部值 lines，由紧邻初始化决定。 */
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(stderr).toBe('')
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as Record<string, unknown>
    expect(result).toMatchObject({
      type: 'result',
    })
    expect(result['output']).toBeTypeOf('string')
    expect(result['output']).toContain('CLI tool round trip complete')
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)

    /** 中文说明：测试局部值 changes，由紧邻初始化决定。 */
    const changes = events.filter(event => event.type === 'goal/change')
    expect(changes).toHaveLength(1)
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = changes[0]
    if (context?.type !== 'goal/change') throw new Error('expected goal change event')
    /** 中文说明：测试局部值 change，由紧邻初始化决定。 */
    const change = decodeGoalChange(context.data)
    if (change === undefined) throw new Error('expected durable goal change')
    expect(change).toMatchObject({
      operation: 'create',
      roundsStarted: 0,
      goal: {
        revision: 1,
        objective: 'Prove the composed goal survives in the session log',
        phase: 'active',
        maxGoalRounds: 7,
      },
    })
    expect(JSON.stringify(context)).not.toContain('activation')
    // No admitted continuation round ran; the goal change itself is independent
    // from model-visible user messages.
    expect(events.filter(event => event.type === 'user/message'
      && event.data.source.kind === 'goal' && event.data.source.round > 0)).toHaveLength(0)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
