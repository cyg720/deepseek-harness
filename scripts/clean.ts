/**
 * 文件职责：实现 clean.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */
import { lstat, readdir, realpath, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { repositoryConfigHost } from './ts-project.ts'

/** 中文说明：变量 knownOrphanEntries 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const knownOrphanEntries = new Set(['node_modules', 'lib', '.typecheck'])

/** 中文说明：函数 isMissing 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** 中文说明：函数 exists 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

/** 中文说明：函数 childDirectories 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function childDirectories(path: string): Promise<string[]> {
  try {
    /** 中文说明：变量 entries 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => join(path, entry.name))
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

/** 中文说明：函数 repositoryPath 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function repositoryPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

/** 中文说明：函数 parseConfig 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function parseConfig(configPath: string): ts.ParsedCommandLine {
  /** 中文说明：变量 parsed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, repositoryConfigHost)
  if (!parsed) throw new Error(`clean: cannot parse TypeScript config ${configPath}`)
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }
  return parsed
}

/** Plans and removes repository-owned build output without crossing the repository boundary. */
/** 中文说明：class RepositoryCleaner 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
export class RepositoryCleaner {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  /**
   * Remove generated build state and package directories containing only known residue.
   * @returns Repository-relative paths that were removed.
   */
  async clean(): Promise<string[]> {
    /** 中文说明：变量 targets 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const targets = await this.plan()
    // Planning validates every target first, so an unsafe orphan prevents all deletion.
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const target of targets) await rm(target, { recursive: true, force: true })
    return targets.map(target => repositoryPath(this.root, target))
  }

  private async plan(): Promise<string[]> {
    /** 中文说明：变量 targets 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const targets = new Set<string>()
    /** 中文说明：变量 unsafeOrphans 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unsafeOrphans: string[] = []
    /** 中文说明：变量 canonicalRoot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const canonicalRoot = await realpath(this.root)

    await this.addIfPresent(targets, join(this.root, '.dsh-build'), canonicalRoot)

    // These checks cover legacy root-level incremental state emitted by older configs.
    await this.addIfPresent(targets, join(this.root, '.typecheck'), canonicalRoot)
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.tsbuildinfo')) targets.add(join(this.root, entry.name))
    }
    await this.addIfPresent(
      targets,
      join(this.root, 'native/landlock-run/tsconfig.tsbuildinfo'),
      canonicalRoot,
    )

    // The root project-reference graph is the source of truth for live build targets.
    // Each emitting project declares lib/types as outDir; its parent lib also owns
    // the sibling runtime bundles, so the complete build output root is removed.
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const outputDirectory of this.buildOutputDirectories()) {
      await this.addIfPresent(targets, outputDirectory, canonicalRoot)
    }

    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const groupDirectory of await childDirectories(join(this.root, 'packages'))) {
      /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
      for (const packageDirectory of await childDirectories(groupDirectory)) {
        // A package.json marks a live package; its output was discovered from the
        // project graph above, and its package-local node_modules must be preserved.
        if (await exists(join(packageDirectory, 'package.json'))) {
          continue
        }

        // A manifest-less package directory is stale only when every remaining
        // entry is known generated residue; unknown files make the whole clean fail.
        /** 中文说明：变量 entries 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const entries = await readdir(packageDirectory)
        /** 中文说明：函数值 unknown 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
        const unknown = entries.filter(entry => !knownOrphanEntries.has(entry) && !entry.endsWith('.tsbuildinfo'))
        if (unknown.length > 0) {
          unsafeOrphans.push(...unknown.map(entry => repositoryPath(this.root, join(packageDirectory, entry))))
        } else {
          await this.addIfPresent(targets, packageDirectory, canonicalRoot)
        }
      }
    }

    if (unsafeOrphans.length > 0) {
      throw new Error([
        'clean: refusing to remove package directories without package.json; unknown entries remain:',
        ...unsafeOrphans.sort().map(path => `  ${path}`),
      ].join('\n'))
    }

    return [...targets].sort()
  }

  private buildOutputDirectories(): string[] {
    /** 中文说明：变量 outputs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outputs = new Set<string>()
    /** 中文说明：变量 pending 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = [join(this.root, 'tsconfig.json')]
    /** 中文说明：变量 visited 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const visited = new Set<string>()
    /** 中文说明：变量 nativeEntryOutput 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nativeEntryOutput = join(this.root, 'native/landlock-run/packages/entry/lib')

    while (pending.length > 0) {
      /** 中文说明：变量 nextConfigPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const nextConfigPath = pending.pop()
      if (nextConfigPath === undefined) break
      /** 中文说明：变量 configPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const configPath = resolve(nextConfigPath)
      if (visited.has(configPath)) continue
      visited.add(configPath)

      /** 中文说明：变量 parsed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const parsed = parseConfig(configPath)
      if (parsed.options.outDir !== undefined) {
        /** 中文说明：变量 typesDirectory 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const typesDirectory = resolve(parsed.options.outDir)
        /** 中文说明：变量 outputDirectory 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const outputDirectory = basename(typesDirectory) === 'types'
          ? dirname(typesDirectory)
          : typesDirectory === nativeEntryOutput
            ? typesDirectory
            : undefined
        if (outputDirectory === undefined) {
          throw new Error(`clean: expected TypeScript outDir to end in /types: ${repositoryPath(this.root, typesDirectory)}`)
        }
        this.assertRepositoryTarget(outputDirectory)
        outputs.add(outputDirectory)
      }

      /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
      for (const reference of parsed.projectReferences ?? []) {
        pending.push(ts.resolveProjectReferencePath(reference))
      }
    }

    return [...outputs]
  }

  private assertRepositoryTarget(path: string): void {
    this.assertDescendant(this.root, path, path)
  }

  private assertDescendant(root: string, path: string, displayPath: string): void {
    /** 中文说明：变量 repositoryRelative 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const repositoryRelative = relative(root, path)
    if (repositoryRelative === '' || repositoryRelative === '..' || repositoryRelative.startsWith(`..${sep}`) || isAbsolute(repositoryRelative)) {
      throw new Error(`clean: refusing deletion target outside repository: ${displayPath}`)
    }
  }

  private async addIfPresent(targets: Set<string>, path: string, canonicalRoot: string): Promise<void> {
    // Missing outputs are normal on a clean checkout; only existing paths become deletion targets.
    if (!await exists(path)) return
    // Resolve the parent rather than the final entry: rm unlinks a final symlink,
    // but a symlink in an ancestor would make deletion cross the repository boundary.
    /** 中文说明：变量 canonicalParent 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const canonicalParent = await realpath(dirname(path))
    this.assertDescendant(canonicalRoot, join(canonicalParent, basename(path)), path)
    targets.add(path)
  }
}

/** 中文说明：变量 scriptPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  try {
    /** 中文说明：变量 removed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const removed = await new RepositoryCleaner(resolve(dirname(scriptPath), '..')).clean()
    if (removed.length === 0) {
      console.log('clean: already clean')
    } else {
      console.log(`clean: removed ${removed.length} paths`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
