// @vitest-environment jsdom
/** 八类工具子视图：模型逐分支判定与渲染回落。 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { QsToolviewProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { shellCardModel, ShellToolview } from '../src/client/toolviews/bash.tsx'
import { fileMutationModel, FileMutationToolview } from '../src/client/toolviews/file-mutation.tsx'
import { imageCardModel, ImageToolview } from '../src/client/toolviews/read-image.tsx'
import { readCardModel, ReadToolview } from '../src/client/toolviews/read.tsx'
import { searchCardModel, SearchToolview } from '../src/client/toolviews/search.tsx'
import { todoCardModel, todoStatusKey, TodoToolview } from '../src/client/toolviews/todo.tsx'
import { askCardModel, AskQuestionToolview } from '../src/client/toolviews/ask-question.tsx'
import { webCardModel, WebToolview } from '../src/client/toolviews/web.tsx'
import { GenericToolCard } from '../src/client/toolviews/generic.tsx'
import { formatSpillNotice } from '@deepseek-ai/dsh-spill-policy/notice'
import { SpillLocator } from '@deepseek-ai/dsh-spill'
import { blocks, resultNode, runningCall } from './tool-fixtures.client.ts'

/** 官方格式化器造出的完整转存提示：识别的是同一套文本约定。 */
const SPILL_NOTICE = formatSpillNotice({ kind: 'exact', count: 64 }, {
  locator: SpillLocator('/tmp/full.txt'),
  retrievalHint: 'Read the file to see everything.',
})

afterEach(cleanup)

/** 组件座席：只提供被测组件实际读取的输入。 */
function props(block: ToolCallBlock, overrides: Partial<QsToolviewProps> = {}): QsToolviewProps {
  return {
    block,
    toolName: 'bash',
    callId: block.callId,
    cwd: undefined,
    loadImage: undefined,
    t: (key: keyof typeof zh, params?: Record<string, unknown>) =>
      `${zh[key]}${params === undefined ? '' : `|${Object.values(params).join(',')}`}`,
    ...overrides,
  } as QsToolviewProps
}

// ── bash / pwsh ─────────────────────────────────────────────────────────────

it('命令模型：参数与结果必须符合契约，退出状态只认尾部标记', () => {
  expect(shellCardModel(resultNode({ call: null }))).toBeUndefined()
  expect(shellCardModel(resultNode({ call: { name: 'bash', argsRaw: '{}' } }))).toBeUndefined()
  expect(shellCardModel(runningCall())).toMatchObject({ command: 'ls', running: true, exitUnreported: false })
  expect(shellCardModel(resultNode({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }))).toBeUndefined()
  const clean = shellCardModel(resultNode({ content: [{ type: 'text', text: 'output' }] }))
  expect(clean).toMatchObject({ output: 'output', exitCode: undefined, exitUnreported: true })
  const failed = shellCardModel(resultNode({ content: [{ type: 'text', text: 'output\n[exit code: 2]' }] }))
  expect(failed).toMatchObject({ output: 'output', exitCode: 2, exitUnreported: false })
  const spilled = shellCardModel(resultNode({
    content: [{ type: 'text', text: `preview

${SPILL_NOTICE}` }],
  }))
  expect(spilled).toMatchObject({ spilled: true, exitUnreported: false })
})

it('命令视图：渲染终端块，转存与缺标记分别给出说明', () => {
  // 运行中：只有命令行，没有输出与退出状态。
  const running = render(<ShellToolview {...props(runningCall())} />)
  expect(running.container.textContent).toContain('ls')
  expect(running.container.querySelector('[data-qs-tool-shell-no-exit]')).toBeNull()
  running.unmount()
  const view = render(<ShellToolview {...props(resultNode({ content: [{ type: 'text', text: 'out\n[exit code: 1]' }] }))} />)
  expect(view.container.textContent).toContain('out')
  expect(view.container.querySelector('[data-qs-tool-shell-no-exit]')).toBeNull()
  view.unmount()
  const unreported = render(<ShellToolview {...props(resultNode({ content: [{ type: 'text', text: 'out' }] }))} />)
  expect(unreported.container.querySelector('[data-qs-tool-shell-no-exit]')?.textContent).toBe(zh['bash.noExit'])
  unreported.unmount()
  const spilled = render(<ShellToolview {...props(resultNode({
    content: [{ type: 'text', text: `preview

${SPILL_NOTICE}` }],
  }))} />)
  expect(spilled.container.querySelector('[data-qs-tool-shell-spilled]')?.textContent).toBe(zh['bash.spilled'])
  spilled.unmount()
  // 参数不符契约时回落兜底卡，而不是空白。
  const fallback = render(<ShellToolview {...props(resultNode({ call: null }))} />)
  expect(fallback.container.querySelector('[data-qs-tool-generic]')).not.toBeNull()
})

// ── read ────────────────────────────────────────────────────────────────────

it('读取模型：运行中只有路径，结算后必须有合法行窗口', () => {
  expect(readCardModel(resultNode({ call: null }))).toBeUndefined()
  expect(readCardModel(resultNode({ call: { name: 'read', argsRaw: '{}' } }))).toBeUndefined()
  expect(readCardModel(runningCall({ argsRaw: '{"file_path":"a.ts"}' }))).toEqual({ kind: 'running', path: 'a.ts' })
  const meta = { path: 'a.ts', offset: 2, lines: [{ number: 2, text: 'x' }], totalLines: 5, lang: 'ts' }
  expect(readCardModel(resultNode({ call: { name: 'read', argsRaw: '{"file_path":"a.ts"}' }, meta })))
    .toEqual({ kind: 'settled', path: 'a.ts', lines: [{ number: 2, text: 'x' }], totalLines: 5, lang: 'ts' })
})

it('读取 meta 的结构校验逐项拒绝', () => {
  const call = { name: 'read', argsRaw: '{"file_path":"a.ts"}' }
  const bad = [
    undefined,
    'text',
    { path: '' },
    { path: 'a.ts', totalLines: -1, lines: [] },
    { path: 'a.ts', totalLines: 1.5, lines: [] },
    { path: 'a.ts', totalLines: 1, lines: 'no' },
    { path: 'a.ts', totalLines: 1, lines: [null] },
    { path: 'a.ts', totalLines: 1, lines: [{ number: 0, text: 'x' }] },
    { path: 'a.ts', totalLines: 1, lines: [{ number: 1, text: 3 }] },
    { path: 'a.ts', totalLines: 1, lines: [], lang: 7 },
  ]
  for (const meta of bad) expect(readCardModel(resultNode({ call, meta }))).toBeUndefined()
})

it('读取视图：运行中给路径与状态，结算后给行窗口，缺 meta 回落兜底', () => {
  const running = render(<ReadToolview {...props(runningCall({ argsRaw: '{"file_path":"/root/a.ts"}' }), { cwd: '/root', toolName: 'read' })} />)
  expect(running.container.textContent).toContain('a.ts')
  expect(running.container.textContent).toContain(zh['read.running'])
  running.unmount()
  const settled = render(<ReadToolview {...props(resultNode({
    call: { name: 'read', argsRaw: '{"file_path":"a.ts"}' },
    meta: { path: 'a.ts', offset: 1, lines: [{ number: 1, text: 'line' }], totalLines: 1 },
  }), { toolName: 'read' })} />)
  expect(settled.container.textContent).toContain('line')
  settled.unmount()
  const fallback = render(<ReadToolview {...props(resultNode({ call: { name: 'read', argsRaw: '{"file_path":"a.ts"}' } }), { toolName: 'read' })} />)
  expect(fallback.container.querySelector('[data-qs-tool-generic]')).not.toBeNull()
})

// ── read_image ─────────────────────────────────────────────────────────────

it('图片模型：只接受结构完整的引用，出现未知块即整卡回落', () => {
  const call = { name: 'read_image', argsRaw: '{"file_path":"a.png"}' }
  const image = blocks({ type: 'image', attachment: { attachmentId: 'a', mediaType: 'image/png', bytes: 10, width: 2, height: 3 } })[0]
  expect(imageCardModel(resultNode({ call: null }))).toBeUndefined()
  expect(imageCardModel(resultNode({ call: { name: 'read_image', argsRaw: '{}' } }))).toBeUndefined()
  expect(imageCardModel(runningCall({ argsRaw: '{"file_path":"a.png"}' }))).toEqual({ path: 'a.png', images: [], text: '' })
  expect(imageCardModel(resultNode({ call, content: blocks(image) }))?.images).toHaveLength(1)
  expect(imageCardModel(resultNode({ call, content: blocks({ type: 'text', text: 'txt' }, image) }))?.text).toBe('txt')
  expect(imageCardModel(resultNode({ call, content: [] }))).toBeUndefined()
  expect(imageCardModel(resultNode({ call, content: blocks({ type: 'unknown' }) }))).toBeUndefined()
})

it('图片引用校验逐项拒绝缺字段与非法数值', () => {
  const call = { name: 'read_image', argsRaw: '{"file_path":"a.png"}' }
  const bad = [
    'text',
    { attachmentId: '' },
    { attachmentId: 'a', mediaType: '' },
    { attachmentId: 'a', mediaType: 'image/png', bytes: -1, width: 1, height: 1 },
    { attachmentId: 'a', mediaType: 'image/png', bytes: Number.NaN, width: 1, height: 1 },
    { attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 'x' },
  ]
  for (const attachment of bad) {
    expect(imageCardModel(resultNode({ call, content: blocks({ type: 'image', attachment }) }))).toBeUndefined()
  }
})

it('图片视图将原引用和会话加载器交给独立附件槽，缺能力仍显示限制', () => {
  const block = resultNode({ call: { name: 'read_image', argsRaw: '{"file_path":"a.png"}' },
    content: blocks({ type: 'image', attachment: { attachmentId: 'a', mediaType: 'image/png', bytes: 10, width: 2, height: 3 } }, { type: 'text', text: 'image envelope' }),
  })
  const unavailable = render(<ImageToolview {...props(block)} />)
  expect(unavailable.container.textContent).toContain(zh['image.unavailable'])
  unavailable.unmount()
  const loadImage = vi.fn(() => Promise.resolve('blob:image')), renderSlot = vi.fn(() => null)
  render(<ImageToolview {...props(block, { loadImage, renderSlot })} />)
  expect(renderSlot).toHaveBeenCalledWith('qs.tool.call.images', {
    images: [{ attachment: { attachmentId: 'a', mediaType: 'image/png', bytes: 10, width: 2, height: 3 } }], loadImage, align: 'start',
  })
  expect(loadImage).not.toHaveBeenCalled()
  render(<ImageToolview {...props(runningCall({ argsRaw: '{"file_path":"a.png"}' }), { loadImage, renderSlot })} />)
  const fallback = render(<ImageToolview {...props(resultNode({ call: null }))} />)
  expect(fallback.container.querySelector('[data-qs-tool-generic]')).not.toBeNull()
})

// ── write / edit ───────────────────────────────────────────────────────────

it('写入编辑模型：落盘记录优先，write 在空分块时回落参数对照，edit 则回落兜底', () => {
  const writeArgs = '{"file_path":"a.txt","content":"new"}'
  const editArgs = '{"file_path":"a.txt","old_string":"old","new_string":"new"}'
  expect(fileMutationModel('write', resultNode({ call: null }))).toBeUndefined()
  expect(fileMutationModel('write', resultNode({ call: { name: 'write', argsRaw: '{}' } }))).toBeUndefined()
  expect(fileMutationModel('edit', resultNode({ call: { name: 'edit', argsRaw: '{"file_path":"a.txt"}' } }))).toBeUndefined()
  expect(fileMutationModel('write', runningCall({ argsRaw: writeArgs })))
    .toMatchObject({ intended: true, diffs: [{ path: 'a.txt', oldText: null, newText: 'new' }] })
  expect(fileMutationModel('edit', runningCall({ argsRaw: editArgs })))
    .toMatchObject({ intended: true, diffs: [{ oldText: 'old', newText: 'new' }] })
  // 失败结算不展示“改动”。
  expect(fileMutationModel('write', resultNode({ call: { name: 'write', argsRaw: writeArgs }, isError: true }))).toBeUndefined()
  // 落盘分块存在时按落盘记录呈现。
  const applied = { diffs: [{ path: 'a.txt', oldText: 'x', newText: 'y' }] }
  expect(fileMutationModel('edit', resultNode({ call: { name: 'edit', argsRaw: editArgs }, meta: applied })))
    .toEqual({ diffs: [{ path: 'a.txt', oldText: 'x', newText: 'y' }], intended: false })
  // write 的空分块（新建或覆盖）回落参数对照；edit 的空分块回落兜底。
  expect(fileMutationModel('write', resultNode({ call: { name: 'write', argsRaw: writeArgs }, meta: { diffs: [] } })))
    .toMatchObject({ intended: true })
  expect(fileMutationModel('edit', resultNode({ call: { name: 'edit', argsRaw: editArgs }, meta: { diffs: [] } }))).toBeUndefined()
  expect(fileMutationModel('edit', resultNode({ call: { name: 'edit', argsRaw: editArgs }, meta: 'bad' }))).toBeUndefined()
  // 落盘 meta 缺席或为 null：write 仍可回落参数对照，edit 回落兜底。
  expect(fileMutationModel('write', resultNode({ call: { name: 'write', argsRaw: writeArgs }, meta: null }))).toMatchObject({ intended: true })
  expect(fileMutationModel('write', resultNode({ call: { name: 'write', argsRaw: writeArgs }, meta: 'bad' }))).toMatchObject({ intended: true })
  expect(fileMutationModel('edit', resultNode({ call: { name: 'edit', argsRaw: editArgs }, meta: null }))).toBeUndefined()
  // 必需参数缺失：运行中与结算后都不成立。
  expect(fileMutationModel('write', runningCall({ argsRaw: '{"file_path":"a.txt"}' }))).toBeUndefined()
  expect(fileMutationModel('edit', runningCall({ argsRaw: '{"file_path":"a.txt"}' }))).toBeUndefined()
  expect(fileMutationModel('write', resultNode({ call: { name: 'write', argsRaw: '{"file_path":"a.txt"}' } }))).toBeUndefined()
  expect(fileMutationModel('edit', runningCall({ argsRaw: '{"file_path":"a.txt","old_string":"o"}' }))).toBeUndefined()
})

it('落盘分块的结构校验逐项拒绝', () => {
  const call = { name: 'edit', argsRaw: '{"file_path":"a.txt","old_string":"o","new_string":"n"}' }
  const bad = [
    { diffs: [null] },
    { diffs: [{ path: 'a.txt' }] },
    { diffs: [{ path: 'a.txt', oldText: 3, newText: 'n' }] },
  ]
  for (const meta of bad) expect(fileMutationModel('edit', resultNode({ call, meta }))).toBeUndefined()
  expect(fileMutationModel('edit', resultNode({ call, meta: { diffs: 'no' } }))).toBeUndefined()
  expect(fileMutationModel('edit', resultNode({ call, meta: { diffs: [{ path: 'a.txt', oldText: null, newText: 'n' }] } }))?.intended).toBe(false)
  // 落盘分块即使路径为空也照原样呈现：路径由分块标题承担，不再单独补一行。
  expect(fileMutationModel('edit', resultNode({
    call, meta: { diffs: [{ path: '', oldText: null, newText: 'n' }] },
  }))).toEqual({ diffs: [{ path: '', oldText: null, newText: 'n' }], intended: false })
})

it('写入编辑视图：参数对照有明确标注，模型不成立时回落兜底', () => {
  const view = render(<FileMutationToolview {...props(runningCall({ argsRaw: '{"file_path":"/root/a.txt","content":"new"}' }), { toolName: 'write', cwd: '/root' })} />)
  expect(view.container.textContent).toContain(zh['fileMutation.intended'])
  expect(view.container.textContent).toContain('a.txt')
  expect(view.container.textContent).toContain('+1 -0')
  view.unmount()
  // 落盘分块（intended 为假）不标注“参数对照”，路径由分块标题承担。
  const applied = render(<FileMutationToolview {...props(resultNode({
    call: { name: 'edit', argsRaw: '{}' },
    meta: { diffs: [{ path: 'a.txt', oldText: 'x', newText: 'y' }] },
  }), { toolName: 'edit', cwd: '/root' })} />)
  expect(applied.container.textContent).not.toContain(zh['fileMutation.intended'])
  expect(applied.container.querySelectorAll('p')).toHaveLength(1)
  const fallback = render(<FileMutationToolview {...props(resultNode({ call: null }), { toolName: 'edit' })} />)
  expect(fallback.container.querySelector('[data-qs-tool-generic]')).not.toBeNull()
})

// ── grep / glob ────────────────────────────────────────────────────────────

it('搜索模型：只认官方结构化 meta，失败与未结算一律回落', () => {
  const call = { name: 'grep', argsRaw: '{"pattern":"x"}' }
  expect(searchCardModel(resultNode({ call: null }))).toBeUndefined()
  expect(searchCardModel(runningCall())).toBeUndefined()
  expect(searchCardModel(resultNode({ call, isError: true }))).toBeUndefined()
  expect(searchCardModel(resultNode({ call, meta: undefined }))).toBeUndefined()
  const matches = { shape: 'matches', files: [{ path: 'a.ts', matches: [{ lineNumber: 1, line: 'x' }] }], truncated: false, total: 1 }
  expect(searchCardModel(resultNode({ call, meta: matches }))).toMatchObject({ kind: 'matches', total: 1 })
  const paths = { shape: 'paths', paths: ['a.ts'], truncated: true, total: 4 }
  expect(searchCardModel(resultNode({ call, meta: paths }))).toMatchObject({ kind: 'paths', truncated: true })
})

it('搜索 meta 的结构校验逐项拒绝', () => {
  const call = { name: 'glob', argsRaw: '{"pattern":"**"}' }
  const bad = [
    'text',
    { shape: 'matches', files: [], truncated: 'no', total: 0 },
    { shape: 'matches', files: [], truncated: false, total: -1 },
    { shape: 'paths', paths: [7], truncated: false, total: 1 },
    { shape: 'paths', paths: 'no', truncated: false, total: 1 },
    { shape: 'unknown', truncated: false, total: 0 },
    { shape: 'matches', files: [null], truncated: false, total: 0 },
    { shape: 'matches', files: [{ path: 'a', matches: [null] }], truncated: false, total: 0 },
    { shape: 'matches', files: [], truncated: false, total: 1.5 },
    { shape: 'matches', files: [{ path: 'a' }], truncated: false, total: 0 },
    { shape: 'matches', files: [{ path: 'a', matches: [{ lineNumber: 0, line: 'x' }] }], truncated: false, total: 0 },
    { shape: 'matches', files: [{ path: 'a', matches: [{ lineNumber: 1, line: 2 }] }], truncated: false, total: 0 },
  ]
  for (const meta of bad) expect(searchCardModel(resultNode({ call, meta }))).toBeUndefined()
})

it('搜索视图：两种形状分别渲染，截断时把结果正文作为恢复线索', () => {
  const call = { name: 'grep', argsRaw: '{"pattern":"x"}' }
  const paths = render(<SearchToolview {...props(resultNode({
    call, meta: { shape: 'paths', paths: ['a.ts'], truncated: false, total: 1 },
  }), { toolName: 'grep' })} />)
  expect(paths.container.textContent).toContain('a.ts')
  expect(paths.container.textContent).not.toContain(zh['search.recovery'])
  paths.unmount()
  const matches = render(<SearchToolview {...props(resultNode({
    call,
    content: [{ type: 'text', text: 'full output' }],
    meta: { shape: 'matches', files: [{ path: 'a.ts', matches: [{ lineNumber: 1, line: 'x' }] }], truncated: true, total: 9 },
  }), { toolName: 'grep' })} />)
  expect(matches.container.textContent).toContain(zh['search.recovery'])
  expect(matches.container.textContent).toContain('full output')
  matches.unmount()
  const fallback = render(<SearchToolview {...props(resultNode({ call }), { toolName: 'grep' })} />)
  expect(fallback.container.querySelector('[data-qs-tool-generic]')).not.toBeNull()
})

// ── web_search / web_fetch ─────────────────────────────────────────────────

it('Web 模型：fetch 需要整数状态码，search 需要合法来源', () => {
  const fetchCall = { name: 'web_fetch', argsRaw: '{"url":"https://a"} ' }
  expect(webCardModel('web_fetch', resultNode({ call: null }))).toBeUndefined()
  expect(webCardModel('web_fetch', runningCall())).toBeUndefined()
  expect(webCardModel('web_fetch', resultNode({ call: fetchCall, isError: true }))).toBeUndefined()
  const meta = { url: 'https://a', statusCode: 200, truncated: false }
  expect(webCardModel('web_fetch', resultNode({ call: fetchCall, meta }))).toMatchObject({ kind: 'fetch', statusCode: 200 })
  const searchCall = { name: 'web_search', argsRaw: '{"queries":["x"]}' }
  const search = { sources: [{ url: 'https://a', title: 't', snippet: 's', publishedAt: 'p' }], truncated: true, answer: 'a' }
  expect(webCardModel('web_search', resultNode({ call: searchCall, meta: search }))).toMatchObject({ kind: 'search', truncated: true })
})

it('Web meta 的结构校验逐项拒绝', () => {
  const fetchCall = { name: 'web_fetch', argsRaw: '{"url":"https://a"}' }
  const searchCall = { name: 'web_search', argsRaw: '{"queries":["x"]}' }
  for (const meta of [
    undefined, 'text',
    { url: '', statusCode: 200, truncated: false },
    { url: 'https://a', statusCode: 1.5, truncated: false },
    { url: 'https://a', statusCode: 200, truncated: 'no' },
  ]) expect(webCardModel('web_fetch', resultNode({ call: fetchCall, meta }))).toBeUndefined()
  for (const meta of [
    { sources: 'no', truncated: false },
    { sources: [null], truncated: false },
    { sources: [{ url: '' }], truncated: false },
    { sources: [{ url: 'https://a', title: 7 }], truncated: false },
    { sources: [], truncated: false, answer: 7 },
  ]) expect(webCardModel('web_search', resultNode({ call: searchCall, meta }))).toBeUndefined()
  expect(webCardModel('web_search', resultNode({ call: searchCall, meta: { sources: [], truncated: false } }))?.kind).toBe('search')
})

it('Web 视图：两种形状分别渲染，模型不成立回落兜底', () => {
  const fetchCall = { name: 'web_fetch', argsRaw: '{"url":"https://a"}' }
  const view = render(<WebToolview {...props(resultNode({
    call: fetchCall, meta: { url: 'https://a', statusCode: 404, truncated: true },
  }), { toolName: 'web_fetch' })} />)
  expect(view.container.textContent).toContain('404')
  view.unmount()
  const search = render(<WebToolview {...props(resultNode({
    call: { name: 'web_search', argsRaw: '{"queries":["x"]}' },
    meta: { sources: [{ url: 'https://a' }], truncated: false, answer: 'answer' },
  }), { toolName: 'web_search' })} />)
  expect(search.container.textContent).toContain('answer')
  search.unmount()
  const fallback = render(<WebToolview {...props(resultNode({ call: fetchCall }), { toolName: 'web_fetch' })} />)
  expect(fallback.container.querySelector('[data-qs-tool-generic]')).not.toBeNull()
})

// ── todo_write ─────────────────────────────────────────────────────────────

it('待办模型：参数校验与完成计数', () => {
  expect(todoCardModel(resultNode({ call: null }))).toBeUndefined()
  expect(todoCardModel(runningCall({ name: 'todo_write', argsRaw: '{}' }))).toBeUndefined()
  expect(todoCardModel(runningCall({ name: 'todo_write', argsRaw: '{"todos":[]}' }))).toBeUndefined()
  const ok = todoCardModel(runningCall({
    name: 'todo_write',
    argsRaw: '{"todos":[{"content":"a","status":"completed"},{"content":"b","status":"in_progress"}]}',
  }))
  expect(ok).toEqual({
    todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }],
    done: 1,
  })
  for (const argsRaw of ['{"todos":[null]}', '{"todos":[{"content":"","status":"pending"}]}', '{"todos":[{"content":"a","status":"other"}]}']) {
    expect(todoCardModel(runningCall({ name: 'todo_write', argsRaw }))).toBeUndefined()
  }
  expect(todoStatusKey('pending')).toBe('todo.pending')
  expect(todoStatusKey('in_progress')).toBe('todo.inProgress')
  expect(todoStatusKey('completed')).toBe('todo.completed')
})

it('待办视图：列出全部任务与状态，模型不成立回落兜底', () => {
  const view = render(<TodoToolview {...props(runningCall({
    name: 'todo_write',
    argsRaw: '{"todos":[{"content":"a","status":"completed"},{"content":"b","status":"pending"}]}',
  }), { toolName: 'todo_write' })} />)
  expect(view.container.querySelectorAll('li')).toHaveLength(2)
  expect(view.container.textContent).toContain(zh['todo.pending'])
  view.unmount()
  const fallback = render(<TodoToolview {...props(runningCall({ name: 'todo_write', argsRaw: '{}' }), { toolName: 'todo_write' })} />)
  expect(fallback.container.querySelector('[data-qs-tool-generic]')).not.toBeNull()
})

// ── ask_user_question ──────────────────────────────────────────────────────

it('待办写入失败保留错误正文，不把请求清单显示成已生效状态', () => {
  const block = resultNode({
    call: { name: 'todo_write', argsRaw: '{"todos":[{"content":"任务","status":"completed"}]}' },
    isError: true,
    content: [{ type: 'text', text: '待办存储失败' }],
    error: { name: 'Error', code: 'FAILED' },
  })
  // 参数合法也不能覆盖持久化结果的失败事实。
  expect(todoCardModel(block)).toBeUndefined()
  const view = render(<TodoToolview {...props(block, { toolName: 'todo_write' })} />)
  expect(view.container.textContent).toContain('待办存储失败')
  expect(view.container.querySelector('[data-qs-tool-todo]')).toBeNull()
})

const ASK_CALL = '{"questions":[{"id":"q1","question":"范围？"},{"id":"q2","question":"时间？"}]}'

it('提问模型：等待、取消、中断与严格配对', () => {
  const call = { name: 'ask_user_question', argsRaw: ASK_CALL }
  expect(askCardModel(resultNode({ call: null }))).toBeUndefined()
  expect(askCardModel(runningCall({ name: 'ask_user_question', argsRaw: '{}' }))).toBeUndefined()
  expect(askCardModel(runningCall({ name: 'ask_user_question', argsRaw: '{"questions":[{"id":"q","question":1}]}' }))).toBeUndefined()
  expect(askCardModel(runningCall({ name: 'ask_user_question', argsRaw: '{"questions":[null]}' }))).toBeUndefined()
  expect(askCardModel(runningCall({ name: 'ask_user_question', argsRaw: '{"questions":[{"id":"q","question":"a"},{"id":"q","question":"b"}]}' }))).toBeUndefined()
  expect(askCardModel(runningCall({ name: 'ask_user_question', argsRaw: ASK_CALL }))).toMatchObject({ kind: 'waiting' })
  expect(askCardModel(resultNode({ call, error: { name: 'UserQuestionError', code: 'ASK_CANCELLED' } })))
    .toMatchObject({ kind: 'unresolved', verdict: 'cancelled' })
  expect(askCardModel(resultNode({ call, error: { name: 'UserQuestionError', code: 'ASK_ABORTED' } })))
    .toMatchObject({ kind: 'unresolved', verdict: 'interrupted' })
  expect(askCardModel(resultNode({ call, isError: true }))).toBeUndefined()
  const answers = JSON.stringify({ answers: [
    { id: 'q1', selected: ['a'], custom: 'note' },
    { id: 'q2', selected: [] },
  ] })
  expect(askCardModel(resultNode({ call, content: [{ type: 'text', text: answers }] })))
    .toEqual({
      kind: 'answered',
      total: 2,
      pairs: [
        { id: 'q1', question: '范围？', answers: ['a', 'note'] },
        { id: 'q2', question: '时间？', answers: [] },
      ],
    })
})

it('提问模型：有效但未配对的回答按实际条目计数，未知结果回落原文', () => {
  const call = { name: 'ask_user_question', argsRaw: ASK_CALL }
  for (const text of ['not json', '"text"', '{}', '{"answers":"no"}', '{"answers":[null]}',
    '{"answers":[{"id":"q1","selected":"no"}]}', '{"answers":[{"id":"q1","selected":[7]}]}',
    '{"answers":[{"id":"q1","selected":[],"custom":7}]}']) {
    expect(askCardModel(resultNode({ call, content: [{ type: 'text', text }] }))).toBeUndefined()
  }
  // 不根据原提问数量猜测缺失回答；与官方一致，分母取有效结果条目数。
  for (const answers of [
    [{ id: 'q1', selected: ['yes'] }],
    [{ id: 'other', selected: [], custom: 'custom answer' }],
    [{ id: 'q1', selected: ['yes'] }, { id: 'q1', selected: [] }],
    [{ id: 'other', selected: ['yes'] }, { id: 'q2', selected: [] }],
  ]) {
    expect(askCardModel(resultNode({ call, content: [{ type: 'text', text: JSON.stringify({ answers }) }] })))
      .toEqual({ kind: 'counted', answered: 1, total: answers.length })
  }
  expect(askCardModel(resultNode({ call, content: blocks({ type: 'image', attachment: {} }) }))).toBeUndefined()
  const view = render(<AskQuestionToolview {...props(resultNode({ call, content: [{ type: 'text', text: 'unrecognized result' }] }))} />)
  expect(view.container.textContent).toContain('unrecognized result')
  expect(view.container.querySelector('[data-qs-tool-generic]')).not.toBeNull()
})

it('提问视图：四种状态分别渲染，模型不成立回落兜底', () => {
  const call = { name: 'ask_user_question', argsRaw: ASK_CALL }
  const waiting = render(<AskQuestionToolview {...props(runningCall({ name: 'ask_user_question', argsRaw: ASK_CALL }), { toolName: 'ask_user_question' })} />)
  expect(waiting.container.textContent).toContain(zh['ask.waiting'])
  expect(waiting.container.textContent).toContain(zh['ask.readOnly'])
  expect(waiting.container.querySelector('form')).toBeNull()
  waiting.unmount()
  const cancelled = render(<AskQuestionToolview {...props(
    resultNode({ call, error: { name: 'UserQuestionError', code: 'ASK_CANCELLED' } }),
    { toolName: 'ask_user_question' },
  )} />)
  expect(cancelled.container.textContent).toContain(zh['ask.cancelledDetail'])
  cancelled.unmount()
  const interrupted = render(<AskQuestionToolview {...props(
    resultNode({ call, error: { name: 'UserQuestionError', code: 'ASK_ABORTED' } }),
    { toolName: 'ask_user_question' },
  )} />)
  expect(interrupted.container.textContent).toContain(zh['ask.interruptedDetail'])
  interrupted.unmount()
  const counted = render(<AskQuestionToolview {...props(resultNode({ call, content: [{ type: 'text', text: '{"answers":[{"id":"q1","selected":["yes"]}]}' }] }), { toolName: 'ask_user_question' })} />)
  expect(counted.container.textContent).toContain(`${zh['ask.answered']}|1,1`)
  counted.unmount()
  const answered = render(<AskQuestionToolview {...props(resultNode({
    call,
    content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: 'q1', selected: ['a'] }, { id: 'q2', selected: [] }] }) }],
  }), { toolName: 'ask_user_question' })} />)
  expect(answered.container.textContent).toContain('范围？')
  expect(answered.container.textContent).toContain(zh['ask.skipped'])
  answered.unmount()
  const fallback = render(<AskQuestionToolview {...props(resultNode({ call: null }), { toolName: 'ask_user_question' })} />)
  expect(fallback.container.querySelector('[data-qs-tool-generic]')).not.toBeNull()
})

// ── 兜底卡 ─────────────────────────────────────────────────────────────────

it('兜底卡：孤儿结果、错误、空结果、非文本与参数各自给说明', () => {
  const orphan = render(<GenericToolCard {...props(resultNode({ call: null }))} />)
  expect(orphan.container.textContent).toContain(zh['row.orphan'])
  expect(orphan.container.querySelector('details')).toBeNull()
  orphan.unmount()

  const running = render(<GenericToolCard {...props(runningCall())} />)
  expect(running.container.textContent).toContain(zh['row.noResult'])
  fireEvent.click(running.getByRole('button', { name: zh['row.argsRaw'] }))
  expect(running.container.textContent).toContain('ls')
  running.unmount()

  const raw = render(<GenericToolCard {...props(runningCall({ argsRaw: 'not json' }))} />)
  expect(raw.container.textContent).toContain(zh['row.argsRaw'])
  fireEvent.click(raw.getByRole('button', { name: zh['row.argsRaw'] }))
  expect(raw.container.textContent).toContain('not json')
  raw.unmount()

  const empty = render(<GenericToolCard {...props(resultNode({ content: [] }))} />)
  expect(empty.container.textContent).toContain(zh['row.emptyResult'])
  empty.unmount()

  const nonText = render(<GenericToolCard {...props(resultNode({
    content: blocks({ type: 'image', attachment: { attachmentId: 'a' } }),
  }))} />)
  expect(nonText.container.textContent).toContain(zh['row.nonText'])
  expect(nonText.container.querySelector('[data-qs-tool-nontext-kind]')?.textContent).toBe(`${zh['row.nonText']}|image`)
  expect(nonText.container.querySelector('[data-qs-tool-nontext]')).toBeNull()
  fireEvent.click(nonText.getByRole('button', { name: zh['row.result'] }))
  expect(nonText.container.querySelector('[data-qs-tool-nontext]')?.textContent).toContain('attachmentId')
  nonText.unmount()

  const coded = render(<GenericToolCard {...props(resultNode({ isError: true, error: { name: 'Boom', code: 'E1' } }))} />)
  expect(coded.container.querySelector('[role="alert"]')?.textContent).toContain('Boom')
  expect(coded.container.querySelector('[role="alert"]')?.textContent).toContain('E1')
})

it('兜底卡对不可信内容只输出转义文本', () => {
  const payload = { type: 'image', attachment: { attachmentId: 'a' }, svg: '<svg onload=alert(1)>' }
  const view = render(<GenericToolCard {...props(resultNode({ content: blocks(payload) }))} />)
  fireEvent.click(view.getByRole('button', { name: zh['row.result'] }))
  // 官方折叠按钮有 SVG 图标；安全断言针对原始结果及可执行属性。
  expect(view.container.querySelector('[data-qs-tool-nontext] svg')).toBeNull()
  expect(view.container.querySelector('svg[onload]')).toBeNull()
  expect(view.container.querySelector('[data-qs-tool-nontext]')?.textContent).toContain('<svg onload=alert(1)>')
})

/** 视图组件在收到非自身 kind 的负载时不得崩溃。 */
it('视图组件永远不会访问 ctx 或自行订阅', () => {
  const spies = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')]
  const view = render(<ShellToolview {...props(resultNode({ content: [{ type: 'text', text: 'ok' }] }))} />)
  expect(spies.every(spy => spy.mock.calls.length === 0)).toBe(true)
  view.unmount()
})

it('关闭的参数和非文本详情不解析或序列化大载荷，展开后保留完整内容', () => {
  const raw = JSON.stringify({ payload: 'synthetic-argument-'.repeat(60000) })
  let serialized = 0
  const payload = { type: 'custom', get payload() { serialized++; return 'synthetic-result-'.repeat(60000) } }
  const parse = vi.spyOn(JSON, 'parse')
  try {
    const view = render(<GenericToolCard {...props(resultNode({
      call: { name: 'unknown', argsRaw: raw }, content: blocks(payload),
    }))} />)
    expect(parse.mock.calls.filter(call => call[0] === raw)).toHaveLength(0)
    expect(serialized).toBe(0)
    expect(view.container.querySelector('[data-qs-tool-nontext]')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh['row.argsRaw'] }))
    expect(parse.mock.calls.filter(call => call[0] === raw)).toHaveLength(1)
    expect(view.container.textContent).toContain('synthetic-argument-'.repeat(60000))
    fireEvent.click(view.getByRole('button', { name: zh['row.result'] }))
    expect(serialized).toBe(1)
    expect(view.container.querySelector('[data-qs-tool-nontext]')?.textContent).toContain('synthetic-result-'.repeat(60000))
    fireEvent.click(view.getByRole('button', { name: zh['row.result'] }))
    expect(view.container.querySelector('[data-qs-tool-nontext]')).toBeNull()
    view.unmount()
  } finally {
    parse.mockRestore()
  }
})
