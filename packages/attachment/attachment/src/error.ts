/** Attachment failure class. @module @deepseek-ai/dsh-attachment/error */


// 调用者可以通过修改图片内容或批次重新尝试的稳定错误码列表。

/*
 * 【文件职责】集中定义稳定的附件错误码和错误类型，供上传准入、存储及 RPC 错误路由共同使用。
 */

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

const ATTACHMENT_ERROR_CODES = [
  ...IMAGE_ADMISSION_ERROR_CODES,
  'INVALID_FILE_BASE64',
  'INVALID_ATTACHMENT_REF',
  'ATTACHMENT_CORRUPT',
  'ATTACHMENT_WRITE_FAILED',
  'ATTACHMENT_NOT_FOUND',
  'ATTACHMENT_READ_FAILED',
  'ATTACHMENT_PROJECTION_UNSUPPORTED',
  'ATTACHMENT_FILES_UNSUPPORTED',
] as const

/** Stable attachment failure codes used for protocol error routing. */
export type AttachmentErrorCode = typeof ATTACHMENT_ERROR_CODES[number]

/** Runtime membership for structurally compatible errors crossing package boundaries. */
/* 跨包结构兼容错误的图片准入码运行时集合。 */
const IMAGE_ADMISSION_ERROR_CODE_SET: ReadonlySet<string> = new Set(IMAGE_ADMISSION_ERROR_CODES)
const ATTACHMENT_ERROR_CODE_SET: ReadonlySet<string> = new Set(ATTACHMENT_ERROR_CODES)

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
 * Identify attachment failures by their stable code across duplicate package installations.
 * @param error - failure raised while validating, persisting, or reading an attachment.
 * @returns whether the failure carries a recognized attachment error code.
 */
export function isAttachmentError(error: unknown): error is AttachmentError {
  return error instanceof Error
    && 'code' in error
    && typeof error.code === 'string'
    && ATTACHMENT_ERROR_CODE_SET.has(error.code)
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
