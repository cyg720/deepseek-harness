/** Attachment failure class. @module @deepseek-ai/dsh-attachment/error */
/*
 * 文件职责：定义附件能力的稳定错误码、错误类和图片准入失败分类函数。
 * 技术维度：使用TypeScript字面量联合、只读Set和结构兼容检查跨包传递错误。
 * 产品维度：让协议层区分用户可修正的图片输入与存储内部故障，并返回稳定机器码。
 * 逻辑维度：集中列出准入错误码，扩展完整附件错误联合，构造AttachmentError，再执行运行时成员判断。
 * 关键边界：错误消息不得包含原始图片或主机路径；消费者按code路由，不依赖原型链。
 * 新手阅读建议：先看两层错误码联合，再看为何AttachmentError不继承HarnessError，最后读分类函数的结构检查。
 */

// 调用者可以通过修改图片内容或批次重新尝试的稳定错误码列表。
const IMAGE_ADMISSION_ERROR_CODES = [
  'TOO_MANY_IMAGES',
  'IMAGES_TOO_LARGE',
  'UNSUPPORTED_IMAGE_TYPE',
  'INVALID_IMAGE_BASE64',
  'INVALID_IMAGE',
  'IMAGE_TYPE_MISMATCH',
  'IMAGE_TOO_LARGE',
  'IMAGE_TOO_MANY_PIXELS',
  'IMAGE_DIMENSION_TOO_LARGE',
] as const

/** Caller-correctable attachment failure codes raised while admitting image input. */
/* 图片准入阶段由调用者修正输入即可解决的错误码。 */
export type ImageAdmissionErrorCode = typeof IMAGE_ADMISSION_ERROR_CODES[number]

/** Stable attachment failure codes used for protocol error routing. */
/* 协议错误路由使用的全部稳定附件错误码。 */
export type AttachmentErrorCode =
  | ImageAdmissionErrorCode
  | 'INVALID_ATTACHMENT_REF'
  | 'ATTACHMENT_CORRUPT'
  | 'ATTACHMENT_WRITE_FAILED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_READ_FAILED'
  | 'ATTACHMENT_PROJECTION_UNSUPPORTED'

/** Runtime membership for structurally compatible errors crossing package boundaries. */
/* 跨包结构兼容错误的图片准入码运行时集合。 */
const IMAGE_ADMISSION_ERROR_CODE_SET: ReadonlySet<string> = new Set(IMAGE_ADMISSION_ERROR_CODES)

/**
 * Stable failures suitable for host RPC error mapping.
 *
 * Deliberately re-implements the `HarnessError` shape instead of extending it:
 * the base lives in `@deepseek-ai/dsh-llm`, which itself depends on this
 * package (`ImageBlock` references `ImageAttachmentRef`), so sharing the base
 * would create a dependency cycle. Consumers route on `code`, never on the
 * prototype chain, so the shapes stay interchangeable at the wire boundary.
 */
/* 与HarnessError字段兼容但避免依赖循环的附件异常。 */
export class AttachmentError extends Error {
  /** Stable machine-routing failure code. */
  /* 供协议和宿主稳定路由的机器错误码。 */
  readonly code: AttachmentErrorCode

  /**
   * @param message - human-readable failure description without raw bytes or host paths.
   * @param code - stable machine-routing code.
   * @param options - optional chained cause.
   */
  /*
   * 创建带安全消息、稳定错误码和可选原因链的附件异常。
   * @param message 不含原始字节或主机路径的人类可读说明。
   * @param code 稳定机器路由码。
   * @param options 可选原因链。
   * @example new AttachmentError('Image is empty.', 'INVALID_IMAGE')
   */
  constructor(message: string, code: AttachmentErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AttachmentError'
    this.code = code
  }
}

/**
 * Distinguish caller-correctable image admission failures from storage faults.
 * @param error - failure raised while validating or persisting an image batch.
 * @returns whether the caller can correct the proposed image content or batch.
 */
export function isImageAdmissionError(
  error: unknown,
): error is AttachmentError & { readonly code: ImageAdmissionErrorCode } {
  return error instanceof Error
    && 'code' in error
    && typeof error.code === 'string'
    && IMAGE_ADMISSION_ERROR_CODE_SET.has(error.code)
}
