/** Local durable attachment backend rooted below `DSH_HOME`. @module @deepseek-ai/dsh-attachment-local */

/*
 * 【文件职责】实现 DSH_HOME 下的本地持久附件后端，按配置校验输入大小并提供图片及普通文件存储。
 */

import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
  SaveFileAttachment,
  SaveFileStreamAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { NormalizationPolicy } from './normalization.ts'
import { CompressionLimiter, compressionFailure } from './compression-limiter.ts'
import { commitPreparedImageFile, normalizedImagePath, prepareImageFile, readImageFile, validateImageFile } from './store.ts'
import {
  readFileStreamVerbatim, saveFileStreamVerbatim, saveFileVerbatim, storedFilePath,
} from './file-store.ts'
import { readRequestImageFile, requestImageVariantId } from './request-image.ts'

export { canPassThroughNormalization, normalizeImage } from './normalization.ts'
export type { NormalizedImage, NormalizationPolicy } from './normalization.ts'
export { commitPreparedImageFile, prepareImageFile, readImageFile, saveImageFile, validateImageFile } from './store.ts'
export type { PreparedImageFile } from './store.ts'
export { readRequestImageFile, requestImageVariantId } from './request-image.ts'

/** Default maximum encoded bytes for one submitted image; oversized sources are refused, not shrunk. */
/* 单张来源图片默认最大编码字节数，超过20 MiB会在规范化前拒绝。 */
export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** Default maximum images in one prompt. */
/* 单条提示默认最多包含20张图片。 */
export const DEFAULT_MAX_IMAGES_PER_MESSAGE = 20
/** Default maximum aggregate image bytes in one prompt. */
/* 单条提示全部来源图片默认最大合计字节数，为200 MiB。 */
export const DEFAULT_MAX_MESSAGE_IMAGE_BYTES = 200 * 1024 * 1024
/** Default maximum intrinsic pixels for one submitted image. */
/* 单张来源图片默认最大固有像素总数。 */
export const DEFAULT_MAX_IMAGE_PIXELS = 64_000_000
/** Default per-side pixel cap for one submitted image. */
/* 单张来源图片宽或高的默认最大像素数。 */
export const DEFAULT_MAX_IMAGE_DIMENSION = 8192
/**
 * Default total-pixel budget of the stored normalized image. A larger source
 * is admitted and downscaled proportionally, so admission bounds what rides
 * every later model request without refusing ordinary large sources; extreme
 * aspect ratios keep their short-edge resolution instead of collapsing under
 * a long-edge rule.
 */
export const DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS = 2048 * 2048
/** Default long-edge cap of the stored normalized image, applied after the total-pixel budget. */
export const DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION = 8192
/** Default encoded-byte target for one stored normalized image. */
export const DEFAULT_NORMALIZED_IMAGE_MAX_BYTES = 4 * 1024 * 1024
/** Conservative default number of simultaneous native image transformations per store. */
/* 每个存储实例默认同时执行两个原生图片转换任务。 */
export const DEFAULT_IMAGE_COMPRESSION_CONCURRENCY = 2
/** Maximum configurable native image transformations per store. */
/* 每个存储实例允许配置的最大原生图片转换并发数。 */
export const MAX_IMAGE_COMPRESSION_CONCURRENCY = 8

/** Local attachment backend configuration. */
/* 本地附件后端的部署配置，所有数值均在服务创建时解析。 */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  /* 显式 Harness 主目录；省略时依次使用 DSH_HOME 和 ~/.dsh。 */
  dshHome?: string
  /** Maximum encoded bytes accepted for one submitted image. Default: 20 MiB. */
  /* 单张提交图片允许的最大编码字节数。 */
  maxImageBytes?: number
  /** Maximum image count accepted in one submitted message. Default: 20. */
  /* 单条消息允许的最大图片数量。 */
  maxImagesPerMessage?: number
  /** Maximum aggregate encoded image bytes accepted in one submitted message. Default: 200 MiB. */
  /* 单条消息全部图片允许的最大合计字节数。 */
  maxMessageImageBytes?: number
  /** Maximum intrinsic width multiplied by height accepted for one submitted image. Default: 64,000,000. */
  /* 单张图片允许的最大固有宽高乘积。 */
  maxImagePixels?: number
  /** Maximum intrinsic width and maximum intrinsic height accepted for one submitted image. Default: 8192px. */
  /* 单张图片宽和高分别允许的最大像素数。 */
  maxImageDimension?: number
  /** Total-pixel budget of the stored provider-independent normalized image. */
  normalizedImageMaxPixels?: number
  /** Long-edge pixel cap of the stored provider-independent normalized image, applied after the total-pixel budget. */
  normalizedImageMaxDimension?: number
  /**
   * Encoded-byte target of the stored provider-independent normalized image;
   * the smallest quality-ladder output is kept when no quality fits.
   */
  normalizedImageMaxBytes?: number
  /** Maximum simultaneous normalization or request-image transformations in this service instance. */
  /* 当前服务实例同时执行规范化或请求图片转换的最大数量。 */
  imageCompressionConcurrency?: number
}

/**
 * 把 AbortSignal 的任意取消原因规范为 Error。
 * @param signal 已取消或即将读取原因的信号。
 * @returns 原因本身是 Error 时原样返回，否则包装为带 cause 的 Error。
 * @example throw abortReason(signal)
 */
function abortReason(signal: AbortSignal): Error {
  // 信号保存的原始取消原因，外部调用者可能提供非 Error 值。
  const reason: unknown = signal.reason
  return reason instanceof Error
    ? reason
    : new Error('Attachment request cancelled with a non-Error reason.', { cause: reason })
}

/** 让多个等待者共享一次转换，并在最后一个等待者取消时中止底层任务。 */
class SharedRequest<T> {
  /** 共享底层任务使用的专用取消控制器。 */
  readonly controller = new AbortController()
  /** 所有等待者观察的同一个底层结果 Promise。 */
  readonly promise: Promise<T>
  /** 底层 Promise 是否已经完成，用于避免完成后无意义中止。 */
  private settled = false
  /** 当前仍等待底层结果的调用者数量。 */
  private waiters = 0

  /**
   * 立即启动可取消的共享任务。
   * @param start 接收共享信号并返回底层结果的函数。
   * @example new SharedRequest(signal => transform(signal))
   */
  constructor(start: (signal: AbortSignal) => Promise<T>) {
    this.promise = start(this.controller.signal).finally(() => {
      this.settled = true
    })
  }

  /**
   * 等待共享结果，并只取消当前等待者。
   * @param signal 当前调用者可选的取消信号。
   * @returns 共享任务结果；当前等待者取消时拒绝。
   * @example await request.wait(signal)
   */
  wait(signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    this.waiters += 1
    if (signal === undefined) {
      return this.promise.finally(() => {
        this.release(false)
      })
    }
    // 防止成功、失败和取消分支重复减少同一个等待者计数。
    let released = false
    /** 释放当前等待者，并在需要时传播最后一个取消。 */
    const release = (cancelled: boolean): void => {
      if (released) return
      released = true
      this.release(cancelled, signal)
    }
    return new Promise<T>((resolve, reject) => {
      /** 当前调用者取消时释放等待者并用规范化原因拒绝。 */
      const abort = (): void => {
        release(true)
        reject(abortReason(signal))
      }
      signal.addEventListener('abort', abort, { once: true })
      void this.promise.then((value) => {
        signal.removeEventListener('abort', abort)
        release(false)
        resolve(value)
      }, (error: unknown) => {
        signal.removeEventListener('abort', abort)
        release(false)
        reject(compressionFailure(error))
      })
    })
  }

  /** 更新等待者计数，并在最后一个等待者取消时中止共享任务。 */
  private release(cancelled: boolean, signal?: AbortSignal): void {
    this.waiters -= 1
    if (cancelled && this.waiters === 0 && !this.settled && signal !== undefined) {
      this.controller.abort(abortReason(signal))
    }
  }
}

/** Persistent content-addressed local attachment store. */
/* 持久、内容寻址的本地附件服务，供会话和模型请求共享规范化图片。 */
export class LocalAttachmentStore extends AttachmentStore {
  /** Cordis 用于校验和填充本地附件部署配置的模式。 */
  static Config: z<Config> = z.object({
    dshHome: z.string(),
    maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
    maxImagesPerMessage: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_MESSAGE),
    maxMessageImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_IMAGE_BYTES),
    maxImagePixels: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_PIXELS),
    maxImageDimension: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_DIMENSION),
    normalizedImageMaxPixels: z.number().step(1).min(1).default(DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS),
    normalizedImageMaxDimension: z.number().step(1).min(1).default(DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION),
    normalizedImageMaxBytes: z.number().step(1).min(1).default(DEFAULT_NORMALIZED_IMAGE_MAX_BYTES),
    imageCompressionConcurrency: z.number().step(1).min(1).max(MAX_IMAGE_COMPRESSION_CONCURRENCY)
      .default(DEFAULT_IMAGE_COMPRESSION_CONCURRENCY),
  })

  /** Absolute versioned storage root. */
  /* 版本化附件存储的绝对根目录。 */
  readonly root: string
  /** 已解析并冻结的来源图片准入限制。 */
  readonly imageLimits: ImageAttachmentLimits
  /** Resolved provider-independent normalization policy. */
  /* 已解析并冻结的提供方无关规范化策略。 */
  readonly normalizationPolicy: Readonly<NormalizationPolicy>
  /** Resolved instance-level compression limit. */
  /* 当前实例最终采用的图片转换并发数。 */
  readonly imageCompressionConcurrency: number
  /** 对所有规范化和请求图片转换实施并发限制的调度器。 */
  private readonly compression: CompressionLimiter
  /** 变体标识到共享在途请求的映射，用于合并相同转换。 */
  private readonly requestInflight = new Map<string, SharedRequest<RequestImageAttachment>>()

  /**
   * 解析配置并创建本地附件存储服务。
   * @param ctx Cordis 服务上下文。
   * @param config 部署传入的附件限制与主目录配置。
   * @example new LocalAttachmentStore(ctx, {})
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.root = resolve(join(resolveDshHome(config.dshHome), 'attachments', 'v1'))
    this.imageLimits = Object.freeze({
      maxImageBytes: config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
      maxImagesPerMessage: config.maxImagesPerMessage ?? DEFAULT_MAX_IMAGES_PER_MESSAGE,
      maxMessageImageBytes: config.maxMessageImageBytes ?? DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
      maxImagePixels: config.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS,
      maxImageDimension: config.maxImageDimension ?? DEFAULT_MAX_IMAGE_DIMENSION,
      mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const),
    })
    this.normalizationPolicy = Object.freeze({
      maxPixels: config.normalizedImageMaxPixels ?? DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS,
      maxDimension: config.normalizedImageMaxDimension ?? DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
      maxBytes: config.normalizedImageMaxBytes ?? DEFAULT_NORMALIZED_IMAGE_MAX_BYTES,
    })
    // 配置缺失时采用保守默认值的最终并发数。
    const compressionConcurrency = config.imageCompressionConcurrency ?? DEFAULT_IMAGE_COMPRESSION_CONCURRENCY
    if (!Number.isSafeInteger(compressionConcurrency)
      || compressionConcurrency < 1
      || compressionConcurrency > MAX_IMAGE_COMPRESSION_CONCURRENCY) {
      throw new Error(
        `attachment-local: imageCompressionConcurrency must be an integer from 1 through ${MAX_IMAGE_COMPRESSION_CONCURRENCY}`,
      )
    }
    this.imageCompressionConcurrency = compressionConcurrency
    this.compression = new CompressionLimiter(compressionConcurrency)
  }

  /** 在并发限制内完整验证并证明单张图片可规范化。 */
  async validateImage(input: SaveImageAttachment): Promise<void> {
    await this.compression.run(() => validateImageFile(input, this.imageLimits, this.normalizationPolicy))
  }

  /** 原子准备整批图片后依次持久提交，避免部分准入失败留下会话引用。 */
  override async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    this.validateImageBatch(inputs)
    // 并发准备且尚未接触持久存储的规范化图片批次。
    const prepared = await Promise.all(inputs.map(input => this.compression.run(
      () => prepareImageFile(input, this.imageLimits, this.normalizationPolicy),
    )))
    // 按输入顺序收集成功持久化后的内容寻址引用。
    const refs: ImageAttachmentRef[] = []
    for (const image of prepared) refs.push(await commitPreparedImageFile(this.root, image))
    return refs
  }

  /** 准备并持久提交单张图片，返回内容寻址引用。 */
  async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    // 在并发限制内生成的规范化图片和引用事实。
    const prepared = await this.compression.run(
      () => prepareImageFile(input, this.imageLimits, this.normalizationPolicy),
    )
    return commitPreparedImageFile(this.root, prepared)
  }

  /** 从本地存储读取并验证一个持久图片引用。 */
  async readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    return readImageFile(this.root, ref, signal)
  }

  override imageHostPath(ref: ImageAttachmentRef): string {
    return normalizedImagePath(this.root, ref)
  }

  override async saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    return saveFileVerbatim(this.root, input)
  }

  override async saveFileStream(input: SaveFileStreamAttachment): Promise<FileAttachmentRef> {
    return saveFileStreamVerbatim(this.root, input)
  }

  override readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    return readFileStreamVerbatim(this.root, ref, signal)
  }

  override fileHostPath(ref: FileAttachmentRef): string {
    return storedFilePath(this.root, ref)
  }

  override async readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    return this.requestVersion(ref, policy, undefined, signal)
  }

  /** 合并同一变体的并发请求，并管理各等待者取消。 */
  private requestVersion(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    stored: StoredImageAttachment | undefined,
    signal: AbortSignal | undefined,
  ): Promise<RequestImageAttachment> {
    signal?.throwIfAborted()
    // 由来源附件和完整策略确定的请求图片变体标识。
    const variantId = requestImageVariantId(ref, policy)
    // 在途映射使用的稳定字符串键。
    const key = String(variantId)
    // 可能已由其他调用者启动的共享转换任务。
    let operation = this.requestInflight.get(key)
    if (operation?.controller.signal.aborted) {
      this.requestInflight.delete(key)
      operation = undefined
    }
    if (operation === undefined) {
      const shared = new SharedRequest<RequestImageAttachment>(sharedSignal => this.compression.run(async () => {
        const request = await readRequestImageFile(
          this.root,
          stored ?? await this.readImage(ref, sharedSignal),
          policy,
          sharedSignal,
        )
        return request
      }))
      operation = shared
      this.requestInflight.set(key, shared)
      void shared.promise.finally(() => {
        if (this.requestInflight.get(key) === shared) this.requestInflight.delete(key)
      }).catch(() => {})
    }
    return operation.wait(signal)
  }

}

export default LocalAttachmentStore
