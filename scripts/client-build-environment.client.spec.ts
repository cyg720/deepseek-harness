import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertClientBuildEnvironment,
  clientBuildEnvironmentDefines,
  clientBuildProcessEnvironment,
  officialClientBuildEnvironment,
  readClientBuildRecord,
  repositoryClientBuildEnvironment,
  repositoryCommitHash,
  repositoryGitDirty,
  repositoryVersion,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { clientBundle } from '../packages/client/tsdown.client.ts'

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：常量 PROBE_NAME 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PROBE_NAME = 'DSH_CLIENT_BUILD_TEST'
/** 中文说明：常量 COMMIT_HASH 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const COMMIT_HASH = '0123456789abcdef0123456789abcdef01234567'
/** 中文说明：常量 PROBE_KEY 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PROBE_KEY = `process.env.${PROBE_NAME}`
/** 中文说明：变量 originalProbe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const originalProbe = process.env[PROBE_NAME]
/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
/** 中文说明：变量 dshBuildWorkflows 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const dshBuildWorkflows = [
  'build-exe-for-python-sdk.yml',
  'ci.yml',
  'e2b-e2e.yml',
  'e2e.yml',
  'release.yml',
  'release-publish.yml',
  'sandbox.yml',
]

afterEach(() => {
  if (originalProbe === undefined) Reflect.deleteProperty(process.env, PROBE_NAME)
  else process.env[PROBE_NAME] = originalProbe
  vi.resetModules()
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const fixtureRoot of roots.splice(0)) rmSync(fixtureRoot, { recursive: true, force: true })
})

/** 中文说明：函数 write 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** 中文说明：函数 buildFixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function buildFixture(environment: Record<string, string>): string {
  /** 中文说明：变量 fixtureRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'dsh-client-build-'))
  roots.push(fixtureRoot)
  write(join(fixtureRoot, 'apps/web/dist/index.html'), '<main></main>')
  write(join(fixtureRoot, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(fixtureRoot, environment)
  return fixtureRoot
}

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function repositoryFixture(version = '1.2.3-rc.4'): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'dsh-client-build-repository-'))
  roots.push(fixtureRoot)
  write(join(fixtureRoot, 'package.json'), `${JSON.stringify({ version })}\n`)
  write(join(fixtureRoot, 'tracked.txt'), 'committed\n')
  git(fixtureRoot, ['init'])
  git(fixtureRoot, ['config', 'user.name', 'DSH test'])
  git(fixtureRoot, ['config', 'user.email', 'dsh-test@example.invalid'])
  git(fixtureRoot, ['add', 'package.json', 'tracked.txt'])
  git(fixtureRoot, ['commit', '-m', 'fixture'])
  return fixtureRoot
}

describe('client build environment', () => {
  it('requires an exact public environment for a named artifact profile', () => {
    /** 中文说明：变量 expected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expected = {
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_TITLE: 'DeepSeek Harness',
      DSH_CLIENT_VERSION: '1.2.3',
    } as const

    expect(() => { assertClientBuildEnvironment({ PATH: '/bin', ...expected }, expected) }).not.toThrow()
    expect(() => { assertClientBuildEnvironment({}, expected) }).toThrow(/DSH_CLIENT_TITLE/)
    expect(() => { assertClientBuildEnvironment({ DSH_CLIENT_TITLE: 'Other' }, expected) }).toThrow(/DSH_CLIENT_TITLE/)
    expect(() => {
      assertClientBuildEnvironment({ ...expected, DSH_CLIENT_UNDECLARED: 'value' }, expected)
    }).toThrow(/DSH_CLIENT_UNDECLARED/)
  })

  it('inherits public values by default and isolates an explicit official profile', () => {
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = {
      PATH: '/bin',
      DSH_BUILD_CLIENT_PROFILE: 'official',
      DSH_CLIENT_BUILD_PROFILE: 'local',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_GIT_DIRTY: 'true',
      DSH_CLIENT_TITLE: 'Local title',
      DSH_CLIENT_VERSION: '1.2.3',
      DSH_CLIENT_EXTRA: 'local-extra',
    }

    expect(resolveClientBuildEnvironment({ DSH_CLIENT_TITLE: 'Local title' })).toEqual({
      DSH_CLIENT_TITLE: 'Local title',
    })
    expect(resolveClientBuildEnvironment(parent)).toEqual({
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_TITLE: 'DeepSeek Harness',
      DSH_CLIENT_VERSION: '1.2.3',
    })
    expect(() => {
      resolveClientBuildEnvironment({ DSH_BUILD_CLIENT_PROFILE: 'official' })
    }).toThrow(/DSH_CLIENT_COMMIT_HASH/)
    expect(() => {
      resolveClientBuildEnvironment({
        DSH_BUILD_CLIENT_PROFILE: 'official',
        DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      })
    }).toThrow(/DSH_CLIENT_VERSION/)
    expect(() => { resolveClientBuildEnvironment({}, 'unknown') }).toThrow(/unknown client build profile/)
    expect(clientBuildProcessEnvironment(parent, {
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_TITLE: 'DeepSeek Harness',
      DSH_CLIENT_VERSION: '1.2.3',
    })).toEqual({
      PATH: '/bin',
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_TITLE: 'DeepSeek Harness',
      DSH_CLIENT_VERSION: '1.2.3',
    })
    expect(repositoryCommitHash('/unused', { DSH_CLIENT_COMMIT_HASH: COMMIT_HASH })).toBe(COMMIT_HASH.slice(0, 7))
  })

  it('owns repository version, commit, and dirty metadata for complete builds', () => {
    const fixtureRoot = repositoryFixture()
    const commit = git(fixtureRoot, ['rev-parse', '--short=7', 'HEAD'])

    expect(repositoryVersion(fixtureRoot)).toBe('1.2.3-rc.4')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH,
      DSH_CLIENT_EXTRA: 'preserved',
      DSH_CLIENT_GIT_DIRTY: 'true',
      DSH_CLIENT_VERSION: 'spoofed',
    })).toEqual({
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_EXTRA: 'preserved',
      DSH_CLIENT_VERSION: '1.2.3-rc.4',
    })
    expect(officialClientBuildEnvironment(fixtureRoot)).toEqual({
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: commit,
      DSH_CLIENT_TITLE: 'DeepSeek Harness',
      DSH_CLIENT_VERSION: '1.2.3-rc.4',
    })

    write(join(fixtureRoot, '.gitignore'), 'ignored.txt\n')
    git(fixtureRoot, ['add', '.gitignore'])
    git(fixtureRoot, ['commit', '-m', 'ignore fixture'])
    write(join(fixtureRoot, 'ignored.txt'), 'ignored\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    rmSync(join(fixtureRoot, 'ignored.txt'))

    write(join(fixtureRoot, 'tracked.txt'), 'unstaged\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    write(join(fixtureRoot, 'tracked.txt'), 'committed\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)

    write(join(fixtureRoot, 'tracked.txt'), 'staged\n')
    git(fixtureRoot, ['add', 'tracked.txt'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    git(fixtureRoot, ['commit', '-m', 'staged fixture'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)

    write(join(fixtureRoot, 'untracked.txt'), 'untracked\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH,
    })).toEqual({
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_GIT_DIRTY: 'true',
      DSH_CLIENT_VERSION: '1.2.3-rc.4',
    })

    rmSync(join(fixtureRoot, 'untracked.txt'))
    const submoduleSource = repositoryFixture('9.8.7')
    git(fixtureRoot, ['-c', 'protocol.file.allow=always', 'submodule', 'add', submoduleSource, 'submodule'])
    git(fixtureRoot, ['commit', '-am', 'submodule fixture'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    write(join(fixtureRoot, 'submodule/tracked.txt'), 'modified submodule\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
  })

  it('omits dirty metadata when repository metadata is unavailable', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'dsh-client-build-no-git-'))
    roots.push(fixtureRoot)
    write(join(fixtureRoot, 'package.json'), '{"version":"2.0.0"}\n')

    expect(repositoryGitDirty(fixtureRoot)).toBeUndefined()
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH,
      DSH_CLIENT_GIT_DIRTY: 'true',
    })).toEqual({
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_VERSION: '2.0.0',
    })
  })

  it('defines only public client values over a non-enumerable fallback', () => {
    expect(clientBuildEnvironmentDefines({
      PATH: '/bin',
      DSH_TEST_API_KEY: 'secret',
      DSH_CLIENT_VARIANT: 'quoted "value"',
      DSH_CLIENT_EMPTY: '',
      DSH_CLIENT_UNSET: undefined,
    })).toEqual({
      'process.env': '{}',
      'process.env.DSH_CLIENT_EMPTY': '""',
      'process.env.DSH_CLIENT_VARIANT': '"quoted \\"value\\""',
    })
  })

  it('feeds the same build-process value to dynamic tsdown bundles and the Vite shell', async () => {
    process.env[PROBE_NAME] = 'shared-value'

    /** 中文说明：变量 configs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configs = clientBundle('@deepseek-ai/dsh-client-ui-sidebar', [
      'lib/types/index.js',
      'lib/types/invariant.js',
    ])({ env: { DSH_BUILD_FACE: 'client' } })
    if (!Array.isArray(configs)) throw new TypeError('client bundle config must be an array')
    /** 中文说明：函数值 dynamic 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const dynamic = configs.find(config => config.name === '@deepseek-ai/dsh-client-ui-sidebar/client')
    expect(dynamic?.define).toMatchObject({
      'process.env': '{}',
      [PROBE_KEY]: '"shared-value"',
    })

    /** 中文说明：变量 viteConfigPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const viteConfigPath = '../apps/web/vite.config.ts'
    /** 中文说明：变量 viteModule 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const viteModule: unknown = await import(viteConfigPath)
    if (typeof viteModule !== 'object' || viteModule === null) {
      throw new TypeError('web Vite config module must be an object')
    }
    /** 中文说明：变量 viteConfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const viteConfig: unknown = Reflect.get(viteModule, 'default')
    if (typeof viteConfig === 'function') throw new TypeError('web Vite config must be an object')
    if (typeof viteConfig !== 'object' || viteConfig === null) {
      throw new TypeError('web Vite config must be an object')
    }
    expect(Reflect.get(viteConfig, 'define')).toMatchObject({
      'process.env': '{}',
      [PROBE_KEY]: '"shared-value"',
    })
  })

  it('binds the recorded environment to a complete set of client artifacts', () => {
    /** 中文说明：变量 officialEnvironment 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const officialEnvironment = {
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      DSH_CLIENT_TITLE: 'DeepSeek Harness',
      DSH_CLIENT_VERSION: '1.2.3',
    }
    /** 中文说明：变量 official 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const official = buildFixture(officialEnvironment)
    /** 中文说明：变量 defaultBuild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const defaultBuild = buildFixture({})

    expect(readClientBuildRecord(official, officialEnvironment).environment).toEqual(officialEnvironment)
    expect(() => { readClientBuildRecord(defaultBuild, officialEnvironment) }).toThrow(/DSH_CLIENT_/)
    expect(() => { readClientBuildRecord(join(defaultBuild, 'missing')) }).toThrow(/record.*missing/)

    write(join(official, 'apps/web/dist/index.html'), '<main>changed</main>')
    expect(() => { readClientBuildRecord(official) }).toThrow(/artifacts differ/)
  })

  it('keeps public client values out of workflow-wide environments', () => {
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const name of dshBuildWorkflows) {
      /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const path = `.github/workflows/${name}`
      /** 中文说明：变量 document 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const document: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
      if (typeof document !== 'object' || document === null || Array.isArray(document)) {
        throw new TypeError(`${path} must contain a workflow object`)
      }
      expect(JSON.stringify(document), path).not.toContain('DSH_CLIENT_')
    }
  })
})
