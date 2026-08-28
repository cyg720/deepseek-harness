// @vitest-environment jsdom
// 本测试在 jsdom 中装配并渲染构建后的浏览器插件图。
// The built-bundle boot smoke: the assembled-jsdom test that owns the boot
// graph itself. Other files share the same scaffolding (assembled-boot.ts) to
// reach a surface only the built bundles expose; this one asserts that the
// graph assembles at all — staged activation across the immediately tier and
// the inject layers, per-plugin CSS injection, and a rendered journey reaching
// chat content from the keyless fixture Connection RPC.
//
// Component behavior remains owned by per-package suites (SlotTestRuntime
// benches over src). This smoke additionally pins the resident interaction
// fixture's cross-plugin projection because only the built connection,
// Controller, UI adapter, and Workspace graph can prove that transport-to-row
// path end to end.
import { resolve } from 'node:path'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

/** 客户端构建环境读取脚本的相对模块路径。 */
const buildEnvironmentModulePath = '../../../scripts/client-build-environment.ts'
/** 动态导入的构建环境模块。 */
const buildEnvironmentModule: unknown = await import(buildEnvironmentModulePath)
if (typeof buildEnvironmentModule !== 'object' || buildEnvironmentModule === null) {
  throw new TypeError('client build environment module must be an object')
}
/** 从动态模块反射读取的构建记录解析函数。 */
const readClientBuildRecord: unknown = Reflect.get(buildEnvironmentModule, 'readClientBuildRecord')
if (!isBuildRecordReader(readClientBuildRecord)) {
  throw new TypeError('client build environment module must export readClientBuildRecord')
}
/** 仓库根目录对应的客户端构建记录。 */
const record: unknown = readClientBuildRecord(resolve(import.meta.dirname, '../../..'))
if (typeof record !== 'object' || record === null) throw new TypeError('client build record must be an object')
const clientBuildEnvironment = requireObject(
  Reflect.get(record, 'environment'),
  'client build record environment must be an object',
)

/**
 * 判断动态导出是否为构建记录读取函数。
 * @param value 待检查的动态模块字段。
 * @returns 值为函数时收窄为读取器类型。
 * @example `isBuildRecordReader(module.readClientBuildRecord)`
 */
function isBuildRecordReader(value: unknown): value is (root: string) => unknown {
  return typeof value === 'function'
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (!isUnknownRecord(value)) throw new TypeError(message)
  return value
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Read one optional string from the verified client build record. */
function clientBuildValue(name: string): string | undefined {
  const value = clientBuildEnvironment[name]
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`client build record environment ${name} must be a string`)
  }
  return value
}

it('boots the built plugin graph and renders a fixture session end to end', async () => {
  mountAssembledApp()

  // The sidebar renders from the boot graph: every inject layer activated.
  // 侧栏来自真实启动图，出现即证明各注入层已经激活。
  /** 已装配应用渲染的会话树。 */
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  if (clientBuildValue('DSH_CLIENT_BUILD_PROFILE') === 'official') {
    expect(document.querySelector('svg[viewBox="26 0 156 24"]')).not.toBeNull()
    expect(screen.queryByText('DSH Local Build')).toBeNull()
  } else {
    expect(document.querySelector('svg[viewBox="0 0 23.16 17.04"]')).not.toBeNull()
    const version = clientBuildValue('DSH_CLIENT_VERSION')
    if (version === undefined) throw new Error('default client build record must carry DSH_CLIENT_VERSION')
    const commit = clientBuildValue('DSH_CLIENT_COMMIT_HASH')
    const buildVersion = version
      + (commit === undefined ? '' : `-${commit}`)
      + (clientBuildValue('DSH_CLIENT_GIT_DIRTY') === 'true' ? '-dirty' : '')
    screen.getByText('DSH Local Build')
    screen.getByText(buildVersion)
  }
  // The compact layout dropped group session counts; the fixture workspace
  // group row renders immediately with its sessions beneath it.
  // 紧凑布局不显示分组计数，fixture 工作区行与子会话直接出现。
  /** 可展开的 fixture 工作区树行。 */
  const fixtureGroup = (await within(tree).findAllByText('fixture'))
    .map(el => el.closest<HTMLElement>('[role="treeitem"]'))
    .find(el => el?.getAttribute('aria-expanded') !== null)
  if (fixtureGroup === undefined) throw new Error('fixture Workspace group missing')

  // The resident fixture has both a question and an approval; composer routing
  // exposes the question first, and the assembled workspace plugin mirrors that
  // actionable wait instead of the underlying running state.
  // 常驻夹具同时包含问题和审批，编辑器先展示问题，侧栏投影显示可操作等待而非运行中。
  /** 等待用户回答的夹具会话标题。 */
  const waitingTitle = await within(tree).findByText('Fixture 历史会话')
  /** 包含等待状态图标的会话树行。 */
  const waitingRow = waitingTitle.closest<HTMLElement>('[role="treeitem"]')
  if (waitingRow === null) throw new Error('fixture Session title must belong to a tree row')
  expect(waitingRow.querySelector('[data-state="warning"]')).not.toBeNull()
  expect(waitingRow.querySelector('[data-state="ongoing"]')).toBeNull()
  within(waitingRow).getByText('Waiting for answer')

  // Opening a session reaches chat content through the fixture transport.
  fireEvent.click(waitingTitle)
  await waitFor(() => {
    expect(document.querySelector('[data-sample="bash"]')).not.toBeNull()
  }, { timeout: 10_000 })
  // The generated bundle roster mounts the question UI before the approval UI.
  // Skip the resident fixture's three questions, then resolve its approval so
  // the ordinary composer bar (which owns ContextMeter) resumes.
  for (let index = 0; index < 3; index += 1) {
    fireEvent.click(await screen.findByRole('button', { name: 'Skip this question' }))
  }
  fireEvent.click(await screen.findByRole('button', { name: 'Allow once' }))

  // The fixture mirrors all three token-meter projections, so the assembled
  // ContextMeter reaches its composition panel instead of only the occupancy
  // fallback path.
  // 三种 token-meter 投影齐全时，上下文面板显示组成明细而非仅占用率回退。
  /** 打开上下文使用面板的按钮。 */
  const contextTrigger = await screen.findByRole('button', { name: /of context used/ })
  fireEvent.click(contextTrigger)
  /** 上下文组成详情对话框。 */
  const contextPanel = await screen.findByRole('dialog', { name: 'of context used' })
  within(contextPanel).getByText('System prompt')
  within(contextPanel).getByText('Tools')
  within(contextPanel).getByText('Messages')

  // The write/edit turns render a real diff card through the assembled graph
  // (the keyed FileMutationRow composing ToolRow + DiffBlock), not just the
  // fixture's raw text. The card is collapsed by default, so expand each edit/
  // write row first. The write turn's `hello fixture\n` proves the terminator
  // rule end to end: a trailing newline terminates its line, so the footer reads
  // `+1` (not a phantom `+2`) and one distinct file. The `+ ` prefix is a CSS
  // ::before, so it is absent from textContent — assert on the line body and the
  // footer.
  // 写入/编辑行通过真实 DiffBlock 渲染；展开后验证尾换行不会制造虚假第二行。
  /** 页面中所有写入和编辑工具行。 */
  const mutationRows = [...document.querySelectorAll('[data-variant="write"],[data-variant="edit"]')]
  expect(mutationRows.length).toBeGreaterThan(0)
  for (const row of mutationRows) {
    /** 当前文件变更行的展开控件。 */
    const toggle = row.querySelector('[data-expandable]')
    if (toggle !== null) act(() => { fireEvent.click(toggle) })
  }
  /** 展开后出现的真实差异卡片。 */
  const diffCards = [...document.querySelectorAll('[data-diff]')]
  expect(diffCards.length).toBeGreaterThan(0)
  /** 每张差异卡的完整文本，用于检查行数页脚。 */
  const footers = diffCards.map(card => card.textContent ?? '')
  expect(footers.some(text => text.includes('hello fixture') && text.includes('+1 -0 · 1 file'))).toBe(true)

  // The web render intent reaches the assembled boot graph: the fixture's
  // web_search / web_fetch turns render their keyed WebRow cards, proving the
  // registration, wire projection, and card rendering survive the real bundle
  // path (not just the per-package src benches). WebRow composes ToolRow, so the
  // card is collapsed behind the row; the keyed row is pinned by its `data-tool`
  // (ToolRow sets it from the wire tool name).
  // Web 工具通过真实键控行和 data-tool 属性进入装配图，非包级源码测试替身。
  /** 已渲染的 web_search 工具行。 */
  const webSearchRow = await waitFor(() => {
    /** 当前 DOM 中的 web_search 行。 */
    const row = document.querySelector('[data-tool="web_search"]')
    expect(row).not.toBeNull()
    expect(document.querySelector('[data-tool="web_fetch"]')).not.toBeNull()
    return row!
  }, { timeout: 10_000 })
  // Expand the web_search row to prove its WebBlock card renders end to end.
  // 展开 web_search 行以证明 WebBlock 卡片端到端渲染。
  /** web_search 行的可选展开控件。 */
  const webToggle = webSearchRow.querySelector('[data-expandable]')
  if (webToggle !== null) act(() => { fireEvent.click(webToggle) })
  await waitFor(() => {
    expect(webSearchRow.querySelector('[data-web]')).not.toBeNull()
  }, { timeout: 10_000 })

  // Every bundle injected its plugin-owned style tag (the loader's CSS path).
  // 每个 bundle 必须通过 Loader 的 CSS 路径注入归属自己的样式标签。
  /** 文档头中所有插件样式标签的包名。 */
  const styleOwners = [...document.head.querySelectorAll('style[data-plugin]')]
    .map(style => style.getAttribute('data-plugin'))
  for (const plugin of ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-tool']) {
    expect(styleOwners).toContain(plugin)
  }
})

it('boots without ui-chat and does not select another conversation view implicitly', async () => {
  mountAssembledApp('?fixture', { exclude: ['@deepseek-ai/dsh-client-ui-chat'] })

  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  const boot = Reflect.get(window, '__DSH_BOOT__') as { entries: Array<{ id: string }> } | undefined
  expect(boot?.entries.some(entry => entry.id === '@deepseek-ai/dsh-client-ui-chat')).toBe(false)
  const sessionTitle = await within(tree).findByText('Fixture 历史会话')
  fireEvent.click(sessionTitle)
  await waitFor(() => {
    expect(document.querySelector('[data-slot="conversation.session"]')).not.toBeNull()
  }, { timeout: 10_000 })
  expect(document.querySelector('[data-slot="conversation.view"]')).toBeNull()
})
