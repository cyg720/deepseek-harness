/** Release family discovery, publish order, tag naming, and the bump judgements. */
/*
 * 文件职责：验证 families.spec.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { officialClientBuildEnvironment, writeClientBuildRecord } from '../client-build-environment.ts'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { compareVersions, nextVendorVersion, planShared, reachesPayload } from './bump.ts'

/**
 * A release member standing in for a manifest on disk.
 * @param directory - repository-relative package directory.
 * @param name - package name.
 * @param manifest - manifest fields the subject reads.
 * @returns The member.
 */
/* 中文说明：函数 member 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function member(directory: string, name: string, manifest: Record<string, unknown> = {}): ReleaseMember {
  return { directory, name, version: '0.0.1', manifest }
}

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []

/** 中文说明：函数 write 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** 中文说明：函数 buildFixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function buildFixture(environment: Record<string, string>): string {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-release-build-'))
  roots.push(root)
  write(join(root, 'apps/web/dist/index.html'), '<main></main>')
  write(join(root, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(root, environment)
  return root
}

afterEach(() => {
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('release families', () => {
  it('excludes private experimental packages from the dsh release', () => {
    /** 中文说明：变量 members 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const members = releaseFamily('dsh').members(resolve(import.meta.dirname, '../..'))

    expect(members.some(member => member.directory.startsWith('packages/experimental/'))).toBe(false)
    expect(members.map(member => member.name)).not.toContain('@deepseek-ai/dsh-experimental-agent-team')
  })

  it('bumps private dsh packages without adding release tags', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-release-version-'))
    roots.push(root)
    write(join(root, 'package.json'), '{"version":"0.0.1"}\n')
    write(join(root, 'packages/experimental/prototype/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/core/unselected/package.json'), '{"version":"0.0.1"}\n')

    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 published 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const published = member('packages/core/published', '@deepseek-ai/dsh-published')
    const { planned } = planShared(dsh, root, [published], '0.0.2')

    expect(planned.map(entry => ({ path: entry.manifestPath, tag: entry.tag }))).toEqual([
      { path: 'package.json', tag: undefined },
      { path: 'packages/core/published/package.json', tag: 'dsh-v0.0.2' },
      { path: 'packages/experimental/prototype/package.json', tag: undefined },
    ])
  })

  it('names one tag for the whole dsh family and one per vendored package', () => {
    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 vendor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const vendor = releaseFamily('vendor')
    /** 中文说明：变量 cli 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cli = member('apps/cli', '@deepseek-ai/dsh')
    /** 中文说明：变量 cordis 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cordis = { ...member('vendor/cordis', '@deepseek-ai/cordis'), version: '4.0.1' }

    expect(dsh.tagFor(cli)).toBe('dsh-v0.0.1')
    expect(vendor.tagFor(cordis)).toBe('vendor-cordis-v4.0.1')
    // The prefix is constructed, not recovered from a tag: a version with a
    // hyphen would defeat any suffix-stripping.
    expect(vendor.tagPrefixFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v')
    expect(vendor.tagFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v4.0.0-rc.7')
  })

  it('rejects a family whose members disagree on the shared version', () => {
    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 members 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const members = [member('apps/cli', '@deepseek-ai/dsh'), { ...member('apps/web', '@deepseek-ai/dsh-web-frontend'), version: '0.0.2' }]

    expect(() => { dsh.verifyVersions(members) }).toThrow(/must share one version/)
    expect(() => { dsh.verifyVersions([members[0]!]) }).not.toThrow()
  })

  it('accepts independent vendored versions and rejects an unpublishable one', () => {
    /** 中文说明：变量 vendor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const vendor = releaseFamily('vendor')
    /** 中文说明：变量 members 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const members = [
      { ...member('vendor/cordis', '@deepseek-ai/cordis'), version: '4.0.1' },
      { ...member('vendor/cosmokit', '@deepseek-ai/cosmokit'), version: '1.8.2' },
    ]

    expect(() => { vendor.verifyVersions(members) }).not.toThrow()
    expect(() => { vendor.verifyVersions([{ ...members[0]!, version: 'latest' }]) }).toThrow(/unpublishable version/)
  })

  it('requires a current official client build only for dsh artifacts', () => {
    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 vendor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const vendor = releaseFamily('vendor')
    /** 中文说明：变量 officialEnvironment 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const officialEnvironment = officialClientBuildEnvironment(resolve(import.meta.dirname, '../..'))
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', officialEnvironment.DSH_CLIENT_COMMIT_HASH)
    /** 中文说明：变量 official 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const official = buildFixture(officialEnvironment)
    /** 中文说明：变量 defaultBuild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const defaultBuild = buildFixture({})

    expect(() => { dsh.verifyBuildArtifacts(official) }).not.toThrow()
    expect(() => { dsh.verifyBuildArtifacts(defaultBuild) }).toThrow(/DSH_CLIENT_TITLE/)
    expect(() => { dsh.verifyBuildArtifacts(join(defaultBuild, 'missing')) }).toThrow(/record.*missing/)
    expect(() => { vendor.verifyBuildArtifacts(join(defaultBuild, 'missing')) }).not.toThrow()

    write(join(official, 'packages/client/example/lib/client.js'), 'module.exports = { changed: true }\n')
    expect(() => { dsh.verifyBuildArtifacts(official) }).toThrow(/artifacts differ/)
  })

  it('publishes a dependency before its consumer, and orders ties by name', () => {
    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 members 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const members = [
      member('packages/a/consumer', '@deepseek-ai/dsh-consumer', { dependencies: { '@deepseek-ai/dsh-library': 'workspace:^' } }),
      member('packages/a/library', '@deepseek-ai/dsh-library'),
      member('packages/a/zebra', '@deepseek-ai/dsh-zebra'),
    ]

    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-library',
      '@deepseek-ai/dsh-consumer',
      '@deepseek-ai/dsh-zebra',
    ])
  })

  it('reports a runtime dependency cycle instead of emitting an arbitrary order', () => {
    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 members 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const members = [
      member('packages/a/left', '@deepseek-ai/dsh-left', { dependencies: { '@deepseek-ai/dsh-right': 'workspace:^' } }),
      member('packages/a/right', '@deepseek-ai/dsh-right', { dependencies: { '@deepseek-ai/dsh-left': 'workspace:^' } }),
    ]

    expect(() => { dsh.publishOrder(members) }).toThrow(/dependency cycle/)
  })

  it('publishes a peer before its consumer', () => {
    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 members 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const members = [
      member('packages/a/consumer', '@deepseek-ai/dsh-consumer', { peerDependencies: { '@deepseek-ai/dsh-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@deepseek-ai/dsh-zebra'),
    ]

    // Name order alone would place the consumer first; the peer edge moves it.
    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-zebra',
      '@deepseek-ai/dsh-consumer',
    ])
  })

  it('orders around a peer cycle rather than refusing to publish, and reports the edge it dropped', () => {
    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 members 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const members = [
      member('packages/a/left', '@deepseek-ai/dsh-left', { peerDependencies: { '@deepseek-ai/dsh-right': 'workspace:^' } }),
      member('packages/a/right', '@deepseek-ai/dsh-right', { peerDependencies: { '@deepseek-ai/dsh-left': 'workspace:^' } }),
    ]

    // Sibling packages declare each other as peers, and npm treats an unmet peer
    // as a warning, so this pair has to publish rather than fail the release.
    /** 中文说明：变量 plan 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plan = dsh.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-right',
      '@deepseek-ai/dsh-left',
    ])
    // One of the two edges has to give, and which one it is belongs in the log.
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@deepseek-ai/dsh-right', peer: '@deepseek-ai/dsh-left' },
    ])
  })

  it('honours an install edge even when a peer cycle surrounds it', () => {
    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 members 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const members = [
      member('packages/a/base', '@deepseek-ai/dsh-base', { peerDependencies: { '@deepseek-ai/dsh-consumer': 'workspace:^' } }),
      member('packages/a/consumer', '@deepseek-ai/dsh-consumer', {
        dependencies: { '@deepseek-ai/dsh-base': 'workspace:^' },
        peerDependencies: { '@deepseek-ai/dsh-base': 'workspace:^' },
      }),
    ]

    // The install edge is absolute: base publishes first, and the peer edge that
    // would reverse it is the one dropped.
    /** 中文说明：变量 plan 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plan = dsh.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-consumer',
    ])
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@deepseek-ai/dsh-base', peer: '@deepseek-ai/dsh-consumer' },
    ])
  })

  it('refuses an order that would publish a consumer before a dependency it installs', () => {
    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 members 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const members = [
      member('packages/a/alpha', '@deepseek-ai/dsh-alpha', { peerDependencies: { '@deepseek-ai/dsh-bravo': 'workspace:^' } }),
      member('packages/a/bravo', '@deepseek-ai/dsh-bravo', { peerDependencies: { '@deepseek-ai/dsh-charlie': 'workspace:^' } }),
      member('packages/a/charlie', '@deepseek-ai/dsh-charlie', { dependencies: { '@deepseek-ai/dsh-alpha': 'workspace:^' } }),
    ]

    // A cycle of two peer edges closed by one install edge: dropping a peer edge
    // would order this, and the traversal drops the install edge instead. That
    // order would publish charlie before the alpha it installs, so it is refused
    // here rather than published.
    expect(() => { dsh.publishOrder(members) }).toThrow(/no publish order honours @deepseek-ai\/dsh-charlie -> @deepseek-ai\/dsh-alpha/)
  })

  it('ignores devDependencies when ordering', () => {
    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 members 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const members = [
      member('packages/a/alpha', '@deepseek-ai/dsh-alpha', { devDependencies: { '@deepseek-ai/dsh-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@deepseek-ai/dsh-zebra'),
    ]

    // A dev dependency is absent from the published package, so it must not move
    // the consumer behind it.
    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-alpha',
      '@deepseek-ai/dsh-zebra',
    ])
  })

  it('applies the harness payload policy to dsh and keeps upstream payloads for vendored packages', () => {
    /** 中文说明：变量 dsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dsh = releaseFamily('dsh')
    /** 中文说明：变量 vendor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const vendor = releaseFamily('vendor')
    /** 中文说明：变量 harness 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const harness = member('packages/a/library', '@deepseek-ai/dsh-library')
    /** 中文说明：变量 vendored 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const vendored = member('vendor/cordis', '@deepseek-ai/cordis')

    expect(() => { dsh.validatePayload(harness, ['package/lib/index.js', 'package/src/index.ts']) })
      .toThrow(/publishes source file/)
    expect(() => { vendor.validatePayload(vendored, ['package/lib/index.js', 'package/src/index.ts']) }).not.toThrow()
    expect(() => { vendor.validatePayload(vendored, []) }).toThrow(/empty tarball/)
  })

  it('drives the installed entry only for the family that publishes one', () => {
    expect(releaseFamily('dsh').installedEntry).toEqual({ packageName: '@deepseek-ai/dsh', binPath: 'lib/bin.js' })
    expect(releaseFamily('vendor').installedEntry).toBeUndefined()
  })

  it('rejects an unknown family identifier', () => {
    expect(() => { releaseFamily('native') }).toThrow(/unknown release family/)
  })
})

describe('vendored version baseline', () => {
  it('drops an upstream prerelease segment and increments the patch', () => {
    expect(nextVendorVersion('4.0.0-rc.7', undefined)).toBe('4.0.1')
    expect(nextVendorVersion('1.0.0-rc.5', undefined)).toBe('1.0.1')
    expect(nextVendorVersion('1.8.1', undefined)).toBe('1.8.2')
  })

  it('increments from the last published version when a re-sync restored a lower one', () => {
    // Upstream moved rc.7 -> rc.8 after this repository published 4.0.1;
    // incrementing the manifest alone would name 4.0.1 a second time.
    expect(nextVendorVersion('4.0.0-rc.8', '4.0.1')).toBe('4.0.2')
    expect(nextVendorVersion('4.1.0', '4.0.1')).toBe('4.1.1')
  })

  it('appends a rehearsal prerelease without consuming its release numbers', () => {
    // A rehearsal burns 4.0.1-rc.1 and leaves 4.0.1 free, so the stable release
    // that follows takes those same numbers instead of skipping to 4.0.2.
    expect(nextVendorVersion('4.0.0-rc.7', undefined, 'rc.1')).toBe('4.0.1-rc.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1', 'rc.2')).toBe('4.0.1-rc.2')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1')).toBe('4.0.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1')).toBe('4.0.2')
  })
})

describe('version precedence', () => {
  it('ranks a release above the prerelease it follows', () => {
    // git --sort=v:refname disagrees, placing 4.0.1-rc.1 above 4.0.1, which is
    // why the newest published version is chosen here rather than by git.
    expect(compareVersions('4.0.1', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('compares numeric prerelease fields numerically', () => {
    expect(compareVersions('4.0.1-rc.10', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.2', '4.0.1-rc.10')).toBeLessThan(0)
  })

  it('ranks a numeric field below an alphanumeric one, and a shorter list below a longer', () => {
    expect(compareVersions('4.0.1-1', '4.0.1-alpha')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.2', '4.0.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1-rc.1')).toBe(0)
  })
})

describe('payload change judgement', () => {
  /** 中文说明：变量 sourceShipping 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceShipping = member('vendor/cosmokit', '@deepseek-ai/cosmokit', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'src'],
  })
  /** 中文说明：变量 buildOutputOnly 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const buildOutputOnly = member('vendor/cordis', '@deepseek-ai/cordis', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'bin.js'],
  })

  it('counts the manifest and the files npm always publishes', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/package.json')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.md')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/src/index.ts')).toBe(true)
  })

  it('counts build inputs for a package whose payload is build output', () => {
    // cordis publishes lib/ only, and lib/ is not tracked: without this, a real
    // source change reads as "nothing changed" and the next publish fails on a
    // version whose bytes moved.
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/src/context.ts')).toBe(true)
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/tsconfig.json')).toBe(true)
  })

  it('ignores paths no tarball carries', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/tests/unit.spec.ts')).toBe(false)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/CHANGELOG.md')).toBe(false)
    // The README pattern is deliberately loose: over-reporting a change costs one
    // unnecessary patch bump, while under-reporting fails the next publish on a
    // version whose bytes moved.
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.i18n.yaml')).toBe(true)
    expect(reachesPayload(member('packages/a/library', '@deepseek-ai/dsh-library', { files: ['lib/index.js'] }),
      'packages/a/library/tests/library.spec.ts')).toBe(false)
  })
})
