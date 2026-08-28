/*
 * ================================ 文件注释 ================================
 * 【文件职责】typert 生成器的 tsdown（rolldown）插件面：在打包前用 TypeScript 编译器
 *             降级依赖里的标准装饰器，然后在包输出根目录发射类型图产物。
 *             没有 Typert / Remote 导出的包会被跳过。
 * 【技术维度】实现 rolldown 插件契约的两个钩子：transform（逐文件转译，只处理含
 *             @Decorator 语法且是 ts/tsx 的文件）与 writeBundle（打包完成后发射产物）；
 *             用 transpileModule 做快速单文件转译，不跑完整类型检查。
 * 【产品维度】让"构建 typert 参与方"变得零配置：打包 host 包时自动生成类型图文件
 *             并写进 lib/，无需单独跑生成命令。
 * 【逻辑维度】按代码顺序：① TypertPlugin 接口（插件契约子集）；② DECORATOR_SYNTAX
 *             正则；③ TypertPluginOptions（package / workspace 两种模式）；④ typertPlugin()
 *             主函数（transform 降级装饰器、writeBundle 按模式发射）；⑤ 辅助函数：
 *             emitWorkspace / emitArtifacts / readManifest / hasTypertExport /
 *             packageRoot / workspaceRoot。
 * 【关键边界】workspace 模式每个工作区只发射一次（emittedWorkspaces 去重）；package 模式
 *             只处理"有 typert 导出"的包；输出目录按最近的 package.json 归属判定。
 *             源映射注释会被规范化处理。
 * 【新手阅读建议】先读 typertPlugin() 里 writeBundle 的分支（package vs workspace），
 *             再看 emitArtifacts 如何落盘，最后看 workspaceRoot 如何定位工作区根。
 * ==========================================================================
 */

/**
 * Optional tsdown (rolldown) plugin face of the typert generator. It lowers
 * standard decorators in TypeScript dependencies before bundling, then emits
 * model-driven face artifacts at the package output root. Packages without a
 * Typert or Remote export are skipped.
 * @module @deepseek-ai/dsh-typert-generator/tsdown
 */
// 中文导读：本文件把"生成类型图"接进打包流水线——打包就是生成时机，无需额外命令。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { WorkspaceTypertGenerator } from './workspace.ts'
import type { WorkspaceEmitResult } from './workspace.ts'
import type { TypertFace } from './model.ts'

/** The subset of the rolldown plugin contract used here (structural; avoids a rolldown type dependency). */
// 中文：只声明本插件用到的 rolldown 插件契约子集（结构化类型，避免引入 rolldown 类型依赖）：
// name 插件名；transform 逐文件转译；writeBundle 在打包写盘后回调。
interface TypertPlugin {
  name: string
  transform: (code: string, id: string) => { code: string; map: string | undefined } | undefined
  writeBundle: (options: { dir?: string }) => void
}

// 中文：粗略识别"源码里出现装饰器语法"的正则（行首 @标识符）；用正则做快速预筛，
// 命中才值得走转译，避免对每个 ts 文件都调用 transpileModule。
const DECORATOR_SYNTAX = /^\s*@[A-Za-z_$][\w$]*/m

// This plugin consumes tsc-emitted `lib/types` output, so every project it
// would re-diagnose has already passed the workspace tsc build in the same
// orchestration; the generator skips its per-package diagnostic pass here.
const TSC_VERIFIED_INPUT = { checkDiagnostics: false } as const

/** Generation scope selected by a tsdown build phase. */
// 中文：tsdown 构建阶段选用的生成范围。
export interface TypertPluginOptions {
  /** Package mode emits only the package being bundled; workspace mode emits every explicit contributor once. */
  // 中文：package = 只发射当前打包的包；workspace = 一次性发射所有显式贡献者。
  readonly mode?: 'package' | 'workspace'
  /** Independent TypeScript program faces included in this phase. */
  // 中文：本阶段包含的独立 TypeScript 编译面（faces）。
  readonly faces?: readonly TypertFace[]
}

/**
 * Create the decorator-lowering and typert-generation plugin for the root tsdown config.
 * @param pluginOptions - package/workspace emission mode and independent program faces.
 * @returns a rolldown-compatible plugin that lowers source decorators and emits local and Host-for-Client artifacts.
 */
// 中文：创建"装饰器降级 + typert 生成"插件，供根 tsdown 配置注册。
// 返回的插件同时负责：转译含装饰器的依赖源码，以及按模式发射本地 / Host-for-Client 产物。
export function typertPlugin(pluginOptions: TypertPluginOptions = {}): TypertPlugin {
  // 中文：按工作区根缓存"已生成的产物"，避免同一工作区在多次 writeBundle 里重复生成。
  const artifactsByRoot = new Map<string, readonly WorkspaceEmitResult[]>()
  // 中文：记录哪些工作区已按 workspace 模式发射过，保证每个工作区只发射一次。
  const emittedWorkspaces = new Set<string>()
  return {
    name: 'dsh-typert-generator',
    transform(code, id) {
      // 中文：去掉查询串（如 ?raw）得到真实文件路径；只处理 ts/tsx 且疑似含装饰器的文件。
      const file = id.split('?', 1)[0] ?? id
      if (!/\.[cm]?tsx?$/.test(file) || !DECORATOR_SYNTAX.test(code)) return
      // 中文：单文件快速转译：目标 ES2024、ESM 模块、tsx 文件追加 JSX 配置、输出源映射。
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          ...(file.endsWith('x') ? { jsx: ts.JsxEmit.ReactJSX } : {}),
          sourceMap: true,
        },
      })
      return {
        // 中文：去掉转译输出末尾的 sourceMappingURL 行（源映射以独立 map 字段携带），
        // 并统一以单个换行结尾。
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
    writeBundle(bundleOptions) {
      // options.dir is the package's absolute outDir (<package>/lib); its
      // nearest package.json owns the bundle even when a custom config writes
      // a nested output such as <package>/lib/dev.
      // 中文：bundleOptions.dir 是包的绝对输出目录（<package>/lib）；即使自定义配置写到
      // 嵌套目录（如 <package>/lib/dev），最近的 package.json 仍认定它属于这个包。
      if (bundleOptions.dir === undefined) return
      const root = workspaceRoot(bundleOptions.dir)
      if (emittedWorkspaces.has(root)) return
      if (pluginOptions.mode === 'workspace') {
        emitWorkspace(root, pluginOptions.faces)
        emittedWorkspaces.add(root)
        return
      }
      // 中文：package 模式：先定位输出目录所属的包根（向上找最近的 package.json）。
      const packageDir = packageRoot(bundleOptions.dir, root)
      if (packageDir === undefined) return
      const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
        name?: string
        exports?: unknown
      }
      // 中文：包没有名字或没有任何 typert 相关导出（./typert / ./client/typert / ./remote）
      // 时直接跳过，不生成任何产物。
      if (manifest.name === undefined || !hasTypertExport(manifest.exports)) return
      let artifacts = artifactsByRoot.get(root)
      if (artifacts === undefined) {
        const generator = new WorkspaceTypertGenerator(root, TSC_VERIFIED_INPUT)
        artifacts = pluginOptions.faces === undefined
          ? generator.generate()
          : generator.generate(undefined, pluginOptions.faces)
        artifactsByRoot.set(root, artifacts)
      }
      // 中文：从全部产物里挑出属于当前打包包的那份并落盘。
      emitArtifacts(packageDir, artifacts.filter(candidate => candidate.package === manifest.name))
    },
  }

  // 中文：workspace 模式发射：发现所有"有 typert 导出"的包，为每个包生成并落盘产物。
  function emitWorkspace(root: string, faces: readonly TypertFace[] | undefined): void {
    const generator = new WorkspaceTypertGenerator(root, TSC_VERIFIED_INPUT)
    const packages = generator.discover(faces)
      .filter(candidate => hasTypertExport(readManifest(join(root, candidate.root)).exports))
      .map(candidate => candidate.package)
    if (packages.length === 0) return
    for (const artifact of generator.generate(packages, faces)) {
      emitArtifacts(join(root, artifact.packageRoot), [artifact])
    }
  }
}

// 中文：把产物写到 <package>/lib 下：固定命名 typert.<face>.js / .d.ts；
// 若含 Remote 产物再写 remote-client 三件套（js / d.ts / d.ts.map）。
function emitArtifacts(packageDir: string, artifacts: readonly WorkspaceEmitResult[]): void {
  const output = join(packageDir, 'lib')
  mkdirSync(output, { recursive: true })
  let emittedRemote = false
  for (const artifact of artifacts) {
    writeFileSync(join(output, `typert.${artifact.face}.js`), artifact.js)
    writeFileSync(join(output, `typert.${artifact.face}.d.ts`), artifact.dts)
    if (artifact.remote !== undefined) {
      emittedRemote = true
      writeFileSync(join(output, 'typert.remote-client.js'), artifact.remote.js)
      writeFileSync(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
      writeFileSync(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
    }
  }
  // 中文：本次没有任何 Remote 产物，但至少有一个 host 面产物——说明该包的 Remote 已被
  // 移除或从未生成，删除可能残留的旧 remote-client 文件，避免发布陈旧产物。
  if (!emittedRemote && artifacts.some(artifact => artifact.face === 'host')) {
    for (const file of [
      'typert.remote-client.js',
      'typert.remote-client.d.ts',
      'typert.remote-client.d.ts.map',
    ]) rmSync(join(output, file), { force: true })
  }
}

// 中文：读取某包根的 package.json，只取生成逻辑关心的 name 与 exports 字段。
function readManifest(packageDir: string): { name?: string; exports?: unknown } {
  return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
    name?: string
    exports?: unknown
  }
}

// 中文：判断 package.json 的 exports 字段是否声明了任何 typert 产物子路径；
// 三者任一命中即说明该包参与了 typert 生成。
function hasTypertExport(exportsField: unknown): boolean {
  if (exportsField === null || typeof exportsField !== 'object' || Array.isArray(exportsField)) return false
  return Object.hasOwn(exportsField, './typert')
    || Object.hasOwn(exportsField, './client/typert')
    || Object.hasOwn(exportsField, './remote')
}

// 中文：从输出目录向上逐级查找最近的 package.json，返回包根目录；
// 一直找到工作区根仍未命中则返回 undefined（说明该输出不属于任何包）。
function packageRoot(start: string, workspace: string): string | undefined {
  let current = resolve(start)
  while (current !== workspace) {
    if (existsSync(join(current, 'package.json'))) return current
    current = dirname(current)
  }
  return undefined
}

// 中文：从输出目录向上查找工作区根：以存在 tsconfig.host.json 为标志；
// 找不到（到达文件系统根）则抛错，避免在错误目录里乱生成。
function workspaceRoot(start: string): string {
  let current = resolve(start)
  while (!existsSync(join(current, 'tsconfig.host.json'))) {
    const parent = dirname(current)
    if (parent === current) throw new Error(`typert-generator: cannot find workspace root above ${start}`)
    current = parent
  }
  return current
}
