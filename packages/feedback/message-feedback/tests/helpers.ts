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
import SessionStore, {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  /** 中文说明：类型或类 SessionEvent 约束扩展或反馈数据职责。 */
  type SessionEvent,
  /** 中文说明：类型或类 SessionHeader 约束扩展或反馈数据职责。 */
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import SessionPersistence, {
  SessionPersistenceRevision,
  /** 中文说明：类型或类 SessionInspection 约束扩展或反馈数据职责。 */
  type SessionInspection,
  /** 中文说明：类型或类 SessionLocation 约束扩展或反馈数据职责。 */
  type SessionLocation,
  /** 中文说明：类型或类 SessionPersistenceSnapshot 约束扩展或反馈数据职责。 */
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
  readonly replacementAssistantMessageId: MessageId
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
  /** 中文说明：测试局部值 firstEvent，由紧邻初始化决定。 */
  const firstEvent = session.append('assistant/message', {
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
    turn: 1,
    step: 1,
    message: empty,
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
  const replacement = createAssistantMessage({
    content: [{ type: 'text', text: 'Model-only replacement' }],
    source: { provider: 'test', model: 'test' },
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: replacement,
  }, {
    surfaceOp: { op: 'replace', start: firstEvent.seq, end: firstEvent.seq },
    sourceEventSeqs: [firstEvent.seq],
  })

  return {
    userMessageId: user.id,
    assistantMessageIds: [first.id, second.id],
    emptyAssistantMessageId: empty.id,
    replacementAssistantMessageId: replacement.id,
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
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  }
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = Session.create(id, [], header)
  return { session, ...appendMessageFixture(session) }
}

/** Minimal controllable persistence provider for service-level tests. */
/* 中文说明：类型或类 TestPersistence 约束扩展或反馈数据职责。 */
class TestPersistence extends SessionPersistence {
  override readonly supportsRawArtifacts = false

  static inject = ['sessions']

  readonly durable = new Map<SessionId, SessionInspection>()
  readonly logical = new Map<SessionId, SessionInspection>()
  inspectFailure: Error | undefined
  inspectCalls = 0
  readFromCalls = 0
  onReadFrom: (() => void | Promise<void>) | undefined
  onListSnapshots: (() => void | Promise<void>) | undefined

  locate(_meta: SessionHeader): SessionLocation | undefined { return undefined }
  create(_meta: SessionHeader): Promise<void> { return Promise.resolve() }
  append(_id: SessionId, _events: readonly SessionEvent[]): Promise<void> { return Promise.resolve() }

  load(id: SessionId): Promise<SessionInspection> {
    return this.readFrom(id, 0)
  }

  inspect(id: SessionId): Promise<SessionInspection> {
    this.inspectCalls += 1
    if (this.inspectFailure !== undefined) return Promise.reject(this.inspectFailure)
    /** 中文说明：测试局部值 explicit，由紧邻初始化决定。 */
    const explicit = this.logical.get(id)
    if (explicit !== undefined) return Promise.resolve(explicit)
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = this.ctx.sessions.get(id)
    if (live !== undefined) return Promise.resolve({ meta: live.header, events: live.events })
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored = this.durable.get(id)
    return stored === undefined
      ? Promise.reject(new Error(`test persistence: session '${id}' not found`))
      : Promise.resolve(stored)
  }

  async readFrom(
    id: SessionId,
    fromSeq: number,
  ): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    this.readFromCalls += 1
    await this.onReadFrom?.()
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored = this.durable.get(id)
    return stored === undefined
      ? Promise.reject(new Error(`test persistence: session '${id}' not found`))
      : { meta: stored.meta, events: stored.events.filter(event => event.seq >= fromSeq) }
  }

  list(): Promise<SessionHeader[]> {
    return Promise.resolve([...this.durable.values()].map(value => value.meta))
  }

  async listSnapshots(): Promise<SessionPersistenceSnapshot[]> {
    await this.onListSnapshots?.()
    return [...this.durable.values()].map((value, index) => ({
      header: value.meta,
      revision: SessionPersistenceRevision(`test:${index}:${value.events.length}`),
    }))
  }

  persist(session: Session): void {
    this.durable.set(session.id, { meta: session.header, events: session.events })
  }

  setDurable(inspection: SessionInspection): void {
    this.durable.set(inspection.meta.id, inspection)
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
