/** Pure first-run readiness projection over the shared Models join. */
/*
 * 文件职责：验证模型设置的 readiness.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、表单事件和 API 替身。
 * 产品维度：防止模型设置保存、发现和错误提示回归。
 * 逻辑维度：构造配置状态，触发操作并断言请求与界面。
 * 关键边界：敏感值不得意外回显；异步发现和保存必须清理。
 * 新手阅读建议：先读状态夹具，再按加载、编辑、保存场景阅读。
 */
import { describe, expect, it } from 'vitest'
import type { CredentialView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsSettingsState, ProviderRow } from '../src/client/store.ts'
import { onboardingReadiness, providerUsable } from '../src/client/store.ts'

/** 中文说明：测试局部值 missingCredential，由紧邻初始化决定。 */
const missingCredential: CredentialView = { configured: false, writable: true }

/** 中文说明：函数 row 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function row(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    entry: {
      provider: 'deepseek-official',
      displayName: 'DeepSeek',
      settingsNs: 'llm-deepseek',
      settingsPath: [],
      active: true,
    },
    configured: true,
    removable: false,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    credential: missingCredential,
    ...overrides,
  }
}

/** A second provider the user configured themselves. */
/* 中文说明：函数 otherRow 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function otherRow(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    entry: {
      provider: 'hfai',
      displayName: 'HFAI',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'hfai'],
      active: true,
    },
    configured: true,
    removable: true,
    apiKeyEnv: 'HFAI_API_KEY',
    credential: { configured: true, source: 'file', writable: true },
    ...overrides,
  }
}

/** 中文说明：函数 state 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function state(overrides: Partial<ModelsSettingsState> = {}): ModelsSettingsState {
  return {
    status: 'ready',
    error: null,
    credentialError: null,
    writable: true,
    rows: [row()],
    namespaces: new Map(),
    ...overrides,
  }
}

describe('providerUsable', () => {
  it('requires a registered route and a stored key for every named reference', () => {
    expect(providerUsable(otherRow())).toBe(true)
    expect(providerUsable(otherRow({ entry: { ...otherRow().entry, active: false } }))).toBe(false)
    expect(providerUsable(otherRow({ credential: missingCredential }))).toBe(false)
    expect(providerUsable(otherRow({ credential: undefined }))).toBe(false)
  })

  it('treats a reference-free registered route as provider-native authentication', () => {
    expect(providerUsable(otherRow({ apiKeyEnv: undefined, credential: undefined }))).toBe(true)
  })
})

describe('onboardingReadiness', () => {
  it('waits for the first join and skips onboarding when the adapter directory entry is absent', () => {
    expect(onboardingReadiness(state({ status: 'idle', rows: [] }))).toEqual({ kind: 'loading' })
    expect(onboardingReadiness(state({ status: 'loading', rows: [] }))).toEqual({ kind: 'loading' })
    expect(onboardingReadiness(state({ rows: [] }))).toEqual({ kind: 'adapter-absent' })
    expect(onboardingReadiness(state({
      rows: [row({
        entry: {
          ...row().entry,
          settingsNs: '',
        },
      })],
    }))).toEqual({ kind: 'adapter-absent' })
  })

  it('reports a missing writable effective credential', () => {
    expect(onboardingReadiness(state())).toEqual({ kind: 'credential-missing' })
  })

  it('ends onboarding once any other registered provider can serve requests', () => {
    expect(onboardingReadiness(state({ rows: [row(), otherRow()] }))).toEqual({ kind: 'provider-ready' })
    // A provider the user cannot reach yet leaves the prompt in place.
    expect(onboardingReadiness(state({
      rows: [row(), otherRow({ credential: missingCredential })],
    }))).toEqual({ kind: 'credential-missing' })
  })

  it('accepts file and process-environment credentials without prompting', () => {
    expect(onboardingReadiness(state({
      rows: [row({ credential: { configured: true, source: 'file', writable: true } })],
    }))).toEqual({ kind: 'provider-ready' })
    expect(onboardingReadiness(state({
      rows: [row({ credential: { configured: true, source: 'env', writable: false } })],
    }))).toEqual({ kind: 'provider-ready' })
  })

  it('turns missing capabilities into diagnostics that never block the product', () => {
    expect(onboardingReadiness(state({ status: 'error', error: 'settings down' }))).toEqual({
      kind: 'unavailable',
      reason: 'load-failed',
    })
    expect(onboardingReadiness(state({
      rows: [row({ entry: { ...row().entry, active: false } })],
    }))).toEqual({ kind: 'unavailable', reason: 'provider-inactive' })
    expect(onboardingReadiness(state({
      credentialError: 'credentials service is absent',
    }))).toEqual({
      kind: 'unavailable',
      reason: 'credentials-unavailable',
    })
    expect(onboardingReadiness(state({
      rows: [row({ credential: undefined })],
    }))).toEqual({ kind: 'unavailable', reason: 'credentials-unavailable' })
    expect(onboardingReadiness(state({
      rows: [row({ credential: { configured: false, writable: false } })],
    }))).toEqual({ kind: 'unavailable', reason: 'credential-read-only' })
    expect(onboardingReadiness(state({ writable: false }))).toEqual({
      kind: 'unavailable',
      reason: 'settings-read-only',
    })
  })
})
