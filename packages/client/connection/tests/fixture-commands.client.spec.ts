/**
 * 文件职责：验证快照夹具提供的远程命令、目标操作和技能列表接口可由连接客户端调用。
 * 技术维度：Fixture API、类型化 RPC 辅助函数、Vitest 和内存态会话标识。
 * 产品维度：保证无密钥回放环境中的常用客户端命令与真实组装接口保持一致。
 * 逻辑维度：创建夹具端面，发出远程调用，检查成功、缺失参数、图片输入和不存在会话等结果。
 * 关键边界：断言依赖固定夹具数据；修改夹具协议或预置会话时需要同步更新这些期望。
 * 新手阅读建议：先看 callRemote 的调用形式，再按 goals、skills、commands 三类产品能力阅读。
 */
/**
 * Fixture commands/skills domains: session-addressed catalogs, execute
 * parse/dispatch and its logged lifecycle pair, skill.list session resolution,
 * and the FixtureApiClient dispatch rows. Commands answer on the Remote face
 * and skills on the legacy API face, so both are driven here.
 */
/** 文件职责：验证夹具命令、目标和技能调用。技术维度：类型化 RPC 与固定夹具。产品维度：保持回放接口可用。逻辑维度：调用端点并核对结果。关键边界：预置数据变化需同步期望。新手阅读建议：按 goals、skills、commands 阅读。 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '../src/client/api.ts'
import { RpcId } from '../src/client/api.ts'
import type { RpcRequest } from '../src/client/api.ts'
import { FixtureApiClient, createFixtureApi, createFixtureFaces } from '../src/client/fixture.ts'

/** Drive one commands Remote endpoint against the fixture state graph. */
/** 中文说明：测试辅助函数 `callRemote`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
async function callRemote<T>(
  rpc: ReturnType<typeof createFixtureFaces>['rpc'],
  endpoint: string,
  args: Record<string, unknown>,
): Promise<T> {
  /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `result` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const result = await rpc.call('/api', endpoint, { args })
  if (!result.ok) throw new Error(`${endpoint} failed: ${result.error.code}`)
  return result.value as T
}

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `sid` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const sid = (id: string): SessionId => id as SessionId
/** 中文说明：用于记录次数、编号或状态码的标量值；变量 `reqCount` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
let reqCount = 0
/** 中文说明：当前场景构造或发出的请求对象；变量 `req` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const req = <P>(payload: P): RpcRequest<P> => ({ rpcId: RpcId(`t-${reqCount++}`), payload })

describe('createFixtureApi commands/skills', () => {
  it('serves the addressed session catalog', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `{ rpc }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { rpc } = createFixtureFaces()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `commands` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const commands = await callRemote<{ name: string; input?: { hint: string; images?: boolean } }[]>(
      rpc, 'commands/list', { agentId: sid('fx-alpha') })
    expect(commands.map(c => c.name)).toEqual(['compact', 'echo', 'goal', 'permission', 'plan'])
    // input hint rides only the commands declaring it.
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `echo` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const echo = commands.find(c => c.name === 'echo')
    expect(echo?.input?.hint).toBeTruthy()
    expect(commands.find(c => c.name === 'compact')?.input).toBeUndefined()
    // Image acceptance is declared per descriptor; only goal and plan carry it.
    expect(commands.filter(c => c.input?.images === true).map(c => c.name)).toEqual(['goal', 'plan'])
  })

  it('rejects a catalog request for an unknown session', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `{ rpc }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { rpc } = createFixtureFaces()
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `result` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const result = await rpc.call('/api', 'commands/list', { args: { agentId: sid('fx-nope') } })
    expect(result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('executes a known command line: pure admission plus a mux-broadcast lifecycle pair', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `{ api, rpc }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { api, rpc } = createFixtureFaces()
    /** 中文说明：当前场景输入、传输或校验的数据；变量 `frames` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const frames: unknown[] = []
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `abort` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `stream` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const stream = api.events.mux(req({}), abort.signal)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `pump` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const pump = (async () => {
      /** 中文说明：当前场景输入、传输或校验的数据；变量 `frame` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for await (const frame of stream) {
        frames.push(frame.payload)
        if (frames.filter(f => (f as { type: string }).type === 'session/event').length >= 2) abort.abort()
      }
    })()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `execution` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const execution = await callRemote<{ commandId: string } | undefined>(
      rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/echo hello world' })
    expect(execution?.commandId).toBeTruthy()
    await pump
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `events` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const events = frames
      .filter((f): f is { type: string; event: { type: string; data: Record<string, unknown> } } => (f as { type: string }).type === 'session/event')
      .map(f => f.event)
    expect(events).toMatchObject([
      { type: 'command/run', data: { name: 'echo', args: ' hello world', source: { kind: 'user' } } },
      { type: 'command/done', data: { kind: 'success', text: 'hello world' } },
    ])
    expect(events[0]?.data.commandId).toBe(events[1]?.data.commandId)
  })

  it('addresses execute to the session; an unknown session errs', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `{ rpc }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { rpc } = createFixtureFaces()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `hit` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const hit = await callRemote<{ commandId: string } | undefined>(
      rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/goal ship' })
    expect(hit?.commandId).toBeTruthy()

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `missing` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const missing = await rpc.call('/api', 'commands/execute', {
      args: { agentId: sid('fx-nope'), line: '/goal ship' },
    })
    expect(missing).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('refuses an image-carrying execute for a non-declaring command with a logged error pair', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `{ api, rpc }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { api, rpc } = createFixtureFaces()
    /** 中文说明：当前场景输入、传输或校验的数据；变量 `frames` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const frames: unknown[] = []
    /** 中文说明：控制或记录异步操作取消状态的对象；变量 `abort` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const abort = new AbortController()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `stream` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const stream = api.events.mux(req({}), abort.signal)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `pump` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const pump = (async () => {
      /** 中文说明：当前场景输入、传输或校验的数据；变量 `frame` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for await (const frame of stream) {
        frames.push(frame.payload)
        if (frames.filter(f => (f as { type: string }).type === 'session/event').length >= 2) abort.abort()
      }
    })()
    /** 中文说明：当前场景输入、传输或校验的数据；变量 `png` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const png = { mediaType: 'image/png', data: 'AA==' }
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `refused` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const refused = await callRemote<{ commandId: string; result: { kind: string; text?: string } } | undefined>(
      rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/echo hi', images: [png] })
    expect(refused?.commandId).toBeTruthy()
    expect(refused?.result).toEqual({ kind: 'error', text: '/echo does not accept image attachments' })
    await pump
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `events` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const events = frames
      .filter((f): f is { type: string; event: { type: string; data: Record<string, unknown> } } => (f as { type: string }).type === 'session/event')
      .map(f => f.event)
    expect(events).toMatchObject([
      { type: 'command/run', data: { name: 'echo', args: ' hi', source: { kind: 'user' } } },
      { type: 'command/done', data: { kind: 'error', text: '/echo does not accept image attachments' } },
    ])
  })

  it('a declaring command accepts an image-carrying execute', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `{ rpc }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { rpc } = createFixtureFaces()
    /** 中文说明：当前场景输入、传输或校验的数据；变量 `png` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const png = { mediaType: 'image/png', data: 'AA==' }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `accepted` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const accepted = await callRemote<{ result: { kind: string } } | undefined>(
      rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/goal ship it', images: [png] })
    expect(accepted?.result.kind).toBe('success')
    /** 中文说明：当前场景输入、传输或校验的数据；变量 `planMessage` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const planMessage = await callRemote<{ result: { kind: string } } | undefined>(
      rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/plan sketch the layout', images: [png] })
    expect(planMessage?.result.kind).toBe('success')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `imageOnlyPlan` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const imageOnlyPlan = await callRemote<{ result: { kind: string } } | undefined>(
      rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/plan', images: [png] })
    expect(imageOnlyPlan?.result.kind).toBe('success')
  })

  it('mirrors the producer grammar rejections for control-only declaring lines', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `{ rpc }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { rpc } = createFixtureFaces()
    /** 中文说明：当前场景输入、传输或校验的数据；变量 `png` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const png = { mediaType: 'image/png', data: 'AA==' }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `bareGoal` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const bareGoal = await callRemote<{ result: { kind: string; text?: string } } | undefined>(
      rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/goal', images: [png] })
    expect(bareGoal?.result).toEqual({
      kind: 'error',
      text: 'Image attachments only accompany a goal objective: /goal <objective> or /goal edit <objective>.',
    })
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `refused` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const refused = await callRemote<{ result: { kind: string; text?: string } } | undefined>(
      rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/plan off', images: [png] })
    expect(refused?.result).toEqual({
      kind: 'error',
      text: 'Image attachments cannot accompany /plan off.',
    })
  })

  it('answers no execution for an unknown name even when images accompany it', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `{ rpc }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { rpc } = createFixtureFaces()
    /** 中文说明：当前场景输入、传输或校验的数据；变量 `png` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const png = { mediaType: 'image/png', data: 'AA==' }
    expect(await callRemote(rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/nope', images: [png] }))
      .toBeUndefined()
  })

  it('answers no execution for unknown names and non-command lines', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `{ rpc }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { rpc } = createFixtureFaces()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `line` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const line of ['/nope', 'plain text', '/']) {
      // Absence is the whole answer: nothing matched, so no lifecycle id exists.
      expect(await callRemote(rpc, 'commands/execute', { agentId: sid('fx-alpha'), line }))
        .toBeUndefined()
    }
  })

  it('serves the skill catalog for the addressed session and rejects unknown sessions', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `api` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const api = createFixtureApi()
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `response` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const response = await api.skills.list(req({ sessionId: sid('fx-alpha') }))
    if (!response.result.ok) throw new Error('skill list failed')
    expect(response.result.value.skills[0]?.name).toBe('fixture-demo')

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `missingSession` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const missingSession = await api.skills.list(req({ sessionId: sid('fx-nope') }))
    expect(missingSession.result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })
})

describe('FixtureApiClient command/skill dispatch', () => {
  it('routes the Remote commands face and the legacy skill row through one state graph', async () => {
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `client` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const client = new FixtureApiClient()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `commands` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const commands = await callRemote<{ name: string }[]>(client.rpc, 'commands/list', { agentId: sid('fx-alpha') })
    expect(commands.length).toBeGreaterThan(0)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `executed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const executed = await callRemote<{ commandId: string } | undefined>(
      client.rpc, 'commands/execute', { agentId: sid('fx-alpha'), line: '/compact' })
    expect(executed?.commandId).toBeTruthy()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `skills` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const skills = await client.skills.list({ sessionId: sid('fx-alpha') })
    if (!skills.result.ok) throw new Error('skill.list failed')
    expect(skills.result.value.skills.length).toBeGreaterThan(0)
  })
})
