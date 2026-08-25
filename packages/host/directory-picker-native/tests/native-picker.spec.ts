/**
 * Native picker tier selection and the execFile adapter: the Win32 dialog
 * primary (failures surface as-is, no fallback tier), the abort rule, and
 * the POSIX command tiers (osascript, Zenity → KDialog).
 */
/**
 * 文件职责：验证宿主目录选择的 native-picker.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

/** 中文说明：类型或类 ExecFileCallback 约束 API、Hook 或目录数据职责。 */
type ExecFileCallback = (
  error: (Error & { code?: string | number }) | null,
  stdout: string,
  stderr: string,
) => void
/** 中文说明：类型或类 ExecFileMock 约束 API、Hook 或目录数据职责。 */
type ExecFileMock = (
  command: string,
  args: readonly string[],
  options: { encoding: string; signal: AbortSignal; windowsHide: boolean },
  callback: ExecFileCallback,
) => void

/** 中文说明：测试局部值 { execFileMock }，由紧邻初始化决定。 */
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn<ExecFileMock>() }))

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import { describe, expect, it, vi } from 'vitest'
import { pickNativeDirectory, type DirectoryPickerRunner } from '../src/native-picker.ts'

/** 中文说明：函数 failure 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function failure(code: string | number, stderr = ''): Error {
  return Object.assign(new Error(`command failed: ${String(code)}`), { code, stderr })
}

/** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
const signal = () => new AbortController().signal

/** A Win32 dialog that always fails — the no-fallback case. */
/** 中文说明：测试局部值 noDialog，由紧邻初始化决定。 */
const noDialog = async (): Promise<string | null> => { throw new Error('dialog unavailable') }

describe('native directory picker', () => {
  it('uses the macOS folder chooser and maps user cancellation to null', async () => {
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = vi.fn<DirectoryPickerRunner>(async () => ({ stdout: '/Users/test/project/\n', stderr: '' }))
    await expect(pickNativeDirectory(signal(), { platform: 'darwin', run })).resolves.toBe('/Users/test/project/')
    expect(run).toHaveBeenCalledWith('osascript', expect.arrayContaining(['POSIX path of selectedFolder']), expect.any(AbortSignal))

    run.mockRejectedValueOnce(failure(1, 'execution error: User canceled. (-128)'))
    await expect(pickNativeDirectory(signal(), { platform: 'darwin', run })).resolves.toBeNull()

    run.mockRejectedValueOnce(failure(2, 'permission denied'))
    await expect(pickNativeDirectory(signal(), { platform: 'darwin', run })).rejects.toThrow('command failed')
  })

  it.each([
    ['a primitive error', 'failed'],
    ['an invalid code type', { code: true }],
    ['a missing stderr property', { code: 1 }],
    ['a non-string stderr property', { code: 1, stderr: 42 }],
  ])('does not mistake %s for macOS cancellation', async (_label, reason) => {
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = vi.fn<DirectoryPickerRunner>(async () => { throw reason })
    await expect(pickNativeDirectory(signal(), { platform: 'darwin', run })).rejects.toBe(reason)
  })

  it('uses the Win32 dialog and never spawns a command when it answers', async () => {
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = vi.fn<DirectoryPickerRunner>()
    /** 中文说明：测试局部值 pickWin32Dialog，由紧邻初始化决定。 */
    const pickWin32Dialog = vi.fn(async (): Promise<string | null> => 'C:\\work\\selected')
    await expect(pickNativeDirectory(signal(), { platform: 'win32', run, pickWin32Dialog })).resolves.toBe('C:\\work\\selected')
    pickWin32Dialog.mockResolvedValueOnce(null)
    await expect(pickNativeDirectory(signal(), { platform: 'win32', run, pickWin32Dialog })).resolves.toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('surfaces the Win32 dialog failure with no fallback', async () => {
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = vi.fn<DirectoryPickerRunner>()
    await expect(pickNativeDirectory(signal(), { platform: 'win32', run, pickWin32Dialog: noDialog }))
      .rejects.toThrow('dialog unavailable')
    expect(run).not.toHaveBeenCalled()
  })

  it('wires the real Win32 dialog as the default tier', async () => {
    // A pre-aborted signal makes the DEFAULT dialog deterministic on every
    // host: pickWin32Directory throws before spawning any worker or window.
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    abort.abort()
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = vi.fn<DirectoryPickerRunner>()
    await expect(pickNativeDirectory(abort.signal, { platform: 'win32', run }))
      .rejects.toThrow('native directory picker aborted')
    expect(run).not.toHaveBeenCalled()
  })

  it('does not fall back when the caller aborted the dialog', async () => {
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    abort.abort(new Error('closed'))
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = vi.fn<DirectoryPickerRunner>()
    await expect(pickNativeDirectory(abort.signal, { platform: 'win32', run, pickWin32Dialog: noDialog })).rejects.toThrow('dialog unavailable')
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the default command adapter without a shell and preserves command failures', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, '/home/test/project\n', '')
    })
    await expect(pickNativeDirectory(signal(), { platform: 'linux' })).resolves.toBe('/home/test/project')
    /** 中文说明：测试局部值 [command, args, options]，由紧邻初始化决定。 */
    const [command, args, options] = execFileMock.mock.calls[0]!
    expect(command).toBe('zenity')
    expect(args).toEqual(expect.arrayContaining(['--file-selection', '--directory']))
    expect(options.encoding).toBe('utf8')
    expect(options.windowsHide).toBe(true)
    expect(options.signal).toBeInstanceOf(AbortSignal)

    // A non-cancellation command failure surfaces as-is with its cause and
    // captured stdio attached; no tier masks or rewraps it.
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(Object.assign(new Error('zenity failed'), { code: 7 }), 'partial output', 'failure details')
    })
    /** 中文说明：测试局部值 surfaced，由紧邻初始化决定。 */
    const surfaced = await pickNativeDirectory(signal(), { platform: 'linux' })
      .then(() => { throw new Error('expected rejection') }, (error: unknown) => error as Error)
    expect(surfaced).toMatchObject({
      message: 'zenity failed', code: 7,
      stdout: 'partial output', stderr: 'failure details',
    })
    expect((surfaced as { cause?: unknown }).cause).toBeInstanceOf(Error)
  })

  it('uses the current process platform when no platform override is supplied', async () => {
    // Deterministic on every host: the win32 tier answers from the dialog,
    // the POSIX tiers from the command runner.
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = vi.fn<DirectoryPickerRunner>(async () => ({ stdout: '/default/platform\n', stderr: '' }))
    /** 中文说明：测试局部值 pickWin32Dialog，由紧邻初始化决定。 */
    const pickWin32Dialog = async (): Promise<string | null> => 'C:\\default\\platform'
    /** 中文说明：测试局部值 expected，由紧邻初始化决定。 */
    const expected = process.platform === 'win32' ? 'C:\\default\\platform' : '/default/platform'
    await expect(pickNativeDirectory(signal(), { run, pickWin32Dialog })).resolves.toBe(expected)
  })

  it('maps empty command output to cancellation', async () => {
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = vi.fn<DirectoryPickerRunner>(async () => ({ stdout: '', stderr: '' }))
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run })).resolves.toBeNull()
  })

  it('uses Zenity on Linux and falls back to KDialog only when Zenity is missing', async () => {
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = vi.fn<DirectoryPickerRunner>()
      .mockRejectedValueOnce(failure('ENOENT'))
      .mockResolvedValueOnce({ stdout: '/home/test/project\n', stderr: '' })
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run })).resolves.toBe('/home/test/project')
    expect(run.mock.calls.map(call => call[0])).toEqual(['zenity', 'kdialog'])

    /** 中文说明：测试局部值 zenity，由紧邻初始化决定。 */
    const zenity = vi.fn<DirectoryPickerRunner>(async () => ({ stdout: '/home/test/direct\n', stderr: '' }))
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: zenity }))
      .resolves.toBe('/home/test/direct')
    expect(zenity).toHaveBeenCalledOnce()
  })

  it('maps Linux cancellation to null and reports a missing desktop picker', async () => {
    /** 中文说明：测试局部值 cancelled，由紧邻初始化决定。 */
    const cancelled = vi.fn<DirectoryPickerRunner>(async () => { throw failure(1) })
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: cancelled })).resolves.toBeNull()

    /** 中文说明：测试局部值 missing，由紧邻初始化决定。 */
    const missing = vi.fn<DirectoryPickerRunner>(async () => { throw failure('ENOENT') })
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: missing }))
      .rejects.toThrow('install zenity or kdialog')

    /** 中文说明：测试局部值 kdialogCancelled，由紧邻初始化决定。 */
    const kdialogCancelled = vi.fn<DirectoryPickerRunner>()
      .mockRejectedValueOnce(failure('ENOENT'))
      .mockRejectedValueOnce(failure(1))
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: kdialogCancelled }))
      .resolves.toBeNull()

    /** 中文说明：测试局部值 zenityFailed，由紧邻初始化决定。 */
    const zenityFailed = vi.fn<DirectoryPickerRunner>(async () => { throw failure(2) })
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: zenityFailed }))
      .rejects.toThrow('command failed')

    /** 中文说明：测试局部值 kdialogFailed，由紧邻初始化决定。 */
    const kdialogFailed = vi.fn<DirectoryPickerRunner>()
      .mockRejectedValueOnce(failure('ENOENT'))
      .mockRejectedValueOnce(failure(2))
    await expect(pickNativeDirectory(signal(), { platform: 'linux', run: kdialogFailed }))
      .rejects.toThrow('command failed')
  })

  it('does not convert caller aborts into user cancellation', async () => {
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    abort.abort(new Error('closed'))
    /** 中文说明：测试局部值 run，由紧邻初始化决定。 */
    const run = vi.fn<DirectoryPickerRunner>(async () => { throw failure('ABORT_ERR') })
    await expect(pickNativeDirectory(abort.signal, { platform: 'linux', run })).rejects.toThrow('command failed')
  })

  it('reports unsupported platforms', async () => {
    await expect(pickNativeDirectory(signal(), { platform: 'aix' })).rejects.toThrow('unsupported on aix')
  })
})
