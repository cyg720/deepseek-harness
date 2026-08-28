/** Deterministic source for the filesystem tree bundled into the WebWorker preview.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 vfs example
 * fixture 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { fileURLToPath } from 'node:url'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import {
  eventLines, projectKey, toHeaderLine,
} from '@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'

/** Root copied by the preview image's repository adapter.
 * @remarks 中文说明：常量说明：VFS_EXAMPLE_ROOT 用于处理 VFS_EXAMPLE_ROOT 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const VFS_EXAMPLE_ROOT = fileURLToPath(new URL('./fixtures/vfs-example', import.meta.url))

/** Durable ids used by browser assertions and subagent parent links.
 * @remarks 中文说明：常量说明：VFS_EXAMPLE_SESSION_IDS 用于处理 VFS_EXAMPLE_SESSION_IDS
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const VFS_EXAMPLE_SESSION_IDS = {
  main: SessionId('preview-showcase'),
  oneShot: SessionId('preview-architecture-review'),
  continuable: SessionId('preview-follow-up-builder'),
} as const

/** Stable title rendered in the root Session list.
 * @remarks 中文说明：常量说明：VFS_EXAMPLE_TITLE 用于处理 VFS_EXAMPLE_TITLE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const VFS_EXAMPLE_TITLE = 'WebWorker Preview Showcase'

/** Oldest prompt, intentionally outside the first 50-message history page.
 * @remarks 中文说明：常量说明：VFS_EXAMPLE_OLDEST_MESSAGE 用于处理
 * VFS_EXAMPLE_OLDEST_MESSAGE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const VFS_EXAMPLE_OLDEST_MESSAGE = 'History checkpoint 01: verify deterministic preview state.'

/** Settled tail marker used by browser acceptance and the demonstration GIF.
 * @remarks 中文说明：常量说明：VFS_EXAMPLE_TAIL_MESSAGE 用于处理
 * VFS_EXAMPLE_TAIL_MESSAGE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const VFS_EXAMPLE_TAIL_MESSAGE = 'Preview tour complete'

/**
 * 常量说明：WORKSPACE 用于处理 WORKSPACE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const WORKSPACE = '/dsh/workspace'
/**
 * 常量说明：CREATED_AT 用于处理 CREATED_AT 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const CREATED_AT = 1_787_472_000_000
/**
 * 常量说明：HISTORICAL_TURNS 用于处理 HISTORICAL_TURNS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const HISTORICAL_TURNS = 28

/**
 * 常量说明：PREVIEW_GUIDE 用于处理 PREVIEW_GUIDE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const PREVIEW_GUIDE = `# Preview Workspace

This deterministic workspace is bundled with the browser-only preview.

- \`src/preview.ts\` is the file changed by the example write result.
- \`data/tasks.json\` mirrors the completed preview checklist.
- \`.agents/skills/preview-tour/SKILL.md\` proves dot directories survive image packing.

Refresh the preview to restore these image bytes.
`

/**
 * 常量说明：PREVIEW_SOURCE_BEFORE 用于处理 PREVIEW_SOURCE_BEFORE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PREVIEW_SOURCE_BEFORE = 'export const previewStatus = \'draft\'\n'

/**
 * 常量说明：PREVIEW_SOURCE 用于处理 PREVIEW_SOURCE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const PREVIEW_SOURCE = `export const previewStatus = 'ready'

export const previewFeatures = ['tools', 'subagents', 'pagination'] as const
`

/**
 * 常量说明：TASKS 用于处理 TASKS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const TASKS = `${JSON.stringify({
  title: 'Preview verification',
  tasks: [
    { name: 'Inspect tool cards', status: 'completed' },
    { name: 'Open both subagents', status: 'completed' },
    { name: 'Load earlier history', status: 'completed' },
  ],
}, null, 2)}\n`

/**
 * 常量说明：SKILL 用于处理 SKILL 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SKILL = `---
name: preview-tour
description: Inspect the bundled Preview workspace and its deterministic Session examples.
---

# Preview tour

Read the workspace files, inspect the tool gallery, open both subagent histories, and load the earlier conversation page.
`

interface EventDraft {
  readonly type: string
  readonly data: unknown
  readonly surfaceOp?: 'append'
  readonly sourceEventSeqs?: number[]
}

/**
 * 类说明：EventLog 用于集中封装 处理 EventLog 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。
 */
class EventLog {
  /**
   * 常量说明：events 用于处理 events 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly events: SessionEvent[]
  /**
   * 变量说明：nextTime 用于处理 nextTime 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private nextTime: number

  /**
   * 功能说明：处理 EventLog 相关流程；使用场景由所在模块及调用位置决定。
   * @param time （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param seed （readonly SessionEvent[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new EventLog(time, seed) 创建实例，并在所属生命周期内使用。
   */
  constructor(time: number, seed: readonly SessionEvent[] = []) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    this.events = seed.map(event => structuredClone(event))
    this.nextTime = Math.max(time, (this.events.at(-1)?.time ?? time - 1) + 1)
  }

  /**
   * 功能说明：处理 add 相关流程；使用场景由所在模块及调用位置决定。
   * @param draft （EventDraft）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 add(draft)，并按返回类型处理结果。
   */
  add(draft: EventDraft): number {
    /**
     * 常量说明：seq 用于处理 seq 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const seq = this.events.length
    this.events.push({ ...draft, seq, time: this.nextTime++ } as unknown as SessionEvent)
    return seq
  }
}

/**
 * 功能说明：处理 userMessage 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param text （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns EventDraft；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 userMessage(id, text)，并按返回类型处理结果。
 */
function userMessage(id: string, text: string): EventDraft {
  return {
    type: 'user/message',
    data: {
      id,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    },
    surfaceOp: 'append',
  }
}

/**
 * 功能说明：处理 assistantMessage 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param turn （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param step （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param content （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns EventDraft；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assistantMessage(id, turn, step, content)，并按返回类型处理结果。
 */
function assistantMessage(id: string, turn: number, step: number, content: unknown[]): EventDraft {
  return {
    type: 'assistant/message',
    data: {
      turn,
      step,
      message: {
        id,
        role: 'assistant',
        content,
        source: { kind: 'model', provider: 'preview-fixture', model: 'deterministic' },
      },
    },
    sourceEventSeqs: [],
    surfaceOp: 'append',
  }
}

interface GalleryCall {
  readonly id: string
  readonly name: string
  readonly args: Record<string, unknown>
  readonly result: string
  readonly meta?: unknown
  readonly error?: { readonly name: string; readonly code: string }
  readonly todos?: Array<{ readonly content: string; readonly status: 'pending' | 'in_progress' | 'completed' }>
}

/**
 * 功能说明：读取 Result 相关流程；使用场景由所在模块及调用位置决定。
 * @returns { text: string; meta: unknown }；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 readResult()，并按返回类型处理结果。
 */
function readResult(): { text: string; meta: unknown } {
  /**
   * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：text（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(text, index)，并按返回类型处理结果。
   */
  const lines = PREVIEW_GUIDE.trimEnd().split('\n').map((text, index) => ({ number: index + 1, text }))
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
   */
  return {
    text: `<path>PREVIEW.md</path>\n<type>file</type>\n<content>\n${lines.map(line => `${String(line.number)}: ${line.text}`).join('\n')}\n\n(End of file - total ${String(lines.length)} lines)\n</content>`,
    meta: { path: 'PREVIEW.md', offset: 1, lines, totalLines: lines.length, lang: 'md' },
  }
}

/**
 * 功能说明：处理 galleryCalls 相关流程；使用场景由所在模块及调用位置决定。
 * @returns GalleryCall[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 galleryCalls()，并按返回类型处理结果。
 */
function galleryCalls(): GalleryCall[] {
  /**
   * 常量说明：read 用于读取 read 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const read = readResult()
  return [
    {
      id: 'preview-read',
      name: 'read',
      args: { file_path: 'PREVIEW.md' },
      result: read.text,
      meta: read.meta,
    },
    {
      id: 'preview-write',
      name: 'write',
      args: { file_path: 'src/preview.ts', content: PREVIEW_SOURCE },
      result: '<path>src/preview.ts</path>\n<type>file</type>\n<content>\nUpdated file\n</content>',
      meta: { diffs: [{ path: 'src/preview.ts', oldText: PREVIEW_SOURCE_BEFORE, newText: PREVIEW_SOURCE }] },
    },
    {
      id: 'preview-bash',
      name: 'bash',
      args: { command: "printf 'preview ready\\n'", description: 'Print the preview readiness marker' },
      result: 'preview ready\n',
    },
    {
      id: 'preview-glob',
      name: 'glob',
      args: { pattern: '**/*', path: '.' },
      result: 'PREVIEW.md\ndata/tasks.json\nsrc/preview.ts',
      meta: {
        shape: 'paths',
        paths: ['PREVIEW.md', 'data/tasks.json', 'src/preview.ts'],
        truncated: false,
        total: 3,
      },
    },
    {
      id: 'preview-grep',
      name: 'grep',
      args: { pattern: 'preview', path: '.', include: '*.{md,ts,json}' },
      result: 'PREVIEW.md:3:This deterministic workspace is bundled with the browser-only preview.\nsrc/preview.ts:1:export const previewStatus = \'ready\'',
      meta: {
        shape: 'matches',
        files: [
          { path: 'PREVIEW.md', matches: [{ lineNumber: 3, line: 'This deterministic workspace is bundled with the browser-only preview.' }] },
          { path: 'src/preview.ts', matches: [{ lineNumber: 1, line: "export const previewStatus = 'ready'" }] },
        ],
        truncated: false,
        total: 2,
      },
    },
    {
      id: 'preview-web-search',
      name: 'web_search',
      args: { queries: ['Web Worker filesystem compatibility'] },
      result: 'Browser workers can host deterministic in-memory filesystems.\n\nSources:\n1. MDN Web Workers API — https://developer.mozilla.org/docs/Web/API/Web_Workers_API',
      meta: {
        sources: [{
          url: 'https://developer.mozilla.org/docs/Web/API/Web_Workers_API',
          title: 'Web Workers API',
          snippet: 'Web Workers run scripts in background threads.',
        }],
        truncated: false,
        answer: 'Browser workers can host deterministic in-memory filesystems.',
      },
    },
    {
      id: 'preview-todo',
      name: 'todo_write',
      args: {
        todos: [
          { content: 'Inspect tool cards', status: 'completed' },
          { content: 'Open both subagents', status: 'completed' },
          { content: 'Load earlier history', status: 'in_progress' },
        ],
      },
      result: 'Updated todo list: 0 pending, 1 in progress, 2 completed.',
      todos: [
        { content: 'Inspect tool cards', status: 'completed' },
        { content: 'Open both subagents', status: 'completed' },
        { content: 'Load earlier history', status: 'in_progress' },
      ],
    },
    {
      id: 'preview-subagent',
      name: 'subagent',
      args: { description: 'Continue preview verification', prompt: 'Check the remaining preview cases.', run_in_background: true },
      result: `started subagent ${VFS_EXAMPLE_SESSION_IDS.continuable}`,
    },
    {
      id: 'preview-subagent-fork',
      name: 'subagent_fork',
      args: { description: 'Review preview architecture', prompt: 'Review the fixture architecture.', run_in_background: false },
      result: 'The preview fixture remains separate from user-owned WebFS data.',
    },
    {
      id: 'preview-failure',
      name: 'read',
      args: { file_path: 'missing.txt' },
      result: 'Error: ENOENT: no such file, open missing.txt',
      error: { name: 'FsError', code: 'ENOENT' },
    },
  ]
}

/**
 * 功能说明：处理 addClosedTextTurn 相关流程；使用场景由所在模块及调用位置决定。
 * @param log （EventLog）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param turn （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 addClosedTextTurn(log, turn)，并按返回类型处理结果。
 */
function addClosedTextTurn(log: EventLog, turn: number): void {
  /**
   * 常量说明：checkpoint 用于处理 checkpoint 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const checkpoint = String(turn).padStart(2, '0')
  log.add({ type: 'turn/start', data: { turn } })
  log.add(userMessage(`preview-user-${checkpoint}`, `History checkpoint ${checkpoint}: verify deterministic preview state.`))
  if (turn === 1) {
    log.add({
      type: 'session/title',
      data: { title: VFS_EXAMPLE_TITLE, messageSeqs: [], source: { kind: 'user' } },
    })
  }
  log.add({ type: 'step/start', data: { turn, step: 1 } })
  log.add(assistantMessage(
    `preview-assistant-${checkpoint}`,
    turn,
    1,
    [{ type: 'text', text: `Checkpoint ${checkpoint} is recorded.` }],
  ))
  log.add({ type: 'step/end', data: { turn, step: 1 } })
  log.add({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
}

/**
 * 功能说明：处理 mainLog 相关流程；使用场景由所在模块及调用位置决定。
 * @returns { readonly events: SessionEvent[]; readonly forkSeedLength:
 * number }；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 mainLog()，并按返回类型处理结果。
 */
function mainLog(): { readonly events: SessionEvent[]; readonly forkSeedLength: number } {
  /**
   * 常量说明：log 用于处理 log 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const log = new EventLog(CREATED_AT)
  /**
   * 变量说明：turn 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let turn = 1; turn <= HISTORICAL_TURNS; turn++) addClosedTextTurn(log, turn)
  /**
   * 常量说明：forkSeedLength 用于处理 forkSeedLength 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const forkSeedLength = log.events.length
  /**
   * 常量说明：turn 用于处理 turn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const turn = HISTORICAL_TURNS + 1
  /**
   * 常量说明：calls 用于处理 calls 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const calls = galleryCalls()

  log.add({ type: 'turn/start', data: { turn } })
  log.add(userMessage('preview-gallery-user', 'Show the seeded workspace, tool cards, subagents, and pagination in one tour.'))
  log.add({ type: 'step/start', data: { turn, step: 1 } })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
   */
  log.add(assistantMessage('preview-gallery-tools', turn, 1, [
    { type: 'reasoning', text: 'I will inspect the deterministic workspace and collect each preview surface.' },
    ...calls.map(call => ({ type: 'tool-call', id: call.id, name: call.name, arguments: JSON.stringify(call.args) })),
  ]))
  /**
   * 变量说明：call 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const call of calls) {
    log.add({
      type: 'tool/call',
      data: { turn, step: 1, callId: call.id, name: call.name, arguments: JSON.stringify(call.args) },
    })
    if (call.todos !== undefined) log.add({ type: 'todo/write', data: { todos: call.todos } })
    log.add({
      type: 'tool/result',
      data: {
        turn,
        step: 1,
        message: {
          id: `${call.id}-result`,
          role: 'user',
          content: [{
            type: 'tool-result',
            toolCallId: call.id,
            content: [{ type: 'text', text: call.result }],
            isError: call.error !== undefined,
          }],
          source: { kind: 'tool', callId: call.id },
        },
        ...call.meta === undefined ? {} : { meta: call.meta },
        ...call.error === undefined ? {} : { error: call.error },
      },
      surfaceOp: 'append',
    })
  }
  log.add({ type: 'step/end', data: { turn, step: 1 } })
  log.add({ type: 'step/start', data: { turn, step: 2 } })
  log.add(assistantMessage('preview-gallery-final', turn, 2, [{
    type: 'text',
    text: `## ${VFS_EXAMPLE_TAIL_MESSAGE}\n\nThe workspace, specialized tool cards, two subagent histories, and an earlier history page are ready to inspect.`,
  }]))
  log.add({ type: 'step/end', data: { turn, step: 2 } })
  log.add({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  return { events: log.events, forkSeedLength }
}

/**
 * 功能说明：处理 oneShotLog 相关流程；使用场景由所在模块及调用位置决定。
 * @param seed （readonly SessionEvent[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionEvent[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 oneShotLog(seed)，并按返回类型处理结果。
 */
function oneShotLog(seed: readonly SessionEvent[]): SessionEvent[] {
  /**
   * 常量说明：log 用于处理 log 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const log = new EventLog(CREATED_AT + 100_000, seed)
  log.add({ type: 'session/end-seed', data: {} })
  /**
   * 常量说明：turn 用于处理 turn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const turn = HISTORICAL_TURNS + 1
  log.add({ type: 'turn/start', data: { turn } })
  log.add(userMessage('preview-review-user', 'Review whether the preview fixture is isolated from future WebFS data.'))
  log.add({
    type: 'subagent/descriptor',
    data: snapshotSubagentDescriptor({
      mode: 'one-shot', provider: 'fork', label: 'Review preview architecture',
    }),
  })
  log.add({ type: 'step/start', data: { turn, step: 1 } })
  log.add(assistantMessage('preview-review-assistant', turn, 1, [{
    type: 'text',
    text: 'The bundled fixture is static image content; future WebFS state remains user-owned.',
  }]))
  log.add({ type: 'step/end', data: { turn, step: 1 } })
  log.add({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  return log.events
}

/**
 * 功能说明：处理 continuableLog 相关流程；使用场景由所在模块及调用位置决定。
 * @returns SessionEvent[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 continuableLog()，并按返回类型处理结果。
 */
function continuableLog(): SessionEvent[] {
  /**
   * 常量说明：log 用于处理 log 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const log = new EventLog(CREATED_AT + 200_000)
  log.add({ type: 'turn/start', data: { turn: 1 } })
  log.add(userMessage('preview-builder-user', 'Check that the Preview workspace can support follow-up tasks.'))
  log.add({
    type: 'subagent/descriptor',
    data: snapshotSubagentDescriptor({
      mode: 'continuable', provider: 'spawn', label: 'Continue preview verification',
    }),
  })
  log.add({ type: 'step/start', data: { turn: 1, step: 1 } })
  log.add(assistantMessage('preview-builder-assistant', 1, 1, [{
    type: 'text',
    text: 'This child is continuable and ready for another verification turn.',
  }]))
  log.add({ type: 'step/end', data: { turn: 1, step: 1 } })
  log.add({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  return log.events
}

/**
 * 功能说明：处理 header 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （SessionHeader['id']）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param createdAt （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param child （{ readonly parentSession: SessionHeader['id']; readonly
 * mod…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionHeader；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 header(id, createdAt, child)，并按返回类型处理结果。
 */
function header(
  id: SessionHeader['id'],
  createdAt: number,
  child?: { readonly parentSession: SessionHeader['id']; readonly mode: 'one-shot' | 'continuable'; readonly seedLength?: number },
): SessionHeader {
  return {
    version: 0,
    id,
    createdAt,
    cwd: WORKSPACE,
    delegationDepth: child === undefined ? 0 : 1,
    agentPreset: 'standard',
    ...child === undefined ? {} : {
      parentSession: child.parentSession,
      origin: 'subagent' as const,
      ...child.seedLength === undefined ? {} : { seedLength: child.seedLength },
    },
  }
}

/**
 * 功能说明：渲染 Log 相关流程；使用场景由所在模块及调用位置决定。
 * @param meta （SessionHeader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param events （readonly SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 renderLog(meta, events)，并按返回类型处理结果。
 */
function renderLog(meta: SessionHeader, events: readonly SessionEvent[]): string {
  return `${JSON.stringify(toHeaderLine(meta))}\n${eventLines(events, true)}\n`
}

/** Build every committed fixture file as repository-relative UTF-8 text.
 * @remarks 中文说明：功能说明：构建 Vfs Example Files 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：ReadonlyMap<string, string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 buildVfsExampleFiles()，并按返回类型处理结果。 */
export function buildVfsExampleFiles(): ReadonlyMap<string, string> {
  /**
   * 常量说明：main 用于处理 main 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const main = mainLog()
  /**
   * 常量说明：project 用于处理 project 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const project = projectKey(WORKSPACE)
  /**
   * 常量说明：sessionPath 用于处理 sessionPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 sessionPath 相关流程；使用场景由所在模块及调用位置决定。
   * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sessionPath(id)，并按返回类型处理结果。
   */
  const sessionPath = (id: string): string => `home/sessions/${project}/${id}/session.jsonl`
  /**
   * 常量说明：projectionCache 用于处理 projectionCache 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const projectionCache = `${JSON.stringify({
    unit: { name: 'session_projcache', version: 3 },
    global: null,
    tables: {
      sessions: {
        [VFS_EXAMPLE_SESSION_IDS.main]: {
          identity: { createdAt: CREATED_AT, cwd: WORKSPACE },
          rows: {
            title: { ver: 1, seq: main.events.at(-1)?.seq ?? -1, val: VFS_EXAMPLE_TITLE },
          },
        },
      },
    },
  }, null, 2)}\n`
  return new Map([
    ['workspace/PREVIEW.md', PREVIEW_GUIDE],
    ['workspace/src/preview.ts', PREVIEW_SOURCE],
    ['workspace/data/tasks.json', TASKS],
    ['workspace/.agents/skills/preview-tour/SKILL.md', SKILL],
    ['home/storages/session_projcache.json', projectionCache],
    [sessionPath(VFS_EXAMPLE_SESSION_IDS.main), renderLog(
      header(VFS_EXAMPLE_SESSION_IDS.main, CREATED_AT),
      main.events,
    )],
    [sessionPath(VFS_EXAMPLE_SESSION_IDS.oneShot), renderLog(
      header(VFS_EXAMPLE_SESSION_IDS.oneShot, CREATED_AT + 100_000, {
        parentSession: VFS_EXAMPLE_SESSION_IDS.main,
        mode: 'one-shot',
        seedLength: main.forkSeedLength,
      }),
      oneShotLog(main.events.slice(0, main.forkSeedLength)),
    )],
    [sessionPath(VFS_EXAMPLE_SESSION_IDS.continuable), renderLog(
      header(VFS_EXAMPLE_SESSION_IDS.continuable, CREATED_AT + 200_000, {
        parentSession: VFS_EXAMPLE_SESSION_IDS.main,
        mode: 'continuable',
      }),
      continuableLog(),
    )],
  ])
}
