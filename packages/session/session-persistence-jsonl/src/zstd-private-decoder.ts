/**
 * ================================ 文件注释 ================================
 * 【文件职责】基于 Node 私有流句柄的同步多帧 zstd 解码器优化实现：跨帧复用
 *   同一个原生解压上下文与输出缓冲，避免每帧重建上下文。
 * 【技术维度】直接访问 createZstdDecompress 流的私有字段（_handle.writeSync、
 *   _writeState、_defaultFlushFlag 与 kError 符号槽）；运行时形状探测不匹配即
 *   放弃优化；1MB 复用输出缓冲 + 分块拼接返回。
 * 【产品维度】大日志加载明显提速且内存可控；Node 私有形状变化时自动回退公开
 *   API 实现，用户无感。
 * 【逻辑维度】按代码顺序：①私有形状类型与常量；②privateZstdStream 探测；
 *   ③解码器类——工厂 create、decode 生成器（逐帧委托 decodeFrame）、单帧同步
 *   解码 decodeFrame、close 释放。
 * 【关键边界】依赖 Node 未承诺的内部契约：任何字段变化都会让探测失败并回退，
 *   绝不猜测形状硬用；decode 产出的缓冲视图在下一次推进前有效；一个实例只能
 *   decode 一次。
 * 【新手阅读建议】先读 privateZstdStream 理解"探测什么"，再精读 decodeFrame 的
 *   writeSync 循环（注意 _writeState 两项的含义），最后看 fullChunks 拼接分支。
 * ==========================================================================
 */
/**
 * Node-private synchronous Zstandard frame decoder optimization.
 * @module dsh-session-persistence-jsonl/zstd-private-decoder
 */
/**
 * 【中文导读】上面英文说明：利用 Node 私有流句柄做的同步多帧解码优化。
 */

import { constants as bufferConstants } from 'node:buffer'
import { createZstdDecompress } from 'node:zlib'
import type { ZstdFrameDecoder, ZstdFrameRange } from './zstd.ts'

/** 【中文】复用输出缓冲大小（1MB）：兼顾吞吐与内存。 */
const DECODE_CHUNK_SIZE = 1024 * 1024

/**
 * 【中文】Node 解压流私有原生句柄的最小契约：一次同步调用完成"喂输入 + 收输出"。
 */
interface NodeZstdPrivateHandle {
  writeSync(
    flushFlag: number,
    input: Buffer,
    inputOffset: number,
    inputLength: number,
    output: Buffer,
    outputOffset: number,
    outputLength: number,
  ): void
}

/**
 * 【中文】私有写状态数组：下标 0 = 输出缓冲剩余空间，下标 1 = 未消费的输入字节。
 */
type NodeZstdPrivateWriteState = Uint32Array & { 0: number; 1: number }

/**
 * 【中文】解压流的私有形状视图：原生句柄、写状态、默认 flush 标志，以及按符号
 * 访问的内部错误槽（kError）。
 */
interface NodeZstdPrivateState {
  [key: symbol]: unknown
  _handle: NodeZstdPrivateHandle | null
  _writeState: NodeZstdPrivateWriteState
  _defaultFlushFlag: number
}

/** 【中文】带私有形状视图的解压流类型。 */
type NodeZstdPrivateStream = ReturnType<typeof createZstdDecompress> & NodeZstdPrivateState

/** Return the stream with its observed private Node contract, or reject that optimization. */
/**
 * 【中文】探测当前 Node 是否暴露预期的私有流契约：句柄存在且有 writeSync、写状态
 * 是长度足够的 Uint32Array、默认 flush 为数字、kError 符号槽存在且当前无错误；
 * 任一不符即返回 undefined 放弃优化。
 * @param stream - 新建的解压流。
 * @returns 带私有视图的流与 kError 符号；不可用时 undefined。
 */
function privateZstdStream(
  stream: ReturnType<typeof createZstdDecompress>,
): { stream: NodeZstdPrivateStream; errorKey: symbol } | undefined {
  const candidate = stream as unknown as Partial<NodeZstdPrivateState>
  const handle = candidate._handle
  // 按符号描述名定位内部错误槽，避免硬编码 Node 内部符号标识。
  const errorKey = Reflect.ownKeys(stream).find((key): key is symbol => (
    typeof key === 'symbol' && key.description === 'kError'
  ))
  /* v8 ignore next -- one test runtime exposes one Node-private shape; the Node 22/24/26 matrix checks compatibility. */
  if (
    typeof handle !== 'object' || handle === null
    || typeof (handle as { writeSync?: unknown }).writeSync !== 'function'
    || !(candidate._writeState instanceof Uint32Array)
    || candidate._writeState.length < 2
    || typeof candidate._defaultFlushFlag !== 'number'
    || errorKey === undefined
    || candidate[errorKey] !== null
  ) return undefined
  return { stream: stream as NodeZstdPrivateStream, errorKey }
}

/**
 * Synchronous multi-frame decoder backed by one Node Zstd stream handle. Node
 * exposes synchronous decoding only as a one-shot API, so this adapter uses
 * the stream's private handle contract to reuse its native context and output
 * chunks across frames.
 */
/**
 * 【中文】由单个 Node zstd 流句柄支撑的同步多帧解码器。Node 只把同步解码暴露为
 * 一次性 API，因此本适配器借助流的私有句柄契约跨帧复用原生上下文与输出缓冲。
 */
export class NodePrivateZstdFrameDecoder implements ZstdFrameDecoder {
  /** 复用的输出缓冲；每轮 writeSync 的产出都先落在这里。 */
  private readonly output = Buffer.allocUnsafe(DECODE_CHUNK_SIZE)
  /** 流上捕获的首个错误（error 事件），延迟到下一次解码动作时抛出。 */
  private decoderError?: Error
  /** 是否已启动过 decode。 */
  private started = false
  /** 是否已关闭。 */
  private closed = false

  /**
   * 【中文】私有构造：订阅流的 error 事件并保留首个错误。
   * @param stream - 已通过形状探测的私有解压流。
   * @param errorKey - 内部错误槽的符号键。
   */
  private constructor(
    private readonly stream: NodeZstdPrivateStream,
    private readonly errorKey: symbol,
  ) {
    this.stream.on('error', (error: Error) => {
      this.decoderError ??= error
    })
  }

  /**
   * Create the optimized decoder when this Node release exposes the expected
   * private stream shape.
   * @returns a shared decoder, or `undefined` when callers must use the public fallback.
   */
  /**
   * 【中文】工厂：当前 Node 暴露预期私有流形状时创建优化解码器；
   * 否则关闭试探流并返回 undefined（调用方改用公开回退实现）。
   * @returns 优化解码器；不可用时 undefined。
   */
  static create(): NodePrivateZstdFrameDecoder | undefined {
    const stream = createZstdDecompress({ chunkSize: DECODE_CHUNK_SIZE })
    const privateAccess = privateZstdStream(stream)
    /* v8 ignore next -- reached only when a supported Node release changes its private stream shape. */
    if (privateAccess !== undefined) {
      return new NodePrivateZstdFrameDecoder(privateAccess.stream, privateAccess.errorKey)
    }
    /* v8 ignore next -- the active Node runtime passed the private-shape probe above. */
    stream.close()
    /* v8 ignore next -- the active Node runtime passed the private-shape probe above. */
    return undefined
  }

  /** @inheritdoc */
  /**
   * 【中文】逐帧解码生成器：状态守卫 → 对每个帧区间调用 decodeFrame，失败统一
   * 包装为带偏移的损坏错误；迭代结束或中断时自动 close。
   * @param source - 拼接的帧字节。
   * @param frames - 完整帧区间列表。
   * @returns 逐帧明文缓冲的生成器（视图仅到下次推进前有效）。
   */
  public *decode(source: Buffer, frames: readonly ZstdFrameRange[]): Generator<Buffer, void, void> {
    if (this.started) throw new Error('Zstandard frame decoder was already started')
    if (this.closed) throw new Error('cannot start a closed Zstandard frame decoder')
    this.started = true
    try {
      for (const frame of frames) {
        try {
          yield this.decodeFrame(source.subarray(frame.start, frame.end))
        } catch (error) {
          throw new Error(`corrupt Zstandard session log: frame at byte ${frame.start} failed validation`, {
            cause: error,
          })
        }
      }
    } finally {
      this.close()
    }
  }

  /** Decode one frame; its returned scratch view remains valid until the next call. */
  /**
   * 【中文】同步解码单帧：循环 writeSync 喂输入、收输出。输出缓冲写满（剩余空间
   * 为 0）就把整块拷入 fullChunks 继续喂；输出未满即输入耗尽——收尾分支处理
   * 单块/多块的返回拼装。每次调用都会覆盖复用缓冲，返回视图因此只在下一次
   * 调用前有效。
   * @param input - 单个完整帧的字节。
   * @returns 该帧明文（可能是复用缓冲视图或拼接结果）。
   */
  private decodeFrame(input: Buffer): Buffer {
    const handle = this.stream._handle
    /* v8 ignore next -- decode() rejects closed instances before entering this private frame operation. */
    if (this.closed || handle === null) throw new Error('cannot decode with a closed Zstandard frame decoder')

    let inputOffset = 0
    let inputRemaining = input.length
    let outputBytes = 0
    const fullChunks: Buffer[] = []
    for (;;) {
      handle.writeSync(
        this.stream._defaultFlushFlag,
        input,
        inputOffset,
        inputRemaining,
        this.output,
        0,
        this.output.length,
      )
      // 两个错误通道都要查：流事件错误与 kError 内部槽。
      if (this.decoderError !== undefined) throw this.decoderError
      const internalError = this.stream[this.errorKey]
      if (internalError !== null) {
        if (internalError instanceof Error) throw internalError
        throw new Error('Zstandard decoder exposed a non-Error internal failure')
      }

      // 读回写状态：outputAfter=输出缓冲剩余；inputAfter=未消费输入。
      const outputAfter = this.stream._writeState[0]
      const inputAfter = this.stream._writeState[1]
      const consumed = inputRemaining - inputAfter
      const produced = this.output.length - outputAfter
      if (produced > 0) {
        outputBytes += produced
        /* v8 ignore next -- Buffer cannot materialize a frame beyond its own process-wide maximum length. */
        if (outputBytes > bufferConstants.MAX_LENGTH) {
          throw new Error(`Zstandard frame output exceeds ${bufferConstants.MAX_LENGTH} bytes`)
        }
      }

      if (outputAfter !== 0) {
        // 输出缓冲没写满：说明本帧输入已耗尽，进入收尾拼装。
        /* v8 ignore next -- structurally scanned ranges contain exactly one complete frame and no trailing bytes. */
        if (inputAfter !== 0) throw new Error('Zstandard frame decoder left trailing input')
        const finalChunk = this.output.subarray(0, produced)
        if (fullChunks.length === 0) return finalChunk
        if (produced > 0) fullChunks.push(Buffer.from(finalChunk))
        const onlyChunk = fullChunks[0] as Buffer
        return fullChunks.length === 1
          ? onlyChunk
          : Buffer.concat(fullChunks, outputBytes)
      }
      // 输出缓冲被填满：整块拷出（下一轮会被覆盖），继续消费剩余输入。
      fullChunks.push(Buffer.from(this.output))
      inputOffset += consumed
      inputRemaining = inputAfter
    }
  }

  /** @inheritdoc */
  /**
   * 【中文】关闭底层流并置位标记；重复调用无害。
   */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.stream.close()
  }
}
