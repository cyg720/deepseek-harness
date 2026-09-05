/*
 * 【文件职责】提供浏览器连接 Worker 主机所需的启动胶水，在 Cordis 插件图加载前安装传输全局和启动注入。
 */

import { IMAGE_FILE_NAME } from '../image-layout.ts'
import type { ClientFileUploadHooks } from '@deepseek-ai/dsh-client-file-upload/types'
import { PREVIEW_FIXTURE_MANIFEST_FILE } from '../fixture-manifest.ts'
import { WorkerTunnel, type TunnelFetch } from './client.ts'
import { applyIndexInjections } from './apply-injections.ts'
import { choosePreviewSource } from './source-chooser.ts'

export { WorkerTunnel, type TunnelFetch } from './client.ts'
export { applyIndexInjections } from './apply-injections.ts'
export { IMAGE_FILE_NAME } from '../image-layout.ts'
export {
  parsePreviewFixtureManifest, PREVIEW_FIXTURE_MANIFEST_FILE, PREVIEW_FIXTURE_MANIFEST_VERSION,
  type PreviewFixtureManifest, type PreviewFixtureManifestEntry,
} from '../fixture-manifest.ts'

/** Transport global the connection plugin reads instead of building an HTTP carrier. */
interface ClientTransportGlobal {
  __DSH_TRANSPORT__?: {
    fetch: TunnelFetch
    openStream: (endpoint: string, payload: unknown, signal: AbortSignal) => AsyncIterable<unknown>
    loadBundle: (url: string) => Promise<void>
    /** The page spawned the worker the Host runs in, so the page owns it. */
    ownsHost: boolean
  }
}

/** Upload hook consumed by the independent Client file-upload service. */
interface ClientFileUploadGlobal {
  __DSH_FILE_UPLOAD__?: ClientFileUploadHooks
}

/** Inputs for {@link connectWorkerHost}. */
export interface WorkerHostConnectOptions {
  /**
   * VFS image URL, the one deployment-shaped input. Defaults to
   * {@link IMAGE_FILE_NAME} beside the page; a deployment that packs the
   * image elsewhere passes its own URL. Data overlays are independent.
   */
  readonly image?: string | URL
  /** Ordered data overlay URLs, resolved against the page like the base image. */
  readonly overlays?: readonly (string | URL)[]
}

/** Inputs for the optional pre-boot filesystem-source chooser. */
export interface WorkerHostSourceOptions {
  /** Base VFS image URL; defaults to {@link IMAGE_FILE_NAME} beside the page. */
  readonly image?: string | URL
  /** Fixture catalog URL; defaults to {@link PREVIEW_FIXTURE_MANIFEST_FILE} beside the image. */
  readonly fixtureManifest?: string | URL
}

/** Filesystem inputs selected before {@link connectWorkerHost}. */
export interface WorkerHostSource {
  /** Ordered data overlays to pass through unchanged to the Host connection. */
  readonly overlays: readonly URL[]
}

/** A page connected to a worker-hosted harness, ready to run a shell entry. */
export interface WorkerHostConnection {
  readonly worker: Worker
  readonly tunnel: WorkerTunnel
  /** Bundle transport for the shell's boot seam.
   * @remarks 中文说明：功能说明：加载 Bundle 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：url（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 loadBundle(url)，
   * 并按返回类型处理结果。 */
  loadBundle(url: string): Promise<void>
}

/** Boot-readiness deferred shared with the client entry's pre-boot await. */
interface BootReadyGlobal {
  __DSH_BOOT_READY__?: PromiseWithResolvers<void>
}

/**
 * 功能说明：处理 bootReadyGate 相关流程；使用场景由所在模块及调用位置决定。
 * @returns PromiseWithResolvers<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 bootReadyGate()，并按返回类型处理结果。
 */
function bootReadyGate(): PromiseWithResolvers<void> {
  return (globalThis as BootReadyGlobal).__DSH_BOOT_READY__ ??= Promise.withResolvers<void>()
}

/**
 * Install the page boot barrier before an asynchronous source chooser waits
 * for user input. The later {@link connectWorkerHost} call settles the same
 * barrier.
 * @remarks 中文说明：功能说明：处理 holdWorkerHostBoot 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 holdWorkerHostBoot()，
 * 并按返回类型处理结果。
 */
function holdWorkerHostBoot(): void {
  /**
   * 常量说明：ready 用于处理 ready 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ready = bootReadyGate()
  // A chooser may remain open indefinitely; if a later connection fails before
  // the stock entry subscribes, retain the rejection without browser noise.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  void ready.promise.catch(() => {})
}

/**
 * Run the optional pre-boot source-selection stage. Calling this stage holds
 * the stock shell until the caller passes its result to {@link connectWorkerHost};
 * callers that need no chooser call `connectWorkerHost` directly and receive
 * the base image with an empty overlay list.
 * @param options - Base image and optional fixture-catalog locations.
 * @returns The ordered overlays selected by the user.
 * @remarks 中文说明：功能说明：处理 chooseWorkerHostSource 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（WorkerHostSourceOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<WorkerHostSource>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 chooseWorkerHostSource(options)，并按返回类型处理结果。
 */
export async function chooseWorkerHostSource(
  options: WorkerHostSourceOptions = {},
): Promise<WorkerHostSource> {
  holdWorkerHostBoot()
  /**
   * 常量说明：image 用于处理 image 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const image = new URL(options.image ?? IMAGE_FILE_NAME, document.baseURI)
  /**
   * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const manifest = new URL(options.fixtureManifest ?? PREVIEW_FIXTURE_MANIFEST_FILE, image)
  /**
   * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    /**
     * 常量说明：overlays 用于处理 overlays 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const overlays = await choosePreviewSource(manifest)
    return { overlays }
  } catch (reason) {
    bootReadyGate().reject(reason)
    throw reason
  }
}

/**
 * Connect a spawned host worker and complete the pre-Cordis handshake.
 *
 * The caller constructs the Worker so its bundler resolves the bundle URL
 * statically; the opening `init` frame then carries the base image and ordered
 * overlay locations.
 *
 * Order is fixed by the web boot protocol: the transport global must exist
 * before any bundle executes; the injection table then reproduces the served
 * boot rows — the `__ModuleLoader__` registration queue, the parser-preload
 * bundles, `__DSH_BOOT__`, the theme bootstrap — in table order. The
 * boot-readiness deferred (`__DSH_BOOT_READY__`) is installed before the
 * first await and settles with the handshake, so a client entry evaluating
 * concurrently in the same document holds at its pre-boot await until every
 * row has taken effect, and surfaces a failed handshake instead of
 * proceeding on missing globals.
 * @param worker - The host worker.
 * @param options - Base-image and overlay location overrides.
 * @returns The connection; hand `loadBundle` to the shell entry's boot seam.
 * @remarks 中文说明：功能说明：处理 connectWorkerHost 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：worker（Worker）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（WorkerHostConnectOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<WorkerHostConnection>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 connectWorkerHost(worker, options)，并按返回类型处理结果。
 */
export async function connectWorkerHost(worker: Worker, options?: WorkerHostConnectOptions): Promise<WorkerHostConnection> {
  /**
   * 常量说明：ready 用于处理 ready 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ready = bootReadyGate()
  // The handshake may fail before any entry awaits the promise; this no-op
  // subscription keeps that from surfacing as an unhandled rejection.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  void ready.promise.catch(() => {})
  /**
   * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    /**
     * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tunnel = new WorkerTunnel(worker)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：overlay（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(overlay)，并按返回类型处理结果。
     */
    tunnel.init(
      new URL(options?.image ?? IMAGE_FILE_NAME, document.baseURI).href,
      (options?.overlays ?? []).map(overlay => new URL(overlay, document.baseURI).href),
    )
    /**
     * 常量说明：payload 用于处理 payload 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const payload = await tunnel.bootPayload()
    ;(globalThis as ClientTransportGlobal).__DSH_TRANSPORT__ = {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：input（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：init（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(input,
       * init)，并按返回类型处理结果。
       */
      fetch: (input, init) => tunnel.fetch(input, init),
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：endpoint（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：payload（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
       * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
       * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
       * 匿名回调(endpoint, payload, signal)，并按返回类型处理结果。
       */
      openStream: (endpoint, payload, signal) => tunnel.open(endpoint, payload, signal),
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：url（string）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
       * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(url)，并按返回类型处理结果。
       */
      loadBundle: (url: string) => tunnel.loadBundle(url),
      // The host lives in a worker this page spawned: the page owns it, so
      // the privileged surface stays reachable off loopback authorities.
      ownsHost: true,
    }
    ;(globalThis as ClientFileUploadGlobal).__DSH_FILE_UPLOAD__ = {
      fetch: (input, init) => tunnel.fetch(input, init),
    }
    await applyIndexInjections(payload.injections, src => tunnel.loadBundle(src))
    ready.resolve()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：url（string）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(url)，并按返回类型处理结果。
     */
    return { worker, tunnel, loadBundle: (url: string) => tunnel.loadBundle(url) }
  } catch (reason) {
    ready.reject(reason)
    throw reason
  }
}
