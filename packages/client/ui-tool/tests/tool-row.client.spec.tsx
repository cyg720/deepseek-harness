// @vitest-environment jsdom
/**
 * 文件职责：验证工具调用的 tool-row.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、插槽替身和类型化工具数据。
 * 产品维度：防止工具调用展示与展开交互回归。
 * 逻辑维度：构造工具调用或轨迹数据，渲染后断言 DOM 与状态。
 * 关键边界：测试只验证展示，不执行真实工具；DOM 和替身必须清理。
 * 新手阅读建议：先读数据夹具，再按工具类型和状态阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { classifyTool, resultText, toolRowModel } from '../src/client/tool/models/tool-call-model.ts'
import { ToolRow } from '../src/client/tool/components/ToolRow.tsx'
import { GenericToolCard, type GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t: GenericToolCardProps['t'] = makeTranslate(zh, commonZh)

/** 中文说明：测试局部值 running，由紧邻初始化决定。 */
const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'bash', argsRaw: '{"command":"ls -la","description":"List files"}',
  turn: 1, step: 1, time: 1_000, subCalls: [], ...over,
})

/** 中文说明：测试局部值 result，由紧邻初始化决定。 */
const result = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'bash', argsRaw: '{"command":"ls -la","description":"List files"}' },
  callTime: 1_000,
  content: [], isError: false, subCalls: [], ...over,
})

describe('tool-call-model', () => {
  it('classifies known tools and falls back to others', () => {
    expect(classifyTool('bash')).toBe('bash')
    expect(classifyTool('pwsh')).toBe('bash')
    expect(classifyTool('read')).toBe('read')
    expect(classifyTool('web_fetch')).toBe('read')
    expect(classifyTool('web_search')).toBe('search')
    expect(classifyTool('grep')).toBe('search')
    expect(classifyTool('write')).toBe('write')
    expect(classifyTool('edit')).toBe('edit')
    expect(classifyTool('cordis_runtime_inspect')).toBe('read')
    // The v3 run-control verbs: `others` is the decided intent, not an
    // unclassified default (there is no program to show and no file to open).
    expect(classifyTool('cordis_run')).toBe('others')
    expect(classifyTool('cordis_stop')).toBe('others')
    expect(classifyTool('cordis_undefine')).toBe('others')
    expect(classifyTool('todo_write')).toBe('others')
  })

  it('names each cordis verb instead of leaving it a bare tool call', () => {
    // Every define/run pair the model makes puts a row in the flow, so the
    // generic "Tool call · cordis_run · dyn-1" fallback is user-visible slop.
    /** 中文说明：测试局部值 titleOf，由紧邻初始化决定。 */
    const titleOf = (name: string) => toolRowModel(name, running({ name, argsRaw: '{"id":"dyn-1"}' }))
    expect(t(titleOf('cordis_run').titleKey)).toBe('运行 Cordis 插件')
    expect(t(titleOf('cordis_stop').titleKey)).toBe('停止 Cordis 插件')
    expect(t(titleOf('cordis_undefine').titleKey)).toBe('移除 Cordis 插件')
    // An owned title takes the tool name out of the summary slot, leaving the
    // package id as the only mutable text.
    expect(titleOf('cordis_run').summary).toBe('dyn-1')
  })

  it('leaves cordis_define to its own keyed toolview', () => {
    // ui-cordis registers a keyed `tool.call.toolview` entry for cordis_define,
    // and a keyed hit replaces the generic row (this model is only reached
    // through the dispatch fallback). A mapping here would be unreachable, and a
    // title here would be a second answer to what the card already renders.
    /** 中文说明：测试局部值 model，由紧邻初始化决定。 */
    const model = toolRowModel('cordis_define', running({ name: 'cordis_define', argsRaw: '{"name":"clock"}' }))
    expect(model.variant).toBe('others')
    expect(t(model.titleKey)).toBe('工具调用')
  })

  it('renders cordis mount verbs no shipped tool implements as generic calls', () => {
    // No shipped tool implements these cordis mount verbs, so a mapping would
    // be unreachable.
    expect(classifyTool('cordis_mount')).toBe('others')
    expect(t(toolRowModel('cordis_mount', running({ name: 'cordis_mount', argsRaw: '{}' })).titleKey)).toBe('工具调用')
    expect(t(toolRowModel('cordis_unmount', running({ name: 'cordis_unmount', argsRaw: '{}' })).titleKey)).toBe('工具调用')
  })

  it('gives the pwsh shell row the bash family treatment with its own title', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = toolRowModel('pwsh', running())
    expect(m.variant).toBe('bash')
    expect(t(m.titleKey)).toBe('Pwsh')
  })

  it('derives state across running/ok/error/interrupted', () => {
    expect(toolRowModel('bash', running()).state).toBe('running')
    expect(toolRowModel('bash', result()).state).toBe('ok')
    expect(toolRowModel('bash', result({ isError: true })).state).toBe('error')
    expect(toolRowModel('bash', result({ isError: true, error: { name: 'E', code: 'interrupted' } })).state).toBe('stopped')
  })

  it('derives the bash summary from description over command', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = toolRowModel('bash', running())
    expect(t(m.titleKey)).toBe('Bash')
    expect(m.summary).toBe('List files')
    expect(toolRowModel('bash', running({ argsRaw: '{"command":"pwd"}' })).summary).toBe('pwd')
  })

  it('keeps summaries single-line and falls back for opaque args', () => {
    expect(toolRowModel('bash', running({ argsRaw: '{"command":"a\\nb"}' })).summary).toBe('a')
    expect(toolRowModel('read', running({ name: 'read', argsRaw: '{"path":"/tmp/x.ts"}' })).summary).toBe('/tmp/x.ts')
    expect(toolRowModel('write', running({ name: 'write', argsRaw: '{"file_path":"src/x.ts"}' })).summary).toBe('src/x.ts')
    expect(toolRowModel('edit', running({ name: 'edit', argsRaw: '{"file_path":"src/x.ts"}' })).summary).toBe('src/x.ts')
    // Other rows prefix the real tool name into the summary slot (figma
    // flows: static "Tool call" title, the name rides the mutable summary).
    expect(toolRowModel('x', running({ argsRaw: '{"n":1}' })).summary).toBe('x · {"n":1}')
    expect(toolRowModel('x', running({ argsRaw: 'not json' })).summary).toBe('x · not json')
    expect(toolRowModel('x', running({ argsRaw: '' })).summary).toBe('x · c1')
    expect(toolRowModel('', running({ argsRaw: '' })).summary).toBe('c1')
  })

  it('joins multi-query web search arguments in the summary', () => {
    expect(toolRowModel('web_search', running({
      name: 'web_search',
      argsRaw: '{"queries":["first query","second\\nquery"]}',
    })).summary).toBe('first query, second')
  })

  it('exposes filePath for path/file_path args and skips URL-only reads', () => {
    expect(toolRowModel('read', running({ name: 'read', argsRaw: '{"path":"src/a.ts"}' })).filePath).toBe('src/a.ts')
    expect(toolRowModel('write', running({ name: 'write', argsRaw: '{"file_path":"src/a.ts"}' })).filePath).toBe('src/a.ts')
    expect(toolRowModel('edit', running({ name: 'edit', argsRaw: '{"file_path":"src/a.ts"}' })).filePath).toBe('src/a.ts')
    expect(toolRowModel('web_fetch', running({ name: 'web_fetch', argsRaw: '{"url":"https://example.com"}' })).filePath)
      .toBeUndefined()
    expect(toolRowModel('bash', running()).filePath).toBeUndefined()
  })

  it('displays workspace-rooted paths relative to the session cwd', () => {
    /** 中文说明：测试局部值 cwd，由紧邻初始化决定。 */
    const cwd = '/Users/u/ws/'
    expect(toolRowModel('edit', running({ name: 'edit', argsRaw: '{"file_path":"/Users/u/ws/src/x.ts"}' }), cwd).summary).toBe('src/x.ts')
    expect(toolRowModel('read', running({ name: 'read', argsRaw: '{"path":"/Users/u/ws/a.md"}' }), cwd).summary).toBe('a.md')
    // Paths outside the workspace (and non-path summaries) stay verbatim.
    expect(toolRowModel('read', running({ name: 'read', argsRaw: '{"path":"/etc/hosts"}' }), cwd).summary).toBe('/etc/hosts')
    expect(toolRowModel('bash', running({ argsRaw: '{"command":"pwd"}' }), cwd).summary).toBe('pwd')
    expect(toolRowModel('read', running({ name: 'read', argsRaw: '{"path":"/Users/u/ws/a.md"}' }), '').summary).toBe('/Users/u/ws/a.md')
  })

  it('abbreviates leftover POSIX home paths after cwd relativization', () => {
    /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
    const home = '/Users/u'
    /** 中文说明：测试局部值 cwd，由紧邻初始化决定。 */
    const cwd = '/tmp/ws'
    expect(toolRowModel('read', running({ name: 'read', argsRaw: '{"path":"/Users/u"}' }), cwd, home).summary).toBe('~')
    expect(toolRowModel('read', running({ name: 'read', argsRaw: '{"path":"/Users/u/notes.md"}' }), cwd, home).summary)
      .toBe('~/notes.md')
    // Workspace-relative wins: a home-and-cwd descendant stays short, not `~/…`.
    expect(toolRowModel(
      'read',
      running({ name: 'read', argsRaw: '{"path":"/Users/u/proj/src/a.ts"}' }),
      '/Users/u/proj',
      home,
    ).summary).toBe('src/a.ts')
    // Prefix boundary: `/Users/u2` is not under `/Users/u`.
    expect(toolRowModel('read', running({ name: 'read', argsRaw: '{"path":"/Users/u2/a.ts"}' }), cwd, home).summary)
      .toBe('/Users/u2/a.ts')
    expect(toolRowModel(
      'read',
      running({ name: 'read', argsRaw: '{"path":"C:\\\\Users\\\\u\\\\a.ts"}' }),
      cwd,
      home,
    ).summary).toBe('C:\\Users\\u\\a.ts')
    expect(toolRowModel('read', running({ name: 'read', argsRaw: '{"path":"/Users/u/a.ts"}' }), cwd).summary)
      .toBe('/Users/u/a.ts')
  })

  it('body pretty-prints JSON args, keeps raw non-JSON, null when empty', () => {
    expect(toolRowModel('bash', running({ argsRaw: '{"a":1}' })).body).toBe('{\n  "a": 1\n}')
    expect(toolRowModel('bash', running({ argsRaw: 'raw' })).body).toBe('raw')
    expect(toolRowModel('bash', running({ argsRaw: '' })).body).toBeNull()
    expect(toolRowModel('bash', result({ call: null })).body).toBeNull()
  })

  it('a code row with an empty program falls back to the args JSON envelope', () => {
    expect(toolRowModel('run_code', running({ name: 'run_code', argsRaw: '{"code":""}' })).body)
      .toBe('{\n  "code": ""\n}')
  })

  it('resultText flattens text blocks verbatim, other shapes as JSON, empty error content to name: code', () => {
    expect(resultText(result({ content: [{ type: 'text', text: 'a\nb' }] }))).toBe('a\nb')
    expect(resultText(result({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' } as never] })))
      .toBe(`a\n${JSON.stringify({ type: 'image', data: 'x' }, null, 2)}`)
    expect(resultText(result({ content: [], isError: true, error: { name: 'ToolError', code: 'denied' } })))
      .toBe('ToolError: denied')
    expect(resultText(result({ content: [] }))).toBe('')
  })

  it('derives output from the settled result and null while running or blank', () => {
    expect(toolRowModel('bash', result({ content: [{ type: 'text', text: 'out' }] })).output).toBe('out')
    expect(toolRowModel('bash', running()).output).toBeNull()
    expect(toolRowModel('bash', result({ content: [] })).output).toBeNull()
  })

  it('derives errorSummary as the first output line on error rows only', () => {
    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = result({ content: [{ type: 'text', text: 'boom\ndetail' }], isError: true })
    expect(toolRowModel('bash', failed).errorSummary).toBe('boom')
    expect(toolRowModel('bash', result({ content: [{ type: 'text', text: 'boom' }] })).errorSummary).toBeNull()
    expect(toolRowModel('bash', result({ content: [], isError: true })).errorSummary).toBeNull()
    expect(toolRowModel('bash', running()).errorSummary).toBeNull()
  })

  it('gives Cordis lifecycle tools action titles over their generic variants', () => {
    expect(toolRowModel('cordis_runtime_inspect', running({
      name: 'cordis_runtime_inspect',
      argsRaw: '{"what":"api","name":"tools"}',
    }))).toMatchObject({
      variant: 'read',
      titleKey: 'tool.title.inspect',
      summary: 'api',
    })
    expect(toolRowModel('cordis_run', running({
      name: 'cordis_run',
      argsRaw: '{"id":"dyn-2"}',
    }))).toMatchObject({
      variant: 'others',
      titleKey: 'tool.title.runCordis',
      summary: 'dyn-2',
    })
    expect(toolRowModel('cordis_undefine', result({
      call: { name: 'cordis_undefine', argsRaw: '{"id":"dyn-2"}' },
    }))).toMatchObject({
      variant: 'others',
      titleKey: 'tool.title.removeCordis',
      summary: 'dyn-2',
    })
  })
})

describe('ToolRow', () => {
  /** 中文说明：测试局部值 rowProps，由紧邻初始化决定。 */
  const rowProps = {
    t,
    variant: 'bash' as const, icon: <i data-testid="tool-icon" />, title: 'Bash',
    summary: 'List files', body: '{\n  "a": 1\n}', state: 'ok' as const,
  }

  it('renders leading icon, title and summary while collapsed', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolRow {...rowProps} />)
    expect(view.queryByTestId('tool-icon')).not.toBeNull()
    expect(view.getByText('Bash')).toBeTruthy()
    expect(view.getByText('List files')).toBeTruthy()
    expect(view.container.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('row click expands: chevron leading, summary kept inline, body in the scrolling card', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolRow {...rowProps} />)
    fireEvent.click(view.getByRole('button'))
    expect(view.queryByTestId('tool-icon')).toBeNull()
    expect(view.container.querySelector('svg')).not.toBeNull()
    expect(view.getByText('List files')).toBeTruthy()
    expect(view.getByText(/"a": 1/)).toBeTruthy()
    expect(view.container.querySelector('[class*="ioCard"]')).not.toBeNull()
    fireEvent.click(view.getByRole('button'))
    expect(view.queryByTestId('tool-icon')).not.toBeNull()
    expect(view.getByText('List files')).toBeTruthy()
  })

  it('running keeps the icon (row sweep carries the signal); error swaps in a StateDot', () => {
    /** 中文说明：测试局部值 runningView，由紧邻初始化决定。 */
    const runningView = render(<ToolRow {...rowProps} state="running" />)
    expect(runningView.queryByTestId('tool-icon')).not.toBeNull()
    expect(runningView.container.querySelector('[data-state="running"]')).not.toBeNull()
    /** 中文说明：测试局部值 errorView，由紧邻初始化决定。 */
    const errorView = render(<ToolRow {...rowProps} state="error" />)
    expect(errorView.container.querySelector('[data-testid="tool-icon"]')).toBeNull()
    // The dot rides the idle slot, so an expandable error row keeps the
    // icon→chevron hover preview instead of losing it with the icon.
    expect(errorView.container.querySelector('[class*="chevronHover"]')).not.toBeNull()
  })

  it('non-expandable rows render a passive leading slot and no row button', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolRow {...rowProps} body={null} />)
    expect(view.queryByRole('button')).toBeNull()
    expect(view.container.querySelector('[aria-expanded]')).toBeNull()
    expect(view.queryByTestId('tool-icon')).not.toBeNull()
  })

  it('the row toggles from Enter and Space, ignoring other keys', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolRow {...rowProps} />)
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = view.getByRole('button')
    fireEvent.keyDown(row, { key: 'Tab' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(row.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(row, { key: ' ' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('file rows expand from the row while the path link opens without toggling', () => {
    /** 中文说明：测试局部值 open，由紧邻初始化决定。 */
    const open = vi.fn()
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <ToolRow {...rowProps} variant="read" title="Read" summary="src/a.ts" filePath="src/a.ts" onOpenFile={open} />,
    )
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = view.getByRole('button', { name: /Read/ })
    // Path click opens the file and leaves the row collapsed.
    fireEvent.click(view.getByText('src/a.ts'))
    expect(open).toHaveBeenCalledWith('src/a.ts')
    expect(row.getAttribute('aria-expanded')).toBe('false')
    // Row click (outside the link) expands the args body.
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText(/"a": 1/)).toBeTruthy()
  })

  it('a file path without onOpenFile renders a plain summary on an expandable row', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <ToolRow {...rowProps} variant="write" title="Write" summary="作文.md" filePath="作文.md" />,
    )
    expect(view.container.querySelector('button')).toBeNull()
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = view.getByRole('button')
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText(/"a": 1/)).toBeTruthy()
  })

  it('non-file rows do not open anything when the summary is clicked', () => {
    /** 中文说明：测试局部值 open，由紧邻初始化决定。 */
    const open = vi.fn()
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolRow {...rowProps} onOpenFile={open} />)
    fireEvent.click(view.getByText('List files'))
    expect(open).not.toHaveBeenCalled()
  })

  it('an error row shows the failure first line in the collapsed summary and the full text expanded', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <ToolRow {...rowProps} state="error" errorSummary="boom" output={'boom\ndetail'} />,
    )
    expect(view.getByText('boom')).toBeTruthy()
    expect(view.queryByText('List files')).toBeNull()
    fireEvent.click(view.getByRole('button'))
    expect(view.getByText(/detail/)).toBeTruthy()
    expect(view.container.querySelector('[data-error]')).not.toBeNull()
  })

  it('an error row without an error summary keeps the args summary', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolRow {...rowProps} state="error" errorSummary={null} />)
    expect(view.getByText('List files')).toBeTruthy()
  })

  it('renders summarySuffix outside the ellipsized summary span, and drops it on a failure line', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolRow {...rowProps} summarySuffix="+2" />)
    /** 中文说明：测试局部值 summary，由紧邻初始化决定。 */
    const summary = view.getByText('List files')
    /** 中文说明：测试局部值 suffix，由紧邻初始化决定。 */
    const suffix = view.getByText('+2')
    // Separate spans: .summary truncates, the suffix must not travel inside it.
    expect(summary.contains(suffix)).toBe(false)
    view.unmount()
    // The failure line replaces the summary wholesale, so the suffix goes with it.
    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = render(
      <ToolRow {...rowProps} state="error" errorSummary="boom" summarySuffix="+2" />,
    )
    expect(failed.queryByText('+2')).toBeNull()
  })

  it('an error file row drops the open-file link (the summary is failure prose, not the path)', () => {
    /** 中文说明：测试局部值 open，由紧邻初始化决定。 */
    const open = vi.fn()
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <ToolRow
        {...rowProps}
        variant="write" title="Write" state="error" errorSummary="cannot overwrite"
        filePath="src/a.ts" onOpenFile={open}
      />,
    )
    fireEvent.click(view.getByText('cannot overwrite'))
    expect(open).not.toHaveBeenCalled()
    // The failure line renders as plain text, not the underlined link button.
    expect(view.container.querySelector('[class*="fileLink"]')).toBeNull()
  })

  it('the expanded body carries a hover Inspect pill that fires the callback', () => {
    /** 中文说明：测试局部值 inspect，由紧邻初始化决定。 */
    const inspect = vi.fn()
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolRow {...rowProps} inspect={inspect} />)
    // Collapsed: no pill.
    expect(view.queryByText('查看')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /Bash/ }))
    const pill = view.getByText('查看')
    fireEvent.click(pill)
    expect(inspect).toHaveBeenCalledTimes(1)
    // The pill click must not collapse the row (body is a .row sibling).
    expect(view.getByRole('button', { name: /Bash/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('no inspect callback, no pill', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolRow {...rowProps} />)
    fireEvent.click(view.getByRole('button'))
    expect(view.queryByText('查看')).toBeNull()
  })

  it('the expanded card gutter-labels each section it carries (IN / OUT)', () => {
    /** 中文说明：测试局部值 both，由紧邻初始化决定。 */
    const both = render(<ToolRow {...rowProps} output="result text" />)
    fireEvent.click(both.getByRole('button'))
    expect(both.getByText('输入')).toBeTruthy()
    expect(both.getByText('输出')).toBeTruthy()
    expect(both.getByText('result text')).toBeTruthy()
    cleanup()
    /** 中文说明：测试局部值 inputOnly，由紧邻初始化决定。 */
    const inputOnly = render(<ToolRow {...rowProps} />)
    fireEvent.click(inputOnly.getByRole('button'))
    expect(inputOnly.getByText('输入')).toBeTruthy()
    expect(inputOnly.queryByText('输出')).toBeNull()
    cleanup()
    /** 中文说明：测试局部值 outputOnly，由紧邻初始化决定。 */
    const outputOnly = render(<ToolRow {...rowProps} body={null} output="only out" />)
    fireEvent.click(outputOnly.getByRole('button'))
    expect(outputOnly.queryByText('输入')).toBeNull()
    expect(outputOnly.getByText('输出')).toBeTruthy()
    expect(outputOnly.getByText('only out')).toBeTruthy()
  })
})

describe('GenericToolCard', () => {
  /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
  const props = (toolName: string, block: RunningToolCall | ToolResultNode): GenericToolCardProps => ({
    callId: 'c1', toolName, block, openFile: vi.fn(), t,
  })

  it('renders the classified variant row from the frozen slice', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<GenericToolCard {...props('bash', result())} />)
    expect(view.getByText('Bash')).toBeTruthy()
    expect(view.getByText('List files')).toBeTruthy()
    expect(view.container.querySelector('[data-variant="bash"]')).not.toBeNull()
  })

  it('unknown tools land on the others variant titled Tool call', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <GenericToolCard {...props('todo_write', running({ name: 'todo_write', argsRaw: '{"note":"x"}' }))} />,
    )
    expect(view.getByText('工具调用')).toBeTruthy()
    expect(view.container.querySelector('[data-variant="others"]')).not.toBeNull()
    expect(view.container.querySelector('[data-state="running"]')).not.toBeNull()
  })

  it('renders edit with its dedicated title, icon variant, and path summary', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <GenericToolCard {...props('edit', running({
        name: 'edit',
        argsRaw: '{"file_path":"src/x.ts","old_string":"before","new_string":"after"}',
      }))} />,
    )
    expect(view.getByText('编辑')).toBeTruthy()
    expect(view.getByText('src/x.ts')).toBeTruthy()
    expect(view.container.querySelector('[data-variant="edit"]')).not.toBeNull()
    expect(view.container.querySelector('svg')).not.toBeNull()
  })

  it('renders write with its dedicated title, icon variant, and path summary', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <GenericToolCard {...props('write', running({
        name: 'write',
        argsRaw: '{"file_path":"src/x.ts","content":"hello"}',
      }))} />,
    )
    expect(view.getByText('写入')).toBeTruthy()
    expect(view.getByText('src/x.ts')).toBeTruthy()
    expect(view.container.querySelector('[data-variant="write"]')).not.toBeNull()
    expect(view.container.querySelector('svg')).not.toBeNull()
  })

  it('passes the owner inspect callback through to the expanded row pill', () => {
    /** 中文说明：测试局部值 inspect，由紧邻初始化决定。 */
    const inspect = vi.fn()
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<GenericToolCard {...props('bash', result())} inspect={inspect} />)
    fireEvent.click(view.getByRole('button', { name: /Bash/ }))
    fireEvent.click(view.getByText('查看'))
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('file-path summary click reaches openFile; bash summary does not', () => {
    /** 中文说明：测试局部值 file，由紧邻初始化决定。 */
    const file = props('read', running({ name: 'read', argsRaw: '{"path":"src/x.ts"}' }))
    /** 中文说明：测试局部值 fileView，由紧邻初始化决定。 */
    const fileView = render(<GenericToolCard {...file} />)
    fireEvent.click(fileView.getByText('src/x.ts'))
    expect(file.openFile).toHaveBeenCalledWith('src/x.ts')

    /** 中文说明：测试局部值 bash，由紧邻初始化决定。 */
    const bash = props('bash', result())
    /** 中文说明：测试局部值 bashView，由紧邻初始化决定。 */
    const bashView = render(<GenericToolCard {...bash} />)
    fireEvent.click(bashView.getByText('List files'))
    expect(bash.openFile).not.toHaveBeenCalled()
  })
})
