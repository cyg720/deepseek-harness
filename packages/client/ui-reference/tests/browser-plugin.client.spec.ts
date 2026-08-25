/**
 * Web reference source coverage: Remote-backed file/session discovery,
 * deterministic ordering and labels, quoted-path suppression, pick projections, codec
 * round-trip, and registration lifecycle.
 */
/*
 * 文件职责：验证引用插件的 browser-plugin.client.spec.ts 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止引用插件的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  CandidateRequest, ClientSessionContext, InputTriggerCandidate, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference/types'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (value: string): SessionId => value as SessionId
/** 中文说明：测试局部值 session，由紧邻初始化决定。 */
const session: ClientSessionContext = { sessionId: sid('target') }

/** 中文说明：类型或类 RemoteEnvelope 约束模块数据或职责。 */
type RemoteEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: object } }

/** 中文说明：类型或类 RemoteLookup 约束模块数据或职责。 */
type RemoteLookup<T> = (
  agentId: SessionId,
  query: string,
  signal?: AbortSignal,
) => Promise<RemoteEnvelope<T[]>>

/** 中文说明：函数 request 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function request(
  query: string,
  options: { quoted?: boolean; signal?: AbortSignal } = {},
): CandidateRequest {
  return {
    query,
    quoted: options.quoted ?? false,
    position: 'inline',
    signal: options.signal ?? new AbortController().signal,
  }
}

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench(
  files: RemoteLookup<FileReferenceCandidate> = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: [
      { path: 'src', kind: 'directory' as const },
      { path: 'docs/a b.md', kind: 'file' as const },
    ],
  })),
  sessions: RemoteLookup<SessionReferenceMentionCandidate> = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: [{
      sessionId: sid('source'),
      label: 'Research',
      cwd: '/project',
      createdAt: 1_700_000_000_000,
      mention: '@[Research](dsh-session:InNvdXJjZSI)',
    }],
  })),
): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']>; source: InputTriggerSource }> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
  let source: InputTriggerSource | undefined
  ctx.provide('inputTriggers', {
    registerSource(candidate: InputTriggerSource) {
      source = candidate
      return () => { source = undefined }
    },
  })
  /** 中文说明：类型或类 RemoteService 约束模块数据或职责。 */
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.fileReferences', { list: files })
  ctx.provide('remote.sessionReferenceResolver', { candidates: sessions })
  ctx.provide('locale', new LocaleRuntime(ctx))
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  if (source === undefined) throw new Error('reference source was not registered')
  return { ctx, fiber, source }
}

describe('apply', () => {
  it('declares its services and releases the @ reference registration on disposal', async () => {
    expect(inject).toEqual([
      'inputTriggers', 'locale', 'remote', 'remote.fileReferences', 'remote.sessionReferenceResolver',
    ])
    /** 中文说明：测试局部值 { fiber }，由紧邻初始化决定。 */
    const { fiber } = await bench()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let registered: InputTriggerSource | undefined
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    ctx.provide('inputTriggers', {
      registerSource(source: InputTriggerSource) {
        registered = source
        return () => { registered = undefined }
      },
    })
    /** 中文说明：类型或类 RemoteService 约束模块数据或职责。 */
    class RemoteService extends Service {
      constructor(serviceCtx: Context) {
        super(serviceCtx, 'remote')
      }
    }
    new RemoteService(ctx)
    ctx.provide('remote.fileReferences', { list: () => Promise.resolve({ ok: true, value: [] }) })
    ctx.provide('remote.sessionReferenceResolver', { candidates: () => Promise.resolve({ ok: true, value: [] }) })
    ctx.provide('locale', new LocaleRuntime(ctx))
    /** 中文说明：测试局部值 ownFiber，由紧邻初始化决定。 */
    const ownFiber = ctx.plugin({ inject: [...inject], apply })
    await ownFiber.await()
    expect(registered).toMatchObject({ trigger: '@', name: 'reference', showGroupTitle: false })
    await ownFiber.dispose()
    expect(registered).toBeUndefined()
    await fiber.dispose()
  })

  it('the node half applies without host-side behavior', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})

describe('candidates', () => {
  it('starts both Remote lookups together and renders files before sessions with stable labels', async () => {
    /** 中文说明：测试局部值 releaseFiles，由紧邻初始化决定。 */
    let releaseFiles!: () => void
    /** 中文说明：测试局部值 releaseSessions，由紧邻初始化决定。 */
    let releaseSessions!: () => void
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = vi.fn(() => new Promise<{
      ok: true
      value: { path: string; kind: 'file' | 'directory' }[]
    }>((resolve) => {
      releaseFiles = () => {
        resolve({
          ok: true,
          value: [
            { path: 'src', kind: 'directory' },
            { path: 'docs/a b.md', kind: 'file' },
          ],
        })
      }
    }))
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = vi.fn(() => new Promise<{
      ok: true
      value: {
        sessionId: SessionId
        label: string
        cwd: string
        createdAt: number
        mention: string
      }[]
    }>((resolve) => {
      releaseSessions = () => {
        resolve({
          ok: true,
          value: [{
            sessionId: sid('source'),
            label: 'Research',
            cwd: '/project',
            createdAt: 1_700_000_000_000,
            mention: '@[Research](dsh-session:InNvdXJjZSI)',
          }],
        })
      }
    }))
    /** 中文说明：测试局部值 { source }，由紧邻初始化决定。 */
    const { source } = await bench(files, sessions)
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = source.candidates(session, request('re'))
    expect(files).toHaveBeenCalledTimes(1)
    expect(sessions).toHaveBeenCalledTimes(1)
    releaseSessions()
    releaseFiles()
    await expect(pending).resolves.toEqual([
      expect.objectContaining({
        name: 'Folder · src/',
        description: 'src',
        section: 'Files & folders',
      }),
      expect.objectContaining({
        name: 'File · a b.md',
        description: 'docs/a b.md',
        section: 'Files & folders',
      }),
      expect.objectContaining({
        name: 'Session · Research',
        description: 'source · /project · 2023-11-14T22:13:20.000Z',
        section: 'Session conversations',
      }),
    ])
  })

  it('suppresses sessions for an open quoted path and degrades each failed domain independently', async () => {
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = vi.fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: [{ path: 'README.md', kind: 'file' as const }],
      })
      .mockRejectedValueOnce(new Error('file scan failed'))
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{
        sessionId: sid('source'),
        label: 'Research',
        cwd: '/project',
        createdAt: 0,
        mention: '@[Research](dsh-session:InNvdXJjZSI)',
      }],
    }))
    /** 中文说明：测试局部值 { source }，由紧邻初始化决定。 */
    const { source } = await bench(files, sessions)
    /** 中文说明：测试局部值 quoted，由紧邻初始化决定。 */
    const quoted = await source.candidates(session, request('READ', { quoted: true }))
    expect(quoted).toEqual([expect.objectContaining({ name: 'File · README.md' })])
    expect(source.onPick({
      candidate: quoted[0]!,
      session,
      position: 'inline',
      via: 'menu',
      span: { start: 0, end: 6, draftRev: 1 },
    })).toEqual({
      insert: {
        source: 'reference',
        ref: '@"README.md"',
        label: 'README.md',
        appearance: 'file',
        clipboardText: '@"README.md"',
      },
    })
    expect(sessions).not.toHaveBeenCalled()
    await expect(source.candidates(session, request('research'))).resolves.toEqual([
      expect.objectContaining({ name: 'Session · Research' }),
    ])
  })

  it('drops a completed result when the query signal was superseded', async () => {
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 { source }，由紧邻初始化决定。 */
    const { source } = await bench()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = source.candidates(session, request('', { signal: controller.signal }))
    controller.abort()
    await expect(pending).resolves.toEqual([])
  })

  it('treats Remote failures as empty domains and filters paths that cannot be mentioned', async () => {
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{ path: 'bad\nname', kind: 'file' as const }],
    }))
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = vi.fn()
      .mockRejectedValueOnce(new Error('session lookup failed'))
      .mockResolvedValueOnce({
        ok: false as const,
        error: { code: 'internal', message: 'session lookup failed', details: {} },
      })
    /** 中文说明：测试局部值 { source }，由紧邻初始化决定。 */
    const { source } = await bench(files, sessions)
    await expect(source.candidates(session, request('bad'))).resolves.toEqual([])

    files.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'internal', message: 'file lookup failed', details: {} },
    } as never)
    await expect(source.candidates(session, request('bad'))).resolves.toEqual([])
  })

  it('omits redundant session ids and labels sessions without a cwd', async () => {
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = vi.fn(() => Promise.resolve({ ok: true as const, value: [] }))
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{
        sessionId: sid('same'),
        label: 'same',
        createdAt: 0,
        mention: '@[same](dsh-session:InNhbWUi)',
      }],
    }))
    /** 中文说明：测试局部值 { source }，由紧邻初始化决定。 */
    const { source } = await bench(files, sessions)
    await expect(source.candidates(session, request('same'))).resolves.toEqual([
      expect.objectContaining({
        name: 'Session · same',
        description: '(no cwd) · 1970-01-01T00:00:00.000Z',
      }),
    ])
  })
})

describe('pick and codec', () => {
  /** 中文说明：测试局部值 pick，由紧邻初始化决定。 */
  const pick = (source: InputTriggerSource, candidate: InputTriggerCandidate) => source.onPick({
    candidate,
    session,
    position: 'inline',
    via: 'menu',
    span: { start: 0, end: 1, draftRev: 1 },
  })

  it('inserts files as atomic icon labels while keeping directory completion open', async () => {
    /** 中文说明：测试局部值 { source }，由紧邻初始化决定。 */
    const { source } = await bench()
    /** 中文说明：测试局部值 [directory, file]，由紧邻初始化决定。 */
    const [directory, file] = await source.candidates(session, request(''))
    expect(pick(source, directory!)).toEqual({ text: '@src/', continue: true })
    expect(pick(source, file!)).toEqual({
      insert: {
        source: 'reference',
        ref: '@"docs/a b.md"',
        label: 'a b.md',
        appearance: 'file',
        clipboardText: '@"docs/a b.md"',
      },
    })
    /** 中文说明：测试局部值 [quotedDirectory]，由紧邻初始化决定。 */
    const [quotedDirectory] = await source.candidates(session, request('', { quoted: true }))
    expect(pick(source, quotedDirectory!)).toEqual({ text: '@"src/', continue: true })
  })

  it('inserts sessions as atomic chips whose clipboard and model forms are canonical mentions', async () => {
    /** 中文说明：测试局部值 { source }，由紧邻初始化决定。 */
    const { source } = await bench()
    /** 中文说明：测试局部值 candidates，由紧邻初始化决定。 */
    const candidates = await source.candidates(session, request(''))
    /** 中文说明：测试局部值 candidate，由紧邻初始化决定。 */
    const candidate = candidates.find(item => item.name === 'Session · Research')!
    /** 中文说明：测试局部值 mention，由紧邻初始化决定。 */
    const mention = '@[Research](dsh-session:InNvdXJjZSI)'
    expect(pick(source, candidate)).toEqual({
      insert: {
        source: 'reference',
        ref: mention,
        label: 'Research',
        appearance: 'session',
        clipboardText: mention,
      },
    })
    expect(source.codec?.clipboardText(mention)).toBe(mention)
    await expect(source.codec?.serialize(mention, new AbortController().signal)).resolves.toBe(mention)
  })

  it('ignores candidates that do not carry a source-owned value', async () => {
    /** 中文说明：测试局部值 { source }，由紧邻初始化决定。 */
    const { source } = await bench()
    expect(pick(source, { name: 'foreign candidate' })).toBeUndefined()
  })
})
