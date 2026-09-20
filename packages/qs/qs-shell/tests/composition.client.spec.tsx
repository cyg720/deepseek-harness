// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyShell, inject as injectShell } from '@deepseek-ai/dsh-qs-shell/client'
import { apply as applyLogin, inject as injectLogin } from '@deepseek-ai/dsh-qs-login/client'
import { apply as applySessions, inject as injectSessions } from '@deepseek-ai/dsh-qs-sessions/client'
import { apply as applyComposer, inject as injectComposer } from '@deepseek-ai/dsh-qs-composer/client'
import { apply as applyTranscript, inject as injectTranscript } from '@deepseek-ai/dsh-qs-transcript/client'
import { apply as applyApproval, inject as injectApproval } from '@deepseek-ai/dsh-qs-approval/client'
import { apply as applyQuestions, inject as injectQuestions } from '@deepseek-ai/dsh-qs-questions/client'
import { QS_APPROVAL_PRIORITY } from '@deepseek-ai/dsh-qs-approval/client'
import { QS_QUESTIONS_PRIORITY } from '@deepseek-ai/dsh-qs-questions/client'

usePinnedBrowserLanguages('zh-CN')

let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

/** 一处声明、一处渲染的槽在这一组合里只能有一个贡献者。 */
const SINGLE_OCCUPANT_SLOTS = [
  'root', 'qs.gate', 'qs.chrome', 'qs.nav', 'qs.stage',
  'qs.stage.body', 'qs.stage.transcript', 'qs.composer', 'qs.inspector',
] as const

/**
 * 装载完整的七包组合。
 *
 * 这是评审里风险最高的一条：七个包同时注册时，`single` 槽一旦出现第二个同优先级
 * 贡献者就会**抛错**，而"不同优先级只渲染优胜者"会让某一块静默消失。用真实
 * SlotRegistry 装配一次，才能证明槽树成立，而不是只证明各包单独能编译。
 */
async function bench(): Promise<SlotTestRuntime> {
  const created = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(created.ctx)
  created.ctx.provide('locale', locale)
  created.slots.installLocale(locale)
  created.ctx.provide('theme', {
    getTheme: () => ({ preference: 'light', fontSize: 14, active: { id: 'light', colorScheme: 'light', tokens: {} }, themes: [], revision: 0 }),
  } as never)
  // 只要求服务在位：条目自己的 inject 工厂在渲染时才被调用。
  created.ctx.provide('conversation', { blocks: { set: () => {}, storeFor: () => undefined, forget: () => {} } } as never)
  created.ctx.provide('uiConversation', { binding: () => ({ target: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) }) } as never)

  created.ctx.provide('remote', {} as never)
  created.ctx.provide('connection', { reconnect: () => {}, state: { getSnapshot: () => 'connected', subscribe: () => () => {} } } as never)
  created.ctx.provide('remote.session', {} as never)
  const plugins = [
    { inject: [...injectShell], apply: applyShell },
    { inject: [...injectLogin], apply: applyLogin },
    { inject: [...injectSessions], apply: applySessions },
    { inject: [...injectComposer], apply: applyComposer },
    { inject: [...injectTranscript], apply: applyTranscript },
    { inject: [...injectApproval], apply: applyApproval },
    { inject: [...injectQuestions], apply: applyQuestions },
  ]
  for (const plugin of plugins) await created.mount(plugin)
  return created
}

describe('七包组合接线', () => {
  it('九个 single 槽各有且只有一个贡献者，无同优先级冲突', async () => {
    runtime = await bench()
    for (const key of SINGLE_OCCUPANT_SLOTS) {
      expect(runtime.slots.entries(key), `${key} 只应有一个贡献者`).toHaveLength(1)
    }
  })

  it('状态条与 overlay 宿主各有贡献者（list 槽可并列）', async () => {
    runtime = await bench()
    expect(runtime.slots.entries('qs.status').length).toBeGreaterThanOrEqual(1)
    expect(runtime.slots.entries('qs.overlay').length).toBeGreaterThanOrEqual(1)
  })

  it('交互卡片位是 chain，审批在前、提问在后', async () => {
    runtime = await bench()
    const spec = runtime.slots.spec('qs.stage.interaction')
    expect(spec?.kind).toBe('chain')
    expect(spec?.scope).toBe('session')
    const priorities = runtime.slots.entries('qs.stage.interaction')
      .map(entry => entry.options.priority)
      .sort((left, right) => (left ?? 0) - (right ?? 0))
    expect(priorities).toEqual([QS_APPROVAL_PRIORITY, QS_QUESTIONS_PRIORITY])
    expect(QS_APPROVAL_PRIORITY).toBeLessThan(QS_QUESTIONS_PRIORITY)
  })

  it('转写声明了自己的行槽与交互槽', async () => {
    runtime = await bench()
    expect(runtime.slots.spec('qs.stage.transcript.row')?.kind).toBe('keyed')
    expect(runtime.slots.entries('qs.stage.transcript.row').length).toBeGreaterThanOrEqual(5)
  })

  it('只装 shell + 转写时，卡片位已声明但贡献等待（不抛错、不静默消失）', async () => {
    const created = await SlotTestRuntime.create()
    created.ctx.provide('connection', { reconnect: () => {}, state: { getSnapshot: () => 'connected', subscribe: () => () => {} } } as never)
    const locale = new LocaleRuntime(created.ctx)
    created.ctx.provide('locale', locale)
    created.slots.installLocale(locale)
    created.ctx.provide('theme', {
      getTheme: () => ({ preference: 'light', fontSize: 14, active: { id: 'light', colorScheme: 'light', tokens: {} }, themes: [], revision: 0 }),
    } as never)
    created.ctx.provide('uiConversation', { binding: () => ({ target: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) }) } as never)
    await created.mount({ inject: [...injectShell], apply: applyShell })
    await created.mount({ inject: [...injectTranscript], apply: applyTranscript })
    expect(created.slots.spec('qs.stage.interaction')?.kind).toBe('chain')
    expect(created.slots.entries('qs.stage.interaction')).toHaveLength(0)
    expect(created.slots.entries('qs.stage.transcript')).toHaveLength(1)
    await created.dispose()
  })
})
