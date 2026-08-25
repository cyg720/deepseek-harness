/**
 * 文件职责：验证 packed-install.e2e.ts 覆盖的沙箱策略、平台隔离与失败行为。
 * 技术维度：使用 TypeScript、Vitest、平台进程接口和受控文件系统资源。
 * 产品维度：保障 Agent 执行命令时遵循预期权限并给出可诊断失败。
 * 逻辑维度：准备策略和临时资源，启动受限操作，再核对结果、错误与清理。
 * 关键边界：平台能力可能缺失；安全失败必须显式；进程与临时资源必须完全释放。
 * 新手阅读建议：先读平台条件和夹具，再看允许/拒绝场景，最后阅读清理逻辑。
 */
import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Keyless publish-path rehearsal. It packs the provider, its workspace peers, the vendored framework
 * peer, and the current repository's Landlock entry/platform packages, then installs those exact
 * tarballs in an external plain-Node consumer. The host launcher comes from the exact local tarballs,
 * so no registry copy, tsx, path mapping, or workspace resolution can hide missing files, dependency
 * errors, or lost executable modes. npm may still query registry metadata for an incompatible optional platform
 * package that cannot supply the host launcher.
 *
 * The installed launcher must match the host architecture, remain executable, and either confine a
 * real process with bwrap disabled or fail closed on a non-enforcing kernel. Skips off Linux or
 * before the harness and native packages are built.
 */

/** 中文说明：变量 packageDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packageDir = fileURLToPath(new URL('..', import.meta.url))
/** 中文说明：变量 repoRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))
/** 中文说明：变量 nativeDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const nativeDir = join(repoRoot, 'native/landlock-run')
/** 中文说明：变量 sourceLauncher 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const sourceLauncher = join(nativeDir, 'packages', `linux-${process.arch}`, 'bin', 'landlock-run')
/** 中文说明：变量 platformPackageName 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const platformPackageName = `@deepseek-ai/node-addon-landlock-run-linux-${process.arch}`

/** The harness closure the consumer needs; native tarballs are packed through their mode-preserving release script. */
/** 中文说明：常量 WORKSPACE_CLOSURE 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const WORKSPACE_CLOSURE = [
  'packages/sandbox/sandbox-local',
  // sandbox-local's win32 chain rung is a runtime dependency: a packed
  // consumer resolves it like any other @deepseek-ai peer (koffi arrives
  // from the registry).
  'packages/sandbox/sandbox-windows-acl',
  'packages/sandbox/sandbox',
  'packages/core/session',
  'packages/core/scope',
  'packages/llm/llm',
  'packages/typert/protocol',
  'packages/attachment/attachment',
  'packages/util/brand',
  'packages/util/timeout',
  'packages/runtime-diagnostics/invariants',
  // The framework and the vendored packages the closure declares outright:
  // rescoped into @deepseek-ai, so the consumer installs this repository's
  // copies. Schemastery is a hard dependency of three members above, not a
  // peer, so npm resolves it while installing them.
  'vendor/cordis',
  'vendor/cosmokit',
  'vendor/schemastery',
]

/** ELF `e_machine` (offset 18, LE) for this host: x86-64 = 62, AArch64 = 183. */
/** 中文说明：常量 E_MACHINE 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const E_MACHINE = { x64: 62, arm64: 183 }[process.arch as 'x64' | 'arm64']

/** 中文说明：变量 packable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packable = process.platform === 'linux'
  && E_MACHINE !== undefined
  && existsSync(join(packageDir, 'lib', 'index.js'))
  && existsSync(join(nativeDir, 'packages/entry/lib/index.js'))
  && existsSync(sourceLauncher)

/** 中文说明：变量 consumerDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let consumerDir = ''
/** 中文说明：变量 workDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let workDir = ''
/** The consumer script's JSON verdict (see its source below). */
/** 中文说明：变量 verdict 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let verdict: {
  launcher: string
  launcherExists: boolean
  enforcing: boolean
  wrapArgv0?: string
  enforcement?: string
  exitCode?: number | null
  stderrHasDialect?: boolean
  confineOutcome?: string
} = { launcher: '', launcherExists: false, enforcing: false }

describe.skipIf(!packable)('sandbox-local: packed-tarball distribution (publish-path rehearsal)', () => {
  beforeAll(async () => {
    /** 中文说明：变量 packDest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packDest = mkdtempSync(join(tmpdir(), 'dsh-pack-'))
    consumerDir = mkdtempSync(join(tmpdir(), 'dsh-packed-consumer-'))
    workDir = mkdtempSync(join(tmpdir(), 'dsh-packed-work-'))

    /** 中文说明：变量 nativePackDest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nativePackDest = join(packDest, 'native')
    /** 中文说明：变量 nativePack 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nativePack = spawnSync('node', ['./scripts/pack-release.mjs', nativePackDest, '--current-platform-only'], {
      cwd: nativeDir,
      encoding: 'utf8',
      timeout: 120_000,
    })
    expect(nativePack.status, `native pack failed:\n${nativePack.stdout}\n${nativePack.stderr}`).toBe(0)

    /** 中文说明：变量 nativeTarballs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nativeTarballs = readFileSync(join(nativePackDest, 'publish-order.txt'), 'utf8')
      .trim()
      .split('\n')
      .map(tarball => join(nativePackDest, tarball))

    // Pack each harness closure member with the exact bytes publish would upload.
    /** 中文说明：变量 tarballs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tarballs: string[] = []
    /** 中文说明：该循环依次处理权限或资源数据；循环变量仅在当前循环中有效。 */
    for (const pkg of WORKSPACE_CLOSURE) {
      /** 中文说明：变量 pack 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const pack = spawnSync('pnpm', ['pack', '--pack-destination', packDest], {
        cwd: join(repoRoot, pkg),
        encoding: 'utf8',
        timeout: 120_000,
      })
      expect(pack.status, `pnpm pack failed for ${pkg}:\n${pack.stdout}\n${pack.stderr}`).toBe(0)
      /** 中文说明：变量 lines 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const lines = pack.stdout.trim().split('\n')
      tarballs.push(lines[lines.length - 1] as string)
    }
    tarballs.push(...nativeTarballs)

    // Peer ranges resolve to the tarballs, the framework peer included. Do not omit optional
    // dependencies because the launcher selects its OS/CPU package through one.
    writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({ name: 'dsh-packed-consumer', private: true, type: 'module' }))
    /** 中文说明：变量 install 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const install = spawnSync('npm', ['install', '--no-audit', '--no-fund', ...tarballs], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 300_000,
    })
    expect(install.status, `npm install failed:\n${install.stdout}\n${install.stderr}`).toBe(0)

    // The consumer script runs under PLAIN node against the installed
    // packages and reports a JSON verdict; every assertion happens back in
    // the test. bwrap is forced off so the wrap must select the INSTALLED
    // launcher; a non-enforcing kernel must surface the fail-closed error.
    writeFileSync(join(consumerDir, 'consumer.mjs'), `
      import { spawnSync } from 'node:child_process'
      import { existsSync } from 'node:fs'
      import { Context } from '@deepseek-ai/cordis'
      import { launcherPath } from '@deepseek-ai/node-addon-landlock-run'
      import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
      const ctx = new Context()
      await ctx.plugin(LocalSandboxProvider, {})
      const sandbox = ctx.sandbox
      sandbox.internals = { probeBwrap: () => false }
      const launcher = launcherPath()
      const probe = spawnSync(launcher, ['--probe'], { encoding: 'utf8', timeout: 5000 })
      const out = { launcher, launcherExists: existsSync(launcher), enforcing: probe.status === 0 }
      const workdir = process.argv[2]
      if (out.enforcing) {
        const confined = sandbox.confine(['bash', '-c', \`echo hi > \${workdir}/denied.txt\`], { mode: 'read-only', workspaceRoot: workdir })
        out.wrapArgv0 = confined.argv[0]
        out.enforcement = confined.enforcement
        const run = spawnSync(confined.argv[0], confined.argv.slice(1), { encoding: 'utf8', timeout: 30000 })
        out.exitCode = run.status
        out.stderrHasDialect = /permission denied/i.test(run.stderr)
      } else {
        try {
          sandbox.confine(['true'], { mode: 'read-only', workspaceRoot: workdir })
          out.confineOutcome = 'wrapped'
        } catch (error) {
          out.confineOutcome = error?.code === 'SANDBOX_UNAVAILABLE' ? 'fail-closed' : String(error)
        }
      }
      console.log(JSON.stringify(out))
    `)
    /** 中文说明：变量 consumer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const consumer = spawnSync('node', ['consumer.mjs', workDir], { cwd: consumerDir, encoding: 'utf8', timeout: 60_000 })
    expect(consumer.status, `consumer script failed:\n${consumer.stdout}\n${consumer.stderr}`).toBe(0)
    verdict = JSON.parse(consumer.stdout.trim().split('\n').pop() as string) as typeof verdict
  }, 480_000)

  afterAll(async () => {
    await Promise.all([consumerDir, workDir].filter(Boolean).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('installs this checkout\'s launcher for the host: present, executable, byte-identical, and right ELF arch', () => {
    /** 中文说明：变量 installed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const installed = join(consumerDir, 'node_modules', ...platformPackageName.split('/'), 'bin', 'landlock-run')
    expect(existsSync(installed), 'platform package missing from the installed tree').toBe(true)
    // A tarball or extraction step that strips the mode bit would leave the
    // probe failing exactly like a non-enforcing kernel — assert it apart.
    expect(() => { accessSync(installed, constants.X_OK) }, 'installed launcher is not executable').not.toThrow()
    expect(readFileSync(installed), 'installed launcher bytes').toEqual(readFileSync(sourceLauncher))
    expect(readFileSync(installed).readUInt16LE(18), 'ELF e_machine').toBe(E_MACHINE)
  })

  it('the installed provider resolves the launcher INSIDE the consumer node_modules platform package', () => {
    expect(verdict.launcher)
      .toBe(join(consumerDir, 'node_modules', ...platformPackageName.split('/'), 'bin', 'landlock-run'))
  })

  it('confines through the installed launcher (enforcing kernel) or fails closed (non-enforcing) — never unconfined', async () => {
    // Fail-closed is only the acceptable outcome when the installed binary
    // IS present and executable and the kernel merely does not enforce —
    // the first test pins that apart, so nothing hides behind this branch.
    expect(verdict.launcherExists, 'installed launcher missing').toBe(true)
    if (verdict.enforcing) {
      expect(verdict.wrapArgv0).toBe(verdict.launcher)
      expect(['full', 'partial']).toContain(verdict.enforcement)
      expect(verdict.exitCode).not.toBe(0)
      expect(verdict.stderrHasDialect, 'kernel denial text must match the advertised dialect').toBe(true)
      expect(existsSync(join(workDir, 'denied.txt'))).toBe(false)
    } else {
      expect(verdict.confineOutcome).toBe('fail-closed')
    }
  })
})
