/**
 * Full-corpus import gate: every built bundle in the workspace —
 * `packages/<group>/<package>/lib/index.js` and `vendor/<package>/lib/index.js`
 * — must be importable by Node's ESM loader. A bundle that stops importing (a
 * stray `.css` import, an emitted module Node cannot parse, a dependency that
 * throws at module scope) is reported by name.
 *
 * Baseline exemptions are a pinned list, not a count: an unlisted import
 * failure is a real finding (a bundle that stopped being importable), and it
 * must not hide inside a total. A listed file that becomes importable also
 * fails, so the list cannot rot.
 *
 * Cost: this walks the whole build output and imports every bundle serially in
 * one process, so it takes minutes on loaded runners and needs
 * `pnpm run build:lib:host` to have run. It is a heavyweight suite, not part
 * of a default aggregator run.
 *
 * Run: tsx tests/compile/transform-corpus-check.ts [files...]
 * With no arguments it discovers the corpus itself.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 transform corpus
 * check 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 常量说明：repositoryRoot 用于处理 repositoryRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

/**
 * Files Node's ESM loader cannot import in this repository. None is a finding:
 * each is listed with the reason the import fails, and the run refuses a
 * listed file that imports cleanly so the list stays current in both
 * directions. The koffi entry depends on corpus order: sandbox-windows-acl
 * imports the win32-process package earlier in the serial sweep (a distinct
 * module instance under its node_modules URL), so win32-process's own file-URL
 * import re-registers koffi's type names and fails as the second load.
 * @remarks 中文说明：常量说明：BASELINE_EXEMPT 用于处理 BASELINE_EXEMPT 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const BASELINE_EXEMPT: ReadonlyMap<string, string> = new Map([
  ['packages/client/ui-primitives/lib/index.js', 'imports .css, which bare Node cannot load'],
  ['packages/client/web/lib/index.js', 'imports .css, which bare Node cannot load'],
  ['packages/subprocess/win32-process/lib/index.js', 'koffi type-name collision on a second load'],
  ['packages/test-support/client-runtime/lib/index.js', "needs vitest's internal state"],
])

/**
 * 变量说明：failures 用于处理 failures 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let failures = 0
/**
 * 常量说明：report 用于处理 report 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const report: string[] = []
/**
 * 常量说明：log 用于处理 log 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 log 相关流程；使用场景由所在模块及调用位置决定。
 * @param line （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 log(line)，并按返回类型处理结果。
 */
const log = (line: string): void => {
  report.push(line)
  process.stdout.write(`${line}\n`)
}
/**
 * 常量说明：fail 用于处理 fail 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。
 * @param line （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 fail(line)，并按返回类型处理结果。
 */
const fail = (line: string): void => {
  failures += 1
  log(line)
}

/** @returns Built bundles under a two-level package directory, in stable order.
 * @remarks 中文说明：功能说明：处理 discover 相关流程；使用场景由所在模块及调用位置决定。；返回值：string[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 discover()，并按返回类型处理结果。 */
function discover(): string[] {
  /**
   * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const found: string[] = []
  /** @returns Sorted subdirectory names, or none when the path is not a readable directory.
   * @remarks 中文说明：常量说明：subdirectories 用于处理 subdirectories 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。；功能说明：处理 subdirectories 相关流程；
   * 使用场景由所在模块及调用位置决定。；参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 返回值：string[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * subdirectories(path)，并按返回类型处理结果。 */
  const subdirectories = (path: string): string[] => {
    try {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
       */
      return readdirSync(path, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
    } catch {
      return []
    }
  }
  /**
   * 变量说明：group 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const group of ['packages', 'vendor']) {
    /**
     * 常量说明：groupDirectory 用于处理 groupDirectory 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const groupDirectory = join(repositoryRoot, group)
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of subdirectories(groupDirectory)) {
      // `packages/<group>/<package>/lib/index.js`, `vendor/<package>/lib/index.js`.
      /**
       * 常量说明：candidates 用于处理 candidates 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
       */
      const candidates = group === 'vendor'
        ? [join(groupDirectory, entry, 'lib', 'index.js')]
        : subdirectories(join(groupDirectory, entry))
          .map(child => join(groupDirectory, entry, child, 'lib', 'index.js'))
      /**
       * 变量说明：candidate 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const candidate of candidates) {
        try {
          if (statSync(candidate).isFile()) found.push(candidate)
        } catch {
          // No bundle for this package: it may not build a runtime artifact.
        }
      }
    }
  }
  return found
}

/**
 * @returns Path relative to the repository root, for stable diagnostics.
 * Always POSIX-separated: the exemption table keys on one form, and a win32
 * walk would otherwise miss every entry.
 * @remarks 中文说明：常量说明：relative 用于处理 relative 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。；功能说明：处理 relative 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 relative(path)，并按返回类型处理结果。
 */
const relative = (path: string): string => path.slice(repositoryRoot.length).replaceAll('\\', '/')

/**
 * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
 * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，
 * 并按返回类型处理结果。
 */
const files = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map(path => (path.startsWith('/') ? path : join(process.cwd(), path)))
  : discover()

if (files.length === 0) {
  process.stdout.write('transform-corpus-check: no built bundles found; run `pnpm run build:lib:host` first\n')
  process.exitCode = 1
} else {
  /**
   * 常量说明：verdicts 用于处理 verdicts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const verdicts = { ok: 0, exempt: 0, unexpectedBaseline: 0 }

  /**
   * 变量说明：file 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const file of files) {
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = relative(file)
    /**
     * 常量说明：exemption 用于处理 exemption 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const exemption = BASELINE_EXEMPT.get(key)
    /**
     * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      await import(pathToFileURL(file).href)
    } catch (reason) {
      if (exemption === undefined) {
        // A bundle that stopped being importable is a real finding, so it
        // fails rather than joining a tolerated total.
        fail(`- UNEXPECTED BASELINE FAILURE ${key}: ${(reason as Error).message.split('\n')[0]}`)
        verdicts.unexpectedBaseline += 1
      } else {
        verdicts.exempt += 1
      }
      continue
    }
    if (exemption !== undefined) {
      // The exemption list must stay honest in the other direction too: a file
      // that became importable should leave the list.
      fail(`- STALE EXEMPTION ${key}: imports fine now (${exemption}); remove it from BASELINE_EXEMPT`)
      continue
    }
    verdicts.ok += 1
  }

  log('')
  log(`files=${String(files.length)} ok=${String(verdicts.ok)} baselineExempt=${String(verdicts.exempt)} `
    + `unexpectedBaselineFailure=${String(verdicts.unexpectedBaseline)}`)

  process.stdout.write(failures === 0
    ? `\ntransform-corpus-check: ${String(verdicts.ok)} bundles import under Node, `
      + `${String(verdicts.exempt)} exempt\n`
    : `\ntransform-corpus-check: ${String(failures)} finding(s)\n`)
  process.exitCode = failures === 0 ? 0 : 1
}
