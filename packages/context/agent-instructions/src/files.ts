/**
 * Instruction-file discovery and bounded, abort-aware provider reads.
 *
 * @module @deepseek-ai/dsh-agent-instructions/files
 */
/*
 * 文件职责：实现工作区指令上下文的 files.ts 模块。
 * 技术维度：TypeScript、Cordis 插件、会话事件和严格判别联合。
 * 产品维度：控制模型请求中的工作区指令上下文信息。
 * 逻辑维度：读取日志或文件状态，计算投影并记录/注入结果。
 * 关键边界：不能静默丢失必需事件；裁剪和替换必须保持日志可重放。
 * 新手阅读建议：先读导出类型与配置，再跟踪事件和投影流程。
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { FileSystem, FsInfo, FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import { assertNever } from '@deepseek-ai/dsh-llm'
import { dshHomeDisplay } from '@deepseek-ai/dsh-home-paths'
import { resolveConfig, resolveDiscoveryConfig, type ResolvedConfig } from './config.ts'
import { trimmedInstructionDigest } from './digest.ts'
import {
  decodeScopeKey,
  renderWorkspaceInstructionSet,
  /** 中文说明：类型或类 RenderedWorkspaceContext 约束上下文或压缩数据职责。 */
  type RenderedWorkspaceContext,
  USER_GLOBAL_DIRECTORY,
  USER_GLOBAL_FILE,
} from './render.ts'

/** An instruction candidate identified by absolute and model-facing paths. */
/* 中文说明：类型或类 InstructionFile 约束上下文或压缩数据职责。 */
export interface InstructionFile {
  absolutePath: string
  displayPath: string
}

/** An instruction file whose UTF-8 content was read successfully. */
/* 中文说明：类型或类 LoadedInstructionFile 约束上下文或压缩数据职责。 */
export interface LoadedInstructionFile extends InstructionFile {
  content: string
  /** Provider freshness token when the file was loaded through `ctx.fs`. */
  version?: FsVersion
}

/** 中文说明：类型或类 DiscoveredInstructionFile 约束上下文或压缩数据职责。 */
interface DiscoveredInstructionFile extends InstructionFile {
  target?: FsTarget
  size?: number
  version?: FsVersion
}

/** Provider metadata for a probed scope candidate before its content is read. */
/* 中文说明：类型或类 ProbedInstructionFile 约束上下文或压缩数据职责。 */
export interface ProbedInstructionFile extends InstructionFile {
  target: FsTarget
  version: FsVersion
  size?: number
}

/** 中文说明：类型或类 DiscoverOptions 约束上下文或压缩数据职责。 */
interface DiscoverOptions {
  cwd: string
  dshHome?: string
  projectRootMarkers?: string[]
  instructionFileCandidates?: string[]
  localInstructionFileCandidates?: string[]
  projectRoot?: string
  signal?: AbortSignal
}

/** 中文说明：类型或类 LoadOptions 约束上下文或压缩数据职责。 */
interface LoadOptions extends DiscoverOptions {
  maxBytes: number
  maxSourceBytes?: number
  replacePreviousBaseline?: boolean
}

/** Rendered baseline plus the successfully read and byte-budget-retained files. */
/* 中文说明：类型或类 RenderedInstructionSet 约束上下文或压缩数据职责。 */
export interface RenderedInstructionSet {
  rendered: RenderedWorkspaceContext
  /** Successfully read candidates before content deduplication and byte budgeting. */
  observed: LoadedInstructionFile[]
  /** Candidates retained by content deduplication and byte budgeting. */
  included: LoadedInstructionFile[]
}
/** Tri-state scope probe that distinguishes confirmed absence from provider failure. */
/* 中文说明：类型或类 ScopeInstructionProbe 约束上下文或压缩数据职责。 */
export type ScopeInstructionProbe =
  | { kind: 'present'; file: ProbedInstructionFile }
  | { kind: 'absent' }
  | { kind: 'unavailable' }

/** 中文说明：类型或类 StatFileInfo 约束上下文或压缩数据职责。 */
interface StatFileInfo {
  target?: FsTarget
  size?: number
  version?: FsVersion
}

/** 中文说明：类型或类 StatFileProbe 约束上下文或压缩数据职责。 */
type StatFileProbe =
  | { kind: 'present'; info: StatFileInfo }
  | { kind: 'absent' }
  | { kind: 'unavailable' }

/** 中文说明：函数 signalOptions 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function signalOptions(signal?: AbortSignal): { signal: AbortSignal } | undefined {
  return signal === undefined ? undefined : { signal }
}

/** 中文说明：函数 isMissingPathError 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

/** 中文说明：函数 nodeStatFile 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function nodeStatFile(path: string, signal?: AbortSignal): Promise<StatFileProbe> {
  try {
    signal?.throwIfAborted()
    // stat (not lstat) follows a final-component symlink so a link to a regular
    // file loads; a broken link surfaces as ENOENT and is treated as absent below.
    /** 中文说明：上下文局部值 info，由紧邻初始化决定。 */
    const info = await stat(path)
    signal?.throwIfAborted()
    if (!info.isFile()) return { kind: 'absent' }
    return { kind: 'present', info: { size: info.size } }
  } catch (error: unknown) {
    signal?.throwIfAborted()
    return isMissingPathError(error) ? { kind: 'absent' } : { kind: 'unavailable' }
  }
}

/** 中文说明：函数 fsStatFile 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function fsStatFile(
  path: string,
  fileSystem: FileSystem,
  signal?: AbortSignal,
): Promise<StatFileProbe> {
  // resolve() follows a final-component symlink to its target's stable identity;
  // stat then classifies that target. A link to a regular file loads, while a
  // missing path or non-file target (including a link to a directory) is absent.
  try {
    /** 中文说明：上下文局部值 target，由紧邻初始化决定。 */
    const target = await fileSystem.resolve(path, signalOptions(signal))
    signal?.throwIfAborted()
    /** 中文说明：上下文局部值 info，由紧邻初始化决定。 */
    const info = await fileSystem.stat(target, signal)
    signal?.throwIfAborted()
    if (info?.type !== 'file') return { kind: 'absent' }
    return {
      kind: 'present',
      info: { target, version: info.version, ...info.size === undefined ? {} : { size: info.size } },
    }
  } catch {
    signal?.throwIfAborted()
    return { kind: 'unavailable' }
  }
}

/** 中文说明：函数 statFile 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function statFile(
  path: string,
  fileSystem?: FileSystem,
  signal?: AbortSignal,
): Promise<StatFileProbe> {
  return fileSystem === undefined ? nodeStatFile(path, signal) : fsStatFile(path, fileSystem, signal)
}

/** 中文说明：函数 existsAsMarker 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function existsAsMarker(path: string, fileSystem?: FileSystem, signal?: AbortSignal): Promise<boolean> {
  if (fileSystem !== undefined) {
    try {
      /** 中文说明：上下文局部值 target，由紧邻初始化决定。 */
      const target = await fileSystem.resolve(path, signalOptions(signal))
      return await fileSystem.stat(target, signal) !== undefined
    } catch {
      signal?.throwIfAborted()
      // TODO(root-marker-unavailable): preserve provider failure separately from
      // absence and stop discovery; continuing upward can cross into an ancestor project.
      return false
    }
  }
  try {
    signal?.throwIfAborted()
    await stat(path)
    signal?.throwIfAborted()
    return true
  } catch {
    signal?.throwIfAborted()
    return false
  }
}

/**
 * Walk upward to the first directory containing a configured root marker.
 * @param cwd - absolute session working directory where the walk begins.
 * @param markers - child names that identify a project root.
 * @param fileSystem - optional provider used instead of host filesystem probes.
 * @param signal - cancellation for provider and host probes.
 * @returns the discovered project root, or `cwd` when no marker exists.
 */
/*
 * 中文说明：函数 findProjectRoot 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param cwd 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param markers 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param fileSystem 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param signal 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function findProjectRoot(
  cwd: string,
  markers: readonly string[],
  fileSystem?: FileSystem,
  signal?: AbortSignal,
): Promise<string> {
  /** 中文说明：上下文局部值 current，由紧邻初始化决定。 */
  let current = resolve(cwd)
  for (;;) {
    /** 中文说明：上下文局部值 marker，由紧邻初始化决定。 */
    for (const marker of markers) {
      if (await existsAsMarker(join(current, marker), fileSystem, signal)) return current
    }
    /** 中文说明：上下文局部值 parent，由紧邻初始化决定。 */
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/**
 * Build the inclusive root-to-cwd directory chain.
 * @param root - root directory expected to contain or equal `cwd`.
 * @param cwd - most-specific directory in the chain.
 * @returns directories ordered from broadest to most specific.
 */
/*
 * 中文说明：函数 ancestorChain 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param root 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param cwd 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function ancestorChain(root: string, cwd: string): string[] {
  /** 中文说明：上下文局部值 chain，由紧邻初始化决定。 */
  const chain: string[] = []
  /** 中文说明：上下文局部值 current，由紧邻初始化决定。 */
  let current = resolve(cwd)
  /** 中文说明：上下文局部值 resolvedRoot，由紧邻初始化决定。 */
  const resolvedRoot = resolve(root)
  while (current !== resolvedRoot) {
    chain.push(current)
    /** 中文说明：上下文局部值 parent，由紧邻初始化决定。 */
    const parent = dirname(current)
    /* v8 ignore next -- discovery always supplies cwd or an ancestor root. */
    if (parent === current) break
    current = parent
  }
  chain.push(resolvedRoot)
  return chain.reverse()
}

/**
 * Find descendant directories crossed between a cwd and a touched file.
 * @param root - session cwd that bounds nested discovery.
 * @param touchedPath - absolute path or path relative to `root`.
 * @returns descendant directories from shallowest through the touched file's parent.
 */
/*
 * 中文说明：函数 descendantDirsBetween 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param root 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param touchedPath 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function descendantDirsBetween(root: string, touchedPath: string): string[] {
  /** 中文说明：上下文局部值 resolvedRoot，由紧邻初始化决定。 */
  const resolvedRoot = resolve(root)
  /** 中文说明：上下文局部值 targetPath，由紧邻初始化决定。 */
  const targetPath = isAbsolute(touchedPath) ? resolve(touchedPath) : resolve(resolvedRoot, touchedPath)
  /** 中文说明：上下文局部值 targetDir，由紧邻初始化决定。 */
  const targetDir = dirname(targetPath)
  /** 中文说明：上下文局部值 rel，由紧邻初始化决定。 */
  const rel = relative(resolvedRoot, targetDir)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return []
  return ancestorChain(resolvedRoot, targetDir).slice(1)
}

/**
 * Convert an absolute instruction path to its project-root-relative display form.
 * @param root - project root used as the display base.
 * @param path - absolute path to display.
 * @returns the root-relative path.
 */
/*
 * 中文说明：函数 relativeDisplay 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param root 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param path 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function relativeDisplay(root: string, path: string): string {
  return relative(root, path)
}

/** 中文说明：函数 allExistingInstructionFiles 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function allExistingInstructionFiles(
  dir: string,
  root: string,
  instructionFileCandidates: readonly string[],
  fileSystem?: FileSystem,
  signal?: AbortSignal,
): Promise<DiscoveredInstructionFile[]> {
  /** 中文说明：上下文局部值 found，由紧邻初始化决定。 */
  const found: DiscoveredInstructionFile[] = []
  /** 中文说明：上下文局部值 candidate，由紧邻初始化决定。 */
  for (const candidate of instructionFileCandidates) {
    /** 中文说明：上下文局部值 path，由紧邻初始化决定。 */
    const path = join(dir, candidate)
    /** 中文说明：上下文局部值 probe，由紧邻初始化决定。 */
    const probe = await statFile(path, fileSystem, signal)
    switch (probe.kind) {
      case 'present':
        found.push({ absolutePath: path, displayPath: relativeDisplay(root, path), ...probe.info })
        continue
      // A missing candidate is skipped; a transient provider failure skips only
      // that candidate so the remaining independent candidates still load.
      case 'absent':
      case 'unavailable':
        continue
      /* v8 ignore next 2 -- StatFileProbe is closed; this arm only makes adding a kind a compile error. */
      default:
        assertNever(probe, 'StatFileProbe')
    }
  }
  return found
}

/** 中文说明：函数 discoverInstructionFiles 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function discoverInstructionFiles(
  options: DiscoverOptions,
  fileSystem?: FileSystem,
): Promise<DiscoveredInstructionFile[]> {
  /** 中文说明：上下文局部值 config，由紧邻初始化决定。 */
  const config = resolveDiscoveryConfig(options)
  /** 中文说明：上下文局部值 files，由紧邻初始化决定。 */
  const files: DiscoveredInstructionFile[] = []
  /** 中文说明：上下文局部值 seen，由紧邻初始化决定。 */
  const seen = new Set<string>()
  /** 中文说明：上下文局部值 addFile，由紧邻初始化决定。 */
  const addFile = (file: DiscoveredInstructionFile): void => {
    if (seen.has(file.absolutePath)) return
    seen.add(file.absolutePath)
    files.push(file)
  }

  /** 中文说明：上下文局部值 userGlobal，由紧邻初始化决定。 */
  const userGlobal = join(config.dshHome, USER_GLOBAL_FILE)
  /** 中文说明：上下文局部值 userGlobalProbe，由紧邻初始化决定。 */
  const userGlobalProbe = await statFile(userGlobal, fileSystem, options.signal)
  switch (userGlobalProbe.kind) {
    case 'present':
      addFile({
        absolutePath: userGlobal,
        displayPath: userGlobalDisplayPath(config.dshHome),
        ...userGlobalProbe.info,
      })
      break
    case 'absent':
    case 'unavailable':
      break
    /* v8 ignore next 2 -- StatFileProbe is closed; this arm only makes adding a kind a compile error. */
    default:
      assertNever(userGlobalProbe, 'StatFileProbe')
  }

  /** 中文说明：上下文局部值 cwd，由紧邻初始化决定。 */
  const cwd = resolve(options.cwd)
  /** 中文说明：上下文局部值 projectRoot，由紧邻初始化决定。 */
  const projectRoot = options.projectRoot
    ?? await findProjectRoot(cwd, config.projectRootMarkers, fileSystem, options.signal)
  /** 中文说明：上下文局部值 dir，由紧邻初始化决定。 */
  for (const dir of ancestorChain(projectRoot, cwd)) {
    /** 中文说明：上下文局部值 candidates，由紧邻初始化决定。 */
    for (const candidates of [config.instructionFileCandidates, config.localInstructionFileCandidates]) {
      /** 中文说明：上下文局部值 file，由紧邻初始化决定。 */
      for (const file of await allExistingInstructionFiles(dir, projectRoot, candidates, fileSystem, options.signal)) {
        addFile(file)
      }
    }
  }
  return files
}

/**
 * Discover host-visible user-global and root-to-cwd instruction candidates.
 * All present candidates in each directory are returned; trimmed-content
 * duplicates are collapsed later, once content is read.
 * @param options - cwd, home, root marker, and candidate configuration.
 * @returns path-deduplicated instruction candidates in model precedence order.
 */
/*
 * 中文说明：函数 discoverBaselineInstructionFiles 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function discoverBaselineInstructionFiles(options: DiscoverOptions): Promise<InstructionFile[]> {
  return (await discoverInstructionFiles(options)).map(({ absolutePath, displayPath }) => ({ absolutePath, displayPath }))
}

/** 中文说明：函数 nodeTextChunks 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function* nodeTextChunks(path: string, signal?: AbortSignal): AsyncIterable<string> {
  /** 中文说明：上下文局部值 stream，由紧邻初始化决定。 */
  const stream = createReadStream(path, { encoding: 'utf8', signal })
  /** 中文说明：上下文局部值 chunk，由紧邻初始化决定。 */
  for await (const chunk of stream) yield String(chunk)
}

/** 中文说明：函数 readBounded 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function readBounded(
  file: { absolutePath: string; target?: FsTarget; size?: number },
  maxSourceBytes: number,
  fileSystem?: FileSystem,
  signal?: AbortSignal,
): Promise<string | undefined> {
  // TODO(total-instruction-read-bound): enforce an aggregate source budget
  // across a complete baseline or reconciliation batch; the render budget is
  // applied only after every accepted file has been read under this per-file cap.
  signal?.throwIfAborted()
  if (file.size !== undefined && file.size > maxSourceBytes) return undefined
  try {
    /** 中文说明：上下文局部值 chunks，由紧邻初始化决定。 */
    const chunks = fileSystem === undefined || file.target === undefined
      ? nodeTextChunks(file.absolutePath, signal)
      : await fileSystem.streamText(file.target, signal)
    /** 中文说明：上下文局部值 parts，由紧邻初始化决定。 */
    const parts: string[] = []
    /** 中文说明：上下文局部值 bytes，由紧邻初始化决定。 */
    let bytes = 0
    /** 中文说明：上下文局部值 chunk，由紧邻初始化决定。 */
    for await (const chunk of chunks) {
      signal?.throwIfAborted()
      bytes += Buffer.byteLength(chunk, 'utf8')
      if (bytes > maxSourceBytes) return undefined
      parts.push(chunk)
    }
    signal?.throwIfAborted()
    return parts.join('')
  } catch {
    signal?.throwIfAborted()
    // A file may disappear or become unreadable after its metadata probe.
    return undefined
  }
}

/**
 * Drop later candidates whose trimmed content duplicates an earlier sibling in
 * the same directory. Different directories never collapse even when identical;
 * within one directory the earliest candidate in discovery order is kept and its
 * original bytes are rendered. A candidate that symlinks a sibling resolves to
 * the same content and collapses here like any byte-identical real file.
 * @param files - loaded files in discovery order.
 * @returns the retained files in the same order.
 */
/*
 * 中文说明：函数 dedupInstructionFilesByDirectory 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param files 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function dedupInstructionFilesByDirectory(files: LoadedInstructionFile[]): LoadedInstructionFile[] {
  /** 中文说明：上下文局部值 keptDigestsByDir，由紧邻初始化决定。 */
  const keptDigestsByDir = new Map<string, Set<string>>()
  /** 中文说明：上下文局部值 kept，由紧邻初始化决定。 */
  const kept: LoadedInstructionFile[] = []
  /** 中文说明：上下文局部值 file，由紧邻初始化决定。 */
  for (const file of files) {
    /** 中文说明：上下文局部值 dir，由紧邻初始化决定。 */
    const dir = dirname(file.displayPath)
    /** 中文说明：上下文局部值 digests，由紧邻初始化决定。 */
    let digests = keptDigestsByDir.get(dir)
    if (digests === undefined) {
      digests = new Set()
      keptDigestsByDir.set(dir, digests)
    }
    /** 中文说明：上下文局部值 digest，由紧邻初始化决定。 */
    const digest = trimmedInstructionDigest(file.content)
    if (digests.has(digest)) continue
    digests.add(digest)
    kept.push(file)
  }
  return kept
}

/**
 * Discover, read, and render the baseline instruction chain.
 * @param options - discovery, source-size, byte-budget, and cancellation configuration.
 * @param fileSystem - optional provider used instead of host filesystem reads.
 * @returns rendered baseline context, or undefined when nothing can be loaded.
 */
/*
 * 中文说明：函数 loadBaselineInstructions 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param fileSystem 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function loadBaselineInstructions(
  options: LoadOptions,
  fileSystem?: FileSystem,
): Promise<RenderedWorkspaceContext | undefined> {
  return (await loadBaselineInstructionSet(options, fileSystem))?.rendered
}

/**
 * Load a baseline together with the files retained after rendering.
 * @param options - discovery, source-size, byte-budget, and cancellation configuration.
 * @param fileSystem - optional provider used instead of host filesystem reads.
 * @returns rendered context and retained files, an explicit empty replacement set, or undefined when empty or disabled.
 */
/*
 * 中文说明：函数 loadBaselineInstructionSet 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param fileSystem 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function loadBaselineInstructionSet(
  options: LoadOptions,
  fileSystem?: FileSystem,
): Promise<RenderedInstructionSet | undefined> {
  /** 中文说明：上下文局部值 config，由紧邻初始化决定。 */
  const config = resolveConfig(options)
  if (config.maxBytes <= 0 || !Number.isFinite(config.maxBytes)) return undefined
  if (config.maxSourceBytes <= 0 || !Number.isFinite(config.maxSourceBytes)) return undefined
  /** 中文说明：上下文局部值 discovered，由紧邻初始化决定。 */
  const discovered = await discoverInstructionFiles(options, fileSystem)
  /** 中文说明：上下文局部值 loaded，由紧邻初始化决定。 */
  const loaded: LoadedInstructionFile[] = []
  /** 中文说明：上下文局部值 file，由紧邻初始化决定。 */
  for (const file of discovered) {
    /** 中文说明：上下文局部值 content，由紧邻初始化决定。 */
    const content = await readBounded(file, config.maxSourceBytes, fileSystem, options.signal)
    if (content !== undefined) {
      loaded.push({
        absolutePath: file.absolutePath,
        displayPath: file.displayPath,
        content,
        ...file.version === undefined ? {} : { version: file.version },
      })
    }
  }
  /** 中文说明：上下文局部值 deduped，由紧邻初始化决定。 */
  const deduped = dedupInstructionFilesByDirectory(loaded)
  if (deduped.length === 0) {
    if (options.replacePreviousBaseline !== true) return undefined
    /** 中文说明：上下文局部值 { rendered, included }，由紧邻初始化决定。 */
    const { rendered, included } = renderWorkspaceInstructionSet([], {
      maxBytes: config.maxBytes,
      replacePreviousBaseline: true,
    })
    return {
      rendered,
      observed: [],
      included,
    }
  }
  /** 中文说明：上下文局部值 { rendered, included }，由紧邻初始化决定。 */
  const { rendered, included } = renderWorkspaceInstructionSet(deduped, {
    maxBytes: config.maxBytes,
    ...options.replacePreviousBaseline === undefined
      ? {}
      : { replacePreviousBaseline: options.replacePreviousBaseline },
  })
  return {
    rendered,
    observed: loaded,
    included,
  }
}

/**
 * Probe the current provider metadata for one per-candidate instruction scope.
 * @param scope - a {@link candidateScopeKey} identifying a directory and candidate file.
 * @param projectRoot - project root used to resolve and display project scopes.
 * @param resolved - normalized plugin configuration.
 * @param fileSystem - provider used to resolve and stat scope candidates.
 * @param signal - cancellation for provider probes.
 * @returns present metadata, confirmed absence, or temporary unavailability.
 */
/*
 * 中文说明：函数 probeScopeInstruction 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param scope 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param projectRoot 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param resolved 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param fileSystem 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param signal 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function probeScopeInstruction(
  scope: string,
  projectRoot: string,
  resolved: ResolvedConfig,
  fileSystem: FileSystem,
  signal?: AbortSignal,
): Promise<ScopeInstructionProbe> {
  /** 中文说明：上下文局部值 解构结果，由紧邻初始化决定。 */
  const { directory, candidateName } = decodeScopeKey(scope)
  /** 中文说明：上下文局部值 dir，由紧邻初始化决定。 */
  const dir = directory === USER_GLOBAL_DIRECTORY
    ? resolved.dshHome
    : directory === '.' ? projectRoot : join(projectRoot, directory)
  /** 中文说明：上下文局部值 absolutePath，由紧邻初始化决定。 */
  const absolutePath = join(dir, candidateName)
  // resolve() follows a final-component symlink; stat then classifies the target.
  // A non-file target (missing, or a link to a directory) is a confirmed absence;
  // only a provider exception is reported as unavailable.
  /** 中文说明：上下文局部值 target: FsTarget，由紧邻初始化决定。 */
  let target: FsTarget
  /** 中文说明：上下文局部值 info: FsInfo | undefined，由紧邻初始化决定。 */
  let info: FsInfo | undefined
  try {
    target = await fileSystem.resolve(absolutePath, signalOptions(signal))
    info = await fileSystem.stat(target, signal)
  } catch {
    signal?.throwIfAborted()
    return { kind: 'unavailable' }
  }
  if (info?.type !== 'file') return { kind: 'absent' }
  /** 中文说明：上下文局部值 file，由紧邻初始化决定。 */
  const file: ProbedInstructionFile = {
    absolutePath,
    displayPath: directory === USER_GLOBAL_DIRECTORY ? userGlobalDisplayPath(resolved.dshHome) : relativeDisplay(projectRoot, absolutePath),
    target,
    version: info.version,
    ...info.size === undefined ? {} : { size: info.size },
  }
  return { kind: 'present', file }
}

/**
 * Read one already-probed scope candidate under the configured source cap.
 * @param file - winning provider candidate and its metadata snapshot.
 * @param maxSourceBytes - maximum UTF-8 bytes accepted from the source.
 * @param fileSystem - provider used for the streaming read.
 * @param signal - cancellation for provider streaming.
 * @returns loaded content with the probed version, or undefined when unavailable.
 */
/*
 * 中文说明：函数 readScopeInstruction 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param file 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param maxSourceBytes 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param fileSystem 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param signal 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function readScopeInstruction(
  file: ProbedInstructionFile,
  maxSourceBytes: number,
  fileSystem: FileSystem,
  signal?: AbortSignal,
): Promise<LoadedInstructionFile | undefined> {
  /** 中文说明：上下文局部值 content，由紧邻初始化决定。 */
  const content = await readBounded(file, maxSourceBytes, fileSystem, signal)
  if (content === undefined) return undefined
  return {
    absolutePath: file.absolutePath,
    displayPath: file.displayPath,
    content,
    version: file.version,
  }
}

/** 中文说明：函数 userGlobalDisplayPath 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function userGlobalDisplayPath(dshHome: string): string {
  return `${dshHomeDisplay(dshHome)}/AGENTS.md`
}
