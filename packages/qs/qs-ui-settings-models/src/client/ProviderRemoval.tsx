/** 删除用户配置前展示目标；凭据是独立资源，只有明确选择后才移除。 */
import { useEffect, useRef, useState } from 'react'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsOperations, ProviderRow } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { zh } from './locales.ts'
import css from './models.module.css'

/** 删除卡片仅接受官方目录中可移除的用户配置。 */
export interface ProviderRemovalProps {
  readonly row: ProviderRow
  readonly rows: readonly ProviderRow[]
  readonly namespace: SettingsNamespaceView
  readonly operations: ModelsOperations
  readonly readOnly: boolean
  readonly t: (key: keyof typeof zh) => string
  /** @param changed - 配置或明确选择的凭据是否已经移除，需要刷新目录。 */
  readonly onClose: (changed: boolean) => void
}

/**
 * 确认后先处理选中的凭据，再按版本移除用户配置；失败保留重试入口。
 * @param props - 当前目录、命名空间版本和官方写操作。
 * @returns 供应商卡内的确认区域。
 */
export function ProviderRemoval({ row, rows, namespace, operations, readOnly, t, onClose }: ProviderRemovalProps) {
  const [withKey, setWithKey] = useState(false), [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<keyof typeof zh>()
  const lifetime = useRef({ active: true, pending: false, keyRemoved: false })
  useEffect(() => {
    const scope = { active: true, pending: false, keyRemoved: lifetime.current.keyRemoved }
    lifetime.current = scope
    return () => { scope.active = false }
  }, [])
  const derived = `${row.entry.provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
  const shared = rows.some(other => other.entry.provider !== row.entry.provider && other.apiKeyEnv === derived)
  const removableKey = row.apiKeyEnv === derived && row.credential?.configured === true && row.credential.writable && !shared
  const confirm = async (): Promise<void> => {
    const scope = lifetime.current
    if (scope.pending || readOnly || !row.removable) return
    scope.pending = true; setBusy(true); setFailure(undefined)
    try {
      if (withKey && removableKey && !scope.keyRemoved) {
        let error: string | undefined
        // 凭据拒绝仅显示本地化结果，不向 UI 泄露服务诊断原文。
        try { error = await operations.removeCredential(derived) }
        catch { if (scope.active) setFailure('removeKeyFailed'); return }
        if (!scope.active) return
        if (error !== undefined) { setFailure('removeKeyFailed'); return }
        scope.keyRemoved = true
      }
      let result: Awaited<ReturnType<ModelsOperations['writeSettings']>>
      // 精确 unset 用户配置路径，不根据脱敏描述符重建整个命名空间。
      try { result = await operations.writeSettings(namespace.ns, [{ op: 'unset', path: [...row.entry.settingsPath] }], namespace.revision) }
      catch { if (scope.active) setFailure(scope.keyRemoved ? 'removePartial' : 'removeFailed'); return }
      if (!scope.active) return
      if (result.kind !== 'written') {
        setFailure(scope.keyRemoved ? 'removePartial' : result.kind === 'conflict' ? 'conflict' : 'removeFailed')
        return
      }
      onClose(true)
    } finally {
      scope.pending = false
      if (scope.active) setBusy(false)
    }
  }
  return <form className={css.editor} aria-label={t('removeConfirm')}
    onSubmit={(event) => { event.preventDefault(); void confirm() }}>
    <p>{t('removeConfirm')}: <strong>{row.entry.displayName}</strong> <code>{row.entry.provider}</code></p>
    <p>{t('removeHint')}</p>
    {removableKey && <label><input type="checkbox" checked={withKey} disabled={busy || lifetime.current.keyRemoved}
      onChange={(event) => { setWithKey(event.target.checked) }} />{t('removeKey')} <code>{derived}</code></label>}
    {shared && <p>{t('sharedKey')}</p>}
    {failure !== undefined && <p role="alert">{t(failure)}</p>}
    <div className={css.actions}>
      <button className="qs-btn" type="button" disabled={busy} onClick={() => { onClose(lifetime.current.keyRemoved) }}>{t('cancel')}</button>
      <button className="qs-btn" type="submit" disabled={busy || readOnly || !row.removable}>{t(busy ? 'removing' : 'confirmRemove')}</button>
    </div>
  </form>
}
