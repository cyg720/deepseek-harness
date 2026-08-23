/**
 * ================================ 文件注释 ================================
 * 【文件职责】欢迎通知状态：从欢迎设置作用域派生；协调"宿主持久确认"与
 *             "远端浏览器进程本地回退"两种持久化。
 * 【技术维度】SnapshotStore + SettingsScope：回环浏览器跟随持久宿主段，
 *             远端浏览器的 memory 模式永不作答，确认保持进程本地。
 * 【产品维度】首次运行欢迎页的"已读确认"持久化。
 * 【逻辑维度】load 跟随作用域 → derive 按模式/状态推导 → acknowledge 写版本号
 *             （memory 模式只置本地位）→ 以写后状态判定成功。
 * 【关键边界】判定成功看写后留下的状态；拒绝或失败写入在恢复读取后报 false。
 * 【新手阅读建议】先看 derive 的分支（memory/loading/unavailable/ready），再看 acknowledge。
 * ==========================================================================
 */
/**
 * Welcome-notice state derived from the welcome settings scope. The scope is
 * the transport: a loopback browser follows the durable Host section, while a
 * remote browser's memory-mode scope never answers and the acknowledgement
 * stays process-local here.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_VERSION,
} from '../onboarding-copy.ts'

/** State rendered by the welcome step. */
export interface WelcomeNoticeState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  acknowledged: boolean
  error: string | null
}

/** The welcome section as the notice reads it. */
export type WelcomeSection = Record<string, unknown>

/**
 * Accept any object section verbatim; a malformed durable value reads as an
 * empty section, so the notice treats it as unacknowledged instead of leaving
 * the scope stuck on its previous value.
 * @param section - the wire section value.
 * @returns the section object, or an empty one for non-object values.
 */
export function decodeWelcomeSection(section: unknown): WelcomeSection {
  return typeof section === 'object' && section !== null && !Array.isArray(section)
    ? section as WelcomeSection
    : {}
}

/* v8 ignore next 3 -- closed-union default only defends future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected welcome settings status')
}

/** Coordinates durable Host acknowledgement or a process-local remote fallback. */
export class WelcomeNoticeStore {
  /** uSES-safe state source shared by the registered welcome step. */
  readonly store: SnapshotStore<WelcomeNoticeState> = createSnapshotStore<WelcomeNoticeState>({
    status: 'idle', acknowledged: false, error: null,
  })

  private localAcknowledged = false
  private saving = false
  private following: (() => void) | undefined

  /**
   * @param scope - the welcome settings namespace scope; its memory mode is
   * what keeps a remote browser process-local.
   */
  constructor(private readonly scope: SettingsScope<WelcomeSection>) {}

  /**
   * Begin following the bound scope (idempotent) and publish its current answer.
   * @returns settlement after the current answer is published.
   */
  load(): Promise<void> {
    this.following ??= this.scope.subscribe(() => { this.derive() })
    this.derive()
    return Promise.resolve()
  }

  /**
   * Persist this copy version, or advance only this process for a remote
   * browser. Success is judged against the state the write left behind, so a
   * refused or failed write reports false after its recovery read settles.
   * @returns true when the selected persistence mode holds the acknowledgement.
   */
  async acknowledge(): Promise<boolean> {
    if (this.scope.getSnapshot().mode === 'memory') {
      this.localAcknowledged = true
      this.derive()
      return true
    }
    this.saving = true
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      await this.scope.set(WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_VERSION)
    } finally {
      this.saving = false
    }
    this.derive()
    const { acknowledged } = this.store.getSnapshot()
    if (!acknowledged) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = 'the acknowledgement did not persist'
      })
    }
    return acknowledged
  }

  /** Stop following the scope. */
  dispose(): void {
    this.following?.()
    this.following = undefined
  }

  private derive(): void {
    if (this.saving) return
    const scope = this.scope.getSnapshot()
    if (scope.mode === 'memory') {
      this.store.update((state) => {
        state.status = 'ready'
        state.acknowledged = this.localAcknowledged
        state.error = null
      })
      return
    }
    switch (scope.status) {
      case 'loading':
        this.store.update((state) => { state.status = 'loading'; state.error = null })
        return
      case 'unavailable':
        this.store.update((state) => {
          state.status = 'error'
          state.acknowledged = false
          state.error = 'welcome acknowledgement settings are unavailable'
        })
        return
      case 'ready': {
        const acknowledged = scope.value?.[WELCOME_NOTICE_ACK_FIELD] === WELCOME_NOTICE_VERSION
        this.store.update((state) => {
          state.status = 'ready'
          state.acknowledged = acknowledged
          state.error = null
        })
        return
      }
      /* v8 ignore next -- every current settings scope status is handled above */
      default: return assertNever(scope.status)
    }
  }
}
