/*
 * ================================ 文件注释 ================================
 * 【文件职责】基于 Node 公开 API（zstdDecompressSync）的多帧同步解码器回退实现：
 *   当私有句柄优化不可用时，保证多帧解码仍然正确。
 * 【技术维度】对每个完整帧独立调用一次一次性同步解压；生成器逐帧产出；
 *   生命周期状态机（started/closed）防止复用错误。
 * 【产品维度】在任意满足引擎要求的 Node 版本上都能正确读取压缩会话日志，
 *   是性能优化的安全网。
 * 【逻辑维度】decode 生成器：状态检查 → 逐帧解压（失败包装为统一损坏错误）→
 *   yield 明文；close 仅标记关闭（一次性 API 无需释放资源）。
 * 【关键边界】一个实例只能 decode 一次；关闭后不可再启动；每次调用
 *   zstdDecompressSync 会重建原生上下文——这正是它慢于私有实现的原因。
 * 【新手阅读建议】先看接口注释（zstd.ts 的 ZstdFrameDecoder），本文件只是
 *   该契约的"保守实现"，代码量小可整读。
 * ==========================================================================
 */
/**
 * Public-API synchronous Zstandard frame decoder fallback.
 * @module dsh-session-persistence-jsonl/zstd-public-decoder
 */
/*
 * 【中文导读】上面英文说明：这是公开 API 版的同步多帧解码器回退实现。
 */

import { zstdDecompressSync } from 'node:zlib'
import type { ZstdFrameDecoder, ZstdFrameRange } from './zstd.ts'

/** Multi-frame adapter built exclusively from Node's supported one-shot API. */
/*
 * 【中文】完全构建于 Node 受支持的一次性 API 之上的多帧适配器。
 */
export class PublicZstdFrameDecoder implements ZstdFrameDecoder {
  /** 是否已经启动过一次 decode。 */
  private started = false
  /** 是否已关闭。 */
  private closed = false

  /** @inheritdoc */
  /*
   * 【中文】逐帧调用 zstdDecompressSync 并按序产出明文；单帧失败统一包装为
   * 带字节偏移的"日志损坏"错误（原始错误挂 cause）。
   * @param source - 拼接的 zstd 帧字节。
   * @param frames - 结构完整的帧区间列表。
   * @returns 逐帧明文的生成器。
   */
  public *decode(source: Buffer, frames: readonly ZstdFrameRange[]): Generator<Buffer, void, void> {
    if (this.started) throw new Error('Zstandard frame decoder was already started')
    if (this.closed) throw new Error('cannot start a closed Zstandard frame decoder')
    this.started = true
    try {
      for (const { start, end } of frames) {
        let decoded: Buffer
        try {
          decoded = zstdDecompressSync(source.subarray(start, end))
        } catch (error) {
          throw new Error(`corrupt Zstandard session log: frame at byte ${start} failed validation`, {
            cause: error,
          })
        }
        yield decoded
      }
    } finally {
      this.close()
    }
  }

  /** @inheritdoc */
  /*
   * 【中文】关闭解码器：仅置位标记；一次性 API 没有需要释放的原生资源。
   */
  close(): void {
    this.closed = true
  }
}
