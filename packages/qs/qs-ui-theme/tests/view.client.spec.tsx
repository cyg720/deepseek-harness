// @vitest-environment jsdom
/** 控件范围与官方协议一致；只读、加载和临时连接使用真实可写状态。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { FONT_SIZE_MIN, FONT_SIZE_MAX } from '../../../client/ui-theme/src/theme-settings.ts'
import { Appearance, FontSize, type ThemeProps } from '../src/client/Rows.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('两行显示官方选择、委派载荷并在只读或加载时禁用', () => {
  const theme = { preference: 'system', fontSize: 14 } as ThemeSnapshot
  let settings: SettingsMirrorSnapshot = { status: 'ready', error: null, view: { namespaces: [], writable: true, hasDocument: false } }
  const setTheme = vi.fn(), setFontSize = vi.fn()
  const props = { setTheme, setFontSize, t: (key: keyof typeof zh) => zh[key],
    useTheme: (select: (value: ThemeSnapshot) => unknown) => select(theme),
    useSettings: (select: (value: SettingsMirrorSnapshot) => unknown) => select(settings),
  } as unknown as ThemeProps
  const tree = () => <><Appearance {...props} /><FontSize {...props} /></>
  const view = render(tree())
  const appearance = screen.getByRole('combobox', { name: zh.appearance }) as HTMLSelectElement
  const font = screen.getByRole('combobox', { name: zh.fontSize }) as HTMLSelectElement
  expect(appearance.value).toBe('system'); expect(font.value).toBe('14')
  const allowed = Array.from({ length: FONT_SIZE_MAX - FONT_SIZE_MIN + 1 }, (_, index) => FONT_SIZE_MIN + index)
  expect([...font.options].map(option => Number(option.value))).toEqual(allowed)
  for (const value of ['light', 'dark', 'system']) {
    fireEvent.change(appearance, { target: { value } }); expect(setTheme).toHaveBeenLastCalledWith(value)
  }
  fireEvent.change(font, { target: { value: '17' } }); expect(setFontSize).toHaveBeenCalledWith(17)
  theme.fontSize = 17; theme.preference = 'dark'; view.rerender(tree())
  expect(font.value).toBe('17'); expect(appearance.value).toBe('dark')
  for (const state of [
    { ...settings, view: { ...settings.view!, writable: false } },
    { status: 'loading', error: null, view: undefined },
    { status: 'ready', error: null, view: undefined },
  ] as SettingsMirrorSnapshot[]) {
    settings = state; view.rerender(tree()); expect(font.disabled).toBe(true); expect(appearance.disabled).toBe(true)
  }
  settings = { status: 'unavailable', error: null, view: undefined }; view.rerender(tree())
  expect(font.disabled).toBe(false); expect(appearance.disabled).toBe(false); expect(screen.getAllByText(zh.memory)).toHaveLength(2)
})
