/**
 * Install packed tarballs into a throwaway consumer outside the repository and
 * drive the installed executable with plain Node.
 *
 * Every tarball the installed tree needs comes from `--from`, so the only
 * registry traffic is for external dependencies. That matters beyond hermetic
 * verification: the harness packages declare the vendored framework as a peer,
 * those packages live in another release sequence, and this job must not depend
 * on the registry already carrying versions that match — one pull request may
 * bump both families before either publishes — so a dsh verification passes the
 * vendored family's pack output too, while publishing only its own
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 *
 * What this proves is that `files` selected a complete payload and that the
 * published dependency ranges resolve. A workspace link or a stale `lib/` in the
 * checkout cannot stand in for a missing file here.
 */
/*
 * 文件职责：实现 verify-packed-install.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { releaseFamily } from './families.ts'
import { capture, isEntry } from './process.ts'
import { packedIdentity } from './tarball.ts'

/**
 * Environment for the installed artifact: no host Node hooks, no host DeepSeek
 * Harness home, and no ambient npm user agent that would confuse npm.
 * @param consumerRoot - the throwaway consumer directory.
 * @returns The child environment.
 */
/* 中文说明：函数 consumerEnvironment 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function consumerEnvironment(consumerRoot: string): NodeJS.ProcessEnv {
  /** 中文说明：变量 environment 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const environment = { ...process.env }
  delete environment.npm_config_user_agent
  delete environment.NPM_CONFIG_USER_AGENT
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  environment.DSH_HOME = resolve(consumerRoot, '.dsh')
  environment.DSH_AGENTS_HOME = resolve(consumerRoot, '.agents')
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
}

/**
 * Every packed tarball in the given directories, as `file:` dependency entries.
 *
 * The directories are read by their contents rather than a pack order file: a
 * directory here can hold tarballs packed only to satisfy a cross-sequence
 * dependency, which no release order describes.
 * @param directories - absolute directories holding packed tarballs.
 * @returns Package name to tarball file URL, and the version each carries.
 */
/* 中文说明：函数 packedDependencies 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function packedDependencies(directories: readonly string[]): Map<string, { url: string; version: string }> {
  /** 中文说明：变量 dependencies 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dependencies = new Map<string, { url: string; version: string }>()
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const directory of directories) {
    /** 中文说明：函数值 tarballs 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const tarballs = readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()
    if (tarballs.length === 0) throw new Error(`${directory} holds no packed tarball`)
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const filename of tarballs) {
      /** 中文说明：变量 tarball 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const tarball = join(directory, filename)
      const { name, version } = packedIdentity(tarball)
      dependencies.set(name, { url: pathToFileURL(tarball).href, version })
    }
  }
  return dependencies
}

/** Install every tarball under `--from` and drive the `--family` entry. */
/* 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function main(): void {
  const { values } = parseArgs({
    options: { family: { type: 'string' }, from: { type: 'string', multiple: true } },
    allowPositionals: false,
  })
  if (values.family === undefined || values.from === undefined || values.from.length === 0) {
    throw new Error('usage: verify-packed-install.ts --family <dsh|vendor> --from <packed directory> [--from ...]')
  }

  /** 中文说明：变量 family 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const family = releaseFamily(values.family)
  /** 中文说明：变量 entry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entry = family.installedEntry
  if (entry === undefined) {
    console.log(`release verify-packed-install: family ${family.id} publishes no executable, nothing to drive`)
    return
  }

  /** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = process.cwd()
  /** 中文说明：函数值 packed 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const packed = packedDependencies(values.from.map(directory => resolve(root, directory)))
  /** 中文说明：变量 expected 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const expected = packed.get(entry.packageName)
  if (expected === undefined) throw new Error(`${entry.packageName} is not among the packed tarballs`)

  /** 中文说明：变量 consumerRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const consumerRoot = mkdtempSync(join(tmpdir(), `dsh-packed-${family.id}-`))
  try {
    writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({
      name: `dsh-packed-install-${family.id}`,
      version: '0.0.0',
      private: true,
      dependencies: Object.fromEntries([...packed].map(([name, entryPacked]) => [name, entryPacked.url])),
    }, null, 2)}\n`)

    /** 中文说明：变量 environment 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const environment = consumerEnvironment(consumerRoot)
    console.log(`release verify-packed-install: installing ${String(packed.size)} tarball(s) into ${consumerRoot}`)
    // Optional dependencies are omitted: the Landlock platform packages behind
    // them need a musl toolchain and one build per architecture, and a consumer
    // that cannot install them must still start — which is what optional means
    // here. Their entry package is a plain dependency of dsh-sandbox-local, so
    // its tarball is supplied through --from.
    capture('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false', '--omit=optional'],
      { cwd: consumerRoot, env: environment })

    /** 中文说明：变量 bin 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bin = join(consumerRoot, 'node_modules', ...entry.packageName.split('/'), entry.binPath)
    /** 中文说明：变量 version 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const version = capture(process.execPath, [bin, '--version'], { cwd: consumerRoot, env: environment })
    if (version !== expected.version) {
      throw new Error(`installed ${entry.packageName} --version reported ${JSON.stringify(version)}, expected ${expected.version}`)
    }
    console.log(`release verify-packed-install: installed ${entry.packageName} reports ${version}`)
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true })
  }
}

if (isEntry(import.meta.url)) main()
