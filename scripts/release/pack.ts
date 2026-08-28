/**
 * Pack one release family's whole publish set into a single directory, in
 * publish order, and record that order for the publish step.
 *
 * The pack step is the release boundary: it runs without credentials, produces
 * every tarball from one commit, and hands the publish step exactly those bytes
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 */
/*
 * 文件职责：实现 pack.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { releaseFamily, tarballName, type ReleaseFamily, type ReleaseMember } from './families.ts'
import { isEntry, runConcurrent } from './process.ts'
import { PUBLISH_ORDER_FILE, tarballFiles } from './tarball.ts'

/** Where pack output lands when `--out` is omitted. */
/* 中文说明：常量 DEFAULT_OUTPUT 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_OUTPUT = 'dist/npm'

/**
 * Pack one member and check what its tarball carries.
 * @param family - the release family being packed.
 * @param member - the member to pack.
 * @param destination - absolute output directory.
 * @returns The tarball filename.
 */
async function packMember(family: ReleaseFamily, member: ReleaseMember, destination: string): Promise<string> {
  await runConcurrent('pnpm', ['--dir', member.directory, 'pack', '--pack-destination', destination])

  /** 中文说明：变量 filename 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const filename = tarballName(member)
  /** 中文说明：变量 tarball 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tarball = join(destination, filename)
  if (!existsSync(tarball)) throw new Error(`${member.name} produced no tarball at ${tarball}`)
  family.validatePayload(member, tarballFiles(tarball))
  return filename
}

/**
 * @returns The validated `--concurrency` value; 1 (the default) packs the
 * members one at a time, exactly as the credentialed publish workflows run it.
 */
function parseConcurrency(raw: string | undefined): number {
  if (raw === undefined) return 1
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
    throw new Error(`--concurrency must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return parsed
}

/** Pack the family named by `--family` into `--out`. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { family: { type: 'string' }, out: { type: 'string' }, concurrency: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.family === undefined) throw new Error('usage: pack.ts --family <dsh|vendor> [--out dist/npm] [--concurrency 1]')
  const concurrency = parseConcurrency(values.concurrency)

  /** 中文说明：变量 family 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const family = releaseFamily(values.family)
  /** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = process.cwd()
  /** 中文说明：变量 destination 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const destination = resolve(root, values.out ?? DEFAULT_OUTPUT)
  /** 中文说明：变量 members 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const members = family.publishOrder(family.members(root)).order
  family.verifyBuildArtifacts(root)
  family.verifyVersions(members)

  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })

  // Members pack in a bounded pool; the recorded publish order stays the
  // members' order regardless of completion order, because each worker writes
  // its result at the member's own position.
  const order = new Array<string>(members.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, members.length) }, async () => {
    while (cursor < members.length) {
      const index = cursor
      cursor += 1
      const member = members[index]
      if (member === undefined) break
      order[index] = await packMember(family, member, destination)
    }
  }))
  writeFileSync(join(destination, PUBLISH_ORDER_FILE), `${order.join('\n')}\n`)

  console.log(`release pack: family ${family.id}, ${String(order.length)} tarball(s) in ${values.out ?? DEFAULT_OUTPUT}`)
}

if (isEntry(import.meta.url)) await main()
