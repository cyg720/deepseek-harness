/**
 * Publish one packed release family from the tarballs the pack step produced.
 *
 * Publication is decided per package against the registry, never from a list of
 * "what this release includes": a version the registry lacks is published, a
 * version whose published tarball has the same integrity is skipped, and a
 * version whose published tarball differs fails the run — that last case means
 * the content changed without a version bump
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 *
 * Skipping on identical integrity is what makes re-running the publish step over
 * the same artifact safe.
 */
/*
 * 文件职责：实现 publish.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { releaseFamily } from './families.ts'
import { attempt, attemptEchoed, isEntry } from './process.ts'
import { packedIdentity, readPublishOrder } from './tarball.ts'

/**
 * Registry codes that answer a write which did not settle, rather than a
 * rejection of what was sent. `E409 Failed to save packument` is the one this
 * sequence actually hits: publishing several packages in a row can outrun the
 * registry's own processing. A rejected payload (`E403` over an existing
 * version, a malformed manifest) never clears on a retry and must surface.
 */
/* 中文说明：常量 TRANSIENT_PUBLISH_CODES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TRANSIENT_PUBLISH_CODES = ['E409', 'E429', 'E500', 'E502', 'E503', 'E504', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'] as const

/** How many times one tarball's publish is attempted before the run fails. */
/* 中文说明：常量 PUBLISH_ATTEMPTS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PUBLISH_ATTEMPTS = 4

/**
 * Shortest gap between two publishes, and the first retry backoff.
 *
 * The registry needs a moment to commit a packument before the next write; back
 * to back publishes are what produce `E409`.
 */
/* 中文说明：常量 PUBLISH_SPACING_MS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PUBLISH_SPACING_MS = 2_000

/** What the registry knows about one version. */
/* 中文说明：type RegistryState 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type RegistryState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly integrity: string }

/**
 * Whether a failed publish is worth another attempt.
 * @param output - combined npm output.
 * @returns True when the registry reported a write it did not commit.
 */
/* 中文说明：函数 isTransientFailure 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isTransientFailure(output: string): boolean {
  return TRANSIENT_PUBLISH_CODES.some(code => output.includes(`code ${code}`))
}

/**
 * The subresource integrity string npm records for a tarball.
 * @param tarball - absolute tarball path.
 * @returns A `sha512-<base64>` string.
 */
/* 中文说明：函数 integrityOf 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function integrityOf(tarball: string): string {
  return `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`
}

/**
 * Ask the registry whether a version exists, and with what integrity.
 * @param name - package name.
 * @param version - package version.
 * @returns The registry state for that version.
 */
/* 中文说明：函数 registryState 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function registryState(name: string, version: string): RegistryState {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = attempt('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json'])
  if (result.status !== 0) {
    /** 中文说明：变量 output 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = `${result.stdout}${result.stderr}`
    if (output.includes('E404') || output.includes('404 Not Found')) return { kind: 'absent' }
    throw new Error(`npm view ${name}@${version} failed:\n${output}`)
  }
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed: unknown = JSON.parse(result.stdout)
  if (typeof parsed !== 'string' || parsed === '') {
    throw new Error(`registry reported no dist.integrity for ${name}@${version}`)
  }
  return { kind: 'present', integrity: parsed }
}

/**
 * Publish one tarball, retrying a registry write that did not settle.
 *
 * Every retry re-reads the registry first, because `E409` can answer a write
 * that landed anyway: republishing a version that now exists fails permanently,
 * so the same integrity appearing under the failed attempt counts as success.
 * @param tarball - absolute tarball path.
 * @param name - package name the tarball declares.
 * @param version - package version the tarball declares.
 */
/* 中文说明：函数 publishTarball 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function publishTarball(tarball: string, name: string, version: string): Promise<void> {
  // A prerelease version never takes the latest dist-tag.
  /** 中文说明：变量 tagArgs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tagArgs = version.includes('-') ? ['--tag', 'next'] : []
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (let tries = 1; tries <= PUBLISH_ATTEMPTS; tries += 1) {
    // No --access: the sequences do not share one access level, so a
    // command-line flag could not serve both and would override the manifest
    // that does. Each packed manifest decides, and
    // check-workspace-constraints holds every manifest to its sequence's level.
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = attemptEchoed('npm', ['publish', tarball, ...tagArgs])
    /** 中文说明：变量 output 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = `${result.stdout}${result.stderr}`
    if (result.status === 0) return

    /** 中文说明：变量 settled 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const settled = registryState(name, version)
    if (settled.kind === 'present' && settled.integrity === integrityOf(tarball)) {
      console.log(`release publish: ${name}@${version} landed despite a reported failure, continuing`)
      return
    }
    if (tries === PUBLISH_ATTEMPTS || !isTransientFailure(output)) {
      throw new Error(`npm publish ${name}@${version} failed:\n${output}`)
    }
    /** 中文说明：变量 backoff 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backoff = PUBLISH_SPACING_MS * 2 ** (tries - 1)
    console.log(
      `release publish: ${name}@${version} hit a transient registry failure`
      + ` (attempt ${String(tries)} of ${String(PUBLISH_ATTEMPTS)}), retrying in ${String(backoff)}ms`,
    )
    await sleep(backoff)
  }
}

/** Publish the family named by `--family` from the directory named by `--from`. */
/* 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { family: { type: 'string' }, from: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.family === undefined || values.from === undefined) {
    throw new Error('usage: publish.ts --family <dsh|vendor> --from <packed directory>')
  }

  /** 中文说明：变量 family 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const family = releaseFamily(values.family)
  /** 中文说明：变量 directory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const directory = resolve(process.cwd(), values.from)

  // Every entry in the order settles as either published or already present, so
  // one counter answers "how far along is this run" for whoever is watching a
  // release that takes minutes per family.
  /** 中文说明：变量 order 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const order = readPublishOrder(directory)
  /** 中文说明：变量 total 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const total = String(order.length)
  /** 中文说明：变量 published 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let published = 0
  /** 中文说明：变量 skipped 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let skipped = 0
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const [index, filename] of order.entries()) {
    /** 中文说明：变量 progress 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const progress = `[${String(index + 1)}/${total}]`
    /** 中文说明：变量 tarball 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tarball = join(directory, filename)
    const { name, version } = packedIdentity(tarball)
    /** 中文说明：变量 state 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const state = registryState(name, version)
    if (state.kind === 'present') {
      /** 中文说明：变量 local 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const local = integrityOf(tarball)
      if (state.integrity !== local) {
        throw new Error(
          `${name}@${version} is already published with different content`
          + `\n  registry: ${state.integrity}\n  packed:   ${local}`
          + '\nBump the version, or investigate why the build is not reproducible.',
        )
      }
      console.log(`release publish: ${progress} ${name}@${version} already published, skipping`)
      skipped += 1
      continue
    }
    // Space out the writes: the gap belongs between publishes, so a run that
    // only skips does not wait at all.
    if (published > 0) await sleep(PUBLISH_SPACING_MS)
    await publishTarball(tarball, name, version)
    console.log(`release publish: ${progress} ${name}@${version} published`)
    published += 1
  }

  console.log(
    `release publish: family ${family.id}, ${total} member(s),`
    + ` ${String(published)} published, ${String(skipped)} already present`,
  )
}

if (isEntry(import.meta.url)) await main()
