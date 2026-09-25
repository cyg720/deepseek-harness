/** 容器共享 WSL 内核时，桌面路径不能转交给容器外的 Windows。 */
import { describe, expect, it, vi } from 'vitest'
import { canOpenNativePath, nativeFileManager, openNativeTextFile, revealNativePath, type PathOpenerRunner } from '../../src/index.ts'

describe('container desktop dispatch', () => {
  it.each([{}, { WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL/123_interop' }])(
    'keeps a headless container on Linux despite inherited WSL facts %j', async (env) => {
      const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
      const facts = { platform: 'linux' as const, osRelease: '6.18-microsoft-standard-WSL2', insideContainer: true, env, run }
      expect(canOpenNativePath(facts)).toBe(false)
      expect(nativeFileManager(facts)).toBe('directory')
      await openNativeTextFile('/work/report.txt', new AbortController().signal, facts)
      await revealNativePath('/work/report.txt', new AbortController().signal, facts)
      expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
        ['xdg-open', ['/work/report.txt']], ['xdg-open', ['/work']],
      ])
    },
  )

  it('allows an explicitly announced Linux display inside a container', () => {
    expect(canOpenNativePath({ platform: 'linux', osRelease: 'microsoft', insideContainer: true, env: { DISPLAY: ':1' } })).toBe(true)
  })

  it('retains Windows handoff for a non-container WSL host', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: 'C:\\work\\report.txt\n', stderr: '' }))
    const facts = { platform: 'linux' as const, osRelease: 'microsoft', insideContainer: false, env: {}, run }
    expect(canOpenNativePath(facts)).toBe(true)
    expect(nativeFileManager(facts)).toBe('explorer')
    await revealNativePath('/mnt/c/work/report.txt', new AbortController().signal, facts)
    expect(run.mock.calls.map(([command]) => command)).toEqual(['wslpath', 'explorer.exe'])
  })
})
