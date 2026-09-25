// @vitest-environment jsdom
/** 可选语言目录完全取自官方注册表，远端选择不宣称持久化。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Language, type LanguageProps } from '../src/client/Language.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('按官方目录切换且只读或加载时不提交，memory 明示临时生效', () => {
  const locale: LocaleSnapshot = { active: 'en', revision: 1, locales: [{ id: 'en', label: 'English' }, { id: 'zh', label: '中文' }, { id: 'es', label: 'Español', fallback: 'en' }] }
  let settings: SettingsMirrorSnapshot = { status: 'ready', error: null, view: { namespaces: [], writable: true, hasDocument: false } }
  const setLocale = vi.fn()
  const props = { setLocale, t: (key: keyof typeof zh) => zh[key],
    useLocale: (select: (value: LocaleSnapshot) => unknown) => select(locale),
    useSettings: (select: (value: SettingsMirrorSnapshot) => unknown) => select(settings),
  } as unknown as LanguageProps
  const view = render(<Language {...props} />)
  const select = screen.getByRole('combobox', { name: zh.language }) as HTMLSelectElement
  expect([...select.options].map(option => option.text)).toEqual(['English', '中文', 'Español'])
  expect(select.value).toBe('en')
  fireEvent.change(select, { target: { value: 'es' } })
  expect(setLocale).toHaveBeenCalledWith('es')
  locale.active = 'es'
  view.rerender(<Language {...props} />); expect(select.value).toBe('es')
  settings = { ...settings, view: { ...settings.view!, writable: false } }
  view.rerender(<Language {...props} />)
  expect(select.disabled).toBe(true)
  settings = { status: 'loading', error: null, view: undefined }
  view.rerender(<Language {...props} />)
  expect(select.disabled).toBe(true)
  settings = { status: 'ready', error: null, view: undefined }
  view.rerender(<Language {...props} />)
  expect(select.disabled).toBe(true)
  settings = { status: 'unavailable', error: null, view: undefined }
  view.rerender(<Language {...props} />)
  expect(select.disabled).toBe(false); expect(screen.getByText(zh.memory)).toBeTruthy()
})
