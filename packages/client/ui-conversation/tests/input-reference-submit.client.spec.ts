/**
 * Reference-submit transaction coverage: chips serialize through their
 * owner, stay resident through Host rejection, and clear only after an
 * accepted prompt.
 */
/**
 * 文件职责：验证会话输入的 input-reference-submit.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止会话输入用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerController, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SessionInputShell } from '../src/client/input/facade.ts'
import type { DraftAttachmentId } from '../src/client/input/contract.ts'

/** 中文说明：测试局部值 mention，由紧邻初始化决定。 */
const mention = '@[Research](dsh-session:InNvdXJjZSI)'
/** 中文说明：测试局部值 spacedMention，由紧邻初始化决定。 */
const spacedMention = '@[Research notes](dsh-session:InNvdXJjZSI)'
/** 中文说明：测试局部值 commandImages，由紧邻初始化决定。 */
const commandImages = {
  serialize: () => Promise.resolve([]),
  release: () => {},
  unsupportedNotice: (token: string) => `${token.trim()} images-unsupported`,
}

/** 中文说明：函数 chip 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function chip(shell: SessionInputShell): void {
  shell.setDraft('@res')
  /** 中文说明：测试局部值 accepted，由紧邻初始化决定。 */
  const accepted = shell.insertReference({
    source: 'reference',
    ref: mention,
    label: 'Research',
    clipboardText: mention,
  }, {
    start: 0,
    end: 4,
    draftRev: shell.snapshot.draftRev,
  })
  expect(accepted).toBe(true)
}

describe('reference submission', () => {
  it('mirrors canonical reference text so a persisted draft remains resolvable after remount', async () => {
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = vi.fn()
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: vi.fn(),
      commandImages,
    })
    first.bindMirror(mirror)
    first.setDraft('@res')
    expect(first.insertReference({
      source: 'reference',
      ref: spacedMention,
      label: 'Research notes',
      appearance: 'session',
      clipboardText: spacedMention,
    }, {
      start: 0,
      end: 4,
      draftRev: first.snapshot.draftRev,
    })).toBe(true)
    expect(first.snapshot.draft).toBe('@Research notes ')
    expect(mirror).toHaveBeenLastCalledWith(`${spacedMention} `)

    /** 中文说明：测试局部值 sink，由紧邻初始化决定。 */
    const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
    /** 中文说明：测试局部值 restored，由紧邻初始化决定。 */
    const restored = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: sink,
      commandImages,
    })
    restored.setDraft(mirror.mock.calls.at(-1)?.[0] as string)
    restored.submit()
    await vi.waitFor(() => {
      expect(sink).toHaveBeenCalledWith(spacedMention, [], 'queue', expect.any(AbortSignal))
    })
  })

  it('retains the chip on Host failure and clears it only after a later accepted retry', async () => {
    /** 中文说明：测试局部值 serializeReference，由紧邻初始化决定。 */
    const serializeReference = vi.fn(() => Promise.resolve(mention))
    /** 中文说明：测试局部值 sink，由紧邻初始化决定。 */
    const sink = vi.fn<(
      _text: string,
      _imageIds: readonly DraftAttachmentId[],
      _mode: 'queue' | 'steer',
      _signal: AbortSignal,
    ) => Promise<SubmitOutcome>>()
      .mockResolvedValueOnce({ kind: 'error', text: 'snapshot unavailable' })
      .mockResolvedValueOnce({ kind: 'success' })
    /** 中文说明：测试局部值 inputTriggers，由紧邻初始化决定。 */
    const inputTriggers = {
      serializeReference,
      track: vi.fn(),
    } as unknown as InputTriggerController
    /** 中文说明：测试局部值 shell，由紧邻初始化决定。 */
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      inputTriggers: () => inputTriggers,
      defaultSink: sink,
      commandImages,
    })
    chip(shell)
    expect(shell.snapshot).toMatchObject({
      draft: '@Research ',
      occurrences: [{ source: 'reference', ref: mention, label: 'Research', offset: 0, length: 9 }],
    })

    shell.submit('queue')
    expect(shell.snapshot.phase).toBe('submitting')
    await vi.waitFor(() => {
      expect(shell.snapshot.phase).toBe('plain')
    })
    expect(sink).toHaveBeenNthCalledWith(1, mention, [], 'queue', expect.any(AbortSignal))
    expect(shell.snapshot).toMatchObject({
      draft: '@Research ',
      occurrences: [{ source: 'reference', ref: mention, label: 'Research', offset: 0, length: 9 }],
    })
    expect(shell.notices.getSnapshot()).toMatchObject({
      level: 'error',
      text: 'snapshot unavailable',
    })

    shell.submit('queue')
    await vi.waitFor(() => {
      expect(shell.snapshot.draft).toBe('')
    })
    expect(sink).toHaveBeenNthCalledWith(2, mention, [], 'queue', expect.any(AbortSignal))
    expect(shell.snapshot.occurrences).toEqual([])
    expect(serializeReference).toHaveBeenCalledTimes(2)
  })

  it('blocks submission and retains the chip when its owner cannot serialize it', async () => {
    /** 中文说明：测试局部值 sink，由紧邻初始化决定。 */
    const sink = vi.fn()
    /** 中文说明：测试局部值 inputTriggers，由紧邻初始化决定。 */
    const inputTriggers = {
      serializeReference: () => Promise.reject(new Error('reference codec unavailable')),
      track: vi.fn(),
    } as unknown as InputTriggerController
    /** 中文说明：测试局部值 shell，由紧邻初始化决定。 */
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      inputTriggers: () => inputTriggers,
      defaultSink: sink,
      commandImages,
    })
    chip(shell)
    shell.submit()
    await vi.waitFor(() => {
      expect(shell.snapshot.phase).toBe('plain')
    })
    expect(sink).not.toHaveBeenCalled()
    expect(shell.snapshot.draft).toBe('@Research ')
    expect(shell.snapshot.occurrences).toHaveLength(1)
    expect(shell.notices.getSnapshot()).toMatchObject({
      level: 'error',
      text: 'reference codec unavailable',
    })
  })

  it('aborts Host-side preparation when the input shell is disposed', () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let signal: AbortSignal | undefined
    /** 中文说明：测试局部值 shell，由紧邻初始化决定。 */
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: (_text, _imageIds, _mode, received) => {
        signal = received
        return new Promise<SubmitOutcome>(() => {})
      },
      commandImages,
    })
    shell.setDraft('send this')
    shell.submit()
    expect(signal?.aborted).toBe(false)
    shell.dispose()
    expect(signal?.aborted).toBe(true)
    expect(shell.snapshot.phase).toBe('plain')
    expect(shell.snapshot.draft).toBe('send this')
  })

  it('retains a rejected default message without duplicating its prompt error notice', async () => {
    /** 中文说明：测试局部值 shell，由紧邻初始化决定。 */
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: () => Promise.resolve({ kind: 'error' }),
      commandImages,
    })
    shell.setDraft('retry this')
    shell.submit()
    await vi.waitFor(() => {
      expect(shell.snapshot.phase).toBe('plain')
    })
    expect(shell.snapshot.draft).toBe('retry this')
    expect(shell.notices.getSnapshot()).toBeNull()
  })
})

describe('submit transaction hardening', () => {
  it('sends one image-only prompt per settlement, ignoring Enter during the round-trip', async () => {
    /** 中文说明：测试局部值 settle，由紧邻初始化决定。 */
    let settle!: (outcome: SubmitOutcome) => void
    /** 中文说明：测试局部值 sink，由紧邻初始化决定。 */
    const sink = vi.fn(() => new Promise<SubmitOutcome>((resolve) => { settle = resolve }))
    /** 中文说明：测试局部值 shell，由紧邻初始化决定。 */
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: sink,
      commandImages,
    })
    expect(shell.addImages(['img-1' as DraftAttachmentId])).toBe(true)
    shell.submit('queue')
    shell.submit('queue')
    expect(sink).toHaveBeenCalledTimes(1)
    settle({ kind: 'success' })
    await vi.waitFor(() => {
      expect(shell.snapshot.imageIds).toEqual([])
    })

    expect(shell.addImages(['img-2' as DraftAttachmentId])).toBe(true)
    shell.submit('queue')
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('retains an image-only rejection without duplicating its prompt error notice', async () => {
    /** 中文说明：测试局部值 sink，由紧邻初始化决定。 */
    const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'error' }))
    /** 中文说明：测试局部值 shell，由紧邻初始化决定。 */
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: sink,
      commandImages,
    })
    /** 中文说明：测试局部值 imageId，由紧邻初始化决定。 */
    const imageId = 'img-1' as DraftAttachmentId
    shell.addImages([imageId])
    shell.submit()
    await Promise.resolve()
    await Promise.resolve()
    expect(shell.snapshot.imageIds).toEqual([imageId])
    expect(shell.notices.getSnapshot()).toBeNull()
  })

  it('re-tracks at the caret when a continuing insert-text splice lands (directory descent)', () => {
    /** 中文说明：测试局部值 track，由紧邻初始化决定。 */
    const track = vi.fn()
    /** 中文说明：测试局部值 shell，由紧邻初始化决定。 */
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      inputTriggers: () => ({ track } as unknown as InputTriggerController),
      defaultSink: vi.fn(),
      commandImages,
    })
    shell.setDraft('@sr')
    /** 中文说明：测试局部值 applied，由紧邻初始化决定。 */
    const applied = shell.insertText('@src/', { start: 0, end: 3, draftRev: shell.snapshot.draftRev }, true)
    expect(applied).toBe(true)
    expect(shell.snapshot.draft).toBe('@src/')
    expect(track).toHaveBeenCalledWith('@src/', 5, { tier: 'plain' }, shell.snapshot.draftRev)

    track.mockClear()
    shell.insertText(' plain ', { start: 0, end: 0, draftRev: shell.snapshot.draftRev })
    expect(track).not.toHaveBeenCalled()
  })
})
