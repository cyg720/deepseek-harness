// @vitest-environment jsdom
// InputBar behavior over the machine wiring: Enter-send semantics (IME guard,
// Shift newline, busy Enter policy, Ctrl/Meta steering, repeat suppression), running
// semantics (input stays free; continuable children keep Send beside Stop), the machine pending lock,
// decoration backdrop, error banners, status strips, and the focus-keeping mousedown.
/**
 * 文件职责：验证会话界面的 input-bar.client.spec.tsx 行为和边界。
 * 技术维度：Vitest、React 测试渲染、事件模拟与可控服务替身。
 * 产品维度：防止会话界面交互和展示在扩展后回归。
 * 逻辑维度：构造状态，触发渲染或交互，再断言输出和清理。
 * 关键边界：全局替身、计时器和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助夹具，再按 describe 场景顺序阅读。
 */

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ClientContext, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SessionInputShell } from '../src/client/input/facade.ts'
import type {
  ComposerAttachment, ComposerAttachmentsOwnerProps,
} from '../src/client/contract/slots.ts'
import type { DraftAttachmentId } from '../src/client/input/contract.ts'
import { InputBar } from '../src/client/skeleton/InputBar.tsx'
import type { InputBarProps } from '../src/client/skeleton/InputBar.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// jsdom implements no Range geometry at all — `Range.prototype.getBoundingClientRect`
// is absent — and the composer measures the caret with one when it restores the
// selection after an edit it performed itself. Every case here runs against a
// zero rect; the reveal case below substitutes its own and restores this one.
/** 中文说明：测试局部值 ZERO_RECT，取值由紧邻初始化决定。 */
const ZERO_RECT = (): DOMRect => ({ top: 0, bottom: 0 }) as DOMRect
Range.prototype.getBoundingClientRect = ZERO_RECT

// Read through the descriptor so the native method is never referenced unbound;
// the reveal case below wraps it to record what it was asked to measure.
/** 中文说明：测试局部值 NATIVE_SET_START，取值由紧邻初始化决定。 */
const NATIVE_SET_START = Object.getOwnPropertyDescriptor(Range.prototype, 'setStart')!
  .value as (this: Range, node: Node, offset: number) => void

/** 中文说明：测试局部值 SCTX，取值由紧邻初始化决定。 */
const SCTX = {} as ClientContext
/** 中文说明：测试局部值 SID，取值由紧邻初始化决定。 */
const SID = 's1' as SessionId

/** 中文说明：函数 snapshotOf 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function snapshotOf(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: false, subagent: null, lastAgentError: null,
    ...overrides,
  }
}

/** 中文说明：类型或类 BenchOptions 约束本文件的数据或组件职责。 */
interface BenchOptions {
  planEntry?: React.ReactNode
  /** The `plan` projection value the standard-kit useProjection serves. */
  plan?: { active: boolean; pending: boolean }
  modelEntry?: React.ReactNode
  /** Hot text-ref lexicon (injects a minimal slash stub exposing only lexicon()). */
  lexicon?: ReadonlyMap<'/' | '@', readonly string[]>
  permissions?: { options: { value: string; name: string; description?: string }[]; currentValue: string }
  /** The `imageLimits` projection value (absent = no attachment service). */
  imageLimits?: {
    maxImageBytes: number
    maxImagesPerMessage: number
    maxMessageImageBytes: number
    maxImagePixels: number
    maxImageDimension: number
    mediaTypes: readonly ('image/png' | 'image/jpeg' | 'image/webp' | 'image/gif')[]
  }
  draft?: string
  running?: boolean
  subagent?: Exclude<ConversationSnapshot['subagent'], null>
  disabled?: boolean
  inert?: boolean
  workspacePickerOpen?: boolean
  onRequestWorkspace?: () => void
  promptError?: ConversationSnapshot['promptError']
  /** Authoritative queue rows served to the machine overlay (empty = none). */
  queue?: ConversationSnapshot['queue']
  /** The hub's steer-all face (empty-draft accelerated Enter). */
  steerQueue?: () => void
  variant?: 'hero' | 'composer'
  placeholder?: string
  t?: InputBarProps['t']
  command?: (line: string) => Promise<boolean>
  accessory?: React.ReactNode
  overlay?: React.ReactNode
  leftItems?: React.ReactNode
  rightItems?: React.ReactNode
  attachments?: readonly ComposerAttachment[]
  addImages?: (files: readonly File[]) => string | null
  commandMenuOpen?: boolean
  busyEnter?: 'queue' | 'steer'
  toggleCommandMenu?: (selection: { start: number; end: number }) => void
}

/** One pending queue row (the runtime snapshot shape, as the dock tests build it). */
/* 中文说明：函数 row 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function row(id: string): ConversationSnapshot['queue'][number] {
  return {
    id: id as never, messageId: `message-${id}` as never, placement: 'queued',
    content: [{ type: 'text', text: id }], preview: id, text: id,
  }
}

/** Real machine behind the bar entry: sink spy, no slash pipeline (plain text goes straight to the sink). */
/* 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function bench(over?: BenchOptions) {
  /** 中文说明：测试局部值 sink，取值由紧邻初始化决定。 */
  const sink = vi.fn<(
    text: string,
    imageIds: readonly DraftAttachmentId[],
    mode: 'queue' | 'steer',
    signal: AbortSignal,
  ) => Promise<SubmitOutcome>>(() => Promise.resolve({ kind: 'success' }))
  /** 中文说明：测试局部值 lex，取值由紧邻初始化决定。 */
  const lex = over?.lexicon
  /** 中文说明：测试局部值 session，取值由紧邻初始化决定。 */
  const session = createSnapshotStore<ConversationSnapshot>(snapshotOf({
    running: over?.running ?? false,
    subagent: over?.subagent ?? null,
    removed: over?.disabled ?? false,
    promptError: over?.promptError ?? null,
    queue: over?.queue ?? [],
  }))
  /** 中文说明：类型或类 ShellDeps 约束本文件的数据或组件职责。 */
  type ShellDeps = ConstructorParameters<typeof SessionInputShell>[0]
  /** 中文说明：测试局部值 shell，取值由紧邻初始化决定。 */
  const shell = new SessionInputShell({
    actx: SCTX,
    defaultSink: sink,
    commandImages: { serialize: () => Promise.resolve([]), release: () => {}, unsupportedNotice: (token: string) => `${token.trim()} images-unsupported` },
    queue: {
      getSnapshot: () => session.getSnapshot().queue,
      subscribe: fn => session.subscribe(fn),
    },
    ...(over?.steerQueue !== undefined ? { steerQueue: over.steerQueue } : {}),
    // Lexicon-only stub: adjudication untouched (undefined slash methods are
    // never reached — these benches drive plain-draft flows only).
    ...(lex !== undefined
      ? {
        inputTriggers: (() => ({
          lexicon: { getSnapshot: () => lex, subscribe: () => () => {} },
        })) as unknown as NonNullable<ShellDeps['inputTriggers']>,
      }
      : {}),
  })
  if (over?.draft !== undefined && over.draft !== '') shell.setDraft(over.draft)
  if (over?.attachments !== undefined) shell.addImages(over.attachments.map(attachment => attachment.id))
  /** 中文说明：清理函数 stop，取值由紧邻初始化决定。 */
  const stop = vi.fn()
  /** 中文说明：清理函数 removeImage，取值由紧邻初始化决定。 */
  const removeImage = vi.fn((id: DraftAttachmentId) => { shell.removeImage(id) })
  /** 中文说明：测试局部值 menuLauncher，取值由紧邻初始化决定。 */
  const menuLauncher = createSnapshotStore<string | null>(over?.commandMenuOpen === true ? 'command' : null)
  /** 中文说明：有序集合 slotCalls，取值由紧邻初始化决定。 */
  const slotCalls: { key: string; owner: unknown }[] = []
  /** 中文说明：测试局部值 renderSlot，取值由紧邻初始化决定。 */
  const renderSlot = ((key: string, owner: object) => {
    slotCalls.push({ key, owner })
    if (key === 'conversation.input.plan') return over?.planEntry ?? null
    if (key === 'conversation.input.model') return over?.modelEntry ?? null
    return null
  }) as InputBarProps['renderSlot']
  /** 中文说明：测试局部值 props，取值由紧邻初始化决定。 */
  const props: InputBarProps = {
    sessionId: SID,
    SessionProvider: ({ children }) => children(SID),
    useSession: bindSnapshotSelector(session),
    useSessions: bindSnapshotSelector(createSnapshotStore({
      ids: [], byId: {}, current: undefined, phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    })),
    useWorkspaces: bindSnapshotSelector(createSnapshotStore({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: undefined,
    })),
    useProjection: ((key: string, selector?: (v: unknown) => unknown) =>
      (selector ?? (v => v))(key === 'permissions'
        ? over?.permissions
        : key === 'plan' ? over?.plan : key === 'imageLimits' ? over?.imageLimits : undefined)),
    useInput: bindSnapshotSelector(shell.state),
    inputActions: shell.actions,
    keyboard: shell,
    addImages: over?.addImages ?? (() => null),
    removeImage,
    draftImages: ids => ids.flatMap((id) => {
      /** 中文说明：测试局部值 attachment，取值由紧邻初始化决定。 */
      const attachment = over?.attachments?.find(candidate => candidate.id === id)
      return attachment === undefined ? [] : [attachment]
    }),
    resolveSubmitMode: (running, gesture, steeringAvailable) => {
      if (!running || !steeringAvailable) return 'queue'
      /** 中文说明：测试局部值 preferred，取值由紧邻初始化决定。 */
      const preferred = over?.busyEnter ?? 'queue'
      return gesture === 'enter' ? preferred : preferred === 'queue' ? 'steer' : 'queue'
    },
    toggleCommandMenu: over?.toggleCommandMenu ?? vi.fn(),
    useNotices: bindSnapshotSelector(shell.notices),
    useLexicon: bindSnapshotSelector(shell.lexicon),
    useMenuLauncher: bindSnapshotSelector(menuLauncher),
    stop,
    command: over?.command ?? (() => Promise.resolve(true)),
    // Mirrors the real lookup chain (conversation namespace, then common).
    t: over?.t ?? makeTranslate(zh, commonZh),
    renderSlot,
    variant: over?.variant ?? 'composer',
    ...(over?.inert === true ? { disabled: true } : {}),
    ...(over?.workspacePickerOpen !== undefined ? { workspacePickerOpen: over.workspacePickerOpen } : {}),
    ...(over?.onRequestWorkspace !== undefined ? { onRequestWorkspace: over.onRequestWorkspace } : {}),
    ...(over?.placeholder !== undefined ? { placeholder: over.placeholder } : {}),
    ...(over?.accessory !== undefined ? { accessory: over.accessory } : {}),
    ...(over?.overlay !== undefined ? { overlay: over.overlay } : {}),
    ...(over?.leftItems !== undefined ? { leftItems: over.leftItems } : {}),
    ...(over?.rightItems !== undefined ? { rightItems: over.rightItems } : {}),
  }
  /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
  const view = render(<InputBar {...props} />)
  /** 中文说明：测试局部值 textarea，取值由紧邻初始化决定。 */
  const textarea = view.container.querySelector('textarea')!
  /** 中文说明：清理函数 primaryStops，取值由紧邻初始化决定。 */
  const primaryStops = over?.running === true && over.subagent === undefined
  /** 中文说明：测试局部值 button，取值由紧邻初始化决定。 */
  const button = view.container.querySelector<HTMLButtonElement>(
    `button[aria-label="${primaryStops ? '停止生成' : '发送消息'}"]`,
  )!
  /** 中文说明：测试局部值 interruptButton，取值由紧邻初始化决定。 */
  const interruptButton = view.container.querySelector<HTMLButtonElement>('button[aria-label="停止生成"]')
  return {
    view, textarea, button, interruptButton, props, sink, shell, wiring: shell, session, stop, removeImage, slotCalls,
    menuLauncher,
    steerQueue: over?.steerQueue,
  }
}

/**
 * Dispatch the native `beforeinput` the composer reads the pre-edit selection
 * from. The DOM event carries no range for a textarea (`getTargetRanges()` is
 * empty there), so the element's own selection plus `inputType` is the signal.
 * The selection each gesture leaves is the engine-observed one: a delete over a
 * selection reports that selection, a caret delete reports the bare caret.
 */
/* 中文说明：函数 beforeInput 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function beforeInput(el: HTMLTextAreaElement, inputType = 'insertText'): void {
  el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType }))
}

/** 中文说明：函数 attachmentOwner 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function attachmentOwner(slotCalls: readonly { key: string; owner: unknown }[]): ComposerAttachmentsOwnerProps {
  /** 中文说明：测试局部值 i，取值由紧邻初始化决定。 */
  for (let i = slotCalls.length - 1; i >= 0; i -= 1) {
    /** 中文说明：测试局部值 call，取值由紧邻初始化决定。 */
    const call = slotCalls[i]
    if (call?.key === 'conversation.input.attachments') return call.owner as ComposerAttachmentsOwnerProps
  }
  throw new Error('attachment slot was not rendered')
}

describe('image draft rail', () => {
  it('collects clipboard files while preserving text from a mixed paste', () => {
    /** 中文说明：测试局部值 addImages，取值由紧邻初始化决定。 */
    const addImages = vi.fn(() => null)
    /** 中文说明：测试局部值 { textarea, shell }，取值由紧邻初始化决定。 */
    const { textarea, shell } = bench({ addImages })
    /** 中文说明：测试局部值 image，取值由紧邻初始化决定。 */
    const image = new File([Uint8Array.of(1, 2, 3)], 'pixel.png', { type: 'image/png' })
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          { kind: 'string', type: 'text/plain', getAsFile: () => null },
          { kind: 'file', type: 'image/png', getAsFile: () => image },
        ],
        getData: () => '同时粘贴的文字',
      },
    })
    expect(addImages).toHaveBeenCalledWith([image])
    expect(shell.snapshot.draft).toBe('同时粘贴的文字')
  })

  it('pre-checks projected limits at intake: whole-batch refusal with product copy, none added', () => {
    /** 中文说明：测试局部值 limits，取值由紧邻初始化决定。 */
    const limits = {
      maxImageBytes: 1024 * 1024,
      maxImagesPerMessage: 2,
      maxMessageImageBytes: 2 * 1024 * 1024,
      maxImagePixels: 40_000_000,
      maxImageDimension: 2000,
      mediaTypes: ['image/png'] as const,
    }
    /** 中文说明：测试局部值 png，取值由紧邻初始化决定。 */
    const png = (bytes: number, name: string) => new File([new ArrayBuffer(bytes)], name, { type: 'image/png' })
    /** 中文说明：测试局部值 intake，取值由紧邻初始化决定。 */
    const intake = (result: ReturnType<typeof bench>, files: File[]) => {
      act(() => { attachmentOwner(result.slotCalls).onAddImages(files) })
    }
    // Count: three at once over a two-image limit → the whole batch refused.
    /** 中文说明：测试局部值 overCount，取值由紧邻初始化决定。 */
    const overCount = bench({ addImages: vi.fn(() => null), imageLimits: limits })
    intake(overCount, [png(8, 'a.png'), png(8, 'b.png'), png(8, 'c.png')])
    expect(overCount.view.getByRole('alert').textContent).toContain('一条消息最多添加 2 张图片')
    expect(overCount.props.addImages).not.toHaveBeenCalled()
    cleanup()
    // Per-file bytes.
    /** 中文说明：测试局部值 overFile，取值由紧邻初始化决定。 */
    const overFile = bench({ addImages: vi.fn(() => null), imageLimits: limits })
    intake(overFile, [png(1024 * 1024 + 1, 'big.png')])
    expect(overFile.view.getByRole('alert').textContent).toContain('单张图片不能超过 1MB')
    expect(overFile.props.addImages).not.toHaveBeenCalled()
    cleanup()
    // Aggregate bytes across the existing rail plus the new batch.
    /** 中文说明：测试局部值 held，取值由紧邻初始化决定。 */
    const held = new File([new ArrayBuffer(1024 * 1024 * 1.5)], 'held.png', { type: 'image/png' })
    /** 中文说明：测试局部值 attachment，取值由紧邻初始化决定。 */
    const attachment = { kind: 'image' as const, id: 'draft-1' as DraftAttachmentId, file: held, previewUrl: 'blob:held' }
    /** 中文说明：测试局部值 overTotal，取值由紧邻初始化决定。 */
    const overTotal = bench({ addImages: vi.fn(() => null), imageLimits: limits, attachments: [attachment] })
    intake(overTotal, [png(1024 * 1024, 'more.png')])
    expect(overTotal.view.getByRole('alert').textContent).toContain('图片总大小超过 2MB')
    expect(overTotal.props.addImages).not.toHaveBeenCalled()
    cleanup()
    // Within every limit: the batch passes through to addImages.
    /** 中文说明：测试局部值 within，取值由紧邻初始化决定。 */
    const within = bench({ addImages: vi.fn(() => null), imageLimits: limits })
    /** 中文说明：测试局部值 fits，取值由紧邻初始化决定。 */
    const fits = png(16, 'fits.png')
    intake(within, [fits])
    expect(within.props.addImages).toHaveBeenCalledWith([fits])
    expect(within.view.queryByRole('alert')).toBeNull()
  })

  it('announces the format problem before any limit when the batch holds a non-image', () => {
    /** 中文说明：测试局部值 addImages，取值由紧邻初始化决定。 */
    const addImages = vi.fn(() => '仅支持 PNG、JPG、WebP、GIF 格式的图片')
    /** 中文说明：测试局部值 result，取值由紧邻初始化决定。 */
    const result = bench({
      addImages,
      imageLimits: {
        maxImageBytes: 8,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 8,
        maxImagePixels: 40_000_000,
        maxImageDimension: 2000,
        mediaTypes: ['image/png'] as const,
      },
    })
    // Oversized AND over-count AND wrong type: the format rejection wins.
    /** 中文说明：测试局部值 files，取值由紧邻初始化决定。 */
    const files = [
      new File([new ArrayBuffer(64)], 'a.pdf', { type: 'application/pdf' }),
      new File([new ArrayBuffer(64)], 'b.pdf', { type: 'application/pdf' }),
    ]
    act(() => { attachmentOwner(result.slotCalls).onAddImages(files) })
    expect(addImages).toHaveBeenCalledWith(files)
    expect(result.view.getByRole('alert').textContent).toContain('仅支持 PNG、JPG、WebP、GIF 格式的图片')
  })

  it('projects display-ready limits into the attachment slot', () => {
    /** 中文说明：测试局部值 result，取值由紧邻初始化决定。 */
    const result = bench({
      addImages: vi.fn(() => null),
      imageLimits: {
        maxImageBytes: 5 * 1024 * 1024,
        maxImagesPerMessage: 20,
        maxMessageImageBytes: 100 * 1024 * 1024,
        maxImagePixels: 40_000_000,
        maxImageDimension: 2000,
        mediaTypes: ['image/png'] as const,
      },
    })
    expect(attachmentOwner(result.slotCalls).dropLimits).toEqual({ count: 20, size: '5MB' })
  })

  it('announces server attachment rejections as product copy, other codes as developer text', () => {
    /** 中文说明：失败观测值 attachmentError，取值由紧邻初始化决定。 */
    const attachmentError = (reason: string): ConversationSnapshot['promptError'] => ({
      op: 'send',
      error: { code: 'attachment-error', message: 'raw wire text', details: { reason } },
    })
    /** 中文说明：测试局部值 model，取值由紧邻初始化决定。 */
    const model = bench({ promptError: attachmentError('MODEL_DOES_NOT_SUPPORT_IMAGES') })
    expect(model.view.getByRole('alert').textContent).toContain('当前模型不支持图片，请切换支持图片的模型')
    cleanup()
    /** 中文说明：测试局部值 unknown，取值由紧邻初始化决定。 */
    const unknown = bench({ promptError: attachmentError('ATTACHMENT_NOT_REFERENCED') })
    expect(unknown.view.getByRole('alert').textContent).toContain('图片发送失败（ATTACHMENT_NOT_REFERENCED）')
    cleanup()
    /** 中文说明：测试局部值 other，取值由紧邻初始化决定。 */
    const other = bench({
      promptError: { op: 'send', error: { code: 'internal', message: 'boom', details: {} } },
    })
    expect(other.view.getByRole('alert').textContent).toContain('boom (internal)')
  })

  it('marks the attachment slot unavailable while the composer is locked', () => {
    /** 中文说明：测试局部值 result，取值由紧邻初始化决定。 */
    const result = bench({ addImages: vi.fn(() => null), inert: true })
    expect(attachmentOwner(result.slotCalls).canAcceptDrop).toBe(false)
  })

  it('sends an image-only draft and exposes removal through the attachment slot', async () => {
    /** 中文说明：测试局部值 file，取值由紧邻初始化决定。 */
    const file = new File([Uint8Array.of(1)], 'pixel.png', { type: 'image/png' })
    /** 中文说明：测试局部值 extra，取值由紧邻初始化决定。 */
    const extra = new File([Uint8Array.of(2)], 'extra.png', { type: 'image/png' })
    /** 中文说明：测试局部值 attachments，取值由紧邻初始化决定。 */
    const attachments = [
      { kind: 'image' as const, id: 'draft-1' as DraftAttachmentId, file, previewUrl: 'blob:draft-1' },
      { kind: 'image' as const, id: 'draft-2' as DraftAttachmentId, file: extra, previewUrl: 'blob:draft-2' },
    ]
    /** 中文说明：测试局部值 result，取值由紧邻初始化决定。 */
    const result = bench({ attachments })
    /** 中文说明：测试局部值 解构结果，取值由紧邻初始化决定。 */
    const { view, textarea, sink, removeImage } = result
    expect((view.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(false)
    /** 中文说明：测试局部值 owner，取值由紧邻初始化决定。 */
    const owner = attachmentOwner(result.slotCalls)
    act(() => { owner.onRemoveImage('draft-2' as DraftAttachmentId) })
    expect(removeImage).toHaveBeenCalledWith('draft-2')
    /** 中文说明：测试局部值 settle，取值由紧邻初始化决定。 */
    let settle!: (outcome: SubmitOutcome) => void
    sink.mockImplementationOnce(() => new Promise<SubmitOutcome>((resolve) => { settle = resolve }))
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(sink).toHaveBeenCalledWith('', ['draft-1'], 'queue', expect.any(AbortSignal))
    expect(attachmentOwner(result.slotCalls).attachments).toEqual([attachments[0]])
    await act(async () => { settle({ kind: 'success' }) })
    await vi.waitFor(() => {
      expect(attachmentOwner(result.slotCalls).attachments).toEqual([])
    })
  })

  it('announces an image-intake rejection as a fading toast, repeatable for the same reason', () => {
    vi.useFakeTimers()
    try {
      /** 中文说明：测试局部值 addImages，取值由紧邻初始化决定。 */
      const addImages = vi.fn(() => '仅支持 PNG、JPG、WebP、GIF 格式的图片')
      /** 中文说明：测试局部值 { view, textarea }，取值由紧邻初始化决定。 */
      const { view, textarea } = bench({ addImages })
      /** 中文说明：测试局部值 paste，取值由紧邻初始化决定。 */
      const paste = () => {
        fireEvent.paste(textarea, {
          clipboardData: {
            items: [{ kind: 'file', type: 'text/plain', getAsFile: () => new File(['x'], 'note.txt', { type: 'text/plain' }) }],
            getData: () => '',
          },
        })
      }
      paste()
      expect(view.getByRole('alert').textContent).toContain('仅支持 PNG、JPG、WebP、GIF 格式的图片')
      act(() => { vi.advanceTimersByTime(4000) })
      expect(view.queryByRole('alert')).toBeNull()
      // The identical rejection re-announces: the toast is keyed per show.
      paste()
      expect(view.getByRole('alert').textContent).toContain('仅支持 PNG、JPG、WebP、GIF 格式的图片')
    } finally {
      vi.useRealTimers()
    }
  })

  it('announces a rejected attachment-slot intake through the same toast', () => {
    /** 中文说明：测试局部值 addImages，取值由紧邻初始化决定。 */
    const addImages = vi.fn(() => '图片读取服务不可用')
    /** 中文说明：测试局部值 result，取值由紧邻初始化决定。 */
    const result = bench({ addImages })
    act(() => {
      attachmentOwner(result.slotCalls).onAddImages([
        new File([Uint8Array.of(1)], 'x.png', { type: 'image/png' }),
      ])
    })
    expect(result.view.getByRole('alert').textContent).toContain('图片读取服务不可用')
  })
})

describe('Enter semantics', () => {
  it('advertises the empty-draft whole-queue steering gesture when it is available', () => {
    /** 中文说明：测试局部值 { textarea }，取值由紧邻初始化决定。 */
    const { textarea } = bench({ running: true, queue: [row('q-1')], steerQueue: vi.fn() })
    expect(textarea.placeholder).toBe('Cmd/Ctrl+Enter 插话发送全部排队消息')
  })

  it('keeps the owning placeholder or ordinary guidance when whole-queue steering is unavailable', () => {
    expect(bench({ running: true }).textarea.placeholder).toBe('给智能体发消息')
    expect(bench({ queue: [row('q-1')] }).textarea.placeholder).toBe('给智能体发消息')
    expect(bench({ running: true, queue: [row('q-1')], draft: '消息' }).textarea.placeholder).toBe('给智能体发消息')
    expect(bench({
      running: true,
      queue: [row('q-1')],
      subagent: {
        address: { parentSessionId: 'parent' as SessionId, childSessionId: SID, mode: 'continuable' },
        parentAvailable: true,
      },
    }).textarea.placeholder).toBe('给智能体发消息')
    expect(bench({
      running: true,
      queue: [row('q-1')],
      placeholder: '上层指定提示',
    }).textarea.placeholder).toBe('上层指定提示')
    // The command menu owns Enter while open: neither the hint nor the
    // gesture may claim the chord.
    expect(bench({
      running: true,
      queue: [row('q-1')],
      commandMenuOpen: true,
    }).textarea.placeholder).toBe('给智能体发消息')
    // The steer hint intentionally outranks the plan placeholder: while it
    // shows, the whole-queue gesture is genuinely available in plan mode.
    expect(bench({
      running: true,
      queue: [row('q-1')],
      plan: { active: true, pending: false },
    }).textarea.placeholder).toBe('Cmd/Ctrl+Enter 插话发送全部排队消息')
  })

  it('an open command menu withholds the whole-queue steering gesture', () => {
    /** 中文说明：测试局部值 steerQueue，取值由紧邻初始化决定。 */
    const steerQueue = vi.fn()
    /** 中文说明：测试局部值 { textarea, sink }，取值由紧邻初始化决定。 */
    const { textarea, sink } = bench({
      running: true,
      queue: [row('q-1')],
      commandMenuOpen: true,
      steerQueue,
    })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    expect(steerQueue).not.toHaveBeenCalled()
    expect(sink).not.toHaveBeenCalled()
  })

  it('plain Enter submits queue mode through the machine; repeat and empty are suppressed', () => {
    /** 中文说明：测试局部值 { textarea, sink }，取值由紧邻初始化决定。 */
    const { textarea, sink } = bench({ draft: 'hello' })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(sink).toHaveBeenCalledWith('hello', [], 'queue', expect.any(AbortSignal))
    // The submitting-phase lock, not draft emptiness, suppresses the repeat:
    // the draft is still uncleared while the sink round-trip is in flight.
    fireEvent.keyDown(textarea, { key: 'Enter', repeat: true })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(sink).toHaveBeenCalledTimes(1)
    /** 中文说明：测试局部值 empty，取值由紧邻初始化决定。 */
    const empty = bench({ draft: '   ' })
    fireEvent.keyDown(empty.textarea, { key: 'Enter' })
    expect(empty.sink).not.toHaveBeenCalled()
  })

  it('non-Enter keys and Shift+Enter fall through to native behavior', () => {
    /** 中文说明：测试局部值 { textarea, sink }，取值由紧邻初始化决定。 */
    const { textarea, sink } = bench({ draft: 'hello' })
    fireEvent.keyDown(textarea, { key: 'a' })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(sink).not.toHaveBeenCalled()
  })

  it('Shift+Enter newline wins even inside IME composition (unconditional precedence)', () => {
    /** 中文说明：测试局部值 { textarea, sink }，取值由紧邻初始化决定。 */
    const { textarea, sink } = bench({ draft: 'hello' })
    fireEvent.compositionStart(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(sink).not.toHaveBeenCalled() // and not preventDefault'd: native newline
  })

  it('Ctrl/Meta+Enter sends normally while idle and steers while running', () => {
    /** 中文说明：测试局部值 idle，取值由紧邻初始化决定。 */
    const idle = bench({ draft: 'hello' })
    fireEvent.keyDown(idle.textarea, { key: 'Enter', metaKey: true })
    expect(idle.sink).toHaveBeenCalledWith('hello', [], 'queue', expect.any(AbortSignal))

    /** 中文说明：测试局部值 busyCtrl，取值由紧邻初始化决定。 */
    const busyCtrl = bench({ running: true, draft: 'steer with ctrl' })
    fireEvent.keyDown(busyCtrl.textarea, { key: 'Enter', ctrlKey: true })
    expect(busyCtrl.sink).toHaveBeenCalledWith('steer with ctrl', [], 'steer', expect.any(AbortSignal))

    /** 中文说明：测试局部值 busyMeta，取值由紧邻初始化决定。 */
    const busyMeta = bench({ running: true, draft: 'steer with cmd' })
    fireEvent.keyDown(busyMeta.textarea, { key: 'Enter', metaKey: true })
    expect(busyMeta.sink).toHaveBeenCalledWith('steer with cmd', [], 'steer', expect.any(AbortSignal))
  })

  it('empty-draft Cmd/Ctrl+Enter steers the whole queue instead of submitting', () => {
    /** 中文说明：测试局部值 steerQueue，取值由紧邻初始化决定。 */
    const steerQueue = vi.fn()
    /** 中文说明：测试局部值 queue，取值由紧邻初始化决定。 */
    const queue = [row('q-1'), row('q-2')]
    /** 中文说明：测试局部值 meta，取值由紧邻初始化决定。 */
    const meta = bench({ running: true, queue, steerQueue })
    fireEvent.keyDown(meta.textarea, { key: 'Enter', metaKey: true })
    expect(meta.steerQueue).toHaveBeenCalledTimes(1)
    expect(meta.sink).not.toHaveBeenCalled()

    /** 中文说明：测试局部值 ctrl，取值由紧邻初始化决定。 */
    const ctrl = bench({ running: true, queue, steerQueue: vi.fn() })
    fireEvent.keyDown(ctrl.textarea, { key: 'Enter', ctrlKey: true })
    expect(ctrl.steerQueue).toHaveBeenCalledTimes(1)
    expect(ctrl.sink).not.toHaveBeenCalled()
  })

  it('queue steering stays gated: idle, subagent, plain Enter, empty queue, or steering-only rows', () => {
    // Idle: the gesture falls through to the machine's empty-draft no-op.
    /** 中文说明：测试局部值 idle，取值由紧邻初始化决定。 */
    const idle = bench({ queue: [row('q-1')], steerQueue: vi.fn() })
    fireEvent.keyDown(idle.textarea, { key: 'Enter', metaKey: true })
    expect(idle.steerQueue).not.toHaveBeenCalled()
    expect(idle.sink).not.toHaveBeenCalled()

    // Plain Enter never steers the queue, even under the busy Steer preference.
    /** 中文说明：测试局部值 plain，取值由紧邻初始化决定。 */
    const plain = bench({ running: true, busyEnter: 'steer', queue: [row('q-1')], steerQueue: vi.fn() })
    fireEvent.keyDown(plain.textarea, { key: 'Enter' })
    expect(plain.steerQueue).not.toHaveBeenCalled()
    expect(plain.sink).not.toHaveBeenCalled()

    // Subagent sessions keep the queue transport (no steering face).
    /** 中文说明：测试局部值 subagent，取值由紧邻初始化决定。 */
    const subagent = {
      address: {
        parentSessionId: 'parent' as SessionId,
        childSessionId: SID,
        mode: 'continuable' as const,
      },
      parentAvailable: true,
    }
    /** 中文说明：测试局部值 child，取值由紧邻初始化决定。 */
    const child = bench({ running: true, subagent, queue: [row('q-1')], steerQueue: vi.fn() })
    fireEvent.keyDown(child.textarea, { key: 'Enter', metaKey: true })
    expect(child.steerQueue).not.toHaveBeenCalled()
    expect(child.sink).not.toHaveBeenCalled()

    // No queued rows: the empty draft stays a no-op.
    /** 中文说明：测试局部值 none，取值由紧邻初始化决定。 */
    const none = bench({ running: true, steerQueue: vi.fn() })
    fireEvent.keyDown(none.textarea, { key: 'Enter', metaKey: true })
    expect(none.steerQueue).not.toHaveBeenCalled()
    expect(none.sink).not.toHaveBeenCalled()

    // Pending steering rows are not the queue: nothing to flush.
    /** 中文说明：测试局部值 steering，取值由紧邻初始化决定。 */
    const steering = bench({
      running: true,
      queue: [{ ...row('s-1'), placement: 'steering' }],
      steerQueue: vi.fn(),
    })
    fireEvent.keyDown(steering.textarea, { key: 'Enter', metaKey: true })
    expect(steering.steerQueue).not.toHaveBeenCalled()
    expect(steering.sink).not.toHaveBeenCalled()
  })

  it('draft content outranks the queue: accelerated Enter steers the draft only', () => {
    /** 中文说明：测试局部值 steerQueue，取值由紧邻初始化决定。 */
    const steerQueue = vi.fn()
    /** 中文说明：测试局部值 { textarea, sink }，取值由紧邻初始化决定。 */
    const { textarea, sink } = bench({ running: true, queue: [row('q-1')], draft: '插话', steerQueue })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(sink).toHaveBeenCalledWith('插话', [], 'steer', expect.any(AbortSignal))
    expect(steerQueue).not.toHaveBeenCalled()
  })

  it('empty-draft accelerated Enter without a steerQueue face stays a silent no-op', () => {
    /** 中文说明：测试局部值 { textarea, sink }，取值由紧邻初始化决定。 */
    const { textarea, sink } = bench({ running: true, queue: [row('q-1')] })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    expect(sink).not.toHaveBeenCalled()
  })

  it('platform undo/redo chords route to the machine, never the browser stack', () => {
    /** 中文说明：测试局部值 { textarea, shell }，取值由紧邻初始化决定。 */
    const { textarea, shell } = bench({ draft: '' })
    fireEvent.change(textarea, { target: { value: 'first' } })
    fireEvent.change(textarea, { target: { value: 'first second' } })
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true })
    expect(shell.snapshot.draft).not.toBe('first second')
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(shell.snapshot.draft).toBe('first second')
  })

  it('composition Enter never sends: ref guard, isComposing, and keyCode 229 paths', () => {
    vi.useFakeTimers()
    try {
      /** 中文说明：测试局部值 { textarea, sink }，取值由紧邻初始化决定。 */
      const { textarea, sink } = bench({ draft: 'hello' })
      fireEvent.compositionStart(textarea)
      fireEvent.keyDown(textarea, { key: 'Enter' })
      expect(sink).not.toHaveBeenCalled()
      fireEvent.compositionEnd(textarea)
      // Safari delivers the closing keydown before the deferred clear.
      fireEvent.keyDown(textarea, { key: 'Enter' })
      expect(sink).not.toHaveBeenCalled()
      vi.advanceTimersByTime(20)
      fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 })
      expect(sink).not.toHaveBeenCalled()
      fireEvent.keyDown(textarea, { key: 'Enter' })
      expect(sink).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('running and lock semantics', () => {
  it('running keeps the input free (typing + Enter queue) while the primary turns stop', () => {
    /** 中文说明：测试局部值 解构结果，取值由紧邻初始化决定。 */
    const { textarea, button, stop, sink } = bench({ running: true, draft: '排队消息' })
    expect(textarea.disabled).toBe(false)
    fireEvent.change(textarea, { target: { value: '排队消息2' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(sink).toHaveBeenCalledWith('排队消息2', [], 'queue', expect.any(AbortSignal))
    expect(button.getAttribute('aria-label')).toBe('停止生成')
    fireEvent.click(button)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('running plain Enter follows the busy-state Steer preference', () => {
    /** 中文说明：测试局部值 { textarea, sink }，取值由紧邻初始化决定。 */
    const { textarea, sink } = bench({ running: true, busyEnter: 'steer', draft: '直接插话' })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(sink).toHaveBeenCalledWith('直接插话', [], 'steer', expect.any(AbortSignal))
  })

  it('running Cmd/Ctrl+Enter uses the opposite of the busy-state Enter preference', () => {
    /** 中文说明：测试局部值 meta，取值由紧邻初始化决定。 */
    const meta = bench({ running: true, busyEnter: 'steer', draft: '排到下一轮' })
    fireEvent.keyDown(meta.textarea, { key: 'Enter', metaKey: true })
    expect(meta.sink).toHaveBeenCalledWith('排到下一轮', [], 'queue', expect.any(AbortSignal))

    /** 中文说明：测试局部值 ctrl，取值由紧邻初始化决定。 */
    const ctrl = bench({ running: true, busyEnter: 'steer', draft: 'also queue' })
    fireEvent.keyDown(ctrl.textarea, { key: 'Enter', ctrlKey: true })
    expect(ctrl.sink).toHaveBeenCalledWith('also queue', [], 'queue', expect.any(AbortSignal))
  })

  it('running continuable subagent keeps Send beside an independent Stop', () => {
    /** 中文说明：测试局部值 解构结果，取值由紧邻初始化决定。 */
    const { button, interruptButton, textarea, sink, stop } = bench({
      running: true,
      draft: '后续消息',
      subagent: {
        address: {
          parentSessionId: 'parent' as SessionId,
          childSessionId: SID,
          mode: 'continuable',
        },
        parentAvailable: true,
      },
    })
    expect(button.getAttribute('aria-label')).toBe('发送消息')
    expect(interruptButton).not.toBeNull()
    expect(textarea.disabled).toBe(false)
    fireEvent.click(button)
    expect(sink).toHaveBeenCalledWith('后续消息', [], 'queue', expect.any(AbortSignal))
    fireEvent.click(interruptButton!)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('parent-offline running continuable locks Send but keeps independent Stop usable', () => {
    /** 中文说明：测试局部值 解构结果，取值由紧邻初始化决定。 */
    const { button, interruptButton, textarea, stop, view } = bench({
      running: true,
      draft: '',
      subagent: {
        address: {
          parentSessionId: 'parent' as SessionId,
          childSessionId: SID,
          mode: 'continuable',
        },
        parentAvailable: false,
      },
    })
    expect(textarea.disabled).toBe(true)
    expect(textarea.placeholder).toBe('父会话已离线，无法继续发送；仍可停止当前运行')
    expect((view.getByLabelText('命令') as HTMLButtonElement).disabled).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('发送消息')
    expect(button.disabled).toBe(true)
    expect(interruptButton?.disabled).toBe(false)
    fireEvent.click(interruptButton!)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('running one-shot subagent never exposes Stop', () => {
    /** 中文说明：测试局部值 解构结果，取值由紧邻初始化决定。 */
    const { button, interruptButton, stop } = bench({
      running: true,
      draft: '不可停止',
      subagent: {
        address: {
          parentSessionId: 'parent' as SessionId,
          childSessionId: SID,
          mode: 'one-shot',
        },
        parentAvailable: true,
      },
    })
    expect(button.getAttribute('aria-label')).toBe('发送消息')
    expect(interruptButton).toBeNull()
    expect(stop).not.toHaveBeenCalled()
  })

  it('keeps both running subagent Enter gestures on Queue transport', () => {
    /** 中文说明：测试局部值 subagent，取值由紧邻初始化决定。 */
    const subagent = {
      address: {
        parentSessionId: 'parent' as SessionId,
        childSessionId: SID,
        mode: 'continuable' as const,
      },
      parentAvailable: true,
    }
    /** 中文说明：测试局部值 plain，取值由紧邻初始化决定。 */
    const plain = bench({ running: true, busyEnter: 'steer', draft: 'plain', subagent })
    fireEvent.keyDown(plain.textarea, { key: 'Enter' })
    expect(plain.sink).toHaveBeenCalledWith('plain', [], 'queue', expect.any(AbortSignal))

    /** 中文说明：测试局部值 accelerated，取值由紧邻初始化决定。 */
    const accelerated = bench({ running: true, draft: 'accelerated', subagent })
    fireEvent.keyDown(accelerated.textarea, { key: 'Enter', metaKey: true })
    expect(accelerated.sink).toHaveBeenCalledWith('accelerated', [], 'queue', expect.any(AbortSignal))
  })

  it('disabled (session removed) locks the textarea and chrome', () => {
    /** 中文说明：测试局部值 { textarea, view }，取值由紧邻初始化决定。 */
    const { textarea, view } = bench({ disabled: true })
    expect(textarea.disabled).toBe(true)
    expect(textarea.placeholder).toBe('会话不可用')
    expect((view.getByLabelText('命令') as HTMLButtonElement).disabled).toBe(true)
  })

  it('idle primary sends and disables on empty draft', () => {
    /** 中文说明：测试局部值 { button, sink }，取值由紧邻初始化决定。 */
    const { button, sink } = bench({ draft: 'go' })
    fireEvent.click(button)
    expect(sink).toHaveBeenCalledWith('go', [], 'queue', expect.any(AbortSignal))
    /** 中文说明：测试局部值 empty，取值由紧邻初始化决定。 */
    const empty = bench()
    expect(empty.button.disabled).toBe(true)
  })

  it('unlock refocuses the textarea; mousedown on the button keeps focus', () => {
    /** 中文说明：测试局部值 first，取值由紧邻初始化决定。 */
    const first = bench({ disabled: true, draft: 'x' })
    act(() => { first.session.set(snapshotOf({ removed: false })) })
    /** 中文说明：测试局部值 textarea，取值由紧邻初始化决定。 */
    const textarea = first.view.container.querySelector('textarea')!
    expect(document.activeElement).toBe(textarea)
    textarea.blur()
    fireEvent.mouseDown(first.view.container.querySelector('button[aria-label="发送消息"]')!)
    expect(document.activeElement).toBe(textarea)
  })

  it('typing forwards through the machine (draft state echoes back)', () => {
    /** 中文说明：测试局部值 { textarea, wiring }，取值由紧邻初始化决定。 */
    const { textarea, wiring } = bench()
    fireEvent.change(textarea, { target: { value: 'typed' } })
    expect(wiring.state.getSnapshot().draft).toBe('typed')
    expect((textarea).value).toBe('typed')
  })

  it('wheel over a non-overflowing draft forwards to the conversation host', () => {
    /** 中文说明：测试局部值 host，取值由紧邻初始化决定。 */
    const host = document.createElement('div')
    host.setAttribute('data-conversation-scroll', '')
    Object.defineProperty(host, 'scrollTop', { value: 40, writable: true, configurable: true })
    /** 中文说明：测试局部值 { view, textarea }，取值由紧邻初始化决定。 */
    const { view, textarea } = bench()
    host.appendChild(view.container)
    document.body.appendChild(host)
    try {
      /** 中文说明：测试局部值 wheeled，取值由紧邻初始化决定。 */
      const wheeled = fireEvent.wheel(textarea, { deltaY: 30 })
      expect(wheeled).toBe(false) // preventDefault
      expect(host.scrollTop).toBe(70)
    } finally {
      host.remove()
    }
  })

  it('wheel chains: long drafts scroll inside the draft scrollport until each edge, then the host', () => {
    /** 中文说明：测试局部值 host，取值由紧邻初始化决定。 */
    const host = document.createElement('div')
    host.setAttribute('data-conversation-scroll', '')
    Object.defineProperty(host, 'scrollTop', { value: 40, writable: true, configurable: true })
    /** 中文说明：测试局部值 { view, textarea }，取值由紧邻初始化决定。 */
    const { view, textarea } = bench()
    host.appendChild(view.container)
    document.body.appendChild(host)
    /** 中文说明：测试局部值 scrollport，取值由紧邻初始化决定。 */
    const scrollport = view.container.querySelector<HTMLElement>('[data-input-scroll]')!
    Object.defineProperty(scrollport, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(scrollport, 'scrollHeight', { value: 400, configurable: true })
    /** 中文说明：测试局部值 scrollTop，取值由紧邻初始化决定。 */
    let scrollTop = 150
    Object.defineProperty(scrollport, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value },
    })
    try {
      // Mid-draft: both directions stay local — host must not move.
      expect(fireEvent.wheel(textarea, { deltaY: 30 })).toBe(true)
      expect(fireEvent.wheel(textarea, { deltaY: -30 })).toBe(true)
      expect(host.scrollTop).toBe(40)
      // At the bottom edge, further down-scroll forwards to the host.
      scrollTop = 300
      expect(fireEvent.wheel(textarea, { deltaY: 30 })).toBe(false)
      expect(host.scrollTop).toBe(70)
      // At the top edge, further up-scroll forwards to the host.
      scrollTop = 0
      host.scrollTop = 70
      expect(fireEvent.wheel(textarea, { deltaY: -20 })).toBe(false)
      expect(host.scrollTop).toBe(50)
    } finally {
      host.remove()
    }
  })

  it('the caret layer and the glyph layer ride one scrollport', () => {
    /** 中文说明：测试局部值 { view, textarea }，取值由紧邻初始化决定。 */
    const { view, textarea } = bench({ draft: 'line\n'.repeat(40) })
    /** 中文说明：测试局部值 scroll，取值由紧邻初始化决定。 */
    const scroll = view.container.querySelector<HTMLElement>('[data-input-scroll]')!
    /** 中文说明：测试局部值 backdrop，取值由紧邻初始化决定。 */
    const backdrop = view.container.querySelector<HTMLElement>('[data-input-backdrop]')!
    // The caret is the textarea's and every visible glyph is the backdrop's, so
    // one box has to carry both or an offset can exist in one and not the other.
    // jsdom has no layout and loads no stylesheet — which box scrolls is the
    // browser scenario's to assert; what is checkable here is that the
    // scrollport element holds both layers.
    expect(scroll.contains(textarea)).toBe(true)
    expect(scroll.contains(backdrop)).toBe(true)
    // The glyph layer carries the draft and nothing else — no height padding
    // to a second box's scroll extent.
    expect(backdrop.textContent).toBe('line\n'.repeat(40))
  })

  it('repairs Safari native overflow after the mirror shrinks the draft', () => {
    /** 中文说明：测试局部值 vendor，取值由紧邻初始化决定。 */
    const vendor = vi.spyOn(window.navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.')
    /** 中文说明：测试局部值 userAgent，取值由紧邻初始化决定。 */
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15',
    )
    onTestFinished(() => {
      vendor.mockRestore()
      userAgent.mockRestore()
    })
    /** 中文说明：测试局部值 { textarea }，取值由紧邻初始化决定。 */
    const { textarea } = bench({ draft: 'two wrapped lines' })
    /** 中文说明：测试局部值 scrollport，取值由紧邻初始化决定。 */
    const scrollport = textarea.closest<HTMLElement>('[data-input-scroll]')!
    /** 中文说明：测试局部值 inputRepaired，取值由紧邻初始化决定。 */
    let inputRepaired = false
    /** 中文说明：测试局部值 scrollportRepaired，取值由紧邻初始化决定。 */
    let scrollportRepaired = false
    /** 中文说明：测试局部值 inputLayouts，取值由紧邻初始化决定。 */
    const inputLayouts: string[] = []
    /** 中文说明：测试局部值 scrollportLayouts，取值由紧邻初始化决定。 */
    const scrollportLayouts: string[] = []
    Object.defineProperty(textarea, 'clientHeight', {
      configurable: true,
      get: () => textarea.style.height === '29px' ? 29 : 28,
    })
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => inputRepaired ? 28 : 52,
    })
    Object.defineProperty(textarea, 'offsetHeight', {
      configurable: true,
      get: () => {
        inputLayouts.push(textarea.style.height)
        if (textarea.style.height === '') inputRepaired = true
        return textarea.clientHeight
      },
    })
    Object.defineProperty(scrollport, 'clientHeight', {
      configurable: true,
      get: () => {
        if (scrollport.style.height === '53px') return 53
        if (inputRepaired && !scrollportRepaired) return 52
        return 28
      },
    })
    Object.defineProperty(scrollport, 'offsetHeight', {
      configurable: true,
      get: () => {
        scrollportLayouts.push(scrollport.style.height)
        if (scrollport.style.height === '') scrollportRepaired = true
        return scrollport.clientHeight
      },
    })
    textarea.setSelectionRange(5, 5)

    fireEvent.change(textarea, { target: { value: 'one line' } })

    expect(inputLayouts).toEqual(['29px', ''])
    expect(scrollportLayouts).toEqual(['53px', ''])
    expect(textarea.style.height).toBe('')
    expect(scrollport.style.height).toBe('')
    expect(textarea.scrollHeight).toBe(textarea.clientHeight)
    expect(scrollport.clientHeight).toBe(28)
  })

  it('does not force the Safari recovery for another iOS browser', () => {
    /** 中文说明：测试局部值 vendor，取值由紧邻初始化决定。 */
    const vendor = vi.spyOn(window.navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.')
    /** 中文说明：测试局部值 userAgent，取值由紧邻初始化决定。 */
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
    )
    onTestFinished(() => {
      vendor.mockRestore()
      userAgent.mockRestore()
    })
    /** 中文说明：测试局部值 { textarea }，取值由紧邻初始化决定。 */
    const { textarea } = bench({ draft: 'two wrapped lines' })
    /** 中文说明：测试局部值 scrollport，取值由紧邻初始化决定。 */
    const scrollport = textarea.closest<HTMLElement>('[data-input-scroll]')!
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 28 })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 52 })
    Object.defineProperty(textarea, 'offsetHeight', {
      configurable: true,
      get: () => { throw new Error('non-Safari browser must not force textarea layout') },
    })
    Object.defineProperty(scrollport, 'offsetHeight', {
      configurable: true,
      get: () => { throw new Error('non-Safari browser must not force scrollport layout') },
    })

    fireEvent.change(textarea, { target: { value: 'one line' } })

    expect(scrollport.style.height).toBe('')
  })

  it('does not read Safari layout while a native edit grows the draft', () => {
    /** 中文说明：测试局部值 vendor，取值由紧邻初始化决定。 */
    const vendor = vi.spyOn(window.navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.')
    /** 中文说明：测试局部值 userAgent，取值由紧邻初始化决定。 */
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15',
    )
    onTestFinished(() => {
      vendor.mockRestore()
      userAgent.mockRestore()
    })
    /** 中文说明：测试局部值 { textarea, shell }，取值由紧邻初始化决定。 */
    const { textarea, shell } = bench({ draft: 'one line' })
    Object.defineProperty(textarea, 'clientHeight', {
      configurable: true,
      get: () => { throw new Error('growing Safari input must not read layout') },
    })
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => { throw new Error('growing Safari input must not read layout') },
    })

    fireEvent.change(textarea, { target: { value: 'one line grows' } })

    expect(shell.snapshot.draft).toBe('one line grows')
  })

  it('an edit the composer performs itself scrolls the caret back into view', async () => {
    // Paste and cut suppress the native edit, so no engine reveals the caret
    // for them. jsdom has no layout: the rects are stubbed,
    // and what is asserted is the arithmetic — minimal scroll, in both
    // directions, and nothing at all for a caret already inside the box.
    /** 中文说明：测试局部值 { view, textarea }，取值由紧邻初始化决定。 */
    const { view, textarea } = bench({ draft: 'line\n'.repeat(40) })
    /** 中文说明：测试局部值 scroll，取值由紧邻初始化决定。 */
    const scroll = view.container.querySelector<HTMLElement>('[data-input-scroll]')!
    /** 中文说明：测试局部值 mirror，取值由紧邻初始化决定。 */
    const mirror = view.container.querySelector<HTMLElement>('[data-input-mirror]')!
    expect(mirror.firstChild).toBeInstanceOf(Text)
    scroll.getBoundingClientRect = () => ({ top: 100, bottom: 436 }) as DOMRect
    // jsdom reports scrollHeight === clientHeight for every element, which is
    // the composer's own "nothing to reveal" case; a scrollable box is what
    // puts the reveal on the table at all.
    Object.defineProperty(scroll, 'clientHeight', { value: 336, configurable: true })
    Object.defineProperty(scroll, 'scrollHeight', { value: 964, configurable: true })
    Object.defineProperty(scroll, 'scrollTop', { value: 0, writable: true, configurable: true })
    onTestFinished(() => {
      Range.prototype.getBoundingClientRect = ZERO_RECT
      Range.prototype.setStart = NATIVE_SET_START
    })
    // Which layer the caret is measured against, and at which index: the stub
    // records `setStart` so a helper that measured the backdrop instead, or
    // always collapsed at 0, fails here rather than only in the browser lane.
    /** 中文说明：测试局部值 measured，取值由紧邻初始化决定。 */
    let measured: { node: Node; offset: number } | null = null
    Range.prototype.setStart = function setStart(node: Node, offset: number): void {
      measured = { node, offset }
      NATIVE_SET_START.call(this, node, offset)
    }
    /** 中文说明：测试局部值 caretAt，取值由紧邻初始化决定。 */
    const caretAt = (top: number): void => {
      Range.prototype.getBoundingClientRect = () => ({ top, bottom: top + 24 }) as DOMRect
    }
    /** 中文说明：测试局部值 settle，取值由紧邻初始化决定。 */
    const settle = async (): Promise<void> => {
      await act(async () => { await new Promise((resolve) => { requestAnimationFrame(() => { resolve(null) }) }) })
    }
    // Pasted text lands below the fold: scroll down by exactly the overshoot.
    caretAt(500)
    fireEvent.paste(textarea, { clipboardData: { items: [], getData: () => 'pasted' } })
    await settle()
    expect(scroll.scrollTop).toBe(88) // 524 - 436
    // Measured on the mirror's own text, at the index the paste left the caret
    // (an empty draft's selection start, 0, plus the pasted length).
    expect(measured!.node).toBe(mirror.firstChild)
    expect(measured!.offset).toBe('pasted'.length)
    // A caret already inside the box does not move it.
    caretAt(200)
    fireEvent.paste(textarea, { clipboardData: { items: [], getData: () => 'more' } })
    await settle()
    expect(scroll.scrollTop).toBe(88)
    // Above the fold (a cut can leave it there): scroll back up.
    caretAt(60)
    fireEvent.paste(textarea, { clipboardData: { items: [], getData: () => 'again' } })
    await settle()
    expect(scroll.scrollTop).toBe(48) // 88 - (100 - 60)
    // A caret straight after a newline has nothing on its line to measure, so
    // the newline it just left is measured instead and one line is added.
    // chromium reports no client rects at all for the collapsed position.
    mirror.style.lineHeight = '24px'
    caretAt(500)
    fireEvent.paste(textarea, { clipboardData: { items: [], getData: () => 'block\n' } })
    await settle()
    // The four pastes accumulate at the draft's head, so the caret is at the
    // end of what they inserted — and the measured index is the newline before it.
    expect(measured!.offset).toBe('pastedmoreagainblock\n'.length - 1)
    expect(scroll.scrollTop).toBe(48 + 112) // from 48, by (524 + 24) - 436
  })

  it('a session switch refocuses without moving the transcript, and reveals the new draft caret', () => {
    // The composer DOM is reused across sessions, so the previous session's
    // offset survives while the value swap puts the caret at the new draft's
    // end. `preventScroll` keeps the browser from revealing it through the
    // conversation scrollport, which leaves the reveal to the effect itself.
    /** 中文说明：测试局部值 { view, textarea, props }，取值由紧邻初始化决定。 */
    const { view, textarea, props } = bench({ draft: 'line\n'.repeat(40) })
    /** 中文说明：测试局部值 scroll，取值由紧邻初始化决定。 */
    const scroll = view.container.querySelector<HTMLElement>('[data-input-scroll]')!
    /** 中文说明：测试局部值 mirror，取值由紧邻初始化决定。 */
    const mirror = view.container.querySelector<HTMLElement>('[data-input-mirror]')!
    onTestFinished(() => { Range.prototype.getBoundingClientRect = ZERO_RECT })
    scroll.getBoundingClientRect = () => ({ top: 100, bottom: 436 }) as DOMRect
    Object.defineProperty(scroll, 'clientHeight', { value: 336, configurable: true })
    Object.defineProperty(scroll, 'scrollHeight', { value: 964, configurable: true })
    Object.defineProperty(scroll, 'scrollTop', { value: 0, writable: true, configurable: true })
    Range.prototype.getBoundingClientRect = () => ({ top: 500, bottom: 524 }) as DOMRect
    // The draft ends in a newline, so the reveal takes the after-newline path
    // and needs a resolvable line-height (jsdom computes `normal`).
    mirror.style.lineHeight = '24px'
    // Which index the effect reveals at, not merely that it scrolled: a
    // revealCaret(0) would land the same offset without this.
    onTestFinished(() => { Range.prototype.setStart = NATIVE_SET_START })
    /** 中文说明：测试局部值 measured，取值由紧邻初始化决定。 */
    let measured: { node: Node; offset: number } | null = null
    Range.prototype.setStart = function setStart(node: Node, offset: number): void {
      measured = { node, offset }
      NATIVE_SET_START.call(this, node, offset)
    }
    /** 中文说明：测试局部值 focused，取值由紧邻初始化决定。 */
    const focused: (boolean | undefined)[] = []
    textarea.focus = (options?: FocusOptions) => { focused.push(options?.preventScroll) }
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    act(() => { view.rerender(<InputBar {...props} sessionId={'s2' as SessionId} />) })
    expect(focused).toEqual([true])
    expect(scroll.scrollTop).toBe(112) // (524 + 24) - 436
    // The draft ends in a newline, so the rule measures that newline: the
    // caret's own index is the mirror text's length minus its sentinel.
    expect(measured!.node).toBe(mirror.firstChild)
    expect(measured!.offset).toBe(textarea.value.length - 1)
  })

  it('a persisted draft adopted after mount gets its caret revealed too', () => {
    // ConversationSession seeds the stored draft in its own mount effect, which
    // runs after this component's: the first reveal measures an empty mirror,
    // so the draft's arrival has to run it again without reclaiming focus.
    /** 中文说明：测试局部值 { view, textarea, shell }，取值由紧邻初始化决定。 */
    const { view, textarea, shell } = bench()
    /** 中文说明：测试局部值 scroll，取值由紧邻初始化决定。 */
    const scroll = view.container.querySelector<HTMLElement>('[data-input-scroll]')!
    /** 中文说明：测试局部值 mirror，取值由紧邻初始化决定。 */
    const mirror = view.container.querySelector<HTMLElement>('[data-input-mirror]')!
    // The restored draft ends in a newline, so the reveal takes the
    // after-newline path and needs a resolvable line-height (jsdom says `normal`).
    mirror.style.lineHeight = '24px'
    onTestFinished(() => { Range.prototype.getBoundingClientRect = ZERO_RECT })
    scroll.getBoundingClientRect = () => ({ top: 100, bottom: 436 }) as DOMRect
    Object.defineProperty(scroll, 'clientHeight', { value: 336, configurable: true })
    Object.defineProperty(scroll, 'scrollHeight', { value: 964, configurable: true })
    Object.defineProperty(scroll, 'scrollTop', { value: 0, writable: true, configurable: true })
    Range.prototype.getBoundingClientRect = () => ({ top: 500, bottom: 524 }) as DOMRect
    /** 中文说明：测试局部值 other，取值由紧邻初始化决定。 */
    const other = document.createElement('input')
    document.body.appendChild(other)
    onTestFinished(() => { other.remove() })
    other.focus()
    expect(scroll.scrollTop).toBe(0)
    act(() => { shell.setDraft('restored\n'.repeat(40)) })
    expect(document.activeElement).toBe(other)
    // The caret the machine left at the draft's end, revealed once the draft exists.
    expect(textarea.selectionStart).toBe(textarea.value.length)
    expect(scroll.scrollTop).toBe(112) // (524 + 24) - 436
  })

  it('disabled state shows the unavailable placeholder; custom placeholder wins', () => {
    /** 中文说明：测试局部值 { textarea }，取值由紧邻初始化决定。 */
    const { textarea } = bench({ disabled: true })
    expect(textarea.placeholder).toBe('会话不可用')
    /** 中文说明：测试局部值 live，取值由紧邻初始化决定。 */
    const live = bench()
    expect(live.textarea.placeholder).toBe('给智能体发消息')
    /** 中文说明：测试局部值 custom，取值由紧邻初始化决定。 */
    const custom = bench({ placeholder: 'Custom placeholder' })
    expect(custom.textarea.placeholder).toBe('Custom placeholder')
  })

  it('the inert textarea opens the Workspace picker by pointer or keyboard', () => {
    /** 中文说明：测试局部值 onRequestWorkspace，取值由紧邻初始化决定。 */
    const onRequestWorkspace = vi.fn()
    /** 中文说明：测试局部值 { view, textarea }，取值由紧邻初始化决定。 */
    const { view, textarea } = bench({
      inert: true,
      workspacePickerOpen: false,
      onRequestWorkspace,
      placeholder: '选择一个工作区开始',
    })
    expect(textarea.disabled).toBe(false)
    expect(textarea.readOnly).toBe(true)
    expect(textarea.getAttribute('aria-haspopup')).toBe('menu')
    expect(textarea.getAttribute('aria-expanded')).toBe('false')
    expect((view.getByLabelText('命令') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent.keyDown(textarea, { key: ' ' })
    expect(onRequestWorkspace).toHaveBeenCalledTimes(3)

    // The WHOLE capsule is the pick target, and its pointerdown never reaches
    // the document — the open picker's outside-close must not race the reopen.
    /** 中文说明：测试局部值 card，取值由紧邻初始化决定。 */
    const card = view.container.querySelector('[data-composer-card]') as HTMLElement
    fireEvent.click(card)
    expect(onRequestWorkspace).toHaveBeenCalledTimes(4)
    /** 中文说明：测试局部值 onDocumentPointerDown，取值由紧邻初始化决定。 */
    const onDocumentPointerDown = vi.fn()
    document.addEventListener('pointerdown', onDocumentPointerDown)
    try {
      fireEvent.pointerDown(card)
    } finally {
      document.removeEventListener('pointerdown', onDocumentPointerDown)
    }
    expect(onDocumentPointerDown).not.toHaveBeenCalled()
  })

  it('the plan projection swaps the placeholder while its effective target is plan mode', () => {
    /** 中文说明：测试局部值 active，取值由紧邻初始化决定。 */
    const active = bench({ plan: { active: true, pending: false } })
    expect(active.textarea.placeholder).toBe('描述你的任务以生成计划')
    // /plan just ran: pending entry already reads as the plan target.
    /** 中文说明：测试局部值 entering，取值由紧邻初始化决定。 */
    const entering = bench({ plan: { active: false, pending: true } })
    expect(entering.textarea.placeholder).toBe('描述你的任务以生成计划')
    // Pending exit: target is default again.
    /** 中文说明：测试局部值 leaving，取值由紧邻初始化决定。 */
    const leaving = bench({ plan: { active: true, pending: true } })
    expect(leaving.textarea.placeholder).toBe('给智能体发消息')
    // Owner placeholder outranks the plan swap.
    /** 中文说明：测试局部值 custom，取值由紧邻初始化决定。 */
    const custom = bench({ plan: { active: true, pending: false }, placeholder: 'Custom placeholder' })
    expect(custom.textarea.placeholder).toBe('Custom placeholder')
  })
})

describe('machine pending lock', () => {
  it('submitting renders read-only textarea, pending dot, and a disabled primary', () => {
    /** 中文说明：测试局部值 { view, shell }，取值由紧邻初始化决定。 */
    const { view, shell } = bench()
    // Drive the machine into submitting through a claim + enter.
    act(() => {
      shell.setDraft('/goal ')
      shell.beginCommand(
        {
          token: '/goal ',
          submit: () => new Promise<never>(() => {}), // never settles: stays submitting
        },
        { start: 0, end: 6, draftRev: shell.snapshot.draftRev },
      )
      shell.submit()
    })
    expect(shell.snapshot.phase).toBe('submitting')
    /** 中文说明：测试局部值 textarea，取值由紧邻初始化决定。 */
    const textarea = view.container.querySelector('textarea')!
    expect(textarea.readOnly).toBe(true)
    expect(view.container.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')!.disabled).toBe(true)
  })
})

describe('decorations', () => {
  it('claimed token renders the mirror highlight and the blank-args hint', () => {
    // Dictionary-less stub: an unmatched hint key keeps the machine's raw hint.
    /** 中文说明：测试局部值 { view, shell }，取值由紧邻初始化决定。 */
    const { view, shell } = bench({ t: makeTranslate({}) })
    act(() => {
      shell.setDraft('/goal ')
      shell.beginCommand(
        { token: '/goal ', hint: '目标内容', submit: () => Promise.resolve({ kind: 'success' as const }) },
        { start: 0, end: 6, draftRev: shell.snapshot.draftRev },
      )
    })
    /** 中文说明：测试局部值 token，取值由紧邻初始化决定。 */
    const token = view.container.querySelector('[data-decoration="token"]')
    expect(token?.textContent).toBe('/goal ')
    expect(view.container.querySelector('[data-decoration="hint"]')?.textContent).toBe('目标内容')
    // Args typed: the hint disappears, the token highlight stays.
    act(() => { shell.setDraft('/goal 发布') })
    expect(view.container.querySelector('[data-decoration="hint"]')).toBeNull()
    expect(view.container.querySelector('[data-decoration="token"]')).not.toBeNull()
  })

  it('a locale entry for the claimed command overrides the raw claim hint (trailing-space token)', () => {
    /** 中文说明：测试局部值 { view, shell }，取值由紧邻初始化决定。 */
    const { view, shell } = bench()
    act(() => {
      shell.setDraft('/goal ')
      shell.beginCommand(
        { token: '/goal ', hint: '[<objective>|clear|edit <objective>|pause|resume]', submit: () => Promise.resolve({ kind: 'success' as const }) },
        { start: 0, end: 6, draftRev: shell.snapshot.draftRev },
      )
    })
    expect(view.container.querySelector('[data-decoration="hint"]')?.textContent).toBe('输入目标，智能体将持续执行')
  })

  it('an inserted reference decorates its complete inline display range', () => {
    /** 中文说明：测试局部值 { view, shell }，取值由紧邻初始化决定。 */
    const { view, shell } = bench()
    /** 中文说明：测试局部值 reference，取值由紧邻初始化决定。 */
    const reference = {
      source: 'reference', ref: 'w1', label: '会话一', appearance: 'session' as const, clipboardText: '@w1',
    }
    act(() => {
      shell.setDraft('参考 @w1 内容')
      shell.insertReference(
        reference,
        { start: 3, end: 6, draftRev: shell.snapshot.draftRev },
      )
    })
    /** 中文说明：测试局部值 chip，取值由紧邻初始化决定。 */
    const chip = view.container.querySelector('[data-decoration="chip"]')
    expect(chip?.textContent).toBe('@会话一')
    expect(chip?.getAttribute('data-reference-appearance')).toBe('session')
    expect(chip?.querySelector('svg')).not.toBeNull()
    expect(shell.snapshot.occurrences).toHaveLength(1)
    expect(shell.snapshot.draft).toBe('参考 @会话一 内容')
    expect(shell.snapshot.occurrences[0]).toMatchObject({ offset: 3, length: 4 })
  })

  it('keeps the textarea glyph layer transparent when a structured reference becomes disabled', () => {
    /** 中文说明：测试局部值 解构结果，取值由紧邻初始化决定。 */
    const { view, shell, session, textarea } = bench()
    act(() => {
      shell.setDraft('@w1')
      shell.insertReference({
        source: 'reference', ref: 'w1', label: '会话一', appearance: 'session', clipboardText: '@w1',
      }, { start: 0, end: 3, draftRev: shell.snapshot.draftRev })
      session.set(snapshotOf({ removed: true }))
    })
    /** 中文说明：测试局部值 backdrop，取值由紧邻初始化决定。 */
    const backdrop = view.container.querySelector('[data-input-backdrop]')
    expect(textarea.disabled).toBe(true)
    expect(backdrop?.getAttribute('data-disabled')).toBe('true')
    expect(backdrop?.querySelector('[data-decoration="chip"] svg')).not.toBeNull()
  })

  it('Backspace and Delete remove a reference as one range at its boundaries', () => {
    /** 中文说明：测试局部值 reference，取值由紧邻初始化决定。 */
    const reference = {
      source: 'reference', ref: 'w1', label: '会话一', appearance: 'session' as const, clipboardText: '@w1',
    }
    /** 中文说明：测试局部值 backspace，取值由紧邻初始化决定。 */
    const backspace = bench()
    act(() => {
      backspace.shell.setDraft('前 @w1 后')
      backspace.shell.insertReference(
        reference,
        { start: 2, end: 5, draftRev: backspace.shell.snapshot.draftRev },
      )
    })
    backspace.textarea.setSelectionRange(6, 6)
    fireEvent.keyDown(backspace.textarea, { key: 'Backspace' })
    expect(backspace.shell.snapshot).toMatchObject({ draft: '前  后', occurrences: [] })

    /** 中文说明：测试局部值 forwardDelete，取值由紧邻初始化决定。 */
    const forwardDelete = bench()
    act(() => {
      forwardDelete.shell.setDraft('前 @w1 后')
      forwardDelete.shell.insertReference(
        reference,
        { start: 2, end: 5, draftRev: forwardDelete.shell.snapshot.draftRev },
      )
    })
    forwardDelete.textarea.setSelectionRange(2, 2)
    fireEvent.keyDown(forwardDelete.textarea, { key: 'Delete' })
    expect(forwardDelete.shell.snapshot).toMatchObject({ draft: '前  后', occurrences: [] })
  })

  it('typing the trigger char immediately before a reference keeps it structured', () => {
    /** 中文说明：测试局部值 { shell, textarea }，取值由紧邻初始化决定。 */
    const { shell, textarea } = bench()
    act(() => {
      shell.setDraft('@w1')
      shell.insertReference({
        source: 'reference', ref: 'w1', label: '会话一', appearance: 'session', clipboardText: '@w1',
      }, { start: 0, end: 3, draftRev: shell.snapshot.draftRev })
    })
    expect(shell.snapshot.draft).toBe('@会话一 ')
    // The inserted char equals the reference's own leading trigger, so the two
    // drafts alone cannot say whether it landed before or after that trigger.
    textarea.setSelectionRange(0, 0)
    act(() => {
      beforeInput(textarea)
      fireEvent.change(textarea, { target: { value: '@@会话一 ' } })
    })
    expect(shell.snapshot.draft).toBe('@@会话一 ')
    expect(shell.snapshot.occurrences).toHaveLength(1)
    expect(shell.snapshot.occurrences[0]).toMatchObject({ offset: 1, length: 4 })
  })

  it('a selection-replacing delete before a reference keeps it structured', () => {
    /** 中文说明：测试局部值 { shell, textarea }，取值由紧邻初始化决定。 */
    const { shell, textarea } = bench()
    act(() => {
      shell.setDraft('@@w1')
      shell.insertReference({
        source: 'reference', ref: 'w1', label: '会话一', appearance: 'session', clipboardText: '@w1',
      }, { start: 1, end: 4, draftRev: shell.snapshot.draftRev })
    })
    expect(shell.snapshot.draft).toBe('@@会话一 ')
    textarea.setSelectionRange(0, 1)
    act(() => {
      beforeInput(textarea, 'deleteContentBackward')
      fireEvent.change(textarea, { target: { value: '@会话一 ' } })
    })
    expect(shell.snapshot.draft).toBe('@会话一 ')
    expect(shell.snapshot.occurrences).toHaveLength(1)
    expect(shell.snapshot.occurrences[0]).toMatchObject({ offset: 0, length: 4 })
  })

  it('a caret Backspace before a reference keeps it structured', () => {
    /** 中文说明：测试局部值 { shell, textarea }，取值由紧邻初始化决定。 */
    const { shell, textarea } = bench()
    act(() => {
      shell.setDraft('@@w1')
      shell.insertReference({
        source: 'reference', ref: 'w1', label: '会话一', appearance: 'session', clipboardText: '@w1',
      }, { start: 1, end: 4, draftRev: shell.snapshot.draftRev })
    })
    expect(shell.snapshot.draft).toBe('@@会话一 ')
    // A caret delete reports the bare caret, never the character it removes.
    textarea.setSelectionRange(1, 1)
    act(() => {
      beforeInput(textarea, 'deleteContentBackward')
      fireEvent.change(textarea, { target: { value: '@会话一 ' } })
    })
    expect(shell.snapshot.draft).toBe('@会话一 ')
    expect(shell.snapshot.occurrences).toHaveLength(1)
    expect(shell.snapshot.occurrences[0]).toMatchObject({ offset: 0, length: 4 })
  })

  it('a caret Delete before a reference keeps it structured', () => {
    /** 中文说明：测试局部值 { shell, textarea }，取值由紧邻初始化决定。 */
    const { shell, textarea } = bench()
    act(() => {
      shell.setDraft('@@w1')
      shell.insertReference({
        source: 'reference', ref: 'w1', label: '会话一', appearance: 'session', clipboardText: '@w1',
      }, { start: 1, end: 4, draftRev: shell.snapshot.draftRev })
    })
    textarea.setSelectionRange(0, 0)
    act(() => {
      beforeInput(textarea, 'deleteContentForward')
      fireEvent.change(textarea, { target: { value: '@会话一 ' } })
    })
    expect(shell.snapshot.draft).toBe('@会话一 ')
    expect(shell.snapshot.occurrences).toHaveLength(1)
    expect(shell.snapshot.occurrences[0]).toMatchObject({ offset: 0, length: 4 })
  })

  it('a caret word delete before a reference keeps it structured', () => {
    /** 中文说明：测试局部值 { shell, textarea }，取值由紧邻初始化决定。 */
    const { shell, textarea } = bench()
    act(() => {
      shell.setDraft('word @w1')
      shell.insertReference({
        source: 'reference', ref: 'w1', label: '会话一', appearance: 'session', clipboardText: '@w1',
      }, { start: 5, end: 8, draftRev: shell.snapshot.draftRev })
    })
    expect(shell.snapshot.draft).toBe('word @会话一 ')
    // One caret gesture can remove more than one character; the deleted span
    // is whatever the draft lost, never a fixed step.
    textarea.setSelectionRange(5, 5)
    act(() => {
      beforeInput(textarea, 'deleteWordBackward')
      fireEvent.change(textarea, { target: { value: '@会话一 ' } })
    })
    expect(shell.snapshot.draft).toBe('@会话一 ')
    expect(shell.snapshot.occurrences).toHaveLength(1)
    expect(shell.snapshot.occurrences[0]).toMatchObject({ offset: 0, length: 4 })
  })

  it('copy and cut expand a partial reference selection to its structured range', () => {
    /** 中文说明：测试局部值 { shell, textarea }，取值由紧邻初始化决定。 */
    const { shell, textarea } = bench()
    act(() => {
      shell.setDraft('前 @w1 后')
      shell.insertReference({
        source: 'reference', ref: 'w1', label: '会话一', appearance: 'session', clipboardText: '@w1',
      }, { start: 2, end: 5, draftRev: shell.snapshot.draftRev })
    })
    /** 中文说明：测试局部值 setData，取值由紧邻初始化决定。 */
    const setData = vi.fn()
    textarea.setSelectionRange(3, 4)
    fireEvent.copy(textarea, { clipboardData: { setData } })
    expect(setData).toHaveBeenCalledWith('text/plain', '@w1')
    expect(shell.snapshot.draft).toBe('前 @会话一 后')

    textarea.setSelectionRange(3, 4)
    fireEvent.cut(textarea, { clipboardData: { setData } })
    expect(setData).toHaveBeenLastCalledWith('text/plain', '@w1')
    expect(shell.snapshot).toMatchObject({ draft: '前  后', occurrences: [] })
  })

  it('a lexicon-matched plain token renders the text-ref mark', () => {
    /** 中文说明：测试局部值 lexicon，取值由紧邻初始化决定。 */
    const lexicon = new Map<'/' | '@', readonly string[]>([['/', ['fixture-demo']]])
    /** 中文说明：测试局部值 { view, shell }，取值由紧邻初始化决定。 */
    const { view, shell } = bench({ lexicon })
    act(() => { shell.setDraft('use /fixture-demo now') })
    /** 中文说明：测试局部值 mark，取值由紧邻初始化决定。 */
    const mark = view.container.querySelector('[data-decoration="text-ref"]')
    expect(mark?.textContent).toBe('/fixture-demo')
    // Editing the token out of match shape drops the decoration.
    act(() => { shell.setDraft('use /fixture-dem now') })
    expect(view.container.querySelector('[data-decoration="text-ref"]')).toBeNull()
  })

  it('a directory completion renders a folder glyph without changing its plain text', () => {
    /** 中文说明：测试局部值 { view, shell }，取值由紧邻初始化决定。 */
    const { view, shell } = bench()
    act(() => { shell.setDraft('see @src/components/') })
    /** 中文说明：测试局部值 mark，取值由紧邻初始化决定。 */
    const mark = view.container.querySelector('[data-decoration="text-ref"]')
    expect(mark?.textContent).toBe('@src/components/')
    expect(mark?.querySelector('svg')).not.toBeNull()
    expect(shell.snapshot.draft).toBe('see @src/components/')
  })

  it('a plain-text reference keeps its nodes while earlier text shifts its offset', () => {
    /** 中文说明：测试局部值 { view, textarea, shell }，取值由紧邻初始化决定。 */
    const { view, textarea, shell } = bench()
    act(() => { shell.setDraft('see @src/components/ here') })
    /** 中文说明：测试局部值 backdrop，取值由紧邻初始化决定。 */
    const backdrop = view.container.querySelector('[data-input-backdrop]')!
    /** 中文说明：测试局部值 mark，取值由紧邻初始化决定。 */
    const mark = backdrop.querySelector('[data-decoration="text-ref"]')!
    /** 中文说明：测试局部值 icon，取值由紧邻初始化决定。 */
    const icon = mark.querySelector('svg')!
    act(() => { fireEvent.change(textarea, { target: { value: 'X see @src/components/ here' } }) })
    // Node identity, not text: an offset-derived key remounts the mark and its
    // icon on every keystroke landing ahead of the range.
    expect(backdrop.querySelector('[data-decoration="text-ref"]')).toBe(mark)
    expect(icon.isConnected).toBe(true)
    expect(mark.textContent).toBe('@src/components/')
    // A token edited out of match shape still loses its decoration.
    act(() => { fireEvent.change(textarea, { target: { value: 'X see X@src/components/ here' } }) })
    expect(backdrop.querySelector('[data-decoration="text-ref"]')).toBeNull()
    expect(shell.snapshot.draft).toBe('X see X@src/components/ here')
  })
})

describe('insertText (scoped event body)', () => {
  it('splices plain text over the span and reports success as true', () => {
    /** 中文说明：测试局部值 { shell }，取值由紧邻初始化决定。 */
    const { shell } = bench({ draft: '/fix' })
    /** 中文说明：测试局部值 ok，取值由紧邻初始化决定。 */
    const ok = shell.insertText('/fixture-demo ', { start: 0, end: 4, draftRev: shell.snapshot.draftRev })
    expect(ok).toBe(true)
    expect(shell.snapshot.draft).toBe('/fixture-demo ')
    expect(shell.snapshot.occurrences).toEqual([])
  })

  it('a stale draftRev refuses whole: false, draft untouched', () => {
    /** 中文说明：测试局部值 { shell }，取值由紧邻初始化决定。 */
    const { shell } = bench({ draft: '/fix' })
    /** 中文说明：测试局部值 span，取值由紧邻初始化决定。 */
    const span = { start: 0, end: 4, draftRev: shell.snapshot.draftRev }
    act(() => { shell.setDraft('/fixX') })
    expect(shell.insertText('/fixture-demo ', span)).toBe(false)
    expect(shell.snapshot.draft).toBe('/fixX')
  })
})

describe('strips and variants', () => {
  it('announces promptError as a fading toast (ordinary failure — no transaction UI, no Retry)', () => {
    vi.useFakeTimers()
    try {
      /** 中文说明：测试局部值 send，取值由紧邻初始化决定。 */
      const send = bench({ promptError: { op: 'send', error: { code: 'agent-busy', message: 'boom', details: { reason: 'boom' } } } })
      // The toast body-portals (transformed ancestors must not trap it), so
      // queries go through the view's document-bound helpers.
      expect(send.view.getByRole('alert').textContent).toContain('boom (agent-busy)')
      expect(send.view.queryByRole('button', { name: 'Retry' })).toBeNull()
      act(() => { vi.advanceTimersByTime(4000) })
      expect(send.view.queryByRole('alert')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('announces an error notice from the machine store as a fading toast', () => {
    vi.useFakeTimers()
    try {
      /** 中文说明：测试局部值 { view, shell }，取值由紧邻初始化决定。 */
      const { view, shell } = bench()
      act(() => { shell.notify('error', '命令失败了') })
      expect(view.getByRole('alert').textContent).toContain('命令失败了')
      expect(view.queryByRole('status')).toBeNull()
      act(() => { vi.advanceTimersByTime(4000) })
      expect(view.queryByRole('alert')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders an information notice from the machine store as a status strip', () => {
    /** 中文说明：测试局部值 { view, shell }，取值由紧邻初始化决定。 */
    const { view, shell } = bench()
    act(() => { shell.notify('info', '命令完成了') })
    expect(view.getByRole('status').textContent).toBe('命令完成了')
    expect(view.queryByRole('alert')).toBeNull()
  })

  it('hero variant adds the hero class and accessory row renders', () => {
    /** 中文说明：测试局部值 { view }，取值由紧邻初始化决定。 */
    const { view } = bench({ variant: 'hero', accessory: <i data-testid="acc" /> })
    expect(view.getByTestId('acc')).toBeTruthy()
    expect(view.container.querySelector('[class*="hero"]')).not.toBeNull()
  })

  it('renders overlay anchor and left/right slot items', () => {
    /** 中文说明：测试局部值 { view }，取值由紧邻初始化决定。 */
    const { view } = bench({
      overlay: <i data-testid="ov" />,
      leftItems: <i data-testid="li" />,
      rightItems: <i data-testid="ri" />,
    })
    expect(view.getByTestId('ov')).toBeTruthy()
    expect(view.getByTestId('li')).toBeTruthy()
    expect(view.getByTestId('ri')).toBeTruthy()
  })
})

describe('command launcher chrome and control seats', () => {
  it('renders the command launcher; the Access chip is absent without the permissions projection; the control seats render EMPTY without entries', () => {
    /** 中文说明：有序集合 { view, slotCalls }，取值由紧邻初始化决定。 */
    const { view, slotCalls } = bench()
    expect(view.getByLabelText('命令')).toBeTruthy()
    // Capability absent (no projection value): the chip renders nothing.
    expect(view.queryByLabelText(/^访问模式/)).toBeNull()
    // Every seat dispatched, nothing rendered.
    expect(slotCalls.map(c => c.key)).toEqual([
      'conversation.input.attachments', 'conversation.input.plan', 'conversation.input.model',
    ])
    expect(view.queryByLabelText('Plan mode')).toBeNull()
    expect(view.queryByLabelText('Model')).toBeNull()
  })

  it('passes the textarea selection to the command menu launcher and reflects its expanded state', () => {
    /** 中文说明：测试局部值 toggleCommandMenu，取值由紧邻初始化决定。 */
    const toggleCommandMenu = vi.fn()
    /** 中文说明：测试局部值 解构结果，取值由紧邻初始化决定。 */
    const { view, textarea, menuLauncher } = bench({ draft: 'draft text', toggleCommandMenu })
    textarea.setSelectionRange(2, 7)
    /** 中文说明：测试局部值 launcher，取值由紧邻初始化决定。 */
    const launcher = view.getByLabelText('命令')
    expect(launcher.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(launcher)
    expect(toggleCommandMenu).toHaveBeenCalledExactlyOnceWith({ start: 2, end: 7 })
    act(() => { menuLauncher.set('command') })
    expect(launcher.getAttribute('aria-expanded')).toBe('true')
  })

  it('the Access chip renders the projection value and submits a non-Full-access pick directly', async () => {
    /** 中文说明：测试局部值 command，取值由紧邻初始化决定。 */
    const command = vi.fn(() => Promise.resolve(true))
    /** 中文说明：测试局部值 permissions，取值由紧邻初始化决定。 */
    const permissions = {
      options: [
        { value: 'read-only', name: 'read-only' },
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'danger-full-access', name: 'danger-full-access' },
      ],
      currentValue: 'read-only',
    }
    /** 中文说明：测试局部值 { view }，取值由紧邻初始化决定。 */
    const { view } = bench({ permissions, command })
    /** 中文说明：测试局部值 trigger，取值由紧邻初始化决定。 */
    const trigger = view.getByLabelText(/^访问模式/) as HTMLButtonElement
    // Title-case display is presentation only; the menu ids stay machine names.
    expect(trigger.textContent).toBe('Read Only')
    expect([...trigger.querySelectorAll('svg')]
      .every(icon => icon.closest('[aria-hidden="true"]') !== null)).toBe(true)
    fireEvent.click(trigger)
    /** 中文说明：当前数据 items，取值由紧邻初始化决定。 */
    const items = view.getAllByRole('menuitem')
    expect(items.map(o => o.textContent)).toEqual(['Read Only', 'Workspace Write', 'Full access'])
    fireEvent.click(items[1]!)
    // Optimistic pick + disable until admission resolves (command stub resolves true).
    /** 中文说明：测试局部值 busy，取值由紧邻初始化决定。 */
    const busy = view.getByLabelText(/^访问模式/) as HTMLButtonElement
    expect(busy.textContent).toBe('Workspace Write')
    expect(busy.disabled).toBe(true)
    expect(command).toHaveBeenCalledWith('/permission workspace-write')
    await act(async () => {})
    expect((view.getByLabelText(/^访问模式/) as HTMLButtonElement).disabled).toBe(false)
  })

  it('requires explicit risk acknowledgement before submitting Full access', async () => {
    /** 中文说明：测试局部值 command，取值由紧邻初始化决定。 */
    const command = vi.fn(() => Promise.resolve(true))
    /** 中文说明：测试局部值 permissions，取值由紧邻初始化决定。 */
    const permissions = {
      options: [
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'danger-full-access', name: 'danger-full-access' },
      ],
      currentValue: 'workspace-write',
    }
    /** 中文说明：测试局部值 { view }，取值由紧邻初始化决定。 */
    const { view } = bench({ permissions, command })
    fireEvent.click(view.getByLabelText(/^访问模式/))
    fireEvent.click(view.getByRole('menuitem', { name: 'Full access' }))

    expect(command).not.toHaveBeenCalled()
    expect(view.getByRole('dialog', { name: '确认启用 Full access？' })).toBeTruthy()
    /** 中文说明：测试局部值 enable，取值由紧邻初始化决定。 */
    const enable = view.getByRole('button', { name: '启用 Full access' }) as HTMLButtonElement
    expect(enable.disabled).toBe(true)

    fireEvent.click(view.getByRole('checkbox', { name: '我已了解风险，并愿意继续' }))
    expect(enable.disabled).toBe(false)
    fireEvent.click(enable)

    expect(command).toHaveBeenCalledOnce()
    expect(command).toHaveBeenCalledWith('/permission danger-full-access')
    expect(view.queryByRole('dialog')).toBeNull()
    expect((view.getByLabelText(/^访问模式/) as HTMLButtonElement).textContent).toBe('Full access')
    await act(async () => {})
  })

  it('cancels a Full access selection without changing permission and resets acknowledgement', () => {
    /** 中文说明：测试局部值 command，取值由紧邻初始化决定。 */
    const command = vi.fn(() => Promise.resolve(true))
    /** 中文说明：测试局部值 permissions，取值由紧邻初始化决定。 */
    const permissions = {
      options: [
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'danger-full-access', name: 'danger-full-access' },
      ],
      currentValue: 'workspace-write',
    }
    /** 中文说明：测试局部值 { view }，取值由紧邻初始化决定。 */
    const { view } = bench({ permissions, command })
    /** 中文说明：测试局部值 openConfirmation，取值由紧邻初始化决定。 */
    const openConfirmation = () => {
      fireEvent.click(view.getByLabelText(/^访问模式/))
      fireEvent.click(view.getByRole('menuitem', { name: 'Full access' }))
    }

    openConfirmation()
    fireEvent.click(view.getByRole('checkbox'))
    fireEvent.click(view.getByRole('button', { name: '取消' }))
    expect(command).not.toHaveBeenCalled()
    expect((view.getByLabelText(/^访问模式/) as HTMLButtonElement).textContent).toBe('Workspace Write')

    openConfirmation()
    expect((view.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    expect((view.getByRole('button', { name: '启用 Full access' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('revokes an open Full access confirmation when the task locks', () => {
    /** 中文说明：测试局部值 command，取值由紧邻初始化决定。 */
    const command = vi.fn(() => Promise.resolve(true))
    /** 中文说明：测试局部值 permissions，取值由紧邻初始化决定。 */
    const permissions = {
      options: [
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'danger-full-access', name: 'danger-full-access' },
      ],
      currentValue: 'workspace-write',
    }
    /** 中文说明：测试局部值 { view, session }，取值由紧邻初始化决定。 */
    const { view, session } = bench({ permissions, command })
    fireEvent.click(view.getByLabelText(/^访问模式/))
    fireEvent.click(view.getByRole('menuitem', { name: 'Full access' }))
    fireEvent.click(view.getByRole('checkbox'))
    act(() => { session.set(snapshotOf({ removed: true })) })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(command).not.toHaveBeenCalled()
  })

  it('resets an open Full access confirmation when switching tasks', () => {
    /** 中文说明：测试局部值 command，取值由紧邻初始化决定。 */
    const command = vi.fn(() => Promise.resolve(true))
    /** 中文说明：测试局部值 permissions，取值由紧邻初始化决定。 */
    const permissions = {
      options: [
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'danger-full-access', name: 'danger-full-access' },
      ],
      currentValue: 'workspace-write',
    }
    /** 中文说明：测试局部值 { view, props }，取值由紧邻初始化决定。 */
    const { view, props } = bench({ permissions, command })
    fireEvent.click(view.getByLabelText(/^访问模式/))
    fireEvent.click(view.getByRole('menuitem', { name: 'Full access' }))
    fireEvent.click(view.getByRole('checkbox'))
    view.rerender(<InputBar {...props} sessionId={'s2' as SessionId} />)
    expect(view.queryByRole('dialog')).toBeNull()
    expect(command).not.toHaveBeenCalled()
  })

  it('a registered entry fills its seat and receives the locked owner prop', () => {
    /** 中文说明：有序集合 { view, slotCalls }，取值由紧邻初始化决定。 */
    const { view, slotCalls } = bench({
      disabled: true,
      planEntry: <i data-testid="plan-entry" />,
      modelEntry: <i data-testid="model-entry" />,
    })
    expect(view.getByTestId('plan-entry')).toBeTruthy()
    expect(view.getByTestId('model-entry')).toBeTruthy()
    // The bar hands its chrome disable state to the filling entry.
    /** 中文说明：测试局部值 controls，取值由紧邻初始化决定。 */
    const controls = slotCalls.filter(call => call.key !== 'conversation.input.attachments')
    expect(controls.every(c => (c.owner as { locked: boolean }).locked)).toBe(true)
    expect(attachmentOwner(slotCalls).canAcceptDrop).toBe(false)
    cleanup()
    /** 中文说明：测试局部值 live，取值由紧邻初始化决定。 */
    const live = bench({ running: true })
    /** 中文说明：测试局部值 liveControls，取值由紧邻初始化决定。 */
    const liveControls = live.slotCalls.filter(call => call.key !== 'conversation.input.attachments')
    expect(liveControls.every(c => !(c.owner as { locked: boolean }).locked)).toBe(true)
    expect(attachmentOwner(live.slotCalls).canAcceptDrop).toBe(true)
  })

  it('disabled locks the Access chip and command launcher (running does not)', () => {
    /** 中文说明：测试局部值 permissions，取值由紧邻初始化决定。 */
    const permissions = { options: [{ value: 'workspace-write', name: 'workspace-write' }], currentValue: 'workspace-write' }
    /** 中文说明：测试局部值 { view }，取值由紧邻初始化决定。 */
    const { view } = bench({ disabled: true, permissions })
    expect((view.getByLabelText('命令') as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByLabelText(/^访问模式/) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    /** 中文说明：测试局部值 live，取值由紧邻初始化决定。 */
    const live = bench({ running: true, permissions })
    expect((live.view.getByLabelText(/^访问模式/) as HTMLButtonElement).disabled).toBe(false)
  })
})
