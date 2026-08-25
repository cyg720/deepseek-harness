/**
 * 文件职责：验证模型设置的 welcome-store.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、表单事件和 API 替身。
 * 产品维度：防止模型设置保存、发现和错误提示回归。
 * 逻辑维度：构造配置状态，触发操作并断言请求与界面。
 * 关键边界：敏感值不得意外回显；异步发现和保存必须清理。
 * 新手阅读建议：先读状态夹具，再按加载、编辑、保存场景阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { Context } from '@deepseek-ai/cordis'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsScopeController } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-scope.ts'
import { decodeWelcomeSection, WelcomeNoticeStore } from '../src/client/welcome-store.ts'
import {
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_SETTINGS_NAMESPACE, WELCOME_NOTICE_VERSION,
} from '../src/onboarding-copy.ts'

/** 中文说明：测试局部值 schemaService，由紧邻初始化决定。 */
const schemaService = new SettingsSchemaService(new Context())

/** 中文说明：测试局部值 rpc，由紧邻初始化决定。 */
let rpc = 0
/** 中文说明：函数 ok 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `welcome-${rpc++}` as never, result: { ok: true, value } }
}

/** 中文说明：函数 namespace 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function namespace(value: unknown = {}, revision = 0) {
  return {
    ns: WELCOME_NOTICE_SETTINGS_NAMESPACE,
    schema: {},
    value,
    applies: 'live' as const,
    secrets: [],
    revision,
  }
}

/** 中文说明：函数 acknowledgedNamespace 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function acknowledgedNamespace(version: string, revision = 1) {
  return namespace({ [WELCOME_NOTICE_ACK_FIELD]: version }, revision)
}

/** The welcome store over a real mirror-derived scope and a fake wire. */
/* 中文说明：函数 buildWelcome 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function buildWelcome(
  api: { describe?: ReturnType<typeof vi.fn>; mutate?: ReturnType<typeof vi.fn> },
  persistence: 'host' | 'memory' = 'host',
) {
  /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
  const wire = { settings: api } as never
  /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
  const mirror = new SettingsDescribeMirror(wire, persistence)
  /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
  const scope = new SettingsScopeController(
    wire,
    { namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE, decode: decodeWelcomeSection },
    mirror,
    persistence,
    schemaService,
  )
  return { mirror, controller: new WelcomeNoticeStore(scope) }
}

describe('WelcomeNoticeStore', () => {
  it('acknowledges in memory without calling loopback-only settings APIs', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn()
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = buildWelcome({ describe: describeCall, mutate }, 'memory')

    await controller.load()
    expect(controller.store.getSnapshot()).toEqual({ status: 'ready', acknowledged: false, error: null })
    await expect(controller.acknowledge()).resolves.toBe(true)
    expect(controller.store.getSnapshot()).toEqual({ status: 'ready', acknowledged: true, error: null })
    await controller.load()
    expect(controller.store.getSnapshot()).toEqual({ status: 'ready', acknowledged: true, error: null })
    expect(describeCall).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('acknowledges only the exact current copy version', async () => {
    /** 中文说明：测试局部值 [version，由紧邻初始化决定。 */
    for (const [version, acknowledged] of [
      [undefined, false],
      ['older-copy', false],
      [WELCOME_NOTICE_VERSION, true],
    ] as const) {
      /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
      const describeCall = vi.fn(() => Promise.resolve(ok({
        writable: true,
        hasDocument: false,
        namespaces: [version === undefined ? namespace() : acknowledgedNamespace(version)],
      })))
      /** 中文说明：测试局部值 { mirror, controller }，由紧邻初始化决定。 */
      const { mirror, controller } = buildWelcome({ describe: describeCall })
      await mirror.load()
      await controller.load()
      expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', acknowledged })
    }
  })

  it('persists the owner version through one revision-fenced mutation', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn(() => Promise.resolve(ok({
      writable: true, hasDocument: false, namespaces: [namespace({}, 3)],
    })))
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn(() => Promise.resolve(ok(acknowledgedNamespace(WELCOME_NOTICE_VERSION, 4))))
    /** 中文说明：测试局部值 { mirror, controller }，由紧邻初始化决定。 */
    const { mirror, controller } = buildWelcome({ describe: describeCall, mutate })
    await mirror.load()
    await controller.load()
    await expect(controller.acknowledge()).resolves.toBe(true)
    expect(mutate).toHaveBeenCalledWith({
      ns: WELCOME_NOTICE_SETTINGS_NAMESPACE,
      ops: [{ op: 'set', path: [WELCOME_NOTICE_ACK_FIELD], value: WELCOME_NOTICE_VERSION }],
      expectedRevision: 3,
    })
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: true })
    // The write answer folded into the mirror; no re-read followed.
    expect(describeCall).toHaveBeenCalledTimes(1)
  })

  it('keeps the notice pending while the settings read has not answered', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn(() => Promise.reject(new Error('offline')))
    /** 中文说明：测试局部值 { mirror, controller }，由紧邻初始化决定。 */
    const { mirror, controller } = buildWelcome({ describe: describeCall })
    await mirror.load()
    await controller.load()
    // No answer stands, so the step renders nothing and never acknowledges.
    expect(controller.store.getSnapshot()).toEqual({ status: 'loading', acknowledged: false, error: null })
  })

  it('reports a failed or refused persistence attempt after its recovery read', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn(() => Promise.resolve(ok({
      writable: true, hasDocument: false, namespaces: [namespace()],
    })))
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn(() => Promise.reject(new Error('disk full')))
    /** 中文说明：测试局部值 { mirror, controller }，由紧邻初始化决定。 */
    const { mirror, controller } = buildWelcome({ describe: describeCall, mutate })
    await mirror.load()
    await controller.load()
    await expect(controller.acknowledge()).resolves.toBe(false)
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'error',
      acknowledged: false,
      error: 'the acknowledgement did not persist',
    })
    // The failed latest write triggered one mirror recovery read.
    expect(describeCall).toHaveBeenCalledTimes(2)
  })

  it('reports a missing namespace as an error instead of a silent skip', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn(() => Promise.resolve(ok({
      writable: true, hasDocument: false, namespaces: [],
    })))
    /** 中文说明：测试局部值 { mirror, controller }，由紧邻初始化决定。 */
    const { mirror, controller } = buildWelcome({ describe: describeCall })
    await mirror.load()
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'welcome acknowledgement settings are unavailable',
    })
  })

  it('reads malformed durable values as unacknowledged', async () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    for (const value of [null, 42, { [WELCOME_NOTICE_ACK_FIELD]: 42 }]) {
      /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
      const describeCall = vi.fn(() => Promise.resolve(ok({
        writable: true, hasDocument: false, namespaces: [namespace(value)],
      })))
      /** 中文说明：测试局部值 { mirror, controller }，由紧邻初始化决定。 */
      const { mirror, controller } = buildWelcome({ describe: describeCall })
      await mirror.load()
      await controller.load()
      expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: false })
    }
  })

  it('follows a later document change without an own read', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: false, namespaces: [namespace()] }))
      .mockResolvedValueOnce(ok({
        writable: true, hasDocument: false,
        namespaces: [acknowledgedNamespace(WELCOME_NOTICE_VERSION)],
      }))
    /** 中文说明：测试局部值 { mirror, controller }，由紧邻初始化决定。 */
    const { mirror, controller } = buildWelcome({ describe: describeCall })
    await mirror.load()
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ acknowledged: false })
    await mirror.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: true })
  })
})
