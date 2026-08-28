/*
 * ================================ 文件注释 ================================
 * 【文件职责】工作区级（workspace-level）的类型图生成入口：发现哪些包贡献了
 *             Cordis 服务 / 事件，分析它们，再为每个包发射类型图产物，并校验
 *             每个包是否在 package.json 里正确声明了产物的导出与 files。
 * 【技术维度】封装 WorkspaceAnalyzer（发现 + 分析）与 FaceModelEmitter（按 face 发射），
 *             读 package.json 做 manifest 校验（exports 子路径 + files 白名单）。
 *             面向"face"（独立 TypeScript 编译面，如 host / client）。
 * 【产品维度】开发者跑一次 generate()，就能为整个工作区里所有参与远程通信的包
 *             生成统一的类型图产物，并自动拦截"产物没配置导出 / 没打包进 files"的包。
 * 【逻辑维度】按代码顺序：① WorkspaceEmitResult（产物 + 包根目录）；② WorkspaceTypertGenerator
 *             （构造绑定工作区根）；③ discover()（发现贡献包）；④ generate()
 *             （分析 + 逐包发射 + 校验）；⑤ validateExport()（检查 package.json 的
 *             exports 与 files）；⑥ sameExport()（比较导出对象是否一致）。
 * 【关键边界】校验是强制的：产物声明不符、Remote 产物缺失 / 多余都会抛 TypertAnalysisError。
 *             host face 额外要求 ./remote 导出与三个 remote-client 文件。
 * 【新手阅读建议】先读 generate() 的总体流程，再看 validateExport() 理解产物契约，
 *             最后对照 analyzer / emitter 看数据从哪来。
 * ==========================================================================
 */

/**
 * Workspace-level discovery and model-driven Typert generation.
 * @module @deepseek-ai/dsh-typert-generator/workspace
 */
// 中文导读：本文件是生成流水线的"调度层"：自身不分析源码、不拼装产物文本，
// 只负责编排 analyzer 与 emitter，并对结果做发布前契约校验。

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TypertAnalysisError, WorkspaceAnalyzer, WorkspaceCaches } from './analyzer.ts'
import type { DiscoveredTypertPackage } from './analyzer.ts'
import { FaceModelEmitter } from './emitter.ts'
import type { ModelEmitResult } from './emitter.ts'
import type { TypertFace } from './model.ts'

/** One emitted artifact paired with its source package root. */
// 中文：一份已发射的产物，附带它所属包的根目录（相对工作区根），供后续校验与落盘定位。
export interface WorkspaceEmitResult extends ModelEmitResult {
  readonly packageRoot: string
}

/** Behavior switches for one {@link WorkspaceTypertGenerator}. */
export interface WorkspaceTypertGeneratorOptions {
  /**
   * Run the per-package syntactic/semantic diagnostic pass before analysis
   * (default true). Pass false only when the same orchestration already
   * verified the workspace with tsc; the Typert-specific analysis checks
   * (annotation coverage, private cross-package references, unretainable
   * merges) run regardless.
   */
  readonly checkDiagnostics?: boolean
}

/** Discover, analyze, and emit package reflection from independent faces. */
// 中文：工作区级类型图生成器：负责"发现 → 分析 → 发射 → 校验"整条流水线。
// 典型用法：new WorkspaceTypertGenerator(root).generate()。
export class WorkspaceTypertGenerator {
  /** Parsed-config and program-host state shared by every analyzer this generator creates. */
  private readonly caches = new WorkspaceCaches()

  /**
   * Bind generation to one workspace root.
   * @param root - directory containing face aggregate tsconfigs.
   * @param options - behavior switches applied to every pass of this generator.
   */
  constructor(
    private readonly root: string,
    private readonly options: WorkspaceTypertGeneratorOptions = {},
  ) {}

  /**
   * Find public package faces that contribute Cordis services/events or
   * explicitly tagged Typert roots.
   * @param faces - optional independent program faces to inspect.
   * @returns discovered packages in stable package-name order.
   */
  // 中文：找出"贡献 Cordis 服务 / 事件"或"显式标记为 Typert 根"的公开包 face，
  // 返回按包名稳定排序的发现结果。faces 不传时使用工作区默认编译面。
  discover(faces?: readonly TypertFace[]): DiscoveredTypertPackage[] {
    return new WorkspaceAnalyzer({
      root: this.root,
      caches: this.caches,
      ...(faces === undefined ? {} : { faces }),
    }).discoverPackages()
  }

  /**
   * Generate all discovered contributors, or an explicit package subset.
   * @param packages - optional exact package names for a focused pass.
   * @param faces - optional independent program faces to analyze.
   * @returns one artifact per package face.
   */
  // 中文：为所有发现的贡献包生成产物；也可传 packages 限定只处理某几个包。
  // 返回每个包 face 一份产物（WorkspaceEmitResult），并逐个做 manifest 校验。
  generate(packages?: readonly string[], faces?: readonly TypertFace[]): WorkspaceEmitResult[] {
    // 中文：未显式指定包时，先 discover 得到全部候选包名。
    const selected = packages ?? this.discover(faces).map(candidate => candidate.package)
    // 中文：按选定包做一次完整分析，得到"编译面 → 包模型"的工作区模型。
    const workspace = new WorkspaceAnalyzer({
      root: this.root,
      packages: selected,
      caches: this.caches,
      ...(faces === undefined ? {} : { faces }),
      ...(this.options.checkDiagnostics === undefined ? {} : { checkDiagnostics: this.options.checkDiagnostics }),
    }).analyze()
    const artifacts: WorkspaceEmitResult[] = []
    // 中文：遍历每个编译面的每个包模型，逐一发射产物并把包根目录拼进结果。
    for (const face of workspace.faces) {
      const emitter = new FaceModelEmitter(face)
      for (const packageModel of face.packages) {
        const artifact = {
          ...emitter.emit(packageModel.name),
          packageRoot: packageModel.root,
        }
        this.validateExport(artifact)
        artifacts.push(artifact)
      }
    }
    return artifacts
  }

  // 中文：校验一份产物对应的 package.json 是否把类型图产物声明为可发布子路径：
  // exports 必须含 ./typert（host）或 ./client/typert（client）且指向 lib 下生成的文件，
  // files 白名单必须包含生成的 js / d.ts；host face 还要求 ./remote 子路径与 remote-client
  // 文件，且"发布了 Remote 产物却没有 Remote 方法"会被视为错误。
  private validateExport(artifact: WorkspaceEmitResult): void {
    // 中文：定位产物所属包的 package.json 绝对路径。
    const manifestPath = resolve(this.root, artifact.packageRoot, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports?: unknown
      files?: unknown
    }
    // 中文：按 face 决定子路径：host 产物走 ./typert，client 产物走 ./client/typert。
    const subpath = artifact.face === 'host' ? './typert' : './client/typert'
    // 中文：产物应对外暴露的 types / default 文件路径（lib 下固定命名）。
    const expected = {
      types: `./lib/typert.${artifact.face}.d.ts`,
      default: `./lib/typert.${artifact.face}.js`,
    }
    // 中文：从 manifest.exports 里取出该子路径的实际声明。
    const actual = manifest.exports !== null && typeof manifest.exports === 'object'
      ? (manifest.exports as Record<string, unknown>)[subpath]
      : undefined
    if (!sameExport(actual, expected)) {
      throw new TypertAnalysisError(
        `typert(${artifact.face}): ${artifact.package} must export ${subpath} as ${JSON.stringify(expected)}`,
      )
    }
    const files = Array.isArray(manifest.files) ? manifest.files : []
    // 中文：files 白名单必须包含生成的 js 与 d.ts，否则发布时产物会被 npm 过滤掉。
    for (const file of [`lib/typert.${artifact.face}.js`, `lib/typert.${artifact.face}.d.ts`]) {
      if (!files.includes(file)) {
        throw new TypertAnalysisError(`typert(${artifact.face}): ${artifact.package} package files must include ${file}`)
      }
    }
    // 中文：只有 host face 才有 Remote（Host-for-Client）产物，其余 face 到此为止。
    if (artifact.face !== 'host') return
    // 中文：host 的 Remote 子路径 ./remote 应指向 remote-client 的 js 与 d.ts。
    const remoteExpected = {
      types: './lib/typert.remote-client.d.ts',
      default: './lib/typert.remote-client.js',
    }
    const remoteActual = manifest.exports !== null && typeof manifest.exports === 'object'
      ? (manifest.exports as Record<string, unknown>)['./remote']
      : undefined
    // The declaration map is emitted beside these two but never published: it
    // serves editor navigation in the workspace, where the package link
    // resolves its source.
    // 中文：声明映射（d.ts.map）只写在产物旁但不发布，仅用于工作区里编辑器跳转到源码。
    const remoteFiles = [
      'lib/typert.remote-client.js',
      'lib/typert.remote-client.d.ts',
    ]
    // 中文：若 host 包没有任何 Remote 方法，却发布了 Remote 产物（导出或 files 里有文件），
    // 视为错误并抛异常，避免发布空壳 Remote 包。
    if (artifact.remote === undefined) {
      if (remoteActual !== undefined || remoteFiles.some(file => files.includes(file))) {
        throw new TypertAnalysisError(
          `typert(host): ${artifact.package} publishes Remote artifacts but has no Remote methods`,
        )
      }
      return
    }
    if (!sameExport(remoteActual, remoteExpected)) {
      throw new TypertAnalysisError(
        `typert(host): ${artifact.package} must export ./remote as ${JSON.stringify(remoteExpected)}`,
      )
    }
    for (const file of remoteFiles) {
      if (!files.includes(file)) {
        throw new TypertAnalysisError(`typert(host): ${artifact.package} package files must include ${file}`)
      }
    }
  }
}

// 中文：比较 package.json 里某个子路径的实际导出对象与期望的 { types, default } 是否一致；
// 只接受"普通对象"，null / 非对象 / 数组一律视为不一致。
function sameExport(actual: unknown, expected: { types: string; default: string }): boolean {
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false
  const value = actual as Record<string, unknown>
  return value.types === expected.types && value.default === expected.default
}
