/**
 * Shared TypeScript Program construction for repository gates that need real
 * cross-file symbols and types instead of isolated syntax trees.
 */
/*
 * 文件职责：实现 ts-project.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { relative, resolve } from 'node:path'
import ts from 'typescript'

/** 中文说明：interface ProjectGraph 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface ProjectGraph {
  rootNames: string[]
  options: ts.CompilerOptions
}

/**
 * A compiler face: the two aggregates a repository-wide program may seed from.
 * The root solution is never one of them.
 */
/* 中文说明：type CompilerFace 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export type CompilerFace = 'host' | 'client'

/** TypeScript config host shared by repository scripts. */
/* 中文说明：变量 repositoryConfigHost 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const repositoryConfigHost: ts.ParseConfigFileHost = {
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  readDirectory: (...args) => ts.sys.readDirectory(...args),
  fileExists: fileName => ts.sys.fileExists(fileName),
  readFile: fileName => ts.sys.readFile(fileName),
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  onUnRecoverableConfigFileDiagnostic(diagnostic) {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  },
}

/**
 * Parse one face aggregate tsconfig and flatten all referenced projects into one
 * semantic graph. Never seed the root solution: flattening host+client into one
 * program collides the cordis Context merges.
 */
/* 中文说明：函数 loadProjectGraph 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function loadProjectGraph(projectRoot: string, face: CompilerFace): ProjectGraph {
  /** 中文说明：变量 rootConfigPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rootConfigPath = resolve(projectRoot, `tsconfig.${face}.json`)
  /** 中文说明：变量 rootConfig 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rootConfig = parseConfig(rootConfigPath)
  /** 中文说明：变量 rootNames 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rootNames = new Set<string>()
  /** 中文说明：变量 visited 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const visited = new Set<string>()

  /** 中文说明：函数值 collect 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const collect = (configPath: string, parsed: ts.ParsedCommandLine): void => {
    if (visited.has(configPath)) return
    visited.add(configPath)
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const fileName of parsed.fileNames) rootNames.add(fileName)
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const reference of parsed.projectReferences ?? []) {
      /** 中文说明：变量 referencePath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const referencePath = ts.resolveProjectReferencePath(reference)
      collect(referencePath, parseConfig(referencePath))
    }
  }
  collect(rootConfigPath, rootConfig)

  return {
    rootNames: [...rootNames],
    options: rootConfig.options,
  }
}

/** Parse one config file and fail loud on any config diagnostic. */
/* 中文说明：函数 parseConfig 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parseConfig(configPath: string): ts.ParsedCommandLine {
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, repositoryConfigHost)
  if (!parsed) throw new Error(`cannot parse TypeScript config ${configPath}`)
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }
  return parsed
}

/** Disable emit-only options after loading the root solution config. */
/* 中文说明：函数 semanticCompilerOptions 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function semanticCompilerOptions(options: ts.CompilerOptions): ts.CompilerOptions {
  return {
    ...options,
    noEmit: true,
    composite: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    incremental: false,
  }
}

/** A repository-scoped TypeScript Program and its shared TypeChecker. */
/* 中文说明：class TypeScriptProject 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export class TypeScriptProject {
  /** The bound cross-file TypeScript program. */
  readonly program: ts.Program
  /** The checker shared by every semantic query in this project. */
  readonly checker: ts.TypeChecker

  /**
   * @param projectRoot - repository root the program is seeded and reported from.
   * @param face - which compiler face aggregate to flatten.
   */
  constructor(readonly projectRoot: string, face: CompilerFace = 'host') {
    /** 中文说明：变量 graph 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const graph = loadProjectGraph(projectRoot, face)
    this.program = ts.createProgram(graph.rootNames, semanticCompilerOptions(graph.options))
    this.checker = this.program.getTypeChecker()
  }

  /**
   * Return every source file loaded into the flattened root project graph.
   * @returns program source files, including libraries and external dependencies.
   */
  sourceFiles(): readonly ts.SourceFile[] {
    return this.program.getSourceFiles()
  }

  /**
   * Render a loaded source file relative to the project root.
   * @param sourceFile - a source file from this project.
   * @returns a slash-separated repository-relative path.
   */
  relativePath(sourceFile: ts.SourceFile): string {
    return relative(this.projectRoot, sourceFile.fileName).replaceAll('\\', '/')
  }

  /**
   * Return one program source file by repository-relative path.
   * @param relativePath - path relative to the project root.
   * @returns the source file bound into this project.
   * @throws if a requested root or imported source was not loaded.
   */
  sourceFile(relativePath: string): ts.SourceFile {
    /** 中文说明：变量 sourceFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sourceFile = this.program.getSourceFile(resolve(this.projectRoot, relativePath))
    if (!sourceFile) throw new Error(`TypeScript project did not load ${relativePath}`)
    return sourceFile
  }
}
