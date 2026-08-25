/** Validate compiler-face isolation across workspace Project Reference graphs. */
/*
 * 文件职责：实现 project-reference-faces.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { existsSync, globSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

/** 中文说明：type ProjectFace 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type ProjectFace = 'host' | 'client'

/** 中文说明：interface ProjectReferenceConfig 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface ProjectReferenceConfig {
  readonly extends?: unknown
  readonly references?: ReadonlyArray<{ readonly path?: unknown }>
}

/** 中文说明：常量 WORKSPACE_MANIFESTS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const WORKSPACE_MANIFESTS = [
  'packages/*/*/package.json',
  'apps/*/package.json',
  'vendor/*/package.json',
] as const

/**
 * Find references that enter the wrong leaf of a split Host/Client project.
 *
 * A single-config project is neutral and may participate in either graph. Once
 * a package declares both face configs, every reachable reference must name
 * the leaf matching the aggregate from which traversal began.
 *
 * @param root - Repository root containing both aggregate tsconfigs.
 * @returns Repo-relative diagnostics for every mismatched reference edge.
 */
/* 中文说明：函数 collectProjectReferenceFaceViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectProjectReferenceFaceViolations(root: string): string[] {
  /** 中文说明：变量 splitRoots 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const splitRoots = splitProjectRoots(root)
  /** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const violations: string[] = []
  /** 中文说明：变量 pending 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const pending = [resolve(root, 'tsconfig.host.json'), resolve(root, 'tsconfig.client.json')]
  /** 中文说明：变量 visited 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const visited = new Set<string>()
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (let configPath = pending.pop(); configPath !== undefined; configPath = pending.pop()) {
    if (visited.has(configPath) || !existsSync(configPath)) continue
    visited.add(configPath)
    /** 中文说明：变量 config 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const config = projectConfig(root, configPath)
    /** 中文说明：变量 face 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const face = projectFace(root, configPath, config)
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const reference of projectReferences(config)) {
      /** 中文说明：变量 targetConfig 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const targetConfig = referenceConfigPath(configPath, reference)
      /** 中文说明：变量 splitRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const splitRoot = containingSplitRoot(splitRoots, targetConfig)
      if (splitRoot !== undefined) {
        if (face === undefined) {
          violations.push(
            `${repoPath(root, configPath)}: Project Reference ${JSON.stringify(reference)} enters split project ${repoPath(root, splitRoot)} from a config with no Host/Client face`,
          )
          continue
        }
        /** 中文说明：变量 expected 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const expected = resolve(splitRoot, `tsconfig.${face}.json`)
        if (targetConfig !== expected) {
          violations.push(
            `${repoPath(root, configPath)}: Project Reference ${JSON.stringify(reference)} enters split project ${repoPath(root, splitRoot)} from a ${faceLabel(face)} config; reference ${JSON.stringify(repoPath(root, expected))} instead`,
          )
          continue
        }
      }
      pending.push(targetConfig)
    }
  }

  return violations.sort()
}

/** 中文说明：函数 splitProjectRoots 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function splitProjectRoots(root: string): string[] {
  return globSync(WORKSPACE_MANIFESTS, { cwd: root })
    .map(manifest => resolve(root, dirname(manifest)))
    .filter(dir => existsSync(resolve(dir, 'tsconfig.host.json'))
      && existsSync(resolve(dir, 'tsconfig.client.json')))
    .sort((left, right) => right.length - left.length)
}

/** 中文说明：函数 projectConfig 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function projectConfig(root: string, configPath: string): ProjectReferenceConfig {
  /** 中文说明：函数值 read 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const read = ts.readConfigFile(configPath, path => ts.sys.readFile(path))
  if (read.error !== undefined) {
    /** 中文说明：变量 message 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const message = ts.flattenDiagnosticMessageText(read.error.messageText, '\n')
    throw new Error(`${repoPath(root, configPath)}: ${message}`)
  }
  return read.config as ProjectReferenceConfig
}

/** 中文说明：函数 projectReferences 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function projectReferences(config: ProjectReferenceConfig): string[] {
  return (config.references ?? [])
    .map(reference => reference.path)
    .filter((path): path is string => typeof path === 'string')
}

/** 中文说明：函数 projectFace 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function projectFace(
  root: string,
  configPath: string,
  config: ProjectReferenceConfig,
  seen = new Set<string>(),
): ProjectFace | undefined {
  if (basename(configPath) === 'tsconfig.host.json') return 'host'
  if (basename(configPath) === 'tsconfig.client.json') return 'client'
  if (configPath === resolve(root, 'tsconfig.base.json')) return 'host'
  if (configPath === resolve(root, 'tsconfig.base.client.json')) return 'client'
  if (seen.has(configPath)) return undefined
  seen.add(configPath)
  /** 中文说明：变量 parent 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = localExtendsConfig(configPath, config.extends)
  if (parent === undefined || !existsSync(parent)) return undefined
  return projectFace(root, parent, projectConfig(root, parent), seen)
}

/** 中文说明：函数 localExtendsConfig 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function localExtendsConfig(configPath: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('.')) return undefined
  /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const target = resolve(dirname(configPath), value)
  return target.endsWith('.json') ? target : `${target}.json`
}

/** 中文说明：函数 referenceConfigPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function referenceConfigPath(sourceConfig: string, reference: string): string {
  /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const target = resolve(dirname(sourceConfig), reference)
  return target.endsWith('.json') ? target : resolve(target, 'tsconfig.json')
}

/** 中文说明：函数 containingSplitRoot 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function containingSplitRoot(splitRoots: readonly string[], targetConfig: string): string | undefined {
  return splitRoots.find((root) => {
    /** 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = relative(root, targetConfig)
    return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
  })
}

/** 中文说明：函数 repoPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function repoPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

/** 中文说明：函数 faceLabel 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function faceLabel(face: ProjectFace): string {
  return face === 'host' ? 'Host' : 'Client'
}
