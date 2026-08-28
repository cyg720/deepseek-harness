/**
 * End-to-end spec of the packer's actual product: an image this package builds must
 * mount in the runtime's VFS and be `require`-able by the runtime's module loader,
 * which holds no transform of its own.
 *
 * That last part is the point. "It boots" only proves nothing crashed; the loader
 * wraps module bodies exactly as the image holds them, so the pack-time pass is the
 * only thing that can make them wrappable. The refusal case is the positive
 * evidence: restore one un-lowered body and the same setup fails loud.
 *
 * A small synthetic composition rather than the real profile: packing the full
 * closure takes tens of seconds. The path under test — compose, materialize,
 * transform, tar, compress, inflate, mount, require — is the same one.
 *
 * ONE module instance: every runtime import here goes through `src/`, because the VFS
 * and the active loader are module-level slots. The "starts with nothing loaded"
 * case asserts the instance the spec holds is the one that did the work.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-packer 中 image loadable
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FiberState } from '@deepseek-ai/cordis'
import { createNodeBuiltins, REPLACED_PREFIXES } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/node/builtins.ts'
import {
  setActiveModuleLoader, WorkerModuleLoader,
} from '@deepseek-ai/dsh-experimental-webworker-runtime/src/module-system/module-loader.ts'
import { inflateImage } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/image-gzip.ts'
import { loadVfsImage } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/memory.ts'
import { setActiveVfs } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/active.ts'
import { indexWorkspacePackages, previewFixtures } from '../src/repository.ts'
import { DEFAULT_ROOT, MANIFEST_PATH, packVfsImage, packVfsOverlay } from '../src/pack.ts'

/**
 * 常量说明：repoRoot 用于处理 repoRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

/** A leaf workspace package: real build output, no dependencies to drag in.
 * @remarks 中文说明：常量说明：SUBJECT 用于处理 SUBJECT 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const SUBJECT = '@deepseek-ai/dsh-timeout'
/**
 * 常量说明：LANDLOCK 用于处理 LANDLOCK 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const LANDLOCK = '@deepseek-ai/node-addon-landlock-run'
/**
 * 常量说明：PLUGIN_INVENTORY 用于处理 PLUGIN_INVENTORY 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const PLUGIN_INVENTORY = '@deepseek-ai/dsh-plugin-package-inventory-deepseek'
/**
 * 常量说明：WEB_SERVER 用于处理 WEB_SERVER 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const WEB_SERVER = '@deepseek-ai/dsh-host-webserver'

/**
 * 常量说明：workspaces 用于处理 workspaces 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const workspaces = indexWorkspacePackages(repoRoot)

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('preview example overlays', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('packs source-looking paths and dot directories into a separate overlay', () => {
    /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fixture = previewFixtures(repoRoot)[0]
    expect(fixture?.id).toBe('vfs-example')
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = packVfsOverlay(fixture?.trees ?? [])
    expect(new TextDecoder().decode(result.files['workspace/src/preview.ts']))
      .toContain("previewStatus = 'ready'")
    expect(new TextDecoder().decode(result.files['workspace/.agents/skills/preview-tour/SKILL.md']))
      .toContain('name: preview-tour')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，
     * 并按返回类型处理结果。
     */
    expect(Object.keys(result.files).filter(path => path.endsWith('/session.jsonl'))).toHaveLength(3)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('fails loud when a declared seed tree is absent', () => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => packVfsOverlay([
      { mount: 'workspace', directory: join(repoRoot, 'missing-preview-seed') },
    ])).toThrow(/tree workspace is missing/)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses overlays that could replace runtime files', () => {
    /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fixture = previewFixtures(repoRoot)[0]
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => packVfsOverlay([
      { mount: 'config', directory: fixture?.trees[0]?.directory ?? repoRoot },
    ])).toThrow(/must stay under home or workspace/)
  })
})

/**
 * The pack consumes built `lib/` output. An unbuilt checkout (the unit
 * coverage lane runs before any build) self-skips. Native Windows routes this
 * suite through its post-build uninstrumented gate, and preview builds exercise
 * the same path against complete real artifacts.
 * @remarks 中文说明：常量说明：subjectBuilt 用于处理 subjectBuilt 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const subjectBuilt = existsSync(join(repoRoot, 'packages/util/timeout/lib/index.js'))

/**
 * 变量说明：memo 用于处理 memo 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let memo: ReturnType<typeof packVfsImage> | undefined
/**
 * 常量说明：packed 用于处理 packed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 packed 相关流程；使用场景由所在模块及调用位置决定。
 * @returns ReturnType<typeof packVfsImage>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 packed()，并按返回类型处理结果。
 */
const packed = (): ReturnType<typeof packVfsImage> => memo ??= packVfsImage({
  // The composition's own shape: one entry per plugin, `name:` on its own line.
  config: `- id: subject\n  name: '${SUBJECT}'\n`,
  profile: 'image-loadable-check',
  workspaces,
  resolveFrom: repoRoot,
  // Synthetic composition: nothing boots the worker assembly, so its default
  // image entries must not be demanded of this one-package closure.
  entries: [],
})

/**
 * 变量说明：landlockMemo 用于处理 landlockMemo 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let landlockMemo: ReturnType<typeof packVfsImage> | undefined
/**
 * 常量说明：packedLandlock 用于处理 packedLandlock 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 packedLandlock 相关流程；使用场景由所在模块及调用位置决定。
 * @returns ReturnType<typeof packVfsImage>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 packedLandlock()，并按返回类型处理结果。
 */
const packedLandlock = (): ReturnType<typeof packVfsImage> => landlockMemo ??= packVfsImage({
  config: `- id: subject\n  name: '${LANDLOCK}'\n`,
  profile: 'landlock-package-check',
  workspaces,
  resolveFrom: repoRoot,
  entries: [],
})

/**
 * 变量说明：pluginInventoryMemo 用于处理 pluginInventoryMemo 相关数据，作用于当前作用域；
 * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let pluginInventoryMemo: ReturnType<typeof packVfsImage> | undefined
/**
 * 常量说明：packedPluginInventory 用于处理 packedPluginInventory 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 packedPluginInventory 相关流程；使用场景由所在模块及调用位置决定。
 * @returns ReturnType<typeof packVfsImage>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 packedPluginInventory()，并按返回类型处理结果。
 */
const packedPluginInventory = (): ReturnType<typeof packVfsImage> => pluginInventoryMemo ??= packVfsImage({
  config: `- id: subject\n  name: '${PLUGIN_INVENTORY}'\n`,
  profile: 'plugin-inventory-check',
  workspaces,
  resolveFrom: repoRoot,
  entries: [],
})

/**
 * 变量说明：webServerMemo 用于处理 webServerMemo 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let webServerMemo: ReturnType<typeof packVfsImage> | undefined
/**
 * 常量说明：packedWebServer 用于处理 packedWebServer 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 packedWebServer 相关流程；使用场景由所在模块及调用位置决定。
 * @returns ReturnType<typeof packVfsImage>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 packedWebServer()，并按返回类型处理结果。
 */
const packedWebServer = (): ReturnType<typeof packVfsImage> => webServerMemo ??= packVfsImage({
  config: `- id: subject\n  name: '${WEB_SERVER}'\n`,
  profile: 'webserver-dependency-check',
  workspaces,
  resolveFrom: repoRoot,
  entries: [],
})

/** The image's archive, inflated once: mounting reads the tar, not the gzip member.
 * @remarks 中文说明：变量说明：archiveMemo 用于处理 archiveMemo 相关数据，作用于当前作用域；
 * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
let archiveMemo: Uint8Array | undefined
/**
 * 常量说明：archive 用于处理 archive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 archive 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<Uint8Array>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 archive()，并按返回类型处理结果。
 */
const archive = async (): Promise<Uint8Array> =>
  archiveMemo ??= await inflateImage(packed().image, 'the image this spec packed')

;/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
(subjectBuilt ? describe : describe.skip)('packed image', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('materializes the roster with every dependency resolved', () => {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = packed()
    expect(workspaces.has(SUBJECT)).toBe(true)
    expect(result.roster).toEqual([SUBJECT])
    expect(result.packages.has(SUBJECT)).toBe(true)
    expect(result.missing).toEqual([])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('records the wrapper contract in the manifest and rewrote what it visited', () => {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = packed()
    expect(Object.hasOwn(result.files, MANIFEST_PATH)).toBe(true)
    /**
     * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const manifest = JSON.parse(new TextDecoder().decode(result.files[MANIFEST_PATH])) as { lowered: string }
    expect(manifest.lowered).toBe(result.contract)
    expect(result.transform.rewritten).toBeGreaterThan(0)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('names every JavaScript entry for the debugger, workspace files by repository path', () => {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = packed()
    /**
     * 常量说明：decoder 用于处理 decoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const decoder = new TextDecoder()
    /**
     * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
     */
    const entries = Object.keys(result.files).filter(name => /\.[cm]?js$/.test(name))
    expect(entries.length).toBeGreaterThan(0)
    /**
     * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const name of entries) {
      /**
       * 常量说明：lines 用于处理 lines 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const lines = decoder.decode(result.files[name]).split('\n')
      // V8 stacks and DevTools read the trailing comment, so worker
      // `new Function` bodies and page blobs alike show under a stable name
      // instead of as anonymous VM or blob entries.
      expect(lines.at(-1)).toMatch(/^\/\/# sourceURL=\S+$/)
      // A dangling map reference would make the debugger report one load
      // failure per named script; the packer ships no `.map` files.
      expect(lines.at(-2) ?? '').not.toContain('sourceMappingURL')
    }
    // A workspace entry is named by the path a reader navigates in this
    // repository, not by its image mount.
    /**
     * 常量说明：subject 用于处理 subject 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const subject = decoder.decode(result.files[`node_modules/${SUBJECT}/lib/index.js`])
    expect(subject.endsWith('\n//# sourceURL=packages/util/timeout/lib/index.js')).toBe(true)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('writes one gzip member whose header records no build facts', () => {
    /**
     * 常量说明：image 用于处理 image 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const image = packed().image
    // RFC 1952 §2.3: magic, deflate, then the flag byte — no FNAME (0x08) or
    // FCOMMENT, a zero modification time, and "unknown" for the packing system.
    expect([...image.slice(0, 4)]).toEqual([0x1f, 0x8b, 0x08, 0x00])
    expect([...image.slice(4, 8)]).toEqual([0, 0, 0, 0])
    expect(image[9]).toBe(255)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('packs the same tree to the same bytes', () => {
    // The preview build compares a freshly packed image against the shipped one,
    // so anything the compressor takes from its environment would read as a
    // changed tree.
    /**
     * 常量说明：again 用于处理 again 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const again = packVfsImage({
      config: `- id: subject\n  name: '${SUBJECT}'\n`,
      profile: 'image-loadable-check',
      workspaces,
      resolveFrom: repoRoot,
      entries: [],
    })
    expect(Buffer.from(again.image).equals(Buffer.from(packed().image))).toBe(true)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('mounts and requires through the real loader, which carries no transform', async () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = loadVfsImage(await archive(), DEFAULT_ROOT)
    expect(vfs.existsSync(`${DEFAULT_ROOT}/node_modules/${SUBJECT}/lib/index.js`)).toBe(true)

    /**
     * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const loader = new WorkerModuleLoader({
      vfs,
      root: DEFAULT_ROOT,
      staticModules: createNodeBuiltins(),
      staticModulePrefixes: REPLACED_PREFIXES,
    })
    // The loader this spec reads counters from must be the one that did the
    // requiring; a second instance would report an empty cache trivially.
    expect(loader.usage().modules).toBe(0)

    /**
     * 常量说明：required 用于处理 required 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const required = loader.requireFrom(`${DEFAULT_ROOT}/workspace`)(SUBJECT) as Record<string, unknown>
    expect(typeof required.timeoutOf).toBe('function')
    expect(loader.usage().modules).toBeGreaterThan(0)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps third-party runtime JavaScript published under src', async () => {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = packedWebServer()
    expect(result.missing).toEqual([])
    expect(Object.hasOwn(result.files, 'node_modules/debug/src/index.js')).toBe(true)
    expect(Object.hasOwn(result.files, 'node_modules/ms/index.js')).toBe(true)

    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = loadVfsImage(await inflateImage(result.image, 'the packed webserver'), DEFAULT_ROOT)
    /**
     * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const loader = new WorkerModuleLoader({
      vfs,
      root: DEFAULT_ROOT,
      staticModules: createNodeBuiltins(),
      staticModulePrefixes: REPLACED_PREFIXES,
    })
    setActiveVfs(vfs)
    setActiveModuleLoader(loader)
    /**
     * 常量说明：webserver 用于处理 webserver 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const webserver = loader.requireFrom(`${DEFAULT_ROOT}/workspace`)(WEB_SERVER) as { WebServer?: unknown }
    expect(typeof webserver.WebServer).toBe('function')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('runs the unchanged Landlock entry package over the Worker platform executable', async () => {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = packedLandlock()
    expect(workspaces.has(LANDLOCK)).toBe(true)
    expect(result.packages.has(LANDLOCK)).toBe(true)
    expect(result.missing).toEqual([])
    expect(Object.hasOwn(result.files, `node_modules/${LANDLOCK}/lib/index.js`)).toBe(true)
    expect(createNodeBuiltins()[LANDLOCK]).toBeUndefined()

    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = loadVfsImage(await inflateImage(result.image, 'the packed Landlock package'), DEFAULT_ROOT)
    /**
     * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const loader = new WorkerModuleLoader({
      vfs,
      root: DEFAULT_ROOT,
      staticModules: createNodeBuiltins(),
      staticModulePrefixes: REPLACED_PREFIXES,
    })
    setActiveVfs(vfs)
    setActiveModuleLoader(loader)
    /**
     * 常量说明：landlock 用于处理 landlock 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const landlock = loader.requireFrom(`${DEFAULT_ROOT}/workspace`)(LANDLOCK) as {
      LAUNCHER_BIN: string
      LAUNCHER_FAILURE_EXIT: number
      /**
       * 功能说明：处理 launcherPath 相关流程；使用场景由所在模块及调用位置决定。
       * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 launcherPath()，并按返回类型处理结果。
       */
      launcherPath(): string
      /**
       * 功能说明：处理 grantArgs 相关流程；使用场景由所在模块及调用位置决定。
       * @param grants （{ readOnly?: readonly string[]; readWrite?: readonly
       * string…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 grantArgs(grants)，并按返回类型处理结果。
       */
      grantArgs(grants: { readOnly?: readonly string[]; readWrite?: readonly string[] }): string[]
      /**
       * 功能说明：处理 probe 相关流程；使用场景由所在模块及调用位置决定。
       * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 probe()，并按返回类型处理结果。
       */
      probe(): string
    }

    expect(landlock.LAUNCHER_BIN).toBe('landlock-run')
    expect(landlock.LAUNCHER_FAILURE_EXIT).toBe(125)
    expect(landlock.grantArgs({ readOnly: ['/'], readWrite: ['/tmp'] })).toEqual([
      '--ro', '/', '--rw', '/tmp',
    ])
    expect(landlock.launcherPath()).toBe(
      `${DEFAULT_ROOT}/node_modules/${LANDLOCK}/node_modules/${LANDLOCK}-${process.platform}-${process.arch}/bin/landlock-run`,
    )
    expect(landlock.probe()).toBe('full')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('prepares the unchanged plugin-package inventory through Worker createRequire paths', async () => {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = packedPluginInventory()
    expect(result.missing).toEqual([])

    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = loadVfsImage(await inflateImage(result.image, 'the packed plugin inventory'), DEFAULT_ROOT)
    /**
     * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const loader = new WorkerModuleLoader({
      vfs,
      root: DEFAULT_ROOT,
      staticModules: createNodeBuiltins(),
      staticModulePrefixes: REPLACED_PREFIXES,
    })
    setActiveVfs(vfs)
    setActiveModuleLoader(loader)
    /**
     * 常量说明：inventory 用于处理 inventory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inventory = loader.requireFrom(`${DEFAULT_ROOT}/workspace`)(PLUGIN_INVENTORY) as {
      /**
       * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
       * @param ctx （unknown）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
       * @param config （unknown）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 apply(ctx, config)，并按返回类型处理结果。
       */
      apply(ctx: unknown, config: unknown): void
    }

    type Prepared = { readonly value: { readonly version: number; readonly packages: readonly unknown[] } }
    type Prepare = (request: { readonly body: object; readonly signal: AbortSignal }) => Promise<Prepared>
    /**
     * 变量说明：prepare 用于处理 prepare 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let prepare: Prepare | undefined
    /**
     * 常量说明：baseUrl 用于处理 baseUrl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const baseUrl = `file://${DEFAULT_ROOT}/config/cordis.yml`
    /**
     * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 entries 相关流程；使用场景由所在模块及调用位置决定。
     * @returns readonly unknown[]；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 entries()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const tree: { readonly ctx: { readonly baseUrl: string }; entries(): readonly unknown[] } = {
      ctx: { baseUrl },
      entries: () => [entry],
    }
    /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entry = {
      options: { name: PLUGIN_INVENTORY },
      disabled: false,
      fiber: { state: FiberState.ACTIVE },
      parent: { tree },
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：field（string）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；参数：contribution（{ readonly prepare: Prepare
     * }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(field, contribution)，并按返回类型处理结果。
     */
    inventory.apply({
      baseUrl,
      loader: tree,
      deepseekLlmApiExtensions: {
        register: (field: string, contribution: { readonly prepare: Prepare }): void => {
          expect(field).toBe('dsh_plugin_packages')
          prepare = contribution.prepare
        },
      },
    }, {})

    if (prepare === undefined) throw new Error('packed plugin inventory did not register its request contribution')
    /**
     * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prepared = await prepare({ body: {}, signal: new AbortController().signal })
    /**
     * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const manifest = JSON.parse(vfs.readFileSync(
      `${DEFAULT_ROOT}/node_modules/${PLUGIN_INVENTORY}/package.json`, 'utf8',
    ) as string) as { version: string }
    expect(prepared.value).toEqual({
      version: 1,
      packages: [{ name: PLUGIN_INVENTORY, version: manifest.version }],
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses a body the packer did not lower, naming the image', async () => {
    // The case above only proves the packed bytes are wrappable. This is the
    // other half: the loader has no transform to fall back on, so an entry the
    // collector missed must fail loud against the image rather than boot.
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = loadVfsImage(await archive(), DEFAULT_ROOT)
    vfs.seed(
      `${DEFAULT_ROOT}/node_modules/${SUBJECT}/lib/index.js`,
      new TextEncoder().encode('export const timeoutOf = () => 0\n'),
    )
    /**
     * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const loader = new WorkerModuleLoader({
      vfs,
      root: DEFAULT_ROOT,
      staticModules: createNodeBuiltins(),
      staticModulePrefixes: REPLACED_PREFIXES,
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => loader.requireFrom(`${DEFAULT_ROOT}/workspace`)(SUBJECT))
      .toThrow(/still carries module syntax, so the image was not lowered by the packer/)
  })
})
