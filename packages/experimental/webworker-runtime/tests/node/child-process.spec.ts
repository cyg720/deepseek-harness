/**
 * The `node:child_process` face over the in-worker shell, and the ladder above
 * it: the REAL local subprocess service, running unmodified against this
 * module instead of a host kernel. The bash tool walks this same ladder in the
 * browser.
 *
 * A Node test host has no DOM `Worker`, so the commands here run through the
 * inline strategy; the worker strategy and its frames are proven in
 * `../shell/shell-process.spec.ts`.
 *
 * `process.kill` is redirected to the worker's process table for the same
 * reason the worker does it: the subprocess service polls process-group
 * liveness through it, and on a test host those pids belong to real processes.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 child process
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryVfs } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/memory.ts'
import { setActiveVfs } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/active.ts'
import { spawn, spawnSync } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/node/builtin_modules/implemented/child_process.ts'
import {
  LAUNCHER_FAILURE_EXIT, grantArgs, launcherPath, probe,
} from '@deepseek-ai/node-addon-landlock-run'
import { processAlive, signalProcess } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/node/process-table.ts'
import { hostFileSystem } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/fs-access.ts'
import {
  LANDLOCK_EXECUTABLE, landlockFileSystem, parseLandlockArguments,
} from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/landlock.ts'
import { spawnSubprocess } from '@deepseek-ai/dsh-subprocess-local/src/spawn.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
vi.mock('node:child_process', async () =>
  await import('@deepseek-ai/dsh-experimental-webworker-runtime/src/node/builtin_modules/implemented/child_process.ts'))

/**
 * 常量说明：WORKSPACE 用于处理 WORKSPACE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const WORKSPACE = '/dsh/workspace'
/**
 * 常量说明：HOME 用于处理 HOME 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const HOME = '/dsh/home'
/**
 * 常量说明：TMP 用于处理 TMP 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const TMP = '/dsh/tmp'

/**
 * 变量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let vfs: MemoryVfs

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
beforeEach(() => {
  vfs = new MemoryVfs()
  setActiveVfs(vfs)
  vfs.mkdirSync(WORKSPACE, { recursive: true })
  vfs.mkdirSync(HOME, { recursive: true })
  vfs.mkdirSync(TMP, { recursive: true })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：pid（number）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：signal（string | number）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：true；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(pid, signal)，
   * 并按返回类型处理结果。
   */
  vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number): true => {
    if (signal === 0) {
      if (processAlive(pid)) return true
      /**
       * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const error = new Error('kill ESRCH') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    }
    signalProcess(pid, (signal ?? 'SIGTERM') as NodeJS.Signals)
    return true
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => {
  vi.restoreAllMocks()
})

/** Collect one child's stdout, stderr, and settlement.
 * @remarks 中文说明：功能说明：收集 collect 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：child（ReturnType<typeof spawn>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<{ stdout: string; stderr: string; code: number | null }>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 collect(child)，并按返回类型处理结果。 */
async function collect(child: ReturnType<typeof spawn>): Promise<{ stdout: string; stderr: string; code: number | null }> {
  /**
   * 变量说明：stdout 用于处理 stdout 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let stdout = ''
  /**
   * 变量说明：stderr 用于处理 stderr 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let stderr = ''
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
   */
  child.stdout?.on('data', (chunk: unknown) => { stdout += String(chunk) })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
   */
  child.stderr?.on('data', (chunk: unknown) => { stderr += String(chunk) })
  /**
   * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：settle（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：fail（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(settle, fail)，并按返回类型处理结果。
   */
  const code = await new Promise<number | null>((settle, fail) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    child.on('close', (value: unknown) => { settle(value as number | null) })
    child.on('error', fail)
  })
  return { stdout, stderr, code }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('runs a bash command line and reports its output through the pipes', async () => {
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = spawn('bash', ['-c', 'echo hi; echo oops >&2'], { cwd: WORKSPACE })
  expect(child.pid).toBeGreaterThan(1)
  expect(await collect(child)).toEqual({ stdout: 'hi\n', stderr: 'oops\n', code: 0 })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('runs an explicit argv without re-parsing it as a command line', async () => {
  vfs.writeFileSync(`${WORKSPACE}/spaced name.txt`, 'kept\n')
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = spawn('cat', ['spaced name.txt'], { cwd: WORKSPACE })
  expect((await collect(child)).stdout).toBe('kept\n')
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('fails a program the command table does not hold the way a missing binary does', async () => {
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = spawn('nowhere-binary', [], { cwd: WORKSPACE })
  // A caller that configures the pipes first (the browser launcher does) must
  // reach the ENOENT, not a TypeError on the configuration line.
  child.stdout?.setEncoding()
  child.stderr?.setEncoding()
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：settle（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(settle)，并按返回类型处理结果。
   */
  const error = await new Promise<NodeJS.ErrnoException>((settle) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    child.on('error', (value: unknown) => { settle(value as NodeJS.ErrnoException) })
  })
  expect(error.code).toBe('ENOENT')
  expect(error.syscall).toBe('spawn nowhere-binary')
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('refuses a command name that is not a string, as Node does', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  expect(() => spawn(undefined as unknown as string)).toThrow(/must be a non-empty string/)
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('reports that a synchronous run cannot happen, without throwing at the probe', () => {
  expect(spawnSync('bwrap').error?.code).toBe('ENOENT')
  expect(spawnSync('echo').error?.message).toContain('commands run asynchronously')
  expect(spawnSync(launcherPath(), ['--probe'])).toMatchObject({
    status: 0,
    stdout: Buffer.from('landlock: fully enforced\n'),
  })
  expect(spawnSync(launcherPath(), ['--ro', '/', '--', 'echo', 'x']).error?.message)
    .toContain('commands run asynchronously')
  /**
   * 常量说明：failedProbe 用于处理 failedProbe 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const failedProbe = spawnSync(launcherPath(), ['--probe', '--'])
  expect(failedProbe.status).toBe(LAUNCHER_FAILURE_EXIT)
  expect(Buffer.isBuffer(failedProbe.stderr)).toBe(true)
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('keeps the native Landlock package API and CLI failure contract', async () => {
  expect(probe()).toBe('full')
  expect(probe('/not-the-worker-launcher')).toBe('unusable')
  expect(probe('/another-package-layout/bin/landlock-run')).toBe('full')
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  expect(launcherPath(() => '/ignored/package.json')).toBe('/ignored/bin/landlock-run')
  expect(LAUNCHER_FAILURE_EXIT).toBe(125)
  expect(await collect(spawn(launcherPath(), ['--probe']))).toEqual({
    stdout: 'landlock: fully enforced\n', stderr: '', code: 0,
  })
  /**
   * 常量说明：malformed 用于处理 malformed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const malformed = spawn(launcherPath(), ['--rw'], { cwd: WORKSPACE })
  expect(await collect(malformed)).toEqual({
    stdout: '',
    stderr: 'landlock-run: usage error: --rw requires a path\n',
    code: 125,
  })
  /**
   * 常量说明：missingGrant 用于处理 missingGrant 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const missingGrant = spawn(launcherPath(), ['--rw', '/dsh/missing', '--', 'touch', `${WORKSPACE}/never`], { cwd: WORKSPACE })
  expect(await collect(missingGrant)).toEqual({
    stdout: '',
    stderr: 'landlock-run: cannot open rule path: /dsh/missing: No such file or directory\n',
    code: 125,
  })
  expect(vfs.existsSync(`${WORKSPACE}/never`)).toBe(false)
  /**
   * 常量说明：missingCommand 用于处理 missingCommand 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const missingCommand = spawn(launcherPath(), ['--ro', '/', '--', 'not-a-program'], { cwd: WORKSPACE })
  expect(await collect(missingCommand)).toEqual({
    stdout: '',
    stderr: 'landlock-run: exec failed: No such file or directory\n',
    code: 125,
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('enforces every ShellFileSystem operation and virtual device edge', async () => {
  vfs.writeFileSync(`${HOME}/private.txt`, 'private\n')
  /**
   * 常量说明：invocation 用于处理 invocation 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const invocation = parseLandlockArguments([
    ...grantArgs({ readOnly: ['/dev'], readWrite: [WORKSPACE, '/dev/null'] }), '--', 'true',
  ])
  if (invocation.kind !== 'run') throw new Error('expected a confined run invocation')
  /**
   * 常量说明：guarded 用于处理 guarded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const guarded = await landlockFileSystem(hostFileSystem(), invocation, WORKSPACE)

  expect(await guarded.stat('/dev/null')).toEqual({ directory: false, size: 0, mtimeMs: 0 })
  expect(await guarded.stat('/dev')).toEqual({ directory: true, size: 0, mtimeMs: 0 })
  expect(await guarded.list('/dev')).toEqual([{ name: 'null', directory: false }])
  await expect(guarded.list('/dev/null')).rejects.toMatchObject({ code: 'ENOTDIR' })
  expect(await guarded.readText('/dev/null')).toBe('')
  await guarded.writeText('/dev/null', 'discarded')
  await expect(guarded.mkdir('/dev/null', false)).rejects.toMatchObject({ code: 'EEXIST' })
  await expect(guarded.remove('/dev/null', { recursive: false, force: false })).rejects.toMatchObject({ code: 'EACCES' })
  await expect(guarded.rename('/dev/null', `${WORKSPACE}/null`)).rejects.toMatchObject({ code: 'EACCES' })
  await expect(guarded.stat('/dev/null/child')).rejects.toMatchObject({ code: 'ENOTDIR' })
  await expect(guarded.writeText('/dev/null/child', 'not written')).rejects.toMatchObject({ code: 'ENOTDIR' })
  await expect(guarded.mkdir('/dev/null/child', true)).rejects.toMatchObject({ code: 'ENOTDIR' })
  expect(vfs.existsSync('/dev')).toBe(false)
  await expect(guarded.readText(`${HOME}/private.txt`)).rejects.toMatchObject({ code: 'EACCES' })

  await guarded.mkdir('created', false)
  await guarded.writeText('created/file', 'one')
  await guarded.writeText('created/file', ' two', true)
  expect(await guarded.readText(`${WORKSPACE}/created/file`)).toBe('one two')
  expect(await guarded.list(`${WORKSPACE}/created`)).toEqual([{ name: 'file', directory: false }])
  await guarded.rename('created/file', 'created/moved')
  await expect(guarded.rename('created/moved', '/dev/null')).rejects.toMatchObject({ code: 'EACCES' })
  await guarded.remove('created', { recursive: true, force: false })
  expect(vfs.existsSync(`${WORKSPACE}/created`)).toBe(false)
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('turns an unexpected virtual-launcher preparation failure into exit 125', async () => {
  /**
   * 常量说明：base 用于处理 base 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const base = hostFileSystem()
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const result = await LANDLOCK_EXECUTABLE.prepare(
    ['--ro', '/', '--', 'true'],
    {
      cwd: WORKSPACE,
      filesystem: { ...base, stat: () => Promise.reject(new Error('storage unavailable')) },
    },
  )
  expect(result).toEqual({
    kind: 'exit', exitCode: 125, stdout: '', stderr: 'landlock-run: Error: storage unavailable\n',
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ args, message }（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ args, message })，
 * 并按返回类型处理结果。
 */
it.each([
  { args: [], message: 'missing `-- <argv>...` command' },
  { args: ['--unknown', '--', 'true'], message: 'unknown argument: --unknown' },
  { args: ['--probe', '--'], message: '--probe takes no other arguments' },
  { args: ['--'], message: 'missing `-- <argv>...` command' },
  { args: ['--rw', '', '--', 'true'], message: 'cannot open rule path' },
])('rejects malformed Landlock argv before execution: $message', async ({ args, message }) => {
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = spawn(launcherPath(), args, { cwd: WORKSPACE })
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result = await collect(child)
  expect(result.code).toBe(LAUNCHER_FAILURE_EXIT)
  expect(result.stderr).toContain(message)
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('enforces read-only and workspace-write grants over the VFS', async () => {
  vfs.writeFileSync(`${HOME}/readable.txt`, 'visible\n')
  /**
   * 常量说明：readOnly 用于读取 Only 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const readOnly = spawn(launcherPath(), [
    ...grantArgs({ readOnly: ['/'], readWrite: ['/dev/null'] }),
    '--', 'bash', '-c', `cat ${HOME}/readable.txt; echo discarded > /dev/null; echo denied > ${WORKSPACE}/denied.txt`,
  ], { cwd: WORKSPACE })
  /**
   * 常量说明：strict 用于处理 strict 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const strict = await collect(readOnly)
  expect(strict.code).toBe(1)
  expect(strict.stdout).toBe('visible\n')
  expect(strict.stderr.toLowerCase()).toContain('permission denied')
  expect(vfs.existsSync(`${WORKSPACE}/denied.txt`)).toBe(false)

  /**
   * 常量说明：workspaceWrite 用于处理 workspaceWrite 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const workspaceWrite = spawn(launcherPath(), [
    ...grantArgs({ readOnly: ['/'], readWrite: ['/dev/null', '/tmp', WORKSPACE] }),
    '--', 'bash', '-c', `echo workspace > ${WORKSPACE}/allowed.txt; echo temporary > /tmp/temp.txt; cat /tmp/temp.txt`,
  ], { cwd: WORKSPACE })
  expect(await collect(workspaceWrite)).toEqual({ stdout: 'temporary\n', stderr: '', code: 0 })
  expect(vfs.readFileSync(`${WORKSPACE}/allowed.txt`, 'utf8')).toBe('workspace\n')
  expect(vfs.readFileSync(`${TMP}/temp.txt`, 'utf8')).toBe('temporary\n')
  expect(vfs.existsSync('/dev/null')).toBe(false)
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('normalizes relative grants and denies sibling-prefix escapes and unreadable paths', async () => {
  vfs.mkdirSync(`${WORKSPACE}/nested`)
  vfs.mkdirSync(`${WORKSPACE}-other`)
  vfs.writeFileSync(`${HOME}/private.txt`, 'private\n')
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = spawn(launcherPath(), [
    ...grantArgs({ readOnly: [WORKSPACE], readWrite: ['.'] }),
    '--', 'bash', '-c', `echo kept > nested/relative.txt; echo escaped > ${WORKSPACE}-other/escape.txt; cat ${HOME}/private.txt`,
  ], { cwd: WORKSPACE })
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result = await collect(child)
  expect(result.code).toBe(1)
  expect(result.stderr.toLowerCase()).toContain('permission denied')
  expect(vfs.readFileSync(`${WORKSPACE}/nested/relative.txt`, 'utf8')).toBe('kept\n')
  expect(vfs.existsSync(`${WORKSPACE}-other/escape.txt`)).toBe(false)
  expect(result.stdout).not.toContain('private')
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('treats trailing-slash grants as the same subtree', async () => {
  /**
   * 常量说明：invocation 用于处理 invocation 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const invocation = parseLandlockArguments(['--rw', '/tmp/', '--', 'true'])
  if (invocation.kind !== 'run') throw new Error('expected a confined run invocation')
  /**
   * 常量说明：guarded 用于处理 guarded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const guarded = await landlockFileSystem(hostFileSystem(), invocation, WORKSPACE)
  await guarded.writeText('/tmp/nested.txt', 'allowed')
  expect(vfs.readFileSync(`${TMP}/nested.txt`, 'utf8')).toBe('allowed')
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('presents the virtual device directory without storing it in the VFS', async () => {
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = spawn(launcherPath(), [
    ...grantArgs({ readOnly: ['/'], readWrite: ['/dev/null'] }),
    '--', 'bash', '-c', 'ls /dev; cat /dev/null',
  ], { cwd: WORKSPACE })
  expect(await collect(child)).toEqual({ stdout: 'null\n', stderr: '', code: 0 })
  expect(vfs.existsSync('/dev')).toBe(false)
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('requires both rename paths to be writable', async () => {
  vfs.writeFileSync(`${WORKSPACE}/source.txt`, 'kept\n')
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = spawn(launcherPath(), [
    ...grantArgs({ readOnly: ['/'], readWrite: [WORKSPACE] }),
    '--', 'mv', `${WORKSPACE}/source.txt`, `${HOME}/moved.txt`,
  ], { cwd: WORKSPACE })
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result = await collect(child)
  expect(result.code).toBe(1)
  expect(result.stderr.toLowerCase()).toContain('permission denied')
  expect(vfs.readFileSync(`${WORKSPACE}/source.txt`, 'utf8')).toBe('kept\n')
  expect(vfs.existsSync(`${HOME}/moved.txt`)).toBe(false)
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('keeps concurrent Landlock grants process-local', async () => {
  /**
   * 常量说明：strict 用于处理 strict 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const strict = spawn(launcherPath(), [
    ...grantArgs({ readOnly: ['/'], readWrite: ['/dev/null'] }),
    '--', 'bash', '-c', `sleep 0.02; echo denied > ${WORKSPACE}/strict.txt`,
  ], { cwd: WORKSPACE })
  /**
   * 常量说明：writable 用于处理 writable 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const writable = spawn(launcherPath(), [
    ...grantArgs({ readOnly: ['/'], readWrite: ['/dev/null', WORKSPACE] }),
    '--', 'bash', '-c', `echo allowed > ${WORKSPACE}/writable.txt`,
  ], { cwd: WORKSPACE })
  /**
   * 常量说明：strictResult、writableResult 用于处理 strictResult、writableResult 相关数据，
   * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const [strictResult, writableResult] = await Promise.all([collect(strict), collect(writable)])
  expect(strictResult.code).toBe(1)
  expect(strictResult.stderr.toLowerCase()).toContain('permission denied')
  expect(writableResult).toEqual({ stdout: '', stderr: '', code: 0 })
  expect(vfs.existsSync(`${WORKSPACE}/strict.txt`)).toBe(false)
  expect(vfs.readFileSync(`${WORKSPACE}/writable.txt`, 'utf8')).toBe('allowed\n')
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('carries a command through the real local subprocess service', async () => {
  /**
   * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const handle = spawnSubprocess({
    argv: ['bash', '-c', 'echo written > note.txt && cat note.txt'],
    cwd: WORKSPACE,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64_000 },
      stderr: { maxBytes: 64_000 },
    },
    graceMs: 3_000,
    env: {},
  })
  /**
   * 常量说明：outcome 用于处理 outcome 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const outcome = await handle.done
  expect(outcome).toEqual({ exitCode: 0, signal: null })
  expect(handle.collected.stdout?.readFrom(0).text).toBe('written\n')
  expect(vfs.readFileSync(`${WORKSPACE}/note.txt`, 'utf8')).toBe('written\n')
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('writes the caller-supplied standard input into the command', async () => {
  /**
   * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const handle = spawnSubprocess({
    argv: ['bash', '-c', 'grep -c ""'],
    cwd: WORKSPACE,
    stdio: {
      stdin: { data: 'one\ntwo\nthree\n' },
      stdout: { maxBytes: 64_000 },
      stderr: { maxBytes: 64_000 },
    },
    graceMs: 3_000,
    env: {},
  })
  await handle.done
  expect(handle.collected.stdout?.readFrom(0).text).toBe('3\n')
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('kills a running command through the service and reports the signal', async () => {
  /**
   * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const handle = spawnSubprocess({
    argv: ['bash', '-c', 'sleep 30; echo never'],
    cwd: WORKSPACE,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64_000 },
      stderr: { maxBytes: 64_000 },
    },
    graceMs: 3_000,
    env: {},
  })
  /**
   * 常量说明：started 用于处理 started 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const started = performance.now()
  handle.terminate()
  /**
   * 常量说明：outcome 用于处理 outcome 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const outcome = await handle.done
  expect(outcome.signal).toBe('SIGTERM')
  expect(outcome.exitCode).toBeNull()
  expect(handle.collected.stdout?.readFrom(0).text).toBe('')
  // The command settles on the signal, not on the interval it was waiting out:
  // a `sleep` that ignored the abort would hold this handle open for 30s.
  expect(performance.now() - started).toBeLessThan(5_000)
})
