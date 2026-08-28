/**
 * Resolve the public SDK launch configuration to one dsh subprocess.
 * @module @deepseek-ai/dsh-sdk-client/launch
 * @remarks 文件说明：文件职责：实现 sdk/client 中 launch 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 sdk/client 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HarnessClientOptions } from './types.ts'

/** Default bound for a profile to answer the SDK initialize handshake.
 * @remarks 中文说明：常量说明：DEFAULT_INITIALIZE_TIMEOUT_MS 用于处理
 * DEFAULT_INITIALIZE_TIMEOUT_MS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const DEFAULT_INITIALIZE_TIMEOUT_MS = 10_000

/** Internal generic process launch used by the transport and fake-runtime tests. */
export interface RuntimeProcessOptions {
  command: string
  args: string[]
  cwd?: string
  /** Materialize the complete child environment when the client starts its subprocess. */
  environment: () => NodeJS.ProcessEnv
  description: string
  initializeTimeoutMs: number
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  disposeEofGraceMs?: number
  disposeGraceMs?: number
}

/** Node argv plus internal profile patches required by one resolved dsh entry. */
export interface DshNodeLaunch {
  /** Arguments before the profile selector. */
  nodeArgs: string[]
  /** Internal patches applied below caller-supplied patches. */
  patches: string[]
  /** Environment values required by the resolved entry mode. */
  environment: NodeJS.ProcessEnv
}

interface PackageManifest {
  version?: unknown
  bin?: unknown
}

/** Read a package manifest from one resolved package.json URL.
 * @remarks 中文说明：功能说明：处理 manifest 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：url（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：PackageManifest；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 manifest(url)，并按返回类型处理结果。 */
function manifest(url: string): PackageManifest {
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as PackageManifest
}

/**
 * Resolve and version-check a dsh executable from package manifests.
 * @param dshManifestUrl - resolved URL of the dsh package manifest.
 * @param clientManifestUrl - resolved URL of the SDK client manifest.
 * @returns the absolute dsh executable path.
 * @remarks 中文说明：功能说明：解析 Dsh Bin From Manifests 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：dshManifestUrl（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：clientManifestUrl（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * resolveDshBinFromManifests(dshManifestUrl, clientManifestUrl)，并按返回类型处理结果。
 */
export function resolveDshBinFromManifests(dshManifestUrl: string, clientManifestUrl: string): string {
  /**
   * 常量说明：dshManifest 用于处理 dshManifest 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const dshManifest = manifest(dshManifestUrl)
  /**
   * 常量说明：clientManifest 用于处理 clientManifest 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const clientManifest = manifest(clientManifestUrl)
  if (typeof dshManifest.version !== 'string' || dshManifest.version !== clientManifest.version) {
    throw new Error(`dsh SDK client ${String(clientManifest.version)} requires the same dsh version, got ${String(dshManifest.version)}`)
  }
  /**
   * 常量说明：bin 用于处理 bin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bin = typeof dshManifest.bin === 'object' && dshManifest.bin !== null
    ? (dshManifest.bin as Record<string, unknown>).dsh
    : dshManifest.bin
  if (typeof bin !== 'string' || bin === '') throw new Error('@deepseek-ai/dsh declares no dsh executable')
  return resolve(dirname(fileURLToPath(dshManifestUrl)), bin)
}

/**
 * Resolve and version-check the built dsh executable installed with this SDK.
 * @returns the absolute built executable path, whether or not it exists in a source checkout.
 * @remarks 中文说明：功能说明：处理 installedDshBin 相关流程；使用场景由所在模块及调用位置决定。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 installedDshBin()，
 * 并按返回类型处理结果。
 */
export function installedDshBin(): string {
  return resolveDshBinFromManifests(
    import.meta.resolve('@deepseek-ai/dsh/package.json'),
    new URL('../package.json', import.meta.url).href,
  )
}

/**
 * Resolve the Node launch for one same-version dsh package.
 * @param dshManifestUrl - resolved URL of the dsh package manifest.
 * @param clientManifestUrl - resolved URL of the SDK client manifest.
 * @param sourceLoaderUrl - optional absolute tsx loader URL for deterministic tests.
 * @returns built output, or the source entry plus its compatibility patch and tsx environment.
 * @remarks 中文说明：功能说明：解析 Dsh Node Launch From Manifests 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：dshManifestUrl（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：clientManifestUrl（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：sourceLoaderUrl（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：DshNodeLaunch；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 resolveDshNodeLaunchFromManifests(dshManifestUrl,
 * clientManifestUrl, sourceLoaderUrl)，并按返回类型处理结果。
 */
export function resolveDshNodeLaunchFromManifests(
  dshManifestUrl: string,
  clientManifestUrl: string,
  sourceLoaderUrl?: string,
): DshNodeLaunch {
  /**
   * 常量说明：bin 用于处理 bin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bin = resolveDshBinFromManifests(dshManifestUrl, clientManifestUrl)
  if (existsSync(bin)) return { nodeArgs: [bin], patches: [], environment: {} }

  /**
   * 常量说明：packageDir 用于处理 packageDir 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const packageDir = dirname(fileURLToPath(dshManifestUrl))
  /**
   * 常量说明：sourceBin 用于处理 sourceBin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sourceBin = resolve(packageDir, 'src/bin.ts')
  /**
   * 常量说明：sourcePatch 用于处理 sourcePatch 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const sourcePatch = resolve(packageDir, 'src/sdk-source.cordis.patch.yml')
  /**
   * 常量说明：sourceTsconfig 用于处理 sourceTsconfig 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const sourceTsconfig = resolve(packageDir, 'tsconfig.json')
  if (!existsSync(sourceBin) || !existsSync(sourcePatch) || !existsSync(sourceTsconfig)) {
    throw new Error(
      `@deepseek-ai/dsh is missing its built executable ${bin} and complete source launch files ${sourceBin}, ${sourcePatch}, ${sourceTsconfig}`,
    )
  }
  /**
   * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const loader = sourceLoaderUrl ?? import.meta.resolve('tsx/esm')
  return {
    nodeArgs: ['--import', loader, sourceBin],
    patches: [sourcePatch],
    environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
  }
}

/**
 * Resolve the installed dsh package to a built or source Node launch.
 * @returns the launch descriptor for the current checkout or installed package.
 * @remarks 中文说明：功能说明：处理 installedDshNodeLaunch 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：DshNodeLaunch；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * installedDshNodeLaunch()，并按返回类型处理结果。
 */
function installedDshNodeLaunch(): DshNodeLaunch {
  return resolveDshNodeLaunchFromManifests(
    import.meta.resolve('@deepseek-ai/dsh/package.json'),
    new URL('../package.json', import.meta.url).href,
  )
}

/**
 * Resolve caller-relative filesystem inputs and construct canonical dsh argv.
 * @param options - public SDK launch options.
 * @param callerCwd - parent-process directory used for lexical resolution.
 * @returns one generic subprocess spec for the JSON-RPC transport.
 * @remarks 中文说明：功能说明：解析 Dsh Launch 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（HarnessClientOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 参数说明：callerCwd（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：RuntimeProcessOptions；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * resolveDshLaunch(options, callerCwd)，并按返回类型处理结果。
 */
export function resolveDshLaunch(
  options: HarnessClientOptions = {},
  callerCwd: string = process.cwd(),
): RuntimeProcessOptions {
  /**
   * 常量说明：profile 用于处理 profile 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const profile = options.profile ?? 'sdk'
  /**
   * 常量说明：dshLaunch 用于处理 dshLaunch 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const dshLaunch = options.dshBin === undefined
    ? installedDshNodeLaunch()
    : { nodeArgs: [resolve(callerCwd, options.dshBin)], patches: [], environment: {} }
  /**
   * 常量说明：patches 用于处理 patches 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，
   * 并按返回类型处理结果。
   */
  const patches = [
    ...dshLaunch.patches,
    ...(options.patches ?? []).map(path => resolve(callerCwd, path)),
  ]
  /**
   * 常量说明：dshHome 用于处理 dshHome 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const dshHome = options.dshHome === undefined ? undefined : resolve(callerCwd, options.dshHome)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，
   * 并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return {
    command: process.execPath,
    args: [...dshLaunch.nodeArgs, '--profile', profile, ...patches.flatMap(path => ['--patch', path])],
    ...options.processCwd === undefined ? {} : { cwd: resolve(callerCwd, options.processCwd) },
    environment: () => ({
      ...(options.env ?? process.env),
      ...dshLaunch.environment,
      ...dshHome === undefined ? {} : { DSH_HOME: dshHome },
    }),
    description: `dsh profile ${JSON.stringify(profile)}`,
    initializeTimeoutMs: options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS,
    ...options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs },
    ...options.shutdownTimeoutMs === undefined ? {} : { shutdownTimeoutMs: options.shutdownTimeoutMs },
    ...options.disposeEofGraceMs === undefined ? {} : { disposeEofGraceMs: options.disposeEofGraceMs },
    ...options.disposeGraceMs === undefined ? {} : { disposeGraceMs: options.disposeGraceMs },
  }
}
