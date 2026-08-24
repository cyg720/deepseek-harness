// @vitest-environment jsdom
// 本测试在 jsdom 中装配并渲染构建后的浏览器插件图。
// The built-bundle boot smoke: the assembled-jsdom test that owns the boot
// graph itself. Other files share the same scaffolding (assembled-boot.ts) to
// reach a surface only the built bundles expose; this one asserts that the
// graph assembles at all — staged activation across the immediately tier and
// the inject layers, per-plugin CSS injection, and a rendered journey reaching
// chat content from the keyless FixtureApiClient transport.
//
// Component behavior remains owned by per-package suites (SlotTestRuntime
// benches over src). This smoke additionally pins the resident interaction
// fixture's cross-plugin projection because only the built connection/runtime/
// workspace graph can prove that transport-to-row path end to end.
// 此冒烟测试还固定跨插件投影，因为只有构建后的连接、运行时与工作区图能端到端证明该链路。
/**
 * 文件职责：验证真实构建客户端插件图能够分层激活、注入样式并渲染完整夹具会话。
 * 技术维度：使用 jsdom、Testing Library、动态装配启动器和客户端构建环境记录。
 * 产品维度：保证发布 Web 客户端从传输到会话行、工具卡、上下文面板和样式均可正常工作。
 * 逻辑维度：校验构建记录，挂载装配应用，依次检查侧栏、等待状态、聊天、工具卡和 CSS 注入。
 * 关键边界：依赖全部客户端构建产物；组件细节由各包单测负责，这里只验证跨插件发布链路。
 * 新手阅读建议：先读 assembled-boot.ts，再按侧栏、编辑器接管、差异卡、Web 卡和样式顺序阅读。
 */
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
/** 构建记录声明的客户端环境信息。 */
const clientBuildEnvironment: unknown = Reflect.get(record, 'environment')
if (typeof clientBuildEnvironment !== 'object' || clientBuildEnvironment === null) {
  throw new TypeError('client build record environment must be an object')
}

/**
 * 判断动态导出是否为构建记录读取函数。
 * @param value 待检查的动态模块字段。
 * @returns 值为函数时收窄为读取器类型。
 * @example `isBuildRecordReader(module.readClientBuildRecord)`
 */
function isBuildRecordReader(value: unknown): value is (root: string) => unknown {
  return typeof value === 'function'
}

/** 构建插件图应能端到端渲染夹具会话的所有跨插件表面。 */
it('boots the built plugin graph and renders a fixture session end to end', async () => {
  mountAssembledApp()

  // The sidebar renders from the boot graph: every inject layer activated.
  // 侧栏来自真实启动图，出现即证明各注入层已经激活。
  /** 已装配应用渲染的会话树。 */
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  expect(document.querySelector('svg[viewBox="26 0 156 24"]')).not.toBeNull()
  expect(screen.queryByText('DSH Local Build')).toBeNull()
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
