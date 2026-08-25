#!/usr/bin/env node
/**
 * 文件职责：实现 install-lefthook.mjs 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import lefthookPackage from 'lefthook/package.json' with { type: 'json' }

/** 中文说明：常量 MINIMUM_GIT 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MINIMUM_GIT = [2, 26, 0]
/** 中文说明：常量 HOOKS_DIRECTORY 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const HOOKS_DIRECTORY = 'dsh-hooks'
/** 中文说明：常量 OWNERSHIP_MARKER 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OWNERSHIP_MARKER = '.dsh-lefthook-owned'
/** 中文说明：常量 OWNERSHIP_MARKER_VERSION 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OWNERSHIP_MARKER_VERSION = 1
/** 中文说明：常量 OWNERSHIP_MARKER_OWNER 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OWNERSHIP_MARKER_OWNER = 'deepseek-harness worktree-local lefthook hooks'
/** 中文说明：常量 INSTALL_LOCK 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const INSTALL_LOCK = 'dsh-lefthook-install.lock'
/** 中文说明：常量 INSTALL_LOCK_TIMEOUT_MS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const INSTALL_LOCK_TIMEOUT_MS = 30_000
/** 中文说明：常量 INSTALL_LOCK_INITIALIZATION_TIMEOUT_MS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const INSTALL_LOCK_INITIALIZATION_TIMEOUT_MS = 5_000
/** 中文说明：常量 INSTALL_LOCK_POLL_MS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const INSTALL_LOCK_POLL_MS = 50
/** 中文说明：常量 ALLOW_HOOKS_PATH_OVERRIDE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ALLOW_HOOKS_PATH_OVERRIDE = 'DSH_LEFTHOOK_ALLOW_HOOKS_PATH_OVERRIDE'
/** 中文说明：常量 REPOSITORY_EXTENSION_PATTERN 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const REPOSITORY_EXTENSION_PATTERN = '^extensions\\.'
/** 中文说明：常量 PAIRING_MERGE_DRIVER_CONFIG 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PAIRING_MERGE_DRIVER_CONFIG = [
  ['merge.dsh-translation-pairing.name', 'DeepSeek Harness bilingual pairing records'],
  [
    'merge.dsh-translation-pairing.driver',
    'scripts/merge-translation-pairing-driver.sh %O %A %B %P',
  ],
]
/** 中文说明：常量 PAIRING_MERGE_DRIVER_PROBE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PAIRING_MERGE_DRIVER_PROBE = [
  '--import',
  'tsx/esm',
  'scripts/merge-translation-pairing.ts',
  '--probe',
]

/** 中文说明：函数 errorCode 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function errorCode(error) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined
}

/** 中文说明：函数 commandFailure 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function commandFailure(command, args, result) {
  /** 中文说明：变量 stderr 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
  /** 中文说明：变量 detail 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const detail = result.error?.message ?? (stderr || `exit status ${String(result.status)}`)
  return new Error(`${command} ${args.join(' ')} failed: ${detail}`)
}

/** 中文说明：函数 capture 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function capture(command, args, options = {}) {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.status !== 0 && !options.allowStatuses?.includes(result.status)) {
    throw commandFailure(command, args, result)
  }
  return result
}

/** 中文说明：函数 git 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function git(args, root, options = {}) {
  return capture('git', args, { ...options, cwd: root })
}

/** 中文说明：函数 nulValues 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function nulValues(result) {
  if (result.status !== 0) return []
  if (result.stdout === '') return ['']
  /** 中文说明：变量 output 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const output = result.stdout.endsWith('\0') ? result.stdout.slice(0, -1) : result.stdout
  return output.split('\0')
}

/** 中文说明：函数 stripGitLineTerminator 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function stripGitLineTerminator(output) {
  /** 中文说明：变量 withoutLineFeed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const withoutLineFeed = output.endsWith('\n') ? output.slice(0, -1) : output
  return process.platform === 'win32' && withoutLineFeed.endsWith('\r')
    ? withoutLineFeed.slice(0, -1)
    : withoutLineFeed
}

/** 中文说明：函数 directFileConfigValues 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function directFileConfigValues(root, configPath, key) {
  return nulValues(git(
    ['config', '--file', configPath, '--no-includes', '--null', '--get-all', key],
    root,
    { allowStatuses: [1] },
  ))
}

/** 中文说明：函数 parseFileConfigEntries 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parseFileConfigEntries(fields, key) {
  if (fields.length % 2 !== 0) {
    throw new Error(`git config returned invalid file entries for ${key}`)
  }
  /** 中文说明：变量 entries 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries = []
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < fields.length; index += 2) {
    entries.push({ origin: fields[index], value: fields[index + 1] })
  }
  return entries
}

/** 中文说明：函数 includedFileConfigEntries 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function includedFileConfigEntries(root, configPath, key) {
  /** 中文说明：变量 fields 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fields = nulValues(git(
    ['config', '--file', configPath, '--includes', '--null', '--show-origin', '--get-all', key],
    root,
    { allowStatuses: [1] },
  ))
  return parseFileConfigEntries(fields, key)
}

/** 中文说明：函数 splitConfigNameValue 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function splitConfigNameValue(field, pattern) {
  /** 中文说明：变量 separator 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const separator = field.indexOf('\n')
  if (separator < 0) throw new Error(`git config returned an invalid name and value for ${pattern}`)
  return { name: field.slice(0, separator), value: field.slice(separator + 1) }
}

/** 中文说明：函数 directFileConfigMatchingEntries 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function directFileConfigMatchingEntries(root, configPath, pattern) {
  /** 中文说明：变量 fields 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fields = nulValues(git(
    ['config', '--file', configPath, '--no-includes', '--null', '--show-origin', '--get-regexp', pattern],
    root,
    { allowStatuses: [1] },
  ))
  if (fields.length % 2 !== 0) {
    throw new Error(`git config returned invalid matching file entries for ${pattern}`)
  }
  /** 中文说明：变量 entries 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries = []
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < fields.length; index += 2) {
    entries.push({ origin: fields[index], ...splitConfigNameValue(fields[index + 1], pattern) })
  }
  return entries
}

/** 中文说明：函数 effectiveConfigEntry 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function effectiveConfigEntry(root, key) {
  /** 中文说明：变量 fields 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fields = nulValues(git(
    ['config', '--null', '--show-scope', '--show-origin', '--get', key],
    root,
    { allowStatuses: [1] },
  ))
  if (fields.length === 0) return undefined
  if (fields.length !== 3) {
    throw new Error(`git config returned an invalid scoped value for ${key}`)
  }
  const [scope, origin, value] = fields
  return { origin, scope, value }
}

/** 中文说明：函数 parseGitBoolean 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parseGitBoolean(value, key) {
  /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normalized = value.toLowerCase()
  if (normalized === '' || normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === '1') return true
  if (normalized === 'false' || normalized === 'no' || normalized === 'off' || normalized === '0') return false
  throw new Error(`invalid Boolean value for ${key}: ${JSON.stringify(value)}`)
}

/** 中文说明：函数 assertSingle 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function assertSingle(values, key) {
  if (values.length > 1) throw new Error(`multiple ${key} values are not supported`)
  return values[0]
}

/** 中文说明：函数 worktreeConfigExtensionEnabled 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function worktreeConfigExtensionEnabled(root, commonConfigPath) {
  /** 中文说明：变量 extensionText 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const extensionText = assertSingle(
    directFileConfigValues(root, commonConfigPath, 'extensions.worktreeConfig'),
    'extensions.worktreeConfig',
  )
  return extensionText === undefined
    ? false
    : parseGitBoolean(extensionText, 'extensions.worktreeConfig')
}

/** 中文说明：函数 hasDirectConfigEntries 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function hasDirectConfigEntries(root, configPath) {
  return git(['config', '--file', configPath, '--no-includes', '--null', '--list'], root).stdout !== ''
}

/** 中文说明：函数 registeredWorktreeConfigPaths 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function registeredWorktreeConfigPaths(commonDirectory) {
  /** 中文说明：变量 paths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const paths = [join(commonDirectory, 'config.worktree')]
  /** 中文说明：变量 linkedDirectory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const linkedDirectory = join(commonDirectory, 'worktrees')
  try {
    /** 中文说明：变量 entries 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = readdirSync(linkedDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const entry of entries) {
      paths.push(join(linkedDirectory, entry.name, 'config.worktree'))
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
  return paths
}

/** 中文说明：函数 lstatIfPresent 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function lstatIfPresent(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

/** 中文说明：函数 assertCommonConfigFile 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function assertCommonConfigFile(commonConfigPath) {
  /** 中文说明：变量 configStat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const configStat = lstatIfPresent(commonConfigPath)
  if (configStat === undefined || !configStat.isFile() || configStat.isSymbolicLink()) {
    throw new Error(
      `refusing common repository config ${JSON.stringify(commonConfigPath)} because it is not a regular file`,
    )
  }
}

/** 中文说明：函数 assertWorktreeConfigFiles 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function assertWorktreeConfigFiles(root, commonDirectory, commonConfigPath, currentConfigPath) {
  /** 中文说明：变量 extensionEnabled 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const extensionEnabled = worktreeConfigExtensionEnabled(root, commonConfigPath)
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const configPath of registeredWorktreeConfigPaths(commonDirectory)) {
    /** 中文说明：变量 configStat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configStat = lstatIfPresent(configPath)
    if (configStat === undefined) continue
    if (!configStat.isFile() || configStat.isSymbolicLink()) {
      /** 中文说明：变量 state 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const state = extensionEnabled ? 'active' : 'dormant'
      throw new Error(
        `refusing ${state} worktree config ${JSON.stringify(configPath)} because it is not a regular file; `
        + 'replace it with a regular worktree config or remove it before retrying',
      )
    }
    if (extensionEnabled) continue
    if (!hasDirectConfigEntries(root, configPath)) continue
    /** 中文说明：变量 isCurrent 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const isCurrent = normalizedPath(configPath) === normalizedPath(currentConfigPath)
    /** 中文说明：变量 owner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const owner = isCurrent ? 'current' : 'sibling'
    throw new Error(
      `cannot enable extensions.worktreeConfig while ${owner} dormant worktree config `
      + `${JSON.stringify(configPath)} contains user-owned settings that enabling the extension would activate; `
      + 'inspect and migrate those settings, then enable the extension explicitly or remove them before retrying',
    )
  }
}

/** 中文说明：函数 assertSupportedGit 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function assertSupportedGit(root) {
  /** 中文说明：变量 version 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const version = git(['--version'], root).stdout.trim()
  /** 中文说明：变量 match 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(version)
  if (match === null) throw new Error(`cannot determine Git version from ${JSON.stringify(version)}`)
  /** 中文说明：变量 actual 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const actual = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < MINIMUM_GIT.length; index += 1) {
    if (actual[index] > MINIMUM_GIT[index]) return
    if (actual[index] < MINIMUM_GIT[index]) {
      throw new Error(`Git 2.26 or newer is required for worktree-local hooks; found ${version}`)
    }
  }
}

/** 中文说明：函数 planWorktreeConfigMigration 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function planWorktreeConfigMigration(root, commonConfigPath) {
  /** 中文说明：变量 versions 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const versions = directFileConfigValues(root, commonConfigPath, 'core.repositoryFormatVersion')
  /** 中文说明：变量 versionText 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const versionText = assertSingle(versions, 'core.repositoryFormatVersion')
  /** 中文说明：变量 version 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const version = Number(versionText)
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`unsupported core.repositoryFormatVersion: ${JSON.stringify(versionText)}`)
  }

  if (version === 0) {
    /** 中文说明：变量 extensionEntry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const extensionEntry = directFileConfigMatchingEntries(
      root,
      commonConfigPath,
      REPOSITORY_EXTENSION_PATTERN,
    )[0]
    if (extensionEntry !== undefined) {
      throw new Error(
        `cannot upgrade core.repositoryFormatVersion from 0 while dormant repository extension `
        + `${extensionEntry.name} is configured (${configSource(extensionEntry)}); `
        + 'audit and migrate it, then set repository format 1 explicitly before retrying',
      )
    }
  }

  /** 中文说明：变量 extensionEnabled 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const extensionEnabled = worktreeConfigExtensionEnabled(root, commonConfigPath)
  /** 中文说明：变量 worktreeText 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const worktreeText = assertSingle(
    directFileConfigValues(root, commonConfigPath, 'core.worktree'),
    'core.worktree',
  )
  if (worktreeText !== undefined) {
    throw new Error(
      `cannot enable extensions.worktreeConfig while core.worktree is in the common config `
      + `(file:${commonConfigPath}: ${JSON.stringify(worktreeText)}); `
      + 'move it to the main worktree config first',
    )
  }

  /** 中文说明：变量 directBareText 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const directBareText = assertSingle(directFileConfigValues(root, commonConfigPath, 'core.bare'), 'core.bare')
  /** 中文说明：变量 directBare 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const directBare = directBareText === undefined ? undefined : parseGitBoolean(directBareText, 'core.bare')
  if (directBare === true) {
    throw new Error(
      `cannot enable extensions.worktreeConfig for a common config with core.bare=true `
      + `(file:${commonConfigPath}: ${JSON.stringify(directBareText)})`,
    )
  }

  return { directBare, extensionEnabled, version }
}

/** 中文说明：函数 applyWorktreeConfigMigration 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function applyWorktreeConfigMigration(root, commonConfigPath, migration) {
  const { directBare, extensionEnabled, version } = migration
  if (version === 0) {
    git(['config', '--file', commonConfigPath, 'core.repositoryFormatVersion', '1'], root)
  }
  if (!extensionEnabled) {
    git(['config', '--file', commonConfigPath, 'extensions.worktreeConfig', 'true'], root)
  }
  if (directBare === false) {
    git(['config', '--file', commonConfigPath, '--unset-all', 'core.bare'], root)
  }
}

/** 中文说明：函数 readInstallLock 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function readInstallLock(lockPath) {
  try {
    return readFileSync(lockPath, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

/** 中文说明：函数 installLockStat 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function installLockStat(lockPath) {
  try {
    return lstatSync(lockPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

/** 中文说明：函数 parseInstallLock 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parseInstallLock(record) {
  /** 中文说明：变量 match 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const match = /^([1-9]\d*) ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\n$/i.exec(record)
  if (match === null) return undefined
  /** 中文说明：变量 owner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const owner = Number(match[1])
  return Number.isSafeInteger(owner) ? owner : undefined
}

/** 中文说明：函数 installLockRecordMayBeIncomplete 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function installLockRecordMayBeIncomplete(record) {
  // Exclusive creation exposes the inode before its owner record is fully written.
  return record === '' || (!record.endsWith('\n') && /^[1-9]\d*(?: [0-9a-f-]*)?$/i.test(record))
}

/** 中文说明：函数 lockOwnerIsAlive 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function lockOwnerIsAlive(owner) {
  try {
    process.kill(owner, 0)
    return true
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false
    if (errorCode(error) === 'EPERM') return true
    throw error
  }
}

/** 中文说明：函数 manualLockRecoveryError 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function manualLockRecoveryError(lockPath, condition) {
  return new Error(
    `${condition} Lefthook installer lock ${JSON.stringify(lockPath)}. `
    + 'Confirm no Lefthook installer is running, remove it manually, and retry.',
  )
}

/** 中文说明：函数 lockOwnershipChangedError 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function lockOwnershipChangedError(lockPath) {
  return new Error(`Lefthook installer lock ownership changed for ${lockPath}; refusing to remove it`)
}

/** 中文说明：函数 releaseInstallLock 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function releaseInstallLock(lockPath, ownedRecord, ownedStat) {
  /** 中文说明：变量 currentStat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const currentStat = installLockStat(lockPath)
  if (
    currentStat === undefined
    || !currentStat.isFile()
    || currentStat.isSymbolicLink()
    || currentStat.dev !== ownedStat.dev
    || currentStat.ino !== ownedStat.ino
    || readInstallLock(lockPath) !== ownedRecord
  ) {
    throw lockOwnershipChangedError(lockPath)
  }
  try {
    unlinkSync(lockPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw lockOwnershipChangedError(lockPath)
    }
    throw error
  }
}

/** 中文说明：函数 acquireInstallLock 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function acquireInstallLock(commonDirectory) {
  /** 中文说明：变量 lockPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lockPath = join(commonDirectory, INSTALL_LOCK)
  /** 中文说明：变量 deadline 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const deadline = Date.now() + INSTALL_LOCK_TIMEOUT_MS
  /** 中文说明：变量 ownedRecord 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ownedRecord = `${String(process.pid)} ${randomUUID()}\n`
  /** 中文说明：变量 initializingLock 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let initializingLock
  while (true) {
    try {
      /** 中文说明：变量 lockHandle 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const lockHandle = openSync(lockPath, 'wx', 0o600)
      /** 中文说明：变量 ownedStat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let ownedStat
      try {
        ownedStat = fstatSync(lockHandle)
        /** 中文说明：变量 writeDelay 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const writeDelay = Number(process.env.DSH_TEST_LEFTHOOK_LOCK_WRITE_DELAY_MS ?? 0)
        if (writeDelay > 0) {
          await new Promise(resolveWait => setTimeout(resolveWait, writeDelay))
        }
        writeFileSync(lockHandle, ownedRecord)
      } finally {
        closeSync(lockHandle)
      }
      /** 中文说明：变量 publishedStat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const publishedStat = installLockStat(lockPath)
      if (
        publishedStat === undefined
        || !publishedStat.isFile()
        || publishedStat.isSymbolicLink()
        || publishedStat.dev !== ownedStat.dev
        || publishedStat.ino !== ownedStat.ino
      ) {
        throw lockOwnershipChangedError(lockPath)
      }
      return () => releaseInstallLock(lockPath, ownedRecord, ownedStat)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      /** 中文说明：变量 existingStat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const existingStat = installLockStat(lockPath)
      if (existingStat === undefined) continue
      if (!existingStat.isFile() || existingStat.isSymbolicLink()) {
        throw manualLockRecoveryError(lockPath, 'invalid')
      }
      /** 中文说明：变量 existingRecord 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const existingRecord = readInstallLock(lockPath)
      if (existingRecord === undefined) continue
      /** 中文说明：变量 verifiedStat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const verifiedStat = installLockStat(lockPath)
      if (verifiedStat === undefined) continue
      if (!verifiedStat.isFile() || verifiedStat.isSymbolicLink()) {
        throw manualLockRecoveryError(lockPath, 'invalid')
      }
      if (verifiedStat.dev !== existingStat.dev || verifiedStat.ino !== existingStat.ino) continue
      /** 中文说明：变量 owner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const owner = parseInstallLock(existingRecord)
      if (owner === undefined) {
        if (!installLockRecordMayBeIncomplete(existingRecord)) {
          throw manualLockRecoveryError(lockPath, 'invalid')
        }
        /** 中文说明：变量 now 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const now = Date.now()
        if (
          initializingLock === undefined
          || initializingLock.dev !== existingStat.dev
          || initializingLock.ino !== existingStat.ino
        ) {
          initializingLock = {
            deadline: now + INSTALL_LOCK_INITIALIZATION_TIMEOUT_MS,
            dev: existingStat.dev,
            ino: existingStat.ino,
          }
        }
        if (now >= initializingLock.deadline) {
          throw manualLockRecoveryError(lockPath, 'invalid')
        }
        await new Promise(resolveWait => setTimeout(resolveWait, INSTALL_LOCK_POLL_MS))
        continue
      }
      initializingLock = undefined
      if (!lockOwnerIsAlive(owner)) throw manualLockRecoveryError(lockPath, 'stale')
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for Lefthook installer lock ${lockPath}`)
      }
      await new Promise(resolveWait => setTimeout(resolveWait, INSTALL_LOCK_POLL_MS))
    }
  }
}

/** 中文说明：函数 ownershipMarkerContent 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ownershipMarkerContent(hooksPath) {
  return `${JSON.stringify({
    version: OWNERSHIP_MARKER_VERSION,
    owner: OWNERSHIP_MARKER_OWNER,
    hooksPath,
  })}\n`
}

/** 中文说明：函数 parseOwnershipMarker 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parseOwnershipMarker(content) {
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    return undefined
  }
  if (
    typeof parsed !== 'object'
    || parsed === null
    || parsed.version !== OWNERSHIP_MARKER_VERSION
    || parsed.owner !== OWNERSHIP_MARKER_OWNER
    || typeof parsed.hooksPath !== 'string'
    || !isAbsolute(parsed.hooksPath)
  ) {
    return undefined
  }
  return { hooksPath: parsed.hooksPath }
}

/** 中文说明：函数 inspectOwnedHooksDirectory 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function inspectOwnedHooksDirectory(hooksPath) {
  /** 中文说明：变量 markerPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const markerPath = join(hooksPath, OWNERSHIP_MARKER)
  if (!existsSync(hooksPath)) return undefined
  /** 中文说明：变量 hooksStat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const hooksStat = lstatSync(hooksPath)
  if (!hooksStat.isDirectory() || hooksStat.isSymbolicLink()) {
    throw new Error(`refusing to use non-directory or symlinked hooks path ${hooksPath}`)
  }
  if (!existsSync(markerPath)) {
    throw new Error(`refusing to overwrite unowned hooks directory ${hooksPath}`)
  }
  /** 中文说明：变量 markerStat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const markerStat = lstatSync(markerPath)
  /** 中文说明：变量 marker 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const marker = markerStat.isFile() && !markerStat.isSymbolicLink() && markerStat.nlink === 1
    ? parseOwnershipMarker(readFileSync(markerPath, 'utf8'))
    : undefined
  if (marker === undefined) {
    throw new Error(`refusing to overwrite hooks directory with an invalid ownership marker: ${hooksPath}`)
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const name of readdirSync(hooksPath)) {
    if (name === OWNERSHIP_MARKER) continue
    /** 中文说明：变量 entryPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entryPath = join(hooksPath, name)
    /** 中文说明：变量 entryStat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entryStat = lstatSync(entryPath)
    if (!entryStat.isFile() || entryStat.isSymbolicLink() || entryStat.nlink !== 1) {
      throw new Error(
        `refusing to overwrite non-regular or multiply linked hook entry ${JSON.stringify(entryPath)}`,
      )
    }
  }
  return { markerPath, ...marker }
}

/** 中文说明：函数 isRegisteredOwnedHooksPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isRegisteredOwnedHooksPath(commonDirectory, hooksPath) {
  /** 中文说明：变量 normalizedHooksPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normalizedHooksPath = normalizedPath(hooksPath)
  /** 中文说明：变量 isRegistered 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const isRegistered = registeredWorktreeConfigPaths(commonDirectory).some(
    configPath => normalizedPath(join(dirname(configPath), HOOKS_DIRECTORY)) === normalizedHooksPath,
  )
  if (!isRegistered) return false
  return inspectOwnedHooksDirectory(hooksPath)?.hooksPath === hooksPath
}

/** 中文说明：函数 ensureOwnedHooksDirectory 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ensureOwnedHooksDirectory(hooksPath) {
  /** 中文说明：变量 inspected 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const inspected = inspectOwnedHooksDirectory(hooksPath)
  if (inspected !== undefined) return inspected
  mkdirSync(hooksPath, { mode: 0o700 })
  /** 中文说明：变量 markerPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const markerPath = join(hooksPath, OWNERSHIP_MARKER)
  writeFileSync(markerPath, ownershipMarkerContent(hooksPath), { flag: 'wx', mode: 0o600 })
  return { markerPath, hooksPath }
}

/** 中文说明：函数 updateOwnershipMarker 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function updateOwnershipMarker(markerPath, hooksPath) {
  writeFileSync(markerPath, ownershipMarkerContent(hooksPath), { mode: 0o600 })
}

/** 中文说明：函数 environmentWithoutCommandGitConfig 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function environmentWithoutCommandGitConfig() {
  /** 中文说明：变量 env 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const env = { ...process.env }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const key of Object.keys(env)) {
    /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const normalized = key.toUpperCase()
    if (
      normalized === 'GIT_CONFIG_PARAMETERS'
      || normalized === 'GIT_CONFIG_COUNT'
      || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(normalized)
    ) {
      delete env[key]
    }
  }
  return env
}

/** 中文说明：函数 runLefthook 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function runLefthook(root, lefthook) {
  /** 中文说明：变量 args 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const args = ['install', '--force']
  /** 中文说明：变量 env 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const env = environmentWithoutCommandGitConfig()
  // Node refuses to spawn Windows `.cmd` shims directly; the quoted path is
  // re-parsed by cmd.exe, while POSIX can execute its extensionless shim.
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = process.platform === 'win32'
    ? spawnSync(`"${lefthook}"`, args, { cwd: root, env, stdio: 'inherit', shell: true })
    : spawnSync(lefthook, args, { cwd: root, env, stdio: 'inherit' })
  if (result.status !== 0) throw commandFailure(lefthook, args, result)
}

/** 中文说明：函数 configSource 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function configSource(entry) {
  return `${entry.origin}: ${JSON.stringify(entry.value)}`
}

/** 中文说明：函数 normalizedPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function normalizedPath(path) {
  /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** 中文说明：函数 configOriginPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function configOriginPath(origin, root) {
  if (!origin.startsWith('file:')) return undefined
  /** 中文说明：变量 originPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const originPath = origin.slice('file:'.length)
  return isAbsolute(originPath) ? originPath : resolve(root, originPath)
}

/** 中文说明：函数 originIsFile 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function originIsFile(origin, root, configPath) {
  /** 中文说明：变量 originPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const originPath = configOriginPath(origin, root)
  return originPath !== undefined && normalizedPath(originPath) === normalizedPath(configPath)
}

/** 中文说明：函数 refuseInheritedHooksPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function refuseInheritedHooksPath(entry) {
  throw new Error(
    `refusing to replace user-owned core.hooksPath (${configSource(entry)}). `
    + `Chain those hooks through lefthook.yml, or, if this inherited path may remain active only in other worktrees, `
    + `rerun with ${ALLOW_HOOKS_PATH_OVERRIDE}=1`,
  )
}

/** 中文说明：函数 refuseScopedHooksPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function refuseScopedHooksPath(entry) {
  if (entry.scope === 'command') {
    throw new Error(
      `refusing to replace command-scoped core.hooksPath (${configSource(entry)}); `
      + `${ALLOW_HOOKS_PATH_OVERRIDE} cannot override transient command configuration`,
    )
  }
  if (entry.scope === 'worktree') {
    throw new Error(
      `refusing to replace worktree-scoped core.hooksPath (${configSource(entry)}); `
      + 'a worktree-specific custom path must be integrated or removed explicitly',
    )
  }
  throw new Error(
    `refusing to replace core.hooksPath from unsupported ${entry.scope} scope (${configSource(entry)})`,
  )
}

/** 中文说明：函数 installPairingMergeDriver 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function installPairingMergeDriver(root, worktreeConfigPath) {
  /** 中文说明：变量 added 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const added = []
  try {
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const [key, expected] of PAIRING_MERGE_DRIVER_CONFIG) {
      /** 中文说明：变量 entries 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const entries = includedFileConfigEntries(root, worktreeConfigPath, key)
      /** 中文说明：函数值 includedEntry 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const includedEntry = entries.find(entry => !originIsFile(entry.origin, root, worktreeConfigPath))
      if (includedEntry !== undefined) {
        throw new Error(
          `refusing pairing merge-driver config from an included worktree file (${configSource(includedEntry)})`,
        )
      }
      /** 中文说明：函数值 existing 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const existing = assertSingle(entries.map(entry => entry.value), `worktree ${key}`)
      /** 中文说明：变量 effectiveBefore 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const effectiveBefore = effectiveConfigEntry(root, key)
      if (effectiveBefore?.scope === 'command') {
        throw new Error(
          `refusing command-scoped ${key} (${configSource(effectiveBefore)}); `
          + 'transient configuration cannot be replaced by the worktree installer',
        )
      }
      if (existing === undefined && effectiveBefore !== undefined && effectiveBefore.value !== expected) {
        throw new Error(
          `refusing to mask inherited ${key} (${configSource(effectiveBefore)}); `
          + 'remove or integrate the custom pairing merge driver explicitly',
        )
      }
      if (existing !== undefined && existing !== expected) {
        throw new Error(
          `refusing to replace worktree ${key} value ${JSON.stringify(existing)}; `
          + 'remove or integrate the custom pairing merge driver explicitly',
        )
      }
      if (existing === undefined) {
        git(['config', '--worktree', key, expected], root)
        added.push(key)
      }
      /** 中文说明：变量 installed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const installed = includedFileConfigEntries(root, worktreeConfigPath, key)
      if (
        installed.length !== 1
        || installed[0]?.value !== expected
        || !originIsFile(installed[0].origin, root, worktreeConfigPath)
      ) {
        throw new Error(`new worktree-local ${key} did not become the direct worktree value`)
      }
      /** 中文说明：变量 effectiveAfter 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const effectiveAfter = effectiveConfigEntry(root, key)
      if (
        effectiveAfter === undefined
        || effectiveAfter.scope !== 'worktree'
        || effectiveAfter.value !== expected
        || !originIsFile(effectiveAfter.origin, root, worktreeConfigPath)
      ) {
        throw new Error(`new worktree-local ${key} did not become the effective direct worktree value`)
      }
    }
  } catch (error) {
    /** 中文说明：变量 rollbackErrors 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rollbackErrors = []
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const key of added.reverse()) {
      try {
        git(['config', '--worktree', '--unset-all', key], root)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Pairing merge-driver configuration failed: ${String(error)}; `
        + `rollback also failed: ${rollbackErrors.map(String).join('; ')}`,
      )
    }
    throw error
  }
  return () => {
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const key of added.reverse()) git(['config', '--worktree', '--unset-all', key], root)
  }
}

/** 中文说明：函数 probePairingMergeDriver 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function probePairingMergeDriver(root) {
  capture(process.execPath, PAIRING_MERGE_DRIVER_PROBE, { cwd: root })
}

/** 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function main() {
  if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') return
  if (typeof lefthookPackage.bin?.lefthook !== 'string') return
  /** 中文说明：变量 probe 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const probe = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  if (probe.status !== 0) return
  /** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = stripGitLineTerminator(probe.stdout)
  /** 中文说明：变量 isWindows 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const isWindows = process.platform === 'win32'
  /** 中文说明：变量 lefthook 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lefthook = join(root, 'node_modules', '.bin', isWindows ? 'lefthook.cmd' : 'lefthook')
  if (!existsSync(lefthook)) return

  assertSupportedGit(root)
  /** 中文说明：变量 gitDirectory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const gitDirectory = stripGitLineTerminator(git(['rev-parse', '--absolute-git-dir'], root).stdout)
  /** 中文说明：变量 commonOutput 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const commonOutput = stripGitLineTerminator(git(['rev-parse', '--git-common-dir'], root).stdout)
  /** 中文说明：变量 commonDirectory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const commonDirectory = isAbsolute(commonOutput) ? commonOutput : resolve(root, commonOutput)
  /** 中文说明：变量 commonConfigPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const commonConfigPath = join(commonDirectory, 'config')
  /** 中文说明：变量 worktreeConfigPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const worktreeConfigPath = join(gitDirectory, 'config.worktree')
  /** 中文说明：变量 hooksPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const hooksPath = join(gitDirectory, HOOKS_DIRECTORY)
  /** 中文说明：变量 releaseLock 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const releaseLock = await acquireInstallLock(commonDirectory)
  /** 中文说明：变量 installationError 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let installationError

  try {
    assertCommonConfigFile(commonConfigPath)
    assertWorktreeConfigFiles(
      root,
      commonDirectory,
      commonConfigPath,
      worktreeConfigPath,
    )
    /** 中文说明：变量 worktreeEntries 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const worktreeEntries = includedFileConfigEntries(root, worktreeConfigPath, 'core.hooksPath')
    /** 中文说明：变量 includedWorktreeEntry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const includedWorktreeEntry = worktreeEntries.find(
      entry => !originIsFile(entry.origin, root, worktreeConfigPath),
    )
    if (includedWorktreeEntry !== undefined) {
      refuseScopedHooksPath({ ...includedWorktreeEntry, scope: 'worktree' })
    }
    /** 中文说明：变量 worktreePath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const worktreePath = assertSingle(
      worktreeEntries.map(entry => entry.value),
      'worktree core.hooksPath',
    )
    /** 中文说明：变量 ownedHooksDirectory 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let ownedHooksDirectory
    /** 中文说明：变量 copiedWorktreePathIsOwned 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let copiedWorktreePathIsOwned = false
    if (worktreePath !== undefined && worktreePath !== hooksPath) {
      ownedHooksDirectory = inspectOwnedHooksDirectory(hooksPath)
      /** 中文说明：变量 worktreePathIsRelocated 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const worktreePathIsRelocated = ownedHooksDirectory?.hooksPath === worktreePath
      copiedWorktreePathIsOwned = !worktreePathIsRelocated
        && isRegisteredOwnedHooksPath(commonDirectory, worktreePath)
      if (!worktreePathIsRelocated && !copiedWorktreePathIsOwned) {
        refuseScopedHooksPath({ origin: `file:${worktreeConfigPath}`, scope: 'worktree', value: worktreePath })
      }
    }
    /** 中文说明：变量 directWorktreePathIsOwned 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const directWorktreePathIsOwned = worktreePath !== undefined
      && (
        worktreePath === hooksPath
        || ownedHooksDirectory?.hooksPath === worktreePath
        || copiedWorktreePathIsOwned
      )
    /** 中文说明：变量 effectiveEntry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const effectiveEntry = effectiveConfigEntry(root, 'core.hooksPath')
    if (effectiveEntry !== undefined) {
      /** 中文说明：变量 effectivePathIsOwned 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const effectivePathIsOwned = effectiveEntry.scope === 'worktree'
        && effectiveEntry.value === worktreePath
        && directWorktreePathIsOwned
        && originIsFile(effectiveEntry.origin, root, worktreeConfigPath)
      if (!effectivePathIsOwned) {
        if (effectiveEntry.scope === 'command' || effectiveEntry.scope === 'worktree') {
          refuseScopedHooksPath(effectiveEntry)
        }
        if (!['system', 'global', 'local'].includes(effectiveEntry.scope)) {
          refuseScopedHooksPath(effectiveEntry)
        }
        if (process.env[ALLOW_HOOKS_PATH_OVERRIDE] !== '1') {
          refuseInheritedHooksPath(effectiveEntry)
        }
      }
    }
    /** 中文说明：变量 migration 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const migration = planWorktreeConfigMigration(root, commonConfigPath)
    ownedHooksDirectory = ensureOwnedHooksDirectory(hooksPath)
    if (
      worktreePath !== undefined
      && worktreePath !== hooksPath
      && ownedHooksDirectory.hooksPath !== worktreePath
      && !copiedWorktreePathIsOwned
    ) {
      throw new Error(`hooks directory ownership changed while relocating ${JSON.stringify(worktreePath)}`)
    }
    applyWorktreeConfigMigration(root, commonConfigPath, migration)

    /** 中文说明：变量 pathChanged 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let pathChanged = false
    /** 中文说明：函数值 rollbackPairingMergeDriver 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    let rollbackPairingMergeDriver = () => {}
    try {
      probePairingMergeDriver(root)
      rollbackPairingMergeDriver = installPairingMergeDriver(root, worktreeConfigPath)
      git(['config', '--worktree', 'core.hooksPath', hooksPath], root)
      pathChanged = worktreePath !== hooksPath
      /** 中文说明：变量 installedEntry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const installedEntry = effectiveConfigEntry(root, 'core.hooksPath')
      if (
        installedEntry === undefined
        || installedEntry.scope !== 'worktree'
        || installedEntry.value !== hooksPath
        || !originIsFile(installedEntry.origin, root, worktreeConfigPath)
      ) {
        throw new Error('new worktree-local core.hooksPath did not become the effective direct worktree value')
      }
      runLefthook(root, lefthook)
      updateOwnershipMarker(ownedHooksDirectory.markerPath, hooksPath)
    } catch (error) {
      /** 中文说明：变量 rollbackErrors 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const rollbackErrors = []
      if (pathChanged) {
        try {
          if (worktreePath === undefined) {
            git(['config', '--worktree', '--unset-all', 'core.hooksPath'], root)
          } else {
            git(['config', '--worktree', 'core.hooksPath', worktreePath], root)
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      try {
        rollbackPairingMergeDriver()
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Lefthook installation failed: ${String(error)}; `
          + `worktree integration rollback also failed: ${rollbackErrors.map(String).join('; ')}`,
        )
      }
      throw error
    }
  } catch (error) {
    installationError = error
    throw error
  } finally {
    try {
      releaseLock()
    } catch (releaseError) {
      if (installationError !== undefined) {
        throw new AggregateError(
          [installationError, releaseError],
          `Lefthook installation failed: ${String(installationError)}; installer lock release also failed: ${String(releaseError)}`,
        )
      }
      throw releaseError
    }
  }
}

try {
  await main()
} catch (error) {
  console.error(`[install-lefthook] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
