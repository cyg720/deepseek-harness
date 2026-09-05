/**
 * 文件职责：验证反馈记录的 helpers.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证反馈记录在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import SessionStore, { SessionLogOffset,
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  /** 中文说明：类型或类 SessionEvent 约束扩展或反馈数据职责。 */
  type SessionEvent,
  /** 中文说明：类型或类 SessionHeader 约束扩展或反馈数据职责。 */
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import SessionPersistence, {
  SessionAlreadyExistsError,
  SessionHandleClosedError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
  type SessionAccess,
  type SessionHandle,
  type SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import MessageFeedbackService from '../src/index.ts'

/** 中文说明：类型或类 MessageFixture 约束扩展或反馈数据职责。 */
export interface MessageFixture {
  readonly session: Session
  readonly userMessageId: MessageId
  readonly assistantMessageIds: readonly [MessageId, MessageId]
  readonly emptyAssistantMessageId: MessageId
}

/** Append one deterministic transcript used by target-validation tests. */
/* 中文说明：函数 appendMessageFixture 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function appendMessageFixture(session: Session): Omit<MessageFixture, 'session'> {
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  /** 中文说明：测试局部值 user，由紧邻初始化决定。 */
  const user = createUserMessage({
    content: [{ type: 'text', text: 'Question' }],
    source: { kind: 'user' },
  })
  session.append('user/message', user, { surfaceOp: 'append' })

  /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
  const first = createAssistantMessage({
    content: [{ type: 'text', text: 'First answer' }],
    source: { provider: 'test', model: 'test' },
  })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: first,
  }, { surfaceOp: 'append' })
  /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
  const second = createAssistantMessage({
    content: [{ type: 'text', text: 'Second answer' }],
    source: { provider: 'test', model: 'test' },
  })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: second,
  }, { surfaceOp: 'append' })
  /** 中文说明：测试局部值 empty，由紧邻初始化决定。 */
  const empty = createAssistantMessage({
    content: [],
    source: { provider: 'test', model: 'test' },
  })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: empty,
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return {
    userMessageId: user.id,
    assistantMessageIds: [first.id, second.id],
    emptyAssistantMessageId: empty.id,
  }
}

/** Construct one cold persistence fixture without publishing a live Session. */
/* 中文说明：函数 messageFixture 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function messageFixture(
  rawId: string,
  options: { readonly createdAt?: number; readonly cwd?: string } = {},
): MessageFixture {
  /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
  const id = SessionId(rawId)
  /** 中文说明：测试局部值 header，由紧邻初始化决定。 */
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: options.createdAt ?? 1_700_000_000_000,
    isSeeded: false,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  }
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = Session.create(id, [], header)
  return { session, ...appendMessageFixture(session) }
}

/** One stored session in the in-memory test backend. */
interface StoredSession {
  readonly meta: SessionHeader
  events: readonly SessionEvent[]
}

/** Minimal controllable persistence provider for service-level tests. */
/* 中文说明：类型或类 TestPersistence 约束扩展或反馈数据职责。 */
class TestPersistence extends SessionPersistence {
  readonly durable = new Map<SessionId, StoredSession>()
  readFailure: Error | undefined
  statCalls = 0
  readCalls = 0
  onRead: (() => void | Promise<void>) | undefined
  onStat: (() => void | Promise<void>) | undefined

  async create(header: SessionHeader): Promise<SessionHandle> {
    if (this.durable.has(header.id)) throw new SessionAlreadyExistsError(header.id)
    const stored: StoredSession = { meta: header, events: [] }
    this.durable.set(header.id, stored)
    return this.handle(stored, 'write')
  }

  // Appends are durable on resolution here; nothing buffers, so the service-wide flush is a no-op.
  async flush(): Promise<void> {}

  async open(id: SessionId, access: SessionAccess): Promise<SessionHandle> {
    const stored = this.durable.get(id)
    if (stored === undefined) throw new SessionPersistenceNotFoundError(id)
    return this.handle(stored, access)
  }

  async stat(id: SessionId): Promise<SessionPersistenceSnapshot | undefined> {
    this.statCalls += 1
    await this.onStat?.()
    const stored = this.durable.get(id)
    if (stored === undefined) return undefined
    return { header: stored.meta, revision: SessionPersistenceRevision(`test:${id}:${stored.events.length}`) }
  }

  async list(): Promise<SessionPersistenceSnapshot[]> {
    return [...this.durable.entries()].map(([id, stored]) => ({
      header: stored.meta,
      revision: SessionPersistenceRevision(`test:${id}:${stored.events.length}`),
    }))
  }

  private handle(stored: StoredSession, access: SessionAccess): SessionHandle {
    let closed = false
    const handle: SessionHandle = {
      id: stored.meta.id,
      header: stored.meta,
      inheritedEventCount: SessionLogOffset(0),
      access,
      read: async (offset = 0, length?: number) => {
        if (closed) throw new SessionHandleClosedError(stored.meta.id, 'read')
        this.readCalls += 1
        if (this.readFailure !== undefined) throw this.readFailure
        await this.onRead?.()
        const events = stored.events.filter(event => event.seq >= offset)
        return length === undefined ? events : events.slice(0, length)
      },
      append: async (events) => {
        if (closed) throw new SessionHandleClosedError(stored.meta.id, 'append')
        if (access !== 'write') throw new SessionReadOnlyError(stored.meta.id, 'append')
        stored.events = [...stored.events, ...events]
      },
      flush: async () => {
        if (closed) throw new SessionHandleClosedError(stored.meta.id, 'flush')
        if (access !== 'write') throw new SessionReadOnlyError(stored.meta.id, 'flush')
      },
      close: async () => { closed = true },
      [Symbol.asyncDispose]() { return handle.close() },
    }
    return handle
  }

  persist(session: Session): void {
    this.durable.set(session.id, { meta: session.header, events: [...session.snapshotEvents()] })
  }

  setDurable(stored: StoredSession): void {
    this.durable.set(stored.meta.id, stored)
  }
}

/** 中文说明：类型或类 TestHarness 约束扩展或反馈数据职责。 */
export interface TestHarness {
  readonly ctx: Context
  readonly persistence: TestPersistence
  readonly root: string
  disposeFeedback(): Promise<void>
  dispose(): Promise<void>
}

/** Compose the service over the real storage hub/domain/JSON backend. */
/* 中文说明：函数 setupHarness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export async function setupHarness(maxNoteBytes = 64): Promise<TestHarness> {
  /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
  const root = await mkdtemp(join(tmpdir(), 'dsh-message-feedback-test-'))
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  /** 中文说明：测试局部值 disposeFeedback，由紧邻初始化决定。 */
  let disposeFeedback: (() => Promise<void>) | undefined
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(TestPersistence)
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    /** 中文说明：测试局部值 feedbackFiber，由紧邻初始化决定。 */
    const feedbackFiber = await ctx.plugin(MessageFeedbackService, { maxNoteBytes })
    disposeFeedback = feedbackFiber.dispose
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  if (disposeFeedback === undefined) throw new Error('message feedback test plugin did not load')
  return {
    ctx,
    persistence: ctx.sessionPersistence as unknown as TestPersistence,
    root,
    disposeFeedback,
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
