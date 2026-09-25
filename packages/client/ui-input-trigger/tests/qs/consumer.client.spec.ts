/** 用可控 Promise 验证呈现租约，不依赖请求耗时。 */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { createScope } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InputTriggerCandidate, InputTriggerSource, PickOutcome } from '../../src/types.ts'
import { InputTriggerController } from '../../src/client/controller.ts'

it('旧候选迟到不覆盖 QS 菜单，双租约拒绝且旧释放不影响新租约', async () => {
  const root = new Context()
  const scope = createScope(root, 'lease' as SessionId)
  await scope.fiber.await()
  const old = Promise.withResolvers<readonly InputTriggerCandidate[]>()
  const sources: InputTriggerSource[] = [
    { trigger: '@', name: 'reference', candidates: () => old.promise, onPick: () => undefined },
    { trigger: '/', name: 'command', candidates: async () => [{ name: 'help', value: 'help' }], onPick: () => undefined },
  ]
  const controller = new InputTriggerController({ actx: scope.ctx, sessionId: 'lease' as SessionId, roster: {
    all: () => sources, sources: trigger => sources.filter(source => source.trigger === trigger),
  } })
  try {
    controller.track('/h', 2, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().open).toBe(false)
    expect(controller.lexicon.getSnapshot().size).toBe(0)
    const off = controller.acquireConsumer({ triggers: ['/', '@'] })
    controller.track('@a', 2, { tier: 'plain' }, 1)
    expect(() => controller.acquireConsumer({ triggers: ['/'] })).toThrow('already mounted')
    off()
    const release = controller.acquireConsumer({ triggers: ['/'] })
    off()
    controller.track('/h', 2, { tier: 'plain' }, 1)
    old.resolve([{ name: 'old', value: 'old' }])
    await Promise.resolve()
    expect(controller.menu.getSnapshot().groups.map(group => group.source)).toEqual(['command'])
    controller.track('@a', 2, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().open).toBe(false)
    release()
    controller.track('/h', 2, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().open).toBe(false)
  } finally { controller.dispose(); await root.fiber.dispose() }
})

it('租约切换后迟到的 matchEnter 拒绝，不能作为新界面的答案提交', async () => {
  const root = new Context()
  const scope = createScope(root, 'adjudicate' as SessionId)
  await scope.fiber.await()
  const held = Promise.withResolvers<PickOutcome>()
  const source: InputTriggerSource = { trigger: '/', name: 'command', candidates: async () => [], onPick: () => undefined, matchEnter: () => held.promise }
  const controller = new InputTriggerController({ actx: scope.ctx, sessionId: 'adjudicate' as SessionId, roster: { all: () => [source], sources: () => [source] } })
  try {
    const release = controller.acquireConsumer({ triggers: ['/'] })
    const result = controller.adjudicate('/run', new AbortController().signal, { attachments: 0 })
    const assertion = expect(result).rejects.toThrow('consumer changed')
    release()
    held.resolve({ text: 'stale' })
    await assertion
  } finally { controller.dispose(); await root.fiber.dispose() }
})

it('来源在空格回调中切换租约时不向新输入发送文本，卸载后不再序列化引用', async () => {
  const root = new Context()
  const scope = createScope(root, 'space' as SessionId)
  await scope.fiber.await()
  let release = () => {}
  const writes: string[] = []
  scope.ctx.on('slash/input-insert-text', (request) => { writes.push(request.text); return true })
  const source: InputTriggerSource = {
    trigger: '/', name: 'command', candidates: async () => [], onPick: () => undefined,
    matchSpace: () => { release(); return { text: 'stale' } },
    codec: { clipboardText: ref => ref, serialize: async () => 'encoded' },
  }
  const controller = new InputTriggerController({ actx: scope.ctx, sessionId: 'space' as SessionId, roster: { all: () => [source], sources: () => [source] } })
  try {
    release = controller.acquireConsumer({ triggers: ['/'] })
    controller.track('/go', 3, { tier: 'plain' }, 1)
    expect(controller.onSpace()).toBe(false)
    expect(writes).toEqual([])
    controller.acquireConsumer({ triggers: ['/'] })
    controller.dispose()
    await expect(controller.serializeReference('command', 'ref', new AbortController().signal)).rejects.toThrow('no serializer')
  } finally { controller.dispose(); await root.fiber.dispose() }
})
