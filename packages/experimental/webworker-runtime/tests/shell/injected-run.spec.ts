/**
 * The two run options a command inside a process worker supplies: the
 * filesystem it acts on, and the callback that reports output before the run
 * settles. `src/shell/process/child.ts` passes a message-backed filesystem and
 * posts a frame per write, so both are load-bearing for every backgrounded
 * command the bash tool starts.
 *
 * No VFS is mounted here, deliberately. The in-host filesystem reads the
 * process-wide slot on first use, so a program that reached it instead of the
 * injected face fails with `no filesystem is mounted` — a suite that mounted a
 * VFS as well would pass either way.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 injected run spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import { runShellCommand } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/interpret.ts'
import { filesystemError } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/fs-access.ts'
import type {
  ShellDirent, ShellFileSystem, ShellRunOutcome, ShellStats,
} from '@deepseek-ai/dsh-experimental-webworker-runtime/src/shell/types.ts'

/**
 * 常量说明：WORKSPACE 用于处理 WORKSPACE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const WORKSPACE = '/dsh/workspace'

/** One call a program made on the injected filesystem. */
interface Call {
  readonly op: string
  readonly path: string
  readonly text?: string
  readonly append?: boolean
}

/**
 * A filesystem over a flat map of absolute paths, recording every call.
 *
 * Directories are the parents of the files it holds, which is all the programs
 * below ask about; nothing here reaches the mounted VFS.
 * @remarks 中文说明：功能说明：处理 recordingFileSystem 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：files（Record<string, string>）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 返回值：{ fs: ShellFileSystem calls: Call[] contents: Map<string, string> }；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * recordingFileSystem(files)，并按返回类型处理结果。
 */
function recordingFileSystem(files: Record<string, string>): {
  fs: ShellFileSystem
  calls: Call[]
  contents: Map<string, string>
} {
  /**
   * 常量说明：contents 用于处理 contents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const contents = new Map(Object.entries(files))
  /**
   * 常量说明：calls 用于处理 calls 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const calls: Call[] = []
  /**
   * 常量说明：directories 用于处理 directories 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 directories 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Set<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 directories()，并按返回类型处理结果。
   */
  const directories = (): Set<string> => {
    /**
     * 常量说明：known 用于处理 known 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const known = new Set<string>()
    /**
     * 变量说明：path 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const path of contents.keys()) {
      /**
       * 变量说明：parent 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (let parent = path.slice(0, path.lastIndexOf('/')); parent !== ''; parent = parent.slice(0, parent.lastIndexOf('/'))) {
        known.add(parent)
      }
    }
    return known
  }
  /**
   * 常量说明：fs 用于处理 fs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<ShellStats | undefined>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<ShellDirent[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；参数：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数：append（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path,
   * text, append)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；参数：recursive（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path,
   * recursive)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：from（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：to（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(from,
   * to)，并按返回类型处理结果。
   */
  const fs: ShellFileSystem = {
    stat: async (path: string): Promise<ShellStats | undefined> => {
      calls.push({ op: 'stat', path })
      /**
       * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const text = contents.get(path)
      if (text !== undefined) return { directory: false, size: text.length, mtimeMs: 1 }
      return directories().has(path) ? { directory: true, size: 0, mtimeMs: 1 } : undefined
    },
    list: async (path: string): Promise<ShellDirent[]> => {
      calls.push({ op: 'list', path })
      if (!directories().has(path)) throw filesystemError('ENOENT', 'scandir', path)
      /**
       * 常量说明：prefix 用于处理 prefix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const prefix = `${path}/`
      /**
       * 常量说明：names 用于处理 names 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const names = new Set<string>()
      /**
       * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const candidate of [...contents.keys(), ...directories()]) {
        if (!candidate.startsWith(prefix)) continue
        names.add(candidate.slice(prefix.length).split('/')[0] as string)
      }
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
       */
      return [...names].sort().map(name => ({ name, directory: directories().has(`${prefix}${name}`) }))
    },
    readText: async (path: string): Promise<string> => {
      calls.push({ op: 'readText', path })
      /**
       * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const text = contents.get(path)
      if (text === undefined) throw filesystemError('ENOENT', 'open', path)
      return text
    },
    writeText: async (path: string, text: string, append = false): Promise<void> => {
      calls.push({ op: 'writeText', path, text, append })
      contents.set(path, append ? `${contents.get(path) ?? ''}${text}` : text)
    },
    mkdir: async (path: string, recursive: boolean): Promise<void> => {
      calls.push({ op: 'mkdir', path, append: recursive })
    },
    remove: async (path: string): Promise<void> => {
      calls.push({ op: 'remove', path })
      contents.delete(path)
    },
    rename: async (from: string, to: string): Promise<void> => {
      calls.push({ op: 'rename', path: from, text: to })
      /**
       * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const text = contents.get(from)
      if (text === undefined) throw filesystemError('ENOENT', 'rename', from)
      contents.delete(from)
      contents.set(to, text)
    },
  }
  return { fs, calls, contents }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('injected filesystem', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reads through the injected face, at the path the shell resolved', async () => {
    /**
     * 常量说明：fs、calls 用于处理 fs、calls 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { fs, calls } = recordingFileSystem({ [`${WORKSPACE}/notes.txt`]: 'alpha\nbeta\n' })
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await runShellCommand('cat notes.txt', { cwd: WORKSPACE, env: {}, fs })
    expect(result).toEqual({ exitCode: 0, stdout: 'alpha\nbeta\n', stderr: '' })
    // Programs receive the word as written; the absolute path is the shell's work.
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    expect(calls.filter(call => call.op === 'readText').map(call => call.path)).toEqual([`${WORKSPACE}/notes.txt`])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('performs a redirection as a truncating write followed by appends', async () => {
    /**
     * 常量说明：fs、calls、contents 用于处理 fs、calls、contents 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { fs, calls, contents } = recordingFileSystem({})
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await runShellCommand('echo one > out.txt; echo two >> out.txt', { cwd: WORKSPACE, env: {}, fs })
    expect(result.exitCode).toBe(0)
    expect(contents.get(`${WORKSPACE}/out.txt`)).toBe('one\ntwo\n')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：call（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(call)，并按返回类型处理结果。
     */
    expect(calls.filter(call => call.op === 'writeText').map(call => [call.text, call.append])).toEqual([
      // `> file` empties the file when the redirection is set up, so a command
      // that writes nothing still leaves it empty.
      ['', false],
      ['one\n', true],
      ['two\n', true],
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports an injected failure as the utility does, not as a filesystem error', async () => {
    /**
     * 常量说明：fs 用于处理 fs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { fs } = recordingFileSystem({})
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await runShellCommand('cat missing.txt', { cwd: WORKSPACE, env: {}, fs })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('cat: missing.txt: No such file or directory\n')
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('incremental output', () => {
  /** Run a line, collecting what the callback saw in order.
   * @remarks 中文说明：功能说明：处理 reported 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：command（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<{ seen:
   * [string, string][]; outcome: ShellRunOutcome }>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；使用示例：典型用法：在完成前置校验后调用 reported(command)，并按返回类型处理结果。 */
  async function reported(command: string): Promise<{ seen: [string, string][]; outcome: ShellRunOutcome }> {
    /**
     * 常量说明：fs 用于处理 fs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { fs } = recordingFileSystem({ [`${WORKSPACE}/notes.txt`]: 'alpha\n' })
    /**
     * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const seen: [string, string][] = []
    /**
     * 常量说明：outcome 用于处理 outcome 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：stream（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：text（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(stream, text)，并按返回类型处理结果。
     */
    const outcome = await runShellCommand(command, {
      cwd: WORKSPACE,
      env: {},
      fs,
      onOutput: (stream, text) => { seen.push([stream, text]) },
    })
    return { seen, outcome }
  }

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports each write as it happens and still returns the complete text', async () => {
    /**
     * 常量说明：seen、outcome 用于处理 seen、outcome 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { seen, outcome } = await reported('echo one; echo two')
    expect(seen).toEqual([['stdout', 'one\n'], ['stdout', 'two\n']])
    expect(outcome.stdout).toBe('one\ntwo\n')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('tags a diagnostic as standard error', async () => {
    /**
     * 常量说明：seen、outcome 用于处理 seen、outcome 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { seen, outcome } = await reported('definitely-not-a-program')
    expect(seen).toEqual([['stderr', 'bash: definitely-not-a-program: command not found\n']])
    expect(outcome).toEqual({ exitCode: 127, stdout: '', stderr: 'bash: definitely-not-a-program: command not found\n' })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports only what the line writes out, not what it hands along or captures', async () => {
    // A pipeline stage writes into the next stage's input and a redirection
    // writes into a file: neither is output of the line, so a caller polling for
    // progress must not see it.
    /**
     * 常量说明：piped 用于处理 piped 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const piped = await reported('cat notes.txt | cat')
    expect(piped.seen).toEqual([['stdout', 'alpha\n']])
    /**
     * 常量说明：redirected 用于处理 redirected 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const redirected = await reported('echo captured > out.txt')
    expect(redirected.seen).toEqual([])
    expect(redirected.outcome.stdout).toBe('')
  })
})
