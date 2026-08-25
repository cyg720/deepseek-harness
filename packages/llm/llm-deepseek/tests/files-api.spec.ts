/**
 * 文件职责：验证DeepSeek LLM的 files-api.spec.ts 行为与网络边界。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：构造请求或模拟服务器，驱动适配器并断言事件与错误。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */
import { describe, expect, it, vi } from 'vitest'
import { userAgent } from '@deepseek-ai/dsh-llm'
import { DeepSeekFileId } from '../src/file-id.ts'
import {
  DeepSeekFilesClient,
  DeepSeekFilesError,
  isFilesQuotaError,
  MAX_FILE_UPLOAD_BYTES,
} from '../src/files-api.ts'

/** 中文说明：函数 requestUrl 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** 中文说明：函数 file 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function file(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-api-one',
    object: 'file',
    bytes: 3,
    created_at: 1_700_000_000,
    filename: 'image.png',
    purpose: 'user_data',
    expires_at: 1_700_604_800,
    ...overrides,
  }
}

describe('DeepSeekFilesClient', () => {
  it('uploads multipart bytes with the required purpose and explicit expiry', async () => {
    /** 中文说明：测试局部值 fetchImpl，由紧邻初始化决定。 */
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(requestUrl(url)).toBe('https://api.deepseek.com/files')
      expect(init?.method).toBe('POST')
      /** 中文说明：测试局部值 headers，由紧邻初始化决定。 */
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer key')
      expect(headers.get('user-agent')).toBe(userAgent())
      /** 中文说明：测试局部值 form，由紧邻初始化决定。 */
      const form = init?.body
      expect(form).toBeInstanceOf(FormData)
      if (!(form instanceof FormData)) throw new Error('expected multipart body')
      expect(form.get('purpose')).toBe('user_data')
      expect(form.get('expires_after[anchor]')).toBe('created_at')
      expect(form.get('expires_after[seconds]')).toBe('604800')
      /** 中文说明：测试局部值 blob，由紧邻初始化决定。 */
      const blob = form.get('file')
      expect(blob).toBeInstanceOf(Blob)
      expect((blob as Blob).size).toBe(3)
      return new Response(JSON.stringify(file()), { status: 200 })
    }) as typeof fetch
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({ baseURL: 'https://api.deepseek.com/', apiKey: 'key', fetch: fetchImpl })

    await expect(client.upload({
      data: Uint8Array.of(1, 2, 3),
      mediaType: 'image/png',
      filename: 'image.png',
      expiresAfterSeconds: 604_800,
    })).resolves.toEqual({
      id: DeepSeekFileId('file-api-one'),
      bytes: 3,
      createdAt: 1_700_000_000,
      filename: 'image.png',
      purpose: 'user_data',
      expiresAt: 1_700_604_800,
    })
  })

  it('validates list, retrieve, and delete responses', async () => {
    /** 中文说明：测试局部值 fetchImpl，由紧邻初始化决定。 */
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      /** 中文说明：测试局部值 target，由紧邻初始化决定。 */
      const target = requestUrl(url)
      if (target.includes('?')) {
        return new Response(JSON.stringify({
          object: 'list', data: [file()], first_id: 'file-api-one', last_id: 'file-api-one', has_more: false,
        }), { status: 200 })
      }
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify({ id: 'file-api-one', object: 'file', deleted: true }), { status: 200 })
      }
      return new Response(JSON.stringify(file()), { status: 200 })
    }) as typeof fetch
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({ baseURL: 'https://api.deepseek.com', apiKey: 'key', fetch: fetchImpl })

    await expect(client.list({ after: DeepSeekFileId('file-api-before'), limit: 20, order: 'desc' })).resolves.toMatchObject({
      data: [{ id: 'file-api-one' }], firstId: 'file-api-one', lastId: 'file-api-one', hasMore: false,
    })
    await expect(client.retrieve(DeepSeekFileId('file-api-one'))).resolves.toMatchObject({ id: 'file-api-one' })
    await expect(client.delete(DeepSeekFileId('file-api-one'))).resolves.toBeUndefined()
  })

  it('refuses an upload response that omits the requested expiry', async () => {
    /** 中文说明：测试局部值 fetchImpl，由紧邻初始化决定。 */
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify(file({ expires_at: undefined })),
      { status: 200 },
    ))) as typeof fetch
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({ baseURL: 'https://api.deepseek.com', apiKey: 'key', fetch: fetchImpl })

    await expect(client.upload({
      data: Uint8Array.of(1), mediaType: 'image/png', filename: 'image.png', expiresAfterSeconds: 3_600,
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('retains quota error detail for the one cleanup retry policy', async () => {
    /** 中文说明：测试局部值 fetchImpl，由紧邻初始化决定。 */
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: { message: 'user storage quota exceeded', type: 'invalid_request_error', code: 'file_quota' },
    }), { status: 400 }))) as typeof fetch
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({ baseURL: 'https://api.deepseek.com', apiKey: 'key', fetch: fetchImpl })

    /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
    const error = await client.upload({
      data: Uint8Array.of(1), mediaType: 'image/png', filename: 'image.png', expiresAfterSeconds: 3_600,
    }).catch((caught: unknown) => caught)
    expect(isFilesQuotaError(error)).toBe(true)
    expect(isFilesQuotaError(new Error('storage quota'))).toBe(false)
  })

  it.each([
    [401, 'AUTH'],
    [403, 'AUTH'],
    [429, 'RATE_LIMIT'],
    [500, 'SERVER'],
    [400, 'FILES_API'],
  ] as const)('classifies HTTP %i Files failures as %s', async (status, code) => {
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'key',
      fetch: vi.fn(() => Promise.resolve(new Response('not-json', { status }))),
    })
    await expect(client.retrieve(DeepSeekFileId('missing'))).rejects.toMatchObject({
      name: 'DeepSeekFilesError',
      code,
      detail: '',
    })
  })

  it.each([
    null,
    [],
    {},
    { error: null },
    { error: [] },
    { error: { message: 1, type: 2, code: 3 } },
  ])('falls back to the HTTP status for an unstructured provider error %#', async (body) => {
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'key',
      fetch: vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 400 }))),
    })
    /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
    const error = await client.retrieve(DeepSeekFileId('missing')).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DeepSeekFilesError)
    expect(error).toMatchObject({ message: 'DeepSeek Files API error (HTTP 400)', detail: '' })
  })

  it('wraps transport failures but preserves an aborted request reason', async () => {
    /** 中文说明：测试局部值 transport，由紧邻初始化决定。 */
    const transport = new Error('socket closed')
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'key',
      fetch: vi.fn(() => Promise.reject(transport)),
    })
    await expect(client.retrieve(DeepSeekFileId('one'))).rejects.toMatchObject({
      code: 'TRANSPORT',
      cause: transport,
    })

    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 reason，由紧邻初始化决定。 */
    const reason = new Error('cancelled')
    controller.abort(reason)
    await expect(client.retrieve(DeepSeekFileId('one'), controller.signal)).rejects.toBe(transport)
  })

  it.each([
    null,
    [],
    file({ id: 1 }),
    file({ id: '' }),
    file({ object: 'wrong' }),
    file({ bytes: 1.5 }),
    file({ bytes: -1 }),
    file({ created_at: 1.5 }),
    file({ created_at: -1 }),
    file({ filename: 1 }),
    file({ filename: '' }),
    file({ purpose: 'assistants' }),
    file({ expires_at: 1.5 }),
    file({ expires_at: -1 }),
  ])('rejects an invalid file object %#', async (body) => {
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'key',
      fetch: vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
    })
    await expect(client.retrieve(DeepSeekFileId('one'))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it.each([
    3_599,
    2_592_001,
    3_600.5,
  ])('refuses invalid file expiry %s before transport', async (expiresAfterSeconds) => {
    /** 中文说明：测试局部值 fetchImpl，由紧邻初始化决定。 */
    const fetchImpl = vi.fn() as typeof fetch
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({ baseURL: 'https://api.deepseek.com', apiKey: 'key', fetch: fetchImpl })
    await expect(client.upload({
      data: Uint8Array.of(1), mediaType: 'image/png', filename: 'image.png', expiresAfterSeconds,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a file larger than the upload limit before transport', async () => {
    /** 中文说明：测试局部值 fetchImpl，由紧邻初始化决定。 */
    const fetchImpl = vi.fn() as typeof fetch
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({ baseURL: 'https://api.deepseek.com', apiKey: 'key', fetch: fetchImpl })
    /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
    const data = { byteLength: MAX_FILE_UPLOAD_BYTES + 1 } as Uint8Array
    await expect(client.upload({
      data, mediaType: 'image/png', filename: 'image.png', expiresAfterSeconds: 3_600,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    null,
    [],
    {},
    { object: 'wrong', data: [], has_more: false },
    { object: 'list', data: null, has_more: false },
    { object: 'list', data: [], has_more: 0 },
    { object: 'list', data: [], has_more: false, first_id: 1 },
    { object: 'list', data: [], has_more: false, last_id: 1 },
  ])('rejects an invalid list response %#', async (body) => {
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'key',
      fetch: vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
    })
    await expect(client.list()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('accepts a list without cursors and uses the global fetch default', async () => {
    /** 中文说明：测试局部值 fetchImpl，由紧邻初始化决定。 */
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      object: 'list', data: [], has_more: false,
    }), { status: 200 })))
    vi.stubGlobal('fetch', fetchImpl)
    try {
      /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
      const client = new DeepSeekFilesClient({ baseURL: 'https://api.deepseek.com///', apiKey: 'key' })
      await expect(client.list()).resolves.toEqual({ data: [], hasMore: false })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([
    null,
    [],
    {},
    { id: 'wrong', object: 'file', deleted: true },
    { id: 'file-api-one', object: 'wrong', deleted: true },
    { id: 'file-api-one', object: 'file', deleted: false },
  ])('rejects an invalid delete response %#', async (body) => {
    /** 中文说明：测试局部值 client，由紧邻初始化决定。 */
    const client = new DeepSeekFilesClient({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'key',
      fetch: vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
    })
    await expect(client.delete(DeepSeekFileId('file-api-one'))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
