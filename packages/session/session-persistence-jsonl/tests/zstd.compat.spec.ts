import { describe, expect, it } from 'vitest'
import {
  compressZstdFrame, createZstdFrameDecoder, decompressZstdFrame, scanZstdFrames,
} from '../src/zstd.ts'
import { NodePrivateZstdFrameDecoder } from '../src/zstd-private-decoder.ts'
import { PublicZstdFrameDecoder } from '../src/zstd-public-decoder.ts'

/** 中文：JSONL Zstandard 编解码兼容性测试组。 */
describe('JSONL Zstandard compatibility', () => {
  /** 中文：往返两个连续帧，验证两类解码器和断尾恢复；无参数和返回值。 */
  it('round-trips concatenated checksummed frames through the built-in Node API', async () => {
    /** 两条 JSONL 记录分别压缩后拼接得到的连续字节流。 */
    const encoded = Buffer.concat([
      await compressZstdFrame('{"type":"session","version":0,"id":"compat","createdAt":1}\n'),
      await compressZstdFrame('{"type":"turn/start","seq":0,"turn":1}\n'),
    ])
    /** frames 是完整帧边界；tornStart 是不完整尾帧起点，本处应不存在。 */
    const { frames, tornStart } = scanZstdFrames(encoded)

    expect(tornStart).toBeUndefined()
    expect(frames).toHaveLength(2)
    expect(frames.map(frame => encoded.subarray(frame.start, frame.start + 4).toString('hex')))
      .toEqual(['28b52ffd', '28b52ffd'])
    /** 逐帧解压后的明文字节块。 */
    const decoded = await Promise.all(frames.map(frame => decompressZstdFrame(encoded.subarray(frame.start, frame.end))))
    expect(Buffer.concat(decoded).toString()).toContain('"type":"turn/start"')

    /** 运行环境优先选择的解码器。 */
    const preferred = createZstdFrameDecoder()
    expect(preferred).toBeInstanceOf(NodePrivateZstdFrameDecoder)
    /** 当前被验证的私有或公开解码器。 */
    for (const decoder of [preferred, new PublicZstdFrameDecoder()]) {
      try {
        /** 当前解码器产出的明文 Buffer 数组。 */
        const plaintext = Array.from(decoder.decode(encoded, frames), chunk => Buffer.from(chunk))
        expect(Buffer.concat(plaintext).toString()).toContain('"type":"turn/start"')
      } finally {
        decoder.close()
      }
    }

    /** 第二个事件帧的完整切片。 */
    const eventFrame = encoded.subarray(frames[1]!.start, frames[1]!.end)
    /** 去掉末尾校验字节的残缺帧，用于模拟写入中断。 */
    const missingChecksumByte = eventFrame.subarray(0, -1)
    expect(scanZstdFrames(missingChecksumByte)).toEqual({ frames: [], tornStart: 0 })
  })
})
/**
 * 中文说明：
 * - 文件职责：验证 JSONL 会话日志的 Zstandard 帧能在私有与公开解码实现之间兼容。
 * - 技术维度：使用 Vitest、Node Buffer、异步压缩、帧扫描和两种流式解码器。
 * - 产品维度：保障压缩会话日志可稳定写入、读取，并能从尾部不完整帧恢复已有内容。
 * - 逻辑维度：拼接两个校验帧，扫描边界并解压，再切掉校验字节验证断帧识别与前缀恢复。
 * - 关键边界：测试依赖 Node 内置 Zstd API；解码器必须显式 close，残缺帧不能被当成完整帧。
 * - 新手阅读建议：先理解 encoded、frames 和 decoded 的对应关系，再看 missingChecksumByte 的容错场景。
 */
