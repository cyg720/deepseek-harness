/** Build, publish, and verify one commit-addressed npm workspace baseline. */
/*
 * 文件职责：实现 publish-npm-baseline.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { validateTarballPayload } from './publication-payload.ts'

/** 中文说明：常量 DEFAULT_REGISTRY 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_REGISTRY = 'https://registry.npm.harnessment.com'
/** 中文说明：常量 DEFAULT_OUTPUT_DIRECTORY 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_OUTPUT_DIRECTORY = '.artifacts/npm-baseline'
/** 中文说明：常量 PACKAGE_PATTERNS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PACKAGE_PATTERNS = [
  'vendor/*/package.json',
  'packages/!(experimental)/*/package.json',
  'apps/*/package.json',
] as const
/** 中文说明：常量 DEPENDENCY_SECTIONS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const
/** 中文说明：常量 RELEASE_MANIFEST_NAME 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const RELEASE_MANIFEST_NAME = 'manifest.json'
/** 中文说明：常量 RELEASE_ENTRY_PACKAGE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const RELEASE_ENTRY_PACKAGE = '@deepseek-ai/dsh'
/** 中文说明：常量 LATEST_DIST_TAG 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const LATEST_DIST_TAG = 'latest'
/** 中文说明：常量 POSIX_WEB_PROBE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const POSIX_WEB_PROBE = String.raw`
import errno, os, pty, select, signal, sys, time
node, bin_path, cwd, timeout_seconds = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(node, [node, bin_path, "web", "--no-open", "--host", "127.0.0.1", "--port", "0"], os.environ.copy())

output = bytearray()
ready_seen = False
termination_sent = False
deadline = time.monotonic() + float(timeout_seconds)
status = None
while time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        if chunk:
            output.extend(chunk)

    snapshot = bytes(output)
    if not termination_sent and b"dsh web: http://127.0.0.1:" in snapshot:
        ready_seen = True
        os.kill(pid, signal.SIGTERM)
        termination_sent = True

    waited, candidate = os.waitpid(pid, os.WNOHANG)
    if waited == pid:
        status = candidate
        break

if status is None:
    os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(output)
if not ready_seen:
    sys.stderr.write("installed dsh web did not reach its ready URL\n")
    sys.exit(124)
actual_exit = os.waitstatus_to_exitcode(status)
if actual_exit != 0:
    sys.stderr.write(f"installed dsh web exited {actual_exit}, expected 0\n")
    sys.exit(125)
`

/** 中文说明：interface CommandResult 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface CommandResult {
  status: number
  stdout: string
  stderr: string
}

/** 中文说明：interface PackageTarget 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface PackageTarget {
  name: string
  directory: string
  origin: PackageOrigin
}

/** 中文说明：type PackageOrigin 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type PackageOrigin = 'harness' | 'vendor'

/** 中文说明：interface PackedPackage 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface PackedPackage {
  name: string
  tarball: string
  sha256: string
  integrity: string
  origin: PackageOrigin
}

/** 中文说明：interface ReleaseManifest 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface ReleaseManifest {
  schemaVersion: 1
  commit: string
  version: string
  distTag: string
  registry: string
  packages: PackedPackage[]
}

/** 中文说明：interface PackOptions 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface PackOptions {
  ref: string
  registry: string
  outputDirectory: string
}

/** Fixes the identity of one pack attempt before any expensive work begins. */
/* 中文说明：class BaselinePackPlan 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class BaselinePackPlan {
  constructor(
    readonly commit: string,
    readonly shortCommit: string,
    readonly timestamp: string,
    readonly baseVersion: string,
    readonly version: string,
    readonly distTag: string,
    readonly registry: string,
    readonly artifactDirectory: string,
  ) {}

  async confirm(assumeYes: boolean): Promise<void> {
    console.log('publish-npm-baseline: planned pack')
    console.log(`  commit:    ${this.commit}`)
    console.log(`  timestamp: ${this.timestamp} UTC`)
    console.log(`  version:   ${this.version}`)
    console.log(`  dist-tag:  ${this.distTag}`)
    console.log(`  registry:  ${this.registry}`)
    console.log(`  output:    ${this.artifactDirectory}`)
    if (assumeYes) return
    await confirmEnter(
      'Press Enter to start packing or type anything to cancel: ',
      'pack requires an interactive terminal or --yes',
      'pack cancelled',
    )
  }
}

/** Runs child processes without involving a command shell. */
/* 中文说明：class CommandRunner 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class CommandRunner {
  run(
    command: string,
    args: string[],
    cwd: string,
    environment: NodeJS.ProcessEnv = process.env,
  ): void {
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
      throw new Error(`${formatCommand(command, args)} exited with status ${String(result.status)}`)
    }
  }

  capture(
    command: string,
    args: string[],
    cwd: string,
    environment: NodeJS.ProcessEnv = process.env,
  ): string {
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = this.result(command, args, cwd, environment)
    if (result.status !== 0) throw commandFailure(command, args, result)
    return result.stdout.trim()
  }

  result(
    command: string,
    args: string[],
    cwd: string,
    environment: NodeJS.ProcessEnv = process.env,
  ): CommandResult {
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result: SpawnSyncReturns<string> = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
    })
    if (result.error !== undefined) throw result.error
    return {
      status: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }
}

/** Owns a temporary detached worktree and removes it after staging. */
/* 中文说明：class DetachedWorktree 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class DetachedWorktree {
  private constructor(
    readonly path: string,
    private readonly temporaryRoot: string,
    private readonly repositoryRoot: string,
    private readonly runner: CommandRunner,
  ) {}

  static create(repositoryRoot: string, commit: string, runner: CommandRunner): DetachedWorktree {
    /** 中文说明：变量 temporaryRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-npm-baseline-'))
    /** 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(temporaryRoot, 'worktree')
    try {
      runner.run('git', ['worktree', 'add', '--detach', path, commit], repositoryRoot)
      return new DetachedWorktree(path, temporaryRoot, repositoryRoot, runner)
    } catch (error: unknown) {
      rmSync(temporaryRoot, { recursive: true, force: true })
      throw error
    }
  }

  dispose(): void {
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = this.runner.result(
      'git',
      ['worktree', 'remove', '--force', this.path],
      this.repositoryRoot,
    )
    if (result.status !== 0) {
      console.error(`publish-npm-baseline: could not remove worktree ${this.path}`)
      if (result.stderr.trim() !== '') console.error(result.stderr.trim())
    }
    rmSync(this.temporaryRoot, { recursive: true, force: true })
  }
}

/** Discovers and stages every package published in one repository baseline. */
/* 中文说明：class WorkspacePackageSet 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class WorkspacePackageSet {
  private constructor(
    readonly packages: PackageTarget[],
    readonly baseVersion: string,
  ) {}

  static discover(root: string): WorkspacePackageSet {
    /** 中文说明：变量 manifestPaths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifestPaths = globSync(PACKAGE_PATTERNS, { cwd: root }).sort()
    if (manifestPaths.length === 0) {
      throw new Error('no package manifests found under vendor/, packages/, or apps/')
    }

    /** 中文说明：变量 packages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packages: PackageTarget[] = []
    /** 中文说明：变量 names 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const names = new Set<string>()
    /** 中文说明：变量 baseVersion 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const baseVersion = expectString(readObject(resolve(root, 'package.json')), 'version', 'package.json')
    if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
      throw new Error(`package.json must have a stable X.Y.Z version, got ${baseVersion}`)
    }
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const manifestPath of manifestPaths) {
      /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const manifest = readObject(resolve(root, manifestPath))
      /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const name = expectString(manifest, 'name', manifestPath)
      /** 中文说明：变量 version 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const version = expectString(manifest, 'version', manifestPath)
      /** 中文说明：变量 isVendored 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const isVendored = manifestPath.startsWith('vendor/')
      // Vendored packages are rescoped too (vendor/README.md), so publication
      // never carries an upstream name that would squat it on the registry.
      if (!name.startsWith('@deepseek-ai/')) {
        throw new Error(`${manifestPath} must name an @deepseek-ai package`)
      }
      if (name === '@deepseek-ai/dsh-root') {
        throw new Error(`${manifestPath} unexpectedly selected the workspace root`)
      }
      if (names.has(name)) throw new Error(`duplicate package name: ${name}`)
      if (!isVendored && version !== baseVersion) {
        throw new Error(`${manifestPath} has version ${version}; expected ${baseVersion}`)
      }
      names.add(name)
      packages.push({
        name,
        directory: dirname(manifestPath),
        origin: isVendored ? 'vendor' : 'harness',
      })
    }
    packages.sort((left, right) => left.name.localeCompare(right.name))
    return new WorkspacePackageSet(packages, baseVersion)
  }

  stage(root: string, releaseVersion: string): void {
    /** 中文说明：函数值 internalNames 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const internalNames = new Set(this.packages.map(pkg => pkg.name))
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const target of this.packages) {
      /** 中文说明：变量 manifestPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const manifestPath = resolve(root, target.directory, 'package.json')
      /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const manifest = readObject(manifestPath)
      manifest.version = releaseVersion
      delete manifest.private
      stageInternalDependencies(manifest, internalNames, releaseVersion, manifestPath)
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    }
  }
}

/** Immutable local release bundle consumed by publish and verify. */
/* 中文说明：class ReleaseBundle 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class ReleaseBundle {
  private constructor(
    readonly directory: string,
    readonly manifest: ReleaseManifest,
  ) {}

  static create(
    directory: string,
    expectedPackages: PackageTarget[],
    commit: string,
    version: string,
    distTag: string,
    registry: string,
    runner: CommandRunner,
  ): ReleaseBundle {
    /** 中文说明：函数值 internalNames 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const internalNames = new Set(expectedPackages.map(pkg => pkg.name))
    /** 中文说明：函数值 expectedByName 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const expectedByName = new Map(expectedPackages.map(pkg => [pkg.name, pkg]))
    /** 中文说明：变量 missingNames 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missingNames = new Set(internalNames)
    /** 中文说明：变量 packages 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packages = readdirSync(directory)
      .filter(name => name.endsWith('.tgz'))
      .sort()
      .map((tarball) => {
        /** 中文说明：变量 artifact 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const artifact = inspectTarball(resolve(directory, tarball), runner)
        /** 中文说明：变量 expected 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const expected = expectedByName.get(artifact.name)
        if (expected === undefined || !missingNames.delete(artifact.name)) {
          throw new Error(`unexpected or duplicate packed package: ${artifact.name}`)
        }
        if (expected.origin === 'harness') {
          validateTarballPayload(artifact.files, tarball)
        }
        if (artifact.version !== version) {
          throw new Error(`${tarball} has version ${artifact.version}; expected ${version}`)
        }
        if (artifact.private === true) throw new Error(`${tarball} is still private`)
        if (containsWorkspaceProtocol(artifact.manifest)) {
          throw new Error(`${tarball} still contains a workspace: dependency`)
        }
        validateInternalDependencyPins(artifact.manifest, internalNames, version, tarball)
        return packedPackage(artifact.name, resolve(directory, tarball), expected.origin)
      })
      .sort((left, right) => left.name.localeCompare(right.name))

    if (missingNames.size !== 0) {
      throw new Error(`missing tarballs for: ${[...missingNames].sort().join(', ')}`)
    }
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest: ReleaseManifest = {
      schemaVersion: 1,
      commit,
      version,
      distTag,
      registry,
      packages,
    }
    writeFileSync(resolve(directory, RELEASE_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(
      resolve(directory, 'SHA256SUMS'),
      `${packages.map(pkg => `${pkg.sha256}  ${pkg.tarball}`).join('\n')}\n`,
    )
    return new ReleaseBundle(directory, manifest)
  }

  static load(manifestPath: string, runner: CommandRunner): ReleaseBundle {
    /** 中文说明：变量 absoluteManifestPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const absoluteManifestPath = resolve(manifestPath)
    /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const raw = readObject(absoluteManifestPath)
    if (raw.schemaVersion !== 1) {
      throw new Error(`unsupported release manifest schema: ${String(raw.schemaVersion)}`)
    }
    /** 中文说明：变量 directory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const directory = dirname(absoluteManifestPath)
    /** 中文说明：变量 packageValues 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packageValues = raw.packages
    if (!Array.isArray(packageValues) || packageValues.length === 0) {
      throw new Error('release manifest contains no packages')
    }
    /** 中文说明：函数值 packages 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const packages = packageValues.map((value, index) => parsePackedPackage(value, index))
    /** 中文说明：变量 names 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const names = new Set<string>()
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const pkg of packages) {
      if (names.has(pkg.name)) throw new Error(`duplicate package in release manifest: ${pkg.name}`)
      names.add(pkg.name)
    }
    /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest: ReleaseManifest = {
      schemaVersion: 1,
      commit: expectString(raw, 'commit', RELEASE_MANIFEST_NAME),
      version: expectString(raw, 'version', RELEASE_MANIFEST_NAME),
      distTag: expectString(raw, 'distTag', RELEASE_MANIFEST_NAME),
      registry: normalizeRegistry(expectString(raw, 'registry', RELEASE_MANIFEST_NAME)),
      packages,
    }
    /** 中文说明：变量 bundle 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bundle = new ReleaseBundle(directory, manifest)
    bundle.verifyLocal(runner)
    return bundle
  }

  private verifyLocal(runner: CommandRunner): void {
    /** 中文说明：函数值 internalNames 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const internalNames = new Set(this.manifest.packages.map(pkg => pkg.name))
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const pkg of this.manifest.packages) {
      if (isAbsolute(pkg.tarball) || dirname(pkg.tarball) !== '.' || normalize(pkg.tarball) !== pkg.tarball) {
        throw new Error(`invalid tarball path for ${pkg.name}: ${pkg.tarball}`)
      }
      /** 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const path = resolve(this.directory, pkg.tarball)
      /** 中文说明：变量 actual 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const actual = packedPackage(pkg.name, path, pkg.origin)
      if (actual.sha256 !== pkg.sha256 || actual.integrity !== pkg.integrity) {
        throw new Error(`tarball checksum mismatch: ${pkg.tarball}`)
      }
      /** 中文说明：变量 artifact 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const artifact = inspectTarball(path, runner)
      if (pkg.origin === 'harness') {
        validateTarballPayload(artifact.files, pkg.tarball)
      }
      if (artifact.name !== pkg.name || artifact.version !== this.manifest.version) {
        throw new Error(`tarball identity mismatch: ${pkg.tarball}`)
      }
      if (artifact.private === true) throw new Error(`${pkg.tarball} is still private`)
      if (containsWorkspaceProtocol(artifact.manifest)) {
        throw new Error(`${pkg.tarball} still contains a workspace: dependency`)
      }
      validateInternalDependencyPins(
        artifact.manifest,
        internalNames,
        this.manifest.version,
        pkg.tarball,
      )
    }
  }

  tarballPath(pkg: PackedPackage): string {
    return resolve(this.directory, pkg.tarball)
  }
}

/** Installs one complete bundle outside the workspace and probes the shipped dsh entry. */
/* 中文说明：class InstalledBundleSmoke 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class InstalledBundleSmoke {
  constructor(
    private readonly bundle: ReleaseBundle,
    private readonly runner: CommandRunner,
  ) {}

  run(): void {
    /** 中文说明：变量 consumerRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const consumerRoot = mkdtempSync(join(tmpdir(), 'dsh-npm-consumer-'))
    try {
      /** 中文说明：函数值 dependencies 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const dependencies = Object.fromEntries(this.bundle.manifest.packages.map(pkg => [
        pkg.name,
        pathToFileURL(this.bundle.tarballPath(pkg)).href,
      ]))
      writeFileSync(resolve(consumerRoot, 'package.json'), `${JSON.stringify({
        name: 'dsh-npm-baseline-consumer',
        version: '0.0.0',
        private: true,
        dependencies,
      }, null, 2)}\n`)

      console.log(
        `publish-npm-baseline: installing ${this.bundle.manifest.packages.length} local tarballs`,
      )
      this.runner.run('npm', [
        'install',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        `--registry=${this.bundle.manifest.registry}`,
      ], consumerRoot, npmClientEnvironment())

      /** 中文说明：变量 bin 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const bin = resolve(consumerRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
      assertPathWithin(consumerRoot, bin, 'installed dsh bin')
      /** 中文说明：变量 environment 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const environment = installedArtifactEnvironment(consumerRoot)
      /** 中文说明：变量 version 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const version = this.runner.capture(
        process.execPath,
        [bin, '--version'],
        consumerRoot,
        environment,
      )
      if (version !== this.bundle.manifest.version) {
        throw new Error(
          `installed dsh --version returned ${JSON.stringify(version)}; `
          + `expected ${this.bundle.manifest.version}`,
        )
      }
      this.probeWeb(bin, consumerRoot, environment)
      console.log('publish-npm-baseline: installed dsh entry and Web startup probes passed')
    } finally {
      rmSync(consumerRoot, { recursive: true, force: true })
    }
  }

  private probeWeb(bin: string, consumerRoot: string, environment: NodeJS.ProcessEnv): void {
    if (process.platform === 'win32') {
      throw new Error('installed dsh Web probe requires a POSIX host with python3')
    }
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = this.runner.result(
      'python3',
      ['-c', POSIX_WEB_PROBE, process.execPath, bin, consumerRoot, '60'],
      consumerRoot,
      environment,
    )
    if (result.status !== 0) {
      throw commandFailure('python3', ['installed-dsh-web-probe'], result)
    }
  }
}

/** Builds a release bundle without mutating the caller's checkout. */
/* 中文说明：class BaselinePackager 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class BaselinePackager {
  constructor(
    private readonly repositoryRoot: string,
    private readonly runner: CommandRunner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  plan(options: PackOptions): BaselinePackPlan {
    /** 中文说明：变量 timestamp 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const timestamp = formatUtcTimestamp(this.now())
    /** 中文说明：变量 registry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registry = normalizeRegistry(options.registry)
    /** 中文说明：变量 commit 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commit = this.runner.capture(
      'git',
      ['rev-parse', '--verify', `${options.ref}^{commit}`],
      this.repositoryRoot,
    )
    /** 中文说明：变量 shortCommit 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shortCommit = this.runner.capture(
      'git',
      ['rev-parse', '--short=10', commit],
      this.repositoryRoot,
    )
    /** 中文说明：变量 rootManifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rootManifest = parseObject(
      this.runner.capture('git', ['show', `${commit}:package.json`], this.repositoryRoot),
      `${commit}:package.json`,
    )
    /** 中文说明：变量 baseVersion 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const baseVersion = expectString(rootManifest, 'version', `${commit}:package.json`)
    validateBaseVersion(baseVersion, `${commit}:package.json`)
    /** 中文说明：变量 version 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const version = `${baseVersion}-${timestamp}-${shortCommit}`
    /** 中文说明：变量 distTag 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const distTag = `dev-${baseVersion}`
    validateDistTag(distTag)
    /** 中文说明：变量 artifactDirectory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const artifactDirectory = resolve(options.outputDirectory, version)
    if (existsSync(artifactDirectory)) {
      throw new Error(`output already exists: ${artifactDirectory}`)
    }
    return new BaselinePackPlan(
      commit,
      shortCommit,
      timestamp,
      baseVersion,
      version,
      distTag,
      registry,
      artifactDirectory,
    )
  }

  pack(plan: BaselinePackPlan): ReleaseBundle {
    const { artifactDirectory } = plan
    if (existsSync(artifactDirectory)) {
      throw new Error(`output already exists: ${artifactDirectory}`)
    }
    /** 中文说明：变量 worktree 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const worktree = DetachedWorktree.create(this.repositoryRoot, plan.commit, this.runner)
    /** 中文说明：变量 createdArtifactDirectory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let createdArtifactDirectory = false
    try {
      /** 中文说明：变量 packageSet 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const packageSet = WorkspacePackageSet.discover(worktree.path)
      if (packageSet.baseVersion !== plan.baseVersion) {
        throw new Error(
          `workspace package version ${packageSet.baseVersion} does not match root version `
          + `${plan.baseVersion} at ${plan.commit}`,
        )
      }

      console.log(`publish-npm-baseline: installing detached worktree ${plan.shortCommit}`)
      this.runner.run('pnpm', ['install', '--frozen-lockfile'], worktree.path)
      this.runner.run('pnpm', ['run', 'constraints'], worktree.path)
      packageSet.stage(worktree.path, plan.version)
      mkdirSync(artifactDirectory, { recursive: true })
      createdArtifactDirectory = true

      console.log(
        `publish-npm-baseline: building ${packageSet.packages.length} packages as ${plan.version}`,
      )
      this.runner.run('pnpm', ['run', 'build'], worktree.path)
      this.runner.run('pnpm', ['run', 'publint'], worktree.path)
      this.runner.run('pnpm', ['run', 'verify-built-package-invariants'], worktree.path)
      this.runner.run('pnpm', [
        '--filter', './vendor/**',
        '--filter', './packages/**',
        '--filter', './apps/**',
        '--recursive',
        'pack',
        '--pack-destination', artifactDirectory,
      ], worktree.path)

      /** 中文说明：变量 bundle 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const bundle = ReleaseBundle.create(
        artifactDirectory,
        packageSet.packages,
        plan.commit,
        plan.version,
        plan.distTag,
        plan.registry,
        this.runner,
      )
      new InstalledBundleSmoke(bundle, this.runner).run()
      createdArtifactDirectory = false
      console.log(`publish-npm-baseline: packed ${bundle.manifest.packages.length} packages`)
      console.log(`  version:  ${bundle.manifest.version}`)
      console.log(`  dist-tag: ${bundle.manifest.distTag}`)
      console.log(`  manifest: ${resolve(bundle.directory, RELEASE_MANIFEST_NAME)}`)
      console.log('  publish:  ' + formatCopyableCommand('pnpm', [
        '--dir',
        this.repositoryRoot,
        'exec',
        'tsx',
        resolve(this.repositoryRoot, 'scripts/publish-npm-baseline.ts'),
        'publish',
        '--manifest',
        resolve(bundle.directory, RELEASE_MANIFEST_NAME),
        '--yes',
      ]))
      return bundle
    } finally {
      worktree.dispose()
      if (createdArtifactDirectory) {
        rmSync(artifactDirectory, { recursive: true, force: true })
      }
    }
  }
}

/** Publishes and verifies a release bundle against its recorded registry. */
/* 中文说明：class RegistryPublication 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class RegistryPublication {
  private readonly npmEnvironment = npmClientEnvironment()
  private readonly npmWorkingDirectory = tmpdir()

  constructor(
    private readonly bundle: ReleaseBundle,
    private readonly runner: CommandRunner,
  ) {}

  async publish(assumeYes: boolean): Promise<void> {
    this.pingRegistry()
    this.requireIdentity()
    if (!assumeYes) await this.confirm()

    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const pkg of this.bundle.manifest.packages) {
      /** 中文说明：变量 existingIntegrity 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const existingIntegrity = this.remoteIntegrity(pkg.name)
      if (existingIntegrity === undefined) {
        this.runner.run('npm', [
          'publish',
          this.bundle.tarballPath(pkg),
          `--registry=${this.bundle.manifest.registry}`,
          `--tag=${this.bundle.manifest.distTag}`,
        ], this.npmWorkingDirectory, this.npmEnvironment)
      } else {
        if (existingIntegrity !== pkg.integrity) {
          throw new Error(
            `${pkg.name}@${this.bundle.manifest.version} already exists with different integrity`,
          )
        }
        console.log(
          `publish-npm-baseline: already published ${pkg.name}@${this.bundle.manifest.version}`,
        )
      }
      this.ensureDistTag(pkg.name, this.bundle.manifest.distTag)
    }
    this.ensureDistTag(RELEASE_ENTRY_PACKAGE, LATEST_DIST_TAG)
    this.verifyRemote()
    this.verifyReleaseEntryDistTag()
  }

  verify(): void {
    this.pingRegistry()
    this.verifyRemote()
    this.verifyReleaseEntryDistTag()
  }

  private verifyRemote(): void {
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const pkg of this.bundle.manifest.packages) {
      /** 中文说明：变量 integrity 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const integrity = this.remoteIntegrity(pkg.name)
      if (integrity === undefined) {
        throw new Error(`package is missing: ${pkg.name}@${this.bundle.manifest.version}`)
      }
      if (integrity !== pkg.integrity) {
        throw new Error(`integrity mismatch: ${pkg.name}@${this.bundle.manifest.version}`)
      }
      /** 中文说明：变量 tagVersion 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const tagVersion = this.remoteDistTag(pkg.name, this.bundle.manifest.distTag)
      if (tagVersion !== this.bundle.manifest.version) {
        throw new Error(
          `${pkg.name}@${this.bundle.manifest.distTag} points to ${tagVersion ?? '<missing>'}; `
          + `expected ${this.bundle.manifest.version}`,
        )
      }
      console.log(`publish-npm-baseline: verified ${pkg.name}@${this.bundle.manifest.version}`)
    }
    console.log(
      `publish-npm-baseline: verified ${this.bundle.manifest.packages.length} packages and `
      + `dist-tag ${this.bundle.manifest.distTag}`,
    )
  }

  private verifyReleaseEntryDistTag(): void {
    /** 中文说明：变量 tagVersion 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tagVersion = this.remoteDistTag(RELEASE_ENTRY_PACKAGE, LATEST_DIST_TAG)
    if (tagVersion !== this.bundle.manifest.version) {
      throw new Error(
        `${RELEASE_ENTRY_PACKAGE}@${LATEST_DIST_TAG} points to ${tagVersion ?? '<missing>'}; `
        + `expected ${this.bundle.manifest.version}`,
      )
    }
    console.log(
      `publish-npm-baseline: verified ${RELEASE_ENTRY_PACKAGE}@${LATEST_DIST_TAG} at `
      + this.bundle.manifest.version,
    )
  }

  private pingRegistry(): void {
    const { registry } = this.bundle.manifest
    this.runner.capture(
      'npm', ['ping', `--registry=${registry}`], this.npmWorkingDirectory, this.npmEnvironment,
    )
  }

  private requireIdentity(): void {
    const { registry } = this.bundle.manifest
    /** 中文说明：变量 identity 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const identity = this.runner.capture(
      'npm', ['whoami', `--registry=${registry}`], this.npmWorkingDirectory, this.npmEnvironment,
    )
    console.log(`publish-npm-baseline: registry identity ${identity} at ${registry}`)
  }

  private async confirm(): Promise<void> {
    await confirmEnter(
      `Publish ${this.bundle.manifest.packages.length} packages as `
      + `${this.bundle.manifest.version} to ${this.bundle.manifest.registry}? `
      + 'Press Enter to continue or type anything to cancel: ',
      'publish requires an interactive terminal or --yes',
      'publication cancelled',
    )
  }

  private remoteIntegrity(name: string): string | undefined {
    const { registry, version } = this.bundle.manifest
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = this.runner.result(
      'npm',
      ['view', `${name}@${version}`, 'dist.integrity', '--json', `--registry=${registry}`],
      this.npmWorkingDirectory,
      this.npmEnvironment,
    )
    if (result.status !== 0) {
      if (/E404|NOT_FOUND|404 Not Found/.test(`${result.stdout}\n${result.stderr}`)) return undefined
      throw commandFailure('npm', ['view', `${name}@${version}`], result)
    }
    /** 中文说明：变量 value 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value: unknown = result.stdout.trim() === '' ? undefined : JSON.parse(result.stdout)
    if (typeof value !== 'string' || !value.startsWith('sha512-')) {
      throw new Error(`registry returned no integrity for ${name}@${version}`)
    }
    return value
  }

  private remoteDistTag(name: string, distTag: string): string | undefined {
    const { registry } = this.bundle.manifest
    /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const raw = this.runner.capture(
      'npm',
      ['dist-tag', 'ls', name, `--registry=${registry}`],
      this.npmWorkingDirectory,
      this.npmEnvironment,
    )
    return parseDistTagListing(raw, name).get(distTag)
  }

  private ensureDistTag(name: string, distTag: string): void {
    if (this.remoteDistTag(name, distTag) === this.bundle.manifest.version) return
    const { registry, version } = this.bundle.manifest
    this.runner.run(
      'npm',
      ['dist-tag', 'add', `${name}@${version}`, distTag, `--registry=${registry}`],
      this.npmWorkingDirectory,
      this.npmEnvironment,
    )
  }
}

/** 中文说明：interface InspectedTarball 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface InspectedTarball {
  name: string
  version: string
  private: unknown
  manifest: Record<string, unknown>
  files: string[]
}

/** 中文说明：函数 inspectTarball 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function inspectTarball(path: string, runner: CommandRunner): InspectedTarball {
  /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manifest = JSON.parse(
    runner.capture('tar', ['-xOf', path, 'package/package.json'], dirname(path)),
  ) as unknown
  if (!isRecord(manifest)) throw new Error(`${path} contains an invalid package.json`)
  return {
    name: expectString(manifest, 'name', path),
    version: expectString(manifest, 'version', path),
    private: manifest.private,
    manifest,
    files: runner.capture('tar', ['-tf', path], dirname(path)).split(/\r?\n/),
  }
}

/** 中文说明：函数 packedPackage 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function packedPackage(name: string, path: string, origin: PackageOrigin): PackedPackage {
  /** 中文说明：变量 bytes 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bytes = readFileSync(path)
  return {
    name,
    tarball: basename(path),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    origin,
  }
}

/** 中文说明：函数 parsePackedPackage 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parsePackedPackage(value: unknown, index: number): PackedPackage {
  if (!isRecord(value)) throw new Error(`invalid release manifest package at index ${index}`)
  /** 中文说明：变量 context 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const context = `release manifest package at index ${index}`
  /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const name = expectString(value, 'name', context)
  /** 中文说明：变量 origin 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const origin = value.origin === undefined ? 'harness' : value.origin
  if (origin !== 'harness' && origin !== 'vendor') {
    throw new Error(`invalid package origin in release manifest: ${JSON.stringify(origin)}`)
  }
  if (origin === 'harness' && (!name.startsWith('@deepseek-ai/') || name === '@deepseek-ai/dsh-root')) {
    throw new Error(`invalid package name in release manifest: ${name}`)
  }
  return {
    name,
    tarball: expectString(value, 'tarball', context),
    sha256: expectString(value, 'sha256', context),
    integrity: expectString(value, 'integrity', context),
    origin,
  }
}

/** 中文说明：函数 containsWorkspaceProtocol 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function containsWorkspaceProtocol(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('workspace:')
  if (Array.isArray(value)) return value.some(containsWorkspaceProtocol)
  return isRecord(value) && Object.values(value).some(containsWorkspaceProtocol)
}

/** 中文说明：函数 stageInternalDependencies 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function stageInternalDependencies(
  manifest: Record<string, unknown>,
  internalNames: ReadonlySet<string>,
  releaseVersion: string,
  context: string,
): void {
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const { dependencies, name } of internalDependencyEntries(manifest, internalNames, context)) {
    dependencies[name] = releaseVersion
  }
}

/** 中文说明：函数 validateInternalDependencyPins 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function validateInternalDependencyPins(
  manifest: Record<string, unknown>,
  internalNames: ReadonlySet<string>,
  releaseVersion: string,
  context: string,
): void {
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const { section, name, range } of internalDependencyEntries(manifest, internalNames, context)) {
    if (range !== releaseVersion) {
      throw new Error(
        `${context} has internal ${section} ${name}@${String(range)}; `
        + `expected exact version ${releaseVersion}`,
      )
    }
  }
}

function* internalDependencyEntries(
  manifest: Record<string, unknown>,
  internalNames: ReadonlySet<string>,
  context: string,
): Generator<{
  section: typeof DEPENDENCY_SECTIONS[number]
  dependencies: Record<string, unknown>
  name: string
  range: unknown
}> {
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const section of DEPENDENCY_SECTIONS) {
    /** 中文说明：变量 dependencies 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dependencies = manifest[section]
    if (dependencies === undefined) continue
    if (!isRecord(dependencies)) throw new Error(`${context} ${section} must be an object`)
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const [name, range] of Object.entries(dependencies)) {
      if (!internalNames.has(name)) continue
      yield { section, dependencies, name, range }
    }
  }
}

/** 中文说明：函数 readObject 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readObject(path: string): Record<string, unknown> {
  return parseObject(readFileSync(path, 'utf8'), path)
}

/** 中文说明：函数 parseObject 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parseObject(source: string, context: string): Record<string, unknown> {
  /** 中文说明：变量 value 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value: unknown = JSON.parse(source)
  if (!isRecord(value)) throw new Error(`${context} must contain a JSON object`)
  return value
}

/** 中文说明：函数 isRecord 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 中文说明：函数 expectString 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function expectString(value: Record<string, unknown>, key: string, context: string): string {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = value[key]
  if (typeof result !== 'string' || result === '') {
    throw new Error(`${context} must contain a non-empty ${key}`)
  }
  return result
}

/** 中文说明：函数 normalizeRegistry 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function normalizeRegistry(value: string): string {
  /** 中文说明：变量 url 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`registry must use HTTP or HTTPS: ${value}`)
  }
  return value.replace(/\/+$/, '')
}

/** 中文说明：函数 npmClientEnvironment 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function npmClientEnvironment(): NodeJS.ProcessEnv {
  /** 中文说明：变量 environment 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const environment = { ...process.env }
  delete environment.npm_config_user_agent
  delete environment.NPM_CONFIG_USER_AGENT
  return environment
}

/** 中文说明：函数 installedArtifactEnvironment 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function installedArtifactEnvironment(consumerRoot: string): NodeJS.ProcessEnv {
  /** 中文说明：变量 environment 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const environment = npmClientEnvironment()
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  environment.DSH_HOME = resolve(consumerRoot, '.dsh')
  environment.DSH_AGENTS_HOME = resolve(consumerRoot, '.agents')
  environment.DSH_TELEMETRY_DISABLED = '1'
  environment.DEEPSEEK_API_KEY = 'keyless-installed-web-no-call'
  environment.LANG = 'en_US.UTF-8'
  environment.LC_ALL = 'en_US.UTF-8'
  environment.LC_CTYPE = 'en_US.UTF-8'
  environment.TERM = 'xterm-256color'
  environment.COLUMNS = '100'
  environment.LINES = '30'
  delete environment.COLORTERM
  return environment
}

/** 中文说明：函数 assertPathWithin 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function assertPathWithin(root: string, path: string, label: string): void {
  /** 中文说明：变量 rootPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rootPath = realpathSync.native(root)
  /** 中文说明：变量 candidate 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const candidate = realpathSync.native(path)
  /** 中文说明：变量 fromRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fromRoot = relative(rootPath, candidate)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} resolved outside the isolated consumer: ${candidate}`)
  }
}

/** 中文说明：函数 validateDistTag 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function validateDistTag(value: string): void {
  if (value === '' || /\s/.test(value)) throw new Error(`invalid dist-tag: ${JSON.stringify(value)}`)
}

/** 中文说明：函数 validateBaseVersion 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function validateBaseVersion(value: string, context: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`${context} must have a stable X.Y.Z version, got ${value}`)
  }
}

/** 中文说明：函数 parseDistTagListing 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parseDistTagListing(raw: string, name: string): Map<string, string> {
  /** 中文说明：变量 tags 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tags = new Map<string, string>()
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const line of raw.split(/\r?\n/)) {
    if (line === '') continue
    /** 中文说明：变量 separator 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const separator = line.indexOf(': ')
    if (separator <= 0 || separator + 2 === line.length) {
      throw new Error(`registry returned an invalid dist-tag for ${name}: ${line}`)
    }
    /** 中文说明：变量 tag 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tag = line.slice(0, separator)
    if (tags.has(tag)) throw new Error(`registry returned duplicate dist-tag ${tag} for ${name}`)
    tags.set(tag, line.slice(separator + 2))
  }
  return tags
}

/** 中文说明：函数 confirmEnter 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function confirmEnter(
  prompt: string,
  nonInteractiveError: string,
  cancellationError: string,
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(nonInteractiveError)
  /** 中文说明：变量 readline 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    /** 中文说明：变量 answer 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const answer = await readline.question(prompt)
    if (answer !== '') throw new Error(cancellationError)
  } finally {
    readline.close()
  }
}

/** 中文说明：函数 formatUtcTimestamp 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function formatUtcTimestamp(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error('pack timestamp must be a valid date')
  return value.toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14)
}

/** 中文说明：函数 commandFailure 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function commandFailure(command: string, args: string[], result: CommandResult): Error {
  /** 中文说明：变量 detail 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const detail = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
  return new Error(
    `${formatCommand(command, args)} exited with status ${result.status}${detail === '' ? '' : `\n${detail}`}`,
  )
}

/** 中文说明：函数 formatCommand 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(value => JSON.stringify(value)).join(' ')
}

/** 中文说明：函数 formatCopyableCommand 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function formatCopyableCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteShellArgument).join(' ')
}

/** 中文说明：函数 quoteShellArgument 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function quoteShellArgument(value: string): string {
  if (/^[\w./:@=+-]+$/.test(value)) return value
  /** 中文说明：变量 singleQuote 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const singleQuote = String.fromCodePoint(39)
  /** 中文说明：变量 escapedSingleQuote 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const escapedSingleQuote = `${singleQuote}"${singleQuote}"${singleQuote}`
  return `${singleQuote}${value.replaceAll(singleQuote, escapedSingleQuote)}${singleQuote}`
}

/** 中文说明：函数 printUsage 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function printUsage(): void {
  console.log(`Usage:
  pnpm exec tsx scripts/publish-npm-baseline.ts pack [options]
  pnpm exec tsx scripts/publish-npm-baseline.ts release [options] [--yes]
  pnpm exec tsx scripts/publish-npm-baseline.ts publish --manifest <path> [--yes]
  pnpm exec tsx scripts/publish-npm-baseline.ts verify --manifest <path>

Pack/release options:
  --ref <git-ref>       Git commit to stage (default: HEAD)
  --registry <url>      npm registry (default: ${DEFAULT_REGISTRY})
  --output-dir <path>   Artifact root (default: ${DEFAULT_OUTPUT_DIRECTORY})
  --yes                 pack/release without waiting for Enter`)
}

/** 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function main(): Promise<void> {
  /** 中文说明：变量 command 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const command = process.argv[2]
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    printUsage()
    return
  }
  if (process.argv.slice(3).some(value => value === '--help' || value === '-h')) {
    printUsage()
    return
  }
  /** 中文说明：变量 runner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const runner = new CommandRunner()
  /** 中文说明：变量 repositoryRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const repositoryRoot = runner.capture('git', ['rev-parse', '--show-toplevel'], process.cwd())

  if (command === 'pack' || command === 'release') {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: {
        ref: { type: 'string', default: 'HEAD' },
        registry: { type: 'string', default: DEFAULT_REGISTRY },
        'output-dir': { type: 'string', default: resolve(repositoryRoot, DEFAULT_OUTPUT_DIRECTORY) },
        yes: { type: 'boolean', default: false },
      },
      strict: true,
    })
    /** 中文说明：变量 packager 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packager = new BaselinePackager(repositoryRoot, runner)
    /** 中文说明：变量 plan 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plan = packager.plan({
      ref: values.ref,
      registry: values.registry,
      outputDirectory: resolve(values['output-dir']),
    })
    await plan.confirm(values.yes)
    /** 中文说明：变量 bundle 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bundle = packager.pack(plan)
    if (command === 'release') {
      await new RegistryPublication(bundle, runner).publish(values.yes)
    }
    return
  }

  if (command === 'publish' || command === 'verify') {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: {
        manifest: { type: 'string' },
        yes: { type: 'boolean', default: false },
      },
      strict: true,
    })
    if (values.manifest === undefined) throw new Error(`${command} requires --manifest`)
    if (command === 'verify' && values.yes) throw new Error('verify does not accept --yes')
    /** 中文说明：变量 bundle 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bundle = ReleaseBundle.load(values.manifest, runner)
    /** 中文说明：变量 publication 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const publication = new RegistryPublication(bundle, runner)
    if (command === 'publish') await publication.publish(values.yes)
    else publication.verify()
    return
  }

  throw new Error(`unknown command: ${command}`)
}

try {
  await main()
} catch (error: unknown) {
  console.error(`publish-npm-baseline: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
