/** Durable attachment vocabulary. @module @deepseek-ai/dsh-attachment/types */
/*
 * 文件职责：集中定义持久图片附件、上传输入、存储结果、部署限制和模型请求变体的数据类型。
 * 技术维度：使用TypeScript接口、字面量联合和品牌标识表达可序列化且不可混淆的附件数据。
 * 产品维度：让会话日志、附件后端和模型提供方共享同一套图片事实，避免传递主机路径或临时URL。
 * 逻辑维度：先定义媒体类型与持久引用，再定义准入限制和输入，最后定义请求图片策略与缓存版本。
 * 关键边界：attachmentId和variantId均为不透明品牌值；名称只用于显示；所有尺寸与字节必须来自已验证数据。
 * 新手阅读建议：先看ImageAttachmentRef理解会话保存什么，再看Save/Stored差异，最后读RequestImageAttachment派生字段。
 */

import type { AttachmentId, ImageVariantId } from './brand.ts'

export type { AttachmentId } from './brand.ts'

/** Raster image formats accepted by the version-one attachment path. */
/* 第一版附件流程接受的四种栅格图片MIME类型。 */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Durable, serializable reference to one immutable normalized image. */
/* 指向一个不可变规范化图片的持久可序列化引用。 */
export interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  /* 不透明存储标识，绝不是文件路径或带权限URL。 */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  /* 从持久字节验证得到的媒体类型。 */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  /* 持久编码字节的精确长度。 */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  /* 持久编码图片的固有像素宽度。 */
  width: number
  /** Intrinsic encoded height in pixels. */
  /* 持久编码图片的固有像素高度。 */
  height: number
  /** Optional display name stripped of local path information. */
  /* 已删除本地路径信息的可选显示名。 */
  name?: string
  /**
   * Input dimensions after applying EXIF orientation and before normalization
   * scaling. Present only when normalization reduced the image.
   */
  /* 仅规范化缩小时存在的、应用EXIF方向后的来源尺寸。 */
  originalDimensions?: {
    /* 缩小前用户可见宽度。 */
    width: number
    /* 缩小前用户可见高度。 */
    height: number
  }
}

/** Deployment-resolved limits used by upload admission and request buffering. */
/* 上传准入和请求缓冲共同使用的部署解析限制。 */
export interface ImageAttachmentLimits {
  /* 单张来源图片最大编码字节数。 */
  maxImageBytes: number
  /* 单条消息最大图片数量。 */
  maxImagesPerMessage: number
  /* 单条消息图片最大合计编码字节数。 */
  maxMessageImageBytes: number
  /* 单张图片最大固有像素总数。 */
  maxImagePixels: number
  /** Maximum intrinsic width and maximum intrinsic height in pixels for one image. */
  /* 单张图片宽和高分别允许的最大像素数。 */
  maxImageDimension: number
  /* 当前部署接受的图片媒体类型白名单。 */
  mediaTypes: readonly ImageMediaType[]
}

/** Base64-encoded image upload accompanying one wire request. */
/* 随线协议请求传入的Base64图片上传。 */
export interface EncodedImageAttachment {
  /** Declared media type, verified against the decoded bytes during admission. */
  /* 调用者声明的媒体类型，准入时会与解码字节核对。 */
  mediaType: ImageMediaType
  /** Canonical base64 encoding of the image bytes. */
  /* 图片字节的规范Base64编码。 */
  data: string
  /** Optional display name; it is never interpreted as a path. */
  /* 可选显示名，永远不按路径解释。 */
  name?: string
}

/** Request to validate and durably commit one image. */
/* 请求验证并持久提交一张图片的进程内输入。 */
export interface SaveImageAttachment {
  /* 完整编码图片字节。 */
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  /* 调用者声明且会与完整解码结果核对的媒体类型。 */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  /* 浏览器或提供方给出的可选显示名，永远不按路径解释。 */
  name?: string
}

/** Stored image bytes returned after reference and digest verification. */
/* 引用和摘要验证后返回的持久图片字节。 */
export interface StoredImageAttachment {
  /* 会话记录中的权威持久引用。 */
  ref: ImageAttachmentRef
  /* 经过摘要与引用事实验证的图片字节。 */
  data: Uint8Array
}

/** Deterministic request-image policy selected by one exact model route. */
/* 一个精确模型路由选择的确定性请求图片策略。 */
export interface ImageRequestPolicy {
  /** Maximum width multiplied by height after aspect-preserving projection. */
  /* 保持宽高比投影后允许的最大宽乘高。 */
  maxPixels: number
  /** Encoded-byte target before base64 expansion or Files API upload; the smallest quality-ladder output is kept when no quality fits. */
  maxBytes: number
}

/** Cached request version derived from one provider-independent normalized attachment. */
/* 从提供方无关规范化附件派生的缓存请求版本。 */
export interface RequestImageAttachment {
  /** Cache and upload-index key over the attachment id, policy, and fixed encoder parameters. */
  /* 覆盖附件标识、策略和固定编码参数的缓存及上传索引键。 */
  variantId: ImageVariantId
  /** Durable normalized attachment from which this request version was derived. */
  /* 当前请求版本的来源持久规范化附件。 */
  attachment: ImageAttachmentRef
  /** Encoded request bytes. */
  /* 模型请求实际发送或上传的编码字节。 */
  data: Uint8Array
  /* 请求字节的真实媒体类型。 */
  mediaType: ImageMediaType
  /* 请求字节的精确长度。 */
  bytes: number
  /* 请求图片宽度。 */
  width: number
  /* 请求图片高度。 */
  height: number
  /** Provider-compatible sample depth proven after request encoding. */
  /* 请求编码后证明与提供方兼容的8位采样深度。 */
  depth: 'uchar'
  /** Provider-compatible color space proven after request encoding. */
  /* 请求编码后证明与提供方兼容的sRGB色彩空间。 */
  space: 'srgb'
  /** Whether the encoded request version retains an alpha channel. */
  /* 编码请求版本是否保留透明通道。 */
  hasAlpha: boolean
}
