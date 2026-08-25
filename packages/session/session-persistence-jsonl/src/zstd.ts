/*
 * ================================ 文件注释 ================================
 * 【文件职责】JSONL 后端的 Zstandard（zstd）帧原语：在不解压的前提下扫描帧边界、
 *   压缩/解压单帧、提供可互换的同步多帧解码器，以及从残缺尾帧抢救明文。
 * 【技术维度】zstd 容器 = 多个"独立可解、带校验和"的帧顺序拼接——追加写只需
 *   再添一帧；scanZstdFrames 按 zstd 规范逐字段解析魔数/帧头/块头定位边界；
 *   解码器有两条实现：Node 私有流句柄（快）与公开一次性 API（稳），运行时探测
 *   自动选择。
 * 【产品维度】长会话日志体积大幅缩小，同时崩溃后仍能按帧恢复、按需只读头帧，
 *   兼得压缩率与可靠性。
 * 【逻辑维度】按代码顺序：①常量与压缩选项；②ZstdFrameRange/ZstdFrameScan 结构；
 *   ③scanZstdFrames 帧扫描；④compressZstdFrame/decompressZstdFrame；
 *   ⑤ZstdFrameDecoder 接口与 createZstdFrameDecoder 工厂；⑥decompressZstdPrefix。
 * 【关键边界】本模块不负责 JSONL 语义（一行一头一事件是 format.ts 的事）；
 *   scanZstdFrames 遇到非法完整结构即抛错，EOF 截断则返回 tornStart 而不抛；
 *   decode 迭代器产出的缓冲只在下一次推进前有效。
 * 【新手阅读建议】先理解"多帧拼接容器"这一核心设计，再看 scanZstdFrames 的
 *   字节解析（可对照 zstd 帧格式文档），最后看两个解码器实现的取舍。
 * ==========================================================================
 */
/**
 * Zstandard frame primitives for the JSONL persistence backend. The backend
 * owns a concatenated-frame container so it can append and recover batches
 * without exposing compression mechanics through the persistence seam.
 * @module dsh-session-persistence-jsonl/zstd
 */
/*
 * 【中文导读】上面英文概括：后端自有多帧拼接容器，使追加与恢复批次成为可能，
 * 同时不把压缩细节暴露给持久化接缝之外。
 */

import {
  constants, zstdCompress, zstdDecompress, type ZstdOptions,
} from 'node:zlib'
import { promisify } from 'node:util'
import { NodePrivateZstdFrameDecoder } from './zstd-private-decoder.ts'
import { PublicZstdFrameDecoder } from './zstd-public-decoder.ts'

/** 【中文】zstd 帧魔数 0xFD2FB528（小端读取），每个合法帧以此开头。 */
const ZSTD_MAGIC = 0xFD2FB528
const zstdCompressAsync = promisify(zstdCompress)
const zstdDecompressAsync = promisify(zstdDecompress)
/**
 * 【中文】压缩选项：开启校验和（ZSTD_c_checksumFlag），每帧尾部附 4 字节
 * 校验值，解压时自动验证数据完整性。
 */
const CHECKSUM_OPTIONS: ZstdOptions = {
  params: { [constants.ZSTD_c_checksumFlag]: 1 },
}
/**
 * 【中文】解压选项：finishFlush 用 ZSTD_e_flush——允许对"结构上不完整"的帧
 * 尽力产出明文，用于残尾抢救；不会伪造最终帧或校验和完成态。
 */
const INCOMPLETE_FRAME_OPTIONS: ZstdOptions = {
  finishFlush: constants.ZSTD_e_flush,
}

/** Byte range occupied by one structurally complete Zstandard frame. */
/* 【中文】一个结构完整 zstd 帧占用的字节区间：start 含头，end 不含（左闭右开）。 */
export interface ZstdFrameRange {
  /** Inclusive frame start. */
  /* 【中文】帧起始偏移（含）。 */
  start: number
  /** Exclusive frame end. */
  /* 【中文】帧结束偏移（不含）。 */
  end: number
}

/** Structural scan result for a concatenated Zstandard stream. */
/*
 * 【中文】对拼接帧流的结构扫描结果：完整帧列表 + 可选的残尾帧起始偏移。
 * tornStart 存在表示 EOF 打断了最后一帧。
 */
export interface ZstdFrameScan {
  /** Complete frames in file order. */
  /* 【中文】按文件顺序排列的完整帧。 */
  frames: ZstdFrameRange[]
  /** Start of an incomplete final frame, when EOF interrupts one. */
  /* 【中文】被 EOF 截断的末帧起始偏移（无残尾时缺省）。 */
  tornStart?: number
}

/**
 * Locate complete frames without decompressing their blocks. Invalid complete
 * structure rejects; EOF inside the final frame returns its start for repair.
 * @param buffer - complete bytes currently present in the session artifact.
 * @param maxFrames - optional complete-frame limit for metadata-only readers.
 * @returns complete frame ranges and an optional incomplete-final-frame start.
 */
/*
 * 【中文】定位所有完整帧而不解压任何块：逐帧解析魔数 → 帧头描述符（保留位、
 * 内容大小标志、单段标志、校验和标志、字典标志）→ 逐块解析块头直到"末块"，
 * 再跳过可选的 4 字节校验和。任何完整结构非法即抛错；字节在帧中间耗尽（EOF
 * 截断）则返回 tornStart=该帧起点，交由上层做残尾修复。
 * @param buffer - 会话工件当前的全部字节。
 * @param maxFrames - 可选的完整帧数量上限，供只读元数据的调用方提前返回。
 * @returns 完整帧区间与可选残尾起点。
 */
export function scanZstdFrames(buffer: Buffer, maxFrames = Number.POSITIVE_INFINITY): ZstdFrameScan {
  const frames: ZstdFrameRange[] = []
  let offset = 0

  while (offset < buffer.length) {
    const start = offset
    // 帧头各字段按 zstd 规范变长编码；任何字段不完整都视为"帧被 EOF 打断"。
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`)
    }
    offset += 4

    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`)
    }

    // 解码描述符位段，计算帧头剩余字节数。
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0
      ? (singleSegment ? 1 : 0)
      : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes

    // 逐块跳过：每块 3 字节块头（末块标志/块类型/块大小），RLE 块实际负载仅 1 字节。
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }

    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
    if (frames.length === maxFrames) return { frames }
  }

  return { frames }
}

/**
 * Compress one independently decodable, checksummed Zstandard frame.
 * @param input - JSONL bytes for a header or durable event batch.
 * @returns the complete encoded frame.
 */
/*
 * 【中文】压缩出一个独立可解、带校验和的 zstd 帧。
 * @param input - 头记录或持久化事件批的 JSONL 字节。
 * @returns 完整的编码帧。
 */
export async function compressZstdFrame(input: Buffer | string): Promise<Buffer> {
  return zstdCompressAsync(input, CHECKSUM_OPTIONS)
}

/**
 * Decompress one complete frame and validate its checksum.
 * @param input - one structurally complete Zstandard frame.
 * @returns the frame plaintext.
 */
/*
 * 【中文】解压单个完整帧并验证校验和。
 * @param input - 结构完整的单个 zstd 帧。
 * @returns 帧明文。
 */
export async function decompressZstdFrame(input: Buffer): Promise<Buffer> {
  return zstdDecompressAsync(input)
}

/** Common lifecycle for interchangeable synchronous multi-frame decoders. */
/*
 * 【中文】可互换的同步多帧解码器公共接口：私有句柄实现与公开 API 回退实现
 * 都遵守这一生命周期。
 */
export interface ZstdFrameDecoder {
  /**
   * Decode and checksum complete frames in source order. Each yielded buffer
   * remains valid only until the iterator advances to the next frame.
   * @param source - concatenated Zstandard frame bytes.
   * @param frames - structurally complete ranges within `source`.
   * @returns one plaintext buffer per frame.
   */
  /*
   * 【中文】按源顺序解码并校验完整帧；每次产出的缓冲在下一次推进迭代器前有效。
   * @param source - 拼接的 zstd 帧字节。
   * @param frames - 其中的结构完整帧区间。
   * @returns 每帧一个明文缓冲的生成器。
   */
  decode(source: Buffer, frames: readonly ZstdFrameRange[]): Generator<Buffer, void, void>
  /** Release decoder-owned resources; repeated calls are harmless. */
  /* 【中文】释放解码器资源；重复调用无害。 */
  close(): void
}

/**
 * Select the shared private decoder when the running Node 22/24/26 shape is
 * compatible, otherwise preserve correctness with the public one-shot API.
 * @returns a synchronous decoder with an implementation-independent lifecycle.
 */
/*
 * 【中文】解码器工厂：当前 Node（22/24/26）暴露预期的私有流形状时选共享句柄的
 * 私有实现；否则回退到公开一次性 API 保证正确性。对调用方完全透明。
 * @returns 具有实现无关生命周期的同步解码器。
 */
export function createZstdFrameDecoder(): ZstdFrameDecoder {
  return NodePrivateZstdFrameDecoder.create() ?? new PublicZstdFrameDecoder()
}

/**
 * Recover available plaintext from a structurally incomplete final frame.
 * `ZSTD_e_flush` deliberately suppresses final-frame and checksum completion;
 * callers must establish the torn frame boundary before using this helper.
 * @param input - available bytes from a known incomplete Zstandard frame.
 * @returns plaintext produced from the available input.
 */
/*
 * 【中文】从"结构上不完整"的尾帧抢救可用明文。调用前必须先确认残帧边界；
 * 解不出任何明文时由上层兜底（此前完整帧不受影响）。
 * @param input - 已知不完整帧的现存字节。
 * @returns 由现有输入产出的明文。
 */
export async function decompressZstdPrefix(input: Buffer): Promise<Buffer> {
  return zstdDecompressAsync(input, INCOMPLETE_FRAME_OPTIONS)
}
