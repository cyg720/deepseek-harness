// @vitest-environment jsdom
/** 真实槽注册表下的装配：行键、八类子插件、卸载与重装。 */
import { afterEach, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyHostStub } from '@deepseek-ai/dsh-qs-ui-tool'
import { apply, inject } from '../src/client/index.ts'
import { shellToolview } from '../src/client/toolviews/bash.tsx'
import { readToolview } from '../src/client/toolviews/read.tsx'
import { readImageToolview } from '../src/client/toolviews/read-image.tsx'
import { fileMutationToolview } from '../src/client/toolviews/file-mutation.tsx'
import { searchToolview } from '../src/client/toolviews/search.tsx'
import { webToolview } from '../src/client/toolviews/web.tsx'
import { todoToolview } from '../src/client/toolviews/todo.tsx'
import { askQuestionToolview } from '../src/client/toolviews/ask-question.tsx'

usePinnedBrowserLanguages('zh-CN')

/** 八类子插件覆盖的 wire 工具名：一个插件可注册多个键。 */
const TOOL_KEYS = [
  'bash', 'pwsh', 'read', 'read_image', 'write', 'edit', 'grep', 'glob',
  'web_search', 'web_fetch', 'todo_write', 'ask_user_question',
] as const

let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

/**
 * 装配本包：先由测试宿主声明转写行槽，再挂载被测包。
 * @returns 已装配的运行时。
 */
async function bench(): Promise<SlotTestRuntime> {
  const created = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(created.ctx)
  created.ctx.provide('locale', locale)
  created.slots.installLocale(locale)
  await created.declare({ 'qs.stage.transcript.row': { kind: 'keyed', scope: 'session',
    inject: { hooks: { turnData: () => () => undefined } },
  } })
  return created
}

it('注册 tool-call 行并声明工具子槽，八类子插件逐个落到各自键上', async () => {
  runtime = await bench()
  const mounted = await runtime.mount({ inject: [...inject], apply })
  const rows = runtime.slots.entries('qs.stage.transcript.row')
  expect(rows).toHaveLength(1)
  expect(rows[0]?.options.key).toBe('tool-call')
  // 声明子槽的条目才被允许渲染它：同一行既是贡献者也是宿主。
  expect(runtime.slots.spec('qs.tool.call.toolview')).toMatchObject({ kind: 'keyed', scope: 'session' })
  const keys = runtime.slots.entries('qs.tool.call.toolview').map(entry => entry.options.key).sort()
  expect(keys).toEqual([...TOOL_KEYS].sort())
  // 未认领的键（含孤儿结果的空键）必须落到兜底卡，而不是被某个已知工具接走。
  expect(keys).not.toContain('')
  expect(keys).not.toContain('unknown_tool')

  await mounted.dispose()
  expect(runtime.slots.entries('qs.stage.transcript.row')).toHaveLength(0)
  expect(runtime.slots.entries('qs.tool.call.toolview')).toHaveLength(0)
})

it('卸载后重装不重复注册，子槽再次就绪', async () => {
  runtime = await bench()
  const first = await runtime.mount({ inject: [...inject], apply })
  await first.dispose()
  const second = await runtime.mount({ inject: [...inject], apply })
  expect(runtime.slots.entries('qs.stage.transcript.row')).toHaveLength(1)
  expect(runtime.slots.entries('qs.tool.call.toolview')).toHaveLength(TOOL_KEYS.length)
  await second.dispose()
})

it('转写行槽缺席时本包不注册任何内容，也不报错', async () => {
  runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  const mounted = await runtime.mount({ inject: [...inject], apply })
  expect(runtime.slots.entries('qs.stage.transcript.row')).toHaveLength(0)
  expect(runtime.slots.entries('qs.tool.call.toolview')).toHaveLength(0)
  await mounted.dispose()
})

it('宿主侧入口保持空实现，不注册任何行为', () => {
  expect(() => { applyHostStub() }).not.toThrow()
})

// 与官方八个子插件逐项对应；单个子插件退出不得重建兄弟贡献或夺走父槽。
it.each([
  { plugin: shellToolview, keys: ['bash', 'pwsh'] },
  { plugin: readToolview, keys: ['read'] },
  { plugin: readImageToolview, keys: ['read_image'] },
  { plugin: fileMutationToolview, keys: ['write', 'edit'] },
  { plugin: searchToolview, keys: ['grep', 'glob'] },
  { plugin: webToolview, keys: ['web_search', 'web_fetch'] },
  { plugin: todoToolview, keys: ['todo_write'] },
  { plugin: askQuestionToolview, keys: ['ask_user_question'] },
])('$plugin.name 独立卸载与重装保留父行和兄弟实例', async ({ plugin, keys }) => {
  runtime = await bench()
  const parent = await runtime.mount({ inject: [...inject], apply })
  const parentRow = runtime.slots.entries('qs.stage.transcript.row')[0]
  const siblings = runtime.slots.entries('qs.tool.call.toolview').filter(entry => !keys.includes(entry.options.key ?? ''))
  const children = [...runtime.ctx.registry.get(plugin)!.fibers]
  expect(children).toHaveLength(1)

  await children[0]!.dispose()
  await runtime.flush()
  expect(runtime.slots.entries('qs.stage.transcript.row')[0]).toBe(parentRow)
  const remaining = runtime.slots.entries('qs.tool.call.toolview')
  expect(remaining.map(entry => entry.options.key).sort()).toEqual(TOOL_KEYS.filter(key => !keys.includes(key)).sort())
  for (const sibling of siblings) expect(remaining.find(entry => entry.options.key === sibling.options.key)).toBe(sibling)
  if (plugin === readImageToolview) expect(runtime.slots.spec('qs.tool.call.images')).toBeUndefined()

  // 重装仍归父插件持有，确保最终父级退出能收回新增的子 fiber。
  const replacement = parent.fiber.ctx.plugin(plugin)
  await replacement.await()
  await runtime.flush()
  const restored = runtime.slots.entries('qs.tool.call.toolview')
  expect(restored.map(entry => entry.options.key).sort()).toEqual([...TOOL_KEYS].sort())
  for (const sibling of siblings) expect(restored.find(entry => entry.options.key === sibling.options.key)).toBe(sibling)
  if (plugin === readImageToolview) expect(runtime.slots.spec('qs.tool.call.images')).toMatchObject({ kind: 'single', scope: 'session' })

  await parent.dispose()
  expect(runtime.slots.entries('qs.stage.transcript.row')).toHaveLength(0)
  expect(runtime.slots.entries('qs.tool.call.toolview')).toHaveLength(0)
  expect(runtime.slots.spec('qs.tool.call.images')).toBeUndefined()
})
