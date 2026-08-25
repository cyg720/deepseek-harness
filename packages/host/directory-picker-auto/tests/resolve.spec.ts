/**
 * 文件职责：验证宿主目录选择的 resolve.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canExecute, hasLinuxChooserBinary } from '../src/probe.ts'
import { resolveDirectoryPickerBackend } from '../src/resolve.ts'
import type { DirectoryPickerHostFacts } from '../src/resolve.ts'

/** Baseline facts that resolve to `native`; each case overrides one signal (darwin never consults `linuxChooser`). */
/* 中文说明：测试局部值 attended，由紧邻初始化决定。 */
const attended: DirectoryPickerHostFacts = {
  bindHost: '127.0.0.1',
  platform: 'darwin',
  env: {},
  linuxChooser: false,
}

describe('resolveDirectoryPickerBackend', () => {
  it('resolves native for a loopback bind on a display platform', () => {
    expect(resolveDirectoryPickerBackend(attended)).toBe('native')
    expect(resolveDirectoryPickerBackend({ ...attended, platform: 'win32' })).toBe('native')
  })

  it('resolves browse for an all-interfaces bind regardless of other signals', () => {
    expect(resolveDirectoryPickerBackend({ ...attended, bindHost: '0.0.0.0' })).toBe('browse')
  })

  it('resolves browse under an SSH launch (either env marker)', () => {
    expect(resolveDirectoryPickerBackend({ ...attended, env: { SSH_CONNECTION: '10.0.0.2 55 10.0.0.9 22' } })).toBe('browse')
    expect(resolveDirectoryPickerBackend({ ...attended, env: { SSH_TTY: '/dev/pts/3' } })).toBe('browse')
  })

  it('requires a display session and a chooser binary on linux', () => {
    /** 中文说明：测试局部值 linux，由紧邻初始化决定。 */
    const linux: DirectoryPickerHostFacts = { ...attended, platform: 'linux', linuxChooser: true }
    expect(resolveDirectoryPickerBackend(linux)).toBe('browse')
    expect(resolveDirectoryPickerBackend({ ...linux, env: { DISPLAY: ':0' } })).toBe('native')
    expect(resolveDirectoryPickerBackend({ ...linux, env: { WAYLAND_DISPLAY: 'wayland-1' } })).toBe('native')
    expect(resolveDirectoryPickerBackend({ ...linux, env: { DISPLAY: ':0' }, linuxChooser: false })).toBe('browse')
  })

  it('resolves browse on platforms the native backend cannot serve, display or not', () => {
    expect(resolveDirectoryPickerBackend({ ...attended, platform: 'freebsd', env: { DISPLAY: ':0' }, linuxChooser: true })).toBe('browse')
    expect(resolveDirectoryPickerBackend({ ...attended, platform: 'openbsd', env: { WAYLAND_DISPLAY: 'wayland-1' } })).toBe('browse')
  })

  it('treats blank env exports as unset', () => {
    expect(resolveDirectoryPickerBackend({ ...attended, env: { SSH_CONNECTION: '', SSH_TTY: '' } })).toBe('native')
    expect(resolveDirectoryPickerBackend({
      ...attended, platform: 'linux', linuxChooser: true, env: { DISPLAY: '', WAYLAND_DISPLAY: '' },
    })).toBe('browse')
  })
})

/** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
let probeRoot: string | undefined

afterEach(() => {
  if (probeRoot !== undefined) rmSync(probeRoot, { recursive: true, force: true })
  probeRoot = undefined
})

describe('hasLinuxChooserBinary', () => {
  it('finds a chooser binary in any PATH segment, skipping empty segments', () => {
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: string[] = []
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    const path = ['', '/opt/none', '/usr/local/bin'].join(delimiter)
    /** 中文说明：测试局部值 found，由紧邻初始化决定。 */
    const found = hasLinuxChooserBinary(path, (candidate) => {
      seen.push(candidate)
      return candidate === join('/usr/local/bin', 'kdialog')
    })
    expect(found).toBe(true)
    expect(seen).toEqual([
      join('/opt/none', 'zenity'), join('/opt/none', 'kdialog'),
      join('/usr/local/bin', 'zenity'), join('/usr/local/bin', 'kdialog'),
    ])
  })

  it('reports absence when no segment holds a chooser binary', () => {
    expect(hasLinuxChooserBinary(['/a', '/b'].join(delimiter), () => false)).toBe(false)
    expect(hasLinuxChooserBinary('', () => true)).toBe(false)
    expect(hasLinuxChooserBinary(undefined, () => true)).toBe(false)
  })
})

describe('canExecute', () => {
  it('accepts an executable file and rejects an absent one', () => {
    probeRoot = mkdtempSync(join(tmpdir(), 'dsh-picker-probe-'))
    /** 中文说明：测试局部值 binary，由紧邻初始化决定。 */
    const binary = join(probeRoot, 'zenity')
    writeFileSync(binary, '#!/bin/sh\n')
    chmodSync(binary, 0o755)
    expect(canExecute(binary)).toBe(true)
    expect(canExecute(join(probeRoot, 'kdialog'))).toBe(false)
  })
})
