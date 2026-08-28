/**
 * Image layout contract shared by the packer and the worker host: the virtual
 * root, where the composed config and the manifest sit inside the image, and
 * the working directories every image carries empty. One definition, two
 * consumers — the packer writes this layout, the worker host mounts it.
 */

/** Default virtual root; the runtime mounts the image here unless told otherwise.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 image layout
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：DEFAULT_ROOT 用于处理 DEFAULT_ROOT 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const DEFAULT_ROOT = '/dsh'

/**
 * Leaf name of the packed base image: one gzip member holding the ustar archive.
 * The app build writes it beside the page and the page's boot fetches it from
 * there, so the extension is part of what a deployment serves.
 * @remarks 中文说明：常量说明：IMAGE_FILE_NAME 用于处理 IMAGE_FILE_NAME 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const IMAGE_FILE_NAME = 'vfs-image.tar.gz'

/** Image path the composed profile is written to; the runtime's Loader reads it.
 * @remarks 中文说明：常量说明：IMAGE_CONFIG_PATH 用于处理 IMAGE_CONFIG_PATH 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const IMAGE_CONFIG_PATH = 'config/cordis.yml'

/** Image path of the manifest the runtime reads before it wraps a single module.
 * @remarks 中文说明：常量说明：IMAGE_MANIFEST_PATH 用于处理 IMAGE_MANIFEST_PATH 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const IMAGE_MANIFEST_PATH = 'config/vfs-manifest.json'

/** Home directory under the root; the process shim's `DSH_HOME`/`HOME` default.
 * @remarks 中文说明：常量说明：IMAGE_HOME_DIRECTORY 用于处理 IMAGE_HOME_DIRECTORY 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const IMAGE_HOME_DIRECTORY = 'home'

/** Working directories the host tree expects to exist, empty.
 * @remarks 中文说明：常量说明：IMAGE_EMPTY_DIRECTORIES 用于处理 IMAGE_EMPTY_DIRECTORIES
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const IMAGE_EMPTY_DIRECTORIES: readonly string[] = ['home/', 'workspace/', 'tmp/']

/**
 * Top-level directories an overlay archive may populate. Runtime code,
 * configuration, and the lowering manifest remain owned by the base image.
 * @remarks 中文说明：常量说明：IMAGE_OVERLAY_DIRECTORIES 用于处理
 * IMAGE_OVERLAY_DIRECTORIES 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const IMAGE_OVERLAY_DIRECTORIES: readonly string[] = ['home', 'workspace']

/**
 * Identity of the lowered code shape, recorded in the image manifest by the
 * packer and required by the worker host: an image lowered by an older transform
 * would otherwise run against newer wrapper semantics. Bump on any change to
 * emitted code or to {@link WRAPPER_PARAMS}.
 * @remarks 中文说明：常量说明：LOWERING_VERSION 用于处理 LOWERING_VERSION 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const LOWERING_VERSION = 'dsh-worker-transform/1'

/**
 * Free variables a lowered body expects from its wrapper, in order.
 *
 * Part of the image layout rather than of the transform, because the loader
 * wraps bodies it never parses: the packer emits against these names and the
 * worker binds them, with no compiler in the worker bundle to agree with.
 * @remarks 中文说明：常量说明：WRAPPER_PARAMS 用于处理 WRAPPER_PARAMS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const WRAPPER_PARAMS = [
  'exports', 'require', 'module', '__filename', '__dirname', '__dsh$meta', '__als',
] as const
