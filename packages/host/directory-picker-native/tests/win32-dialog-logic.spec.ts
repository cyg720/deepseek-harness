/**
 * The COM conversation's sequencing against fake bindings: outcome mapping
 * (selection / cancellation / HRESULT failures at every step) and the
 * release-on-every-path guarantee, all platform-independent.
 */
/*
 * 文件职责：验证宿主目录选择的 win32-dialog-logic.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR, FOS_PICKFOLDERS, HRESULT_CANCELLED,
  runFolderDialog, type Win32DialogBindings, type Win32FolderDialog,
} from '../src/win32-dialog-logic.ts'

/** 中文说明：测试局部值 E_FAIL，由紧邻初始化决定。 */
const E_FAIL = 0x80004005 | 0

/** 中文说明：类型或类 FakeWorld 约束 API、Hook 或目录数据职责。 */
interface FakeWorld {
  bindings: Win32DialogBindings
  dpi: ReturnType<typeof vi.fn>
  createDialog: ReturnType<typeof vi.fn>
  uninitialize: ReturnType<typeof vi.fn>
  dialog: {
    setOptions: ReturnType<typeof vi.fn>
    setTitle: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    resultPath: ReturnType<typeof vi.fn>
    release: ReturnType<typeof vi.fn>
  }
}

/** 中文说明：函数 world 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function world(overrides: Partial<Win32FolderDialog> = {}, coInit = 0): FakeWorld {
  /** 中文说明：测试局部值 dialog，由紧邻初始化决定。 */
  const dialog = {
    setOptions: vi.fn(() => 0),
    setTitle: vi.fn(() => 0),
    show: vi.fn(() => 0),
    resultPath: vi.fn(() => ({ hr: 0, path: 'C:\\picked\\目录' })),
    release: vi.fn(),
    ...overrides,
  }
  /** 中文说明：测试局部值 dpi，由紧邻初始化决定。 */
  const dpi = vi.fn()
  /** 中文说明：测试局部值 createDialog，由紧邻初始化决定。 */
  const createDialog = vi.fn(() => dialog)
  /** 中文说明：测试局部值 uninitialize，由紧邻初始化决定。 */
  const uninitialize = vi.fn()
  /** 中文说明：测试局部值 bindings，由紧邻初始化决定。 */
  const bindings: Win32DialogBindings = {
    setThreadDpiAwareness: dpi,
    coInitializeSta: vi.fn(() => coInit),
    coUninitialize: uninitialize,
    createFolderDialog: createDialog,
    currentThreadId: vi.fn(() => 4242),
  }
  return { bindings, dpi, createDialog, uninitialize, dialog: dialog as FakeWorld['dialog'] }
}

describe('runFolderDialog', () => {
  it('sequences DPI, STA, options, title, show, result extraction, and apartment teardown', () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { bindings, dpi, dialog, uninitialize } = world()
    /** 中文说明：测试局部值 showing，由紧邻初始化决定。 */
    const showing = vi.fn()
    expect(runFolderDialog(bindings, 'Pick', showing)).toBe('C:\\picked\\目录')
    expect(dpi).toHaveBeenCalledOnce()
    expect(uninitialize).toHaveBeenCalledOnce()
    expect(dialog.release.mock.invocationCallOrder[0]).toBeLessThan(uninitialize.mock.invocationCallOrder[0] as number)
    expect(dialog.setOptions).toHaveBeenCalledWith(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR)
    expect(dialog.setTitle).toHaveBeenCalledWith('Pick')
    expect(showing).toHaveBeenCalledWith(4242)
    expect(showing.mock.invocationCallOrder[0]).toBeLessThan(dialog.show.mock.invocationCallOrder[0] as number)
    expect(dialog.release).toHaveBeenCalledOnce()
  })

  it('maps the cancelled HRESULT to null and still releases the dialog and apartment', () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { bindings, dialog, uninitialize } = world({ show: vi.fn(() => HRESULT_CANCELLED) })
    expect(runFolderDialog(bindings, 'Pick', vi.fn())).toBeNull()
    expect(dialog.resultPath).not.toHaveBeenCalled()
    expect(dialog.release).toHaveBeenCalledOnce()
    expect(uninitialize).toHaveBeenCalledOnce()
  })

  it('accepts the S_FALSE re-entry HRESULT from CoInitializeEx', () => {
    /** 中文说明：测试局部值 { bindings }，由紧邻初始化决定。 */
    const { bindings } = world({}, 1)
    expect(runFolderDialog(bindings, 'Pick', vi.fn())).toBe('C:\\picked\\目录')
  })

  it('throws on a failing CoInitializeEx without creating a dialog or uninitializing', () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { bindings, createDialog, uninitialize } = world({}, E_FAIL)
    expect(() => runFolderDialog(bindings, 'Pick', vi.fn())).toThrow('CoInitializeEx failed: HRESULT 0x80004005')
    expect(createDialog).not.toHaveBeenCalled()
    // A failed CoInitializeEx must NOT be paired with CoUninitialize.
    expect(uninitialize).not.toHaveBeenCalled()
  })

  it.each([
    ['SetOptions', { setOptions: vi.fn(() => E_FAIL) }],
    ['SetTitle', { setTitle: vi.fn(() => E_FAIL) }],
    ['Show', { show: vi.fn(() => E_FAIL) }],
    ['GetResult', { resultPath: vi.fn(() => ({ hr: E_FAIL })) }],
  ] satisfies [string, Partial<Win32FolderDialog>][])('releases the dialog and apartment when %s fails', (what, overrides) => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { bindings, dialog, uninitialize } = world(overrides)
    expect(() => runFolderDialog(bindings, 'Pick', vi.fn())).toThrow(`${what} failed: HRESULT 0x80004005`)
    expect(dialog.release).toHaveBeenCalledOnce()
    expect(uninitialize).toHaveBeenCalledOnce()
  })
})
