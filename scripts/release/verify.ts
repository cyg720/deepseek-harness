/**
 * Verify a release family's version baseline, and — when publishing — that the
 * run comes from the family's tag and its members are publishable.
 *
 * Publication happens only from GitHub Actions, so the tag and publishability
 * checks are gates on the workflow, not advisory local warnings
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 */
/**
 * 文件职责：实现 verify.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { parseArgs } from 'node:util'
import { isEntry } from './process.ts'
import { releaseFamily, type PublishPlan, type ReleaseFamily, type ReleaseMember } from './families.ts'

/**
 * Print the publish order the release will follow, and the peer declarations it
 * leaves unordered.
 *
 * The order is the release's own plan: an interrupted publication leaves exactly
 * a prefix of it, so reading it is how anyone judges what a partial run left on
 * the registry, and printing it on every pull request is what makes a change to
 * the order reviewable rather than only observable during a publication.
 * @param family - the release family.
 * @param plan - the resolved order and its dropped edges.
 */
/** 中文说明：函数 reportPublishOrder 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function reportPublishOrder(family: ReleaseFamily, plan: PublishPlan): void {
  console.log(`release verify: publish order for family ${family.id}, ${String(plan.order.length)} member(s):`)
  /** 中文说明：变量 width 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const width = String(plan.order.length).length
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const [index, member] of plan.order.entries()) {
    console.log(`  ${String(index + 1).padStart(width, ' ')}  ${member.name}@${member.version}`)
  }
  if (plan.droppedPeerEdges.length === 0) return
  console.log(
    `release verify: ${String(plan.droppedPeerEdges.length)} peer declaration(s) publish unordered,`
    + ' because the peer cannot precede the package declaring it without contradicting a dependency edge'
    + ' or its own cycle. npm treats an unmet peer as a warning, so this orders nothing and blocks nothing:',
  )
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const edge of plan.droppedPeerEdges) console.log(`  ${edge.consumer} -> ${edge.peer}`)
}

/**
 * Assert every member may be published: npm refuses a `private` package.
 * @param members - the family's members.
 */
/** 中文说明：函数 verifyPublishable 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function verifyPublishable(members: readonly ReleaseMember[]): void {
  /** 中文说明：函数值 priv 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const priv = members.filter(member => member.manifest.private === true)
  if (priv.length > 0) {
    throw new Error(`publishing requires removing "private": true from:\n${priv.map(member => member.directory).join('\n')}`)
  }
}

/**
 * Assert the workflow runs from a tag this family publishes from, and that the
 * tag names a version the family actually carries.
 * @param family - the release family.
 * @param members - the family's members.
 * @param ref - the `GITHUB_REF` value.
 */
/** 中文说明：函数 verifyTag 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function verifyTag(family: ReleaseFamily, members: readonly ReleaseMember[], ref: string): void {
  /** 中文说明：变量 prefix 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const prefix = 'refs/tags/'
  if (!ref.startsWith(prefix)) {
    throw new Error(`publishing release family ${family.id} requires running from a ${family.tagPrefix}* tag, got ${ref || '(no ref)'}`)
  }
  /** 中文说明：变量 tag 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tag = ref.slice(prefix.length)
  if (!tag.startsWith(family.tagPrefix)) {
    throw new Error(`tag ${tag} does not belong to release family ${family.id} (expected ${family.tagPrefix}*)`)
  }
  /** 中文说明：函数值 expected 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const expected = members.map(member => family.tagFor(member))
  if (!expected.includes(tag)) {
    throw new Error(`tag ${tag} names no version this family carries; its members would tag as:\n${[...new Set(expected)].join('\n')}`)
  }
}

/** Run the verification for the family named by `--family`. */
/** 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function main(): void {
  const { values } = parseArgs({
    options: { family: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.family === undefined) throw new Error('usage: verify.ts --family <dsh|vendor>')

  /** 中文说明：变量 family 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const family = releaseFamily(values.family)
  /** 中文说明：变量 members 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const members = family.members(process.cwd())
  family.verifyVersions(members)
  // Resolve the publish order here, before the build: an install-edge cycle
  // makes the order unrepresentable, and that has to surface at the first gate
  // rather than when pack is already writing tarballs.
  /** 中文说明：变量 plan 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const plan = family.publishOrder(members)
  if (plan.order.length !== members.length) {
    throw new Error(
      `release family ${family.id}: publish order covers ${String(plan.order.length)} of ${String(members.length)} members`,
    )
  }
  reportPublishOrder(family, plan)

  /** 中文说明：变量 publishing 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const publishing = process.env.RELEASE_PUBLISH === 'true'
  if (publishing) {
    verifyPublishable(members)
    verifyTag(family, members, process.env.GITHUB_REF ?? '')
  }

  /** 中文说明：函数值 versions 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const versions = [...new Set(members.map(member => member.version))]
  /** 中文说明：变量 summary 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const summary = versions.length === 1 ? versions[0] : `${String(versions.length)} versions`
  console.log(
    `release verify: family ${family.id}, ${String(members.length)} member(s), ${summary},`
    + ` publish order resolved, ${String(plan.droppedPeerEdges.length)} peer declaration(s) unordered`
    + (publishing ? ', publish gates passed' : ''),
  )
}

if (isEntry(import.meta.url)) main()
