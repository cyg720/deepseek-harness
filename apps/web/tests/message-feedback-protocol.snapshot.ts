/**
 * 文件职责：固定消息反馈 Host Remote 接口的列表、写入、版本冲突和删除协议。
 * 技术维度：使用 Vitest、真实 Web Host、HTTP fetch、会话 fixture 和 JSON 文件快照。
 * 产品维度：保障评分与备注在客户端和主机之间可靠保存，并能识别并发版本冲突。
 * 逻辑维度：启动主机并注入会话，依次发起协议调用，归一化运行时 UUID 与时间后比较快照。
 * 关键边界：只归一化本次运行生成的版本和时间，端点名、请求字段和业务响应必须精确保留。
 * 新手阅读建议：先看 ProtocolExchange，再读 invoke 如何组装线协议，最后按调用顺序查看快照场景。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  fixtureIdentity,
  launchWebScaffold,
  seedSession,
  type WebScaffold,
} from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/message-feedback-protocol', import.meta.url))
const SESSION_FIXTURE = join(SNAPSHOT_DIR, 'session.v2.jsonl')
const PROTOCOL_EXPECTED = join(SNAPSHOT_DIR, 'protocol.expected.json')
/** 注入主机时使用的稳定会话标识。 */
const SESSION_ID = 'message-feedback-protocol'
const MESSAGE_ID = fixtureIdentity('message', 2)

/** 记录一次 HTTP 协议调用的端点、请求、状态码和响应。 */
interface ProtocolExchange {
  readonly endpoint: string
  readonly request: unknown
  readonly status: number
  readonly response: unknown
}

/** 判断 value 是否为非空对象记录，返回类型保护结果。示例：isRecord(response)。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Extract the opaque item version while keeping every surrounding wire field snapshot-owned. */
/* 从成功响应提取不透明版本号；响应字段不完整时抛错。示例：createdVersion(created)。 */
function createdVersion(response: unknown): string {
  if (!isRecord(response) || !isRecord(response.result) || response.result.ok !== true
    || !isRecord(response.result.value) || response.result.value.ok !== true
    || !isRecord(response.result.value.value)
    || typeof response.result.value.value.version !== 'string') {
    throw new Error('messageFeedback.put did not return a successful versioned item')
  }
  return response.result.value.value.version
}

/** Replace only run-owned UUID/time values; all protocol names and business fields stay exact. */
/* 仅替换 version 和时间运行值并返回 JSON；其余协议字段保持精确。示例：normalizeProtocol(items, version)。 */
function normalizeProtocol(exchanges: readonly ProtocolExchange[], version: string): string {
  return JSON.stringify(exchanges, (key, value: unknown) => {
    if (key === 'messageId' && value === MESSAGE_ID) return '{{message:2}}'
    if ((key === 'version' || key === 'ifVersion') && value === version) return '{{version}}'
    if ((key === 'createdAt' || key === 'updatedAt') && typeof value === 'number') return '{{timestamp}}'
    return value
  }, 2)
}

describe('message feedback Host Remote protocol', () => {
  /** 提供真实 Host Remote 端点的 Web 脚手架。 */
  let scaffold: WebScaffold

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    await seedSession(scaffold, await readFile(SESSION_FIXTURE, 'utf8'), SESSION_ID)
  })

  afterAll(async () => {
    await scaffold?.close()
  })

  it('snapshots strict list, put, conflict, and delete calls through the shipped Web Host', async () => {
    /** 按发生顺序收集的协议交换记录。 */
    const exchanges: ProtocolExchange[] = []
    /** 调用 endpoint；rpcId 标识请求，request 是业务参数，返回解析后的响应。 */
    const invoke = async (rpcId: string, endpoint: string, request: unknown): Promise<unknown> => {
      /** Host Remote 要求的 args.request 外层载荷。 */
      const payload = { args: { request } }
      const response = await scaffold.hostFetch(`/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId,
          method: endpoint,
          payload,
        }),
      })
      const body: unknown = await response.json()
      exchanges.push({ endpoint: `/api/${endpoint}`, request: payload, status: response.status, response: body })
      return body
    }

    await invoke('feedback-invalid', 'messageFeedback/put', {
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      rating: 'invalid-rating',
      ifVersion: null,
    })
    await invoke('feedback-list-empty', 'messageFeedback/list', { sessionId: SESSION_ID })
    const created = await invoke('feedback-put', 'messageFeedback/put', {
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      rating: 'positive',
      note: 'Useful answer',
      ifVersion: null,
    })
    const version = createdVersion(created)
    expect(version).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    await invoke('feedback-list-created', 'messageFeedback/list', { sessionId: SESSION_ID })
    await invoke('feedback-conflict', 'messageFeedback/put', {
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      rating: 'negative',
      ifVersion: null,
    })
    await invoke('feedback-delete', 'messageFeedback/delete', {
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      ifVersion: version,
    })
    await invoke('feedback-list-deleted', 'messageFeedback/list', { sessionId: SESSION_ID })

    expect(exchanges.every(exchange => exchange.status === 200)).toBe(true)
    await compareOrRefreshGolden(PROTOCOL_EXPECTED, normalizeProtocol(exchanges, version), scaffold.mode)
    await assertFixtureInventory(SNAPSHOT_DIR, ['protocol.expected.json', 'session.v2.jsonl'])
  })
})
