/**
 * The staged card form: what a draft shows before it is written, which wire
 * call a save reaches, and what happens to drafts the Host did not accept.
 */
/*
 * 文件职责：验证插件配置的 stores.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、表单事件和 API 替身。
 * 产品维度：防止插件配置保存、发现和错误提示回归。
 * 逻辑维度：构造配置状态，触发操作并断言请求与界面。
 * 关键边界：敏感值不得意外回显；异步发现和保存必须清理。
 * 新手阅读建议：先读状态夹具，再按加载、编辑、保存场景阅读。
 */

import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { CardForm, numberField, textField } from '../src/client/card-form.ts'
import { AgentLoopCardController, type AgentLoopSettings } from '../src/client/agent-loop-card-controller.ts'
import { BashCardController, type BashSettings } from '../src/client/bash-card-controller.ts'
import {
  SettingsDescribeMirror, type SettingsMirrorSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ConfigurablePluginsTabController } from '../src/client/tab-store.ts'
import { WebSearchCardController, type WebSearchSettings } from '../src/client/web-search-card-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
/* 中文说明：函数 acceptWrites 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function acceptWrites<T>(host: StubSettingsScope<T>): void {
  /** 中文说明：测试局部值 section，由紧邻初始化决定。 */
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  /** 中文说明：测试局部值 layer，由紧邻初始化决定。 */
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.set.mockImplementation((field: string, value: unknown) => {
    host.publish({ value: { ...section(), [field]: value } as T, user: { ...layer(), [field]: value } })
  })
  host.unset.mockImplementation((field: string) => {
    /** 中文说明：测试局部值 user，由紧邻初始化决定。 */
    const user = Object.fromEntries(Object.entries(layer()).filter(([key]) => key !== field))
    /** 中文说明：测试局部值 base，由紧邻初始化决定。 */
    const base = host.scope.getSnapshot().base as Record<string, unknown> | undefined
    host.publish({ value: { ...section(), [field]: base?.[field] } as T, user })
  })
}

/** 中文说明：函数 credentialsApi 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function credentialsApi(configured: boolean) {
  /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'c-1' as never,
    result: { ok: true as const, value: { credentials: { DEEPSEEK_API_KEY: { configured, writable: true } } } },
  }))
  /** 中文说明：测试局部值 set，由紧邻初始化决定。 */
  const set = vi.fn(() => Promise.resolve({ rpcId: 'c-2' as never, result: { ok: true as const, value: {} } }))
  return { api: { credentials: { describe, set } } as never, describe, set }
}

describe('CardForm', () => {
  /** 中文说明：函数 form 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
  function form() {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<Record<string, unknown>>()
    /** 中文说明：测试局部值 subject，由紧邻初始化决定。 */
    const subject = new CardForm(host.scope, [numberField('timeoutMs'), textField('baseURL')])
    host.publish({
      status: 'ready',
      writable: true,
      value: { timeoutMs: 60_000, baseURL: 'https://search.test/v1' },
      base: { timeoutMs: 60_000, baseURL: 'https://search.test/v1' },
      user: {},
    })
    return { host, subject }
  }

  it('shows the effective value and stays clean until something is staged', () => {
    /** 中文说明：测试局部值 { subject }，由紧邻初始化决定。 */
    const { subject } = form()

    expect(subject.field('timeoutMs')).toEqual({ text: '60000', overridden: false, invalid: false })
    expect(subject.shell()).toMatchObject({ available: true, writable: true, dirty: false, invalid: false })
  })

  it('marks a field the user layer carries as overridden', () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()

    host.publish({ value: { timeoutMs: 60_000 }, user: { timeoutMs: 60_000 } })

    // An override equal to the composition default is still an override.
    expect(subject.field('timeoutMs').overridden).toBe(true)
  })

  it('writes nothing until the form is saved', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('timeoutMs', '9000')

    expect(subject.field('timeoutMs')).toEqual({ text: '9000', overridden: true, invalid: false })
    expect(subject.shell().dirty).toBe(true)
    expect(host.set).not.toHaveBeenCalled()

    await subject.save()

    expect(host.set.mock.calls).toEqual([['timeoutMs', 9_000]])
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false, saving: false })
  })

  it('drops a draft that settles back on the value already shown', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    subject.actions().edit('timeoutMs', '60000')

    expect(subject.shell().dirty).toBe(false)
    await subject.save()

    expect(host.set).not.toHaveBeenCalled()
  })

  it('refuses to save while a draft is not a value the field accepts', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', 'soon')

    expect(subject.field('timeoutMs')).toEqual({ text: 'soon', overridden: false, invalid: true })
    expect(subject.shell()).toMatchObject({ dirty: true, invalid: true })

    await subject.save()

    expect(host.set).not.toHaveBeenCalled()
    expect(subject.field('timeoutMs').text).toBe('soon')
  })

  it('stages a reset that clears the field only once saved', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ value: { timeoutMs: 9_000 }, user: { timeoutMs: 9_000 } })

    subject.actions().resetField('timeoutMs')

    // The badge previews the save: the field will no longer be overridden.
    expect(subject.field('timeoutMs')).toEqual({ text: '60000', overridden: false, invalid: false })
    expect(host.unset).not.toHaveBeenCalled()

    await subject.save()

    expect(host.unset.mock.calls).toEqual([['timeoutMs']])
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false })
  })

  it('treats resetting an inherited field as no change at all', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()

    subject.actions().resetField('timeoutMs')

    expect(subject.shell().dirty).toBe(false)
    await subject.save()

    expect(host.unset).not.toHaveBeenCalled()
  })

  it('clears a number field by emptying it', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ user: { timeoutMs: 9_000 } })

    subject.actions().edit('timeoutMs', '')

    expect(subject.field('timeoutMs')).toEqual({ text: '', overridden: false, invalid: false })
    await subject.save()

    expect(host.unset.mock.calls).toEqual([['timeoutMs']])
  })

  it('clears a text field by emptying it', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ user: { baseURL: 'https://search.test/v1' } })

    subject.actions().edit('baseURL', '   ')
    await subject.save()

    expect(host.unset.mock.calls).toEqual([['baseURL']])
  })

  it('writes the trimmed text of a text field', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('baseURL', '  https://other.test  ')
    await subject.save()

    expect(host.set.mock.calls).toEqual([['baseURL', 'https://other.test']])
  })

  it('keeps the drafts a save did not land, and reports the failure', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    await subject.save()

    // The stub Host accepted the call without storing it, exactly as a
    // validator that refuses the value does.
    expect(host.set).toHaveBeenCalledWith('timeoutMs', 9_000)
    expect(subject.shell()).toMatchObject({ dirty: true, failed: true, saving: false })
    expect(subject.field('timeoutMs').text).toBe('9000')
  })

  it('reports a reset the Host did not apply as a failure', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()
    host.publish({ user: { timeoutMs: 9_000 } })

    subject.actions().resetField('timeoutMs')
    await subject.save()

    expect(host.unset).toHaveBeenCalledWith('timeoutMs')
    expect(subject.shell().failed).toBe(true)
  })

  it('clears the failure as soon as the user edits again', async () => {
    /** 中文说明：测试局部值 { subject }，由紧邻初始化决定。 */
    const { subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    await subject.save()
    expect(subject.shell().failed).toBe(true)

    subject.actions().edit('timeoutMs', '9001')

    expect(subject.shell().failed).toBe(false)
  })

  it('discards every staged edit', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    subject.actions().discard()

    expect(subject.field('timeoutMs').text).toBe('60000')
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false })

    // A discard with nothing staged publishes nothing.
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = subject.shell()
    subject.actions().discard()
    expect(subject.shell()).toEqual(before)

    await subject.save()
    expect(host.set).not.toHaveBeenCalled()
  })

  it('refuses a second save while one is in flight', async () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('timeoutMs', '9000')
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = subject.save()
    expect(subject.shell().saving).toBe(true)
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = subject.save()
    await Promise.all([first, second])

    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('publishes a projection whenever the scope or a draft changes', () => {
    /** 中文说明：测试局部值 { host, subject }，由紧邻初始化决定。 */
    const { host, subject } = form()
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = subject.bind(() => subject.field('timeoutMs').text)
    expect(store.getSnapshot()).toBe('60000')

    host.publish({ value: { timeoutMs: 1_000 } })
    expect(store.getSnapshot()).toBe('1000')

    subject.actions().edit('timeoutMs', '2000')
    expect(store.getSnapshot()).toBe('2000')
  })

  it('refuses to address a field the card never declared', () => {
    /** 中文说明：测试局部值 { subject }，由紧邻初始化决定。 */
    const { subject } = form()

    expect(() => subject.field('nope')).toThrow('plugin card has no field nope')
  })

  it('renders an absent section value as an empty draft', () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<Record<string, unknown>>()
    /** 中文说明：测试局部值 subject，由紧邻初始化决定。 */
    const subject = new CardForm(host.scope, [numberField('timeoutMs'), textField('baseURL')])

    host.publish({ status: 'ready', writable: true, value: {}, base: {}, user: undefined })

    expect(subject.field('timeoutMs').text).toBe('')
    expect(subject.field('baseURL').text).toBe('')
    expect(subject.shell().available).toBe(true)
  })

  it('stays unavailable while the namespace is not served', () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<Record<string, unknown>>()
    /** 中文说明：测试局部值 subject，由紧邻初始化决定。 */
    const subject = new CardForm(host.scope, [numberField('timeoutMs')])

    host.publish({ status: 'unavailable' })

    expect(subject.shell()).toMatchObject({ available: false, writable: false })
  })
})

describe('BashCardController', () => {
  it('projects both fields and saves them in one write pass', async () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<BashSettings>()
    acceptWrites(host)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new BashCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { timeoutMs: 5_000, maxOutputBytes: 64_000 },
      base: { timeoutMs: 60_000, maxOutputBytes: 64_000 },
      user: { timeoutMs: 5_000 },
    })
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = controller.inject()

    expect(face.hooks.bashCard.getSnapshot()).toMatchObject({
      available: true,
      writable: true,
      dirty: false,
      timeoutMs: { text: '5000', overridden: true },
      maxOutputBytes: { text: '64000', overridden: false },
    })

    face.edit('timeoutMs', '9000')
    face.edit('maxOutputBytes', '1024')
    expect(face.hooks.bashCard.getSnapshot().dirty).toBe(true)

    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledTimes(2) })

    expect(host.set.mock.calls).toEqual([['timeoutMs', 9_000], ['maxOutputBytes', 1_024]])
    expect(face.hooks.bashCard.getSnapshot().dirty).toBe(false)
  })

  it('stages a reset and applies it on save', async () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<BashSettings>()
    acceptWrites(host)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new BashCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { timeoutMs: 5_000 },
      base: { timeoutMs: 60_000 },
      user: { timeoutMs: 5_000 },
    })
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = controller.inject()

    face.resetField('timeoutMs')
    expect(face.hooks.bashCard.getSnapshot().timeoutMs.text).toBe('60000')

    face.save()
    await vi.waitFor(() => { expect(host.unset).toHaveBeenCalledWith('timeoutMs') })

    expect(face.hooks.bashCard.getSnapshot()).toMatchObject({
      dirty: false,
      timeoutMs: { text: '60000', overridden: false },
    })
  })

  it('discards staged edits without writing', () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<BashSettings>()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new BashCardController(host.scope)
    host.publish({ status: 'ready', writable: true, value: { timeoutMs: 5_000 }, user: {} })
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = controller.inject()

    face.edit('timeoutMs', '9000')
    face.discard()

    expect(face.hooks.bashCard.getSnapshot().timeoutMs.text).toBe('5000')
    expect(host.set).not.toHaveBeenCalled()
  })
})

describe('AgentLoopCardController', () => {
  it('saves the only field it owns', async () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<AgentLoopSettings>()
    acceptWrites(host)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AgentLoopCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { maxParallelToolCalls: 10 },
      base: { maxParallelToolCalls: 10 },
      user: {},
    })
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = controller.inject()

    face.edit('maxParallelToolCalls', '4')
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('maxParallelToolCalls', 4) })

    expect(face.hooks.agentLoopCard.getSnapshot()).toMatchObject({
      dirty: false,
      maxParallelToolCalls: { text: '4', overridden: true },
    })
  })

  it('reports a read-only document so the card can disable its controls', () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<AgentLoopSettings>()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AgentLoopCardController(host.scope)

    host.publish({ status: 'ready', writable: false, value: { maxParallelToolCalls: 10 } })

    expect(controller.inject().hooks.agentLoopCard.getSnapshot().writable).toBe(false)
  })
})

describe('WebSearchCardController', () => {
  it('reads the credential state for the reference the tab names', async () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<WebSearchSettings>()
    /** 中文说明：测试局部值 credentials，由紧邻初始化决定。 */
    const credentials = credentialsApi(true)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new WebSearchCardController(host.scope, credentials.api)
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = () => controller.inject().hooks.webSearchCard.getSnapshot()
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalled() })

    host.publish({ status: 'ready', writable: true, value: { baseURL: 'https://search.test/v1' }, user: {} })
    await vi.waitFor(() => { expect(state().apiKeyConfigured).toBe(true) })

    expect(state()).toMatchObject({
      baseURL: { text: 'https://search.test/v1', overridden: false },
      apiKey: { text: '', overridden: false },
    })
  })

  it('writes the staged key through the credentials domain, never the settings section', async () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<WebSearchSettings>()
    /** 中文说明：测试局部值 credentials，由紧邻初始化决定。 */
    const credentials = credentialsApi(false)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = controller.inject()

    face.edit('apiKey', ' ds-secret ')
    expect(face.hooks.webSearchCard.getSnapshot().dirty).toBe(true)
    expect(credentials.set).not.toHaveBeenCalled()

    credentials.describe.mockImplementation(() => Promise.resolve({
      rpcId: 'c-1' as never,
      result: { ok: true as const, value: { credentials: { DEEPSEEK_API_KEY: { configured: true, writable: true } } } },
    }))
    face.save()
    await vi.waitFor(() => { expect(credentials.set).toHaveBeenCalled() })

    expect(credentials.set).toHaveBeenCalledWith({ ref: 'DEEPSEEK_API_KEY', value: 'ds-secret' })
    expect(host.set).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(face.hooks.webSearchCard.getSnapshot()).toMatchObject({ dirty: false, apiKeyConfigured: true })
    })
  })

  it('keeps the stored key when the draft is left blank', () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<WebSearchSettings>()
    /** 中文说明：测试局部值 credentials，由紧邻初始化决定。 */
    const credentials = credentialsApi(true)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = controller.inject()

    face.edit('apiKey', '   ')

    expect(face.hooks.webSearchCard.getSnapshot().dirty).toBe(false)
    face.save()

    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('re-reads when the Host reports the watched reference changed', async () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<WebSearchSettings>()
    /** 中文说明：测试局部值 credentials，由紧邻初始化决定。 */
    const credentials = credentialsApi(false)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalled() })
    credentials.describe.mockClear()

    // Another reference is not this card's business.
    controller.refreshCredential('OTHER_KEY')
    expect(credentials.describe).not.toHaveBeenCalled()

    // A key written on another surface reaches this card only through this signal.
    credentials.describe.mockImplementation(() => Promise.resolve({
      rpcId: 'c-1' as never,
      result: { ok: true as const, value: { credentials: { DEEPSEEK_API_KEY: { configured: true, writable: true } } } },
    }))
    controller.refreshCredential('DEEPSEEK_API_KEY')

    await vi.waitFor(() => {
      expect(controller.inject().hooks.webSearchCard.getSnapshot().apiKeyConfigured).toBe(true)
    })
  })

  it('addresses the reference the tab declares rather than the default', async () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<WebSearchSettings>()
    /** 中文说明：测试局部值 credentials，由紧邻初始化决定。 */
    const credentials = credentialsApi(false)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: { apiKeyEnv: 'SEARCH_KEY' }, user: {} })
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = controller.inject()

    face.edit('apiKey', 'ds-secret')
    face.save()
    await vi.waitFor(() => { expect(credentials.set).toHaveBeenCalled() })

    expect(credentials.set).toHaveBeenCalledWith({ ref: 'SEARCH_KEY', value: 'ds-secret' })
  })

  it('reports a key the Host did not store as a failed save', async () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<WebSearchSettings>()
    /** 中文说明：测试局部值 credentials，由紧邻初始化决定。 */
    const credentials = credentialsApi(false)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = controller.inject()

    face.edit('apiKey', 'ds-secret')
    face.save()

    await vi.waitFor(() => {
      expect(face.hooks.webSearchCard.getSnapshot()).toMatchObject({ failed: true, dirty: true })
    })
  })

  it('keeps the card usable when the credential read fails', async () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<WebSearchSettings>()
    /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
    const describe = vi.fn(() => Promise.reject(new Error('offline')))
    /** 中文说明：测试局部值 set，由紧邻初始化决定。 */
    const set = vi.fn(() => Promise.reject(new Error('offline')))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new WebSearchCardController(host.scope, { credentials: { describe, set } } as never)
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = controller.inject()
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })

    host.publish({ status: 'ready', writable: true, value: { baseURL: 'https://search.test/v1' }, user: {} })
    face.edit('apiKey', 'ds-secret')
    face.save()
    await vi.waitFor(() => { expect(set).toHaveBeenCalled() })

    expect(face.hooks.webSearchCard.getSnapshot()).toMatchObject({
      available: true,
      apiKeyConfigured: false,
      baseURL: { text: 'https://search.test/v1' },
    })
  })

  it('ignores a credential read the Host refused', async () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<WebSearchSettings>()
    /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
    const describe = vi.fn(() => Promise.resolve({
      rpcId: 'c-1' as never,
      result: { ok: false as const, error: { code: 'credentials-unavailable', message: 'no provider' } },
    }))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new WebSearchCardController(host.scope, { credentials: { describe, set: vi.fn() } } as never)
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })

    expect(controller.inject().hooks.webSearchCard.getSnapshot().apiKeyConfigured).toBe(false)
  })

  it('saves the endpoint and the search budget together', async () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<WebSearchSettings>()
    acceptWrites(host)
    /** 中文说明：测试局部值 credentials，由紧邻初始化决定。 */
    const credentials = credentialsApi(true)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new WebSearchCardController(host.scope, credentials.api)
    host.publish({ status: 'ready', writable: true, value: {}, base: {}, user: {} })
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = controller.inject()

    face.edit('baseURL', 'https://other.test')
    face.edit('maxUses', '3')
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledTimes(2) })

    expect(host.set.mock.calls).toEqual([['baseURL', 'https://other.test'], ['maxUses', 3]])
    expect(credentials.set).not.toHaveBeenCalled()
  })
})

describe('ConfigurablePluginsTabController', () => {
  /** 中文说明：函数 settingsApi 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
  function settingsApi(namespaces: string[]) {
    /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
    const describe = vi.fn(() => Promise.resolve({
      rpcId: 's-1' as never,
      result: {
        ok: true as const,
        value: {
          writable: true,
          hasDocument: true,
          namespaces: namespaces.map(ns => ({
            ns, schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0,
          })),
        },
      },
    }))
    return { mirror: new SettingsDescribeMirror({ settings: { describe } } as never), describe }
  }

  /** Slot ledger stand-in: one stored entry per registered card key. */
  /* 中文说明：函数 ledger 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
  function ledger(...keys: string[]) {
    return keys.map(key => ({ component: null, options: { key } }))
  }

  it('dispatches the served namespaces a card claims, in card registration order', async () => {
    /** 中文说明：测试局部值 settings，由紧邻初始化决定。 */
    const settings = settingsApi(['bash', 'ui-theme', 'agent-loop'])
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('agent-loop', 'bash'))

    await settings.mirror.ensure()

    // ui-theme is served but claimed by no card here — another surface owns
    // it. The order is the cards', not the Host's: plugin activation can
    // reorder the description between boots.
    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces)
      .toEqual(['agent-loop', 'bash'])
  })

  it('never dispatches a card whose namespace this deployment does not serve', async () => {
    /** 中文说明：测试局部值 settings，由紧邻初始化决定。 */
    const settings = settingsApi(['bash'])
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash', 'web-search-deepseek'))

    await settings.mirror.ensure()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual(['bash'])
  })

  it('takes a card registered after the read without asking the Host again', async () => {
    /** 中文说明：测试局部值 settings，由紧邻初始化决定。 */
    const settings = settingsApi(['bash'])
    /** 中文说明：测试局部值 entries，由紧邻初始化决定。 */
    let entries = ledger()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => entries)
    await settings.mirror.ensure()
    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual([])

    entries = ledger('bash')
    controller.refresh()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual(['bash'])
    expect(settings.describe).toHaveBeenCalledOnce()
  })

  it('keeps the namespaces it knew when a refresh fails', async () => {
    /** 中文说明：测试局部值 settings，由紧邻初始化决定。 */
    const settings = settingsApi(['bash'])
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash'))
    await settings.mirror.ensure()
    settings.describe.mockRejectedValueOnce(new Error('offline'))

    await settings.mirror.load()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual(['bash'])
  })

  it('stops following the mirror once disposed, and never claims it was answered', async () => {
    /** 中文说明：测试局部值 settings，由紧邻初始化决定。 */
    const settings = settingsApi(['bash'])
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash'))

    controller.dispose()
    await settings.mirror.load()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: false, namespaces: [] })
  })

  it('ignores a slot-ledger change that arrives after disposal', async () => {
    /** 中文说明：测试局部值 settings，由紧邻初始化决定。 */
    const settings = settingsApi(['bash'])
    /** 中文说明：测试局部值 entries，由紧邻初始化决定。 */
    let entries = ledger()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => entries)
    await settings.mirror.ensure()

    controller.dispose()
    entries = ledger('bash')
    controller.refresh()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual([])
  })

  it('ignores a mirror notification already queued when disposal starts', () => {
    /** 中文说明：测试局部值 notify，由紧邻初始化决定。 */
    let notify = (): void => {}
    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    let snapshot: SettingsMirrorSnapshot = {
      status: 'ready' as const,
      view: { writable: true, hasDocument: true, namespaces: [] },
      error: null,
    }
    /** 中文说明：测试局部值 describeFace，由紧邻初始化决定。 */
    const describeFace = {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        notify = listener
        return () => {}
      },
      ensure: () => Promise.resolve(),
      acceptView: vi.fn(),
    } as never
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new ConfigurablePluginsTabController(describeFace, () => ledger('bash'))
    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: true, namespaces: [] })

    controller.dispose()
    snapshot = {
      status: 'ready',
      view: {
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: 'bash', schema: {}, value: {}, applies: 'live', secrets: [], revision: 1,
        }],
      },
      error: null,
    }
    notify()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: true, namespaces: [] })
  })

  it('reports the Host answered even when it serves nothing this tab shows', async () => {
    /** 中文说明：测试局部值 settings，由紧邻初始化决定。 */
    const settings = settingsApi(['ui-theme'])
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash'))

    await settings.mirror.ensure()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: true, namespaces: [] })
  })
})
