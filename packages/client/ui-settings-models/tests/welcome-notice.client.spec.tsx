// @vitest-environment jsdom
/**
 * 文件职责：验证模型设置的 welcome-notice.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、表单事件和 API 替身。
 * 产品维度：防止模型设置保存、发现和错误提示回归。
 * 逻辑维度：构造配置状态，触发操作并断言请求与界面。
 * 关键边界：敏感值不得意外回显；异步发现和保存必须清理。
 * 新手阅读建议：先读状态夹具，再按加载、编辑、保存场景阅读。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { Context } from '@deepseek-ai/cordis'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsScopeController } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-scope.ts'

/** Stateless schema service for scope construction in this jsdom fixture. */
/* 中文说明：测试局部值 schemaService，由紧邻初始化决定。 */
const schemaService = new SettingsSchemaService(new Context())
import { WelcomeNotice } from '../src/client/WelcomeNotice.tsx'
import type { WelcomeNoticeProps } from '../src/client/WelcomeNotice.tsx'
import { decodeWelcomeSection, WelcomeNoticeStore } from '../src/client/welcome-store.ts'
import type { WelcomeSection } from '../src/client/welcome-store.ts'
import { en, zh } from '../src/client/locales.ts'
import {
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_SETTINGS_NAMESPACE,
  WELCOME_NOTICE_VERSION,
} from '../src/onboarding-copy.ts'

const WELCOME_NOTICE_COPY = {
  en: { title: en.welcomeTitle, body: en.welcomeBody, continueLabel: en.welcomeContinue },
  zh: { title: zh.welcomeTitle, body: zh.welcomeBody, continueLabel: zh.welcomeContinue },
}

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

/** The settings namespace answers over the Remote carrier, which has no envelope. */
function remoteAnswer<T>(value: T) {
  return { ok: true as const, value }
}

/** 中文说明：函数 welcomeView 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function welcomeView(value: unknown, revision = 0) {
  return {
    ns: WELCOME_NOTICE_SETTINGS_NAMESPACE,
    schema: {},
    value,
    base: {},
    user: {},
    applies: 'live' as const,
    secrets: [],
    revision,
  }
}

type AttentionSnapshot = Parameters<Parameters<WelcomeNoticeProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: WelcomeNoticeProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount(
  version?: string,
  mutateImpl: () => Promise<unknown> = () =>
    Promise.resolve(remoteAnswer(welcomeView({ [WELCOME_NOTICE_ACK_FIELD]: WELCOME_NOTICE_VERSION }, 1))),
) {
  /** 中文说明：测试局部值 appRoot，由紧邻初始化决定。 */
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)
  /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
  const mutate = vi.fn(mutateImpl)
  /** 中文说明：测试局部值 api，由紧邻初始化决定。 */
  const api = {
    settings: {
      describe: () => Promise.resolve(remoteAnswer({
        writable: true,
        hasDocument: false,
        namespaces: [welcomeView(version === undefined ? {} : { [WELCOME_NOTICE_ACK_FIELD]: version })],
      })),
      mutate,
    },
  }
  /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
  const mirror = new SettingsDescribeMirror(api as never)
  /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
  const scope = new SettingsScopeController<WelcomeSection>(
    api as never,
    { namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE, decode: decodeWelcomeSection },
    mirror,
    'host',
    schemaService,
  )
  /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
  const controller = new WelcomeNoticeStore(scope)
  void mirror.load()
  /** 中文说明：测试局部值 complete，由紧邻初始化决定。 */
  const complete = vi.fn()
  /** 中文说明：测试局部值 unusedHook，由紧邻初始化决定。 */
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
  const props: WelcomeNoticeProps = {
    stepId: 'welcome-notice',
    complete,
    openSection: vi.fn(),
    useSessions: unusedHook,
    useSessionPendingInteraction,
    useWorkspaces: unusedHook,
    controller,
    useWelcome: bindSnapshotSelector(controller.store),
    t: key => zh[key],
  }
  return { ...render(<WelcomeNotice {...props} />), complete, controller, mirror, mutate, appRoot }
}

describe('WelcomeNotice', () => {
  it('uses the exact owner copy in both GUI locales', () => {
    expect(WELCOME_NOTICE_COPY.en).toEqual({
      title: 'Internal Testing Notice',
      body: "DeepSeek Harness 0.1 remains in testing for Harness developers. Many areas need further improvement, and we welcome feedback from the developer community. DeepSeek Harness's core plugins and foundational APIs will continue to evolve rapidly over the coming months.\n\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure. We welcome Harness developers everywhere to join the DSH plugin ecosystem.",
      continueLabel: 'Continue',
    })
    expect(en.welcomeBody).toBe(WELCOME_NOTICE_COPY.en.body)
    expect(zh.welcomeBody).toBe(WELCOME_NOTICE_COPY.zh.body)
  })

  it('renders one blocking modal action and focuses the title', async () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = mount()
    /** 中文说明：测试局部值 dialog，由紧邻初始化决定。 */
    const dialog = await screen.findByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    /** 中文说明：测试局部值 paragraph，由紧邻初始化决定。 */
    for (const paragraph of WELCOME_NOTICE_COPY.zh.body.split('\n\n')) {
      expect(screen.getByText(paragraph, { exact: true })).toBeTruthy()
    }
    expect(dialog.querySelectorAll('p')).toHaveLength(2)
    expect(dialog.querySelectorAll('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: WELCOME_NOTICE_COPY.zh.title }))
    expect(h.appRoot.inert).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.querySelector('[class*="mask"]')!)
    expect(h.complete).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('completes only after the acknowledgement write commits', async () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = mount()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }))
    await act(async () => { await Promise.resolve() })
    expect(h.mutate).toHaveBeenCalledOnce()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('skips itself when this exact version was already acknowledged', async () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = mount(WELCOME_NOTICE_VERSION)
    await act(async () => {
      await h.mirror.load()
      await h.controller.load()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('keeps the sole action disabled while saving and reports a refused write', async () => {
    /** 中文说明：测试局部值 resolveWrite，由紧邻初始化决定。 */
    let resolveWrite!: (value: unknown) => void
    /** 中文说明：测试局部值 write，由紧邻初始化决定。 */
    const write = new Promise<unknown>((resolve) => { resolveWrite = resolve })
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = mount(undefined, () => write)
    await screen.findByRole('dialog')
    /** 中文说明：测试局部值 action，由紧邻初始化决定。 */
    const action = screen.getByRole<HTMLButtonElement>('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel })
    fireEvent.click(action)
    expect(action.disabled).toBe(true)
    resolveWrite({
      rpcId: 'welcome-refused' as never,
      result: {
        ok: false,
        error: {
          code: 'settings-rejected',
          message: 'read only',
          details: { ns: WELCOME_NOTICE_SETTINGS_NAMESPACE },
        },
      },
    })
    expect((await screen.findByRole('alert')).textContent).toBe(zh.welcomeError)
    expect(h.complete).not.toHaveBeenCalled()
  })
})
