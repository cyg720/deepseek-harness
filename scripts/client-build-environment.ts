/**
 * 文件职责：实现 client-build-environment.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Prefix reserved for build-time values that may be embedded in browser artifacts. */
/* 中文说明：常量 CLIENT_BUILD_ENV_PREFIX 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLIENT_BUILD_ENV_PREFIX = 'DSH_CLIENT_'

/** Non-public selector used by build orchestration to request a named client profile. */
/* 中文说明：常量 CLIENT_BUILD_PROFILE_SELECTOR 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const CLIENT_BUILD_PROFILE_SELECTOR = 'DSH_BUILD_CLIENT_PROFILE'

/** Public client environment required by official DSH artifacts. */
/* 中文说明：常量 OFFICIAL_CLIENT_BUILD_ENVIRONMENT 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OFFICIAL_CLIENT_BUILD_ENVIRONMENT = {
  DSH_CLIENT_BUILD_PROFILE: 'official',
  DSH_CLIENT_TITLE: 'DeepSeek Harness',
} as const

/** Public variable carrying the source commit embedded in client artifacts. */
/* 中文说明：常量 CLIENT_COMMIT_HASH_VARIABLE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLIENT_COMMIT_HASH_VARIABLE = 'DSH_CLIENT_COMMIT_HASH'

/** Repository-relative path of the complete client build record. */
/* 中文说明：常量 CLIENT_BUILD_RECORD_PATH 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const CLIENT_BUILD_RECORD_PATH = '.dsh-build/client-build-environment.json'

/** 中文说明：常量 CLIENT_BUILD_RECORD_FORMAT 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLIENT_BUILD_RECORD_FORMAT = 1
/** 中文说明：常量 CLIENT_ARTIFACT_PATTERNS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLIENT_ARTIFACT_PATTERNS = [
  'apps/web/dist/**/*',
  'packages/*/*/lib/client.js',
  'packages/*/*/lib/client.js.map',
] as const

/** Public values embedded in one set of client artifacts. */
/* 中文说明：type ClientBuildEnvironment 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
export type ClientBuildEnvironment = Readonly<Record<string, string>>

/**
 * Resolve the short source commit used by browser build metadata.
 * @param root - repository root used when no explicit value is supplied.
 * @param environment - environment that may already carry a commit value.
 * @returns lowercase 7-character Git commit prefix.
 */
/* 中文说明：函数 repositoryCommitHash 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function repositoryCommitHash(root: string, environment: NodeJS.ProcessEnv = process.env): string {
  /** 中文说明：变量 explicit 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const explicit = environment[CLIENT_COMMIT_HASH_VARIABLE]
  /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value = explicit ?? execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (!/^[0-9a-f]{7,40}$/iu.test(value)) {
    throw new Error(`${CLIENT_COMMIT_HASH_VARIABLE} must be a Git commit hash; got ${JSON.stringify(value)}`)
  }
  return value.slice(0, 7).toLowerCase()
}

/**
 * Resolve the exact public values required by an official build at one commit.
 * @param root - repository root whose HEAD must match the built source.
 * @param environment - optional explicit commit source for non-Git build environments.
 * @returns complete official client environment.
 */
/* 中文说明：函数 officialClientBuildEnvironment 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function officialClientBuildEnvironment(
  root: string,
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<Record<`DSH_CLIENT_${string}`, string>> {
  return {
    DSH_CLIENT_COMMIT_HASH: repositoryCommitHash(root, environment),
    ...OFFICIAL_CLIENT_BUILD_ENVIRONMENT,
  }
}

/** Digest of every client artifact produced by the complete root build. */
/* 中文说明：interface ClientArtifactDigest 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
interface ClientArtifactDigest {
  /** Number of files covered by the digest. */
  readonly fileCount: number
  /** Lowercase SHA-256 digest of sorted paths and file contents. */
  readonly sha256: string
}

/** Durable description of one complete root client build. */
/* 中文说明：interface ClientBuildRecord 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
export interface ClientBuildRecord {
  /** Record schema version. */
  readonly formatVersion: number
  /** Exact public environment embedded by Vite and tsdown. */
  readonly environment: ClientBuildEnvironment
  /** Digest that binds the environment to the current artifacts. */
  readonly artifacts: ClientArtifactDigest
}

/**
 * Collect the public client environment in deterministic key order.
 * @param environment - environment inherited by the build process.
 * @returns defined `DSH_CLIENT_*` values only.
 */
/* 中文说明：函数 clientBuildEnvironment 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function clientBuildEnvironment(environment: NodeJS.ProcessEnv): ClientBuildEnvironment {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name, value]) => name.startsWith(CLIENT_BUILD_ENV_PREFIX) && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))) as Record<string, string>
}

/**
 * Resolve the exact public environment selected for a complete client build.
 * @param environment - parent process environment.
 * @param profile - explicit profile, or the non-public selector when omitted.
 * @returns the inherited public values when no profile is selected, otherwise the named profile.
 */
/* 中文说明：函数 resolveClientBuildEnvironment 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function resolveClientBuildEnvironment(
  environment: NodeJS.ProcessEnv,
  profile: string | undefined = environment[CLIENT_BUILD_PROFILE_SELECTOR],
): ClientBuildEnvironment {
  if (profile === undefined) return clientBuildEnvironment(environment)
  if (profile === 'official') {
    /** 中文说明：变量 commitHash 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commitHash = environment[CLIENT_COMMIT_HASH_VARIABLE]
    if (commitHash === undefined) {
      throw new Error(`${CLIENT_COMMIT_HASH_VARIABLE} is required for the official client build profile`)
    }
    return { DSH_CLIENT_COMMIT_HASH: commitHash, ...OFFICIAL_CLIENT_BUILD_ENVIRONMENT }
  }
  throw new Error(`unknown client build profile ${JSON.stringify(profile)}; expected "official"`)
}

/**
 * Construct a subprocess environment containing exactly the selected public values.
 * @param environment - parent process environment.
 * @param clientEnvironment - complete public environment selected for the build.
 * @returns the parent environment with selectors and inherited public values replaced.
 */
/* 中文说明：函数 clientBuildProcessEnvironment 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function clientBuildProcessEnvironment(
  environment: NodeJS.ProcessEnv,
  clientEnvironment: ClientBuildEnvironment,
): NodeJS.ProcessEnv {
  /** 中文说明：变量 child 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const child: NodeJS.ProcessEnv = {}
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const [name, value] of Object.entries(environment)) {
    if (name === CLIENT_BUILD_PROFILE_SELECTOR || name.startsWith(CLIENT_BUILD_ENV_PREFIX)) continue
    child[name] = value
  }
  return { ...child, ...clientEnvironment }
}

/**
 * Require the public client environment to match an artifact profile exactly.
 *
 * An exact key set matters because every prefixed value is eligible for
 * inlining: an unexpected variable can change published bytes just as surely
 * as a missing or incorrect required value.
 *
 * @param environment - public environment from a build process or build record.
 * @param expected - complete public client environment for the artifact profile.
 */
/* 中文说明：函数 assertClientBuildEnvironment 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function assertClientBuildEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  expected: Readonly<Record<`DSH_CLIENT_${string}`, string>>,
): void {
  /** 中文说明：变量 actual 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const actual = Object.fromEntries(Object.entries(environment)
    .filter(([name, value]) => name.startsWith(CLIENT_BUILD_ENV_PREFIX) && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)))
  /** 中文说明：变量 normalizedExpected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normalizedExpected = Object.fromEntries(Object.entries(expected)
    .sort(([left], [right]) => left.localeCompare(right)))
  if (JSON.stringify(actual) === JSON.stringify(normalizedExpected)) return

  /** 中文说明：变量 names 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const names = [...new Set([...Object.keys(actual), ...Object.keys(normalizedExpected)])].sort()
  /** 中文说明：函数值 differences 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const differences = names.filter(name => actual[name] !== normalizedExpected[name])
  throw new Error(`client build environment differs from the required artifact profile: ${differences.join(', ')}`)
}

/**
 * Create bundler substitutions for public client build environment variables.
 *
 * The empty `process.env` fallback makes an unset static property read
 * evaluate to `undefined` without providing a browser `process` global.
 * Exact substitutions remain longer matches than that fallback. Dynamic
 * property reads and enumeration deliberately observe the empty object.
 *
 * @param environment - environment inherited by the build process.
 * @returns deterministic Vite/tsdown `define` expressions.
 */
/* 中文说明：函数 clientBuildEnvironmentDefines 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function clientBuildEnvironmentDefines(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  /** 中文说明：变量 defines 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const defines: Record<string, string> = { 'process.env': '{}' }
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const [name, value] of Object.entries(clientBuildEnvironment(environment))) {
    defines[`process.env.${name}`] = JSON.stringify(value)
  }
  return defines
}

/**
 * Write the build record after a complete root build succeeds.
 * @param root - repository root containing the generated artifacts.
 * @param environment - exact public environment supplied to both bundlers.
 * @returns the record written to disk.
 */
/* 中文说明：函数 writeClientBuildRecord 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function writeClientBuildRecord(
  root: string,
  environment: ClientBuildEnvironment,
): ClientBuildRecord {
  /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const record: ClientBuildRecord = {
    formatVersion: CLIENT_BUILD_RECORD_FORMAT,
    environment: clientBuildEnvironment(environment),
    artifacts: clientArtifactDigest(root),
  }
  /** 中文说明：变量 path 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const path = resolve(root, CLIENT_BUILD_RECORD_PATH)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
  return record
}

/**
 * Read a complete build record and prove it still describes the current artifacts.
 * @param root - repository root containing the record and generated artifacts.
 * @param expected - optional exact public environment required by a consumer.
 * @returns the parsed and artifact-verified record.
 */
/* 中文说明：函数 readClientBuildRecord 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function readClientBuildRecord(
  root: string,
  expected?: Readonly<Record<`DSH_CLIENT_${string}`, string>>,
): ClientBuildRecord {
  /** 中文说明：变量 path 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const path = resolve(root, CLIENT_BUILD_RECORD_PATH)
  if (!existsSync(path)) {
    throw new Error(`client build record ${CLIENT_BUILD_RECORD_PATH} is missing; run a complete pnpm run build first`)
  }

  /** 中文说明：变量 parsed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    /** 中文说明：变量 detail 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`client build record ${CLIENT_BUILD_RECORD_PATH} is invalid JSON: ${detail}`)
  }
  /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const record = parseClientBuildRecord(parsed)
  if (expected !== undefined) assertClientBuildEnvironment(record.environment, expected)

  /** 中文说明：变量 current 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const current = clientArtifactDigest(root)
  if (current.fileCount !== record.artifacts.fileCount || current.sha256 !== record.artifacts.sha256) {
    throw new Error(
      `client artifacts differ from ${CLIENT_BUILD_RECORD_PATH}; run a complete pnpm run build before consuming them`,
    )
  }
  return record
}

/** Return the deterministic digest of every artifact affected by the public client environment. */
/* 中文说明：函数 clientArtifactDigest 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function clientArtifactDigest(root: string): ClientArtifactDigest {
  /** 中文说明：变量 paths 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const paths = globSync([...CLIENT_ARTIFACT_PATTERNS], { cwd: root })
    .map(path => path.replaceAll('\\', '/'))
    .filter(path => statSync(resolve(root, path)).isFile())
    .sort()
  if (paths.length === 0) throw new Error('complete client build produced no Vite or dynamic client artifacts')

  /** 中文说明：变量 digest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const digest = createHash('sha256')
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const path of paths) {
    /** 中文说明：变量 content 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const content = readFileSync(resolve(root, path))
    digest.update(`${Buffer.byteLength(path)}:`)
    digest.update(path)
    digest.update(`${content.byteLength}:`)
    digest.update(content)
  }
  return { fileCount: paths.length, sha256: digest.digest('hex') }
}

/** Parse and validate the persisted record before any consumer trusts it. */
/* 中文说明：函数 parseClientBuildRecord 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function parseClientBuildRecord(value: unknown): ClientBuildRecord {
  if (!isObject(value) || !hasExactKeys(value, ['artifacts', 'environment', 'formatVersion'])) {
    throw new Error(`client build record ${CLIENT_BUILD_RECORD_PATH} has an invalid top-level schema`)
  }
  if (value.formatVersion !== CLIENT_BUILD_RECORD_FORMAT) {
    throw new Error(
      `client build record ${CLIENT_BUILD_RECORD_PATH} uses format ${String(value.formatVersion)}; expected ${String(CLIENT_BUILD_RECORD_FORMAT)}`,
    )
  }
  if (!isObject(value.environment)) {
    throw new Error(`client build record ${CLIENT_BUILD_RECORD_PATH} has an invalid environment`)
  }
  /** 中文说明：变量 environment 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const environment: Record<string, string> = {}
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const [name, entry] of Object.entries(value.environment).sort(([left], [right]) => left.localeCompare(right))) {
    if (!name.startsWith(CLIENT_BUILD_ENV_PREFIX) || typeof entry !== 'string') {
      throw new Error(`client build record ${CLIENT_BUILD_RECORD_PATH} has an invalid environment entry ${name}`)
    }
    environment[name] = entry
  }
  if (!isObject(value.artifacts) || !hasExactKeys(value.artifacts, ['fileCount', 'sha256'])) {
    throw new Error(`client build record ${CLIENT_BUILD_RECORD_PATH} has an invalid artifact digest`)
  }
  if (!Number.isSafeInteger(value.artifacts.fileCount) || Number(value.artifacts.fileCount) < 1) {
    throw new Error(`client build record ${CLIENT_BUILD_RECORD_PATH} has an invalid artifact count`)
  }
  if (typeof value.artifacts.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.artifacts.sha256)) {
    throw new Error(`client build record ${CLIENT_BUILD_RECORD_PATH} has an invalid SHA-256 digest`)
  }
  return {
    formatVersion: CLIENT_BUILD_RECORD_FORMAT,
    environment,
    artifacts: {
      fileCount: Number(value.artifacts.fileCount),
      sha256: value.artifacts.sha256,
    },
  }
}

/** 中文说明：函数 isObject 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 中文说明：函数 hasExactKeys 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  /** 中文说明：变量 actual 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
