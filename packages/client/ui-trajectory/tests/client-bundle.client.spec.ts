// @vitest-environment jsdom
/*
 * 文件职责：验证运行轨迹的 client-bundle.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、虚拟列表和服务替身。
 * 产品维度：防止运行轨迹展示与操作流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：计时器、观察器、DOM 尺寸和异步请求必须恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和异常场景阅读。
 */
/**
 * Real tsdown artifact shape: lib/client.js hands off through
 * window.__ModuleLoader__.load, resolves externals through the injected
 * require, returns the exports (apply + inject), and a mounted apply
 * registers the view tab into a real SlotRegistry ring. Skips when dist/ is
 * not built (`pnpm --filter @deepseek-ai/dsh-client-ui-trajectory bundle`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'

/** 中文说明：测试局部值 PLUGIN_ID，由紧邻初始化决定。 */
const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-trajectory'

/** 中文说明：类型或类 Handoff 约束模块数据或组件职责。 */
interface Handoff { id: string; factory: (require: (spec: string) => unknown) => Record<string, unknown> }
/** 中文说明：类型或类 Win 约束模块数据或组件职责。 */
type Win = { __ModuleLoader__?: { load(h: Handoff): void } }

/** 中文说明：函数 readBundle 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function readBundle(): string | undefined {
  try {
    // import.meta.url is http-scheme in the jsdom pool; vitest runs from the
    // repo root, so resolve the artifact repo-relatively instead.
    return readFileSync(resolve('packages/client/ui-trajectory/lib/client.js'), 'utf8')
  } catch {
    return undefined
  }
}

afterEach(() => {
  delete (window as Win).__ModuleLoader__
  /** 中文说明：测试局部值 el，由紧邻初始化决定。 */
  for (const el of document.querySelectorAll('style')) el.remove()
})

describe('tsdown client artifact', () => {
  /** 中文说明：测试局部值 code，由紧邻初始化决定。 */
  const code = readBundle()

  /** 中文说明：函数 loadArtifact 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  async function loadArtifact() {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let handoff: Handoff | undefined
    ;(window as Win).__ModuleLoader__ = { load: (h) => { handoff = h } }
    // The implied-eval ban targets accidental string execution, not this
    // deliberate built-bundle fixture running in the window scope.
    // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
    new Function(code!)()
    expect(handoff).toBeDefined()
    /** 中文说明：测试局部值 modules，由紧邻初始化决定。 */
    const modules = new Map<string, unknown>([
      ['react', await import('react')],
      ['react/jsx-runtime', await import('react/jsx-runtime')],
      ['react-dom', await import('react-dom')],
      ['@deepseek-ai/dsh-client-store', await import('@deepseek-ai/dsh-client-store')],
      ['@deepseek-ai/dsh-client-ui-conversation/client', await import('@deepseek-ai/dsh-client-ui-conversation/client')],
      ['@deepseek-ai/dsh-client-ui-primitives', await import('@deepseek-ai/dsh-client-ui-primitives')],
    ])
    /** 中文说明：测试局部值 exports，由紧邻初始化决定。 */
    const exports = handoff!.factory((spec) => {
      if (!modules.has(spec)) throw new Error(`unexpected require: ${spec}`)
      return modules.get(spec)
    })
    return { handoff: handoff!, exports }
  }

  it.skipIf(code === undefined)('hands off with the manifest id and a DI-require factory', async () => {
    /** 中文说明：测试局部值 { handoff, exports }，由紧邻初始化决定。 */
    const { handoff, exports } = await loadArtifact()
    expect(handoff.id).toBe(PLUGIN_ID)
    expect(exports.apply).toBeTypeOf('function')
    expect(exports.inject).toEqual([
      'slots', 'sessions', 'uiSession', 'uiConversation', 'locale',
    ])
  })

  it.skipIf(code === undefined)('mounted as an object plugin, apply registers the view tab on the real ring', async () => {
    /** 中文说明：测试局部值 { exports }，由紧邻初始化决定。 */
    const { exports } = await loadArtifact()
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
    const slots = new SlotRegistry(ctx)
    ctx.provide('uiSession', { provide: () => () => {} } as never)
    // The conversation entry's role: the ring must be declared before riders land.
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_p: { renderSlot?: unknown }) => null)
    // Paging is session-owned; this registration-only probe never renders the
    // entry, so the binding stays deliberately empty. The locale plugin backs
    // the locale-aware view tab label (its settings scope needs a connection
    // handle and the Host-facing settings/remote seams).
    const sessions = { binding: () => undefined }
    ctx.provide('sessions', sessions)
    const uiConversation = new UiConversation(ctx, sessions as never)
    const { events, views } = uiConversation
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    /** 中文说明：测试局部值 locale，由紧邻初始化决定。 */
    const locale = await import('@deepseek-ai/dsh-client-locale/client')
    ctx.plugin({ inject: [...locale.inject], apply: locale.apply })
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin(exports as { apply: (ctx: Context) => void })
    await fiber.await()
    expect(slots.entries('conversation.view').map(e => e.options.id)).toEqual(['trajectory'])
    expect(events.entries().length).toBeGreaterThan(0)
    expect(views.entries()).toHaveLength(1)
    await fiber.dispose()
    expect(slots.entries('conversation.view')).toHaveLength(0)
    expect(events.entries()).toEqual([])
    expect(views.entries()).toEqual([])
  })

  it.skipIf(code === undefined)('injects plugin-tagged module CSS during factory execution', async () => {
    await loadArtifact()
    /** 中文说明：测试局部值 tags，由紧邻初始化决定。 */
    const tags = document.querySelectorAll(`style[data-plugin=${JSON.stringify(PLUGIN_ID)}]`)
    expect(tags.length).toBeGreaterThan(0)
  })
})
