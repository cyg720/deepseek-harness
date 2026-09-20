// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { AUTH_STORE_KEY, createQsAuthStore } from '../src/client/auth-store.ts'

afterEach(() => { for (const suffix of ['.demo', '.user', '.probe']) localStorage.removeItem(AUTH_STORE_KEY + suffix) })

it('restores an opted-in demo gate after refresh and clears it on logout', () => {
  createQsAuthStore().create().actions.signIn('admin', true)
  const refreshed = createQsAuthStore().create()
  expect(refreshed.getSnapshot()).toMatchObject({ authenticated: true, user: 'admin' })
  refreshed.actions.signOut()
  expect(createQsAuthStore().create().getSnapshot()).toMatchObject({ authenticated: false, user: '' })
})

it('keeps a non-remembered sign-in in memory only', () => {
  createQsAuthStore().create().actions.signIn('admin', false)
  expect(createQsAuthStore().create().getSnapshot().authenticated).toBe(false)
})
