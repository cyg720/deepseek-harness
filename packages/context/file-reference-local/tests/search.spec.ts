/**
 * 文件职责：验证文件引用上下文的 search.spec.ts 行为。
 * 技术维度：Vitest、会话事件、模型请求夹具和 Cordis 组装。
 * 产品维度：防止文件引用上下文改变模型可见内容或生命周期语义。
 * 逻辑维度：构造日志与配置，运行插件并断言事件、请求和清理。
 * 关键边界：模型可见内容必须可重建；工具调用和结果必须保持配对。
 * 新手阅读建议：先读事件夹具，再按正常、边界和失败场景阅读。
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  activeAtToken,
  formatFileMention,
  WorkspaceFileSearch,
} from '../src/search.ts'

/** 中文说明：测试局部值 searches，由紧邻初始化决定。 */
const searches: WorkspaceFileSearch[] = []
/** 中文说明：测试局部值 roots，由紧邻初始化决定。 */
const roots: string[] = []

/** 中文说明：函数 workspace 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function workspace(): Promise<string> {
  /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-autocomplete-'))
  roots.push(root)
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(join(root, '.hidden'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'ignored-package'), { recursive: true })
  await writeFile(join(root, 'README.md'), 'readme')
  await writeFile(join(root, 'src', 'tui.spec.ts'), 'test')
  await writeFile(join(root, 'src', 'terminal-view.ts'), 'view')
  await writeFile(join(root, 'docs', 'design notes.md'), 'design')
  await writeFile(join(root, '.hidden', 'secret.txt'), 'hidden')
  await writeFile(join(root, 'node_modules', 'ignored-package', 'index.js'), 'ignored')
  try {
    await symlink(join(root, 'src', 'tui.spec.ts'), join(root, 'linked-test.ts'))
  } catch {
    // Windows may deny symlink creation without Developer Mode; the product
    // still skips every non-file/non-directory Dirent on platforms that expose one.
  }
  return root
}

/** 中文说明：函数 search 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function search(root: string, overrides: Partial<ConstructorParameters<typeof WorkspaceFileSearch>[1]> = {}): WorkspaceFileSearch {
  /** 中文说明：测试局部值 instance，由紧邻初始化决定。 */
  const instance = new WorkspaceFileSearch(root, {
    maxResults: overrides.maxResults ?? 20,
    maxEntries: overrides.maxEntries ?? 10_000,
    excludedDirectories: overrides.excludedDirectories ?? ['.git', 'node_modules'],
  })
  searches.push(instance)
  return instance
}

afterEach(async () => {
  /** 中文说明：测试局部值 instance，由紧邻初始化决定。 */
  for (const instance of searches.splice(0)) instance.dispose()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('file-reference grammar', () => {
  it('recognizes boundary and quoted mentions without treating emails as references', () => {
    expect(activeAtToken('@src/tu', 7)).toEqual({ prefix: '@src/tu', query: 'src/tu', quoted: false })
    expect(activeAtToken('read @"docs/design n', 20)).toEqual({
      prefix: '@"docs/design n',
      query: 'docs/design n',
      quoted: true,
    })
    expect(activeAtToken('mail a@b.test', 13)).toBeUndefined()
    expect(activeAtToken('done @src/x" next', 17)).toBeUndefined()
  })

  it('formats files, directories, quotes, and rejects unsafe editor values', () => {
    expect(formatFileMention({ path: 'src/index.ts', kind: 'file' }, false)).toBe('@src/index.ts')
    expect(formatFileMention({ path: 'src', kind: 'directory' }, false)).toBe('@src/')
    expect(formatFileMention({ path: 'docs/design notes.md', kind: 'file' }, false))
      .toBe('@"docs/design notes.md"')
    expect(formatFileMention({ path: 'docs/design notes', kind: 'directory' }, false))
      .toBe('@"docs/design notes/')
    expect(formatFileMention({ path: 'README.md', kind: 'file' }, true)).toBe('@"README.md"')
    expect(formatFileMention({ path: 'bad\nname', kind: 'file' }, false)).toBeUndefined()
    expect(formatFileMention({ path: 'bad "name".md', kind: 'file' }, false)).toBeUndefined()
    expect(formatFileMention({ path: 'bad"name.md', kind: 'file' }, false)).toBeUndefined()
  })
})

describe('WorkspaceFileSearch', () => {
  it('lists live directory levels, descends, quotes spaces, and filters hidden/excluded entries', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = await workspace()
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = search(root)
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = new AbortController().signal

    expect(await files.list('', signal)).toEqual([
      { path: 'docs', kind: 'directory' },
      { path: 'src', kind: 'directory' },
      { path: 'README.md', kind: 'file' },
    ])
    expect(await files.list('src/', signal)).toEqual([
      { path: 'src/terminal-view.ts', kind: 'file' },
      { path: 'src/tui.spec.ts', kind: 'file' },
    ])
    expect(await files.list('src/ts', signal)).toEqual([
      { path: 'src/tui.spec.ts', kind: 'file' },
      { path: 'src/terminal-view.ts', kind: 'file' },
    ])
    expect(await files.list('docs/design n', signal)).toEqual([
      { path: 'docs/design notes.md', kind: 'file' },
    ])
    expect(await files.list('node_modules/', signal)).toEqual([])
    expect(await files.list('.hidden/', signal)).toEqual([
      { path: '.hidden/secret.txt', kind: 'file' },
    ])
    /** 中文说明：测试局部值 absoluteSrc，由紧邻初始化决定。 */
    const absoluteSrc = `${join(root, 'src').replaceAll('\\', '/')}/`
    expect(await files.list(`${absoluteSrc}tui`, signal)).toEqual([
      { path: `${absoluteSrc}tui.spec.ts`, kind: 'file' },
      { path: `${absoluteSrc}terminal-view.ts`, kind: 'file' },
    ])
    expect(await files.list('~/.dsh-file-autocomplete-missing/', signal)).toEqual([])
    expect(await files.list('../', signal)).toEqual([])
    expect(await files.list('README.md/', signal)).toEqual([])
  })

  it('does not traverse directory symlinks during direct completion', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = await workspace()
    /** 中文说明：测试局部值 outside，由紧邻初始化决定。 */
    const outside = await mkdtemp(join(tmpdir(), 'dsh-file-autocomplete-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'outside-secret.txt'), 'secret')
    await symlink(
      outside,
      join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = search(root)
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = new AbortController().signal

    expect(await files.list('escape/', signal)).toEqual([])
    expect(await files.list('escape/outside', signal)).toEqual([])
  })

  it('ranks basename and subsequence fuzzy matches across the bounded workspace index', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = await workspace()
    await writeFile(join(root, 'src', 'tspc-helper.ts'), 'helper')
    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = search(root, { maxResults: 2 })
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = new AbortController().signal

    expect(await files.list('tspc', signal)).toEqual([
      { path: 'src/tspc-helper.ts', kind: 'file' },
      { path: 'src/tui.spec.ts', kind: 'file' },
    ])
    expect(await files.list('README.md', signal)).toEqual([
      { path: 'README.md', kind: 'file' },
    ])
    expect(await files.list('terminal', signal)).toEqual([
      { path: 'src/terminal-view.ts', kind: 'file' },
    ])
    expect(await files.list('secret', signal)).toEqual([])
    expect(await files.list('.hidden', signal)).toEqual([
      { path: '.hidden', kind: 'directory' },
      { path: '.hidden/secret.txt', kind: 'file' },
    ])
  })

  it('invalidates cached traversal, enforces the entry cap, and settles disposal', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = await workspace()
    /** 中文说明：测试局部值 capped，由紧邻初始化决定。 */
    const capped = search(root, { maxEntries: 2 })
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = new AbortController().signal
    expect(await capped.list('README', signal)).toEqual([
      { path: 'README.md', kind: 'file' },
    ])

    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = search(root)
    expect(await files.list('fresh-file', signal)).toEqual([])
    await writeFile(join(root, 'fresh-file.ts'), 'fresh')
    expect(await files.list('fresh-file', signal)).toEqual([])
    files.invalidate()
    expect(await files.list('fresh-file', signal)).toEqual([
      { path: 'fresh-file.ts', kind: 'file' },
    ])
    files.dispose()
    expect(await files.list('fresh-file', signal)).toEqual([])
    files.dispose()
  })

  it('cancels individual callers, skips missing directories, and validates limits', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = await workspace()
    expect(() => search(root, { maxResults: 0 })).toThrow('maxResults')
    expect(() => search(root, { maxEntries: 1.5 })).toThrow('maxEntries')
    expect(() => search(root, { excludedDirectories: ['nested/name'] })).toThrow('basenames')

    /** 中文说明：测试局部值 files，由紧邻初始化决定。 */
    const files = search(root)
    expect(await files.list('missing/', new AbortController().signal)).toEqual([])

    /** 中文说明：测试局部值 preAborted，由紧邻初始化决定。 */
    const preAborted = new AbortController()
    preAborted.abort(new Error('pre-aborted'))
    await expect(files.list('tui', preAborted.signal)).rejects.toThrow('pre-aborted')

    files.invalidate()
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = files.list('tui', running.signal)
    running.abort(new Error('superseded'))
    await expect(pending).rejects.toThrow('superseded')

    files.invalidate()
    /** 中文说明：测试局部值 nonErrorAbort，由紧邻初始化决定。 */
    const nonErrorAbort = new AbortController()
    /** 中文说明：测试局部值 nonErrorPending，由紧邻初始化决定。 */
    const nonErrorPending = files.list('tui', nonErrorAbort.signal)
    nonErrorAbort.abort('cancelled')
    await expect(nonErrorPending).rejects.toThrow('file search aborted')
  })
})
