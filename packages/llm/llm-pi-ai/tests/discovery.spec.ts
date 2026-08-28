/**
 * 文件职责：验证Pi AI LLM的 discovery.spec.ts 行为与网络边界。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：构造请求或模拟服务器，驱动适配器并断言事件与错误。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { userAgent } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { discoverModels } from '../src/discovery.ts'

/** 中文说明：测试局部值 servers，由紧邻初始化决定。 */
const servers: Server[] = []
/** Credential variables a test set, cleared so the next one starts unset. */
/* 中文说明：测试局部值 touchedEnv，由紧邻初始化决定。 */
const touchedEnv: string[] = []

afterEach(async () => {
  // A no-op when the test never stubbed `fetch`; only 'probe key format'
  // below installs one.
  vi.unstubAllGlobals()
  /** 中文说明：测试局部值 name，由紧邻初始化决定。 */
  for (const name of touchedEnv.splice(0)) Reflect.deleteProperty(process.env, name)
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

/** 中文说明：类型或类 ListingServer 约束模型请求、认证或流事件职责。 */
interface ListingServer {
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
}

/**
 * A stand-in provider that answers one scripted `GET /models`. `chunks` writes
 * without a declared length, which is how a real streamed reply arrives.
 */
/* 中文说明：函数 listingServer 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function listingServer(behavior: {
  status?: number
  body?: string
  chunks?: string[]
  holdOpenMs?: number
}): Promise<ListingServer> {
  /** 中文说明：测试局部值 paths，由紧邻初始化决定。 */
  const paths: string[] = []
  /** 中文说明：测试局部值 headers，由紧邻初始化决定。 */
  const headers: IncomingMessage['headers'][] = []
  /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    paths.push(request.url ?? '')
    headers.push(request.headers)
    if (behavior.chunks !== undefined) {
      // No declared length: the ceiling has to hold on what is read.
      response.writeHead(behavior.status ?? 200, { 'content-type': 'application/json' })
      /** 中文说明：测试局部值 chunk，由紧邻初始化决定。 */
      for (const chunk of behavior.chunks) response.write(chunk)
      if (behavior.holdOpenMs === undefined) { response.end(); return }
      // Left open so a caller's cancellation lands while the body is still
      // being read rather than after it completed.
      setTimeout(() => { response.end() }, behavior.holdOpenMs)
      return
    }
    /** 中文说明：测试局部值 body，由紧邻初始化决定。 */
    const body = behavior.body ?? '{}'
    response.writeHead(behavior.status ?? 200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  /** 中文说明：测试局部值 address，由紧邻初始化决定。 */
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers }
}

/** A bare dormant mount: discovery is offered whether or not a route exists. */
/* 中文说明：函数 harness 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function harness(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {})
  return ctx
}

describe('catalog-route model discovery', () => {
  it('answers from the installed registry, with capacities and no network call', async () => {
    /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'from-the-endpoint' }] }) })
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()

    /** 中文说明：测试局部值 models，由紧邻初始化决定。 */
    const models = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'deepseek', baseURL: server.url })

    // pi-ai's own registry is the authority for its own providers, and it
    // carries what a listing endpoint would not disclose.
    expect(models.map(model => model.id).sort())
      .toEqual(getBuiltinModels('deepseek').map(model => model.id).sort())
    expect(models.every(model => (model.contextWindow ?? 0) > 0 && (model.maxTokens ?? 0) > 0)).toBe(true)
    expect(server.paths).toEqual([])
  })

  it('needs no endpoint for a route the catalog describes', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'deepseek' })).resolves.not.toHaveLength(0)
  })

  it('says where a route the catalog does not describe must get its models', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'acme-gateway' }))
      .rejects.toThrow(/ships no catalog for provider "acme-gateway".*set a baseURL/s)
    // A form that cleared the field says the same thing as one that never had it.
    await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'acme-gateway', baseURL: '' }))
      .rejects.toThrow(/set a baseURL/)
    // The seam refuses a request naming neither, so the module's own guard for
    // that shape is only reachable by calling it directly.
    await expect(discoverModels({})).rejects.toThrow(/set a baseURL/)
  })
})

describe('draft-provider model discovery', () => {
  it('reads an OpenAI-compatible listing and keeps the capacities it discloses', async () => {
    /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          { id: 'acme-large', display_name: 'Acme Large', context_length: 65_536, max_output_tokens: 4096 },
          { id: 'acme-small' },
        ],
      }),
    })
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()

    /** 中文说明：测试局部值 models，由紧邻初始化决定。 */
    const models = await ctx.llm.discoverModels('llm-pi-ai', { baseURL: `${server.url}/v1`, apiKey: 'probe-key' })

    expect(models).toEqual([
      { id: 'acme-large', name: 'Acme Large', contextWindow: 65_536, maxTokens: 4096 },
      { id: 'acme-small' },
    ])
    expect(server.paths).toEqual(['/v1/models'])
    expect(server.headers[0]?.authorization).toBe('Bearer probe-key')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('keeps a deployment path instead of resolving it away', async () => {
    /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()

    await ctx.llm.discoverModels('llm-pi-ai', { baseURL: `${server.url}/openai/v1/` })

    expect(server.paths).toEqual(['/openai/v1/models'])
  })

  it('offers no credential when the draft names none', async () => {
    /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()

    await ctx.llm.discoverModels('llm-pi-ai', { baseURL: server.url })

    expect(server.headers[0]?.authorization).toBeUndefined()
  })

  it('authenticates a configured route the draft cannot supply a key for', async () => {
    // What the Models page actually sends after a key is saved: the form holds
    // the redacted descriptor, so the draft names the route and the endpoint
    // and no credential at all. Interrogating unauthenticated would answer 401
    // and read as a wrong key.
    /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'm' }] }) })
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    process.env['ACME_GATEWAY_KEY'] = 'stored-key'
    touchedEnv.push('ACME_GATEWAY_KEY')
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'ACME_GATEWAY_KEY',
          api: 'openai-completions',
          baseURL: server.url,
          models: [{ id: 'acme-large' }],
        },
      },
    })

    await ctx.llm.discoverModels('llm-pi-ai', { provider: 'acme-gateway', baseURL: server.url })
    // A key typed into the form is the one being tested — possibly the
    // replacement for the stored one — so it wins.
    await ctx.llm.discoverModels('llm-pi-ai', { provider: 'acme-gateway', baseURL: server.url, apiKey: 'typed' })
    // A route no profile declares yet is the create case: nothing is stored.
    await ctx.llm.discoverModels('llm-pi-ai', { provider: 'not-declared-yet', baseURL: server.url })

    expect(server.headers.map(headers => headers.authorization))
      .toEqual(['Bearer stored-key', 'Bearer typed', undefined])
  })

  it('leaves a catalog route\'s credential unresolved, having never reached the network', async () => {
    // The catalog answers before any endpoint is asked, so a route whose
    // profile names a credential that is not set must still answer rather than
    // failing over a key the interrogation never needed.
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    Reflect.deleteProperty(process.env, 'ABSENT_FOR_DISCOVERY')
    await ctx.plugin(LlmPiAi, { providers: { deepseek: { apiKeyEnv: 'ABSENT_FOR_DISCOVERY' } } })

    await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'deepseek' })).resolves.not.toHaveLength(0)
  })

  it('drops unusable rows rather than failing the whole listing', async () => {
    /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          { id: 'good' },
          { id: '' },
          { name: 'no id at all' },
          null,
          { id: 'good' },
          { id: 'zero-capacity', context_length: 0, max_tokens: -1 },
        ],
      }),
    })
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()

    expect(await ctx.llm.discoverModels('llm-pi-ai', { baseURL: server.url }))
      .toEqual([{ id: 'good' }, { id: 'zero-capacity' }])
  })

  it('points at the credential for a rejected one, and only then', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()

    /** 中文说明：测试局部值 status，由紧邻初始化决定。 */
    for (const status of [401, 403]) {
      /** 中文说明：测试局部值 refused，由紧邻初始化决定。 */
      const refused = await listingServer({ status, body: '{"error":"nope"}' })
      await expect(ctx.llm.discoverModels('llm-pi-ai', { baseURL: refused.url, apiKey: 'wrong' }))
        .rejects.toThrow(new RegExp(`answered ${status}; check the API key`))
    }

    // A server fault is not a credential problem, so it must not send the user
    // off to re-check a key that is fine.
    /** 中文说明：测试局部值 broken，由紧邻初始化决定。 */
    const broken = await listingServer({ status: 500, body: '{"error":"boom"}' })
    await expect(ctx.llm.discoverModels('llm-pi-ai', { baseURL: broken.url, apiKey: 'fine' }))
      .rejects.toThrow(/answered 500$/)
  })

  it('reports a reply that is not a model listing', async () => {
    /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
    const server = await listingServer({ body: '{"models":[]}' })
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()

    await expect(ctx.llm.discoverModels('llm-pi-ai', { baseURL: server.url }))
      .rejects.toThrow(/no "data" array; enter this provider's models by hand/)

    /** 中文说明：测试局部值 broken，由紧邻初始化决定。 */
    const broken = await listingServer({ body: 'not json at all' })
    await expect(ctx.llm.discoverModels('llm-pi-ai', { baseURL: broken.url }))
      .rejects.toThrow(/did not answer with JSON/)
  })

  it('refuses an oversized reply, whether its length is declared or streamed', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    // Just over the four-megabyte ceiling, as one padded model row.
    /** 中文说明：测试局部值 oversized，由紧邻初始化决定。 */
    const oversized = `{"data":[{"id":"m","pad":"${'x'.repeat(4 * 1024 * 1024)}"}]}`

    /** 中文说明：测试局部值 declared，由紧邻初始化决定。 */
    const declared = await listingServer({ body: oversized })
    await expect(ctx.llm.discoverModels('llm-pi-ai', { baseURL: declared.url }))
      .rejects.toThrow(/answered with more than 4194304 bytes/)

    // A streamed reply declares no length, so the ceiling has to hold on the
    // body the harness actually read.
    /** 中文说明：测试局部值 streamed，由紧邻初始化决定。 */
    const streamed = await listingServer({ chunks: ['{"data":[{"id":"m","pad":"', 'x'.repeat(4 * 1024 * 1024), '"}]}'] })
    await expect(ctx.llm.discoverModels('llm-pi-ai', { baseURL: streamed.url }))
      .rejects.toThrow(/answered with more than 4194304 bytes/)
  })

  it('reports an unreachable endpoint instead of an empty catalog', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    // Port 9 is the discard service: nothing accepts a connection there.
    await expect(ctx.llm.discoverModels('llm-pi-ai', { baseURL: 'http://127.0.0.1:9/v1' }))
      .rejects.toMatchObject({ code: 'DISCOVERY_FAILED' })
  })

  it.each(['anthropic-messages', 'azure-openai-responses', 'openai-codex-responses', 'google-generative-ai'])(
    'says it cannot interrogate %s rather than guessing a shape',
    async (api) => {
      // Azure authenticates with an `api-key` header and an `api-version`
      // query despite its OpenAI lineage, and Codex uses OAuth; guessing at
      // either would report an auth failure as a provider with no models.
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await harness()
      await expect(ctx.llm.discoverModels('llm-pi-ai', { baseURL: 'https://gateway.example/v1', api }))
        .rejects.toMatchObject({ code: 'DISCOVERY_UNSUPPORTED' })
    },
  )

  it('reports cancellation during the body read as an abort, not a raw reason', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 bodyRead，由紧邻初始化决定。 */
    const bodyRead = Promise.withResolvers<undefined>()
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('expected a discovery signal')
      return new Response(new ReadableStream<Uint8Array>({
        pull(stream) {
          bodyRead.resolve(undefined)
          return new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              stream.error(signal.reason)
              resolve()
            }, { once: true })
          })
        },
      }))
    })
    /** 中文说明：测试局部值 probe，由紧邻初始化决定。 */
    const probe = ctx.llm.discoverModels('llm-pi-ai', {
      baseURL: 'https://slow.example/v1',
    }, controller.signal)
    await bodyRead.promise
    controller.abort('test cancellation')

    await expect(probe).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('honors caller cancellation', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 aborted，由紧邻初始化决定。 */
    const aborted = AbortSignal.abort('test cancellation')
    await expect(ctx.llm.discoverModels('llm-pi-ai', {
      baseURL: 'http://127.0.0.1:9/v1',
    }, aborted)).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('is offered for the namespace, and refuses one it does not serve', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()

    await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'openai' })).resolves.not.toHaveLength(0)
    await expect(ctx.llm.discoverModels('llm-deepseek', { baseURL: 'https://api.deepseek.com' }))
      .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
    await expect(ctx.llm.discoverModels('llm-pi-ai', { baseURL: '' }))
      .rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })
  })

  it('withdraws the offer when the plugin unloads', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(LlmPiAi, {})
    await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'openai' })).resolves.not.toHaveLength(0)

    await fiber.dispose()

    await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'openai' }))
      .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
  })
})

describe('probe key format', () => {
  it('reports an illegal probe key as a credential fault, not an unreachable endpoint', async () => {
    await expect(discoverModels({
      baseURL: 'https://acme.test',
      api: 'openai-completions',
      apiKey: 'sk-\u{1F600}',
    })).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it('reports a blank probe key as a credential fault too', async () => {
    // The Models page omits `apiKey` entirely for a cleared field rather than
    // sending '', so this pins the contract for every other caller: a supplied
    // key is judged, and only an absent one probes unauthenticated. '' means
    // "I have a key" and is answered as the empty key it is.
    await expect(discoverModels({
      baseURL: 'https://acme.test',
      api: 'openai-completions',
      apiKey: '',
    })).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it('leaves a probe with no key unauthenticated', async () => {
    // The file's other cases capture headers through a real local HTTP server
    // (`listingServer`); this one has no route or stored key to resolve, so
    // the smallest real double is a `fetch` stub, scoped to this test and
    // unstubbed by the shared `afterEach` above.
    /** 中文说明：测试局部值 requests，由紧邻初始化决定。 */
    const requests: RequestInit[] = []
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      requests.push(init ?? {})
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    await discoverModels({ baseURL: 'https://acme.test', api: 'openai-completions' })

    /** 中文说明：测试局部值 headers，由紧邻初始化决定。 */
    const headers = new Headers(requests[0]?.headers)
    expect(headers.has('authorization')).toBe(false)
  })
})
