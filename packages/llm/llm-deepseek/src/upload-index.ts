/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现"持久化的附件→文件 id 上传索引"：DeepSeekUploadIndex 把
 * 每次完成的远端上传落盘为 JSON 索引（DSH 主目录下），供同主目录的所有
 * DeepSeek 会话跨进程复用。
 * 【技术维度】索引键是"命名空间（端点+API key 的 SHA-256）+ 变体 id（完整
 * 请求变换身份）"；读写都用文件锁（withFileLock）保证多进程安全，写入用
 * 原子写（writeFileAtomic）；每条记录带过期时间，剩余存活期低于刷新余量
 * 即视为不可复用。格式版本固定为 3，解析时逐字段校验。
 * 【产品维度】图片文件 id 是可复用的远端资源：索引让多次对话共享同一上传、
 * 减少配额消耗；损坏/过期记录静默丢弃，损坏索引整体重建为空。
 * 【逻辑维度】记录与存储类型 → 命名空间摘要 → 校验辅助 → DeepSeekUploadIndex
 * 类（load/save/get/commit/remove/clear）。
 * 【关键边界】commit 是"全有或全无 + 他人抢先则失败"的原子发布；remove 只删
 * 精确世代（不误删并发安装的后继）；ENOENT 与损坏索引都按空索引处理。
 * 【新手阅读建议】先看 DeepSeekUploadRecord 的字段含义，再读 commit 理解
 * 跨进程"谁先发布谁获胜"的语义。
 * ==========================================================================
 */

/** Durable DeepSeek attachment-to-file-id index. @module dsh-llm-deepseek/upload-index */

import { createHash } from 'node:crypto'
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentId, ImageVariantId as ImageVariantIdType } from '@deepseek-ai/dsh-attachment'
import { DeepSeekFileId, DeepSeekFileScope } from './file-id.ts'
import type { DeepSeekFileId as DeepSeekFileIdType, DeepSeekFileScope as DeepSeekFileScopeType } from './file-id.ts'

/** One durable remote upload mapping. Unix times are milliseconds. */
/*
 * （中文）一条持久的远端上传映射。Unix 时间单位为毫秒。
 */
export interface DeepSeekUploadRecord {
  // 中文：命名空间（端点 + API key 摘要）。
  scope: DeepSeekFileScopeType
  /** Provider-independent normalized attachment from which the uploaded request version was derived. */
  // 中文：派生上传请求版本的、provider 无关的规范化附件。
  attachmentId: AttachmentId
  /** Complete request transformation identity, including route budgets and encoder parameters. */
  // 中文：完整请求变换身份（含路由预算与编码参数）。
  variantId: ImageVariantIdType
  // 中文：远端文件 id。
  fileId: DeepSeekFileIdType
  // 中文：字节数。
  bytes: number
  // 中文：创建时间（Unix 毫秒）。
  createdAt: number
  // 中文：过期时间（Unix 毫秒）。
  expiresAt: number
}

// 中文：落盘索引结构：固定格式版本 3 + 记录数组。
interface StoredIndex {
  formatVersion: 3
  records: DeepSeekUploadRecord[]
}

// 中文：无效索引错误（解析失败用，区别于文件不存在）。
class InvalidUploadIndexError extends Error {}

/** Candidate commit outcome when another process already published a reusable upload. */
/*
 * （中文）候选提交的结果：当另一个进程已经发布了可复用的上传时，给出获胜者
 * 与"是否被接受"。
 */
export interface UploadIndexCommit {
  record: DeepSeekUploadRecord
  accepted: boolean
}

/*
 * （中文）推导一个非机密的稳定索引命名空间，不持久化也不记录 API key。
 * @param baseURL 规范化的 provider 端点命名空间。
 * @param apiKey 已解析的凭据，仅作哈希输入。
 * @returns 品牌化的 SHA-256 命名空间摘要。
 */
/**
 * Derive a non-secret stable index namespace without persisting or logging the API key.
 * @param baseURL - normalized provider endpoint namespace.
 * @param apiKey - resolved credential used only as hash input.
 * @returns branded SHA-256 namespace digest.
 */
export function deepSeekFileScope(baseURL: string, apiKey: string): DeepSeekFileScopeType {
  // 中文：去尾部斜杠 + NUL 分隔 + key，整体做 SHA-256（key 不落盘）。
  const digest = createHash('sha256')
    .update(baseURL.replace(/\/+$/u, ''))
    .update('\0')
    .update(apiKey)
    .digest('hex')
  return DeepSeekFileScope(digest)
}

// 中文：判断错误是否为"文件不存在"（ENOENT）。
function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

// 中文：逐字段校验并解析一条记录（scope 为 64 位十六进制、attachmentId/
// variantId 为 sha256: 前缀、数字字段为非负安全整数）。
function parseRecord(value: unknown): DeepSeekUploadRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidUploadIndexError('llm-deepseek: upload index contains a non-object record')
  }
  const record = value as Record<string, unknown>
  if (typeof record.scope !== 'string' || !/^[0-9a-f]{64}$/u.test(record.scope)
    || typeof record.attachmentId !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.attachmentId)
    || typeof record.variantId !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.variantId)
    || typeof record.fileId !== 'string' || record.fileId.length === 0
    || !Number.isSafeInteger(record.bytes) || (record.bytes as number) < 0
    || !Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0
    || !Number.isSafeInteger(record.expiresAt) || (record.expiresAt as number) < 0) {
    throw new InvalidUploadIndexError('llm-deepseek: upload index contains an invalid record')
  }
  return {
    scope: DeepSeekFileScope(record.scope),
    attachmentId: record.attachmentId as AttachmentId,
    variantId: ImageVariantId(record.variantId),
    fileId: DeepSeekFileId(record.fileId),
    bytes: record.bytes as number,
    createdAt: record.createdAt as number,
    expiresAt: record.expiresAt as number,
  }
}

// 中文：解析整个索引文本：必须是对象、格式版本为 3、records 为数组，且
// scope+变体键不允许重复。
function parseIndex(text: string): StoredIndex {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error: unknown) {
    throw new InvalidUploadIndexError('llm-deepseek: upload index is not valid JSON', { cause: error })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidUploadIndexError('llm-deepseek: upload index is not an object')
  }
  const index = value as { formatVersion?: unknown; records?: unknown }
  if (index.formatVersion !== 3 || !Array.isArray(index.records)) {
    throw new InvalidUploadIndexError('llm-deepseek: unsupported upload index format')
  }
  const records = index.records.map(parseRecord)
  const keys = new Set<string>()
  for (const record of records) {
    const key = `${record.scope}\0${record.variantId}`
    if (keys.has(key)) throw new InvalidUploadIndexError('llm-deepseek: upload index contains duplicate mappings')
    keys.add(key)
  }
  return { formatVersion: 3, records }
}

// 中文：可复用判定：剩余存活期必须大于刷新余量（否则不复用，提前刷新）。
function reusable(record: DeepSeekUploadRecord, now: number, refreshMarginMs: number): boolean {
  return record.expiresAt - now > refreshMarginMs
}

/** Atomic local index shared by every DeepSeek session in this DSH home. */
/*
 * （中文）本 DSH 主目录下所有 DeepSeek 会话共享的原子本地索引。
 */
export class DeepSeekUploadIndex {
  /** Absolute owner-private JSON index path. */
  // 中文：绝对路径的所有者私有 JSON 索引路径。
  readonly path: string

  /*
   * （中文）构造。
   * @param path 显式测试路径；缺省用 DSH_HOME/llm-deepseek/files-v3.json。
   */
  /**
   * @param path - explicit test path; omission uses `DSH_HOME/llm-deepseek/files-v3.json`.
   */
  constructor(path = join(resolveDshHome(), 'llm-deepseek', 'files-v3.json')) {
    this.path = path
  }

  // 中文：读索引：文件缺失或损坏都按空索引处理，其余错误上抛。
  private async load(): Promise<StoredIndex> {
    try {
      return parseIndex(await readFile(this.path, 'utf8'))
    } catch (error: unknown) {
      if (absent(error) || error instanceof InvalidUploadIndexError) {
        return { formatVersion: 3, records: [] }
      }
      throw error
    }
  }

  // 中文：原子写索引（0600 文件权限、0700 目录权限）。
  private async save(index: StoredIndex): Promise<void> {
    await writeFileAtomic(this.path, `${JSON.stringify(index, undefined, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }

  /*
   * （中文）读取一条可复用映射。
   * @param scope 端点/API key 命名空间。
   * @param variantId 完整请求图片变换身份。
   * @param now 当前 Unix 毫秒时间。
   * @param refreshMarginMs 剩余存活期低于该值则不复用。
   * @returns 剩余存活期足够时的映射；否则 undefined。
   */
  /**
   * Read one reusable mapping.
   * @param scope - endpoint/API-key namespace.
   * @param variantId - complete request-image transformation identity.
   * @param now - current Unix time in milliseconds.
   * @param refreshMarginMs - remaining lifetime below which a mapping is not reused.
   * @returns the mapping when it has enough lifetime remaining.
   */
  async get(
    scope: DeepSeekFileScopeType,
    variantId: ImageVariantIdType,
    now: number,
    refreshMarginMs: number,
  ): Promise<DeepSeekUploadRecord | undefined> {
    const record = (await this.load()).records.find(candidate => (
      candidate.scope === scope && candidate.variantId === variantId
    ))
    return record !== undefined && reusable(record, now, refreshMarginMs) ? record : undefined
  }

  /*
   * （中文）发布一次已完成的上传，除非另一进程已发布了可复用映射。
   * @param candidate 完成的远端上传。
   * @param now 当前 Unix 毫秒时间。
   * @param refreshMarginMs 最小可复用剩余存活期。
   * @returns 获胜记录，以及候选是否进入了索引。
   */
  /**
   * Publish a completed upload unless another process already published a reusable mapping.
   * @param candidate - completed remote upload.
   * @param now - current Unix time in milliseconds.
   * @param refreshMarginMs - minimum reusable remaining lifetime.
   * @returns the winning record and whether the candidate entered the index.
   */
  async commit(
    candidate: DeepSeekUploadRecord,
    now: number,
    refreshMarginMs: number,
  ): Promise<UploadIndexCommit> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    return withFileLock(this.path, async () => {
      const index = await this.load()
      // 中文：他人已发布可复用的同键映射 → 采纳它（候选被拒）。
      const existing = index.records.find(record => (
        record.scope === candidate.scope
        && record.variantId === candidate.variantId
        && reusable(record, now, refreshMarginMs)
      ))
      if (existing !== undefined) return { record: existing, accepted: false }
      // 中文：清理过期记录与同键的失效世代，再追加候选。
      const records = index.records.filter(record => (
        reusable(record, now, refreshMarginMs)
        && !(record.scope === candidate.scope && record.variantId === candidate.variantId)
      ))
      records.push(candidate)
      await this.save({ formatVersion: 3, records })
      return { record: candidate, accepted: true }
    })
  }

  /*
   * （中文）移除一条精确映射，不删除并发安装的后继。
   * @param scope 端点/API key 命名空间。
   * @param variantId 完整请求图片变换身份。
   * @param fileId 要失效的精确远端世代。
   */
  /**
   * Remove one exact mapping without deleting a concurrently installed successor.
   * @param scope - endpoint/API-key namespace.
   * @param variantId - complete request-image transformation identity.
   * @param fileId - exact remote generation being invalidated.
   */
  async remove(
    scope: DeepSeekFileScopeType,
    variantId: ImageVariantIdType,
    fileId: DeepSeekFileIdType,
  ): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    await withFileLock(this.path, async () => {
      const index = await this.load()
      // 中文：只删"scope+变体+文件 id"三者都匹配的记录。
      const records = index.records.filter(record => !(
        record.scope === scope && record.variantId === variantId && record.fileId === fileId
      ))
      if (records.length !== index.records.length) await this.save({ formatVersion: 3, records })
    })
  }

  /*
   * （中文）移除某个远端命名空间的全部本地映射。
   * @param scope 端点/API key 命名空间。
   */
  /**
   * Remove every local mapping for one remote namespace.
   * @param scope - endpoint/API-key namespace.
   */
  async clear(scope: DeepSeekFileScopeType): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    await withFileLock(this.path, async () => {
      const index = await this.load()
      const records = index.records.filter(record => record.scope !== scope)
      if (records.length !== index.records.length) await this.save({ formatVersion: 3, records })
    })
  }
}
