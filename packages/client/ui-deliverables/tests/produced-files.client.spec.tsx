// @vitest-environment jsdom
/*
 * 文件职责：验证产出文件的 produced-files.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止产出文件用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
/**
 * ui-deliverables browser half: the derivation contract of
 * `producedForClosing` over engine-published Turn data, the row's rendering
 * and opener wiring, and the plugin registrations' fiber-teardown removal
 * (HMR safety) against the real SlotRegistry.
 */
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  ConversationNodeAssembler, UiConversation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ConversationLocationDataStore, ConversationMatch, ConversationNodeDefinition,
  ConversationStartMatch, ConversationTimelineSnapshot, ConversationTurnDataMap, ConversationViewDefinition,
  ConversationViewNode, TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import type { ChatFileMentions, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  fitProducedFiles, ProducedFiles, type ProducedFilesInjected, type ProducedFilesProps,
} from '../src/client/ProducedFiles.tsx'
import {
  basename, deliverablesDefinition, producedFileMentions, producedForClosing, selectProducedFiles,
  /** 中文说明：类型或类 DeliverablesTurnData 约束本文件数据或组件职责。 */
  type DeliverablesTurnData,
} from '../src/client/turn-deliverables.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyInvariant } from '../src/invariant.ts'
import { en, zh } from '../src/client/locales.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** 中文说明：测试局部值 originalClientWidth，由紧邻初始化决定。 */
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalClientWidth === undefined) {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  } else {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
  }
})

/** 中文说明：类型或类 TestTurnDataStore 约束本文件数据或组件职责。 */
class TestTurnDataStore implements ConversationLocationDataStore<ConversationTurnDataMap> {
  private readonly values = new Map<string, unknown>()

  get<Key extends Extract<keyof ConversationTurnDataMap, string>>(
    key: Key,
  ): Readonly<ConversationTurnDataMap[Key]> | undefined {
    return this.values.get(key) as Readonly<ConversationTurnDataMap[Key]> | undefined
  }

  set<Key extends Extract<keyof ConversationTurnDataMap, string>>(
    key: Key,
    value: ConversationTurnDataMap[Key],
  ): void {
    this.values.set(key, value)
  }
}

/** 中文说明：测试局部值 turnLocation，由紧邻初始化决定。 */
const turnLocation = (turn: number, deliverables?: DeliverablesTurnData): TurnLocation => {
  /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
  const data = new TestTurnDataStore()
  if (deliverables !== undefined) data.set('deliverables', deliverables)
  return { turn, start: undefined, end: undefined, status: 'closed', steps: [], data }
}

/** 中文说明：测试局部值 produced，由紧邻初始化决定。 */
const produced = (...values: ReadonlyArray<readonly [seq: number, path: string]>): DeliverablesTurnData => ({
  produced: values.map(([seq, path]) => ({ seq, path })),
})

/** 中文说明：函数 tailOwner 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function tailOwner(
  data: DeliverablesTurnData | undefined,
  seq: number,
  openFile: (path: string) => void = () => {},
  turn = 1,
): TurnTailOwnerProps {
  return { seq, openFile, turn: turnLocation(turn, data) }
}

/** 中文说明：类型或类 TimelineSnapshot 约束本文件数据或组件职责。 */
interface TimelineSnapshot {
  readonly timeline: ConversationTimelineSnapshot
}

/** 中文说明：类型或类 TestEventDefinitions 约束本文件数据或组件职责。 */
class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [deliverablesDefinition] }
  fallbackEntry(): ConversationNodeDefinition | undefined { return undefined }
}

/** 中文说明：类型或类 TestViewDefinitions 约束本文件数据或组件职责。 */
class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [timelineViewDefinition] }
}

/** 中文说明：测试局部值 timelineViewDefinition，由紧邻初始化决定。 */
const timelineViewDefinition: ConversationViewDefinition<ConversationViewNode, TimelineSnapshot> = {
  target: 'test',
  create: () => {
    /** 中文说明：测试局部值 current，由紧邻初始化决定。 */
    let current: TimelineSnapshot = { timeline: { turnOrder: [], turns: new Map() } }
    return {
      empty: current,
      replace: ({ timeline }) => (current = { timeline }),
      apply: ({ timeline }) => (current = { timeline }),
    }
  },
}

/** 中文说明：函数 at 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function at(
  seq: number,
  type: string,
  data: unknown,
): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      seq, time: seq * 1_000, type, data,
      ...(type === 'tool/result' ? { surfaceOp: 'append' } : {}),
    } as SessionEvent,
  }
}

function matched(input: SessionLiveEventEntry, role: 'start'): ConversationStartMatch
function matched(input: SessionLiveEventEntry, role: 'update'): ConversationMatch
function matched(input: SessionLiveEventEntry, role: ConversationMatch['role']): ConversationMatch {
  return { event: input.event, role, location: { kind: 'unresolved' } }
}

/** 中文说明：函数 call 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function call(
  seq: number,
  callId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  turn = 1,
): SessionLiveEventEntry {
  return rawCall(seq, callId, name, JSON.stringify(args), turn)
}

function rawCall(
  seq: number,
  callId: string,
  name: string,
  argsRaw: string,
  turn = 1,
): SessionLiveEventEntry {
  return at(
    seq,
    'tool/call',
    { turn, step: 1, callId, name, arguments: argsRaw },
  )
}

function result(seq: number, callId: string, isError = false, turn = 1): SessionLiveEventEntry {
  return at(seq, 'tool/result', {
    turn,
    step: 1,
    message: {
      source: { type: 'tool-result', callId },
      content: [{ type: 'tool-result', content: [], isError }],
    },
  })
}

function assembler(entries: readonly SessionLiveEventEntry[], hasMore = false): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, hasMore)
  value.flush()
  return value
}

/** 中文说明：函数 deliverablesOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function deliverablesOf(value: ConversationNodeAssembler, turn = 1): Readonly<DeliverablesTurnData> | undefined {
  /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
  const snapshot = value.snapshot('test') as TimelineSnapshot
  return snapshot.timeline.turns.get(turn)?.data.get('deliverables')
}

describe('produced-file Turn data', () => {
  it('deduplicates paths in first-seen order and stops at the closing Assistant seq', () => {
    /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
    const data = produced(
      [3, 'out/index.html'],
      [4, 'out/app.css'],
      [4, 'out/index.html'],
      [8, 'after.txt'],
    )
    expect(producedForClosing(data, 6)).toEqual(['out/index.html', 'out/app.css'])
    expect(selectProducedFiles(tailOwner(data, 6))).toEqual(['out/index.html', 'out/app.css'])
    expect(producedForClosing(undefined)).toEqual([])
    expect(selectProducedFiles(tailOwner(undefined, 9, () => {}, 2))).toBeNull()
  })

  it('folds successful first-party mutation paths from their raw arguments', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'write', 'write', {
        file_path: 'out/index.html', path: 'wrong-write.txt', content: '<html></html>',
      }),
      result(3, 'write'),
      call(4, 'edit', 'edit', {
        file_path: 'out/app.css', path: 'wrong-edit.txt', old_string: 'red', new_string: 'blue',
        replace_all: false,
      }),
      result(5, 'edit'),
      call(6, 'create', 'str_replace_editor', {
        command: 'create', path: 'notes/new.md', file_path: 'wrong-create.txt', file_text: 'new',
      }),
      result(7, 'create'),
      call(8, 'replace', 'str_replace_editor', {
        command: 'str_replace', path: 'notes/existing.md', old_str: 'old', new_str: 'new',
      }),
      result(9, 'replace'),
      call(10, 'delete-text', 'str_replace_editor', {
        command: 'str_replace', path: 'notes/deleted-text.md', old_str: 'remove me',
      }),
      result(11, 'delete-text'),
      call(12, 'insert', 'str_replace_editor', {
        command: 'insert', path: 'notes/inserted.md', insert_line: 1, new_str: 'line',
      }),
      result(13, 'insert'),
    ])

    expect(producedForClosing(deliverablesOf(value))).toEqual([
      'out/index.html',
      'out/app.css',
      'notes/new.md',
      'notes/existing.md',
      'notes/deleted-text.md',
      'notes/inserted.md',
    ])
  })

  it.each([
    { caseName: 'write omits content', name: 'write', args: { file_path: 'write.txt' } },
    { caseName: 'write has non-string content', name: 'write', args: { file_path: 'write.txt', content: 1 } },
    {
      caseName: 'edit omits old_string', name: 'edit',
      args: { file_path: 'edit.txt', new_string: 'new' },
    },
    {
      caseName: 'edit has an empty old_string', name: 'edit',
      args: { file_path: 'edit.txt', old_string: '', new_string: 'new' },
    },
    {
      caseName: 'edit omits new_string', name: 'edit',
      args: { file_path: 'edit.txt', old_string: 'old' },
    },
    {
      caseName: 'edit does not change the string', name: 'edit',
      args: { file_path: 'edit.txt', old_string: 'same', new_string: 'same' },
    },
    {
      caseName: 'edit has a non-boolean replace_all', name: 'edit',
      args: { file_path: 'edit.txt', old_string: 'old', new_string: 'new', replace_all: 'yes' },
    },
    {
      caseName: 'editor create omits file_text', name: 'str_replace_editor',
      args: { command: 'create', path: 'create.txt' },
    },
    {
      caseName: 'editor create has non-string file_text', name: 'str_replace_editor',
      args: { command: 'create', path: 'create.txt', file_text: 1 },
    },
    {
      caseName: 'editor replace omits old_str', name: 'str_replace_editor',
      args: { command: 'str_replace', path: 'replace.txt', new_str: 'new' },
    },
    {
      caseName: 'editor replace has an empty old_str', name: 'str_replace_editor',
      args: { command: 'str_replace', path: 'replace.txt', old_str: '' },
    },
    {
      caseName: 'editor replace has non-string new_str', name: 'str_replace_editor',
      args: { command: 'str_replace', path: 'replace.txt', old_str: 'old', new_str: 1 },
    },
    {
      caseName: 'editor insert omits insert_line', name: 'str_replace_editor',
      args: { command: 'insert', path: 'insert.txt', new_str: 'new' },
    },
    {
      caseName: 'editor insert has a fractional insert_line', name: 'str_replace_editor',
      args: { command: 'insert', path: 'insert.txt', insert_line: 1.5, new_str: 'new' },
    },
    {
      caseName: 'editor insert has a negative insert_line', name: 'str_replace_editor',
      args: { command: 'insert', path: 'insert.txt', insert_line: -1, new_str: 'new' },
    },
    {
      caseName: 'editor insert omits new_str', name: 'str_replace_editor',
      args: { command: 'insert', path: 'insert.txt', insert_line: 1 },
    },
  ])('ignores a successful result when $caseName', ({ name, args }) => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'malformed', name, args),
      result(3, 'malformed'),
    ])

    expect(producedForClosing(deliverablesOf(value))).toEqual([])
  })

  it('ignores editor views, unsupported tools, failures, interruptions, malformed calls, and orphan results', () => {
    const replacement = result(25, 'replacement')
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'view', 'str_replace_editor', { command: 'view', path: 'viewed.txt' }),
      result(3, 'view'),
      call(4, 'read', 'read', { file_path: 'input.txt' }),
      result(5, 'read'),
      call(6, 'unknown', 'custom_edit', { file_path: 'custom.txt', path: 'custom.txt' }),
      result(7, 'unknown'),
      call(8, 'failed', 'write', { file_path: 'failed.txt', content: 'x' }),
      result(9, 'failed', true),
      call(10, 'interrupted', 'edit', {
        file_path: 'interrupted.txt', old_string: 'old', new_string: 'new',
      }),
      rawCall(11, 'invalid-json', 'write', '{'),
      result(12, 'invalid-json'),
      rawCall(13, 'null-args', 'write', 'null'),
      result(14, 'null-args'),
      rawCall(15, 'array-args', 'edit', '[]'),
      result(16, 'array-args'),
      call(17, 'missing-path', 'write', { content: 'x' }),
      result(18, 'missing-path'),
      call(19, 'blank-path', 'edit', {
        file_path: '   ', old_string: 'old', new_string: 'new',
      }),
      result(20, 'blank-path'),
      call(21, 'missing-editor-path', 'str_replace_editor', { command: 'create', file_text: 'x' }),
      result(22, 'missing-editor-path'),
      result(23, 'orphan'),
      call(24, 'replacement', 'str_replace_editor', {
        command: 'insert', path: 'replaced.txt', insert_line: 0, new_str: 'new',
      }),
      {
        ...replacement,
        event: {
          ...replacement.event,
          surfaceOp: { op: 'replace', start: 1, end: 1 },
        } as SessionEvent,
      },
      at(26, 'turn/end', { turn: 1, reason: { kind: 'interrupted' } }),
    ])

    expect(producedForClosing(deliverablesOf(value))).toEqual([])
  })

  it('rejects an invalid start match and preserves state for an unrelated update', () => {
    /** 中文说明：测试局部值 startMatch，由紧邻初始化决定。 */
    const startMatch = matched(at(1, 'turn/start', { turn: 1 }), 'start')
    /** 中文说明：测试局部值 emptyContext，由紧邻初始化决定。 */
    const emptyContext: Parameters<typeof deliverablesDefinition.start>[0] = {
      key: 'deliverables:1',
      kind: 'deliverables',
      id: '1',
      matches: [startMatch],
      start: startMatch,
      state: undefined,
      current: new Map(),
    }
    /** 中文说明：测试局部值 reader，由紧邻初始化决定。 */
    const reader: Parameters<typeof deliverablesDefinition.start>[2] = { previous: () => undefined }
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = deliverablesDefinition.start(emptyContext, startMatch, reader)
    /** 中文说明：测试局部值 unrelated，由紧邻初始化决定。 */
    const unrelated = matched(at(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }), 'update')
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context: Parameters<typeof deliverablesDefinition.update>[0] = { ...emptyContext, state }

    expect(() => deliverablesDefinition.start(
      emptyContext,
      unrelated as ConversationStartMatch,
      reader,
    ))
      .toThrow('deliverables start requires turn/start')
    expect(deliverablesDefinition.update(context, unrelated)).toBe(state)
  })

  it('replays a tail page once prepend supplies its missing Turn start', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = assembler([
      call(10, 'late', 'write', { file_path: 'history.txt', content: 'history' }),
      result(11, 'late'),
    ], true)
    expect(deliverablesOf(value)).toBeUndefined()

    value.prepend([at(1, 'turn/start', { turn: 1 })], false)
    value.flush()
    expect(producedForClosing(deliverablesOf(value))).toEqual(['history.txt'])
  })

  it('extends the same Turn data incrementally on live append', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'first', 'write', { file_path: 'first.txt', content: 'first' }),
      result(3, 'first'),
    ])
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = deliverablesOf(value)
    expect(producedForClosing(first)).toEqual(['first.txt'])

    value.append(call(4, 'second', 'edit', {
      file_path: 'second.txt', old_string: 'before', new_string: 'after',
    }))
    value.append(result(5, 'second'))
    value.flush()
    expect(producedForClosing(deliverablesOf(value))).toEqual(['first.txt', 'second.txt'])
  })
})

describe('ProducedFiles row', () => {
  /** 中文说明：测试局部值 t，由紧邻初始化决定。 */
  const t = makeTranslate(zh)
  /** 中文说明：测试局部值 capability，由紧邻初始化决定。 */
  const capability = (
    canOpenPath: boolean | undefined,
    isLoopback = true,
  ): Pick<ProducedFilesProps, 'isLoopback' | 'ensureWorkspacePathOpen' | 'useWorkspacePathOpen'> => {
    return {
      isLoopback,
      ensureWorkspacePathOpen: () => {},
      useWorkspacePathOpen: selector => selector(canOpenPath),
    }
  }

  it('selects the largest prefix using the exact remainder width', () => {
    expect(fitProducedFiles(230, 8, [70, 60, 60], [55, 55, 55, 55])).toBe(2)
    expect(fitProducedFiles(145, 8, [70, 60, 60], [55, 55, 55, 55])).toBe(1)
    expect(fitProducedFiles(300, 8, [70, 60, 60], [55, 55, 55, 55])).toBe(3)
    // A zero-width lane is a pre-layout test/hidden state, not evidence that
    // every chip overflowed; keep the bounded initial prefix until measured.
    expect(fitProducedFiles(0, 8, [70, 60], [60, 50, undefined])).toBe(2)
    expect(fitProducedFiles(128, 8, [60, 60], [70, 50, undefined])).toBe(2)
    // Candidate-specific suffix widths matter at the 10 -> 9 digit boundary.
    expect(fitProducedFiles(126, 8, [60], [70, 50])).toBe(1)
    expect(fitProducedFiles(20, 8, [60], [70, 50])).toBe(0)
  })

  it('keeps one measured line, updates on resize, and opens a file or the workspace folder', () => {
    /** 中文说明：测试局部值 paths，由紧邻初始化决定。 */
    const paths = ['deep/a.html', 'b.css', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts']
    /** 中文说明：测试局部值 openFile，由紧邻初始化决定。 */
    const openFile = vi.fn<(path: string) => void>()
    /** 中文说明：测试局部值 available，由紧邻初始化决定。 */
    let available = 226
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let resize: ResizeObserverCallback | undefined
    /** 中文说明：测试局部值 disconnect，由紧邻初始化决定。 */
    const disconnect = vi.fn()
    /** 中文说明：测试局部值 observeNode，由紧邻初始化决定。 */
    const observeNode = vi.fn<(target: Element) => void>()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback }
      observe(target: Element): void {
        expect(target).toBeInstanceOf(Element)
        observeNode(target)
      }
      disconnect(): void { disconnect() }
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) { return this.hasAttribute('data-produced-files-row') ? available : 0 },
    })
    /** 中文说明：测试局部值 rect，由紧邻初始化决定。 */
    const rect = (width: number): DOMRect => ({
      x: 0, y: 0, width, height: 22, top: 0, right: width, bottom: 22, left: 0,
      toJSON: () => ({}),
    })
    /** 中文说明：测试局部值 bounds，由紧邻初始化决定。 */
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getProbeRect(this: HTMLElement) {
        if (this.closest('[aria-hidden="true"]') === null) return rect(0)
        if (this.tagName !== 'BUTTON') return rect(60)
        return rect(this.textContent === 'a.html' || this.textContent === 'b.css' ? 50 : 100)
      })

    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <ProducedFiles matched={paths} openFile={openFile} {...capability(true)} t={t} />,
    )
    expect(view.getByText('产物')).toBeTruthy()
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = view.container.querySelector('[data-produced-files-row]')
    if (!(row instanceof HTMLElement)) throw new Error('produced row missing')
    // The third probe is 100px: two chips plus the remainder fit, three do not.
    expect(within(row).getAllByRole('button')).toHaveLength(2)
    expect(within(row).getByText('+ 5 个文件')).toBeTruthy()
    /** 中文说明：测试局部值 chip，由紧邻初始化决定。 */
    const chip = view.getByRole('button', { name: '打开 deep/a.html' })
    expect(chip.textContent).toBe('a.html')
    expect(chip.getAttribute('title')).toBe('deep/a.html')
    expect(view.queryByRole('button', { name: '打开 g.ts' })).toBeNull()
    fireEvent.click(chip)
    expect(openFile).toHaveBeenCalledWith('deep/a.html')

    /** 中文说明：测试局部值 showFolder，由紧邻初始化决定。 */
    const showFolder = view.getByRole('button', { name: '在文件夹中显示' })
    fireEvent.click(showFolder)
    expect(openFile).toHaveBeenLastCalledWith('.')

    available = 150
    act(() => { resize?.([], {} as ResizeObserver) })
    expect(within(row).getAllByRole('button')).toHaveLength(1)
    expect(within(row).getByText('+ 6 个文件')).toBeTruthy()

    // A missing/unsupported computed gap falls back to zero rather than NaN.
    vi.stubGlobal('getComputedStyle', () => ({ columnGap: '', gap: '' } as CSSStyleDeclaration))
    available = 165
    act(() => { resize?.([], {} as ResizeObserver) })
    expect(within(row).getAllByRole('button')).toHaveLength(2)

    // Ref callbacks leave nulls in the probe arrays when the candidate set
    // shrinks; the replacement observer must skip those stale slots.
    observeNode.mockClear()
    view.rerender(
      <ProducedFiles matched={paths.slice(0, 1)} openFile={openFile} {...capability(true)} t={t} />,
    )
    expect(within(row).getAllByRole('button')).toHaveLength(1)
    expect(observeNode).toHaveBeenCalledTimes(3)

    view.unmount()
    expect(disconnect).toHaveBeenCalledTimes(2)
    bounds.mockRestore()
  })

  it('keeps the folder action absent without overflow or a local native opener', () => {
    /** 中文说明：测试局部值 openFile，由紧邻初始化决定。 */
    const openFile = vi.fn<(path: string) => void>()
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <ProducedFiles matched={['a.md']} openFile={openFile} {...capability(true)} t={t} />,
    )
    /** 中文说明：测试局部值 overflowing，由紧邻初始化决定。 */
    const overflowing = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md', 'g.md']
    expect(view.queryByRole('button', { name: '在文件夹中显示' })).toBeNull()
    /** 中文说明：测试局部值 unavailable，由紧邻初始化决定。 */
    for (const unavailable of [capability(false), capability(true, false), capability(undefined)]) {
      view.rerender(<ProducedFiles matched={overflowing} openFile={openFile} {...unavailable} t={t} />)
      expect(view.queryByRole('button', { name: '在文件夹中显示' })).toBeNull()
    }
  })

  it('uses singular English copy when exactly one file is hidden', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <ProducedFiles
        matched={['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md', 'g.md']}
        openFile={() => {}}
        {...capability(false)}
        t={makeTranslate(en)}
      />,
    )
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = view.container.querySelector('[data-produced-files-row]')
    if (!(row instanceof HTMLElement)) throw new Error('produced row missing')
    expect(within(row).getByText('+ 1 file')).toBeTruthy()
  })
})

describe('producedFileMentions resolver', () => {
  /** 中文说明：测试局部值 label，由紧邻初始化决定。 */
  const label = (path: string) => `打开 ${path}`

  it('resolves exact paths and unique basenames; ambiguity and unknowns stay unresolved', () => {
    /** 中文说明：测试局部值 opened，由紧邻初始化决定。 */
    const opened: string[] = []
    /** 中文说明：测试局部值 resolver，由紧邻初始化决定。 */
    const resolver = producedFileMentions(
      ['out/index.html', 'a/style.css', 'b/style.css'],
      (path) => { opened.push(path) },
      label,
    )
    // Unique basename resolves to its full path; the full path rides title.
    /** 中文说明：测试局部值 byBasename，由紧邻初始化决定。 */
    const byBasename = resolver.resolve('index.html')
    expect(byBasename?.label).toBe('打开 out/index.html')
    expect(byBasename?.title).toBe('out/index.html')
    byBasename?.open()
    expect(opened).toEqual(['out/index.html'])
    // An exact path resolves even when its basename is ambiguous.
    /** 中文说明：测试局部值 exact，由紧邻初始化决定。 */
    const exact = resolver.resolve('a/style.css')
    expect(exact?.title).toBe('a/style.css')
    // A basename two paths share stays unresolved rather than guessing,
    // and so does a token naming nothing the turn wrote.
    expect(resolver.resolve('style.css')).toBeUndefined()
    expect(resolver.resolve('notes.md')).toBeUndefined()
    expect(basename('a\\b\\c.txt')).toBe('c.txt')
  })
})

describe('package shells', () => {
  it('the invariant companion registers ownership', async () => {
    /** 中文说明：测试局部值 registered，由紧邻初始化决定。 */
    const registered: string[] = []
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    ctx.provide('invariants')
    ctx.set('invariants', {
      register: (pkg: string) => { registered.push(pkg); return () => {} },
    } as never)
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = await applyInvariant(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-client-ui-deliverables'])
    expect(dispose).toBeTypeOf('function')
  })
})

describe('plugin registration', () => {
  it('registers the tail entry and fiber disposal removes it', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    new UiConversation(ctx, { binding: () => undefined } as never)
    // The owning view's child declaration, stood up by a bench root entry.
    ctx.slots.register({
      name: 'root',
      children: { 'conversation.chat.turnTail': { kind: 'chain', scope: 'session' } },
    } as never, () => null)
    const generation = { getSnapshot: () => undefined, subscribe: () => () => {} }
    ctx.provide('connection', {
      isLoopback: false,
      generation,
    } as never)
    // ui-theme's Appearance row binds a durable scope through these two.
    const session = {
      canOpenWorkspacePath: () => Promise.resolve({ ok: true as const, value: true }),
    }
    ctx.provide('remote', { $on: () => () => {}, session } as never)
    ctx.provide('remote.session', session as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()

    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    /** 中文说明：测试局部值 [entry]，由紧邻初始化决定。 */
    const [entry] = ctx.slots.entries('conversation.chat.turnTail')
    expect(entry).toBeDefined()
    const injected = entry?.inject?.() as unknown as ProducedFilesInjected
    expect(injected.isLoopback).toBe(false)
    expect(typeof injected.ensureWorkspacePathOpen).toBe('function')
    expect(injected.hooks.workspacePathOpen.getSnapshot()).toBeUndefined()
    ctx.emit('connection/reset')
    injected.ensureWorkspacePathOpen()
    await vi.waitFor(() => {
      expect(injected.hooks.workspacePathOpen.getSnapshot()).toBe(true)
    })
    injected.ensureWorkspacePathOpen()

    // The prose face is live while the plugin is: a produced turn yields a
    // resolver whose matches open through the owner-supplied opener.
    /** 中文说明：测试局部值 opened，由紧邻初始化决定。 */
    const opened: string[] = []
    /** 中文说明：测试局部值 owner，由紧邻初始化决定。 */
    const owner = tailOwner(
      produced([2, 'site/report.html']),
      3,
      (path) => { opened.push(path) },
    )
    /** 中文说明：测试局部值 service，由紧邻初始化决定。 */
    const service = (ctx as unknown as { get(name: string): ChatFileMentions | undefined }).get('chatFileMentions')
    /** 中文说明：测试局部值 mentions，由紧邻初始化决定。 */
    const mentions = service?.forClosing(owner)
    mentions?.resolve('report.html')?.open()
    expect(opened).toEqual(['site/report.html'])
    // A turn that produced nothing yields no vocabulary at all.
    expect(service?.forClosing(tailOwner(undefined, 2))).toBeUndefined()

    await fiber.dispose()
    expect(ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(0)
    // Fiber teardown retracts the service: the consumer's ctx.get sees the off state.
    expect((ctx as unknown as { get(name: string): unknown }).get('chatFileMentions')).toBeUndefined()
  })

  it('queries the workspace opener lazily and replaces stale results after reconnect', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    new UiConversation(ctx, { binding: () => undefined } as never)
    ctx.slots.register({
      name: 'root',
      children: { 'conversation.chat.turnTail': { kind: 'chain', scope: 'session' } },
    } as never, () => null)
    ctx.provide('connection', {
      isLoopback: true,
      generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
    } as never)
    const first = Promise.withResolvers<{ ok: true; value: boolean }>()
    const second = Promise.withResolvers<{ ok: true; value: boolean }>()
    const staleFailure = Promise.withResolvers<{ ok: true; value: boolean }>()
    const capability = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(staleFailure.promise)
      .mockRejectedValueOnce(new Error('offline'))
    const session = { canOpenWorkspacePath: capability }
    ctx.provide('remote', { $on: () => () => {}, session } as never)
    ctx.provide('remote.session', session as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = ctx.slots.entries('conversation.chat.turnTail')[0]
    const injected = entry?.inject?.() as unknown as ProducedFilesInjected

    injected.ensureWorkspacePathOpen()
    injected.ensureWorkspacePathOpen()
    expect(capability).toHaveBeenCalledOnce()
    ctx.emit('connection/reset')
    expect(capability).toHaveBeenCalledTimes(2)
    first.resolve({ ok: true, value: false })
    await Promise.resolve()
    expect(injected.hooks.workspacePathOpen.getSnapshot()).toBeUndefined()
    second.resolve({ ok: true, value: true })
    await vi.waitFor(() => { expect(injected.hooks.workspacePathOpen.getSnapshot()).toBe(true) })

    ctx.emit('connection/reset')
    ctx.emit('connection/reset')
    staleFailure.reject(new Error('stale offline'))
    await vi.waitFor(() => { expect(injected.hooks.workspacePathOpen.getSnapshot()).toBe(false) })
    await fiber.dispose()
  })
})
