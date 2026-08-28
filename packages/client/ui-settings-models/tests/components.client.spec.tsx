// @vitest-environment jsdom
/*
 * 文件职责：验证模型设置的 components.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、表单事件和 API 替身。
 * 产品维度：防止模型设置保存、发现和错误提示回归。
 * 逻辑维度：构造配置状态，触发操作并断言请求与界面。
 * 关键边界：敏感值不得意外回显；异步发现和保存必须清理。
 * 新手阅读建议：先读状态夹具，再按加载、编辑、保存场景阅读。
 */
/** Section, setup-card, and hand-written editor behavior over a scripted wire face. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { JsonValue, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ModelsSection, needsSetup, providerCopy, providerTargetLabel, removeProviderProfile,
} from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected, ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { pathOps } from '../src/client/ProviderEditor.tsx'
import {
  DeepSeekModelsEditor, formatCapacity, modelDrafts, parseCapacity, validateDeepSeekModels,
} from '../src/client/DeepSeekModelsEditor.tsx'
import { apiKeyFailure } from '../src/client/apiKey.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { deriveKeyRef, ModelsSettingsStore } from '../src/client/store.ts'
import type { ProviderRow } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

/** 中文说明：测试局部值 t，由紧邻初始化决定。 */
const t: ModelsSectionInjected['t'] = key => en[key]
/** 中文说明：测试局部值 OPENAI_TARGET，由紧邻初始化决定。 */
const OPENAI_TARGET = { provider: 'openai', displayName: 'openai' }
/** 中文说明：测试局部值 openaiCopy，由紧邻初始化决定。 */
const openaiCopy = (template: string): string => providerCopy(template, OPENAI_TARGET)
/** 中文说明：测试局部值 DEEPSEEK_TARGET，由紧邻初始化决定。 */
const DEEPSEEK_TARGET = { provider: 'deepseek-official', displayName: 'DeepSeek' }
/** 中文说明：测试局部值 deepSeekCopy，由紧邻初始化决定。 */
const deepSeekCopy = (template: string): string => providerCopy(template, DEEPSEEK_TARGET)

/** Open one row's capacity disclosure (1-based, as the labels read). */
/* 中文说明：函数 expandRow 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function expandRow(position: number): void {
  fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} ${String(position)}`))
}

/** The capacity inputs of every open row, in row order. */
/* 中文说明：函数 capacityInputs 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function capacityInputs(label: string): HTMLInputElement[] {
  return screen.getAllByLabelText<HTMLInputElement>(new RegExp(label))
}

/** 中文说明：测试局部值 PiAiConfig，由紧邻初始化决定。 */
const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    baseURL: Schema.string(),
    reasoning: Schema.union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    headers: Schema.dict(Schema.string()),
  })),
})

/** 中文说明：测试局部值 DeepSeekConfig，由紧邻初始化决定。 */
const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref'),
  baseURL: Schema.string().pattern(/^https:\/\//),
  reasoningEffort: Schema.union(['off', 'low', 'high', 'max']),
  defaultContextWindow: Schema.number().step(1).min(1),
  models: Schema.array(Schema.object({
    id: Schema.string().required(),
    name: Schema.string(),
    description: Schema.string(),
    contextWindow: Schema.number().step(1).min(1),
  // The adapter declares its catalog as a schema default rather than a
  // composition entry, which is what the restore-defaults path has to read.
  })).default([
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      description: '',
      contextWindow: 1_000_000,
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek-V4-Pro',
      description: '',
      contextWindow: 1_000_000,
    },
  ]),
})

/** 中文说明：测试局部值 DEFAULT_DEEPSEEK_MODELS，由紧邻初始化决定。 */
const DEFAULT_DEEPSEEK_MODELS = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek-V4-Flash',
    description: 'Preserved hidden detail',
    contextWindow: 1_000_000,
  },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000 },
]

/** 中文说明：函数 wireNamespaces 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function wireNamespaces(): SettingsNamespaceView[] {
  return [
    {
      ns: 'llm-deepseek',
      schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
      value: {
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        baseURL: 'https://base',
        defaultContextWindow: 1_000_000,
        maxTokens: 256_000,
        models: DEFAULT_DEEPSEEK_MODELS,
      },
      base: { defaultContextWindow: 1_000_000, maxTokens: 256_000, models: DEFAULT_DEEPSEEK_MODELS },
      user: { baseURL: 'https://base' },
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'llm-plain',
      schema: JSON.parse(JSON.stringify(Schema.object({
        profiles: Schema.dict(Schema.object({ note: Schema.string() })),
      }).toJSON())) as JsonValue,
      value: {},
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'llm-pi-ai',
      schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as JsonValue,
      value: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy', headers: { 'X-Team': 'a' } }, zombie: {} } },
      user: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy', headers: { 'X-Team': 'a' } }, zombie: {} } },
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'subagent-model-selection',
      schema: JSON.parse(JSON.stringify(Schema.object({ enabled: Schema.boolean().default(false) }).toJSON())) as JsonValue,
      value: { enabled: false },
      applies: 'live',
      secrets: [],
      revision: 4,
    },
  ]
}

/** Credentials answers over the Remote carrier, which has no envelope. */
function remoteOk<T>(value: T) {
  return { ok: true as const, value }
}
function remoteFail(message: string, code = 'credential-rejected') {
  return { ok: false as const, error: { code, message, details: {} } }
}

/** 中文说明：函数 scriptedFace 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function scriptedFace(overrides: {
  update?: ReturnType<typeof vi.fn>
  mutate?: ReturnType<typeof vi.fn>
  set?: ReturnType<typeof vi.fn>
  unset?: ReturnType<typeof vi.fn>
} = {}) {
  const providerNamespace = wireNamespaces().find(view => view.ns === 'llm-pi-ai')!
  const update = overrides.update ?? vi.fn(() => Promise.resolve(remoteOk(providerNamespace)))
  const mutate = overrides.mutate ?? vi.fn(() => Promise.resolve(remoteOk(providerNamespace)))
  const set = overrides.set ?? vi.fn(() => Promise.resolve(remoteOk(undefined)))
  const unset = overrides.unset ?? vi.fn(() => Promise.resolve(remoteOk(undefined)))
  const face = {
    llm: {
      listProviders: vi.fn(() => Promise.resolve(remoteOk([
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'openai', name: 'openai' },
      ]))),
      listConfigurableProviders: vi.fn(() => Promise.resolve(remoteOk([
        { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
        { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true },
        { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], active: false },
        { provider: 'zombie', displayName: 'zombie', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'zombie'], active: false },
        { provider: 'broken', displayName: 'broken', settingsNs: 'llm-pi-ai', settingsPath: ['nope', 'x'], active: false },
        { provider: 'plain', displayName: 'plain', settingsNs: 'llm-plain', settingsPath: ['profiles', 'plain'], active: false },
      ].map(({ active: _active, ...entry }) => entry)))),
      discoverModels: vi.fn(() => Promise.resolve(remoteOk([]))),
    },
    settings: {
      describe: vi.fn(() => Promise.resolve(remoteOk({ writable: true, hasDocument: false, namespaces: wireNamespaces() }))),
      update,
      mutate,
    },
    credentials: {
      describe: vi.fn((refs: string[]) => Promise.resolve(remoteOk(
        Object.fromEntries(refs.map(ref => [ref, {
          configured: ref === 'OPENAI_API_KEY',
          ...ref === 'OPENAI_API_KEY' ? { source: 'file' } : {},
          writable: true,
        }])),
      ))),
      set,
      unset,
    },
  }
  return { face, update, mutate, set, unset }
}

/** 中文说明：类型或类 WireFace 约束设置数据或组件职责。 */
type WireFace = ConstructorParameters<typeof ModelsSettingsStore>[0]

/** One recorded child-slot dispatch: seat name, owner share, kind options. */
type RenderSlotCall = [name: string, owner: Record<string, unknown>, opts?: { entryKey?: string }]

/** Child-slot dispatch stub: records every seat occurrence, renders nothing. */
function stubRenderSlot() {
  return vi.fn((..._call: RenderSlotCall) => null)
}

/** The provider-card seat dispatches a stub recorded, as (route id, configured, keyConfigured, entryKey). */
function cardSeatCalls(
  renderSlot: ReturnType<typeof stubRenderSlot>,
): Array<[string, boolean, boolean, string | undefined]> {
  return renderSlot.mock.calls
    .filter(call => call[0] === 'settings.models.provider-card')
    .map(call => [
      (call[1] as { provider: { provider: string } }).provider.provider,
      (call[1] as { configured: boolean }).configured,
      (call[1] as { keyConfigured: boolean }).keyConfigured,
      call[2]?.entryKey,
    ])
}

async function mountFace(scripted: ReturnType<typeof scriptedFace>) {
  const { face, update, mutate, set, unset } = scripted
  const mirror = new SettingsDescribeMirror(face as never)
  /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
  const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, mirror)
  await controller.load()
  const renderSlot = stubRenderSlot()
  const injected: ModelsSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    api: face as never,
    schema: settingsSchema,
    t,
    renderSlot: renderSlot as unknown as ModelsSectionProps['renderSlot'],
  }
  /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
  const view = render(<ModelsSection {...injected} />)
  return { view, face, update, mutate, set, unset, controller, mirror, renderSlot }
}

/** 中文说明：函数 mountSection 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
async function mountSection(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  return mountFace(scriptedFace(overrides))
}

/**
 * Mount for a user who cannot reach any provider yet: no credential is stored
 * anywhere, so the whole-section DeepSeek route owns the first-run setup card.
 */
/* 中文说明：函数 mountFirstRun 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
async function mountFirstRun(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  /** 中文说明：测试局部值 scripted，由紧邻初始化决定。 */
  const scripted = scriptedFace(overrides)
  scripted.face.credentials.describe.mockImplementation((refs: string[]) =>
    Promise.resolve(remoteOk(
      Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])),
    )))
  return mountFace(scripted)
}

/**
 * Mount and open the DeepSeek editor. The shared fixture already has a usable
 * openai route, so DeepSeek is an ordinary row whose card opens through Edit
 * rather than by itself.
 */
/* 中文说明：函数 mountDeepSeekCard 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
async function mountDeepSeekCard(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  /** 中文说明：测试局部值 mounted，由紧邻初始化决定。 */
  const mounted = await mountSection(overrides)
  fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.editProvider) }))
  return mounted
}

describe('ModelsSection', () => {
  it('renders nothing before the slot injects its dependencies', () => {
    /** 中文说明：测试局部值 uninjected，由紧邻初始化决定。 */
    const uninjected = {} as ModelsSectionProps
    render(<ModelsSection {...uninjected} />)
    expect(document.body.textContent).toBe('')
  })

  it('dispatches the provider-card seat per rendered row, keyed by the owning namespace', async () => {
    const { renderSlot } = await mountSection()
    const cards = cardSeatCalls(renderSlot)
    expect(cards).toContainEqual(['openai', true, true, 'llm-pi-ai'])
    expect(cards).toContainEqual(['deepseek-official', true, false, 'llm-deepseek'])
    // The footer seat renders once below the rows and the add controls.
    expect(renderSlot.mock.calls.filter(call => call[0] === 'settings.models.footer')).toEqual([
      ['settings.models.footer', {}],
    ])
  })

  it('dispatches the provider-card seat inside the first-run setup card', async () => {
    const { renderSlot } = await mountFirstRun()
    expect(cardSeatCalls(renderSlot)).toContainEqual(['deepseek-official', true, false, 'llm-deepseek'])
  })

  it('dispatches the provider-card seat on the add-provider draft with its dormant row', async () => {
    const { renderSlot } = await mountSection()
    renderSlot.mockClear()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    expect(cardSeatCalls(renderSlot)).toContainEqual(['anthropic', false, false, 'llm-pi-ai'])
  })

  it('derives the draft seat\'s key fact from the page\'s conventional reference', async () => {
    const scripted = scriptedFace()
    scripted.face.credentials.describe.mockImplementation((refs: string[]) => Promise.resolve(remoteOk(
      Object.fromEntries(refs.map(ref => [ref, {
        configured: ref === 'OPENAI_API_KEY' || ref === 'ANTHROPIC_API_KEY',
        writable: true,
      }])),
    )))
    const { renderSlot } = await mountFace(scripted)
    renderSlot.mockClear()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    // The dormant row names no reference yet; the seat still reports the
    // derived ANTHROPIC_API_KEY the editor itself displays as configured.
    expect(cardSeatCalls(renderSlot)).toContainEqual(['anthropic', false, true, 'llm-pi-ai'])
  })

  it('skips the draft seat when a refresh drops the dormant row', async () => {
    const { renderSlot, face, controller } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: en.add }))
    const directory = [
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
      { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true },
    ].map(({ active: _active, ...entry }) => entry)
    face.llm.listConfigurableProviders.mockImplementation(() => Promise.resolve(remoteOk(directory)))
    renderSlot.mockClear()
    await act(async () => { await controller.load() })
    // The draft card is still open while its row is gone from the directory.
    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
    expect(cardSeatCalls(renderSlot).some(([provider]) => provider === 'anthropic')).toBe(false)
  })
  it('renders the unkeyed whole-section provider as an open setup card in the first-run posture', async () => {
    await mountFirstRun()
    // Nothing is reachable yet, and DeepSeek has no configured credential and
    // no stored apiKey → setup card.
    expect(screen.getByText('DeepSeek')).toBeTruthy()
    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
    expect(screen.getByText('openai')).toBeTruthy()
    expect(screen.queryByText('Active')).toBeNull()
    expect(screen.queryByText('Inactive')).toBeNull()
    expect(screen.getByText(en.add)).toBeTruthy()
  })

  it('leaves the unkeyed provider a plain row once another provider is usable', async () => {
    await mountSection()
    // openai's key is stored, so the user is not blocked and nothing on the
    // page opens itself over them.
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
    /** 中文说明：测试局部值 configured，由紧邻初始化决定。 */
    const configured = screen.getByRole('img', { name: en.credentialConfigured })
    expect(configured.getAttribute('title')).toBe(en.credentialConfigured)
    expect(configured.className).toContain('credentialDotConfigured')
    expect(configured.closest('li')?.textContent).toContain('openai')
    /** 中文说明：测试局部值 missing，由紧邻初始化决定。 */
    const missing = screen.getByRole('img', { name: en.credentialMissing })
    expect(missing.closest('li')?.textContent).toContain('DeepSeek')
    // The card is still one click away.
    fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.editProvider) }))
    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
  })

  it('marks only a confirmed missing reference and leaves native or unavailable state unmarked', async () => {
    /** 中文说明：测试局部值 { face }，由紧邻初始化决定。 */
    const { face } = scriptedFace()
    face.credentials.describe.mockImplementation((refs: string[]) => Promise.resolve(remoteOk(
      Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])),
    )))
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    await controller.load()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
      renderSlot={() => null}
    />)

    /** 中文说明：测试局部值 missing，由紧邻初始化决定。 */
    const missing = screen.getByRole('img', { name: en.credentialMissing })
    expect(missing.getAttribute('title')).toBe(en.credentialMissing)
    expect(missing.className).toContain('credentialDotMissing')
    expect(missing.closest('li')?.textContent).toContain('openai')
    expect(screen.queryByRole('img', { name: en.credentialConfigured })).toBeNull()
    expect(screen.getByText('zombie').closest('li')?.querySelector('[role="img"]')).toBeNull()
  })

  it('turns the setup card into a row once the credential reports configured', async () => {
    /** 中文说明：测试局部值 { face }，由紧邻初始化决定。 */
    const { face } = await mountFirstRun()
    face.credentials.describe.mockImplementation((refs: string[]) => Promise.resolve(remoteOk(
      Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
    )))
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    await controller.load()
    cleanup()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
      renderSlot={() => null}
    />)
    // Now a row with an Edit button, not an open card.
    expect(screen.getAllByText(en.edit).length).toBeGreaterThan(1)
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
  })

  it('decides setup need from the joined credential state and the first-run posture', () => {
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = { provider: 'p', displayName: 'p', settingsNs: 'llm-deepseek', settingsPath: [], active: true }
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = (credential: ProviderRow['credential']): ProviderRow => ({
      entry,
      configured: true,
      removable: false,
      apiKeyEnv: 'X',
      credential,
    })
    expect(needsSetup(row(undefined), false)).toBe(true)
    expect(needsSetup(row({ configured: true, writable: true }), false)).toBe(false)
    /** 中文说明：测试局部值 nested，由紧邻初始化决定。 */
    const nested = { ...row(undefined), entry: { ...entry, settingsPath: ['providers', 'x'] } }
    expect(needsSetup(nested, false)).toBe(false)
    // A user who can already reach some provider is not in the first-run
    // posture, so nothing on the page opens itself.
    expect(needsSetup(row(undefined), true)).toBe(false)
  })

  it('derives conventional credential references from route ids', () => {
    expect(deriveKeyRef('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(deriveKeyRef('minimax-cn')).toBe('MINIMAX_CN_API_KEY')
  })

  it('uses one stable provider identity in action copy', () => {
    /** 中文说明：测试局部值 target，由紧邻初始化决定。 */
    const target = { provider: 'deepseek-official', displayName: 'DeepSeek' }
    expect(providerTargetLabel(target)).toBe('DeepSeek (deepseek-official)')
    expect(providerCopy(en.deleteTitle, target)).toBe('Delete DeepSeek (deepseek-official)?')
    expect(providerTargetLabel(OPENAI_TARGET)).toBe('openai')
  })

  it('names only changed fields instead of rebuilding the section', () => {
    expect(pathOps(['providers', 'openai'], { baseURL: 'https://old', reasoning: 'high' }, { reasoning: 'high' }))
      .toEqual([{ op: 'unset', path: ['providers', 'openai', 'baseURL'] }])
    expect(pathOps([], { b: 1 }, { b: 2, d: 3 }))
      .toEqual([{ op: 'set', path: ['b'], value: 2 }, { op: 'set', path: ['d'], value: 3 }])
    expect(pathOps([], undefined, {})).toEqual([])
    expect(pathOps([], { a: 1 }, { a: 1 })).toEqual([])
  })

  it('stores a typed key write-only from the setup card without touching settings', async () => {
    const { set, mutate, face } = await mountFirstRun()
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    fireEvent.change(key, { target: { value: '  sk-live  ' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-live') })
    expect(mutate).not.toHaveBeenCalled()
    // The saved key re-loads the join; the settings answer rides the shared
    // mirror, so the reload shows as a directory read rather than a describe.
    await waitFor(() => { expect(face.llm.listProviders.mock.calls.length).toBeGreaterThan(1) })
    expect((await screen.findByRole('status')).textContent).toBe(
      providerCopy(en.savedProvider, { provider: 'deepseek-official', displayName: 'DeepSeek' }),
    )
    fireEvent.click(screen.getByText(en.add))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reuses the provider editor as a required credential-only onboarding form', async () => {
    let finishSet: ((response: { ok: true; value: undefined }) => void) | undefined
    const set = vi.fn(() => new Promise<{ ok: true; value: undefined }>((resolve) => {
      finishSet = resolve
    }))
    /** 中文说明：测试局部值 { face, mutate }，由紧邻初始化决定。 */
    const { face, mutate } = scriptedFace({ set })
    /** 中文说明：测试局部值 onClose，由紧邻初始化决定。 */
    const onClose = vi.fn()
    /** 中文说明：测试局部值 { ProviderEditor }，由紧邻初始化决定。 */
    const { ProviderEditor } = await import('../src/client/ProviderEditor.tsx')

    render(<ProviderEditor
      provider="deepseek-official"
      displayName="DeepSeek"
      hideTitle
      namespace={wireNamespaces()[0]!}
      schema={settingsSchema}
      settingsPath={[]}
      api={face as never}
      t={t}
      readOnly={false}
      credentialOnly
      credentialRequired
      autoFocusCredential
      cancelLabelKey="onboardingLater"
      submitLabelKey="onboardingSave"
      submitBusyLabelKey="onboardingSaving"
      onClose={onClose}
    />)

    /** 中文说明：测试局部值 key，由紧邻初始化决定。 */
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    /** 中文说明：测试局部值 save，由紧邻初始化决定。 */
    const save = screen.getByText<HTMLButtonElement>(en.onboardingSave)
    expect(document.activeElement).toBe(key)
    expect(key.required).toBe(true)
    expect(save.disabled).toBe(true)
    expect(screen.getByText(en.onboardingLater)).toBeTruthy()
    expect(screen.queryByText(en.customized)).toBeNull()
    expect(screen.queryByLabelText(en.baseUrl)).toBeNull()

    fireEvent.change(key, { target: { value: '   ' } })
    expect(screen.getByText(en.keyRequired)).toBeTruthy()
    expect(key.getAttribute('aria-invalid')).toBe('true')
    expect(save.disabled).toBe(true)

    fireEvent.change(key, { target: { value: '  sk-onboarding  ' } })
    expect(screen.queryByText(en.keyRequired)).toBeNull()
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    expect(await screen.findByText(en.onboardingSaving)).toBeTruthy()
    expect(set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-onboarding')
    expect(mutate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    if (finishSet === undefined) throw new Error('credential write did not start')
    await act(async () => {
      finishSet?.(remoteOk(undefined))
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('applies customized deepseek fields as path ops', async () => {
    /** 中文说明：测试局部值 { mutate }，由紧邻初始化决定。 */
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    /** 中文说明：测试局部值 baseURL，由紧邻初始化决定。 */
    const baseURL = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    // The deepseek placeholder is pinned to the public endpoint, not the
    // effective value (which may reflect a launch-environment override).
    expect(baseURL.placeholder).toBe('https://api.deepseek.com')
    fireEvent.change(baseURL, { target: { value: 'https://next2' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // Only the field that actually changed: reasoningEffort was already
    // 'high' in the loaded profile, so it produces no op.
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{ op: 'set', path: ['baseURL'], value: 'https://next2' }],
      0,
    ])
  })

  it('materializes inherited models and adds an arbitrary DeepSeek id', async () => {
    /** 中文说明：测试局部值 { mutate }，由紧邻初始化决定。 */
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    expect(screen.getByText(en.modelsInherited)).toBeTruthy()
    expect(screen.getAllByLabelText(new RegExp(en.modelId)).map(input => (input as HTMLInputElement).value))
      .toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])

    fireEvent.click(screen.getByText(en.addModel))
    /** 中文说明：测试局部值 ids，由紧邻初始化决定。 */
    const ids = screen.getAllByLabelText(new RegExp(en.modelId))
    /** 中文说明：测试局部值 names，由紧邻初始化决定。 */
    const names = screen.getAllByLabelText(new RegExp(en.modelName))
    expandRow(3)
    fireEvent.change(ids[2] as HTMLInputElement, { target: { value: 'private-preview' } })
    fireEvent.change(names[2] as HTMLInputElement, { target: { value: 'Private Preview' } })
    // Only row 3 is open, so its capacity is addressed by its own label.
    fireEvent.change(screen.getByLabelText(`${en.contextWindow} 3`), { target: { value: '131072' } })
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{
        op: 'set',
        path: ['models'],
        value: [
          ...DEFAULT_DEEPSEEK_MODELS,
          { id: 'private-preview', name: 'Private Preview', contextWindow: 131_072 },
        ],
      }],
      0,
    ])
  })

  it('rejects duplicate DeepSeek model ids before writing', async () => {
    /** 中文说明：测试局部值 { mutate }，由紧邻初始化决定。 */
    const { mutate } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.click(screen.getByText(en.addModel))
    /** 中文说明：测试局部值 ids，由紧邻初始化决定。 */
    const ids = screen.getAllByLabelText(new RegExp(en.modelId))
    fireEvent.change(ids[2] as HTMLInputElement, { target: { value: 'deepseek-v4-flash' } })
    fireEvent.click(screen.getByText(en.apply))

    await screen.findByText(`Model 3: ${en.modelIdDuplicate}`)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('validates every adapter-owned model catalog invariant', () => {
    expect(modelDrafts(undefined)).toEqual([])
    expect(modelDrafts([null, 'bad', { id: 'ok' }])).toEqual([{}, {}, { id: 'ok' }])
    expect(validateDeepSeekModels([{}])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateDeepSeekModels([{ id: 'same' }, { id: 'same' }]))
      .toEqual({ index: 1, key: 'modelIdDuplicate' })
    expect(validateDeepSeekModels([{ id: 'model', name: '' }]))
      .toEqual({ index: 0, key: 'modelNameInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: null }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: 1.5 }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: 0 }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', contextWindow: 1 }])).toBeUndefined()
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: null }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: 1.5 }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: 0 }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateDeepSeekModels([{ id: 'model', maxTokens: 8192 }])).toBeUndefined()
  })

  it('reads context windows written as counts, thousands, or millions', () => {
    expect(parseCapacity('')).toBeUndefined()
    expect(parseCapacity('   ')).toBeUndefined()
    expect(parseCapacity('131072')).toBe(131_072)
    expect(parseCapacity(' 256K ')).toBe(256_000)
    expect(parseCapacity('256k')).toBe(256_000)
    expect(parseCapacity('1M')).toBe(1_000_000)
    expect(parseCapacity('1m')).toBe(1_000_000)
    // 1M is 1000K, not 1024K: capacities are quoted in decimal.
    expect(parseCapacity('1M')).toBe(parseCapacity('1000K'))
    // 2.3 * 1e6 is a few ULPs high in binary floating point; an integral
    // intent must not become a fractional count the validator rejects.
    expect(parseCapacity('2.3M')).toBe(2_300_000)
    expect(Number.isInteger(parseCapacity('1.5M'))).toBe(true)
    // A genuinely fractional count survives as one, for the validator to reject.
    expect(parseCapacity('0.0001K')).toBeCloseTo(0.1)
    expect(parseCapacity('abc')).toBeNaN()
    expect(parseCapacity('1G')).toBeNaN()
    expect(parseCapacity('1M1')).toBeNaN()
  })

  it('spells a stored count in the shortest form that round-trips', () => {
    expect(formatCapacity(1_000_000)).toBe('1M')
    expect(formatCapacity(256_000)).toBe('256K')
    expect(formatCapacity(1_500_000)).toBe('1500K')
    expect(formatCapacity(131_072)).toBe('131072')
    // Values the validator will reject are shown as-is rather than dressed up.
    expect(formatCapacity(Number.NaN)).toBe('NaN')
    expect(formatCapacity(0)).toBe('0')
    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    for (const text of ['1M', '256K', '131072', '1500K']) {
      expect(formatCapacity(parseCapacity(text) as number)).toBe(text)
    }
  })

  it('accepts a suffixed context window and stores the plain count', async () => {
    /** 中文说明：测试局部值 { mutate }，由紧邻初始化决定。 */
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    expandRow(1)
    expandRow(2)
    /** 中文说明：测试局部值 windows，由紧邻初始化决定。 */
    const windows = capacityInputs(en.contextWindow)
    // The inherited 1000000 reads back short.
    expect((windows[0] as HTMLInputElement).value).toBe('1M')

    // Keystrokes stay verbatim while the row has focus, so typing `1000` does
    // not rewrite itself to `1K` mid-word.
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '1000' } })
    expect((windows[0] as HTMLInputElement).value).toBe('1000')
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '1000K' } })
    expect((windows[0] as HTMLInputElement).value).toBe('1000K')
    // Blur settles the row to the canonical spelling of the same count.
    fireEvent.blur(windows[0] as HTMLInputElement)
    expect((windows[0] as HTMLInputElement).value).toBe('1M')

    fireEvent.change(windows[1] as HTMLInputElement, { target: { value: '256K' } })
    fireEvent.blur(windows[1] as HTMLInputElement)
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{
        op: 'set',
        path: ['models'],
        value: [
          { ...DEFAULT_DEEPSEEK_MODELS[0], contextWindow: 1_000_000 },
          { ...DEFAULT_DEEPSEEK_MODELS[1], contextWindow: 256_000 },
        ],
      }],
      0,
    ])
  })

  it('keeps unreadable context-window text on screen and refuses the write', async () => {
    /** 中文说明：测试局部值 { mutate }，由紧邻初始化决定。 */
    const { mutate } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    expandRow(1)
    expandRow(2)
    /** 中文说明：测试局部值 windows，由紧邻初始化决定。 */
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '1 gazillion' } })
    // Blurring a row that is not the edited one leaves the buffer alone.
    fireEvent.blur(windows[1] as HTMLInputElement)
    fireEvent.blur(windows[0] as HTMLInputElement)
    // The text the user typed is still there to correct.
    expect((windows[0] as HTMLInputElement).value).toBe('1 gazillion')

    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(`Model 1: ${en.modelContextInvalid}`)
    expect(mutate).not.toHaveBeenCalled()
  })

  it.each([
    ['the schema default', undefined],
    ['the composition entry', { models: [{ id: 'pinned-by-deployment' }] }],
  ])('restores %s the moment the override is dropped, not after a reload', async (_label, base) => {
    // The regression: reset read the EFFECTIVE value, which still carries the
    // stored override until the unset is applied — so the rows did not change
    // and the catalog only looked restored after reopening the card.
    /** 中文说明：测试局部值 { face }，由紧邻初始化决定。 */
    const { face } = scriptedFace()
    /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
    const stored = { models: [{ id: 'user-only-model', name: 'User Only' }] }
    /** 中文说明：测试局部值 overridden，由紧邻初始化决定。 */
    const overridden: SettingsNamespaceView = {
      ns: 'llm-deepseek',
      schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
      value: { ...stored, defaultContextWindow: 1_000_000 },
      ...base === undefined ? {} : { base },
      user: stored,
      applies: 'live',
      secrets: [],
      revision: 0,
    }
    /** 中文说明：测试局部值 { ProviderEditor }，由紧邻初始化决定。 */
    const { ProviderEditor } = await import('../src/client/ProviderEditor.tsx')
    render(<ProviderEditor
      provider="deepseek-official"
      displayName="DeepSeek"
      namespace={overridden}
      schema={settingsSchema}
      settingsPath={[]}
      api={face as never}
      t={t}
      readOnly={false}
      onClose={() => {}}
    />)
    fireEvent.click(screen.getByText(en.customized))
    expect(screen.getByText(en.modelsCustomized)).toBeTruthy()
    expect(screen.getAllByLabelText(new RegExp(en.modelId)).map(input => (input as HTMLInputElement).value))
      .toEqual(['user-only-model'])

    fireEvent.click(screen.getByText(en.resetModels))

    expect(screen.getByText(en.modelsInherited)).toBeTruthy()
    expect(screen.getAllByLabelText(new RegExp(en.modelId)).map(input => (input as HTMLInputElement).value))
      .toEqual(base === undefined ? ['deepseek-v4-flash', 'deepseek-v4-pro'] : ['pinned-by-deployment'])
  })

  it('keeps every row\'s unreadable text, not just the last one edited', async () => {
    // The regression: one active buffer meant editing a second row displaced
    // the first, which then fell back to rendering its stored NaN as `NaN` —
    // losing the text the user was told they could still correct.
    await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    expandRow(1)
    expandRow(2)
    /** 中文说明：测试局部值 windows，由紧邻初始化决定。 */
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: 'not a number' } })
    fireEvent.blur(windows[0] as HTMLInputElement)
    fireEvent.change(windows[1] as HTMLInputElement, { target: { value: '2M' } })

    expect((windows[0] as HTMLInputElement).value).toBe('not a number')
    expect((windows[1] as HTMLInputElement).value).toBe('2M')
  })

  it('re-keys the typed text around a removed row', async () => {
    await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    /** 中文说明：测试局部值 windows，由紧邻初始化决定。 */
    const windows = (): HTMLInputElement[] => capacityInputs(en.contextWindow)
    /** 中文说明：测试局部值 removeRow，由紧邻初始化决定。 */
    const removeRow = (at: number): void => {
      fireEvent.click(screen.getAllByLabelText(new RegExp(en.removeModel))[at] as HTMLElement)
    }
    // Three rows, with text parked on the outer two.
    fireEvent.click(screen.getByText(en.addModel))
    expandRow(1)
    expandRow(2)
    expandRow(3)
    fireEvent.change(windows()[0] as HTMLInputElement, { target: { value: 'top text' } })
    fireEvent.blur(windows()[0] as HTMLInputElement)
    fireEvent.change(windows()[2] as HTMLInputElement, { target: { value: 'bottom text' } })
    fireEvent.blur(windows()[2] as HTMLInputElement)

    // Dropping the middle row leaves the row above untouched and carries the
    // row below down with its own text, rather than stranding it.
    removeRow(1)
    expect(windows()).toHaveLength(2)
    expect((windows()[0] as HTMLInputElement).value).toBe('top text')
    expect((windows()[1] as HTMLInputElement).value).toBe('bottom text')

    // Dropping a row that holds text takes that text with it; the survivor
    // keeps its own rather than inheriting the deleted row's.
    removeRow(0)
    expect(windows()).toHaveLength(1)
    expect((windows()[0] as HTMLInputElement).value).toBe('bottom text')
  })

  it('drops the typed text when reset replaces the rows it annotated', async () => {
    // The regression: reset removed the override but left the buffer, so an
    // inherited row displayed text no settings layer stores — and because an
    // unreadable buffer never settles, it stayed there indefinitely.
    /** 中文说明：测试局部值 { mutate }，由紧邻初始化决定。 */
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    expandRow(1)
    /** 中文说明：测试局部值 windows，由紧邻初始化决定。 */
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: 'garbage' } })
    fireEvent.blur(windows[0] as HTMLInputElement)
    fireEvent.click(screen.getByText(en.resetModels))

    // Reset collapses every row, so the restored capacity needs opening again.
    expandRow(1)
    /** 中文说明：测试局部值 restored，由紧邻初始化决定。 */
    const restored = capacityInputs(en.contextWindow)
    expect((restored[0] as HTMLInputElement).value).toBe('1M')

    // Reset put the draft back where it started, so Apply writes nothing at
    // all rather than persisting whatever the stale text had parsed to.
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(screen.queryByText(en.apply)).toBeNull() })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('edits an output cap per model and carries its text across a removal', async () => {
    /** 中文说明：测试局部值 { mutate }，由紧邻初始化决定。 */
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    expandRow(1)
    expandRow(2)
    // The profile's own cap is the placeholder both rows inherit.
    expect(capacityInputs(en.maxTokens).map(input => input.placeholder)).toEqual(['256K', '256K'])

    fireEvent.change(screen.getByLabelText(`${en.maxTokens} 2`), { target: { value: '64K' } })
    fireEvent.blur(screen.getByLabelText(`${en.maxTokens} 2`))
    expect(screen.getByLabelText<HTMLInputElement>(`${en.maxTokens} 2`).value).toBe('64K')

    // Dropping the row above carries the cap text down with its own row.
    fireEvent.click(screen.getAllByLabelText(new RegExp(en.removeModel))[0] as HTMLElement)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.maxTokens} 1`).value).toBe('64K')
    // The disclosure closes on a second press.
    expandRow(1)
    expect(screen.queryByLabelText(`${en.maxTokens} 1`)).toBeNull()

    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{
        op: 'set',
        path: ['models'],
        value: [{ ...DEFAULT_DEEPSEEK_MODELS[1], maxTokens: 64_000 }],
      }],
      0,
    ])
  })

  it('settles a pasted id and refuses whitespace that would never match', async () => {
    await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    /** 中文说明：测试局部值 ids，由紧邻初始化决定。 */
    const ids = screen.getAllByLabelText<HTMLInputElement>(new RegExp(en.modelId))
    fireEvent.change(ids[0] as HTMLInputElement, { target: { value: '  deepseek-v4-flash  ' } })
    fireEvent.blur(ids[0] as HTMLInputElement)
    expect((ids[0] as HTMLInputElement).value).toBe('deepseek-v4-flash')
    // A settled id needs no second trim.
    fireEvent.blur(ids[0] as HTMLInputElement)
    expect((ids[0] as HTMLInputElement).value).toBe('deepseek-v4-flash')

    // An id that is only whitespace is as absent as an empty one, and a padded
    // id is a duplicate of its trimmed twin.
    expect(validateDeepSeekModels([{ id: '   ' }])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateDeepSeekModels([{ id: 'model' }, { id: 'model ' }]))
      .toEqual({ index: 1, key: 'modelIdDuplicate' })
  })

  it('renders malformed draft fallbacks without inventing catalog values', () => {
    render(<DeepSeekModelsEditor
      models={[{}]}
      overridden={false}
      defaultContextWindow={undefined}
      defaultMaxTokens={undefined}
      t={t}
      disabled={true}
      onChange={vi.fn()}
      onReset={vi.fn()}
    />)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`).value).toBe('')
    expandRow(1)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.contextWindow} 1`).placeholder)
      .toBe(en.contextWindowPlaceholder)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.maxTokens} 1`).placeholder)
      .toBe(en.maxTokensPlaceholder)
  })

  it('can empty and reset the model override, then clear optional fields without dropping hidden data', async () => {
    /** 中文说明：测试局部值 { mutate }，由紧邻初始化决定。 */
    const { mutate } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteOk(wireNamespaces()[0]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.click(screen.getAllByLabelText(new RegExp(en.removeModel))[0] as HTMLElement)
    fireEvent.click(screen.getByLabelText(new RegExp(en.removeModel)))
    expect(screen.getByText(en.modelsEmpty)).toBeTruthy()
    fireEvent.click(screen.getByText(en.resetModels))
    expect(screen.getByText(en.modelsInherited)).toBeTruthy()

    /** 中文说明：测试局部值 names，由紧邻初始化决定。 */
    const names = screen.getAllByLabelText(new RegExp(en.modelName))
    expandRow(1)
    /** 中文说明：测试局部值 windows，由紧邻初始化决定。 */
    const windows = capacityInputs(en.contextWindow)
    fireEvent.change(names[0] as HTMLInputElement, { target: { value: '' } })
    fireEvent.change(windows[0] as HTMLInputElement, { target: { value: '' } })
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{
        op: 'set',
        path: ['models'],
        value: [
          { id: 'deepseek-v4-flash', description: 'Preserved hidden detail' },
          DEFAULT_DEEPSEEK_MODELS[1],
        ],
      }],
      0,
    ])
  })

  it('clears an inherited override with an unset op, never a whole-section replace', async () => {
    // A whole-section replace would clobber sibling overrides to clear one field.
    const { mutate } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    /** 中文说明：测试局部值 url，由紧邻初始化决定。 */
    const url = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(url.value).toBe('https://base')
    fireEvent.change(url, { target: { value: '' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // This editor clears one field through an unset op so it cannot clobber
    // sibling overrides with a whole-section replacement.
    expect(mutate.mock.calls[0]).toEqual([
      'llm-deepseek',
      [{ op: 'unset', path: ['baseURL'] }],
      0,
    ])
  })

  it('pins the deepseek placeholder and clears typed input back to inherited', async () => {
    /** 中文说明：测试局部值 { face }，由紧邻初始化决定。 */
    const { face } = scriptedFace()
    /** 中文说明：测试局部值 bare，由紧邻初始化决定。 */
    const bare: SettingsNamespaceView = {
      ns: 'llm-deepseek',
      schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
      value: {},
      applies: 'live',
      secrets: [],
      revision: 0,
    }
    /** 中文说明：测试局部值 { ProviderEditor }，由紧邻初始化决定。 */
    const { ProviderEditor } = await import('../src/client/ProviderEditor.tsx')
    render(<ProviderEditor
      provider="deepseek-official"
      displayName="DeepSeek"
      namespace={bare}
      schema={settingsSchema}
      settingsPath={[]}
      api={face as never}
      t={t}
      readOnly={false}
      onClose={() => {}}
    />)
    fireEvent.click(screen.getByText(en.customized))
    /** 中文说明：测试局部值 baseURL，由紧邻初始化决定。 */
    const baseURL = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(baseURL.placeholder).toBe('https://api.deepseek.com')
    fireEvent.change(baseURL, { target: { value: 'https://x' } })
    expect(baseURL.value).toBe('https://x')
    fireEvent.change(baseURL, { target: { value: '' } })
    expect(baseURL.value).toBe('')
  })

  it('rejects an invalid draft before writing', async () => {
    const { mutate } = await mountDeepSeekCard()
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(/baseURL/)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('edits a pi-ai profile with the curated fields only', async () => {
    /** 中文说明：测试局部值 { mutate }，由紧邻初始化决定。 */
    const { mutate } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    // The configured credential shows as the stored placeholder.
    /** 中文说明：测试局部值 editorKey，由紧邻初始化决定。 */
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(editorKey.placeholder).toBe(en.keyStored) })
    // pi-ai carries Base URL too: the stored override shows as the value and
    // the effective profile endpoint as its placeholder source.
    fireEvent.click(screen.getByText(en.customized))
    /** 中文说明：测试局部值 url，由紧邻初始化决定。 */
    const url = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(url.value).toBe('https://proxy')
    fireEvent.change(url, { target: { value: 'https://proxy/v2' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // Only the edited field travels: apiKeyEnv and headers were already stored
    // with these values, so no op restates them.
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{ op: 'set', path: ['providers', 'openai', 'baseURL'], value: 'https://proxy/v2' }],
      0,
    ])
  })

  it('adds a dormant provider with a derived reference and stores its key', async () => {
    /** 中文说明：测试局部值 { mutate, set }，由紧邻初始化决定。 */
    const { mutate, set } = await mountSection()
    fireEvent.click(screen.getByText(en.add))
    /** 中文说明：测试局部值 pick，由紧邻初始化决定。 */
    const pick = await screen.findByLabelText<HTMLSelectElement>(en.provider)
    expect([...pick.options].map(option => option.value)).toEqual(['anthropic', 'broken', 'plain'])
    expect(pick.value).toBe('anthropic')
    // A dormant profile has no endpoint anywhere: the pi-ai placeholder
    // falls back to the provider-default wording.
    fireEvent.click(screen.getByText(en.customized))
    expect(screen.getByLabelText<HTMLInputElement>(en.baseUrl).placeholder).toBe(en.baseUrlDefault)
    /** 中文说明：测试局部值 addKey，由紧邻初始化决定。 */
    const addKey = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    expect(addKey.placeholder).toBe(en.keyPlaceholderNative)
    fireEvent.change(addKey, { target: { value: 'sk-ant' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{ op: 'set', path: ['providers', 'anthropic', 'apiKeyEnv'], value: 'ANTHROPIC_API_KEY' }],
      0,
    ])
    await waitFor(() => { expect(set).toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'sk-ant') })
  })

  it('keeps pi-ai provider-native authentication when no key is entered', async () => {
    /** 中文说明：测试局部值 { mutate, set }，由紧邻初始化决定。 */
    const { mutate, set } = await mountSection()
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{ op: 'set', path: ['providers', 'anthropic'], value: {} }],
      0,
    ])
    expect(set).not.toHaveBeenCalled()
  })

  it('retries only the credential after refreshed settings already committed', async () => {
    /** 中文说明：测试局部值 committed，由紧邻初始化决定。 */
    const committed = wireNamespaces()[2]!
    /** 中文说明：测试局部值 afterSettings，由紧邻初始化决定。 */
    const afterSettings: SettingsNamespaceView = {
      ...committed,
      value: { providers: {
        ...(committed.value as { providers: object }).providers,
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      } },
      user: { providers: {
        ...(committed.user as { providers: object }).providers,
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      } },
      revision: 1,
    }
    const mutate = vi.fn(() => Promise.resolve(remoteOk(afterSettings)))
    const set = vi.fn()
      .mockResolvedValueOnce(remoteFail('credential store unavailable'))
      .mockResolvedValueOnce(remoteOk(undefined))
    const { face, controller, mirror } = await mountSection({ mutate, set })
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.keyInput), { target: { value: 'sk-ant' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText('credential store unavailable')
    expect(mutate).toHaveBeenCalledOnce()
    face.settings.describe.mockResolvedValue(remoteOk({
      writable: true,
      hasDocument: false,
      namespaces: wireNamespaces().map(namespace => namespace.ns === 'llm-pi-ai' ? afterSettings : namespace),
    }))
    // The refreshed settings answer reaches the page through the mirror's own
    // refresh (the document commit's invalidation in production).
    await act(async () => {
      await mirror.load()
      await controller.load()
    })
    expect(controller.store.getSnapshot().namespaces.get('llm-pi-ai')?.revision).toBe(1)
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledTimes(2) })
    expect(mutate).toHaveBeenCalledOnce()
    expect(set).toHaveBeenLastCalledWith('ANTHROPIC_API_KEY', 'sk-ant')
  })

  it('switches the add card target and degrades unknown or broken targets loudly', async () => {
    await mountSection()
    fireEvent.click(screen.getByText(en.add))
    /** 中文说明：测试局部值 pick，由紧邻初始化决定。 */
    const pick = await screen.findByLabelText<HTMLSelectElement>(en.provider)
    fireEvent.change(pick, { target: { value: 'broken' } })
    await screen.findByText(/unresolvable settings path/)
    fireEvent.change(pick, { target: { value: 'plain' } })
    await waitFor(() => {
      expect(screen.getAllByText(content => content.includes(en.advancedHint)).length).toBeGreaterThan(0)
    })
    // The hint-only card cannot apply anything, and offers no key field.
    expect(screen.getByText<HTMLButtonElement>(en.apply).disabled).toBe(true)
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
  })

  it('surfaces a rejected settings write and never stores the key after it', async () => {
    /** 中文说明：测试局部值 { set }，由紧邻初始化决定。 */
    const { set } = await mountSection({
      mutate: vi.fn(() => Promise.resolve(remoteFail('llm-pi-ai: unknown pi-ai provider "bogus"', 'settings-rejected'))),
    })
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.keyInput), { target: { value: 'sk-x' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(/unknown pi-ai provider/)
    expect(set).not.toHaveBeenCalled()
  })

  it('renders the card without the stored-key hint when the credential probe rejects', async () => {
    // The probe is a placeholder hint, not a precondition: an escaping
    // rejection would surface in the browser as an unhandled rejection.
    /** 中文说明：测试局部值 { face }，由紧邻初始化决定。 */
    const { face } = scriptedFace()
    face.credentials.describe = vi.fn(() => Promise.reject(new Error('connection lost')))
    /** 中文说明：测试局部值 unhandled，由紧邻初始化决定。 */
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
      const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
      await controller.load()
      render(<ModelsSection
        controller={controller}
        useSnapshot={bindSnapshotSelector(controller.store)}
        api={face as never}
        schema={settingsSchema}
        t={t}
        renderSlot={() => null}
      />)
      /** 中文说明：测试局部值 key，由紧邻初始化决定。 */
      const key = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
      expect(key.placeholder).toBe(en.keyPlaceholder)
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('tells the user to reopen when another writer moved the namespace first', async () => {
    // The stale-draft overwrite: two tabs open the same card, the other saves,
    // and this one must be refused rather than replay its opening snapshot.
    /** 中文说明：测试局部值 { set }，由紧邻初始化决定。 */
    const { set } = await mountDeepSeekCard({
      mutate: vi.fn(() => Promise.resolve(remoteFail('changed since it was read', 'settings-conflict'))),
    })
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.baseUrl), { target: { value: 'https://mine' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(en.conflict)
    expect(set).not.toHaveBeenCalled()
  })

  it('keeps the card usable when the write rejects instead of answering', async () => {
    // A transport failure (disconnect, or the 403 a non-loopback browser now
    // gets on the whole configuration plane) rejects rather than returning a
    // failed envelope: without a catch the card would stay busy forever.
    await mountDeepSeekCard({ mutate: vi.fn(() => Promise.reject(new Error('connection lost'))) })
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.baseUrl), { target: { value: 'https://next' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText('connection lost')
    // Not stuck in `applying…`: the finally cleared busy, so Apply is live again.
    expect(screen.getByText(en.apply)).toBeTruthy()
  })

  it('surfaces a shadowed credential write on the card', async () => {
    await mountFirstRun({
      set: vi.fn(() => Promise.resolve(remoteFail('credentials: DEEPSEEK_API_KEY is shadowed by the read-only environment'))),
    })
    /** 中文说明：测试局部值 key，由紧邻初始化决定。 */
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    fireEvent.change(key, { target: { value: 'sk-live' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(/shadowed by the read-only environment/)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('locks the key input when the launch environment provides the credential', async () => {
    /** 中文说明：测试局部值 { face }，由紧邻初始化决定。 */
    const { face } = await mountSection()
    face.credentials.describe.mockImplementation((refs: string[]) => Promise.resolve(remoteOk(
      Object.fromEntries(refs.map(ref => [ref, {
        configured: ref === 'OPENAI_API_KEY', source: 'env', writable: false,
      }])),
    )))
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    /** 中文说明：测试局部值 editorKey，由紧邻初始化决定。 */
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(editorKey.placeholder).toBe(en.keyEnvLocked) })
    expect(editorKey.disabled).toBe(true)
  })

  it('keeps a failed credential describe silent and the input usable', async () => {
    /** 中文说明：测试局部值 { face, set }，由紧邻初始化决定。 */
    const { face, set } = await mountSection()
    face.credentials.describe.mockImplementation(() => Promise.resolve(remoteFail('down', 'internal')) as never)
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    /** 中文说明：测试局部值 editorKey，由紧邻初始化决定。 */
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    expect(editorKey.placeholder).toBe(en.keyPlaceholderNative)
    fireEvent.change(editorKey, { target: { value: 'sk-live' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledTimes(1) })
  })

  it('requires confirmation before removing a user-added provider', async () => {
    const { mutate, unset } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    /** 中文说明：测试局部值 dialog，由紧邻初始化决定。 */
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    expect(dialog.textContent).toContain(openaiCopy(en.deleteDescriptionWithCredential))
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: en.cancel }))
    expect(unset).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(mutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    fireEvent.click(within(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) }))
      .getByRole('button', { name: en.close }))
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(mutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    fireEvent.click(within(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) }))
      .getByRole('button', { name: openaiCopy(en.deleteConfirm) }))
    await waitFor(() => { expect(unset).toHaveBeenCalledWith('OPENAI_API_KEY') })
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(unset.mock.invocationCallOrder[0]).toBeLessThan(mutate.mock.invocationCallOrder[0] as number)
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{ op: 'unset', path: ['providers', 'openai'] }],
      undefined,
    ])
  })

  it('blocks duplicate deletion while the confirmed removal is pending', async () => {
    let resolveRemoval!: (response: { ok: true; value: SettingsNamespaceView }) => void
    const mutate = vi.fn(() => new Promise<{ ok: true; value: SettingsNamespaceView }>((resolve) => {
      resolveRemoval = resolve
    }))
    await mountSection({ mutate })
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    /** 中文说明：测试局部值 dialog，由紧邻初始化决定。 */
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    /** 中文说明：测试局部值 confirm，由紧邻初始化决定。 */
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: openaiCopy(en.deleteConfirm) })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(confirm.disabled).toBe(true)
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: en.cancel }).disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: openaiCopy(en.deleting) })).toBe(confirm)
    fireEvent.click(within(dialog).getByRole('button', { name: en.close }))
    expect(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBe(dialog)
    expect(mutate).toHaveBeenCalledOnce()
    await act(async () => { resolveRemoval(remoteOk(wireNamespaces()[2]!)) })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    })
  })

  it('renders the load failure with a retry control', async () => {
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = scriptedFace()
    face.face.llm.listProviders = vi.fn(() => Promise.resolve(remoteFail('directory down', 'internal'))) as never
    const controller = new ModelsSettingsStore(
      face.face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face.face as never))
    await controller.load()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face.face as never}
      schema={settingsSchema}
      t={t}
      renderSlot={() => null}
    />)
    expect(screen.getByText(/directory down/)).toBeTruthy()
    fireEvent.click(screen.getByText(en.retry))
    await waitFor(() => { expect(screen.queryByText(/directory down/)).toBeNull() })
  })

  it('shows the read-only notice and disables mutations for a read-only provider', async () => {
    /** 中文说明：测试局部值 { face }，由紧邻初始化决定。 */
    const { face } = await mountSection()
    face.settings.describe.mockImplementation(() => Promise.resolve(remoteOk({
      writable: false,
      hasDocument: false,
      namespaces: wireNamespaces(),
    })))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    await controller.load()
    cleanup()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
      renderSlot={() => null}
    />)
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getAllByText<HTMLButtonElement>(en.remove).every(button => button.disabled)).toBe(true)
    expect(screen.getByText<HTMLButtonElement>(en.add).disabled).toBe(true)
  })

  it('toggles the row editor closed on a second edit click and on cancel', async () => {
    const { mutate } = await mountSection()
    const edit = screen.getByRole('button', { name: openaiCopy(en.editProvider) })
    fireEvent.click(edit)
    await waitFor(() => { expect(screen.queryAllByLabelText(en.keyInput).length).toBe(1) })
    fireEvent.click(edit)
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
    fireEvent.click(edit)
    await waitFor(() => { expect(screen.queryAllByLabelText(en.keyInput).length).toBe(1) })
    fireEvent.click(screen.getByText(en.cancel))
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('cancels the add card back to the add button', async () => {
    await mountSection()
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.click(screen.getByText(en.cancel))
    await screen.findByText(en.add)
    expect(screen.queryByLabelText(en.provider)).toBeNull()
  })

  it('collapses the setup card on cancel without disturbing another open card', async () => {
    // The regression: the setup card shared the row/add/declare close handler,
    // so cancelling it discarded the add card's draft while staying open itself.
    await mountFirstRun()
    expect(screen.getAllByLabelText(en.keyInput)).toHaveLength(1)
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    expect(screen.getAllByLabelText(en.keyInput)).toHaveLength(2)

    // The setup card is the first one on the page, above the add block.
    fireEvent.click(screen.getAllByText(en.cancel)[0] as HTMLElement)
    // The add card kept its draft…
    expect(screen.getByLabelText(en.provider)).toBeTruthy()
    // …and DeepSeek collapsed to an ordinary row carrying the missing-key dot.
    expect(screen.getAllByLabelText(en.keyInput)).toHaveLength(1)
    expect(screen.getAllByRole('img', { name: en.credentialMissing })
      .some(dot => dot.closest('li')?.textContent?.includes('DeepSeek') === true)).toBe(true)
    // Its card reopens through Edit, which closes the add card as any row does.
    fireEvent.click(screen.getByRole('button', { name: deepSeekCopy(en.editProvider) }))
    expect(screen.getAllByLabelText(en.keyInput)).toHaveLength(1)
    expect(screen.queryByLabelText(en.provider)).toBeNull()
  })

  it('loads on first render of an idle controller', async () => {
    /** 中文说明：测试局部值 { face }，由紧邻初始化决定。 */
    const { face } = scriptedFace()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
      renderSlot={() => null}
    />)
    await screen.findByText('DeepSeek')
  })

  it('removes by unsetting the profile path, never by rebuilding the section', async () => {
    // The page only needs to name the profile path; rebuilding the section
    // would widen the write for no benefit.
    const { face, mutate, controller } = await mountSection()
    await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      { settingsNs: 'llm-plain', settingsPath: ['ghost-profile'] },
    )
    expect(mutate.mock.calls[0]).toEqual([
      'llm-plain',
      [{ op: 'unset', path: ['ghost-profile'] }],
      undefined,
    ])
  })

  it('keeps the snapshot untouched and reports the message when a removal write is refused', async () => {
    /** 中文说明：测试局部值 { face, controller }，由紧邻初始化决定。 */
    const { face, controller } = await mountSection({
      mutate: vi.fn(() => Promise.resolve(remoteFail('read-only', 'settings-rejected'))),
    })
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = controller.store.getSnapshot().rows
    /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
    const failure = await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
    )
    expect(failure).toBe('read-only')
    expect(controller.store.getSnapshot().rows).toBe(before)
  })

  it('keeps a failed identified deletion recoverable in its confirmation dialog', async () => {
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn()
      .mockResolvedValueOnce(remoteFail('the host refused', 'settings-rejected'))
      .mockResolvedValueOnce(remoteOk(wireNamespaces()[2]!))
    const { unset } = await mountSection({ mutate })
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    /** 中文说明：测试局部值 dialog，由紧邻初始化决定。 */
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    /** 中文说明：测试局部值 confirm，由紧邻初始化决定。 */
    const confirm = within(dialog).getByRole('button', { name: openaiCopy(en.deleteConfirm) })
    fireEvent.click(confirm)
    await within(dialog).findByText('the host refused')
    expect(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBe(dialog)
    expect(unset).toHaveBeenCalledOnce()
    expect(mutate).toHaveBeenCalledOnce()

    fireEvent.click(confirm)
    await waitFor(() => { expect(unset).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(2) })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    })
  })

  it('retains credentials that are not identified as page-managed', async () => {
    /** 中文说明：测试局部值 { unset, mutate }，由紧邻初始化决定。 */
    const { unset, mutate } = await mountSection()
    /** 中文说明：测试局部值 target，由紧邻初始化决定。 */
    const target = { provider: 'zombie', displayName: 'zombie' }
    fireEvent.click(screen.getByRole('button', { name: providerCopy(en.removeProvider, target) }))
    /** 中文说明：测试局部值 dialog，由紧邻初始化决定。 */
    const dialog = screen.getByRole('dialog', { name: providerCopy(en.deleteTitle, target) })
    expect(dialog.textContent).toContain(providerCopy(en.deleteDescription, target))
    fireEvent.click(within(dialog).getByRole('button', { name: providerCopy(en.deleteConfirm, target) }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(unset).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{ op: 'unset', path: ['providers', 'zombie'] }],
      undefined,
    ])
  })

  it('does not remove provider settings when its managed credential removal is refused', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { face, controller, mutate } = await mountSection({
      unset: vi.fn(() => Promise.resolve(remoteFail('credential is read-only'))),
    })
    /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
    const failure = await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      {
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'openai'],
        credentialRef: 'OPENAI_API_KEY',
      },
    )
    expect(failure).toBe('credential is read-only')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('reports a transport rejection instead of failing the removal silently', async () => {
    /** 中文说明：测试局部值 { face, controller }，由紧邻初始化决定。 */
    const { face, controller } = await mountSection({
      mutate: vi.fn(() => Promise.reject(new Error('connection lost'))),
    })
    /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
    const failure = await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
    )
    expect(failure).toBe('connection lost')
  })
})

describe('apiKeyFailure', () => {
  it('treats a blank field as no failure — it means keep the stored key', () => {
    expect(apiKeyFailure('')).toBeUndefined()
  })

  it.each([
    ['a printable-ASCII key', 'sk-0123456789'],
    ['a padded key, which the caller trims', '  sk-abc  '],
    ['the printable-ASCII boundary characters', '!~'],
    ['a hyphenated key carrying an equals sign', 'sk-ABC=xyz'],
    ['an all-upper-case key ending in base64 padding', 'ABCD=='],
    ['an all-upper-case key ending in one padding character', 'MNOPQRST='],
  ])('accepts %s', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBeUndefined()
  })

  it.each([
    ['spaces', '   '],
    ['a tab', '\t'],
  ])('fails a field holding only %s instead of silently dropping it', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyBlank')
  })

  it.each([
    ['an emoji', 'sk-\u{1F600}'],
    ['CJK text', 'sk-你好'],
    ['full-width punctuation', 'sk-abc，'],
    ['an interior space', 'sk-abc def'],
    ['a C0 control character', 'sk-abc\x01'],
    ['a latin-1 character', 'sk-café'],
  ])('fails %s as illegal characters', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyIllegalCharacters')
  })

  it.each([
    ['a pasted environment line', 'DEEPSEEK_API_KEY=sk-abc'],
    ['double quotes', '"sk-abc"'],
    ['single quotes', '\'sk-abc\''],
    ['backticks', '`sk-abc`'],
  ])('fails %s as a format failure', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyIllegalCharacters')
  })

  it('needs a matching closing quote before it calls a value wrapped', () => {
    // A lone quote and an unbalanced one are legal printable ASCII, so the
    // heuristic leaves them alone rather than guessing at a paste error.
    expect(apiKeyFailure('"')).toBeUndefined()
    expect(apiKeyFailure('"a')).toBeUndefined()
  })
})
