// @vitest-environment jsdom
/** 浏览器拒绝存储时，登录仍可在内存完成且不会恢复不匹配的演示身份。 */
import { afterEach, expect, it, vi } from 'vitest'
import { AUTH_STORE_KEY, createQsAuthStore, readRememberedUser, writeRememberedUser } from '../src/client/auth-store.ts'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })
it('没有浏览器存储时保留内存登录与退出能力', () => {
  vi.stubGlobal('localStorage', undefined)
  expect(readRememberedUser()).toBe('')
  writeRememberedUser('admin')
  const store = createQsAuthStore().create()
  expect(store.getSnapshot().storageDegraded).toBe(true)
  store.actions.signIn('admin', true)
  expect(store.getSnapshot().authenticated).toBe(true)
  store.actions.signOut()
  expect(store.getSnapshot().authenticated).toBe(false)
})
it('读取被策略拒绝时不恢复身份', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
  expect(readRememberedUser()).toBe('')
  expect(createQsAuthStore().create().getSnapshot().authenticated).toBe(false)
})
it.each(['missing', 'different', 'denied'])('演示标记 %s 时仅预填用户名', (mode) => {
  localStorage.setItem(AUTH_STORE_KEY + '.user', 'admin')
  if (mode === 'different') localStorage.setItem(AUTH_STORE_KEY + '.demo', 'other')
  const read = localStorage.getItem.bind(localStorage)
  if (mode === 'denied') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (key.endsWith('.demo')) throw new DOMException('denied', 'SecurityError')
    return read.call(this, key)
  })
  expect(createQsAuthStore().create().getSnapshot()).toMatchObject({ user: 'admin', authenticated: false })
})
it('探测成功后实际写入失败不阻止登录，降级标志可显式更新', () => {
  const write = localStorage.setItem.bind(localStorage)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (!key.endsWith('.probe')) throw new DOMException('quota', 'QuotaExceededError')
    write.call(this, key, value)
  })
  const store = createQsAuthStore().create()
  store.actions.signIn('admin', true)
  store.actions.markStorageDegraded()
  expect(store.getSnapshot()).toMatchObject({ authenticated: true, storageDegraded: true })
  expect(localStorage.getItem(AUTH_STORE_KEY + '.user')).toBeNull()
})
it('存储探测失败时不尝试恢复记住的身份', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
  writeRememberedUser('admin')
  expect(createQsAuthStore().create().getSnapshot()).toMatchObject({ authenticated: false, storageDegraded: true })
})
