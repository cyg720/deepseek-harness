/**
 * OTel backend unit tier: wire assertions against a scripted `node:http`
 * mock collector through the SDK's REAL pipeline (BatchLogRecordProcessor →
 * OTLP/HTTP JSON), config fail-loud cases, and the real-Loader-path guard
 * for the default-exported Service class.
 */
/*
 * 文件职责：验证 otel.spec.ts 覆盖的会话遥测行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话遥测状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { Context } from '@deepseek-ai/cordis'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { recordFeedback } from '@deepseek-ai/dsh-command-feedback'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import OpenTelemetrySessionBackend, { Config, DEFAULT_TELEMETRY_MODE, SessionTelemetryMode } from '../src/index.ts'

/** 中文说明：interface Capture 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
interface Capture {
  headers: import('node:http').IncomingHttpHeaders
  body: OtlpLogsRequest
}

/** Just the slice of ExportLogsServiceRequest JSON these assertions touch. */
/* 中文说明：interface OtlpLogsRequest 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
interface OtlpLogsRequest {
  resourceLogs: {
    resource: { attributes: { key: string; value: { stringValue?: string } }[] }
    scopeLogs: {
      scope: { name: string }
      logRecords: {
        timeUnixNano: string
        severityNumber: number
        severityText: string
        attributes?: { key: string; value: Record<string, unknown> }[]
        body?: unknown
      }[]
    }[]
  }[]
}

/** 中文说明：变量 servers 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const servers: Server[] = []

// The backend resolves the harness home's anonymous user id at construction;
// pin DSH_HOME to a temp dir so the suite never touches the ambient ~/.dsh.
/** 中文说明：变量 tempHome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let tempHome: string
/** 中文说明：变量 previousDshHome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let previousDshHome: string | undefined
beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dsh-otel-home-'))
  previousDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = tempHome
})
afterAll(() => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  rmSync(tempHome, { recursive: true, force: true })
})

afterEach(async () => {
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (const server of servers.splice(0)) {
    server.close()
    server.closeAllConnections()
  }
})

/** 中文说明：函数 mockCollector 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mockCollector(
  beforeRespond?: (requestIndex: number) => Promise<void> | void,
): Promise<{ url: string; captures: Capture[] }> {
  /** 中文说明：变量 captures 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const captures: Capture[] = []
  /** 中文说明：变量 requestIndex 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let requestIndex = 0
  /** 中文说明：函数值 server 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const server = createServer((request, response) => {
    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      /** 中文说明：变量 index 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const index = requestIndex++
      void (async () => {
        await beforeRespond?.(index)
        /** 中文说明：变量 raw 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const raw = Buffer.concat(chunks)
        /** 中文说明：变量 body 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const body = request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw
        captures.push({
          headers: request.headers,
          body: JSON.parse(body.toString()) as OtlpLogsRequest,
        })
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      })()
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  /** 中文说明：变量 address 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}/v1/logs`, captures }
}

/** 中文说明：函数 boot 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function boot(url: string) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
    mode: SessionTelemetryMode.FULL,
    exporter: { url, headers: { authorization: 'Bearer test-token' } },
  })
  return { ctx, fiber }
}

/** 中文说明：函数 allRecords 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function allRecords(captures: Capture[]) {
  return captures.flatMap(c => c.body.resourceLogs.flatMap(r => r.scopeLogs.flatMap(s =>
    s.logRecords.map(record => ({ scope: s.scope.name, record })))))
}

/** 中文说明：函数 eventTypes 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function eventTypes(captures: Capture[]): string[] {
  return allRecords(captures).flatMap(({ record }) =>
    record.attributes?.flatMap(attribute =>
      attribute.key === 'event.type' && typeof attribute.value['stringValue'] === 'string'
        ? [attribute.value['stringValue']]
        : []) ?? [])
}

describe('OpenTelemetrySessionBackend wire', () => {
  it('ships session records and the ops shutdown marker through the real SDK pipeline', async () => {
    const { url, captures } = await mockCollector()
    const { ctx, fiber } = await boot(url)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('wire'), { meta: { cwd: '/tmp/w' } })
    session.append('turn/start', { turn: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'first complete chunksecond complete chunk' }],
        source: { provider: 'mock', model: 'mock' },
      }),
      stream: [
        {
          type: 'text-chunks',
          time0: 1_000,
          index: 0,
          dt: [7],
          texts: ['first complete chunk', 'second complete chunk'],
        },
        { type: 'chunk', time: 1_007, chunk: { type: 'finish', reason: { kind: 'stop' } } },
      ],
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } })
    ctx.sessionTelemetry.emit({
      channel: 'ledger',
      time: Date.now(),
      severity: 'info',
      attributes: { 'session.id': 'wire', 'event.type': 'manual', 'event.seq': 99 },
      body: { direct: true },
    })
    await fiber.dispose()

    expect(captures.length).toBeGreaterThan(0)
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = captures[0]!
    /** 中文说明：变量 authorization 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const authorization: string | undefined = first.headers.authorization
    expect(authorization).toBe('Bearer test-token')

    /** 中文说明：变量 resource 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resource = first.body.resourceLogs[0]!.resource.attributes
    expect(resource).toContainEqual({ key: 'service.name', value: { stringValue: 'deepseek-harness' } })
    expect(resource).toContainEqual({ key: 'user.id', value: { stringValue: getOrCreateAnonymousUserId() } })

    /** 中文说明：变量 records 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const records = allRecords(captures)
    /** 中文说明：函数值 ledger 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ledger = records.filter(r => r.scope === '@deepseek-ai/dsh-session-telemetry-otel')
    /** 中文说明：函数值 ops 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ops = records.filter(r => r.scope === '@deepseek-ai/dsh-session-telemetry-otel/ops')

    /** 中文说明：函数值 start 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const start = ledger.find(r => r.record.attributes?.some(a => a.key === 'event.type' && a.value.stringValue === 'turn/start'))
    expect(start).toBeDefined()
    expect(start?.record.severityNumber).toBe(9)
    expect(BigInt(start!.record.timeUnixNano)).toBe(BigInt(session.snapshotEvents()[0]!.time) * 1_000_000n)
    expect(start?.record.attributes).toContainEqual({
      key: 'session.format_version',
      value: { intValue: SESSION_FORMAT_VERSION },
    })
    expect(start?.record.attributes).toContainEqual({ key: 'session.cwd', value: { stringValue: '/tmp/w' } })

    /** 中文说明：函数值 end 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const end = ledger.find(r => r.record.attributes?.some(a => a.key === 'event.type' && a.value.stringValue === 'turn/end'))
    expect(end?.record.severityNumber).toBe(17)
    expect(end?.record.severityText).toBe('ERROR')
    const assistant = ledger.find(r =>
      r.record.attributes?.some(a => a.key === 'event.type' && a.value.stringValue === 'assistant/message'))
    const body = assistant?.record.body as {
      kvlistValue: { values: { key: string; value: unknown }[] }
    }
    expect(body.kvlistValue.values.find(value => value.key === 'stream')?.value).toEqual({
      arrayValue: {
        values: [
          {
            kvlistValue: {
              values: [
                { key: 'type', value: { stringValue: 'text-chunks' } },
                { key: 'time0', value: { intValue: 1_000 } },
                { key: 'index', value: { intValue: 0 } },
                { key: 'dt', value: { arrayValue: { values: [{ intValue: 7 }] } } },
                {
                  key: 'texts',
                  value: {
                    arrayValue: {
                      values: [
                        { stringValue: 'first complete chunk' },
                        { stringValue: 'second complete chunk' },
                      ],
                    },
                  },
                },
              ],
            },
          },
          {
            kvlistValue: {
              values: [
                { key: 'type', value: { stringValue: 'chunk' } },
                { key: 'time', value: { intValue: 1_007 } },
                {
                  key: 'chunk',
                  value: {
                    kvlistValue: {
                      values: [
                        { key: 'type', value: { stringValue: 'finish' } },
                        {
                          key: 'reason',
                          value: { kvlistValue: { values: [{ key: 'kind', value: { stringValue: 'stop' } }] } },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    })
    expect(eventTypes(captures)).toContain('manual')

    expect(ops).toHaveLength(1)
    expect(ops[0]!.record.attributes).toContainEqual({ key: 'telemetry.op', value: { stringValue: 'shutdown' } })
  })

  it('drains records enqueued after a timer export began: dispose during an in-flight batch', async () => {
    // The backend implements NO flush() — the batch processor exports on its
    // own cadence, and shutdown's internal drain is complete exactly because
    // nothing in the process calls forceFlush() concurrently (the SDK's
    // concurrent-flush guard skips draining otherwise). Pin that: hold the
    // collector's response to the timer-triggered export open across
    // disposal, and the dispose-time shutdown marker (enqueued after that
    // batch's snapshot) must still arrive.
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<boolean>()
    /** 中文说明：变量 arrived 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const arrived = Promise.withResolvers<boolean>()
    const { url, captures } = await mockCollector(async (index) => {
      if (index === 0) {
        arrived.resolve(true)
        await gate.promise
      }
    })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.FULL,
      exporter: { url },
      processor: { scheduledDelayMillis: 10 },
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('drain'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    await arrived.promise

    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = fiber.dispose()
    // Let disposal reach the backend's shutdown while the export is held open.
    await new Promise(resolve => setTimeout(resolve, 50))
    gate.resolve(true)
    await disposal

    /** 中文说明：函数值 ops 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ops = allRecords(captures).filter(r => r.scope === '@deepseek-ai/dsh-session-telemetry-otel/ops')
    expect(ops).toHaveLength(1)
    expect(ops[0]!.record.attributes).toContainEqual({ key: 'telemetry.op', value: { stringValue: 'shutdown' } })
  })

  it('bounds the SDK forceFlush wait when an in-flight transport never settles', async () => {
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<boolean>()
    /** 中文说明：变量 arrived 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const arrived = Promise.withResolvers<boolean>()
    const { url, captures } = await mockCollector(async (index) => {
      if (index === 0) {
        arrived.resolve(true)
        await gate.promise
      }
    })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.FULL,
      exporter: { url, timeoutMillis: 60_000 },
      processor: { scheduledDelayMillis: 10, exportTimeoutMillis: 60_000 },
      shutdownTimeoutMillis: 50,
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('bounded-shutdown'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    await arrived.promise

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = performance.now()
    await fiber.dispose()
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(captures).toHaveLength(0)

    // The outer deadline cannot cancel the SDK transport. Let it finish so
    // the real provider promise remains clean after the test has proved the
    // Cordis disposer no longer waits for it.
    gate.resolve(true)
    await expect.poll(() => captures.length).toBeGreaterThanOrEqual(2)
  })

  it('passes exporter options beyond url and headers through to the SDK exporter', async () => {
    const { url, captures } = await mockCollector()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    // `compression` is a documented SDK exporter option; the advertised
    // verbatim passthrough must hand it (and every other field) to the
    // exporter rather than silently rebuilding url/headers only.
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.FULL,
      exporter: { url, compression: 'gzip' },
    } as Config)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('gzip'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    await fiber.dispose()

    expect(captures.length).toBeGreaterThan(0)
    expect(captures[0]!.headers['content-encoding']).toBe('gzip')
    /** 中文说明：函数值 types 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const types = allRecords(captures).flatMap(({ record }) =>
      record.attributes?.flatMap(a => a.key === 'event.type' ? [a.value.stringValue] : []) ?? [])
    expect(types).toContain('turn/start')
  })

  it('maps warn severity from record policy and leaves the seam flush hint unimplemented', async () => {
    const { url, captures } = await mockCollector()
    const { ctx, fiber } = await boot(url)
    ctx.on('session-telemetry/record', (_record, next) => ({ ...next(), severity: 'warn' }))
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('warn'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    // No flush(): the coordinator's optional-call forwarding no-ops, and the
    // batch processor owns export cadence end to end (see the backend note).
    expect('flush' in ctx.sessionTelemetry && ctx.sessionTelemetry.flush !== undefined).toBe(false)
    await fiber.dispose()
    /** 中文说明：函数值 start 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const start = allRecords(captures).find(r =>
      r.record.attributes?.some(a => a.key === 'event.type' && a.value.stringValue === 'turn/start'))
    expect(start?.record.severityNumber).toBe(13)
  })

  it('replays each session suffix only at the next feedback event', async () => {
    const { url, captures } = await mockCollector()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.FEEDBACK_ONLY,
      exporter: { url },
    })
    ctx.on('session-telemetry/record', (_record, next) => {
      ctx.sessionTelemetry.emit({
        channel: 'ledger',
        time: Date.now(),
        severity: 'info',
        attributes: { 'session.id': 'feedback-only', 'event.type': 'direct-bypass', 'event.seq': 99 },
        body: { mustStayLocal: true },
      })
      return next()
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('feedback-only'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    recordFeedback(session, 'first report')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    recordFeedback(session, 'second report')
    session.append('turn/start', { turn: 2 })
    await fiber.dispose()

    /** 中文说明：函数值 types 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const types = allRecords(captures).flatMap(({ record }) =>
      record.attributes?.flatMap(attribute =>
        attribute.key === 'event.type' ? [attribute.value.stringValue] : []) ?? [])
    expect(types).toEqual(['turn/start', 'feedback/record', 'turn/end', 'feedback/record'])
    expect(JSON.stringify(captures)).toContain('first report')
    expect(JSON.stringify(captures)).toContain('second report')
    expect(allRecords(captures).some(({ scope }) => scope.endsWith('/ops'))).toBe(false)
  })

  it('ignores direct emits and non-canonical feedback in feedback-only mode', async () => {
    const { url, captures } = await mockCollector()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.FEEDBACK_ONLY,
      exporter: { url },
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('no-feedback'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    ctx.sessionTelemetry.emit({
      channel: 'ledger',
      time: Date.now(),
      severity: 'info',
      attributes: { 'session.id': 'no-feedback', 'event.type': 'direct', 'event.seq': 99 },
      body: { mustStayLocal: true },
    })
    ctx.emit('session/event', session, {
      type: 'feedback/record',
      seq: SessionSeq(session.seq),
      time: Date.now(),
      data: { text: 'not committed' },
    })
    await fiber.dispose()

    expect(warn).toHaveBeenCalledWith(
      'session telemetry ignored a feedback event absent from the canonical session log',
    )
    expect(captures).toEqual([])
  })

  it('constructs no disabled transport even when exporter options are present', async () => {
    const { url, captures } = await mockCollector()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.DISABLED,
      exporter: { url },
      processor: { maxExportBatchSize: 0 },
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('disabled'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    recordFeedback(session, 'local report')

    expect(warn).toHaveBeenCalledWith(
      'session telemetry is DISABLED; nothing will be shared and this feedback remains local',
    )
    ctx.sessionTelemetry.emit({
      channel: 'ledger',
      time: 0,
      severity: 'info',
      attributes: {},
      body: null,
    })
    await ctx.sessionTelemetry.shutdown()
    await fiber.dispose()
    recordFeedback(session, 'after disposal')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(captures).toEqual([])
  })

  it('discloses the sharing policy for every mode', async () => {
    const { url, captures } = await mockCollector()

    /** 中文说明：变量 fullCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fullCtx = new Context()
    await fullCtx.plugin(SessionStore)
    /** 中文说明：变量 full 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const full = await fullCtx.plugin(OpenTelemetrySessionBackend, { mode: SessionTelemetryMode.FULL, exporter: { url } })
    expect(fullCtx.sessionTelemetry.sharing).toBe('full')
    await full.dispose()

    /** 中文说明：变量 gatedCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gatedCtx = new Context()
    await gatedCtx.plugin(SessionStore)
    /** 中文说明：变量 gated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gated = await gatedCtx.plugin(OpenTelemetrySessionBackend, { mode: SessionTelemetryMode.FEEDBACK_ONLY, exporter: { url } })
    expect(gatedCtx.sessionTelemetry.sharing).toBe('feedback-only')
    await gated.dispose()

    /** 中文说明：变量 disabledCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disabledCtx = new Context()
    await disabledCtx.plugin(SessionStore)
    /** 中文说明：变量 disabled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disabled = await disabledCtx.plugin(OpenTelemetrySessionBackend, { mode: SessionTelemetryMode.DISABLED })
    expect(disabledCtx.sessionTelemetry.sharing).toBe('disabled')
    await disabled.dispose()

    // An omitted mode is DISABLED, so the default also shares nothing.
    /** 中文说明：变量 defaultCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const defaultCtx = new Context()
    await defaultCtx.plugin(SessionStore)
    /** 中文说明：变量 defaulted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const defaulted = await defaultCtx.plugin(OpenTelemetrySessionBackend, {})
    expect(defaultCtx.sessionTelemetry.sharing).toBe('disabled')
    await defaulted.dispose()

    // No record was emitted by any mode, so nothing reached the collector.
    expect(captures).toEqual([])
  })

  it('defaults direct construction to disabled delivery', async () => {
    const { url, captures } = await mockCollector()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    new OpenTelemetrySessionBackend(ctx, {
      exporter: { url },
      processor: { maxExportBatchSize: 0 },
    })
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('direct-default'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    recordFeedback(session, 'local report')
    await ctx.fiber.dispose()

    expect(warn).toHaveBeenCalledWith(
      'session telemetry is DISABLED; nothing will be shared and this feedback remains local',
    )
    expect(captures).toEqual([])
  })
})

describe('OpenTelemetrySessionBackend config fails loud', () => {
  it('exposes modes through the nominal enum', () => {
    expectTypeOf<Config['mode']>().toEqualTypeOf<SessionTelemetryMode | undefined>()
    expectTypeOf<'FULL'>().not.toExtend<SessionTelemetryMode>()
    expectTypeOf<SessionTelemetryMode.FULL>().toExtend<SessionTelemetryMode>()
    expect(DEFAULT_TELEMETRY_MODE).toBe(SessionTelemetryMode.DISABLED)
    expect(Config({}).mode).toBe(DEFAULT_TELEMETRY_MODE)
  })

  it.each([
    [{ mode: SessionTelemetryMode.FULL }, /exporter\.url is required/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: '' } }, /exporter\.url is required/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'not a url' } }, /not a valid URL/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'ftp://collector' } }, /must be http\(s\)/],
    [{ mode: SessionTelemetryMode.FEEDBACK_ONLY }, /exporter\.url is required/],
    [{ mode: 'INVALID' }, /INVALID/],
    // The SDK accepts a non-positive batch size but its shutdown drain then
    // splices empty batches forever — dispose would hang, so reject at load.
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'http://c/v1/logs' }, processor: { maxExportBatchSize: 0 } }, /maxExportBatchSize/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'http://c/v1/logs' }, processor: { maxExportBatchSize: 0.5 } }, /maxExportBatchSize/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'http://c/v1/logs' }, shutdownTimeoutMillis: 0 }, /shutdownTimeoutMillis/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'http://c/v1/logs' }, shutdownTimeoutMillis: Number.POSITIVE_INFINITY }, /shutdownTimeoutMillis/],
  ])('rejects %j at plugin load', async (config, message) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await expect(ctx.plugin(OpenTelemetrySessionBackend, config as Config)).rejects.toThrow(message)
  })

  it('rejects an unknown direct mode before reading transport config', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 exporterRead 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let exporterRead = false
    /** 中文说明：变量 config 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const config = {
      mode: 'INVALID',
      get exporter() {
        exporterRead = true
        throw new Error('transport config was read')
      },
    } as unknown as Config

    expect(() => new OpenTelemetrySessionBackend(ctx, config)).toThrow(/unsupported mode "INVALID"/)
    expect(exporterRead).toBe(false)
  })

  it('does not read any transport setting in disabled mode', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：函数值 transportRead 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const transportRead = vi.fn(() => {
      throw new Error('transport config was read')
    })
    /** 中文说明：变量 config 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const config = {
      mode: SessionTelemetryMode.DISABLED,
      get exporter() {
        return transportRead()
      },
      get processor() {
        return transportRead()
      },
      get shutdownTimeoutMillis() {
        return transportRead()
      },
    } as unknown as Config

    new OpenTelemetrySessionBackend(ctx, config)
    expect(transportRead).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})

describe('dsh-session-telemetry-otel real-load-path guard', () => {
  it('keeps the Service class with inject/Config through unwrapExports', async () => {
    /** 中文说明：变量 module 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const module = await import('../src/index.ts')
    /** 中文说明：变量 loader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：变量 unwrapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unwrapped = loader.unwrapExports(module) as typeof OpenTelemetrySessionBackend
    expect(unwrapped).toBe(OpenTelemetrySessionBackend)
    expect(unwrapped.inject).toEqual(['sessions'])
    expect(typeof unwrapped.Config).toBe('function')
  })

  it('boots through the unwrapped class and registers ctx.sessionTelemetry', async () => {
    const { url } = await mockCollector()
    /** 中文说明：变量 module 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const module = await import('../src/index.ts')
    /** 中文说明：变量 loader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：变量 unwrapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unwrapped = loader.unwrapExports(module) as Parameters<Context['plugin']>[0]
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(unwrapped, { mode: SessionTelemetryMode.FULL, exporter: { url } })
    expect(ctx.sessionTelemetry).toBeInstanceOf(OpenTelemetrySessionBackend)
    await fiber.dispose()
  })
})
