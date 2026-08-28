/**
 * 文件职责：验证时间上下文的 time-context.e2e.ts 行为。
 * 技术维度：Vitest、会话事件、模型请求夹具和 Cordis 组装。
 * 产品维度：防止时间上下文改变模型可见内容或生命周期语义。
 * 逻辑维度：构造日志与配置，运行插件并断言事件、请求和清理。
 * 关键边界：模型可见内容必须可重建；工具调用和结果必须保持配对。
 * 新手阅读建议：先读事件夹具，再按正常、边界和失败场景阅读。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

// Keep the Loader config under examples so both modes exercise the same deployable
// topology: local fixture source plus bare plugins owned by the examples workspace.
/** 中文说明：测试局部值 driver，由紧邻初始化决定。 */
const driver = fileURLToPath(new URL(
  './fixtures/driver.ts',
  import.meta.url,
))
/** 中文说明：测试局部值 configPath，由紧邻初始化决定。 */
const configPath = fileURLToPath(new URL(
  './fixtures/cordis.yml',
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

describe('time-context through a real headless cordis.yml', () => {
  it('uses the process zone and persists one ordered context event per request', async () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    let events: SessionEvent[] = []
    /** 中文说明：测试局部值 { stderr }，由紧邻初始化决定。 */
    const { stderr } = await runLoaderSmoke({
      label: 'time-context headless smoke',
      tempDirPrefix: 'time-context-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      env: { TZ: 'Asia/Shanghai' },
      inspect: async (cwd) => {
        /** 中文说明：测试局部值 logs，由紧邻初始化决定。 */
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        /** 中文说明：测试局部值 lines，由紧邻初始化决定。 */
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(stderr).not.toContain('UNHANDLED')
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(2)

    /** 中文说明：测试局部值 contexts，由紧邻初始化决定。 */
    const contexts = events.filter(
      (event): event is SessionEvent<'user/message'> => event.type === 'user/message' && event.data.source.kind === 'plugin')
    /** 中文说明：测试局部值 starts，由紧邻初始化决定。 */
    const starts = events.filter(event => event.type === 'step/start')
    expect(contexts).toHaveLength(2)
    expect(starts).toHaveLength(2)
    /** 中文说明：测试局部值 index，由紧邻初始化决定。 */
    for (let index = 0; index < contexts.length; index += 1) {
      expect(contexts[index]!.seq).toBeGreaterThan(starts[index]!.seq)
      expect(contexts[index]!.surfaceOp).toBe('append')
      // `snapshot` form: one named contribution whose text is exactly what the
      // model read, so a consumer attributes it without re-splitting prose.
      expect(contexts[index]!.data.source).toMatchObject({
        kind: 'plugin',
        plugin: 'time-context',
        form: 'snapshot',
        sections: [{ name: 'time-context' }],
      })
    }
    /** 中文说明：测试局部值 contextText，由紧邻初始化决定。 */
    const contextText = contexts.map(event => event.data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n'))
    expect(contextText[0]).toMatch(
      /Time sampled while preparing turn 1, step 1: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00\[Asia\/Shanghai\]/,
    )
    expect(contextText[0]).toContain('Elapsed since the preceding model-visible message: unavailable.')
    expect(contextText[1]).toMatch(/Time sampled while preparing turn 2, step 1:/)
    expect(contextText[1]).toMatch(
      /Elapsed since the preceding model-visible message: (?:\d+d )?(?:\d+h )?(?:\d+m )?\d+s\./,
    )

    /** 中文说明：测试局部值 headers，由紧邻初始化决定。 */
    const headers = events.filter(event => event.type === 'request/header')
    expect(JSON.stringify(headers)).not.toContain('Time sampled while preparing')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
