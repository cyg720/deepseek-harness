/** 真实注册表与槽内核探针；不冒充尚未开发的 QS 插件端到端验收。 */
import { expect, it } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
// root 类型由官方 renderer 声明；探针只在自己创建的 SlotCore 中占用根槽。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DocumentPreviewRegistry } from '../../../packages/client/ui-sidebar-documentpreview/src/client/document/registry.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'qs.probe.official': { kind: 'keyed'; scope: 'session' }
    'qs.probe.document': { kind: 'keyed'; scope: 'session' }
    'qs.probe.composer': { kind: 'chain'; scope: 'session'; owner: { readonly: boolean } }
  }
}

function setup() {
  const core = new SlotCore()
  const dispose = core.register({ name: 'root', children: {
    'qs.probe.official': { kind: 'keyed', scope: 'session' },
    'qs.probe.document': { kind: 'keyed', scope: 'session' },
    'qs.probe.composer': { kind: 'chain', scope: 'session' },
  } }, (_props: PropsRenderSlots<'qs.probe.official' | 'qs.probe.document' | 'qs.probe.composer'>) => null)
  return { core, dispose }
}

// 编译负例只由 tsc 检查，不能作为运行时业务行为测试。
function rejectedDeclarations(core: SlotCore) {
  // @ts-expect-error session 槽不能以 root scope 声明。
  core.register({ name: 'root', children: { 'qs.probe.document': { kind: 'keyed', scope: 'root' } } }, (_props: PropsRenderSlots<'qs.probe.document'>) => null)
  // @ts-expect-error chain 必须显式提供 select。
  core.register({ name: 'qs.probe.composer' }, () => null)
}
void rejectedDeclarations

it('两个呈现槽共享同一元数据 ID，不重复注册元数据', () => {
  const registry = new DocumentPreviewRegistry()
  const definition = { id: 'example/text', extensions: ['txt'], title: () => '文本', loading: 'text-pages' as const }
  const remove = registry.register(definition)
  const { core, dispose } = setup()
  try {
    core.register({ name: 'qs.probe.official', key: definition.id }, () => null)
    const off = core.register({ name: 'qs.probe.document', key: definition.id }, () => null)
    expect(() => registry.register(definition)).toThrow('duplicate implementation')
    expect(core.entriesOfSlot('qs.probe.document')).toHaveLength(1)
    off()
    expect(core.entriesOfSlot('qs.probe.document')).toHaveLength(0)
    expect(core.entriesOfSlot('qs.probe.official')).toHaveLength(1)
    expect(registry.candidates('demo.txt')).toEqual([definition])
  } finally { dispose(); remove() }
})

it('官方扩展候选不会自动成为 QS 可用渲染器', () => {
  const registry = new DocumentPreviewRegistry()
  const offA = registry.register({ id: 'builtin', extensions: ['md'], priority: 'builtin', title: () => '内置', loading: 'text-pages' })
  const offB = registry.register({ id: 'external', extensions: ['md'], title: () => '扩展', loading: 'bytes-complete' })
  const { core, dispose } = setup()
  try {
    core.register({ name: 'qs.probe.document', key: 'builtin' }, () => null)
    const keys = new Set(core.entriesOfSlot('qs.probe.document').map(entry => entry.options.key))
    expect(registry.candidates('demo.md').map(x => x.id)).toEqual(['external', 'builtin'])
    expect(registry.candidates('demo.md').filter(x => keys.has(x.id)).map(x => x.id)).toEqual(['builtin'])
  } finally { dispose(); offB(); offA() }
})

it('贡献卸载和重新注册会发布稳定快照变更', async () => {
  const { core, dispose } = setup()
  let updates = 0
  const off = core.subscribe('qs.probe.document', () => { updates++ })
  try {
    const empty = core.entries('qs.probe.document')
    const remove = core.register({ name: 'qs.probe.document', key: 'text' }, () => null)
    const first = core.entries('qs.probe.document')
    expect(first).not.toBe(empty)
    expect(core.entries('qs.probe.document')).toBe(first)
    await Promise.resolve()
    const before = updates
    remove()
    await Promise.resolve()
    expect(updates).toBeGreaterThan(before)
    expect(core.entriesOfSlot('qs.probe.document')).toHaveLength(0)
    core.register({ name: 'qs.probe.document', key: 'text' }, () => null)
    expect(core.entriesOfSlot('qs.probe.document')).toHaveLength(1)
  } finally { off(); dispose() }
})

it('只读输入接管在默认输入之前，声明卸载级联清理', () => {
  const { core, dispose } = setup()
  try {
    core.register({ name: 'qs.probe.composer', priority: 0, select: () => ({ mode: 'normal' }) }, () => null)
    core.register({ name: 'qs.probe.composer', priority: -10, select: owner => owner.readonly ? { mode: 'readonly' } : null }, () => null)
    expect(core.entries('qs.probe.composer').map(e => e.options.priority)).toEqual([-10, 0])
  } finally { dispose() }
  expect(core.entries('qs.probe.composer')).toHaveLength(0)
})
