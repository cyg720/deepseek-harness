// @vitest-environment jsdom
/*
 * 文件职责：验证模型设置的 onboarding-dialog.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、表单事件和 API 替身。
 * 产品维度：防止模型设置保存、发现和错误提示回归。
 * 逻辑维度：构造配置状态，触发操作并断言请求与界面。
 * 关键边界：敏感值不得意外回显；异步发现和保存必须清理。
 * 新手阅读建议：先读状态夹具，再按加载、编辑、保存场景阅读。
 */
/** First-run DeepSeek prompt behavior over the shared Models join. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { JsonValue, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { DeepSeekOnboardingDialog } from '../src/client/DeepSeekOnboardingDialog.tsx'
import type { DeepSeekOnboardingDialogProps } from '../src/client/DeepSeekOnboardingDialog.tsx'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

/** Credentials answers over the Remote carrier, which has no envelope. */
function remoteOk<T>(value: T) {
  return { ok: true as const, value }
}
function remoteFail(message: string) {
  return { ok: false as const, error: { code: 'internal', message, details: {} } }
}

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
  })),
})

type AttentionSnapshot = Parameters<Parameters<DeepSeekOnboardingDialogProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: DeepSeekOnboardingDialogProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function deepSeekNamespace(apiKeyEnv: string | null): SettingsNamespaceView {
  /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
  const value = apiKeyEnv === null ? {} : { apiKeyEnv }
  return {
    ns: 'llm-deepseek',
    schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
    value,
    base: value,
    user: {},
    applies: 'live',
    secrets: [],
    revision: 0,
  }
}

/** 中文说明：函数 harness 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function harness(options: {
  provider?: boolean
  providerSettingsNs?: string
  providerActive?: boolean
  settingsNamespace?: boolean
  apiKeyEnv?: string | null
  configured?: () => boolean
  credential?: { source?: string; writable: boolean }
  describeFailure?: string
  settingsWritable?: boolean
  providersReject?: boolean
  setFailure?: string
  setReject?: string
} = {}) {
  if (document.getElementById('root') === null) {
    /** 中文说明：测试局部值 appRoot，由紧邻初始化决定。 */
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
  }
  /** 中文说明：测试局部值 fileConfigured，由紧邻初始化决定。 */
  let fileConfigured = false
  /** 中文说明：测试局部值 configured，由紧邻初始化决定。 */
  const configured = options.configured ?? (() => fileConfigured)
  /** 中文说明：测试局部值 apiKeyEnv，由紧邻初始化决定。 */
  const apiKeyEnv = options.apiKeyEnv === undefined ? 'DEEPSEEK_API_KEY' : options.apiKeyEnv
  const mutate = vi.fn(() => Promise.resolve(remoteOk(deepSeekNamespace(apiKeyEnv))))
  const set = vi.fn((_ref: string, _value: string) => {
    if (options.setReject !== undefined) return Promise.reject(new Error(options.setReject))
    if (options.setFailure !== undefined) return Promise.resolve(remoteFail(options.setFailure))
    fileConfigured = true
    return Promise.resolve(remoteOk(undefined))
  })
  /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
  const face = {
    llm: {
      listProviders: () => {
        if (options.providersReject === true) return Promise.reject(new Error('provider transport unavailable'))
        return Promise.resolve(remoteOk(
          options.provider === false || options.providerActive === false
            ? []
            : [{ id: 'deepseek-official', name: 'DeepSeek' }],
        ))
      },
      listConfigurableProviders: () => Promise.resolve(remoteOk(
        options.provider === false
          ? []
          : [{
            provider: 'deepseek-official',
            displayName: 'DeepSeek',
            settingsNs: options.providerSettingsNs ?? 'llm-deepseek',
            settingsPath: [],
          }],
      )),
      discoverModels: () => Promise.resolve(remoteOk([])),
    },
    settings: {
      describe: () => Promise.resolve(remoteOk({
        writable: options.settingsWritable ?? true,
        hasDocument: false,
        namespaces: options.settingsNamespace === false ? [] : [deepSeekNamespace(apiKeyEnv)],
      })),
      mutate,
    },
    credentials: {
      describe: () => options.describeFailure === undefined
        ? Promise.resolve(remoteOk({
          DEEPSEEK_API_KEY: {
            configured: configured(),
            ...configured() && options.credential?.source !== undefined
              ? { source: options.credential.source }
              : {},
            writable: options.credential?.writable ?? true,
          },
        }))
        : Promise.resolve(remoteFail(options.describeFailure)),
      set,
    },
  }
  /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
  const controller = new ModelsSettingsStore(face as never, settingsSchema, new SettingsDescribeMirror(face as never))
  /** 中文说明：测试局部值 openSection，由紧邻初始化决定。 */
  const openSection = vi.fn()
  /** 中文说明：测试局部值 complete，由紧邻初始化决定。 */
  const complete = vi.fn()
  /** 中文说明：测试局部值 unusedHook，由紧邻初始化决定。 */
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
  const props: DeepSeekOnboardingDialogProps = {
    stepId: 'deepseek-official',
    complete,
    openSection,
    useSessions: unusedHook,
    useSessionPendingInteraction,
    useWorkspaces: unusedHook,
    controller,
    useModels: bindSnapshotSelector(controller.store),
    api: face as never,
    schema: settingsSchema,
    t: key => en[key],
  }
  return {
    controller, complete, openSection, props, mutate, set,
    configure: () => { fileConfigured = true },
  }
}

describe('DeepSeekOnboardingDialog', () => {
  it('renders when the shell root is absent', async () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = harness()
    document.getElementById('root')!.remove()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    expect(await screen.findByRole('dialog', { name: en.onboardingTitle })).toBeTruthy()
  })

  it('loads a credential-only modal, inerts the product, and focuses the key', async () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    expect(await screen.findByRole('dialog', { name: en.onboardingTitle })).toBeTruthy()
    expect(document.getElementById('root')?.inert).toBe(true)
    expect(screen.getByText(en.onboardingDescription)).toBeTruthy()
    /** 中文说明：测试局部值 key，由紧邻初始化决定。 */
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(document.activeElement).toBe(key) })
    expect(screen.queryByText(en.customized)).toBeNull()
  })

  it('cannot be dismissed implicitly and restores the previous inert state', async () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = harness()
    /** 中文说明：测试局部值 appRoot，由紧邻初始化决定。 */
    const appRoot = document.getElementById('root')!
    appRoot.inert = true
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('[class*="mask"]')!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(h.complete).not.toHaveBeenCalled()

    view.unmount()
    expect(appRoot.inert).toBe(true)
  })

  it('requires a non-blank key before Save and continue is available', async () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    /** 中文说明：测试局部值 save，由紧邻初始化决定。 */
    const save = screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingSave })
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: '   ' } })
    expect(save.disabled).toBe(true)
    expect(screen.getByText(en.keyRequired)).toBeTruthy()
    expect(h.set).not.toHaveBeenCalled()
  })

  it('keeps the modal open and reports rejected and failed credential writes', async () => {
    /** 中文说明：测试局部值 [options，由紧邻初始化决定。 */
    for (const [options, message] of [
      [{ setFailure: 'credential was rejected' }, 'credential was rejected'],
      [{ setReject: 'connection lost' }, 'connection lost'],
    ] as const) {
      /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
      const h = harness(options)
      /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await screen.findByRole('dialog')
      fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'sk-live' } })
      fireEvent.click(screen.getByRole('button', { name: en.onboardingSave }))
      expect(await screen.findByText(message)).toBeTruthy()
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByRole<HTMLButtonElement>('button', { name: en.onboardingSave }).disabled).toBe(false)
      expect(h.complete).not.toHaveBeenCalled()
      expect(h.mutate).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('allows configure-later dismissal without opening settings', async () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: en.onboardingLater }))
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.openSection).not.toHaveBeenCalled()
    expect(h.set).not.toHaveBeenCalled()
    expect(h.mutate).not.toHaveBeenCalled()
  })

  it('does not block the product when DeepSeek setup is unavailable', async () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    for (const h of [
      harness({ describeFailure: 'credentials service is absent' }),
      harness({ credential: { writable: false } }),
      harness({ settingsWritable: false }),
      harness({ providersReject: true }),
      harness({ providerActive: false }),
      harness({ settingsNamespace: false }),
      harness({ apiKeyEnv: null }),
    ]) {
      /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      expect(h.openSection).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('skips an absent adapter and an already-configured environment credential', async () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    for (const h of [
      harness({ provider: false }),
      harness({ providerSettingsNs: '' }),
      harness({ configured: () => true, credential: { source: 'env', writable: false } }),
    ]) {
      /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
      const view = render(<DeepSeekOnboardingDialog {...h.props} />)
      await act(async () => { await h.controller.load() })
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
      view.unmount()
    }
  })

  it('closes when an external credential invalidation refreshes the shared join', async () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = harness()
    render(<DeepSeekOnboardingDialog {...h.props} />)
    await screen.findByRole('dialog')
    h.configure()
    await act(async () => { await h.controller.load() })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(h.complete).toHaveBeenCalledOnce()
  })
})
