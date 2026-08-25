/**
 * The three independent publish sequences this repository releases from
 * (`packages/` + `apps/`, `vendor/`, and `native/`) and the two this module
 * owns: `dsh` and `vendor`. Each family carries its own version baseline, tag
 * naming, and publish set, so releasing one never republishes another
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 *
 * The family dimension lives here only. A new sequence adds a subclass and a
 * `releaseFamilies()` entry; nothing else in the release scripts branches on it.
 */
/*
 * 文件职责：实现 families.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  officialClientBuildEnvironment,
  readClientBuildRecord,
} from '../client-build-environment.ts'
import { validateTarballPayload } from '../publication-payload.ts'

/**
 * Dependency sections a consumer must publish after, because npm resolves them
 * when the package is installed: publishing a consumer first would leave a
 * window where its own tree cannot be assembled.
 */
/* 中文说明：常量 INSTALL_SECTIONS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const INSTALL_SECTIONS = ['dependencies', 'optionalDependencies'] as const

/**
 * Peer declarations also order the publication, but they cannot constrain it.
 * npm never installs a peer on the package's behalf — an unmet peer is a
 * warning, not a resolution failure — and sibling packages legitimately declare
 * each other as peers, which makes these edges the ones that close cycles. They
 * order what they can and are dropped where they would deadlock.
 */
/* 中文说明：常量 PEER_SECTIONS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PEER_SECTIONS = ['peerDependencies'] as const

/** The workspace root manifest, which is never a release member. */
/* 中文说明：常量 WORKSPACE_ROOT_PACKAGE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const WORKSPACE_ROOT_PACKAGE = '@deepseek-ai/dsh-root'

/** One peer declaration the publish order leaves unordered. */
/* 中文说明：interface DroppedPeerEdge 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface DroppedPeerEdge {
  /** Package declaring the peer. */
  readonly consumer: string
  /** The declared peer, which publishes after `consumer` or alongside it in a cycle. */
  readonly peer: string
}

/**
 * A family's publish order together with the ordering it could not honour.
 *
 * The dropped edges are part of the result rather than a detail of forming it:
 * a release drops real ordering constraints, and the operator reading the pack
 * log is the only one who can judge whether a newly dropped edge is expected.
 */
/* 中文说明：interface PublishPlan 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface PublishPlan {
  /** Members in publish order. */
  readonly order: readonly ReleaseMember[]
  /** Peer declarations left unordered, in the order the traversal reached them. */
  readonly droppedPeerEdges: readonly DroppedPeerEdge[]
}

/** One publishable package of a release family. */
/* 中文说明：interface ReleaseMember 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface ReleaseMember {
  /** Repository-relative package directory, for example `packages/core/session`. */
  readonly directory: string
  /** Package name from its manifest. */
  readonly name: string
  /** Package version from its manifest. */
  readonly version: string
  /** The parsed manifest, for payload policy and publication checks. */
  readonly manifest: Readonly<Record<string, unknown>>
}

/**
 * Read and parse a JSON file.
 * @param path - absolute file path.
 * @returns The parsed object.
 */
/* 中文说明：函数 readManifest 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readManifest(path: string): Record<string, unknown> {
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Read a required string field.
 * @param manifest - parsed manifest.
 * @param field - field name.
 * @param context - manifest path for the error message.
 * @returns The field value.
 */
/* 中文说明：函数 requireString 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function requireString(manifest: Record<string, unknown>, field: string, context: string): string {
  /** 中文说明：变量 value 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value = manifest[field]
  if (typeof value !== 'string' || value === '') throw new Error(`${context} must declare a string ${field}`)
  return value
}

/** The executable a family's installed artifacts are driven through. */
/* 中文说明：interface InstalledEntry 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface InstalledEntry {
  /** Package that carries the executable. */
  readonly packageName: string
  /** Path to the executable inside that package. */
  readonly binPath: string
}

/** A release sequence: its members, its version baseline, and its tag naming. */
export abstract class ReleaseFamily {
  /** Workflow-facing identifier, also the `--family` argument. */
  abstract readonly id: string

  /** Glob patterns, relative to the repository root, that select this family's manifests. */
  abstract readonly patterns: readonly string[]

  /** Git tag prefix this family publishes from. */
  abstract readonly tagPrefix: string

  /**
   * Assert that built artifacts match this release family's required profile.
   * Families without environment-selected artifacts accept every build tree.
   * @param _root - repository root containing generated artifacts.
   */
  verifyBuildArtifacts(_root: string): void {}

  /**
   * Discover this family's members.
   * @param root - repository root.
   * @returns Members sorted by directory, with names validated and deduplicated.
   */
  members(root: string): ReleaseMember[] {
    /** 中文说明：变量 manifestPaths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifestPaths = globSync([...this.patterns], { cwd: root }).sort()
    if (manifestPaths.length === 0) throw new Error(`release family ${this.id} matched no manifests`)

    /** 中文说明：变量 members 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const members: ReleaseMember[] = []
    /** 中文说明：变量 seen 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seen = new Set<string>()
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const manifestPath of manifestPaths) {
      /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const normalized = manifestPath.replaceAll('\\', '/')
      /** 中文说明：变量 manifest 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const manifest = readManifest(resolve(root, manifestPath))
      /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const name = requireString(manifest, 'name', normalized)
      /** 中文说明：变量 version 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const version = requireString(manifest, 'version', normalized)
      if (name === WORKSPACE_ROOT_PACKAGE) throw new Error(`${normalized} selected the workspace root`)
      if (!name.startsWith('@deepseek-ai/')) throw new Error(`${normalized} must name an @deepseek-ai package`)
      if (seen.has(name)) throw new Error(`${name} appears twice in release family ${this.id}`)
      seen.add(name)
      members.push({
        directory: normalized.slice(0, normalized.length - '/package.json'.length),
        name,
        version,
        manifest,
      })
    }
    return members
  }

  /**
   * Order members so every package publishes after the family members it
   * depends on, which is what makes a partial publication self-consistent: an
   * interrupted run leaves a prefix whose packages never point at something
   * absent from the registry.
   *
   * Install edges are honoured absolutely — a cycle among them is a defect this
   * reports rather than works around. Peer edges order what they can and are
   * dropped where honouring one would deadlock: sibling packages declare each
   * other as peers, and npm treats an unmet peer as a warning rather than a
   * resolution failure ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
   * Every dropped edge is reported, because dropping one is a decision about a
   * real release rather than an implementation detail.
   * @param members - this family's members.
   * @returns The order, ties broken by name for determinism, and the peer edges it left unordered.
   */
  publishOrder(members: readonly ReleaseMember[]): PublishPlan {
    /** 中文说明：函数值 byName 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const byName = new Map(members.map(member => [member.name, member]))
    /** 中文说明：函数值 byNameSorted 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const byNameSorted = [...members].sort((left, right) => left.name.localeCompare(right.name))
    /** 中文说明：函数值 edges 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const edges = (member: ReleaseMember, sections: readonly string[]): ReleaseMember[] =>
      this.orderEdges(member, byName, sections)

    // Install edges alone must be acyclic, and that is checked on its own graph:
    // a peer edge leading into an install edge would otherwise read as a cycle
    // where the install edges are perfectly orderable.
    /** 中文说明：变量 installVisiting 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const installVisiting = new Set<string>()
    /** 中文说明：变量 installDone 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const installDone = new Set<string>()
    /** 中文说明：函数值 checkInstall 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const checkInstall = (member: ReleaseMember, path: readonly string[]): void => {
      if (installDone.has(member.name)) return
      if (installVisiting.has(member.name)) {
        throw new Error(`dependency cycle in release family ${this.id}: ${[...path, member.name].join(' -> ')}`)
      }
      installVisiting.add(member.name)
      /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
      for (const dependency of edges(member, INSTALL_SECTIONS)) checkInstall(dependency, [...path, member.name])
      installVisiting.delete(member.name)
      installDone.add(member.name)
    }
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const member of byNameSorted) checkInstall(member, [])

    // Emit the order over both kinds of edge. A node already on the stack closes
    // a cycle, and that cycle carries at least one peer edge because the install
    // edges were just proved acyclic — but the back edge that reaches the stacked
    // node is not necessarily the peer one, so the post-condition below decides
    // whether the emitted order survived.
    /** 中文说明：变量 ordered 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ordered: ReleaseMember[] = []
    /** 中文说明：变量 droppedPeerEdges 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const droppedPeerEdges: DroppedPeerEdge[] = []
    /** 中文说明：变量 placed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const placed = new Set<string>()
    /** 中文说明：变量 onStack 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const onStack = new Set<string>()
    // Members reachable from one member through install edges. A peer edge is
    // dropped when the peer installs the member declaring it: honouring it would
    // emit a package before something it installs, and the install edge wins.
    /** 中文说明：函数值 installClosure 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const installClosure = (member: ReleaseMember): Set<string> => {
      /** 中文说明：变量 reached 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const reached = new Set<string>()
      /** 中文说明：函数值 walk 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const walk = (current: ReleaseMember): void => {
        /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
        for (const dependency of edges(current, INSTALL_SECTIONS)) {
          if (reached.has(dependency.name)) continue
          reached.add(dependency.name)
          walk(dependency)
        }
      }
      walk(member)
      return reached
    }
    /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const visit = (member: ReleaseMember): void => {
      if (placed.has(member.name) || onStack.has(member.name)) return
      onStack.add(member.name)
      /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
      for (const dependency of edges(member, INSTALL_SECTIONS)) visit(dependency)
      /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
      for (const peer of edges(member, PEER_SECTIONS)) {
        if (installClosure(peer).has(member.name)) {
          droppedPeerEdges.push({ consumer: member.name, peer: peer.name })
          continue
        }
        // A peer already on the stack is an ancestor, so it publishes after this
        // member rather than before it: the edge is dropped, not honoured.
        if (onStack.has(peer.name)) droppedPeerEdges.push({ consumer: member.name, peer: peer.name })
        visit(peer)
      }
      onStack.delete(member.name)
      placed.add(member.name)
      ordered.push(member)
    }
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const member of byNameSorted) visit(member)

    // A cycle mixing both kinds of edge can put an install edge's target on the
    // stack, where the traversal skips it like a peer edge and emits a consumer
    // before something it installs. Nothing downstream can detect that, and it
    // would only surface as an unresolvable install for whoever consumes the
    // published packages, so the emitted order is checked against the edges it
    // exists to honour.
    /** 中文说明：函数值 position 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const position = new Map(ordered.map((entry, index) => [entry.name, index]))
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const [index, member] of ordered.entries()) {
      /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
      for (const dependency of edges(member, INSTALL_SECTIONS)) {
        /** 中文说明：变量 dependencyIndex 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const dependencyIndex = position.get(dependency.name)
        if (dependencyIndex !== undefined && dependencyIndex < index) continue
        throw new Error(
          `release family ${this.id}: no publish order honours ${member.name} -> ${dependency.name};`
          + ' a cycle mixing peer and dependency declarations reaches this dependency through a peer edge',
        )
      }
    }
    return { order: ordered, droppedPeerEdges }
  }

  /**
   * The family members one member declares in the given sections.
   * @param member - the dependent member.
   * @param byName - every family member by package name.
   * @param sections - manifest sections to read.
   * @returns Members of this family named there, sorted by name.
   */
  private orderEdges(
    member: ReleaseMember,
    byName: ReadonlyMap<string, ReleaseMember>,
    sections: readonly string[],
  ): ReleaseMember[] {
    /** 中文说明：变量 edges 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const edges: ReleaseMember[] = []
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const section of sections) {
      /** 中文说明：变量 dependencies 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const dependencies = member.manifest[section]
      if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue
      /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
      for (const name of Object.keys(dependencies)) {
        /** 中文说明：变量 dependency 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const dependency = byName.get(name)
        if (dependency !== undefined && dependency.name !== member.name) edges.push(dependency)
      }
    }
    return edges.sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Assert this family's version baseline holds across its members.
   * @param members - this family's members.
   */
  abstract verifyVersions(members: readonly ReleaseMember[]): void

  /**
   * The tag prefix a member's versions are tagged under. Every tag for that
   * member starts with it, which is how the last published version is found.
   * @param member - the member being published.
   * @returns The prefix, ending in `-v`.
   */
  abstract tagPrefixFor(member: ReleaseMember): string

  /**
   * The tag a member publishes from.
   * @param member - the member being published.
   * @returns The full tag name, without `refs/tags/`.
   */
  tagFor(member: ReleaseMember): string {
    return `${this.tagPrefixFor(member)}${member.version}`
  }

  /**
   * Check what a member's packed tarball carries.
   * @param member - the packed member.
   * @param files - every path inside its tarball.
   */
  abstract validatePayload(member: ReleaseMember, files: readonly string[]): void

  /**
   * The executable that proves this family's artifacts install and run, or
   * `undefined` for a family that publishes no executable.
   */
  abstract readonly installedEntry: InstalledEntry | undefined
}

/** Release packages and apps: one shared version across the whole family. */
/* 中文说明：class DshFamily 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class DshFamily extends ReleaseFamily {
  readonly id = 'dsh'
  readonly patterns = ['packages/!(experimental)/*/package.json', 'apps/*/package.json'] as const
  readonly tagPrefix = 'dsh-v'

  /** Require current artifacts from a complete official client build. */
  override verifyBuildArtifacts(root: string): void {
    readClientBuildRecord(root, officialClientBuildEnvironment(root))
  }

  /**
   * Require one version across the family, the way a single tag can name it.
   * @param members - this family's members.
   */
  verifyVersions(members: readonly ReleaseMember[]): void {
    /** 中文说明：函数值 versions 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const versions = new Set(members.map(member => member.version))
    if (versions.size !== 1) {
      /** 中文说明：函数值 detail 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const detail = members.map(member => `${member.directory}: ${member.version}`).join('\n')
      throw new Error(`dsh release members must share one version:\n${detail}`)
    }
  }

  /**
   * The single family prefix: every member shares one version, so one tag names it.
   * @returns `dsh-v`.
   */
  tagPrefixFor(): string {
    return this.tagPrefix
  }

  /**
   * Reject source and declaration-map members, the repository's publication policy.
   * @param member - the packed member.
   * @param files - every path inside its tarball.
   */
  validatePayload(member: ReleaseMember, files: readonly string[]): void {
    validateTarballPayload(files, member.name)
  }

  readonly installedEntry = { packageName: '@deepseek-ai/dsh', binPath: 'lib/bin.js' }
}

/** `vendor/*`: every package keeps its own version line, so every package has its own tag. */
/* 中文说明：class VendorFamily 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class VendorFamily extends ReleaseFamily {
  readonly id = 'vendor'
  readonly patterns = ['vendor/*/package.json'] as const
  readonly tagPrefix = 'vendor-'

  /**
   * Accept independent versions; only reject a version this repository cannot publish.
   * @param members - this family's members.
   */
  verifyVersions(members: readonly ReleaseMember[]): void {
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const member of members) {
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(member.version)) {
        throw new Error(`${member.directory} has an unpublishable version: ${member.version}`)
      }
    }
  }

  /**
   * A prefix per member, because one vendor release can carry several versions.
   * @param member - the member being published.
   * @returns `vendor-<unscoped name>-v`.
   */
  tagPrefixFor(member: ReleaseMember): string {
    return `${this.tagPrefix}${member.name.replace('@deepseek-ai/', '')}-v`
  }

  /**
   * Require the payload the vendored manifest declares, including upstream's
   * `src` tree and declaration maps.
   *
   * The harness policy that rejects both does not apply here: these manifests
   * export `./src/*` for source navigation, so dropping `src` would publish a
   * package whose export map points at absent files. What must hold instead is
   * that every path the manifest selects is present, which `files` already
   * decides and `pnpm pack` already enforces.
   * @param member - the packed member.
   * @param files - every path inside its tarball.
   */
  validatePayload(member: ReleaseMember, files: readonly string[]): void {
    if (files.length === 0) throw new Error(`${member.name} packed an empty tarball`)
  }

  /** No installed-entry probe: these are libraries a consumer imports, with no executable. */
  readonly installedEntry = undefined
}

/** Every release family this module owns, in workflow order. */
/* 中文说明：函数 releaseFamilies 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function releaseFamilies(): readonly ReleaseFamily[] {
  return [new DshFamily(), new VendorFamily()]
}

/**
 * Resolve a family by its `--family` identifier.
 * @param id - family identifier.
 * @returns The family.
 */
/* 中文说明：函数 releaseFamily 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function releaseFamily(id: string): ReleaseFamily {
  /** 中文说明：函数值 family 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const family = releaseFamilies().find(candidate => candidate.id === id)
  if (family === undefined) {
    /** 中文说明：函数值 known 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const known = releaseFamilies().map(candidate => candidate.id).join(', ')
    throw new Error(`unknown release family ${id}; expected one of ${known}`)
  }
  return family
}

/**
 * The npm tarball filename `pnpm pack` writes for a member.
 * @param member - the packed member.
 * @returns The tarball filename.
 */
/* 中文说明：函数 tarballName 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function tarballName(member: ReleaseMember): string {
  /** 中文说明：变量 unscoped 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const unscoped = member.name.startsWith('@') ? member.name.slice(1).replace('/', '-') : member.name
  return `${unscoped}-${member.version}.tgz`
}
