/**
 * 文件职责：验证文件引用上下文的 service.spec.ts 行为。
 * 技术维度：Vitest、会话事件、模型请求夹具和 Cordis 组装。
 * 产品维度：防止文件引用上下文改变模型可见内容或生命周期语义。
 * 逻辑维度：构造日志与配置，运行插件并断言事件、请求和清理。
 * 关键边界：模型可见内容必须可重建；工具调用和结果必须保持配对。
 * 新手阅读建议：先读事件夹具，再按正常、边界和失败场景阅读。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { FILE_REFERENCE_PROMPT } from '@deepseek-ai/dsh-file-reference'
import LocalFileReferenceService, { WorkspaceFileSearch } from '../src/index.ts'

/** 中文说明：测试局部值 roots，由紧邻初始化决定。 */
const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(AgentRegistry)
  return ctx
}

/** 中文说明：函数 stubAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function stubAgent(
  ctx: Context,
  id = 'file-reference-agent',
  includeCwd = true,
): Promise<{ agent: Agent; dispose: () => void }> {
  /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-reference-service-'))
  roots.push(root)
  await writeFile(join(root, 'README.md'), 'readme')
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create(SessionId(id), { meta: includeCwd ? { cwd: root } : {} })
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent = {
    id: session.id,
    options: {},
    session,
    status: 'idle',
    acceptsNextStep: false,
    ctx,
    followup() {},
    steer() {},
    inject() {},
    send() {},
    updateInbox() { return 'not-found' as const },
    cancel() {},
    whenIdle: () => Promise.resolve(),
  } as unknown as Agent
  return { agent, dispose: ctx.agents.register(agent) }
}

describe('LocalFileReferenceService', () => {
  it('serves the addressed workspace and installs read-tool guidance for existing agents', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = await stubAgent(ctx)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin(LocalFileReferenceService, {
      maxResults: 5,
      maxEntries: 100,
      excludedDirectories: ['.git'],
    })
    await fiber
    await expect(ctx.fileReferences.list(agent, 'README', new AbortController().signal))
      .resolves.toEqual([{ path: 'README.md', kind: 'file' }])
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(FILE_REFERENCE_PROMPT)

    ctx.tools.register(defineContentToolFixture({
      name: 'read',
      description: 'read a file',
      parameters: {},
      execute: () => Promise.resolve([]),
    }))
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(FILE_REFERENCE_PROMPT)
    await fiber.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(FILE_REFERENCE_PROMPT)
  })

  it('invalidates cached searches after tool results and disposes them with the agent', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 { agent, dispose }，由紧邻初始化决定。 */
    const { agent, dispose } = await stubAgent(ctx)
    /** 中文说明：测试局部值 invalidate，由紧邻初始化决定。 */
    const invalidate = vi.spyOn(WorkspaceFileSearch.prototype, 'invalidate')
    /** 中文说明：测试局部值 close，由紧邻初始化决定。 */
    const close = vi.spyOn(WorkspaceFileSearch.prototype, 'dispose')
    await ctx.plugin(LocalFileReferenceService)
    await ctx.fileReferences.list(agent, 'README', new AbortController().signal)

    ctx.emit('session/event', agent.session, { type: 'tool/result' } as never)
    expect(invalidate).toHaveBeenCalledOnce()
    ctx.emit('session/event', agent.session, { type: 'assistant/message' } as never)
    expect(invalidate).toHaveBeenCalledOnce()
    /** 中文说明：测试局部值 orphan，由紧邻初始化决定。 */
    const orphan = ctx.sessions.create(SessionId('file-reference-orphan'))
    ctx.emit('session/event', orphan, { type: 'tool/result' } as never)
    expect(invalidate).toHaveBeenCalledOnce()

    dispose()
    expect(close).toHaveBeenCalledOnce()
    ctx.emit('agent/disposed', { agent })
  })

  it('installs guidance for agents announced after the service and validates deployment tunables', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    await ctx.plugin(LocalFileReferenceService)
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = await stubAgent(ctx)
    await expect(ctx.fileReferences.list(agent, '', new AbortController().signal))
      .resolves.toEqual([{ path: 'README.md', kind: 'file' }])

    /** 中文说明：测试局部值 badResults，由紧邻初始化决定。 */
    const badResults = await harness()
    expect(() => new LocalFileReferenceService(badResults, { maxResults: 0 })).toThrow('maxResults')
    /** 中文说明：测试局部值 badEntries，由紧邻初始化决定。 */
    const badEntries = await harness()
    expect(() => new LocalFileReferenceService(badEntries, { maxEntries: 1.5 })).toThrow('maxEntries')
    /** 中文说明：测试局部值 badExclusion，由紧邻初始化决定。 */
    const badExclusion = await harness()
    expect(() => new LocalFileReferenceService(badExclusion, { excludedDirectories: ['nested/name'] }))
      .toThrow('excludedDirectories')
    /** 中文说明：测试局部值 fractionalResults，由紧邻初始化决定。 */
    const fractionalResults = await harness()
    expect(() => new LocalFileReferenceService(fractionalResults, { maxResults: 1.5 })).toThrow('maxResults')
    /** 中文说明：测试局部值 zeroEntries，由紧邻初始化决定。 */
    const zeroEntries = await harness()
    expect(() => new LocalFileReferenceService(zeroEntries, { maxEntries: 0 })).toThrow('maxEntries')
    /** 中文说明：测试局部值 emptyExclusion，由紧邻初始化决定。 */
    const emptyExclusion = await harness()
    expect(() => new LocalFileReferenceService(emptyExclusion, { excludedDirectories: [''] }))
      .toThrow('excludedDirectories')
    /** 中文说明：测试局部值 backslashExclusion，由紧邻初始化决定。 */
    const backslashExclusion = await harness()
    expect(() => new LocalFileReferenceService(backslashExclusion, { excludedDirectories: ['nested\\name'] }))
      .toThrow('excludedDirectories')
  })

  it('deduplicates lifecycle announcements and falls back to the process cwd', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin(LocalFileReferenceService)
    await fiber
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = await stubAgent(ctx, 'cwd-fallback', false)
    ctx.emit('agent/created', { agent })
    /** 中文说明：测试局部值 list，由紧邻初始化决定。 */
    const list = vi.spyOn(WorkspaceFileSearch.prototype, 'list').mockResolvedValue([])
    await expect(ctx.fileReferences.list(agent, '', new AbortController().signal)).resolves.toEqual([])
    await expect(ctx.fileReferences.list(agent, 'src', new AbortController().signal)).resolves.toEqual([])
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('logs rejected prompt cleanup without failing service teardown', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await harness()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin(LocalFileReferenceService)
    await fiber
    /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    /** 中文说明：测试局部值 inject，由紧邻初始化决定。 */
    const inject = vi.spyOn(ctx, 'inject')
      .mockReturnValueOnce({ dispose: () => Promise.reject(new Error('error cleanup')) } as never)
      // Deliberately proves cleanup tolerates JavaScript callers rejecting non-Error values.
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors
      .mockReturnValueOnce({ dispose: () => Promise.reject('string cleanup') } as never)
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = await stubAgent(ctx, 'cleanup-one')
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = await stubAgent(ctx, 'cleanup-two')
    expect(inject).toHaveBeenCalledTimes(2)
    first.dispose()
    second.dispose()
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith('file-reference-local: prompt cleanup failed: error cleanup')
      expect(warn).toHaveBeenCalledWith('file-reference-local: prompt cleanup failed: string cleanup')
    })
    await expect(fiber.dispose()).resolves.toBeUndefined()
  })
})
