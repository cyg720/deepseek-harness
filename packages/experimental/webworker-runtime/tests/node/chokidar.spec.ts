/** Upstream Chokidar running unchanged through the shipped Worker module loader.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 chokidar spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lowerModuleSource } from '../../src/compile/transform.ts'
import { WorkerModuleLoader } from '../../src/module-system/module-loader.ts'
import { createNodeBuiltins } from '../../src/node/builtins.ts'
import { MemoryVfs } from '../../src/storage/memory.ts'
import { setActiveVfs } from '../../src/storage/active.ts'

/**
 * 常量说明：ROOT 用于处理 ROOT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ROOT = '/dsh/workspace/skills'
/**
 * 变量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let vfs: MemoryVfs
/**
 * 变量说明：chokidar 用于处理 chokidar 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let chokidar: typeof import('chokidar')
/**
 * 常量说明：openWatchers 用于打开 Watchers 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const openWatchers: import('chokidar').FSWatcher[] = []

interface ChokidarFixture {
  readonly label: string
  readonly consumerManifest: string
  readonly chokidarFiles: readonly string[]
  readonly readdirpFiles: readonly string[]
}

/**
 * 常量说明：CHOKIDAR_FIXTURES 用于处理 CHOKIDAR_FIXTURES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const CHOKIDAR_FIXTURES: readonly ChokidarFixture[] = [
  {
    label: 'Chokidar 4 from settings and credentials',
    consumerManifest: 'packages/settings/settings-file/package.json',
    chokidarFiles: ['package.json', 'esm/package.json', 'esm/index.js', 'esm/handler.js'],
    readdirpFiles: ['package.json', 'esm/package.json', 'esm/index.js'],
  },
  {
    label: 'Chokidar 5 from skill-filesystem',
    consumerManifest: 'packages/skill/skill-filesystem/package.json',
    chokidarFiles: ['package.json', 'index.js', 'handler.js'],
    readdirpFiles: ['package.json', 'index.js'],
  },
]

/** Copy one installed JavaScript package into the VFS exactly as the packer does.
 * @remarks 中文说明：功能说明：处理 packageRoot 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：entry（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 packageRoot(name, entry)，并按返回类型处理结果。 */
function packageRoot(name: string, entry: string): string {
  /**
   * 变量说明：directory 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let directory = dirname(entry);;) {
    /**
     * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      /**
       * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }
      if (parsed.name === name) return directory
    }
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`cannot locate package root for ${name}`)
    directory = parent
  }
}

/** Copy the package files selected by the packer's import condition.
 * @remarks 中文说明：功能说明：处理 mountPackage 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：directory（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：files（readonly
 * string[]）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 mountPackage(name, directory, files)，
 * 并按返回类型处理结果。 */
function mountPackage(name: string, directory: string, files: readonly string[]): void {
  /**
   * 变量说明：file 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const file of files) {
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = readFileSync(join(directory, file), 'utf8')
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = `/dsh/node_modules/${name}/${file}`
    vfs.seed(path, file.endsWith('.js') ? lowerModuleSource({ filename: path, source }).code : source)
  }
}

/** Load one consumer's exact Chokidar and readdirp versions through the Worker loader.
 * @remarks 中文说明：功能说明：加载 Chokidar 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：fixture（ChokidarFixture）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：typeof
 * import('chokidar')；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * loadChokidar(fixture)，并按返回类型处理结果。 */
function loadChokidar(fixture: ChokidarFixture): typeof import('chokidar') {
  /**
   * 常量说明：consumerManifest 用于处理 consumerManifest 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const consumerManifest = join(process.cwd(), fixture.consumerManifest)
  /**
   * 常量说明：chokidarEntry 用于处理 chokidarEntry 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const chokidarEntry = createRequire(consumerManifest).resolve('chokidar')
  /**
   * 常量说明：readdirpEntry 用于处理 readdirpEntry 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const readdirpEntry = createRequire(chokidarEntry).resolve('readdirp')
  mountPackage('chokidar', packageRoot('chokidar', chokidarEntry), fixture.chokidarFiles)
  mountPackage('readdirp', packageRoot('readdirp', readdirpEntry), fixture.readdirpFiles)
  /**
   * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const loader = new WorkerModuleLoader({ vfs, staticModules: createNodeBuiltins() })
  return loader.createRequire('/dsh/')('chokidar') as typeof import('chokidar')
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
beforeEach(() => {
  vfs = new MemoryVfs()
  setActiveVfs(vfs)
  vfs.mkdirSync(ROOT, { recursive: true })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(async () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：watcher（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(watcher)，并按返回类型处理结果。
   */
  await Promise.all(openWatchers.splice(0).map(async (watcher) => { await watcher.close() }))
})

/** Await one emitter event while rejecting hangs deterministically.
 * @remarks 中文说明：功能说明：处理 onceEvent 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：watcher（import('chokidar').FSWatcher）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：Promise<T>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 onceEvent(watcher, event)，
 * 并按返回类型处理结果。 */
function onceEvent<T>(watcher: import('chokidar').FSWatcher, event: string): Promise<T> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  return new Promise<T>((resolve, reject) => {
    /**
     * 常量说明：timeout 用于处理 timeout 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const timeout = setTimeout(() => { reject(new Error(`timed out waiting for chokidar ${event}`)) }, 2_000)
    /**
     * 常量说明：emitter 用于处理 emitter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const emitter = watcher as unknown as {
      /**
       * 功能说明：处理 once 相关流程；使用场景由所在模块及调用位置决定。
       * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param listener （(...args: unknown[]) => void）：接收后续状态或事件并执行调用方逻辑；
       * 必须满足声明的类型及调用时序要求。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 once(name, listener)，并按返回类型处理结果。
       */
      once(name: string, listener: (...args: unknown[]) => void): void
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：args（unknown[]）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(args)，并按返回类型处理结果。
     */
    emitter.once(event, (...args: unknown[]) => {
      clearTimeout(timeout)
      resolve(args[0] as T)
    })
  })
}

/** Let watcher timers and promise-based stats reach a stable point.
 * @remarks 中文说明：功能说明：处理 delay 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ms（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 delay(ms)，并按返回类型处理结果。 */
async function delay(ms: number): Promise<void> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
   */
  await new Promise<void>((resolve) => { setTimeout(resolve, ms) })
}

/** Construct one tracked watcher with deterministic event normalization.
 * @remarks 中文说明：功能说明：处理 watchPath 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（import('chokidar').ChokidarOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：import('chokidar').FSWatcher；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 watchPath(path, options)，并按返回类型处理结果。 */
function watchPath(path: string, options: import('chokidar').ChokidarOptions = {}): import('chokidar').FSWatcher {
  /**
   * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const watcher = chokidar.watch(path, {
    ignoreInitial: true,
    atomic: false,
    awaitWriteFinish: false,
    ...options,
  })
  openWatchers.push(watcher)
  return watcher
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：fixture（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(fixture)，并按返回类型处理结果。
 */
describe.each(CHOKIDAR_FIXTURES)('$label running unchanged', (fixture) => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  beforeEach(() => {
    chokidar = loadChokidar(fixture)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reaches ready and reports a file lifecycle through fs.watch', async () => {
    /**
     * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const watcher = watchPath(ROOT, { depth: 1 })
    await onceEvent(watcher, 'ready')

    /**
     * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const directory = `${ROOT}/sample`
    /**
     * 常量说明：file 用于处理 file 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const file = `${directory}/SKILL.md`
    /**
     * 常量说明：addDirectory 用于处理 addDirectory 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const addDirectory = onceEvent<string>(watcher, 'addDir')
    /**
     * 常量说明：addFile 用于处理 addFile 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const addFile = onceEvent<string>(watcher, 'add')
    vfs.mkdirSync(directory)
    vfs.writeFileSync(file, '# sample\n')
    await expect(addDirectory).resolves.toBe(directory)
    await expect(addFile).resolves.toBe(file)

    /**
     * 常量说明：changed 用于处理 changed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const changed = onceEvent<string>(watcher, 'change')
    vfs.writeFileSync(file, '# changed\n')
    await expect(changed).resolves.toBe(file)

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    /**
     * 常量说明：removed 用于处理 removed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const removed = onceEvent<string>(watcher, 'unlink')
    vfs.rmSync(file)
    await expect(removed).resolves.toBe(file)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('watches a missing file through its existing parent', async () => {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = '/dsh/home/settings.yaml'
    vfs.mkdirSync('/dsh/home', { recursive: true })
    /**
     * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const watcher = watchPath(path)
    await onceEvent(watcher, 'ready')

    /**
     * 常量说明：added 用于处理 added 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const added = onceEvent<string>(watcher, 'add')
    vfs.writeFileSync(path, 'theme: dark\n')
    await expect(added).resolves.toBe(path)

    /**
     * 常量说明：removed 用于处理 removed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const removed = onceEvent<string>(watcher, 'unlink')
    vfs.rmSync(path)
    await expect(removed).resolves.toBe(path)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('discovers directory children through watchFile polling mode', async () => {
    /**
     * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const watcher = watchPath(ROOT, { usePolling: true, interval: 5 })
    await onceEvent(watcher, 'ready')
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = `${ROOT}/standalone.md`
    /**
     * 常量说明：added 用于处理 added 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const added = onceEvent<string>(watcher, 'add')
    vfs.writeFileSync(path, '# standalone\n')
    await expect(added).resolves.toBe(path)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('normalizes a short unlink/add replacement into one atomic change', async () => {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = `${ROOT}/atomic.md`
    vfs.writeFileSync(path, 'before')
    /**
     * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const watcher = watchPath(path, { atomic: 40 })
    await onceEvent(watcher, 'ready')
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events: string[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    watcher.on('all', (event) => { events.push(event) })
    /**
     * 常量说明：changed 用于处理 changed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const changed = onceEvent<string>(watcher, 'change')
    vfs.rmSync(path)
    await delay(5)
    vfs.writeFileSync(path, 'after')
    await expect(changed).resolves.toBe(path)
    await delay(60)
    expect(events).toEqual(['change'])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('waits for a write burst to stabilize before publishing one add', async () => {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = `${ROOT}/settling.md`
    /**
     * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const watcher = watchPath(ROOT, {
      awaitWriteFinish: { stabilityThreshold: 30, pollInterval: 5 },
    })
    await onceEvent(watcher, 'ready')
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events: string[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    watcher.on('all', (event) => { events.push(event) })
    /**
     * 常量说明：added 用于处理 added 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const added = onceEvent<string>(watcher, 'add')
    vfs.writeFileSync(path, 'a')
    await delay(10)
    vfs.appendFileSync(path, 'b')
    await delay(10)
    vfs.appendFileSync(path, 'c')
    await expect(added).resolves.toBe(path)
    expect(events).toEqual(['add'])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('emits nothing after close has reached quiescence', async () => {
    /**
     * 常量说明：watcher 用于处理 watcher 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const watcher = watchPath(ROOT)
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events: string[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    watcher.on('all', (event) => { events.push(event) })
    await onceEvent(watcher, 'ready')
    await watcher.close()
    vfs.writeFileSync(`${ROOT}/after.md`, '# after\n')
    await Promise.resolve()
    expect(events).toEqual([])
  })
})
