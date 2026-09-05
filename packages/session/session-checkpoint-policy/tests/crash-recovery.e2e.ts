/**
 * 文件职责：验证 crash-recovery.e2e.ts 覆盖的会话检查点恢复行为、持久化与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、SQLite 或会话事件日志。
 * 产品维度：保障 Agent 的会话检查点恢复结果稳定、可追踪且可恢复。
 * 逻辑维度：准备会话和存储数据，执行查询或恢复流程，再核对结果、错误与清理。
 * 关键边界：持久化数据属于不可信输入；事件必须可重放；临时数据库与异步资源必须释放。
 * 新手阅读建议：先看测试夹具和查询条件，再读正常场景，最后关注重启、损坏与失败路径。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SessionStore, {
  SessionId, TOOL_OUTCOME_UNKNOWN, interruptedTurnClosers,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

/** 中文说明：变量 repoRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
/** 中文说明：变量 childScript 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const childScript = fileURLToPath(new URL('./fixtures/crash-child.ts', import.meta.url))
/** 中文说明：变量 tsxLoader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'))
/** 中文说明：变量 sessionId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const sessionId = SessionId('semantic-checkpoint-crash')
/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
/** 中文说明：常量 CHILD_FAILPOINT_TIMEOUT_MS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CHILD_FAILPOINT_TIMEOUT_MS = 30_000

/** 中文说明：函数 waitForMarker 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitForMarker(path: string, expected: string): Promise<string> {
  // vi.waitFor retries every callback throw, so terminal states RESOLVE out
  // of the retry loop (complete marker, or content that can no longer become
  // the expected marker) and only the still-in-progress states throw-to-retry.
  /** 中文说明：函数值 content 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const content = await vi.waitFor(async () => {
    /** 中文说明：函数值 current 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const current = await readFile(path, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      throw new Error(`crash child did not publish failpoint ${JSON.stringify(expected)} at ${path}`, { cause: error })
    })
    if (current === expected || !expected.startsWith(current)) return current
    throw new Error(`crash child has not finished publishing failpoint ${JSON.stringify(expected)}`)
  }, { interval: 10, timeout: CHILD_FAILPOINT_TIMEOUT_MS })
  if (content !== expected) {
    throw new Error(`crash child wrote unexpected failpoint ${JSON.stringify(content)}`)
  }
  return content
}

/** 中文说明：函数 crashAt 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function crashAt(mode: 'request' | 'tool'): Promise<{ root: string; markerText: string }> {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = await mkdtemp(join(tmpdir(), `dsh-semantic-${mode}-`))
  roots.push(root)
  /** 中文说明：变量 marker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const marker = join(root, 'failpoint')
  // Keep the open-before-write window deterministic: readiness is marker content, not path existence.
  await writeFile(marker, '')
  /** 中文说明：变量 expectedMarker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const expectedMarker = mode === 'request' ? 'request-dispatched' : 'tool-side-effect'
  // The SIGKILL-at-failpoint choreography stays custom: the child must die
  // mid-write, so no timeout or graceful termination may reach it first.
  /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const child = execa(process.execPath, ['--import', tsxLoader, childScript, mode, root, marker], {
    cwd: repoRoot,
    env: { TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.json') },
    stdin: 'ignore',
    stdout: 'ignore',
    reject: false,
  })
  try {
    /** 中文说明：变量 markerText 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const markerText = await waitForMarker(marker, expectedMarker)
    child.kill('SIGKILL')
    /** 中文说明：变量 exit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exit = await child
    expect({ code: exit.exitCode ?? null, signal: exit.signal ?? null }).toEqual({ code: null, signal: 'SIGKILL' })
    return { root, markerText }
  } catch (error: unknown) {
    child.kill('SIGKILL')
    throw new Error(`crash child failed: ${(await child).stderr}`, { cause: error })
  }
}

// Read the crashed durable log and balance it the way a resuming reader does:
// the stored events stay untouched; `interruptedTurnClosers` supplies the
// in-memory closers for the interrupted tail turn.
async function load(root: string): Promise<SessionEvent[]> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  try {
    const handle = await ctx.sessionPersistence.open(sessionId, 'read')
    try {
      const events = await handle.read()
      return [...events, ...interruptedTurnClosers(events)]
    } finally {
      await handle.close()
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('semantic checkpoint hard-crash recovery', () => {
  it('persists the complete request before model dispatch', async () => {
    /** 中文说明：变量 crashed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const crashed = await crashAt('request')
    expect(crashed.markerText).toBe('request-dispatched')
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = await load(crashed.root)
    expect(events.map(event => event.type)).toEqual([
      'agent/inbox/spliced', 'turn/start', 'agent/inbox/spliced',
      'step/start', 'user/message', 'request/header', 'request/context', 'step/end', 'turn/end',
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'turn/end', data: { reason: { kind: 'interrupted' } },
    })
  })

  it('persists tool intent before a side effect and repairs its missing result as unknown', async () => {
    /** 中文说明：变量 crashed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const crashed = await crashAt('tool')
    expect(crashed.markerText).toBe('tool-side-effect')
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = await load(crashed.root)
    expect(events.some(event => event.type === 'assistant/message')).toBe(true)
    expect(events.some(event => event.type === 'tool/call')).toBe(true)
    /** 中文说明：函数值 result 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const result = events.find(event => event.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.data.error).toEqual({
      name: 'ToolOutcomeUnknownError', code: TOOL_OUTCOME_UNKNOWN,
    })
    if (result?.type !== 'tool/result' || result.data.message.content[0].content[0]?.type !== 'text') {
      throw new Error('expected a text tool result')
    }
    expect(result.data.message.content[0].content[0].text).toContain('Do not retry blindly.')
  })
})
