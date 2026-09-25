// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
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

import * as brand from '@deepseek-ai/dsh-qs-ui-brand/client'
import * as sidebar from '@deepseek-ai/dsh-qs-ui-sidebar/client'
import * as rightSidebar from '@deepseek-ai/dsh-qs-ui-sidebar-right/client'

usePinnedBrowserLanguages('zh-CN')

let runtime: SlotTestRuntime | undefined
let disposeConversation: (() => Promise<void>) | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

/** 一处声明、一处渲染的槽在这一组合里只能有一个贡献者。 */
const SINGLE_OCCUPANT_SLOTS = [
  'qs.brand.mark', 'qs.brand.name', 'root', 'qs.gate', 'qs.chrome', 'qs.sidebar', 'qs.nav', 'qs.stage',
  'qs.stage.body', 'qs.stage.transcript', 'qs.composer', 'qs.inspector',
] as const

/** 组合用例提供真实阅读存储与偏好源，动作不应在仅注册槽时执行。 */
function installPresentation(created: SlotTestRuntime): void {
  const unused = (): never => { throw new Error('registration must not invoke presentation actions') }
  created.ctx.provide('conversationPresentation', {
    store: createConversationStore(),
    views: createSnapshotStore([]),
    activate: unused,
    submission: {
      busyEnter: createSnapshotStore<'queue' | 'steer'>('queue'),
      setBusyEnter: unused, resolve: unused, steerQueue: unused,
    },
  })
  created.ctx.provide('chatPresentation', {
    useSearchableHidden: unused,
    transcriptView: createSnapshotStore<'normal' | 'compact'>('compact'), setTranscriptView: unused,
  })
}

/**
 * 装载完整的十包组合。
 *
 * 这是评审里风险最高的一条：十个包同时注册时，`single` 槽一旦出现第二个同优先级
 * 贡献者就会**抛错**，而"不同优先级只渲染优胜者"会让某一块静默消失。用真实
 * SlotRegistry 装配一次，才能证明槽树成立，而不是只证明各包单独能编译。
 */
async function bench(): Promise<SlotTestRuntime> {
  const created = await SlotTestRuntime.create()
  runtime = created
  installPresentation(created)
  const locale = new LocaleRuntime(created.ctx)
  created.ctx.provide('locale', locale)
  created.slots.installLocale(locale)
  created.ctx.provide('theme', {
    getTheme: () => ({ preference: 'light', fontSize: 14, active: { id: 'light', colorScheme: 'light', tokens: {} }, themes: [], revision: 0 }),
  } as never)
  // 只要求服务在位：条目自己的 inject 工厂在渲染时才被调用。
  created.ctx.provide('conversation', { blocks: { set: () => {}, storeFor: () => undefined, forget: () => {} } } as never)
  created.ctx.provide('uiConversation', { binding: () => ({ target: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) }) } as never)
  // 文件引用依赖官方资源路由；此组合夹具只验证注册，不执行导航。
  created.ctx.provide('sidebarRight', { openResource: () => {} } as never)

  created.ctx.provide('remote', {} as never)
  created.ctx.provide('connection', { reconnect: () => {}, state: { getSnapshot: () => 'connected', subscribe: () => () => {} } } as never)
  created.ctx.provide('remote.session', {} as never)
  // 此用例只检查槽声明；共享右栏状态与生命周期另用真实官方插件验证。
  // 此组合测试只检查槽注册，不创建布局；真实提交订阅由右栏集成测试覆盖。
  created.ctx.provide('sidebarRightPresentation', { store: undefined, tab: { hooks: {} }, observeLayouts: () => () => {} } as never)
  created.ctx.provide('sidebarRightTabs', {} as never)
  // 工作区呈现复用唯一官方导航服务；这里只检查注册，不执行目录操作。
  created.ctx.provide('uiWorkspace', { openWorkspace: async () => {} })
  const plugins = [
    brand, sidebar, rightSidebar,
    { inject: [...injectShell], apply: applyShell },
    { inject: [...injectLogin], apply: applyLogin },
    { inject: [...injectSessions], apply: applySessions },
    { inject: [...injectComposer], apply: applyComposer },
    { inject: [...injectTranscript], apply: applyTranscript },
    { inject: [...injectApproval], apply: applyApproval },
    { inject: [...injectQuestions], apply: applyQuestions },
  ]
  for (const plugin of plugins) {
    const handle = await created.mount(plugin)
    if (plugin.apply === applyComposer) disposeConversation = () => handle.dispose()
  }
  return created
}

describe('十包组合接线', () => {
  it('十二个 single 槽各有且只有一个贡献者，无同优先级冲突', async () => {
    runtime = await bench()
    for (const key of SINGLE_OCCUPANT_SLOTS) {
      expect(runtime.slots.entries(key), `${key} 只应有一个贡献者`).toHaveLength(1)
    }
  })

  it('withdraws and restores dependent transcript and interaction entries with conversation', async () => {
    runtime = await bench()
    expect(runtime.slots.entries('qs.workspace.hero')).toHaveLength(1)
    expect(disposeConversation).toBeDefined()
    await disposeConversation!()
    expect(runtime.slots.spec('qs.workspace.hero')).toBeUndefined()
    expect(runtime.slots.entries('qs.workspace.hero')).toHaveLength(0)
    expect(runtime.slots.spec('qs.stage.transcript')).toBeUndefined()
    expect(runtime.slots.spec('qs.stage.interaction')).toBeUndefined()
    expect(runtime.slots.spec('qs.composer.takeover')).toBeUndefined()
    await runtime.mount({ inject: [...injectComposer], apply: applyComposer })
    expect(runtime.slots.entries('qs.stage.transcript')).toHaveLength(1)
    expect(runtime.slots.entries('qs.stage.interaction')).toHaveLength(2)
    expect(runtime.slots.entries('qs.stage')).toHaveLength(1)
    expect(runtime.slots.entries('qs.workspace.hero')).toHaveLength(1)
    expect(runtime.slots.spec('qs.composer.takeover')).toMatchObject({ kind: 'chain', scope: 'session' })
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

  it('without conversation the transcript waits for its parent declaration（不抛错、不静默消失）', async () => {
    const created = await SlotTestRuntime.create()
    runtime = created
    installPresentation(created)
    created.ctx.provide('connection', { reconnect: () => {}, state: { getSnapshot: () => 'connected', subscribe: () => () => {} } } as never)
    const locale = new LocaleRuntime(created.ctx)
    created.ctx.provide('locale', locale)
    created.slots.installLocale(locale)
    created.ctx.provide('theme', {
      getTheme: () => ({ preference: 'light', fontSize: 14, active: { id: 'light', colorScheme: 'light', tokens: {} }, themes: [], revision: 0 }),
    } as never)
    created.ctx.provide('uiConversation', { binding: () => ({ target: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) }) } as never)
    // 文件引用依赖官方资源路由；此组合夹具只验证注册，不执行导航。
    created.ctx.provide('sidebarRight', { openResource: () => {} } as never)
    await created.mount({ inject: [...injectShell], apply: applyShell })
    await created.mount({ inject: [...injectTranscript], apply: applyTranscript })
    expect(created.slots.spec('qs.stage.interaction')).toBeUndefined()
    expect(created.slots.entries('qs.stage.interaction')).toHaveLength(0)
    expect(created.slots.entries('qs.stage.transcript')).toHaveLength(0)
    await created.dispose()
  })
})
