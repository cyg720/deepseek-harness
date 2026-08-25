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
import {
  ConversationEventRegistry, ConversationNodeAssembler, SlotRegistry,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationEventInput, ConversationLocationDataStore, ConversationMatch, ConversationNodeDefinition,
  ConversationTimelineSnapshot, ConversationTurnDataMap, ConversationViewDefinition,
  ConversationViewNode, ToolResultNode, TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import type { ChatFileMentions, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  fitProducedFiles, ProducedFiles, type ProducedFilesProps,
} from '../src/client/ProducedFiles.tsx'
import {
  basename, deliverablesDefinition, producedFileMentions, producedForClosing, selectProducedFiles,
  /** 中文说明：类型或类 DeliverablesTurnData 约束本文件数据或组件职责。 */
  type DeliverablesTurnData,
} from '../src/client/turn-deliverables.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyInvariant } from '../src/invariant.ts'
import { en, zh } from '../src/client/locales.ts'

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
  view?: ConversationEventInput['view'],
): ConversationEventInput {
  return {
    event: {
      seq, time: seq * 1_000, type, data,
      ...(type === 'tool/result' ? { surfaceOp: 'append' } : {}),
    } as ConversationEventInput['event'],
    view,
  }
}

/** 中文说明：函数 matched 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function matched(input: ConversationEventInput, role: ConversationMatch['role']): ConversationMatch {
  return { ...input, role, location: { kind: 'unresolved' } }
}

/** 中文说明：函数 call 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function call(
  seq: number,
  callId: string,
  view: ToolResultNode['callView'],
  turn = 1,
): ConversationEventInput {
  return at(
    seq,
    'tool/call',
    { turn, step: 1, callId, name: 'fixture', arguments: '{}' },
    { for: 'call', view: view ?? { card: 'generic', title: 'fixture' } },
  )
}

/** 中文说明：函数 result 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function result(seq: number, callId: string, isError = false, turn = 1): ConversationEventInput {
  return at(seq, 'tool/result', {
    turn,
    step: 1,
    message: {
      source: { type: 'tool-result', callId },
      content: [{ type: 'tool-result', content: [], isError }],
    },
  })
}

/** 中文说明：函数 diff 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function diff(...paths: string[]): ToolResultNode['callView'] {
  return {
    card: 'diff', title: `Write ${paths[0] ?? ''}`,
    diffs: paths.map(path => ({ path, oldText: null, newText: 'x' })),
    locations: paths.map(path => ({ path })),
  }
}

/** 中文说明：函数 edit 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function edit(path: string): ToolResultNode['callView'] {
  return { card: 'generic', title: `insert ${path}`, kind: 'edit', locations: [{ path }] }
}

/** 中文说明：函数 assembler 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assembler(entries: readonly ConversationEventInput[], hasMore = false): ConversationNodeAssembler {
  /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
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

  it('folds successful diff and generic-edit calls while ignoring reads, failures, and missing locations', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'write', diff('out/index.html', 'out/app.css')),
      result(3, 'write'),
      call(4, 'edit', edit('notes.md')),
      result(5, 'edit'),
      call(6, 'read', { card: 'generic', title: 'Read', locations: [{ path: 'input.txt' }] }),
      result(7, 'read'),
      call(8, 'failed', diff('broken.txt')),
      result(9, 'failed', true),
      call(10, 'locationless', { card: 'diff', title: 'Write', diffs: [] }),
      result(11, 'locationless'),
    ])

    expect(producedForClosing(deliverablesOf(value))).toEqual([
      'out/index.html', 'out/app.css', 'notes.md',
    ])
  })

  it('ignores calls without mutation locations, orphan results, and replacement results', () => {
    /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
    const replacement = result(8, 'replacement')
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'tool/call', { turn: 1, step: 1, callId: 'no-view', name: 'fixture', arguments: '{}' }),
      result(3, 'no-view'),
      call(4, 'locationless-edit', { card: 'generic', title: 'Edit', kind: 'edit' }),
      result(5, 'locationless-edit'),
      result(6, 'orphan'),
      call(7, 'replacement', diff('replaced.txt')),
      {
        ...replacement,
        event: {
          ...replacement.event,
          surfaceOp: { op: 'replace', start: 1, end: 1 },
        } as ConversationEventInput['event'],
      },
      at(9, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
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

    expect(() => deliverablesDefinition.start(emptyContext, unrelated, reader))
      .toThrow('deliverables start requires turn/start')
    expect(deliverablesDefinition.update(context, unrelated)).toBe(state)
  })

  it('replays a tail page once prepend supplies its missing Turn start', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = assembler([
      call(10, 'late', diff('history.txt')),
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
      call(2, 'first', diff('first.txt')),
      result(3, 'first'),
    ])
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = deliverablesOf(value)
    expect(producedForClosing(first)).toEqual(['first.txt'])

    value.append(call(4, 'second', diff('second.txt')))
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
  ): Pick<ProducedFilesProps, 'isLoopback' | 'useHostDescription'> => {
    /** 中文说明：测试局部值 description，由紧邻初始化决定。 */
    const description = canOpenPath === undefined
      ? undefined
      : { version: 'test', cwd: '/workspace', attachedSessions: 1, home: '/h', canOpenPath }
    return {
      isLoopback,
      useHostDescription: selector => selector(description),
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
    await ctx.plugin(ConversationEventRegistry).await()
    // The owning view's child declaration, stood up by a bench root entry.
    ctx.slots.register({
      name: 'root',
      children: { 'conversation.chat.turnTail': { kind: 'chain', scope: 'session' } },
    } as never, () => null)
    /** 中文说明：测试局部值 hostDescription，由紧邻初始化决定。 */
    const hostDescription = { getSnapshot: () => undefined, subscribe: () => () => {} }
    ctx.provide('connection', {
      api: { settings: {} },
      isLoopback: false,
      hostDescription,
    } as never)
    // ui-theme's Appearance row binds a durable scope through these two.
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()

    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    /** 中文说明：测试局部值 [entry]，由紧邻初始化决定。 */
    const [entry] = ctx.slots.entries('conversation.chat.turnTail')
    expect(entry).toBeDefined()
    expect(entry?.inject?.()).toEqual({ isLoopback: false, hooks: { hostDescription } })

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
})
