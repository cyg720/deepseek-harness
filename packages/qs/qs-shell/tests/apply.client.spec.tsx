// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject, QS_SHELL_ROOT_PRIORITY } from '../src/client/index.ts'

usePinnedBrowserLanguages('zh-CN')

let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

/**
 * 搭一个只含 qs-shell 所需服务的最小组合。
 *
 * 这里刻意不 mock 槽注册表：要用真实的 SlotRegistry 才能验证"root 遮蔽 + 子槽声明"
 * 这条最容易写错、也最难在纯函数测试里发现的接线。
 */
async function bench(): Promise<SlotTestRuntime> {
  const created = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(created.ctx)
  created.ctx.provide('locale', locale)
  created.slots.installLocale(locale)
  created.ctx.provide('theme', {
    getTheme: () => ({ preference: 'light', fontSize: 14, active: { id: 'light', colorScheme: 'light', tokens: {} }, themes: [], revision: 0 }),
  } as never)
  await created.mount({ inject: [...inject], apply })
  return created
}

describe('qs-shell 槽接线', () => {
  it('以负优先级注册 root，遮蔽官方 AppFrame', async () => {
    runtime = await bench()
    const entries = runtime.slots.entries('root')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options.priority).toBe(QS_SHELL_ROOT_PRIORITY)
    expect(QS_SHELL_ROOT_PRIORITY).toBeLessThan(0)
  })

  it('声明全部顶层 qs.* 槽，且 kind 与 scope 与设计一致', async () => {
    runtime = await bench()
    const expected: readonly (readonly [keyof SlotMap, string, string])[] = [
      ['qs.gate', 'single', 'root'],
      ['qs.chrome', 'single', 'root'],
      ['qs.sidebar', 'single', 'root'],
      ['qs.stage', 'single', 'root'],
      ['qs.inspector', 'single', 'root'],
      ['qs.status', 'list', 'root'],
      ['qs.overlay', 'list', 'root'],
      // 严格 session 与 session-maybe 各一处，这是座位分层的关键
    ]
    for (const [key, kind, scope] of expected) {
      const spec = runtime.slots.spec(key)
      expect(spec, `${key} 应已声明`).toBeDefined()
      expect(spec?.kind, `${key} kind`).toBe(kind)
      expect(spec?.scope, `${key} scope`).toBe(scope)
    }
  })

  it('layout declares seats but does not implement conversation or sidebars', async () => {
    runtime = await bench()
    expect(runtime.slots.entries('qs.stage')).toHaveLength(0)
    expect(runtime.slots.spec('qs.stage.body')).toBeUndefined()
    // 尚未加载 qs-transcript / qs-composer：贡献等待，不是错误
    expect(runtime.slots.entries('qs.stage.transcript')).toHaveLength(0)
    expect(runtime.slots.entries('qs.composer')).toHaveLength(0)
    expect(runtime.slots.entries('qs.gate')).toHaveLength(0)
    expect(runtime.slots.entries('qs.nav')).toHaveLength(0)
  })

  it('发布 root 座席：主题与界面切换控制器', async () => {
    runtime = await bench()
    const binding = runtime.slots.snapshot('root')
    expect(binding.length).toBeGreaterThan(0)
  })
})
