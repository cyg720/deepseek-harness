/**
 * Behavioural check of this package's `node:fs` bridge over a real MemoryVfs:
 * encoding branches, Dirent, file descriptors, FileHandle append/replace semantics,
 * and Node's error codes.
 *
 * Every import resolves through `src/` so the harness and bridge share the same
 * module-level VFS slot. Mixing the bare package's built entry with `/src/*`
 * imports can create two slots, leaving the bridge with no mounted filesystem.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 fs spec 相关行为与失败场景。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { expect, test } from 'vitest'
import { MemoryVfs } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/memory.ts'
import { setActiveVfs } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/active.ts'
import * as fs from '@deepseek-ai/dsh-experimental-webworker-runtime/src/node/builtin_modules/implemented/fs.ts'
import * as fsp from '@deepseek-ai/dsh-experimental-webworker-runtime/src/node/builtin_modules/implemented/fs/promises.ts'
import type { VfsBigIntStats, VfsMutationSink, VfsStats } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/types.ts'

/**
 * 变量说明：flushes 用于处理 flushes 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let flushes = 0
/**
 * 常量说明：sink 用于处理 sink 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
const sink: VfsMutationSink = {
  record: () => {},
  flush: () => {
    flushes += 1
    return Promise.resolve()
  },
}
/**
 * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const vfs = new MemoryVfs({ sink })
setActiveVfs(vfs)

// Identity precondition: the bridge must read this exact mounted VFS; successful
// calls alone could come from another mounted instance.
fs.mkdirSync('/dsh/.probe', { recursive: true })
fs.writeFileSync('/dsh/.probe/instance', 'x')
if (!vfs.existsSync('/dsh/.probe/instance')) {
  throw new Error('fs-check: the fs bridge is not reading the VFS this harness mounted '
    + '(two module instances — check that every import resolves through src/)')
}
vfs.rmSync('/dsh/.probe', { recursive: true })

/**
 * 常量说明：check 用于处理 check 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 check 相关流程；使用场景由所在模块及调用位置决定。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param actual （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param expected （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 check(label, actual, expected)，并按返回类型处理结果。
 */
const check = (label: string, actual: unknown, expected: unknown): void => {
  /**
   * 常量说明：seen、wanted 用于处理 seen、wanted 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [seen, wanted] = [JSON.stringify(actual), JSON.stringify(expected)]
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  test(label, () => { expect(seen).toBe(wanted) })
}
/**
 * 常量说明：throws 用于处理 throws 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 throws 相关流程；使用场景由所在模块及调用位置决定。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param run （() => unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param code （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 throws(label, run, code)，并按返回类型处理结果。
 */
const throws = (label: string, run: () => unknown, code: string): void => {
  /**
   * 变量说明：outcome 用于处理 outcome 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let outcome: string
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    run()
    outcome = 'did not throw'
  } catch (error) {
    outcome = (error as { code?: string }).code ?? (error as Error).message
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  test(label, () => { expect(outcome).toContain(code) })
}

fs.mkdirSync('/dsh/config', { recursive: true })
fs.writeFileSync('/dsh/config/cordis.yml', '- id: timer\n')
check('readFileSync utf8', fs.readFileSync('/dsh/config/cordis.yml', 'utf8'), '- id: timer\n')
check('readFileSync options object', fs.readFileSync('/dsh/config/cordis.yml', { encoding: 'utf8' }), '- id: timer\n')
check('readFileSync bytes length', (fs.readFileSync('/dsh/config/cordis.yml') as Uint8Array).byteLength, 12)
check('readFileSync is Buffer', Buffer.isBuffer(fs.readFileSync('/dsh/config/cordis.yml')), true)
check('existsSync true', fs.existsSync('/dsh/config/cordis.yml'), true)
check('existsSync false', fs.existsSync('/dsh/nope'), false)
check('statSync isFile', fs.statSync('/dsh/config/cordis.yml').isFile(), true)
check('statSync size', fs.statSync('/dsh/config/cordis.yml').size, 12)
check('statSync dir', fs.statSync('/dsh/config').isDirectory(), true)
check('realpathSync', fs.realpathSync('/dsh/config/../config/cordis.yml'), '/dsh/config/cordis.yml')

fs.appendFileSync('/dsh/config/cordis.yml', '- id: llm\n')
check('appendFileSync', fs.readFileSync('/dsh/config/cordis.yml', 'utf8'), '- id: timer\n- id: llm\n')

fs.mkdirSync('/dsh/config/agent-presets/standard', { recursive: true })
fs.writeFileSync('/dsh/config/agent-presets/standard/SKILL.md', '# skill\n')
check('readdirSync names', fs.readdirSync('/dsh/config'), ['agent-presets', 'cordis.yml'])
/**
 * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const entries = fs.readdirSync('/dsh/config', { withFileTypes: true }) as fs.Dirent[]
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
 */
check('readdirSync withFileTypes', entries.map(entry => [entry.name, entry.isFile(), entry.isDirectory()]), [
  ['agent-presets', false, true],
  ['cordis.yml', true, false],
])
check('Dirent parentPath', entries[0]!.parentPath, '/dsh/config')

/**
 * 常量说明：temporary 用于处理 temporary 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const temporary = fs.mkdtempSync('/dsh/tmp/run-')
check('mkdtempSync creates directory', fs.statSync(temporary).isDirectory(), true)
check('mkdtempSync unique', fs.mkdtempSync('/dsh/tmp/run-') === temporary, false)

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
throws('readFileSync missing', () => fs.readFileSync('/dsh/missing'), 'ENOENT')
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
throws('statSync missing', () => fs.statSync('/dsh/missing'), 'ENOENT')
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
throws('accessSync missing', () =>{  fs.accessSync('/dsh/missing') }, 'ENOENT')
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
throws('readdirSync missing', () => fs.readdirSync('/dsh/missing'), 'ENOENT')
/**
 * 常量说明：appendFd 用于处理 appendFd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const appendFd = fs.openSync('/dsh/log.jsonl', 'a')
fs.writeSync(appendFd, '{"a":1}\n')
fs.writeSync(appendFd, '{"a":2}\n')
fs.closeSync(appendFd)
check('append fd writes', fs.readFileSync('/dsh/log.jsonl', 'utf8'), '{"a":1}\n{"a":2}\n')

/**
 * 常量说明：readFd 用于读取 Fd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const readFd = fs.openSync('/dsh/log.jsonl', 'r')
/**
 * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const target = new Uint8Array(8)
check('readSync count', fs.readSync(readFd, target, 0, 8), 8)
check('readSync bytes', new TextDecoder().decode(target), '{"a":1}\n')
check('readSync continues', fs.readSync(readFd, target, 0, 8), 8)
check('readSync second line', new TextDecoder().decode(target), '{"a":2}\n')
check('readSync at eof', fs.readSync(readFd, target, 0, 8), 0)
fs.closeSync(readFd)
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
throws('closed fd', () => fs.readSync(readFd, target, 0, 8), 'EBADF')

/**
 * 常量说明：writeFd 用于写入 Fd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const writeFd = fs.openSync('/dsh/truncated.txt', 'w')
fs.writeSync(writeFd, 'abc')
fs.closeSync(writeFd)
check('write fd truncates', fs.readFileSync('/dsh/truncated.txt', 'utf8'), 'abc')

fs.renameSync('/dsh/truncated.txt', '/dsh/renamed.txt')
check('renameSync moves', [fs.existsSync('/dsh/truncated.txt'), fs.readFileSync('/dsh/renamed.txt', 'utf8')], [false, 'abc'])
fs.rmSync('/dsh/renamed.txt')
check('rmSync removes', fs.existsSync('/dsh/renamed.txt'), false)

// A FileHandle opened for appending must append, not replace: the JSONL session
// log writes its header frame first and every batch after it through this path.
fs.writeFileSync('/dsh/log-handle.jsonl', 'header\n')
/**
 * 常量说明：appendHandle 用于处理 appendHandle 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const appendHandle = await fsp.open('/dsh/log-handle.jsonl', 'a')
check('append handle sees the existing size', (await appendHandle.stat()).size, 7)
await appendHandle.writeFile('batch-1\n')
await appendHandle.sync()
check('handle.sync flushes the active VFS', flushes, 1)
await appendHandle.close()
/**
 * 常量说明：secondHandle 用于处理 secondHandle 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const secondHandle = await fsp.open('/dsh/log-handle.jsonl', 'a')
await secondHandle.writeFile('batch-2\n')
await secondHandle.close()
check('handle.writeFile appends in append mode', fs.readFileSync('/dsh/log-handle.jsonl', 'utf8'), 'header\nbatch-1\nbatch-2\n')
/**
 * 常量说明：replaceHandle 用于处理 replaceHandle 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const replaceHandle = await fsp.open('/dsh/log-handle.jsonl', 'w')
await replaceHandle.writeFile('replaced\n')
await replaceHandle.close()
check('handle.writeFile replaces without append mode', fs.readFileSync('/dsh/log-handle.jsonl', 'utf8'), 'replaced\n')
/**
 * 常量说明：truncHandle 用于处理 truncHandle 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const truncHandle = await fsp.open('/dsh/log-handle.jsonl', 'r+')
await truncHandle.truncate(4)
await truncHandle.close()
check('handle.truncate cuts the tail', fs.readFileSync('/dsh/log-handle.jsonl', 'utf8'), 'repl')

check('promises.readFile', await fsp.readFile('/dsh/config/cordis.yml', 'utf8'), '- id: timer\n- id: llm\n')
await fsp.writeFile('/dsh/promise.txt', 'p')
check('promises.writeFile', fs.readFileSync('/dsh/promise.txt', 'utf8'), 'p')
check('promises.stat', (await fsp.stat('/dsh/promise.txt')).isFile(), true)
await fsp.cp('/dsh/config', '/dsh/config-copy')
check('promises.cp tree', await fsp.readFile('/dsh/config-copy/agent-presets/standard/SKILL.md', 'utf8'), '# skill\n')
await fsp.rm('/dsh/config-copy', { recursive: true })
check('promises.rm recursive', fs.existsSync('/dsh/config-copy'), false)

// ---------------------------------------------------------------------------
// The `{ bigint: true }` stats the filesystem service reads.
//
// `dsh-fs-local` stats EVERY target this way before it lists or reads: it masks
// `mode` with a BigInt literal and builds its version token from
// `dev:ino:size:mtimeNs:ctimeNs`. A number-valued `mode` here made that mask
// throw `Cannot mix BigInt and other types`, which the service reported as
// FS_IO_ERROR and skill discovery swallowed as "empty directory" — the worker
// booted with an empty skill catalog and no error anywhere.
// ---------------------------------------------------------------------------

/**
 * 常量说明：bigStats 用于处理 bigStats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 bigStats 相关流程；使用场景由所在模块及调用位置决定。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns VfsBigIntStats；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 bigStats(path)，并按返回类型处理结果。
 */
const bigStats = (path: string): VfsBigIntStats => fs.statSync(path, { bigint: true }) as VfsBigIntStats

fs.writeFileSync('/dsh/versioned.txt', 'one')
{
  /**
   * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stats = bigStats('/dsh/versioned.txt')
  check('bigint stat reports mode as a BigInt', typeof stats.mode, 'bigint')
  check('bigint mode masks to the creation-default file permission', Number(stats.mode & 0o777n), 0o644)
  check('bigint stat reports the identity fields the version token needs', [
    typeof stats.dev, typeof stats.ino, typeof stats.size, typeof stats.mtimeNs, typeof stats.ctimeNs,
  ], ['bigint', 'bigint', 'bigint', 'bigint', 'bigint'])
  check('bigint nanosecond time scales the millisecond time', stats.mtimeNs === stats.mtimeMs * 1_000_000n, true)
  check('bigint stat still answers the type predicates', [stats.isFile(), stats.isDirectory()], [true, false])
  check('plain stat keeps its number shape', typeof fs.statSync('/dsh/versioned.txt').mode, 'number')
}

{
  // Two writes inside one millisecond must not produce one version: the service's
  // stale-write guard compares these tokens.
  /**
   * 常量说明：token 用于处理 token 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 token 相关流程；使用场景由所在模块及调用位置决定。
   * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 token(path)，并按返回类型处理结果。
   */
  const token = (path: string): string => {
    /**
     * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stats = bigStats(path)
    return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`
  }
  /**
   * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const before = token('/dsh/versioned.txt')
  fs.writeFileSync('/dsh/versioned.txt', 'two')
  check('a rewrite changes the version token', token('/dsh/versioned.txt') !== before, true)
  check('an unchanged file keeps its version token', token('/dsh/versioned.txt'), token('/dsh/versioned.txt'))
}

{
  /**
   * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const first = bigStats('/dsh/versioned.txt').ino
  fs.writeFileSync('/dsh/versioned.txt', 'three')
  check('identity survives a write to the same path', String(bigStats('/dsh/versioned.txt').ino), String(first))
  fs.rmSync('/dsh/versioned.txt')
  fs.writeFileSync('/dsh/versioned.txt', 'four')
  check('a removed and recreated path reports a new identity', bigStats('/dsh/versioned.txt').ino !== first, true)
}

check('a directory reports the creation-default mode in the bigint shape', Number(bigStats('/dsh/config').mode & 0o777n), 0o755)

// ---------------------------------------------------------------------------
// Permission bits round-trip: creation takes the caller's mode, chmod changes
// it, stat reads back the stored value. dsh-credentials-local's owner-only
// check reads exactly this (writeFileAtomic writes `wx` + mode 600, renames
// into place, then the provider stats the result).
// ---------------------------------------------------------------------------

/**
 * 常量说明：plainMode 用于处理 plainMode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 plainMode 相关流程；使用场景由所在模块及调用位置决定。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 plainMode(path)，并按返回类型处理结果。
 */
const plainMode = (path: string): number => (fs.statSync(path) as VfsStats).mode & 0o777

fs.writeFileSync('/dsh/secrets.tmp', 'k: v\n', { mode: 0o600, flag: 'wx' })
fs.renameSync('/dsh/secrets.tmp', '/dsh/secrets.yaml')
check('a wx write with mode 600 stats as 600 after rename', plainMode('/dsh/secrets.yaml'), 0o600)
fs.writeFileSync('/dsh/secrets.yaml', 'k: w\n')
check('a rewrite keeps the creation bits', plainMode('/dsh/secrets.yaml'), 0o600)
fs.chmodSync('/dsh/secrets.yaml', 0o640)
check('chmod reads back exactly what was set', plainMode('/dsh/secrets.yaml'), 0o640)
await fsp.chmod('/dsh/secrets.yaml', 0o600)
check('promises.chmod reads back through the bigint shape', Number(bigStats('/dsh/secrets.yaml').mode & 0o777n), 0o600)
fs.mkdirSync('/dsh/vault', { mode: 0o700 })
check('mkdir honours its mode option', plainMode('/dsh/vault'), 0o700)
check('promises.stat forwards the bigint option', typeof (await fsp.stat('/dsh/config', { bigint: true })).mode, 'bigint')
