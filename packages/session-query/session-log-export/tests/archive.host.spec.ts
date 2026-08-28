/**
 * session.export host path: the GET download endpoint streams a ZIP whose
 * files are the stored artifacts verbatim (root + optional descendants), and
 * the degenerate compositions fail loudly (missing services → 500, missing
 * root → 404, missing descendant → errored stream).
 */
/*
 * 文件职责：验证Host API Proxy的 session-export.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { unzipSync, strFromU8 } from 'fflate'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionLineageNode } from '@deepseek-ai/dsh-session-query'
import type { SessionRawArtifact } from '@deepseek-ai/dsh-session-persistence'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import * as SessionLogExport from '../src/index.ts'

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (id: string): SessionId => id as SessionId

/** 中文说明：函数 header 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function header(id: string, parentSession?: SessionId): SessionHeader {
  return {
    version: 0,
    id: sid(id),
    createdAt: 1000,
    cwd: '/proj',
    ...parentSession === undefined ? {} : { parentSession },
    delegationDepth: parentSession === undefined ? 0 : 1,
  }
}

/** 中文说明：函数 artifact 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function artifact(id: string, parentSession?: SessionId, content?: string): SessionRawArtifact {
  return {
    meta: header(id, parentSession),
    filename: 'session.jsonl',
    content: content ?? `{"type":"session","version":0,"id":"${id}","createdAt":1000}\n{"type":"turn/start","seq":0,"time":2000,"data":{"turn":1}}\n`,
  }
}

/** 中文说明：函数 node 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function node(id: string, ...descendants: SessionLineageNode[]): SessionLineageNode {
  return { session: { header: header(id, sid('session-root')), live: false, persisted: true }, descendants }
}

/** One durable image object served by the fake attachment store. */
/* 中文说明：函数 storedImage 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function storedImage(id: string, mediaType: ImageAttachmentRef['mediaType'] = 'image/png') {
  return {
    ref: { attachmentId: sid(id), mediaType, bytes: 4, width: 2, height: 2 } as unknown as ImageAttachmentRef,
    data: new Uint8Array([1, 2, 3, 4]),
  }
}

/** A user/message event line carrying one image reference. */
/* 中文说明：函数 imageEventLine 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function imageEventLine(id: string, mediaType: ImageAttachmentRef['mediaType'] = 'image/png'): string {
  return `{"type":"user/message","seq":1,"time":1000,"data":{"content":[{"type":"image","attachment":{"attachmentId":"${id}","mediaType":"${mediaType}","bytes":4,"width":2,"height":2}}]}}`
}

/** 中文说明：函数 buildApi 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function buildApi(
  artifacts: Record<string, SessionRawArtifact>,
  descendants: SessionLineageNode[] = [],
  services: {
    query?: boolean
    persistence?: boolean | 'throw' | 'unsupported'
    attachments?: boolean | ((ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<ReturnType<typeof storedImage>>)
    sessions?: {
      get(id: SessionId): { readonly id: SessionId } | undefined
      flush(session: { readonly id: SessionId }): Promise<boolean>
    }
    readRaw?: (id: SessionId, signal?: AbortSignal) => Promise<SessionRawArtifact | undefined>
    traceSession?: (id: SessionId, signal?: AbortSignal) => Promise<{
      target: { header: SessionHeader; live: boolean; persisted: boolean }
      ancestors: readonly SessionLineageNode[]
      complete: boolean
      root: { header: SessionHeader; live: boolean; persisted: boolean }
      descendants: readonly SessionLineageNode[]
    }>
    compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  } = {},
) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  ctx.provide('commands', { register: () => () => {} } as never)
  const query = services.query ?? true
  /** 中文说明：测试局部值 persistence，由紧邻初始化决定。 */
  const persistence = services.persistence ?? true
  if (query) {
    ctx.provide('sessionQuery', {
      traceSession: services.traceSession ?? (async () => ({
        target: { header: header('session-root'), live: false, persisted: true },
        ancestors: [],
        complete: true,
        root: { header: header('session-root'), live: false, persisted: true },
        descendants,
      })),
    } as never)
  }
  if (persistence) {
    ctx.provide('sessionPersistence', {
      supportsRawArtifacts: persistence !== 'unsupported',
      readRaw: services.readRaw ?? (async (id: SessionId) => {
        if (persistence === 'throw') throw new Error('/host/private/session.jsonl')
        return artifacts[id]
      }),
    } as never)
  }
  if (services.attachments !== false) {
    /** 中文说明：测试局部值 readImage，由紧邻初始化决定。 */
    const readImage = typeof services.attachments === 'function'
      ? services.attachments
      : async (ref: ImageAttachmentRef) => storedImage(String(ref.attachmentId), ref.mediaType)
    ctx.provide('attachments', {
      imageLimits: {} as never,
      validateImage: async () => {},
      saveImage: async () => { throw new Error('export never saves images') },
      readImage,
    } as never)
  }
  if (services.sessions !== undefined) ctx.provide('sessions', services.sessions as never)
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const fiber = ctx.plugin(SessionLogExport, {
    ...services.compressionLevel === undefined
      ? {}
      : { compressionLevel: services.compressionLevel },
  })
  await fiber.await()
  const handler = connection.createSharedFetchHandler('/api')
  return {
    fetch: handler,
    downloads: {
      sessionLog: (
        request: { sessionId: SessionId; includeDescendants: boolean },
        signal: AbortSignal,
      ): Promise<Response> => {
        const url = new URL(`http://host${SessionLogExport.SESSION_LOG_EXPORT_PATH}`)
        url.searchParams.set('sessionId', request.sessionId)
        url.searchParams.set('includeDescendants', String(request.includeDescendants))
        return handler.fetch(new Request(url, { signal }))
      },
    },
  }
}

function toFetchHandler(api: Awaited<ReturnType<typeof buildApi>>): { fetch(request: Request): Promise<Response> } {
  return api.fetch
}

/** 中文说明：函数 responseBytes 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function responseBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer())
}

describe('session export compression config', () => {
  it('defaults to level 6 and rejects values outside the integer 0-9 range', () => {
    expect(SessionLogExport.Config({})).toEqual({
      compressionLevel: 6,
    })
    expect(SessionLogExport.Config({ compressionLevel: 0 }))
      .toEqual({ compressionLevel: 0 })
    expect(SessionLogExport.Config({ compressionLevel: 9 }))
      .toEqual({ compressionLevel: 9 })
    for (const value of [-1, 10, 1.5]) {
      expect(() => SessionLogExport.Config({ compressionLevel: value } as never)).toThrow()
    }
  })
})

describe('session.export download endpoint', () => {
  it('streams a ZIP with the root artifact verbatim under its original filename', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': artifact('session-root') })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toContain('dsh-session-session-root.zip')
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files)).toEqual(['session.jsonl'])
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe(artifact('session-root').content)
  })

  it('preflights root preparation through HEAD without streaming a body', async () => {
    /** 中文说明：测试局部值 readRaw，由紧邻初始化决定。 */
    const readRaw = vi.fn(async () => artifact('session-root'))
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({}, [], { readRaw })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root', { method: 'HEAD' }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toContain('dsh-session-session-root.zip')
    expect(response.body).toBeNull()
    expect(readRaw).toHaveBeenCalledOnce()
  })

  it('returns a bodyless preparation error from HEAD', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({})
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root', { method: 'HEAD' }),
    )

    expect(response.status).toBe(404)
    expect(response.body).toBeNull()
  })

  it('uses the resolved compression level for ZIP entries', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = artifact('session-root', undefined, 'compressible\n'.repeat(32 * 1024))
    /** 中文说明：测试局部值 storedApi，由紧邻初始化决定。 */
    const storedApi = await buildApi({ 'session-root': root }, [], { compressionLevel: 0 })
    /** 中文说明：测试局部值 compressedApi，由紧邻初始化决定。 */
    const compressedApi = await buildApi({ 'session-root': root }, [], { compressionLevel: 9 })
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored = await storedApi.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: false },
      new AbortController().signal,
    )
    /** 中文说明：测试局部值 compressed，由紧邻初始化决定。 */
    const compressed = await compressedApi.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: false },
      new AbortController().signal,
    )
    /** 中文说明：测试局部值 storedBytes，由紧邻初始化决定。 */
    const storedBytes = await responseBytes(stored)
    /** 中文说明：测试局部值 compressedBytes，由紧邻初始化决定。 */
    const compressedBytes = await responseBytes(compressed)
    expect(compressedBytes.byteLength).toBeLessThan(storedBytes.byteLength)
    expect(strFromU8(unzipSync(compressedBytes)['session.jsonl'] as Uint8Array)).toBe(root.content)
  })

  it('includes descendant artifacts under subagents/<id>/ when requested', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({
      'session-root': artifact('session-root'),
      'child-a': artifact('child-a', sid('session-root')),
      'grandchild-a': artifact('grandchild-a', sid('child-a')),
    }, [
      node('child-a', node('grandchild-a')),
    ])
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    expect(response.status).toBe(200)
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files).sort()).toEqual([
      'session.jsonl',
      'subagents/child-a/session.jsonl',
      'subagents/grandchild-a/session.jsonl',
    ])
    expect(strFromU8(files['subagents/child-a/session.jsonl'] as Uint8Array))
      .toBe(artifact('child-a').content)
  })

  it('flushes each live root and descendant immediately before reading its artifact', async () => {
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored: Record<string, SessionRawArtifact> = {
      'session-root': artifact('session-root', undefined, 'stale root'),
      'child-a': artifact('child-a', sid('session-root'), 'stale child'),
    }
    /** 中文说明：测试局部值 durable，由紧邻初始化决定。 */
    const durable: Record<string, SessionRawArtifact> = {
      'session-root': artifact('session-root', undefined, 'durable root'),
      'child-a': artifact('child-a', sid('session-root'), 'durable child'),
    }
    /** 中文说明：测试局部值 flushed，由紧邻初始化决定。 */
    const flushed: SessionId[] = []
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi(stored, [node('child-a')], {
      sessions: {
        get: id => durable[id] === undefined ? undefined : { id },
        flush: async (session) => {
          /** 中文说明：测试局部值 artifactAfterFlush，由紧邻初始化决定。 */
          const artifactAfterFlush = durable[session.id]
          if (artifactAfterFlush === undefined) throw new Error('unexpected session')
          flushed.push(session.id)
          stored[session.id] = artifactAfterFlush
          return true
        },
      },
    })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(flushed).toEqual([sid('session-root'), sid('child-a')])
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe('durable root')
    expect(strFromU8(files['subagents/child-a/session.jsonl'] as Uint8Array)).toBe('durable child')
  })

  it('reads a cold artifact without asking the live-session store to flush', async () => {
    /** 中文说明：测试局部值 flush，由紧邻初始化决定。 */
    const flush = vi.fn(async () => true)
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = artifact('session-root')
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': root }, [], {
      sessions: {
        get: () => undefined,
        flush,
      },
    })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: false },
      new AbortController().signal,
    )
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(flush).not.toHaveBeenCalled()
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe(root.content)
  })

  it('answers 404 for a missing root session', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({})
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(404)
  })

  it('answers 501 when the persistence backend has no per-session raw artifacts', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({}, [], { persistence: 'unsupported' })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(501)
    expect(await response.text()).toContain('does not expose per-session raw artifacts')
  })

  it('answers 400 when the sessionId query parameter is absent', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': artifact('session-root') })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?includeDescendants=true'),
    )
    expect(response.status).toBe(400)
  })

  it('answers 400 for an includeDescendants value other than true or false', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': artifact('session-root') })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=1'),
    )
    expect(response.status).toBe(400)
  })

  it('answers 500 when the deployment mounts no persistence or session-query service', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({}, [], { query: false, persistence: false })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('session-query')
  })

  it('fails the whole export when a descendant has no stored artifact', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({
      'session-root': artifact('session-root'),
    }, [node('child-missing')])
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    expect(response.status).toBe(200)
    // The stream errors before completing, so the body read rejects rather
    // than returning a truncated-but-valid archive.
    await expect(response.arrayBuffer()).rejects.toThrow()
  })

  it('keeps an astral character whole when its surrogate pair straddles a push boundary', async () => {
    // The push loop slices by 2^16 code units and must back off one unit when
    // the boundary lands inside a surrogate pair; otherwise the pair re-encodes
    // as U+FFFD and the exported artifact is silently corrupted.
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = { ...artifact('session-root'), content: `${'a'.repeat((1 << 16) - 1)}😀tail` }
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': root })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe(root.content)
  })

  it('splits a long artifact on a plain code-unit boundary without backoff', async () => {
    // A boundary that lands on a BMP character needs no surrogate backoff; the
    // round trip must still be byte-identical across the multi-chunk push.
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = { ...artifact('session-root'), content: 'z'.repeat((1 << 16) + 4096) }
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': root })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe(root.content)
  })

  it('waits for response pull capacity before reading the next archive entry', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = artifact('session-root', undefined, [
      imageEventLine('after-root'),
      randomBytes(512 * 1024).toString('base64'),
    ].join('\n'))
    /** 中文说明：测试局部值 imageReads，由紧邻初始化决定。 */
    let imageReads = 0
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': root }, [], {
      attachments: async (ref) => {
        imageReads += 1
        return storedImage(String(ref.attachmentId), ref.mediaType)
      },
    })
    vi.useFakeTimers()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let response: Response | undefined
    try {
      response = await toFetchHandler(api).fetch(
        new Request('http://host/api/session.export?sessionId=session-root'),
      )
      // Exhausting timer turns must not advance a producer whose byte queue is
      // full; only a consumer pull can release it.
      await vi.runAllTimersAsync()
      expect(imageReads).toBe(0)
    } finally {
      vi.useRealTimers()
    }
    if (response === undefined) throw new Error('missing export response')
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(imageReads).toBe(1)
    expect(files['media/after-root.png']).toEqual(storedImage('after-root').data)
  })

  it('exports an empty artifact as an empty zip entry', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = { ...artifact('session-root'), content: '' }
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': root })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files)).toEqual(['session.jsonl'])
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toBe('')
  })

  it('exports a shared lineage node once (seen-set dedup)', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({
      'session-root': artifact('session-root'),
      'child-a': artifact('child-a', sid('session-root')),
      'child-b': artifact('child-b', sid('session-root')),
      shared: artifact('shared', sid('child-a')),
    }, [
      node('child-a', node('shared')),
      node('child-b', node('shared')),
    ])
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files).sort()).toEqual([
      'session.jsonl',
      'subagents/child-a/session.jsonl',
      'subagents/child-b/session.jsonl',
      'subagents/shared/session.jsonl',
    ])
  })

  it('answers 500 without leaking the backend error when the root artifact read fails', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({}, [], { query: true, persistence: 'throw' })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(500)
    /** 中文说明：测试局部值 body，由紧邻初始化决定。 */
    const body = await response.text()
    expect(body).toBe('session log export failed to prepare the stored artifact')
    expect(body).not.toContain('/host/private/')
  })

  it('answers the private-error-safe 500 when the live root flush fails', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': artifact('session-root') }, [], {
      sessions: {
        get: id => ({ id }),
        flush: async () => { throw new Error('/host/private/flush-state') },
      },
    })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(500)
    /** 中文说明：测试局部值 body，由紧邻初始化决定。 */
    const body = await response.text()
    expect(body).toBe('session log export failed to prepare the stored artifact')
    expect(body).not.toContain('/host/private/')
  })

  it('forwards one request signal through root, lineage, and descendant reads', async () => {
    /** 中文说明：测试局部值 reads，由紧邻初始化决定。 */
    const reads: Array<{ id: SessionId; signal: AbortSignal | undefined }> = []
    /** 中文说明：测试局部值 traces，由紧邻初始化决定。 */
    const traces: AbortSignal[] = []
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({}, [node('child-a')], {
      readRaw: async (id, signal) => {
        reads.push({ id, signal })
        return id === sid('session-root')
          ? artifact('session-root')
          : artifact('child-a', sid('session-root'))
      },
      traceSession: async (_id, signal) => {
        if (signal !== undefined) traces.push(signal)
        return {
          target: { header: header('session-root'), live: false, persisted: true },
          ancestors: [],
          complete: true,
          root: { header: header('session-root'), live: false, persisted: true },
          descendants: [node('child-a')],
        }
      },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: true },
      controller.signal,
    )
    await response.arrayBuffer()
    const rootSignal = reads[0]?.signal
    if (rootSignal === undefined) throw new Error('missing root signal')
    const producerSignal = traces[0]
    if (producerSignal === undefined) throw new Error('missing lineage signal')
    expect(reads[0]?.id).toBe(sid('session-root'))
    expect(reads[1]).toEqual({ id: sid('child-a'), signal: producerSignal })
    /** 中文说明：测试局部值 cancellation，由紧邻初始化决定。 */
    const cancellation = new Error('request cancelled after response')
    controller.abort(cancellation)
    expect(rootSignal.aborted).toBe(true)
    expect(rootSignal.reason).toBe(cancellation)
    expect(producerSignal.aborted).toBe(true)
    expect(producerSignal.reason).toBe(cancellation)
  })

  it('preserves request cancellation instead of translating it to HTTP 500', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': artifact('session-root') })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 cancellation，由紧邻初始化决定。 */
    const cancellation = new Error('request cancelled')
    controller.abort(cancellation)
    await expect(api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: false },
      controller.signal,
    )).rejects.toBe(cancellation)
  })

  it('aborts descendant work and terminates ZIP production when its reader cancels', async () => {
    /** 中文说明：测试局部值 reportDescendantStarted，由紧邻初始化决定。 */
    let reportDescendantStarted!: (signal: AbortSignal) => void
    /** 中文说明：测试局部值 descendantStarted，由紧邻初始化决定。 */
    const descendantStarted = new Promise<AbortSignal>((resolve) => {
      reportDescendantStarted = resolve
    })
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({}, [node('child-a')], {
      readRaw: async (id, signal) => {
        if (id === sid('session-root')) return artifact('session-root')
        if (signal === undefined) throw new Error('missing descendant signal')
        reportDescendantStarted(signal)
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error)
          }, { once: true })
        })
      },
    })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: true },
      new AbortController().signal,
    )
    /** 中文说明：测试局部值 reader，由紧邻初始化决定。 */
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('missing response body')
    /** 中文说明：测试局部值 descendantSignal，由紧邻初始化决定。 */
    const descendantSignal = await descendantStarted
    /** 中文说明：测试局部值 cancellation，由紧邻初始化决定。 */
    const cancellation = new Error('download consumer left')
    await reader.cancel(cancellation)
    expect(descendantSignal.aborted).toBe(true)
    expect(descendantSignal.reason).toBe(cancellation)
  })

  it('aborts attachment reads when its reader cancels', async () => {
    /** 中文说明：测试局部值 reportAttachmentStarted，由紧邻初始化决定。 */
    let reportAttachmentStarted!: (signal: AbortSignal) => void
    /** 中文说明：测试局部值 attachmentStarted，由紧邻初始化决定。 */
    const attachmentStarted = new Promise<AbortSignal>((resolve) => {
      reportAttachmentStarted = resolve
    })
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      imageEventLine('slow-img'),
    ].join('\n') + '\n')
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': root }, [], {
      attachments: async (_ref, signal) => {
        if (signal === undefined) throw new Error('missing attachment signal')
        reportAttachmentStarted(signal)
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error)
          }, { once: true })
        })
      },
    })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: false },
      new AbortController().signal,
    )
    /** 中文说明：测试局部值 reader，由紧邻初始化决定。 */
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('missing response body')
    /** 中文说明：测试局部值 attachmentSignal，由紧邻初始化决定。 */
    const attachmentSignal = await attachmentStarted
    /** 中文说明：测试局部值 cancellation，由紧邻初始化决定。 */
    const cancellation = new Error('download consumer left during attachment read')
    await reader.cancel(cancellation)
    expect(attachmentSignal.aborted).toBe(true)
    expect(attachmentSignal.reason).toBe(cancellation)
  })

  it('uses a stable Error reason when its reader cancels without one', async () => {
    /** 中文说明：测试局部值 reportDescendantStarted，由紧邻初始化决定。 */
    let reportDescendantStarted!: (signal: AbortSignal) => void
    /** 中文说明：测试局部值 descendantStarted，由紧邻初始化决定。 */
    const descendantStarted = new Promise<AbortSignal>((resolve) => {
      reportDescendantStarted = resolve
    })
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({}, [node('child-a')], {
      readRaw: async (id, signal) => {
        if (id === sid('session-root')) return artifact('session-root')
        if (signal === undefined) throw new Error('missing descendant signal')
        reportDescendantStarted(signal)
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error)
          }, { once: true })
        })
      },
    })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: true },
      new AbortController().signal,
    )
    /** 中文说明：测试局部值 reader，由紧邻初始化决定。 */
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('missing response body')
    /** 中文说明：测试局部值 descendantSignal，由紧邻初始化决定。 */
    const descendantSignal = await descendantStarted
    await reader.cancel()
    expect(descendantSignal.reason).toEqual(new Error('session log export stream cancelled'))
  })

  it('normalizes a non-Error descendant failure before erroring the stream', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({}, [node('child-a')], {
      readRaw: async (id) => {
        if (id === sid('session-root')) return artifact('session-root')
        throw 'descendant read failed'
      },
    })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await api.downloads.sessionLog(
      { sessionId: sid('session-root'), includeDescendants: true },
      new AbortController().signal,
    )
    await expect(response.arrayBuffer()).rejects.toEqual(new Error('descendant read failed'))
  })

  it('includes media objects referenced by the root log under media/<id>.<ext>', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      imageEventLine('img-1'),
    ].join('\n') + '\n')
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': root })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(200)
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files).sort()).toEqual(['media/img-1.png', 'session.jsonl'])
    expect(files['media/img-1.png']).toEqual(storedImage('img-1').data)
  })

  it('collects media referenced from nested tool results', async () => {
    /** 中文说明：测试局部值 nested，由紧邻初始化决定。 */
    const nested = '{"type":"assistant/message","seq":2,"time":2000,"data":{"content":[{"type":"tool-result","content":[{"type":"image","attachment":{"attachmentId":"nested-1","mediaType":"image/webp","bytes":4,"width":2,"height":2}}]}]}}'
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      nested,
    ].join('\n') + '\n')
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': root })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files).sort()).toEqual(['media/nested-1.webp', 'session.jsonl'])
  })

  it('scans the wrapped, inserted, and chunk carriers plus non-object content items', async () => {
    /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
    const block = (id: string, mediaType: string) =>
      `{"type":"image","attachment":{"attachmentId":"${id}","mediaType":"${mediaType}","bytes":4,"width":2,"height":2}}`
    /** 中文说明：测试局部值 wrapped，由紧邻初始化决定。 */
    const wrapped = `{"type":"assistant/message","seq":2,"time":2000,"data":{"message":{"role":"assistant","content":["noise",${block('wrapped-1', 'image/jpeg')}]}}}`
    /** 中文说明：测试局部值 inserted，由紧邻初始化决定。 */
    const inserted = `{"type":"context/inserted","seq":3,"time":3000,"data":{"inserted":[{"content":[${block('inserted-1', 'image/gif')}]}]}}`
    /** 中文说明：测试局部值 chunk，由紧邻初始化决定。 */
    const chunk = `{"type":"assistant/chunk","seq":4,"time":4000,"data":{"chunk":{"type":"block-end","block":${block('chunk-1', 'image/png')}}}}`
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      wrapped,
      inserted,
      chunk,
    ].join('\n') + '\n')
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': root })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(Object.keys(files).sort()).toEqual([
      'media/chunk-1.png',
      'media/inserted-1.gif',
      'media/wrapped-1.jpg',
      'session.jsonl',
    ])
  })

  it('deduplicates one media object referenced by several included logs', async () => {
    /** 中文说明：测试局部值 line，由紧邻初始化决定。 */
    const line = imageEventLine('shared-img')
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      line,
    ].join('\n') + '\n')
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = artifact('child-a', sid('session-root'), [
      '{"type":"session","version":0,"id":"child-a","createdAt":1000}',
      line,
    ].join('\n') + '\n')
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': root, 'child-a': child }, [node('child-a')])
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = unzipSync(await responseBytes(response))
    expect(files['media/shared-img.png']).toEqual(storedImage('shared-img').data)
    expect(Object.keys(files).filter(name => name.startsWith('media/'))).toEqual(['media/shared-img.png'])
  })

  it('includes descendant media only when descendants are requested', async () => {
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = artifact('child-a', sid('session-root'), [
      '{"type":"session","version":0,"id":"child-a","createdAt":1000}',
      imageEventLine('child-img'),
    ].join('\n') + '\n')
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': artifact('session-root'), 'child-a': child }, [node('child-a')])
    /** 中文说明：测试局部值 without，由紧邻初始化决定。 */
    const without = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(Object.keys(unzipSync(await responseBytes(without)))).toEqual(['session.jsonl'])
    /** 中文说明：测试局部值 withDescendants，由紧邻初始化决定。 */
    const withDescendants = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root&includeDescendants=true'),
    )
    expect(Object.keys(unzipSync(await responseBytes(withDescendants))).sort()).toEqual([
      'media/child-img.png',
      'session.jsonl',
      'subagents/child-a/session.jsonl',
    ])
  })

  it('fails the whole export when a referenced image cannot be read', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = artifact('session-root', undefined, [
      '{"type":"session","version":0,"id":"session-root","createdAt":1000}',
      imageEventLine('gone-img'),
    ].join('\n') + '\n')
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': root }, [], {
      attachments: async () => { throw new Error('attachment bytes missing') },
    })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(200)
    await expect(response.arrayBuffer()).rejects.toThrow('attachment bytes missing')
  })

  it('answers 500 when the deployment mounts no attachments service', async () => {
    /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
    const api = await buildApi({ 'session-root': artifact('session-root') }, [], { attachments: false })
    /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
    const response = await toFetchHandler(api).fetch(
      new Request('http://host/api/session.export?sessionId=session-root'),
    )
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('attachments')
  })
})
