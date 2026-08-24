// @vitest-environment jsdom
/**
 * 文件职责：验证权限预设的 permission-presets-row.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染和可控服务替身。
 * 产品维度：防止权限预设用户流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { PermissionRow, type PermissionRowProps } from '../src/client/PermissionRow.tsx'
import { en } from '../src/client/locales.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { PermissionPresetSettingsController } from '../src/client/settings-store.ts'

/** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
const schema = new SettingsSchemaService(new Context())

/** Controller over a real mirror derived from the same fake wire. */
/** 中文说明：函数 derivedController 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function derivedController(api: { settings: object }) {
  /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
  const wire = api as never
  return new PermissionPresetSettingsController(new SettingsDescribeMirror(wire), wire, schema)
}

afterEach(cleanup)

/** 中文说明：测试局部值 SCHEMA，由紧邻初始化决定。 */
const SCHEMA = {
  uid: 5,
  refs: {
    1: { type: 'const', value: 'read-only' },
    2: { type: 'const', value: 'workspace-write' },
    3: { type: 'const', value: 'danger-full-access' },
    4: { type: 'union', list: [1, 2, 3] },
    5: { type: 'object', dict: { defaultPreset: 4 } },
  },
}

/** 中文说明：函数 view 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function view(defaultPreset: string, revision = 0): SettingsNamespaceView {
  return {
    ns: 'permission',
    schema: SCHEMA,
    value: { defaultPreset },
    base: { defaultPreset: 'read-only' },
    applies: 'live',
    secrets: [],
    revision,
  }
}

/** 中文说明：函数 ok 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function ok<T>(value: T) {
  return { rpcId: 'test', result: { ok: true as const, value } }
}

/** 中文说明：测试局部值 dictionary，由紧邻初始化决定。 */
const dictionary: Record<string, string> = en
/** 中文说明：测试局部值 t，由紧邻初始化决定。 */
const t: PermissionRowProps['t'] = key => dictionary[key] ?? key
/** 中文说明：测试局部值 runtime，由紧邻初始化决定。 */
const runtime = {
  useSessions: (() => { throw new Error('unused') }) as never,
  useWorkspaces: (() => { throw new Error('unused') }) as never,
}

/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function mount(controller: PermissionPresetSettingsController) {
  return render(
    <PermissionRow
      {...runtime}
      load={() => controller.load()}
      select={preset => controller.select(preset)}
      usePermission={bindSnapshotSelector(controller.store)}
      t={t}
    />,
  )
}

describe('PermissionRow', () => {
  it('loads the descriptor, opens the menu, and selects a new default', async () => {
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn(() => Promise.resolve(ok(view('workspace-write', 1))))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = derivedController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate,
      },
    })
    mount(controller)
    /** 中文说明：测试局部值 button，由紧邻初始化决定。 */
    const button = await screen.findByRole('button', { name: 'Read Only' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(button.getAttribute('aria-expanded')).toBe('false') })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Read Only' }))
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Workspace Write' }))
    await screen.findByRole('button', { name: 'Workspace Write' })
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('requires explicit acknowledgement before saving Full access', async () => {
    /** 中文说明：测试局部值 mutate，由紧邻初始化决定。 */
    const mutate = vi.fn(() => Promise.resolve(ok(view('danger-full-access', 1))))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = derivedController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate,
      },
    })
    mount(controller)
    fireEvent.click(await screen.findByRole('button', { name: 'Read Only' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Full access' }))
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Enable Full access?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Read Only' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Full access' }))
    /** 中文说明：测试局部值 dialog，由紧邻初始化决定。 */
    const dialog = screen.getByRole('dialog', { name: 'Enable Full access?' })
    /** 中文说明：测试局部值 enable，由紧邻初始化决定。 */
    const enable = screen.getByRole('button', { name: 'Enable Full access' })
    expect((enable as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(enable)
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(dialog.isConnected).toBe(false)
  })

  it('hides an unavailable namespace and disables a read-only provider', async () => {
    /** 中文说明：测试局部值 absent，由紧邻初始化决定。 */
    const absent = derivedController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] })),
        mutate: vi.fn(),
      },
    })
    /** 中文说明：测试局部值 rendered，由紧邻初始化决定。 */
    const rendered = mount(absent)
    await waitFor(() => { expect(rendered.container.textContent).toBe('') })
    rendered.unmount()

    /** 中文说明：测试局部值 readonly，由紧邻初始化决定。 */
    const readonly = derivedController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: false, hasDocument: false, namespaces: [view('read-only')] })),
        mutate: vi.fn(),
      },
    })
    mount(readonly)
    expect((await screen.findByRole('button', { name: 'Read Only' })).hasAttribute('disabled')).toBe(true)
  })

  it('shows loading and a contained write error', async () => {
    /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
    const describe = Promise.withResolvers<ReturnType<typeof ok<{
      writable: boolean
      namespaces: SettingsNamespaceView[]
    }>>>()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = derivedController({
      settings: {
        describe: () => describe.promise,
        mutate: () => Promise.resolve({
          rpcId: 'test',
          result: {
            ok: false as const,
            error: { code: 'settings-conflict', message: 'changed elsewhere', details: {} },
          },
        }),
      },
    })
    mount(controller)
    expect((await screen.findByRole('button', { name: 'Loading' })).hasAttribute('disabled')).toBe(true)
    describe.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }))
    /** 中文说明：测试局部值 button，由紧邻初始化决定。 */
    const button = await screen.findByRole('button', { name: 'Read Only' })
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Workspace Write' }))
    expect((await screen.findByRole('alert')).textContent).toBe('changed elsewhere')
  })
})
