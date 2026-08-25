/** Bounded host-side projection of a complete output file retained in E2B. */
/**
 * 文件职责：实现E2B 远程沙箱的 output.ts 模块。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证E2B 远程沙箱在真实组装、失败和清理场景中可靠。
 * 逻辑维度：注册能力，转换请求并管理远程资源。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */

import { Buffer } from 'node:buffer'
import type { SubprocessOutputRead, SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'

/** 中文说明：运行时局部值 BASE64_TEXT，由紧邻初始化决定。 */
const BASE64_TEXT = /^[A-Za-z0-9+/]+={0,2}$/u

/** Reserved non-base64 frame proving that one remote encoder reached clean EOF. */
/** 中文说明：运行时局部值 E2B_OUTPUT_COMPLETE_FRAME，由紧邻初始化决定。 */
export const E2B_OUTPUT_COMPLETE_FRAME = '!dsh-e2b-output-complete!'

/** Incrementally decode newline-delimited base64 frames emitted by one remote encoder. */
/** 中文说明：类型或类 E2BBase64Decoder 约束远程资源或测试数据职责。 */
export class E2BBase64Decoder {
  private pending = ''
  private complete = false

  /**
   * Decode every complete newline-delimited frame in one arbitrarily split SDK callback.
   * @param text - ASCII base64 frames from E2B's decoded callback.
   * @returns the complete raw bytes made available by this callback.
   */
  push(text: string): Buffer {
    if (text.length === 0) return Buffer.alloc(0)
    this.pending += text
    /** 中文说明：运行时局部值 decoded，由紧邻初始化决定。 */
    const decoded: Buffer[] = []
    for (;;) {
      /** 中文说明：运行时局部值 boundary，由紧邻初始化决定。 */
      const boundary = this.pending.indexOf('\n')
      if (boundary < 0) break
      /** 中文说明：运行时局部值 frame，由紧邻初始化决定。 */
      const frame = this.pending.slice(0, boundary)
      this.pending = this.pending.slice(boundary + 1)
      if (frame === E2B_OUTPUT_COMPLETE_FRAME) {
        if (this.complete) throw new Error('subprocess-e2b: duplicate output transport completion')
        this.complete = true
        continue
      }
      if (this.complete) throw new Error('subprocess-e2b: output transport continued after completion')
      if (!BASE64_TEXT.test(frame)) {
        throw new Error('subprocess-e2b: invalid base64 output transport')
      }
      /** 中文说明：运行时局部值 bytes，由紧邻初始化决定。 */
      const bytes = Buffer.from(frame, 'base64')
      if (bytes.toString('base64') !== frame) {
        throw new Error('subprocess-e2b: invalid base64 output transport')
      }
      decoded.push(bytes)
    }
    return Buffer.concat(decoded)
  }

  /**
   * Validate clean encoder completion, or discard an interrupted trailing frame after requested termination.
   * @param requireComplete - Whether natural completion requires the reserved EOF frame.
   */
  finish(requireComplete = true): void {
    if (!requireComplete) {
      this.pending = ''
      return
    }
    if (this.pending.length > 0) {
      throw new Error('subprocess-e2b: truncated base64 output transport')
    }
    if (!this.complete) throw new Error('subprocess-e2b: incomplete output transport')
  }
}

/** Offset reader used for one collect-mode E2B stream. */
/** 中文说明：类型或类 E2BOutputReader 约束远程资源或测试数据职责。 */
export class E2BOutputReader implements SubprocessOutputReader {
  private chunks: Buffer[] = []
  private retainedBytes = 0
  private totalBytes = 0
  private spillValid = true

  /**
   * Create a bounded reader over one remote spill path.
   * @param maxBytes - In-memory tail cap.
   * @param maxSpillBytes - Maximum complete remote file size the caller accepts.
   * @param spillPath - Remote full-output path.
   */
  constructor(
    private readonly maxBytes: number,
    private readonly maxSpillBytes: number | undefined,
    private readonly spillPath: string,
  ) {}

  /** Total bytes observed from the SDK stream. */
  get size(): number {
    return this.totalBytes
  }

  /** Stop advertising a remote spill whose writer did not reach clean EOF. */
  invalidateSpill(): void {
    this.spillValid = false
  }

  /**
   * Append one byte-faithful decoded transport event.
   * @param bytes - Raw command bytes recovered from the ASCII SDK transport.
   */
  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return
    /** 中文说明：运行时局部值 chunk，由紧邻初始化决定。 */
    const chunk = Buffer.from(bytes)
    this.totalBytes += chunk.length
    this.chunks.push(chunk)
    this.retainedBytes += chunk.length
    while (this.retainedBytes > this.maxBytes) {
      /** 中文说明：运行时局部值 head，由紧邻初始化决定。 */
      const head = this.chunks[0] as Buffer
      /** 中文说明：运行时局部值 excess，由紧邻初始化决定。 */
      const excess = this.retainedBytes - this.maxBytes
      if (head.length <= excess) {
        this.chunks.shift()
        this.retainedBytes -= head.length
      } else {
        this.chunks[0] = head.subarray(excess)
        this.retainedBytes -= excess
      }
    }
  }

  /** @inheritdoc */
  readFrom(fromByte: number): SubprocessOutputRead {
    /** 中文说明：运行时局部值 retained，由紧邻初始化决定。 */
    const retained = Buffer.concat(this.chunks, this.retainedBytes)
    /** 中文说明：运行时局部值 firstRetained，由紧邻初始化决定。 */
    const firstRetained = this.totalBytes - this.retainedBytes
    /** 中文说明：运行时局部值 lossy，由紧邻初始化决定。 */
    const lossy = fromByte < firstRetained
    /** 中文说明：运行时局部值 start，由紧邻初始化决定。 */
    const start = lossy ? 0 : Math.min(retained.length, Math.max(0, fromByte - firstRetained))
    return {
      text: retained.subarray(start).toString('utf8'),
      nextOffset: this.totalBytes,
      lossy,
      ...(lossy && this.spillValid && this.maxSpillBytes !== undefined && this.totalBytes <= this.maxSpillBytes
        ? { spillPath: this.spillPath }
        : {}),
    }
  }
}
