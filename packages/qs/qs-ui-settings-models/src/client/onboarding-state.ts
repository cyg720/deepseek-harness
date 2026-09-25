/** 首次配置使用官方目录的就绪规则；已有任意可用供应商便不再要求 DeepSeek 密钥。 */
import type { ModelsSettingsState, ProviderRow } from '@deepseek-ai/dsh-client-ui-settings-models/client'
/** 引导等待、跳过或需要填写凭据的状态。 */
export type CredentialStep = 'loading' | 'skip' | ProviderRow
/**
 * 从唯一模型目录快照判断是否需要首次配置。
 * @param state - 官方控制器发布的供应商和凭据状态。
 * @returns 等待、跳过，或需补充凭据的官方 DeepSeek 路线。
 */
export function credentialStep(state: ModelsSettingsState): CredentialStep {
  if ((state.status === 'idle' || state.status === 'loading') && state.rows.length === 0) return 'loading'
  if (state.status === 'error' || state.rows.some(row => row.entry.active
    && (row.apiKeyEnv === undefined || row.credential?.configured === true))) return 'skip'
  const row = state.rows.find(candidate => candidate.entry.provider === 'deepseek-official'
    && candidate.entry.settingsNs === 'llm-deepseek' && candidate.entry.settingsPath.length === 0)
  if (row === undefined || !row.entry.active || state.credentialError !== null
    || row.credential === undefined || !state.writable || !row.credential.writable) return 'skip'
  return row
}
