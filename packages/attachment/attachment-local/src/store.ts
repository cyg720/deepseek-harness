/** Content-addressed, owner-private local attachment storage. */
/*
 * 文件职责：以SHA-256内容寻址方式在本地私有目录中准备、持久提交、读取并校验规范化图片。
 * 技术维度：使用Node.js文件句柄、硬链接、fsync、权限位和原子临时文件实现崩溃安全的去重发布。
 * 产品维度：保证会话日志中的附件引用在进程或机器重启后仍指向完整、不可被静默替换的图片字节。
 * 逻辑维度：验证来源并规范化，构造引用，持久化目录链，写临时文件后硬链接发布，读取时重算摘要和元数据。
 * 关键边界：引用仅接受sha256加64位小写十六进制；目录权限为私有；Windows跳过目录fsync但保留文件原子性。
 * 新手阅读建议：先看 prepareImageFile 如何生成引用，再看 commitPreparedImageFile 的发布顺序，最后读 readImageFile 的验证链。
 */

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import {
  AttachmentError,
  AttachmentId,
} from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { normalizeImage } from './normalization.ts'
import type { NormalizationPolicy } from './normalization.ts'
import { detectImage, probeImage } from './image.ts'
import type { DetectedImage } from './image.ts'

// 合法附件标识的唯一文本格式，并捕获纯摘要部分。
const ID_PATTERN = /^sha256:([a-f0-9]{64})$/
// 当前进程已经完成目录耐久性证明的DSH_HOME集合。
const durableHomes = new Set<string>()

/** 计算图片字节的SHA-256十六进制摘要。 */
function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 清理客户端文件名，只保留不含控制字符的末级名称。 */
function displayName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  // Strip both separator styles by hand: a POSIX host treats `\` as an
  // ordinary character, so path.basename would keep a Windows client's full
  // local path and leak it into the reference and the session log.
  // 同时按两种分隔符截取，避免POSIX主机把Windows完整本地路径写入会话。
  const leaf = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
  // 删除控制字符、修剪空白并限制为255个字符的安全显示名。
  const clean = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
  return clean === '' ? undefined : clean
}

function ensureReference(ref: ImageAttachmentRef): string {
  // 对品牌标识执行严格格式匹配的结果。
  const match = ID_PATTERN.exec(String(ref.attachmentId))
  if (match?.[1] === undefined) throw new AttachmentError('Attachment reference is invalid.', 'INVALID_ATTACHMENT_REF')
  return match[1]
}

/**
 * Derive the absolute immutable-object path for one normalized attachment.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ref - durable normalized attachment reference.
 * @returns provider-local path without reading the object.
 */
export function normalizedImagePath(root: string, ref: ImageAttachmentRef): string {
  const sha256 = ensureReference(ref)
  return join(root, 'objects', sha256.slice(0, 2), sha256)
}

async function inspectMetadata(
  data: Uint8Array,
  declaredMediaType: ImageAttachmentRef['mediaType'],
  limits: ImageAttachmentLimits,
): Promise<DetectedImage> {
  if (data.byteLength === 0) throw new AttachmentError('Image is empty.', 'INVALID_IMAGE')
  // 应用来源像素限制后检测到的权威图片事实。
  const detected = await detectImage(data, { maxPixels: limits.maxImagePixels, maxDimension: limits.maxImageDimension })
  if (detected.mediaType !== declaredMediaType) throw new AttachmentError('Declared image type does not match its bytes.', 'IMAGE_TYPE_MISMATCH')
  return detected
}

/**
 * Run the full admission policy for one image without touching storage,
 * including normalization: a batch whose members all validate cannot later
 * be refused by the normalized image byte cap during publication.
 * @param input - encoded bytes and declared metadata.
 * @param limits - resolved source admission policy.
 * @param policy - resolved normalization policy.
 * @returns completion after the raster has been decoded and its normalized version proven to fit.
 */
export async function validateImageFile(
  input: SaveImageAttachment,
  limits: ImageAttachmentLimits,
  policy: NormalizationPolicy,
): Promise<void> {
  await prepareImageFile(input, limits, policy)
}

/** Fully prepared normalized object, verified before any batch member is persisted. */
/* 在整批任何成员落盘前完成验证的规范化对象。 */
export interface PreparedImageFile {
  /** Deterministic normalized bytes whose digest is {@link ref.attachmentId}. */
  /* 摘要与ref.attachmentId一致的确定性规范化字节。 */
  data: Uint8Array
  /** Durable reference describing {@link data}. */
  /* 准确描述data格式、尺寸和字节数的持久引用。 */
  ref: ImageAttachmentRef
}

/**
 * Decode, normalize, and verify one submitted image without touching storage.
 * @param input - submitted encoded bytes and declared media type.
 * @param limits - source admission policy.
 * @param policy - independent normalization policy.
 * @returns immutable reference facts beside bytes ready for atomic publication.
 */
export async function prepareImageFile(
  input: SaveImageAttachment,
  limits: ImageAttachmentLimits,
  policy: NormalizationPolicy,
): Promise<PreparedImageFile> {
  if (input.data.byteLength > limits.maxImageBytes) {
    throw new AttachmentError('Image exceeds the configured byte limit.', 'IMAGE_TOO_LARGE')
  }
  // 完整解码并经过来源策略限制的图片事实。
  const detected = await inspectMetadata(input.data, input.mediaType, limits)
  // 提供方无关且满足持久策略的规范化图片。
  const normalized = await normalizeImage(input.data, detected, policy)
  // 规范化字节的内容寻址摘要。
  const sha256 = digest(normalized.data)
  // 可安全记录到引用和会话日志的可选显示名。
  const name = displayName(input.name)
  // 是否需要在引用中保留原始可见尺寸。
  const downscaled = detected.width !== normalized.width || detected.height !== normalized.height
  return {
    data: normalized.data,
    ref: {
      attachmentId: AttachmentId(`sha256:${sha256}`),
      mediaType: normalized.mediaType,
      width: normalized.width,
      height: normalized.height,
      bytes: normalized.data.byteLength,
      ...(name !== undefined ? { name } : {}),
      ...downscaled ? { originalDimensions: { width: detected.width, height: detected.height } } : {},
    },
  }
}

/**
 * Make a directory's entries durable (fsync on a read-only directory handle).
 * A synced file alone does not survive a crash when its directory entry never
 * reached storage, so the publication directory is synced before a durable
 * reference is reported.
 */
async function syncDirectory(path: string): Promise<void> {
  /* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */
  // 用于调用fsync的只读目录句柄。
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  /* v8 ignore stop */
}

/**
 * Create one private directory tree and persist every ancestor entry up to a
 * caller-vouched durable boundary. The walk deliberately ignores what mkdir
 * reports as newly created: a concurrent first save can create a level this
 * process then merely observes, so "already existed" is not "already durable"
 * — the entry may still be unsynced in the creator, and a crash would drop a
 * directory the session checkpoint already references. Re-syncing a durable
 * entry is harmless; skipping an unsynced one is not.
 * @param path - absolute directory to create.
 * @param boundary - absolute ancestor the caller vouches is already durable.
 */
async function ensureDurableDirectory(path: string, boundary: string): Promise<void> {
  // 规范化后的目标绝对目录。
  const target = resolve(path)
  // 调用者确认已经持久的祖先边界。
  const stop = resolve(boundary)
  await mkdir(target, { recursive: true, mode: 0o700 })
  await chmod(target, 0o700)
  // 从目标逐层向祖先边界移动的当前目录。
  let level = target
  while (level !== stop) {
    // 当前目录的父级，需要同步其目录项。
    const parent = dirname(level)
    await syncDirectory(parent)
    /* v8 ignore next -- filesystem-root guard: callers pass a boundary that is an ancestor of path, so the walk reaches it first. */
    if (parent === level) return
    level = parent
  }
}

/**
 * Establish this process's proof that one DSH_HOME entry and every ancestor
 * below the filesystem root are durable. Mere existence is insufficient: a
 * concurrent process may have created the directory but not synced its parent.
 */
async function ensureDurableHome(path: string): Promise<string> {
  // 规范化后的DSH_HOME绝对路径。
  const home = resolve(path)
  if (!durableHomes.has(home)) {
    await ensureDurableDirectory(home, parse(home).root)
    durableHomes.add(home)
  }
  return home
}

/**
 * Publish one already verified normalized image below a versioned attachment root.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param prepared - deterministic normalized bytes and reference.
 * @returns durable content-addressed normalized image reference.
 */
export async function commitPreparedImageFile(
  root: string,
  prepared: PreparedImageFile,
): Promise<ImageAttachmentRef> {
  // 已在准备阶段完整验证的规范化字节。
  const normalized = prepared.data
  // 从目标引用中提取的预期内容摘要。
  const sha256 = ensureReference(prepared.ref)
  if (digest(normalized) !== sha256 || normalized.byteLength !== prepared.ref.bytes) {
    throw new AttachmentError('Prepared attachment bytes do not match their reference.', 'ATTACHMENT_CORRUPT')
  }
  // 最终对象所在的摘要前缀分桶目录。
  const bucket = join(root, 'objects', sha256.slice(0, 2))
  // 与对象存储位于同一附件根下的私有暂存目录。
  const staging = join(root, 'tmp')
  // Establish DSH_HOME itself against the filesystem root once per process.
  // Every process performs that proof independently, so observing a directory
  // another process created can never be mistaken for durable publication.
  // 当前进程确认耐久的DSH_HOME边界。
  const boundary = await ensureDurableHome(dirname(dirname(resolve(root))))
  await ensureDurableDirectory(bucket, boundary)
  await ensureDurableDirectory(staging, boundary)
  // 使用随机名称且以独占方式创建的暂存文件路径。
  const temporary = join(staging, randomUUID())
  const target = normalizedImagePath(root, prepared.ref)
  let handle
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    await handle.writeFile(normalized)
    await handle.sync()
    await handle.close()
    handle = undefined
    try {
      await link(temporary, target)
    } catch (error) {
      /* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      // 并发写入者已发布的现有对象字节。
      const existing = new Uint8Array(await readFile(target))
      if (digest(existing) !== sha256) throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
    }
    // Windows shares the read-only attribute across hard links and refuses to
    // unlink either name once it is set, so discard the staging name first.
    await unlink(temporary)
    // The target remains the sole link for a new object; this also restores
    // read-only mode when the deduplication path observes an existing object.
    await chmod(target, 0o400)
    // Persist the target entry and close a concurrent bucket-creation window
    // before the reference can reach a session checkpoint. The dedup path
    // repeats both syncs because it may observe another writer's link before
    // that writer reaches its own durability boundary.
    await syncDirectory(bucket)
    await syncDirectory(join(root, 'objects'))
  } catch (error) {
    /* v8 ignore next -- A descriptor can remain open only when the underlying write/sync/close operation fails. */
    if (handle !== undefined) await handle.close().catch(
      /* v8 ignore next -- Close failure is superseded by the storage operation that entered cleanup. */
      () => {},
    )
    await unlink(temporary).catch(
      /* v8 ignore next -- The callback requires a second independent staging-unlink failure. */
      (cleanupError: unknown) => {
        /* v8 ignore next -- Cleanup is best-effort only for a staging file already removed by a failed operation. */
        if (!(cleanupError instanceof Error && 'code' in cleanupError && cleanupError.code === 'ENOENT')) throw cleanupError
      },
    )
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unable to persist image attachment.', 'ATTACHMENT_WRITE_FAILED', { cause: error })
  }
  return prepared.ref
}

/**
 * Decode and normalize one image once, then publish the prepared object.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param input - submitted encoded bytes and declared media type.
 * @param limits - resolved source admission policy.
 * @param policy - resolved normalization policy.
 * @returns durable content-addressed normalized image reference.
 */
export async function saveImageFile(
  root: string,
  input: SaveImageAttachment,
  limits: ImageAttachmentLimits,
  policy: NormalizationPolicy,
): Promise<ImageAttachmentRef> {
  return commitPreparedImageFile(root, await prepareImageFile(input, limits, policy))
}

/**
 * Read and verify one content-addressed image.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ref - reference recorded in the session log.
 * @param signal - optional cancellation for filesystem and verification work.
 * @returns verified bytes and reference.
 * @throws the signal reason when aborted, or an AttachmentError when verification fails.
 */
export async function readImageFile(
  root: string,
  ref: ImageAttachmentRef,
  signal?: AbortSignal,
): Promise<StoredImageAttachment> {
  signal?.throwIfAborted()
  // 从持久引用中提取的预期内容摘要。
  const sha256 = ensureReference(ref)
  // 从对象存储读取的图片字节。
  let data: Uint8Array
  try {
    data = new Uint8Array(await readFile(normalizedImagePath(root, ref), { signal }))
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    throw new AttachmentError('Unable to read image attachment.', 'ATTACHMENT_READ_FAILED', { cause: error })
  }
  signal?.throwIfAborted()
  if (digest(data) !== sha256) throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
  // The digest proves these are the exact bytes admission fully decoded, so
  // the read path only re-derives the header fields (no raster decode, no
  // per-request pixel amplification on history replay).
  // 摘要已证明字节与准入时相同，因此这里只重新读取图片头事实。
  const metadata = await probeImage(data)
  signal?.throwIfAborted()
  if (metadata.mediaType !== ref.mediaType || data.byteLength !== ref.bytes
    || metadata.width !== ref.width || metadata.height !== ref.height) {
    throw new AttachmentError('Stored attachment metadata does not match its reference.', 'ATTACHMENT_CORRUPT')
  }
  return { ref, data }
}
