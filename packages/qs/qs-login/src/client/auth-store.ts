/**
 * 登录状态 store。
 *
 * 只保存登录态、用户名与"自动登录"标记：**不保存密码**，也不保存任何票据。
 * 存储不可用时降级为会话内存储，并让界面提示一次（见 07-异常与恢复矩阵 第 4 条）。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** 持久化键。 */
export const AUTH_STORE_KEY = 'dsh.qs.auth'

/** 登录状态。 */
export interface QsAuthState {
  authenticated: boolean
  user: string
  /** 记住用户名的标记（**不是**密码或票据）。 */
  remember: boolean
  /** 本次会话内存储是否不可用；true 时界面提示一次。 */
  storageDegraded: boolean
}

/** 登录 store 的写入集。 */
type QsAuthActions = {
  signIn: (draft: QsAuthState, user: string, remember: boolean) => void
  signOut: (draft: QsAuthState) => void
  markStorageDegraded: (draft: QsAuthState) => void
}

/** 探测 localStorage 是否可读写。 */
function storageAvailable(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const probe = `${AUTH_STORE_KEY}.probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    // 隐私模式或配额拒绝：降级为会话内存储是既有约定，不视为错误。
    return false
  }
}

/**
 * 读取上次记住的用户名。
 * @returns 记住的用户名；无记录或存储不可用时为空串。
 */
export function readRememberedUser(): string {
  if (!storageAvailable()) return ''
  try {
    return localStorage.getItem(`${AUTH_STORE_KEY}.user`) ?? ''
  } catch {
    // 与 storageAvailable 同一降级约定：读失败等同没有记录。
    return ''
  }
}

/**
 * 写入或清除记住的用户名。
 * @param user - 用户名；空串表示清除。
 */
export function writeRememberedUser(user: string): void {
  if (!storageAvailable()) return
  try {
    if (user === '') localStorage.removeItem(`${AUTH_STORE_KEY}.user`)
    else localStorage.setItem(`${AUTH_STORE_KEY}.user`, user)
  } catch {
    // 写失败只影响下次预填，不影响本次登录态。
  }
}

/**
 * 声明登录 store。
 * @returns store 句柄。
 */
export function createQsAuthStore(): EngineStoreHandle<QsAuthState, QsAuthActions> {
  return defineStore({
    init: (): QsAuthState => {
      const remembered = readRememberedUser()
      return {
        authenticated: remembered !== '' && readRememberedSession() === remembered,
        user: remembered,
        remember: remembered !== '',
        storageDegraded: !storageAvailable(),
      }
    },
    actions: {
      signIn: (d, user: string, remember: boolean) => {
        d.authenticated = true
        d.user = user
        d.remember = remember
        writeRememberedUser(remember ? user : '')
        writeRememberedSession(remember ? user : '')
      },
      signOut: (d) => {
        d.authenticated = false
        d.user = ''
        d.remember = false
        writeRememberedSession('')
        writeRememberedUser('')
      },
      markStorageDegraded: (d) => {
        d.storageDegraded = true
      },
    },
  })
}

/** Read the local demo gate marker; it grants no backend permissions. */
function readRememberedSession(): string {
  try { return globalThis.localStorage.getItem(`${AUTH_STORE_KEY}.demo`) ?? '' }
  catch { return '' /* Storage access can be denied by browser policy. */ }
}

/** Persist only the demo username, never a credential or backend token. */
function writeRememberedSession(user: string): void {
  try {
    if (user === '') globalThis.localStorage.removeItem(`${AUTH_STORE_KEY}.demo`)
    else globalThis.localStorage.setItem(`${AUTH_STORE_KEY}.demo`, user)
  } catch { /* Storage denial keeps the demo gate in memory for this page. */ }
}
