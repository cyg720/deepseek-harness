/**
 * Browser-only host runtime: the harness Cordis tree inside a dedicated Web Worker.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 index 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
export {
  createAlsRuntime,
  type AlsCausality, type AlsRuntime, type AlsSnapshot, type AlsToken,
} from './polyfill/async-context/als-runtime.ts'
export {
  parseInboundFrame,
  type TunnelAbortFrame, type TunnelInboundFrame, type TunnelOutboundFrame, type TunnelRequestFrame,
  type TunnelRequestId, type TunnelResponseChunkFrame, type TunnelResponseEndFrame,
  type TunnelResponseErrorFrame, type TunnelResponseFrame, type TunnelResponseHeadFrame,
  type TunnelStreamEndFrame, type TunnelStreamErrorFrame, type TunnelStreamItemFrame,
  type TunnelStreamOpenFrame,
} from './transport/frames.ts'
export {
  DEFAULT_CONDITIONS, requireActiveModuleLoader, setActiveModuleLoader, WorkerModuleLoader,
  type Resolution, type StaticModuleFactory, type WorkerModuleLoaderOptions, type WorkerRequire,
} from './module-system/module-loader.ts'
export * as posixPath from './module-system/posix-path.ts'
export {
  createSyntheticExchange,
  type RequestListener, type ResponseSink, type SyntheticExchange,
} from './transport/synthetic-http.ts'
export { lowerModuleSource, type LoweredModule } from './compile/transform.ts'
export {
  API_PREFIX, SYNTHETIC_HOST, TunnelServer,
  type TunnelPort, type TunnelSeams, type TunnelServerOptions,
} from './transport/tunnel.ts'
export { installProcessGlobal, type ProcessShim, type ProcessShimOptions } from './node/globals/process.ts'
export {
  createWorkerHost, type WorkerHost, type WorkerHostOptions,
} from './worker-host.ts'
export {
  DEFAULT_ROOT, IMAGE_CONFIG_PATH, IMAGE_EMPTY_DIRECTORIES, IMAGE_FILE_NAME, IMAGE_HOME_DIRECTORY,
  IMAGE_MANIFEST_PATH, IMAGE_OVERLAY_DIRECTORIES, LOWERING_VERSION, WRAPPER_PARAMS,
} from './image-layout.ts'
export {
  parsePreviewFixtureManifest, PREVIEW_FIXTURE_MANIFEST_FILE, PREVIEW_FIXTURE_MANIFEST_VERSION,
  type PreviewFixtureManifest, type PreviewFixtureManifestEntry,
} from './fixture-manifest.ts'
export { loadVfsImage, loadVfsOverlay, MemoryVfs } from './storage/memory.ts'
export { inflateImage, inflateImageStream } from './storage/image-gzip.ts'
export { packTar, parseTar, type TarEntry } from './storage/tar.ts'
export { requireActiveVfs, setActiveVfs } from './storage/active.ts'
export {
  type VfsDir, type VfsDirent, type VfsEncoding, type VfsError, type VfsFileHandle,
  type VfsReadOptions, type VfsStats, type VfsWriteOptions,
} from './storage/types.ts'
