/**
 * Showcase integration: the real `web_fetch` tool + the real spill stack
 * (`dsh-spill-local` backend + `dsh-spill-policy`), exercised through
 * `ctx.tools.execute()`. Proves the Agent Note's default local-backend path — a large
 * formatted fetch result is automatically retained and spilled with NO
 * tool-specific spill code, and the model-facing text changes ONLY by the
 * deliberate spill notice (the full formatted result lands in the spill file).
 */
/*
 * 文件职责：验证 spill.spec.ts 覆盖的Web 搜索与抓取行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的Web 搜索与抓取能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal
import WebRuntime from '@deepseek-ai/dsh-web'
import * as WebFetchLocal from '@deepseek-ai/dsh-web-fetch-http'
import LocalSpillStore from '@deepseek-ai/dsh-spill-local'
import * as SpillPolicy from '@deepseek-ai/dsh-spill-policy'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'

/** 中文说明：type Handler 定义本测试所需的数据或行为，用于表达Web 搜索与抓取场景。 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void

/** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let server: Server
/** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let base: string
/** 中文说明：变量 handler 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let handler: Handler
/** 中文说明：变量 spillRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let spillRoot: string
/** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ctx: Context

/** 中文说明：常量 BODY 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const BODY = 'X'.repeat(4000) // formatted result is well over the policy cap
/** 中文说明：常量 MAX_INLINE_BYTES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MAX_INLINE_BYTES = 1000 // leaves room for a head/tail preview beside the notice

beforeEach(async () => {
  handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(BODY) }
  server = createServer((req, res) => { handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  spillRoot = mkdtempSync(join(tmpdir(), 'dsh-spill-web-'))

  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WebRuntime, { fetchProvider: WebFetchLocal.LOCAL_FETCH_PROVIDER_ID })
  // Provider cap generous so the tool returns a large formatted result; the
  // policy cap is what triggers the spill (the Agent Note's separation of concerns).
  await ctx.plugin(WebFetchLocal, { maxBodyChars: 500_000 })
  await ctx.plugin(LocalSpillStore, { root: spillRoot })
  await ctx.plugin(SpillPolicy, { maxInlineBytes: MAX_INLINE_BYTES })
  await ctx.plugin(ToolWeb)
})

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => { resolve() }))
  rmSync(spillRoot, { recursive: true, force: true })
})

/** A web_fetch call carrying a session owner (so the policy can scope the spill). */
/* 中文说明：函数 fetchCall 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fetchCall(): Promise<{ isError: boolean; content: { type: string; text?: string }[] }> {
  /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const agent = { session: { header: { id: SessionId('web-sess') } } }
  /** 中文说明：变量 exec 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const exec = { callId: CallId('call-1'), name: 'web_fetch', arguments: { url: base }, agent, signal: testToolSignal } as unknown as ToolExecution
  return ctx.tools.execute(exec)
}

describe('web_fetch spill showcase', () => {
  it('spills a large formatted result and returns a preview + spill locator', async () => {
    /** 中文说明：变量 out 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const out = await fetchCall()
    expect(out.isError).toBe(false)
    /** 中文说明：函数值 text 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const text = out.content.map(b => b.text).join('')

    // Model-facing text is a preview + notice within the cap, NOT the full body.
    expect(text.length).toBeLessThan(BODY.length)
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(MAX_INLINE_BYTES)
    expect(text).toContain(`Fetched ${base}`) // the head of the formatted result survives
    expect(text).toContain('Full formatted result stored at:')
    expect(text).toContain('Use read with offset/limit, or grep this path')

    // The spill file holds the FULL formatted result the tool returned.
    /** 中文说明：变量 match 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const match = /stored at: (\S+?)\. Use read/.exec(text)
    expect(match).not.toBeNull()
    /** 中文说明：变量 spillPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spillPath = match![1]!
    /** 中文说明：变量 saved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const saved = readFileSync(spillPath, 'utf8')
    // The provider cap was generous, so the tool did not truncate: the spill file
    // holds the full formatted result (header + the complete body), far larger
    // than the model-facing preview.
    expect(saved).toContain('(HTTP 200)')
    expect(saved).toContain(BODY)
    expect(saved.length).toBeGreaterThan(text.length)
  })
})
