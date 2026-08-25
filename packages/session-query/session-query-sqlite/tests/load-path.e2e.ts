/**
 * 文件职责：验证 load-path.e2e.ts 覆盖的会话查询行为、持久化与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、SQLite 或会话事件日志。
 * 产品维度：保障 Agent 的会话查询结果稳定、可追踪且可恢复。
 * 逻辑维度：准备会话和存储数据，执行查询或恢复流程，再核对结果、错误与清理。
 * 关键边界：持久化数据属于不可信输入；事件必须可重放；临时数据库与异步资源必须释放。
 * 新手阅读建议：先看测试夹具和查询条件，再读正常场景，最后关注重启、损坏与失败路径。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
/**
 * Keyless real-Loader-path smoke for the combined SQLite session-query service.
 *
 * @module @deepseek-ai/dsh-session-query-sqlite/tests/load-path
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import SqliteSessionQueryEngine, * as queryModule from '@deepseek-ai/dsh-session-query-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 中文说明：变量 temporaryDirectories 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const temporaryDirectories: string[] = []

afterEach(async () => {
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/** 中文说明：函数 temporaryPath 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function temporaryPath(name: string): Promise<string> {
  /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const directory = await mkdtemp(join(tmpdir(), 'dsh-session-search-loader-'))
  temporaryDirectories.push(directory)
  return join(directory, name)
}

describe('dsh-session-query-sqlite real Loader path', () => {
  it('unwraps, mounts, and searches the real persistence backend', async () => {
    /** 中文说明：变量 persistencePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistencePath = await temporaryPath('canonical.db')
    /** 中文说明：变量 searchPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const searchPath = await temporaryPath('derived.db')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistence = await ctx.plugin(SqliteSessionPersistence, { path: persistencePath })

    /** 中文说明：变量 loader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：变量 unwrapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unwrapped = loader.unwrapExports(queryModule) as Parameters<Context['plugin']>[0]
    expect(unwrapped).toBe(SqliteSessionQueryEngine)
    /** 中文说明：变量 query 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const query = await ctx.plugin(unwrapped, { path: searchPath })

    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = SessionId('loader-path')
    await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: 10 })
    await ctx.sessionPersistence.append(id, [{
      type: 'user/message',
      seq: 0,
      time: 10,
      data: createUserMessage({
        content: [{ type: 'text', text: 'real Loader needle' }], source: { kind: 'user' },
      }),
      surfaceOp: 'append',
    }])

    await expect(ctx.sessionQuery.searchSessions({ query: 'Loader needle' }))
      .resolves.toMatchObject({ items: [{ header: { id }, persisted: true, live: false }] })
    await expect(ctx.sessionQuery.listSessions())
      .resolves.toMatchObject([{ header: { id }, persisted: true, live: false }])
    await query.dispose()
    await persistence.dispose()
  })
})
