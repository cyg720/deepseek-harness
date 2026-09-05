// @vitest-environment jsdom
/**
 * 文件职责：验证 client/ui-chat 中 chat apply client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import {
  SlotTestRuntime, TestRemote, stubSettingsScope, usePinnedBrowserLanguages,
} from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  apply as applyConversation, inject as injectConversation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ConversationLocationDataSource, ConversationLocationDataStore, ConversationTurnDataMap,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  apply as applyChat, EMPTY_CHAT_SNAPSHOT, inject as injectChat,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ChatNodeTurnDataInjected, ChatSnapshot, TranscriptViewRowInjected, UseChatNodeTurnData,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { CHAT_SETTINGS_NAMESPACE, type ChatSettings } from '../src/chat-settings.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    metric: number
  }
}

usePinnedBrowserLanguages('zh-CN')

/**
 * 常量说明：SID 用于处理 SID 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SID = 'session-1' as SessionId

/**
 * 功能说明：处理 bench 相关流程；使用场景由所在模块及调用位置决定。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 bench()，并按返回类型处理结果。
 */
async function bench() {
  /**
   * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const runtime = await SlotTestRuntime.create()
  /**
   * 常量说明：chatSettings 用于处理 chatSettings 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const chatSettings = stubSettingsScope<ChatSettings>()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ namespace }（{ namespace: string
   * }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ namespace })，并按返回类型处理结果。
   */
  runtime.ctx.provide('settingsScope', {
    bind: ({ namespace }: { namespace: string }) => namespace === CHAT_SETTINGS_NAMESPACE
      ? chatSettings.scope
      : stubSettingsScope().scope,
  } as never)
  runtime.ctx.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() } as never)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  runtime.ctx.provide('uiWorkspace', {
    connectWorkspace: vi.fn(async () => SID),
  } as never)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  new TestRemote(runtime.ctx, {
    session: { openWorkspacePath: vi.fn(async () => ({ ok: true, value: { opened: true } })) },
  })
  /**
   * 常量说明：locale 用于处理 locale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_props（{ renderSlot?: unknown
   * }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_props)，并按返回类型处理结果。
   */
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
    'details': { kind: 'single', scope: 'session' },
    'conversation.approval.detail': { kind: 'single', scope: 'session' },
    'settings.general.item': { kind: 'list', scope: 'root' },
  }, (_props: { renderSlot?: unknown }) => null)
  /**
   * 常量说明：conversation 用于处理 conversation 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const conversation = await runtime.mount({
    inject: [...injectConversation],
    apply: applyConversation,
  })
  /**
   * 常量说明：provide 用于处理 provide 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const provide = vi.spyOn(runtime.ctx.uiSession, 'provide')
  /**
   * 常量说明：chat 用于处理 chat 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chat = await runtime.mount({ inject: [...injectChat], apply: applyChat })
  /**
   * 常量说明：sourceDescriptor 用于处理 sourceDescriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const sourceDescriptor = provide.mock.calls[0]?.[0]
  if (sourceDescriptor === undefined) throw new Error('ui-chat did not provide its standard source')
  return { runtime, conversation, chat, chatSettings, sourceDescriptor }
}

/**
 * 功能说明：处理 storeOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param runtime （SlotTestRuntime）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param key （'conversation.session' | 'conversation.session.header' |
 * 'c…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 storeOf(runtime, key)，并按返回类型处理结果。
 */
function storeOf(runtime: SlotTestRuntime, key: 'conversation.session' | 'conversation.session.header' | 'conversation.view' | 'details') {
  return (runtime.slots.entries(key)[0] as { store?: unknown } | undefined)?.store
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Chat apply wiring', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('contributes Chat View, node renderers, stats, and details', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = await bench()
    /**
     * 常量说明：views 用于处理 views 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const views = b.runtime.slots.entries('conversation.view')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：row（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(row)，并按返回类型处理结果。
     */
    expect(views.map(row => row.options.id)).toEqual(['chat'])
    expect(resolveSlotLabel(views[0]?.options.label)).toBe('对话')
    expect(b.runtime.slots.spec('conversation.chat.node'))
      .toMatchObject({ kind: 'keyed', scope: 'session' })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：row（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(row)，并按返回类型处理结果。
     */
    expect(b.runtime.slots.entries('conversation.composer.dock').map(row => row.options.id))
      .toEqual(['stats'])
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：row（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(row)，并按返回类型处理结果。
     */
    expect(b.runtime.slots.entries('settings.general.item').map(row => row.options.id))
      .toEqual(['transcript-view', 'composer-enter'])
    expect(b.runtime.slots.entries('details')).toHaveLength(1)
    await b.runtime.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('mirrors the Host transcript preference into its Settings row', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = await bench()
    /**
     * 常量说明：row 用于处理 row 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
     */
    const row = b.runtime.slots.entries('settings.general.item')
      .find(entry => entry.options.id === 'transcript-view')!
    /**
     * 常量说明：face 用于处理 face 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const face = (row.inject as unknown as () => TranscriptViewRowInjected)()

    expect(face.hooks.transcriptView.getSnapshot()).toBe('compact')
    face.setTranscriptView('normal')
    expect(face.hooks.transcriptView.getSnapshot()).toBe('normal')
    expect(b.chatSettings.set).toHaveBeenCalledWith('transcriptView', 'normal')

    b.chatSettings.publish({
      status: 'ready', value: { transcriptView: 'compact' }, revision: 1, writable: true,
    })
    expect(face.hooks.transcriptView.getSnapshot()).toBe('compact')
    await b.runtime.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('shares one Chat store while keeping it distinct from Conversation state', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = await bench()
    /**
     * 常量说明：conversationStore 用于处理 conversationStore 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const conversationStore = storeOf(b.runtime, 'conversation.session')
    /**
     * 常量说明：chatStore 用于处理 chatStore 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const chatStore = storeOf(b.runtime, 'conversation.view')
    expect(storeOf(b.runtime, 'conversation.session.header')).toBe(conversationStore)
    expect(storeOf(b.runtime, 'details')).toBe(chatStore)
    expect(chatStore).toBeDefined()
    expect(chatStore).not.toBe(conversationStore)
    await b.runtime.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('removes only Chat contributions when Chat unloads', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = await bench()
    await b.chat.dispose()
    expect(b.runtime.slots.entries('conversation.view')).toHaveLength(0)
    expect(b.runtime.slots.spec('conversation.chat.node')).toBeUndefined()
    expect(b.runtime.slots.entries('conversation')).toHaveLength(1)
    expect(b.runtime.ctx.get('uiConversation')).toBeDefined()
    await b.runtime.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps the Chat standard source total while its target enters and leaves', async () => {
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = await bench()
    await b.runtime.sessions.add({ id: SID }, { current: false })
    /**
     * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const binding = b.runtime.sessions.binding(SID)
    if (binding === undefined) throw new Error('Chat source test Session binding is unavailable')
    /**
     * 常量说明：resolveSource 用于解析 Source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：解析 Source 相关流程；使用场景由所在模块及调用位置决定。
     * @param owner （SessionBinding）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns ObservableSnapshot<ChatSnapshot>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 resolveSource(owner)，并按返回类型处理结果。
     */
    const resolveSource = (owner: SessionBinding): ObservableSnapshot<ChatSnapshot> => {
      /**
       * 常量说明：contribution 用于处理 contribution 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const contribution = b.sourceDescriptor.resolve(owner) as {
        hooks: { chat: ObservableSnapshot<ChatSnapshot> }
      }
      return contribution.hooks.chat
    }
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = b.runtime.ctx.uiSession.adapter.resolve(SID)!.hooks.chat as
      ObservableSnapshot<ChatSnapshot>
    expect(resolveSource(binding)).toBe(source)
    expect(resolveSource(binding)).toBe(source)
    /**
     * 常量说明：listener 用于处理 listener 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const listener = vi.fn()
    /**
     * 常量说明：off 用于处理 off 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const off = source.subscribe(listener)

    expect(source.getSnapshot()).toBeDefined()
    await b.chat.dispose()
    expect(source.getSnapshot()).toBe(EMPTY_CHAT_SNAPSHOT)

    off()
    await b.runtime.dispose()
  })

  it('binds Turn data directly to its keyed Location source', async () => {
    const b = await bench()
    /**
     * 常量说明：spec 用于处理 spec 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const spec = b.runtime.slots.spec('conversation.chat.node') as unknown as {
      inject: ChatNodeTurnDataInjected
    }
    let value: number | undefined = 42
    const listeners = new Set<() => void>()
    const source: ConversationLocationDataSource<number | undefined> = {
      getSnapshot: () => value,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const data = {
      get: () => value,
      source: () => source,
    } as unknown as ConversationLocationDataStore<ConversationTurnDataMap>
    const useChat = vi.fn(() => { throw new Error('Turn data must not read the Chat snapshot') })
    const useTurnData = spec.inject.hooks.turnData(
      { useChat } as unknown as Parameters<typeof spec.inject.hooks.turnData>[0],
      data,
    )
    const Probe = ({ useData }: { useData: UseChatNodeTurnData }) => (
      <output>{useData('metric') ?? 'missing'}</output>
    )
    const view = render(<Probe useData={useTurnData} />)

    expect(view.getByText('42')).toBeTruthy()
    expect(useChat).not.toHaveBeenCalled()

    act(() => {
      value = 43
      for (const listener of [...listeners]) listener()
    })
    expect(view.getByText('43')).toBeTruthy()

    view.rerender(<Probe useData={spec.inject.hooks.turnData(
      { useChat } as unknown as Parameters<typeof spec.inject.hooks.turnData>[0],
      undefined,
    )} />)
    expect(view.getByText('missing')).toBeTruthy()
    expect(useChat).not.toHaveBeenCalled()

    view.unmount()
    await b.runtime.dispose()
  })
})
