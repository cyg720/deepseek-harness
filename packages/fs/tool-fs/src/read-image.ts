/**
 * ================================ 文件注释 ================================
 * 【文件职责】面向模型的 read_image 工具：提交一个 PNG/JPEG/WebP/GIF 文件为持久
 * attachment，并把图片本身作为工具结果的一部分返回（模型可看）。
 * 【技术维度】defineTool 注册：execute 流程 = 扩展名门（只收四种类型）→ attachment
 * 服务存在性/媒体类型门 → 路由图像能力门（当前模型必须声明 image 输入）→ 解析
 * 目标 → readBytes（双字节上限）→ attachments.saveImage 持久化（失败按错误码给出
 * 可恢复的提示）→ 发 observed → 返回结构化值；展示层把值投影成"文本信封 + 图片块"。
 * 【产品维度】让模型直接查看图片文件（无需安装图像库或手工建缩略图）：harness 会
 * 在下次模型请求前校验并降采样大图；模型须支持图像输入。
 * 【逻辑维度】按出现顺序：IMAGE_EXTENSIONS（扩展名→媒体类型表）→ IMAGE_VALUE_SCHEMA
 * → ImageReadValue（输出结构）→ imageMediaTypeForPath → assertImageCapableRoute
 * （路由门）→ imageRefFromValue（结构化值 → attachment 引用）→ formatImageReadOutput
 * （信封文本）→ imageReadContent（内容块）→ applyReadImageTool（注册）。
 * 【关键边界】路由门刻意比宿主上传预检更严：读图工具只在"确切调用路由能检查其结果"
 * 时有用，未知能力直接拒绝，而不是等文件系统与 attachment 工作做完后靠适配器失败；
 * 所有门在任何文件系统 I/O 之前执行（拒绝不泄漏部分读取或 attachment 写入）；
 * saveImage 失败按错误码转成可恢复工具错误（超大图/过多像素/16 位 PNG/类型不匹配）。
 * 【新手阅读建议】先看 execute 的四个门顺序，再看 saveImage 失败分支的映射表，
 * 最后看 imageReadContent 的"文本 + 图片"双块结果。
 * ==========================================================================
 */
/**
 * The model-facing `read_image` tool commits a PNG/JPEG/WebP/GIF file.
 *
 * The route gate is deliberately stricter than the host upload preflight. An
 * image-reading tool is useful only when the exact calling route can inspect
 * its result, so unknown capability refuses instead of relying on an adapter
 * failure after filesystem and attachment work.
 * @module @deepseek-ai/dsh-tool-fs/src/read-image
 */
/*
 * 模块总览：本文件是 read_image 工具的定义与执行体。它依赖附件服务（attachments）
 * 持久提交图片字节，因此只在有附件存储的组装里注册。
 */

import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { resolveRegularReadTarget } from './read-target.ts'

/** Extensions `read_image` accepts; magic-byte validation at the attachment service stays authoritative. */
/*
 * read_image 接受的扩展名 → 媒体类型表；附件服务里的魔数（magic byte）校验仍是
 * 权威判定（扩展名只是声明）。
 */
const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

// read_image 输出 schema 里的 image 对象结构（附件 id、媒体类型、尺寸、字节数等）。
const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
} as const

/** The structured outcome declared by the `read_image` output schema. */
/* read_image 输出 schema 声明的结构化结果。 */
export interface ImageReadValue {
  path: string
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
    /** Orientation-applied file dimensions before normalization; present only when storage reduced it. */
    /* 归一化前的"已应用朝向"文件尺寸；仅当存储层降采样过才存在。 */
    originalDimensions?: {
      width: number
      height: number
    }
  }
}

/**
 * Map a model-supplied path to its declared image media type by extension.
 * @param filePath - the raw `file_path` argument (not yet resolved).
 * @returns the declared media type, or undefined when the path does not claim an image.
 */
/*
 * 按扩展名把模型提供的路径映射成声明的图片媒体类型。
 * @param filePath 原始 file_path 参数（尚未解析）。
 * @returns 声明的媒体类型；路径不声称是图片时为 undefined。
 */
export function imageMediaTypeForPath(filePath: string): ImageMediaType | undefined {
  return IMAGE_EXTENSIONS[extname(filePath).toLowerCase()]
}

/**
 * Enforce the strict image-capability gate for the calling route. Resolves the
 * session's latest routed provider/model (request header config, then agent
 * options) and requires the exact resolved route to declare `image` input explicitly.
 * @param ctx - the plugin context used to resolve the optional `llm` service.
 * @param exec - the tool-execution context supplying the calling agent.
 * @param requestedPath - the raw, not-yet-resolved path rendered in refusal messages.
 */
/*
 * 对调用路由强制执行"图像能力门"：解析会话的最新路由 provider/model（请求头配置，
 * 然后 agent 选项），要求确切解析出的路由显式声明支持 image 输入。
 * @param ctx 用于解析可选 llm 服务的插件上下文。
 * @param exec 提供调用 agent 的工具执行上下文。
 * @param requestedPath 拒绝消息里渲染的原始未解析路径。
 */
export async function assertImageCapableRoute(ctx: Context, exec: ToolExecution, requestedPath: string): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error(`cannot read "${requestedPath}" as an image: the current model route could not be resolved`)
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(`cannot read "${requestedPath}" as an image: model "${model}" does not declare image input; switch to an image-capable model to read images`)
  }
}

/**
 * Re-brand a structured image outcome into the durable attachment reference an
 * `ImageBlock` carries.
 * @param image - the image metadata from the output schema.
 * @returns the branded attachment reference.
 */
/*
 * 把结构化图像结果重新标记成 ImageBlock 携带的持久 attachment 引用。
 * @param image 输出 schema 里的图像元数据。
 * @returns 带品牌类型的 attachment 引用。
 */
export function imageRefFromValue(image: ImageReadValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
    ...image.originalDimensions === undefined ? {} : {
      originalDimensions: { ...image.originalDimensions },
    },
  }
}

/**
 * Format an image read as the model-facing envelope beside its image block.
 * A downscaled read names the on-disk dimensions and the multiplier that maps
 * coordinates measured on the attached image back onto the original file.
 * @param displayPath - the backend-resolved path rendered in the envelope's `<path>` element.
 * @param image - the image metadata to summarize.
 * @returns the model-facing envelope; the image itself rides the adjacent image block.
 */
/*
 * 把图像读结果格式化成图片块旁边的模型可见信封。降采样过的读取会点名磁盘尺寸与
 * 把"在附图上量到的坐标"映射回原文件的倍数。
 * @param displayPath 信封 <path> 元素里的后端解析路径。
 * @param image 要概括的图像元数据。
 * @returns 模型可见信封；图片本体在相邻的图片块里。
 */
export function formatImageReadOutput(displayPath: string, image: ImageReadValue['image']): string {
  let scaled = ''
  if (image.originalDimensions !== undefined) {
    // Integer rounding can give the two axes slightly different ratios, so the
    // advice names one multiplier only when both round to the same value.
    // 中文说明：整数取整可能让两轴比率略有差异，所以只在两轴舍入到同一值时
    // 才给出单一倍数建议。
    const x = (image.originalDimensions.width / image.width).toFixed(2)
    const y = (image.originalDimensions.height / image.height).toFixed(2)
    const advice = x === y
      ? `multiply coordinates by ${x}`
      : `multiply x coordinates by ${x} and y coordinates by ${y}`
    scaled = ` (downscaled from ${image.originalDimensions.width}x${image.originalDimensions.height} px; ${advice} to locate features in the original file)`
  }
  return `<path>${displayPath}</path>
<type>image</type>
<content>
${image.mediaType} image, ${image.width}x${image.height} px, ${image.bytes} bytes${scaled}
</content>`
}

/**
 * Project one structured image read into its model-facing envelope and image.
 * @param value - the image-read outcome.
 * @returns the two content blocks used by native and nested dispatches.
 */
/*
 * 把一个结构化图像读结果投影成"模型可见信封 + 图片"两块内容。
 * @param value 图像读结果。
 * @returns 原生与嵌套分发共用的两个内容块。
 */
function imageReadContent(value: ImageReadValue): ContentBlock[] {
  return [
    { type: 'text', text: formatImageReadOutput(value.path, value.image) },
    { type: 'image', attachment: imageRefFromValue(value.image) },
  ]
}

/**
 * Register the `read_image` tool into the given context. The composing plugin
 * owns the attachments gate: `src/index.ts` calls this inside
 * `ctx.inject(['attachments'], …)` so the tool exists only while a durable
 * store is mounted. Execution still re-checks `ctx.get('attachments')` for
 * direct callers and gates on the calling route's declared image input.
 * @param ctx - the registration scope; execution uses its `fs` service plus
 *   the optional `attachments`/`llm` services.
 */
/*
 * 在给定上下文里注册 read_image 工具。组合插件拥有附件门：src/index.ts 在
 * ctx.inject(['attachments'], …) 里调用本函数，因此工具只在持久存储挂载期间存在。
 * 执行仍对直接调用者复查 ctx.get('attachments')，并按调用路由声明的图像输入做门控。
 * @param ctx 注册作用域；执行使用其 fs 服务以及可选的 attachments/llm 服务。
 */
export function applyReadImageTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'read_image',
    description: 'Read a PNG/JPEG/WebP/GIF file and return the image itself. '
      + 'Harness validates and downscales large supported images before the next model request, so use this tool directly instead of installing image libraries or creating thumbnails merely to inspect an image. '
      + 'Independent files may be read concurrently in small batches. Requires the current model to accept image input.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the image file, resolved by the filesystem backend.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          image: IMAGE_VALUE_SCHEMA,
        },
      },
      render: (_args, value) => imageReadContent(value),
    },
    // Content-addressed attachment writes are idempotent, so concurrent reads
    // of the same file cannot conflict.
    // 中文说明：内容寻址的 attachment 写入幂等，因此同一文件的并发读不会冲突。
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')

      // Every gate runs before any filesystem I/O so a refusal never leaks
      // partial reads or attachment writes.
      // 中文说明：所有门在任何文件系统 I/O 之前执行——拒绝绝不泄漏部分读取或
      // attachment 写入。
      const mediaType = imageMediaTypeForPath(args.file_path)
      if (mediaType === undefined) {
        throw new Error(`cannot read "${args.file_path}": read_image only accepts PNG/JPEG/WebP/GIF paths`)
      }
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error(`cannot read "${args.file_path}" as an image: no attachment service is mounted`)
      }
      if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
        throw new Error(`cannot read "${args.file_path}": ${mediaType} images are not accepted by this deployment`)
      }
      await assertImageCapableRoute(ctx, exec, args.file_path)

      const { target, info } = await resolveRegularReadTarget(ctx, exec, args.file_path)

      // The tool result is one message carrying one image, so the per-message
      // aggregate bound applies beside the per-image bound.
      // 中文说明：工具结果是一条携带一张图片的消息，所以单消息聚合上限与单图上限
      // 同时适用，取较小者。
      const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
      const data = await ctx.fs.readBytes(target, exec.signal, byteCap)
      // Persist before returning: the image block must reference a durably
      // committed object by the time the tool/result event is appended.
      // 中文说明：返回前先持久化——工具/结果事件被追加时，图片块必须引用一个已
      // 持久提交的对象。
      let ref: ImageAttachmentRef
      try {
        ref = await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) })
      } catch (error: unknown) {
        if (!(error instanceof AttachmentError)) throw error
        // Dimension refusals stay recoverable tool errors: an oversized image
        // must never enter durable history, where it would ride every later
        // model request past provider-side dimension rejections.
        // 中文说明：尺寸拒绝保持为可恢复的工具错误：超大图绝不能进入持久历史，
        // 否则它会随之后每个模型请求一起携带并撞上提供者侧的尺寸拒绝。
        if (error.code === 'IMAGE_DIMENSION_TOO_LARGE') {
          throw new Error(
            `cannot read "${target.displayPath}": at least one image side exceeds the ${attachments.imageLimits.maxImageDimension}px limit; downscale the image and read the smaller copy`,
            { cause: error },
          )
        }
        if (error.code === 'IMAGE_TOO_MANY_PIXELS') {
          throw new Error(
            `cannot read "${target.displayPath}": the image exceeds the ${attachments.imageLimits.maxImagePixels}-pixel decoded-size limit; downscale the image and read the smaller copy`,
            { cause: error },
          )
        }
        if (error.code === 'IMAGE_TOO_LARGE') {
          throw new Error(
            `cannot read "${target.displayPath}": the image cannot be stored within the deployment's byte limits; downscale the image and read the smaller copy`,
            { cause: error },
          )
        }
        if (error.code === 'ATTACHMENT_WRITE_FAILED' && /16-bit PNG/iu.test(error.message)) {
          throw new Error(
            `cannot read "${target.displayPath}": the 16-bit PNG could not be converted to the normalized 8-bit sRGB form; convert it to an 8-bit PNG/JPEG/WebP and retry`,
            { cause: error },
          )
        }
        if (error.code !== 'IMAGE_TYPE_MISMATCH') throw error
        // 类型不匹配：扩展名声明的媒体类型与实际字节格式不同，提示改名或转格式。
        const extension = extname(target.displayPath).toLowerCase()
        throw new Error(
          `cannot read "${target.displayPath}": the ${extension} extension declares ${mediaType}, but the bytes use a different image format; rename the file to match its actual format if it is PNG/JPEG/WebP/GIF, or convert it to one of those formats`,
          { cause: error },
        )
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      const value: ImageReadValue = {
        path: target.displayPath,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
          ...ref.originalDimensions === undefined ? {} : {
            originalDimensions: { ...ref.originalDimensions },
          },
        },
      }
      return value
    },
    // Pure display: a generic card in the read family with a follow-along
    // location on the image file.
    // 中文说明：纯展示——read 家族里的通用卡片，跟随位置落在图片文件上。
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Read image ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
