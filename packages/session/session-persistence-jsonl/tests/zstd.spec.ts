/**
 * 文件职责：验证 zstd.spec.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { appendFile, mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { SESSION_FORMAT_VERSION, SessionSeq, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import {
  generationLogPath, logPath, scanLog, sessionDir, toHeaderLine, type JsonlCompression,
} from '../src/format.ts'
import {
  compressZstdFrame, createZstdFrameDecoder, decompressZstdFrame, decompressZstdPrefix, scanZstdFrames,
  /** 中文说明：type ZstdFrameDecoder 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
  type ZstdFrameDecoder,
} from '../src/zstd.ts'
import { NodePrivateZstdFrameDecoder } from '../src/zstd-private-decoder.ts'
import { PublicZstdFrameDecoder } from '../src/zstd-public-decoder.ts'
import {
  runPersistenceContract, meta, oneTurnLog, releasedV1OneTurnLog,
} from '../../session-persistence/tests/contract.ts'

/** 中文说明：常量 MAGIC 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])
/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []

/** 中文说明：interface ZstdReaderInternals 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
interface ZstdReaderInternals {
  readZstdPrefix(buffer: Buffer, signal?: AbortSignal): Promise<{ events: SessionEvent[] }>
}

/** 中文说明：type HeaderRead 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
type HeaderRead = (
  this: FileHandle,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number | null,
) => Promise<{ bytesRead: number; buffer: Buffer }>

/** 中文说明：函数 freshRoot 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function freshRoot(prefix = 'dsh-jsonl-zstd-'): Promise<string> {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** 中文说明：函数 mount 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mount(root: string, compression?: JsonlCompression): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, {
    root,
    ...(compression === undefined ? {} : { compression }),
  })
  return ctx
}

/** Create + append + close: persist one whole log through the write handle. */
async function writeLog(persistence: SessionPersistence, m: SessionHeader, events: readonly SessionEvent[]): Promise<void> {
  const handle = await persistence.create(m)
  try {
    await handle.append(events)
  } finally {
    await handle.close()
  }
}

/** Open a read handle, read the whole log, and close. */
async function readAll(persistence: SessionPersistence, id: SessionId): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> {
  const handle = await persistence.open(id, 'read')
  try {
    return { meta: handle.header, events: await handle.read() }
  } finally {
    await handle.close()
  }
}

/** Append one contiguous batch through a temporary write handle. */
async function appendBatch(persistence: SessionPersistence, id: SessionId, events: readonly SessionEvent[]): Promise<void> {
  const handle = await persistence.open(id, 'write')
  try {
    await handle.append(events)
  } finally {
    await handle.close()
  }
}

async function decodeCompleteFrames(buffer: Buffer): Promise<Buffer> {
  const { frames, tornStart } = scanZstdFrames(buffer)
  expect(tornStart).toBeUndefined()
  /** 中文说明：变量 plaintext 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const plaintext: Buffer[] = []
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (const frame of frames) {
    plaintext.push(await decompressZstdFrame(buffer.subarray(frame.start, frame.end)))
  }
  return Buffer.concat(plaintext)
}

function releasedV0Header(header: SessionHeader): Record<string, unknown> {
  return {
    type: 'session',
    version: 0,
    id: header.id,
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    delegationDepth: header.delegationDepth ?? 0,
  }
}

/** Truncate one compressed frame so a scan reports it torn and the recovered plaintext satisfies `accepts`. */
async function tornFrame(plaintext: string, accepts: (decoded: string) => boolean = () => true): Promise<Buffer> {
  const frame = await compressZstdFrame(plaintext)
  /** 中文说明：变量 candidateEnds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const candidateEnds = [
    frame.length - 1,
    frame.length - 4,
    ...[0.9, 0.75, 0.6, 0.5, 0.4, 0.25].map(ratio => Math.floor(frame.length * ratio)),
  ]
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (const end of candidateEnds) {
    /** 中文说明：变量 candidate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const candidate = frame.subarray(0, end)
    if (scanZstdFrames(candidate).tornStart !== 0) continue
    try {
      /** 中文说明：变量 decoded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const decoded = (await decompressZstdPrefix(candidate)).toString('utf8')
      if (accepts(decoded)) return candidate
    } catch {
      // Some early cuts precede the first decodable block; keep searching for
      // a cut that exercises partial-plaintext recovery.
    }
  }
  throw new Error('test fixture could not produce the requested torn Zstandard frame')
}

/** 中文说明：函数 deterministicNoise 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function deterministicNoise(length: number): string {
  /** 中文说明：变量 state 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let state = 0x12345678
  /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let output = ''
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    output += String.fromCharCode(33 + (state % 90))
  }
  return output
}

/** 中文说明：函数 emptyStructuralFrame 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function emptyStructuralFrame(descriptor: number): Buffer {
  /** 中文说明：变量 contentSizeFlag 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const contentSizeFlag = descriptor >>> 6
  /** 中文说明：变量 singleSegment 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const singleSegment = (descriptor & 0x20) !== 0
  /** 中文说明：变量 dictionaryBytes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dictionaryBytes = [0, 1, 2, 4][descriptor & 0x03]!
  /** 中文说明：变量 contentSizeBytes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
  /** 中文说明：变量 variableHeader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const variableHeader = Buffer.alloc((singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes)
  /** 中文说明：变量 lastEmptyRawBlock 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lastEmptyRawBlock = Buffer.from([1, 0, 0])
  /** 中文说明：变量 checksum 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const checksum = (descriptor & 0x04) === 0 ? Buffer.alloc(0) : Buffer.alloc(4)
  return Buffer.concat([MAGIC, Buffer.from([descriptor]), variableHeader, lastEmptyRawBlock, checksum])
}

afterEach(async () => {
  vi.restoreAllMocks()
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

runPersistenceContract('jsonl-zstd', async () => {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-zstd-contract-'))
  const instance = async (): Promise<{ persistence: SessionPersistence; dispose: () => Promise<void> }> => {
    const ctx = new Context()
    const fiber = await ctx.plugin(JsonlSessionPersistence, { root })
    return {
      persistence: ctx.sessionPersistence,
      dispose: async () => { await fiber.dispose() },
    }
  }
  const primary = await instance()
  return {
    persistence: primary.persistence,
    dispose: async () => {
      await primary.dispose()
      await rm(root, { recursive: true, force: true })
    },
    reopen: instance,
    // A torn final frame: the batch's append never resolved, so the whole
    // frame is an uncommitted crash fragment for the write path to truncate.
    corruptTail: async (id, cwd) => {
      /** 中文说明：变量 line 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const line = JSON.stringify({
        type: 'assistant/chunk',
        seq: SessionSeq(8),
        time: 9,
        data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: deterministicNoise(300_000) } },
      }) + '\n'
      const partial = await tornFrame(line, decoded => !decoded.includes('\n'))
      await appendFile(logPath(root, cwd, id, 'zstd'), partial)
    },
  }
})

describe('Zstandard frame structure', () => {
  it('scans concatenated checksummed frames and honors a frame limit', async () => {
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = await compressZstdFrame('header\n')
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = await compressZstdFrame('event\n')
    /** 中文说明：变量 stream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stream = Buffer.concat([first, second])
    expect(scanZstdFrames(Buffer.alloc(0))).toEqual({ frames: [] })
    expect(scanZstdFrames(stream)).toEqual({
      frames: [{ start: 0, end: first.length }, { start: first.length, end: stream.length }],
    })
    expect(scanZstdFrames(stream, 1)).toEqual({ frames: [{ start: 0, end: first.length }] })
    expect(first[4]! & 0x04).toBe(0x04)
    expect(second[4]! & 0x04).toBe(0x04)
    expect((await decompressZstdFrame(first)).toString()).toBe('header\n')
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = createZstdFrameDecoder()
    try {
      /** 中文说明：函数值 plaintext 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const plaintext = Array.from(decoder.decode(stream, scanZstdFrames(stream).frames), chunk => Buffer.from(chunk))
      expect(Buffer.concat(plaintext).toString()).toBe('header\nevent\n')
    } finally {
      decoder.close()
    }
  })

  it('keeps the public and Node-private synchronous decoders interchangeable', async () => {
    /** 中文说明：变量 frames 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const frames = [await compressZstdFrame('first\n'), await compressZstdFrame('second\n')]
    /** 中文说明：变量 stream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stream = Buffer.concat(frames)
    /** 中文说明：变量 ranges 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ranges = scanZstdFrames(stream).frames
    /** 中文说明：变量 privateDecoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const privateDecoder = NodePrivateZstdFrameDecoder.create()
    expect(privateDecoder).toBeDefined()

    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const decoder of [new PublicZstdFrameDecoder(), privateDecoder!]) {
      try {
        /** 中文说明：函数值 plaintext 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const plaintext = Array.from(decoder.decode(stream, ranges), chunk => Buffer.from(chunk))
        expect(plaintext).toHaveLength(2)
        expect(Buffer.concat(plaintext).toString()).toBe('first\nsecond\n')
      } finally {
        decoder.close()
      }
    }
  })

  it('falls back to the public decoder when the private Node contract is unavailable', () => {
    vi.spyOn(NodePrivateZstdFrameDecoder, 'create').mockReturnValue(undefined)
    /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoder = createZstdFrameDecoder()
    expect(decoder).toBeInstanceOf(PublicZstdFrameDecoder)
    decoder.close()
  })

  it('enforces decoder lifecycle and checksum errors through both implementations', async () => {
    /** 中文说明：变量 frame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const frame = await compressZstdFrame('frame\n')
    /** 中文说明：变量 range 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const range = [{ start: 0, end: frame.length }]
    /** 中文说明：变量 corrupt 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const corrupt = Buffer.from(frame)
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 0xFF
    /** 中文说明：函数值 factories 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const factories: Array<() => ZstdFrameDecoder> = [
      () => new PublicZstdFrameDecoder(),
      () => NodePrivateZstdFrameDecoder.create()!,
    ]

    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const create of factories) {
      /** 中文说明：变量 interrupted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const interrupted = create()
      /** 中文说明：变量 iterator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const iterator = interrupted.decode(frame, range)
      expect(iterator.next().value?.toString()).toBe('frame\n')
      iterator.return()
      expect(() => Array.from(interrupted.decode(frame, range))).toThrow(/already started/)
      interrupted.close()

      /** 中文说明：变量 closed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const closed = create()
      closed.close()
      closed.close()
      expect(() => Array.from(closed.decode(frame, range))).toThrow(/closed/)

      /** 中文说明：变量 invalid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const invalid = create()
      expect(() => Array.from(invalid.decode(corrupt, range))).toThrow(/frame at byte 0 failed validation/)
    }
  })

  it('assembles private-decoder output at and beyond its reusable chunk boundary', async () => {
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const length of [8, 9]) {
      /** 中文说明：变量 plaintext 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const plaintext = Buffer.alloc(length, 0x61)
      /** 中文说明：变量 frame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const frame = await compressZstdFrame(plaintext)
      /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const decoder = NodePrivateZstdFrameDecoder.create()!
      ;(decoder as unknown as { output: Buffer }).output = Buffer.allocUnsafe(8)
      const [decoded] = Array.from(
        decoder.decode(frame, [{ start: 0, end: frame.length }]),
        chunk => Buffer.from(chunk),
      )
      expect(decoded).toEqual(plaintext)
    }
  })

  it('normalizes private decoder stream failures', async () => {
    /** 中文说明：interface PrivateDecoderInternals 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
    interface PrivateDecoderInternals {
      stream: {
        [key: symbol]: unknown
        emit(event: string, error: Error): boolean
      }
      errorKey: symbol
    }
    /** 中文说明：变量 frame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const frame = await compressZstdFrame('frame\n')
    /** 中文说明：变量 range 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const range = [{ start: 0, end: frame.length }]

    /** 中文说明：变量 emitted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const emitted = NodePrivateZstdFrameDecoder.create()!
    /** 中文说明：变量 emittedInternals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const emittedInternals = emitted as unknown as PrivateDecoderInternals
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = new Error('first emitted decoder failure')
    emittedInternals.stream.emit('error', first)
    emittedInternals.stream.emit('error', new Error('later emitted decoder failure'))
    try {
      Array.from(emitted.decode(frame, range))
      throw new Error('expected emitted decoder failure')
    } catch (error) {
      expect((error as Error).cause).toBe(first)
    }

    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const internalFailure of [new Error('internal decoder failure'), 'not an Error']) {
      /** 中文说明：变量 decoder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const decoder = NodePrivateZstdFrameDecoder.create()!
      /** 中文说明：变量 internals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const internals = decoder as unknown as PrivateDecoderInternals
      internals.stream[internals.errorKey] = internalFailure
      try {
        Array.from(decoder.decode(frame, range))
        throw new Error('expected internal decoder failure')
      } catch (error) {
        /** 中文说明：变量 cause 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const cause = (error as Error).cause
        if (internalFailure instanceof Error) {
          expect(cause).toBe(internalFailure)
        } else {
          expect(cause).toMatchObject({ message: 'Zstandard decoder exposed a non-Error internal failure' })
        }
      }
    }
  })

  it('distinguishes incomplete frame regions from invalid complete structure', () => {
    expect(scanZstdFrames(MAGIC.subarray(0, 2))).toEqual({ frames: [], tornStart: 0 })
    expect(scanZstdFrames(MAGIC)).toEqual({ frames: [], tornStart: 0 })
    expect(() => scanZstdFrames(Buffer.alloc(4))).toThrow(/invalid frame magic/)
    expect(() => scanZstdFrames(Buffer.concat([MAGIC, Buffer.from([0x08])]))).toThrow(/reserved frame-header bit/)

    // Non-single-segment descriptor with no window descriptor.
    expect(scanZstdFrames(Buffer.concat([MAGIC, Buffer.from([0x00])]))).toEqual({ frames: [], tornStart: 0 })
    // Single-segment header followed by only two bytes of the three-byte block header.
    expect(scanZstdFrames(Buffer.concat([MAGIC, Buffer.from([0x20, 0x00, 0x01, 0x00])]))).toEqual({
      frames: [],
      tornStart: 0,
    })

    /** 中文说明：变量 rawFiveBytes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rawFiveBytes = Buffer.from([(5 << 3) | 1, 0, 0])
    expect(scanZstdFrames(Buffer.concat([
      MAGIC,
      Buffer.from([0x20, 0x00]),
      rawFiveBytes,
      Buffer.from([0x01, 0x02]),
    ]))).toEqual({ frames: [], tornStart: 0 })

    /** 中文说明：变量 reservedBlock 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reservedBlock = Buffer.concat([
      MAGIC,
      Buffer.from([0x20, 0x00, 0x07, 0x00, 0x00]),
    ])
    expect(() => scanZstdFrames(reservedBlock)).toThrow(/reserved block type/)
  })

  it('covers standard header variants, RLE blocks, multiple blocks, and checksums', () => {
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const descriptor of [0x00, 0x21, 0x42, 0x83, 0xE3]) {
      /** 中文说明：变量 frame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const frame = emptyStructuralFrame(descriptor)
      expect(scanZstdFrames(frame)).toEqual({ frames: [{ start: 0, end: frame.length }] })
    }

    /** 中文说明：变量 rle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rle = Buffer.concat([
      MAGIC,
      Buffer.from([0x20, 0x01]),
      Buffer.from([(1 << 3) | (1 << 1) | 1, 0, 0]),
      Buffer.from([0x41]),
    ])
    expect(scanZstdFrames(rle)).toEqual({ frames: [{ start: 0, end: rle.length }] })

    /** 中文说明：变量 twoBlocks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const twoBlocks = Buffer.concat([
      MAGIC,
      Buffer.from([0x20, 0x00]),
      Buffer.from([0, 0, 0]),
      Buffer.from([1, 0, 0]),
    ])
    expect(scanZstdFrames(twoBlocks)).toEqual({ frames: [{ start: 0, end: twoBlocks.length }] })

    /** 中文说明：变量 checksummed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const checksummed = emptyStructuralFrame(0x24)
    expect(scanZstdFrames(checksummed.subarray(0, -1))).toEqual({ frames: [], tornStart: 0 })
    expect(scanZstdFrames(checksummed)).toEqual({ frames: [{ start: 0, end: checksummed.length }] })
  })
})

describe('JsonlSessionPersistence: default Zstandard encoding', () => {
  it('materializes an explicitly durable empty session as one header frame', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const m = meta('empty-zstd', '/work')
    const handle = await ctx.sessionPersistence.create(m)
    await handle.flush()
    await handle.close()

    const buffer = await readFile(logPath(root, '/work', m.id, 'zstd'))
    expect(scanZstdFrames(buffer).frames).toHaveLength(1)
    expect((await decodeCompleteFrames(buffer)).toString()).toBe(`${JSON.stringify(toHeaderLine(m))}\n`)
    await expect(readAll(ctx.sessionPersistence, m.id)).resolves.toMatchObject({ events: [] })
  })

  it('writes .jsonl.zstd by default with one header frame and one first-batch frame', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('default-zstd', '/work')
    await writeLog(ctx.sessionPersistence, header, oneTurnLog())

    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = logPath(root, header.cwd, header.id, 'zstd')
    /** 中文说明：变量 buffer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const buffer = await readFile(path)
    expect(buffer.subarray(0, 4)).toEqual(MAGIC)
    await expect(stat(logPath(root, header.cwd, header.id, 'none'))).rejects.toThrow()

    /** 中文说明：变量 scan 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scan = scanZstdFrames(buffer)
    expect(scan.frames).toHaveLength(2)
    /** 中文说明：变量 plaintext 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plaintext = await decodeCompleteFrames(buffer)
    expect(plaintext.toString()).toBe([
      JSON.stringify(toHeaderLine(header)),
      ...oneTurnLog().map(e => JSON.stringify(e)),
      '',
    ].join('\n'))
    expect((await readAll(ctx.sessionPersistence, header.id)).events).toEqual(oneTurnLog())
  })

  it('publishes v2 beside an unchanged compressed v0 source before returning a read handle', async () => {
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    const header = meta('zstd-v0-read', '/work')
    const sourcePath = generationLogPath(root, header.cwd, header.id, 0, 'zstd')
    const currentPath = logPath(root, header.cwd, header.id, 'zstd')
    const source = Buffer.concat([
      await compressZstdFrame(`${JSON.stringify(releasedV0Header(header))}\n`),
      await compressZstdFrame(`${releasedV1OneTurnLog().map(event => JSON.stringify(event)).join('\n')}\n`),
    ])
    await mkdir(sessionDir(root, header.cwd, header.id), { recursive: true })
    await writeFile(sourcePath, source)

    await expect(readAll(ctx.sessionPersistence, header.id)).resolves.toEqual({
      meta: { ...header, delegationDepth: 0 },
      events: oneTurnLog(),
    })

    expect(await readFile(sourcePath)).toEqual(source)
    const current = (await decodeCompleteFrames(await readFile(currentPath))).toString().split('\n')
    expect(JSON.parse(current[0] as string)).toMatchObject({
      id: header.id,
      version: SESSION_FORMAT_VERSION,
    })
  })


  it('a read rejects a present zstd artifact that carries no frame', async () => {
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('raw-zero-frame', '/work')
    await writeLog(ctx.sessionPersistence, header, oneTurnLog())
    // The path still exists, so zero frames is corruption rather than absence.
    await writeFile(logPath(root, '/work', header.id, 'zstd'), Buffer.alloc(0))
    await expect(readAll(ctx.sessionPersistence, header.id)).rejects.toThrow()
  })

  it('resolves the default when a programmatic wrapper bypasses Loader schema normalization', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    contexts.push(ctx)
    let backend!: JsonlSessionPersistence
    await ctx.plugin((inner: Context) => {
      backend = new JsonlSessionPersistence(inner, { root })
    })
    const header = meta('direct-default')
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = logPath(root, header.cwd, header.id, 'zstd')

    const events = oneTurnLog()
    await writeLog(backend, header, events)

    /** 中文说明：变量 plaintext 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plaintext = (await decodeCompleteFrames(await readFile(path))).toString()
    /** 中文说明：变量 recordTypes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const recordTypes = plaintext.trimEnd().split('\n')
      .map(line => (JSON.parse(line) as { type: string }).type)
    expect(recordTypes).not.toContain('text-chunks')
    const assistant = plaintext.trimEnd().split('\n')
      .map(line => JSON.parse(line) as { type: string; data?: { stream?: Array<{ type: string }> } })
      .find(record => record.type === 'assistant/message')
    expect(assistant?.data?.stream?.some(record => record.type === 'text-chunks')).toBe(true)
    expect((await readAll(backend, header.id)).events).toEqual(events)
  })

  it('appends one frame per durable batch without rewriting prior bytes', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('append-frame')
    const handle = await ctx.sessionPersistence.create(header)
    await handle.append(oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = await readFile(path)
    const secondTurn: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(6), time: 7, data: { turn: 2 } },
      { type: 'turn/end', seq: SessionSeq(7), time: 8, data: { turn: 2, reason: { kind: 'completed' } } },
    ]
    await handle.append(secondTurn)
    await handle.close()

    /** 中文说明：变量 after 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const after = await readFile(path)
    expect(after.subarray(0, before.length)).toEqual(before)
    expect(scanZstdFrames(after).frames).toHaveLength(3)
    expect((await readAll(ctx.sessionPersistence, header.id)).events).toEqual([...oneTurnLog(), ...secondTurn])
  })

  it('lists from a multi-chunk header frame without decoding a corrupt event frame', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('large-header', `/work/${'x'.repeat(24_000)}`)
    await writeLog(ctx.sessionPersistence, header, oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    /** 中文说明：变量 buffer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const buffer = Buffer.from(await readFile(path))
    /** 中文说明：变量 eventFrame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const eventFrame = scanZstdFrames(buffer).frames[1]!
    buffer[eventFrame.end - 1] = buffer[eventFrame.end - 1]! ^ 0xFF
    await writeFile(path, buffer)

    expect((await ctx.sessionPersistence.list()).map(item => item.header.id)).toEqual([header.id])
    await expect(readAll(ctx.sessionPersistence, header.id)).rejects.toThrow(/frame at byte .* failed validation/)
  })

  it('stops multi-frame inspection when cancellation arrives at a slice deadline', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('cancel-zstd-frames')
    /** 中文说明：变量 headerFrame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const headerFrame = await compressZstdFrame(`${JSON.stringify(toHeaderLine(header))}\n`)
    /** 中文说明：变量 eventFrame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const eventFrame = await compressZstdFrame(`${JSON.stringify(oneTurnLog()[0])}\n`)
    /** 中文说明：变量 laterFrame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const laterFrame = await compressZstdFrame(`${JSON.stringify(oneTurnLog()[1])}\n`)
    /** 中文说明：变量 stream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stream = Buffer.concat([headerFrame, eventFrame, laterFrame])
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('cancel after Zstandard decode starts')
    /** 中文说明：变量 reader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reader = ctx.sessionPersistence as unknown as ZstdReaderInternals
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(501)
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = reader.readZstdPrefix(stream, controller.signal)
    queueMicrotask(() => { controller.abort(reason) })

    await expect(pending).rejects.toBe(reason)
  })

  it('continues decoding every frame after a slice deadline yields', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('yield-zstd-frames')
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = oneTurnLog().slice(0, 2)
    /** 中文说明：变量 headerFrame 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const headerFrame = await compressZstdFrame(`${JSON.stringify(toHeaderLine(header))}\n`)
    /** 中文说明：函数值 eventFrames 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const eventFrames = await Promise.all(events.map(async event => (
      compressZstdFrame(`${JSON.stringify(event)}\n`)
    )))
    /** 中文说明：变量 stream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stream = Buffer.concat([headerFrame, ...eventFrames])
    /** 中文说明：变量 reader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reader = ctx.sessionPersistence as unknown as ZstdReaderInternals
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(501)

    /** 中文说明：变量 prefix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prefix = await reader.readZstdPrefix(stream)

    expect(prefix.events).toEqual(events)
  })

  it.each(['none', 'zstd'] as const)(
    'observes cancellation after each async %s header read during listing',
    async (compression) => {
      /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const root = await freshRoot()
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = await mount(root, compression)
      /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const header = meta(`cancel-${compression}-header-read`, '/work')
      await writeLog(ctx.sessionPersistence, header, oneTurnLog())
      await ctx.sessionPersistence.list()
      /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const path = logPath(root, header.cwd, header.id, compression)
      /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const probe = await open(path, 'r')
      /** 中文说明：变量 prototype 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const prototype = Object.getPrototypeOf(probe) as { read: HeaderRead }
      /** 中文说明：变量 originalRead 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const originalRead = prototype.read
      await probe.close()
      /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const controller = new AbortController()
      /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const reason = new Error(`cancel ${compression} header read`)
      /** 中文说明：变量 read 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const read = vi.spyOn(prototype, 'read').mockImplementation(async function (
        this: FileHandle,
        buffer: Buffer,
        offset: number,
        length: number,
        position: number | null,
      ) {
        /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const result = await originalRead.call(this, buffer, offset, length, position)
        controller.abort(reason)
        return result
      })

      await expect(ctx.sessionPersistence.list({ signal: controller.signal })).rejects.toBe(reason)
      expect(read).toHaveBeenCalledTimes(1)
    },
  )

  it('recovers complete records from a torn final frame and rewrites them on the next append', async () => {
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('recover-torn', '/proj')
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await writeLog(ctx.sessionPersistence, header, oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    /** 中文说明：变量 committed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const committed = await readFile(path)
    const openTurn: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(6), time: 7, data: { turn: 2 } },
      { type: 'step/start', seq: SessionSeq(7), time: 8, data: { turn: 2, step: 1 } },
      {
        type: 'assistant/attempt',
        seq: SessionSeq(8),
        time: 9,
        data: {
          turn: 2,
          step: 1,
          stream: [{ type: 'text-chunks', time0: 9, index: 0, dt: [], texts: [deterministicNoise(300_000)] }],
        },
      },
    ]
    const plaintext = openTurn.map(e => JSON.stringify(e)).join('\n') + '\n'
    await appendFile(path, await tornFrame(plaintext, (decoded) => {
      const newlines = decoded.match(/\n/g)?.length ?? 0
      return newlines >= 2 && !decoded.endsWith('\n')
    }))

    // Complete JSONL records already flushed into the torn frame are real
    // emitted events: reads recover them, while the half-written chunk stays
    // invisible and the file keeps its bytes until the write path repairs it.
    const loaded = await readAll(ctx.sessionPersistence, header.id)
    expect(loaded.events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(loaded.events[6]).toEqual(openTurn[0])
    expect(loaded.events[7]).toEqual(openTurn[1])

    // The first append truncates the torn bytes and rewrites the recovered
    // records durably before the new batch, continuing at their next-seq.
    const closers: SessionEvent[] = [
      { type: 'step/end', seq: SessionSeq(8), time: 10, data: { turn: 2, step: 1 } },
      { type: 'turn/end', seq: SessionSeq(9), time: 11, data: { turn: 2, reason: { kind: 'interrupted' } } },
    ]
    await appendBatch(ctx.sessionPersistence, header.id, closers)
    expect(warn).toHaveBeenCalledWith('session-persistence-jsonl: session "recover-torn" recovered from a torn tail; incomplete tail bytes were discarded')

    /** 中文说明：变量 repaired 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const repaired = await readFile(path)
    expect(repaired.subarray(0, committed.length)).toEqual(committed)
    expect(scanZstdFrames(repaired).tornStart).toBeUndefined()
    expect(scanLog(await decodeCompleteFrames(repaired)).events)
      .toEqual([...oneTurnLog(), openTurn[0]!, openTurn[1]!, ...closers])
  })

  it('retries the torn-tail rewrite when its first durable write fails', async () => {
    const root = await freshRoot()
    const ctx = await mount(root)
    const header = meta('retry-torn-rewrite', '/proj')
    vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await writeLog(ctx.sessionPersistence, header, oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    const recovered: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(6), time: 7, data: { turn: 2 } },
      { type: 'step/start', seq: SessionSeq(7), time: 8, data: { turn: 2, step: 1 } },
      {
        type: 'assistant/attempt',
        seq: SessionSeq(8),
        time: 9,
        data: {
          turn: 2,
          step: 1,
          stream: [{ type: 'text-chunks', time0: 9, index: 0, dt: [], texts: [deterministicNoise(300_000)] }],
        },
      },
    ]
    await appendFile(path, await tornFrame(recovered.map(e => JSON.stringify(e)).join('\n') + '\n', (decoded) => {
      const newlines = decoded.match(/\n/g)?.length ?? 0
      return newlines >= 2 && !decoded.endsWith('\n')
    }))

    const handle = await ctx.sessionPersistence.open(header.id, 'write')
    try {
      const failure = new Error('rewrite refused')
      const service = ctx.sessionPersistence as unknown as { persistBatch: () => Promise<void> }
      vi.spyOn(service, 'persistBatch').mockRejectedValueOnce(failure)
      const closers: SessionEvent[] = [
        { type: 'step/end', seq: SessionSeq(8), time: 10, data: { turn: 2, step: 1 } },
        { type: 'turn/end', seq: SessionSeq(9), time: 11, data: { turn: 2, reason: { kind: 'interrupted' } } },
      ]
      // The rewrite of the recovered records fails first; the retained repair
      // state makes the retried append rewrite them exactly once.
      await expect(handle.append(closers)).rejects.toBe(failure)
      await handle.append(closers)
    } finally {
      await handle.close()
    }

    const repaired = await readFile(path)
    expect(scanZstdFrames(repaired).tornStart).toBeUndefined()
    expect(scanLog(await decodeCompleteFrames(repaired)).events.map(e => e.seq))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('drops a frame torn in its header before it has produced plaintext', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('partial-magic')
    await writeLog(ctx.sessionPersistence, header, oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    /** 中文说明：变量 committed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const committed = await readFile(path)
    await appendFile(path, MAGIC.subarray(0, 2))

    expect((await readAll(ctx.sessionPersistence, header.id)).events).toEqual(oneTurnLog())
    // Reads never repair: the torn bytes stay until a write-path append.
    expect(await readFile(path)).toEqual(Buffer.concat([committed, MAGIC.subarray(0, 2)]))
  })

  it('recovers a final frame torn at its checksum byte in full', async () => {
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('partial-checksum')
    await writeLog(ctx.sessionPersistence, header, oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    const committed = await readFile(path)
    const secondTurn: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(6), time: 7, data: { turn: 2 } },
      { type: 'turn/end', seq: SessionSeq(7), time: 8, data: { turn: 2, reason: { kind: 'completed' } } },
    ]
    const frame = await compressZstdFrame(secondTurn.map(e => JSON.stringify(e)).join('\n') + '\n')
    await appendFile(path, frame.subarray(0, -1))

    // One missing checksum byte leaves the frame structurally torn, but its
    // complete records decode in full: reads recover them, and the next
    // append rewrites them as a complete checksummed frame.
    const loaded = await readAll(ctx.sessionPersistence, header.id)
    expect(loaded.events).toEqual([...oneTurnLog(), ...secondTurn])
    const thirdTurn: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(8), time: 9, data: { turn: 3 } },
      { type: 'turn/end', seq: SessionSeq(9), time: 10, data: { turn: 3, reason: { kind: 'completed' } } },
    ]
    await appendBatch(ctx.sessionPersistence, header.id, thirdTurn)
    const repaired = await readFile(path)
    expect(repaired.subarray(0, committed.length)).toEqual(committed)
    expect(scanZstdFrames(repaired).tornStart).toBeUndefined()
    expect(scanLog(await decodeCompleteFrames(repaired)).events).toEqual([...oneTurnLog(), ...secondTurn, ...thirdTurn])
  })

  it('rejects a complete frame containing a torn JSONL record', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('complete-bad-jsonl')
    await writeLog(ctx.sessionPersistence, header, oneTurnLog())
    await appendFile(
      logPath(root, header.cwd, header.id, 'zstd'),
      await compressZstdFrame('{"type":"turn/start"'),
    )
    await expect(readAll(ctx.sessionPersistence, header.id)).rejects.toThrow(/complete frame contains a torn JSONL record/)
  })

  it('rolls back a checksummed append frame when fsync fails', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('zstd-fsync-rollback')
    const handle = await ctx.sessionPersistence.create(header)
    await handle.append(oneTurnLog())
    const path = logPath(root, header.cwd, header.id, 'zstd')
    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = await readFile(path)

    const probe = await open(path, 'r')
    const prototype = Object.getPrototypeOf(probe) as { sync: () => Promise<void> }
    await probe.close()
    const realSync = prototype.sync
    /** 中文说明：变量 failed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let failed = false
    /** 中文说明：变量 spy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spy = vi.spyOn(prototype, 'sync').mockImplementation(async function (this: FileHandle) {
      if (!failed) {
        failed = true
        throw new Error('simulated Zstandard fsync failure')
      }
      return realSync.call(this)
    })
    const secondTurn: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(6), time: 7, data: { turn: 2 } },
      { type: 'turn/end', seq: SessionSeq(7), time: 8, data: { turn: 2, reason: { kind: 'completed' } } },
    ]
    await expect(handle.append(secondTurn)).rejects.toThrow(/simulated Zstandard fsync failure/)
    expect(await readFile(path)).toEqual(before)
    spy.mockRestore()
    await handle.append(secondTurn)
    await handle.close()
    expect((await readAll(ctx.sessionPersistence, header.id)).events).toEqual([...oneTurnLog(), ...secondTurn])
  })

  it('skips empty, incomplete, and non-header compressed artifacts while rejecting malformed header frames', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const [id, content] of [
      ['empty', Buffer.alloc(0)],
      ['partial', MAGIC],
      ['not-header', await compressZstdFrame('{"type":"turn/start"}\n')],
    ] as const) {
      /** 中文说明：变量 sessionId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const sessionId = SessionId(id)
      await mkdir(sessionDir(root, undefined, sessionId), { recursive: true })
      await writeFile(logPath(root, undefined, sessionId, 'zstd'), content)
    }
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    expect(await ctx.sessionPersistence.list()).toEqual([])

    /** 中文说明：变量 twoLinesId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const twoLinesId = SessionId('two-lines')
    await mkdir(sessionDir(root, undefined, twoLinesId), { recursive: true })
    await writeFile(logPath(root, undefined, twoLinesId, 'zstd'), await compressZstdFrame([
      JSON.stringify(toHeaderLine(meta('two-lines'))),
      JSON.stringify({ type: 'turn/start' }),
      '',
    ].join('\n')))
    await expect(ctx.sessionPersistence.list()).rejects.toThrow(/first frame is not exactly one header line/)
    await expect(ctx.sessionPersistence.open(twoLinesId, 'read'))
      .rejects.toThrow(/first frame is not exactly one header line/)
  })

  it('rejects missing, empty, and checksum-corrupt header frames on targeted reads', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const id of ['partial-only', 'empty-header', 'bad-checksum']) {
      await mkdir(sessionDir(root, undefined, SessionId(id)), { recursive: true })
    }
    await writeFile(logPath(root, undefined, SessionId('partial-only'), 'zstd'), MAGIC)
    await writeFile(logPath(root, undefined, SessionId('empty-header'), 'zstd'), await compressZstdFrame(''))
    /** 中文说明：变量 corruptHeader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const corruptHeader = Buffer.from(await compressZstdFrame(`${JSON.stringify(toHeaderLine(meta('bad-checksum')))}\n`))
    corruptHeader[corruptHeader.length - 1] = corruptHeader[corruptHeader.length - 1]! ^ 0xFF
    await writeFile(logPath(root, undefined, SessionId('bad-checksum'), 'zstd'), corruptHeader)
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)

    await expect(ctx.sessionPersistence.open(SessionId('partial-only'), 'read'))
      .rejects.toThrow(/empty or header-less Zstandard session log/)
    await expect(ctx.sessionPersistence.open(SessionId('empty-header'), 'read'))
      .rejects.toThrow(/first frame is not exactly one header line/)
    await expect(ctx.sessionPersistence.list()).rejects.toThrow(/header frame failed validation/)
  })
})

describe('JsonlSessionPersistence: encoding selection', () => {
  it('rejects roots owned by the opposite encoding in both directions', async () => {
    /** 中文说明：变量 rawRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rawRoot = await freshRoot('dsh-jsonl-raw-mismatch-')
    /** 中文说明：变量 raw 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const raw = await mount(rawRoot, 'none')
    await writeLog(raw.sessionPersistence, meta('raw-log'), oneTurnLog())
    const defaultBackend = await mount(rawRoot)
    await expect(defaultBackend.sessionPersistence.list()).rejects.toThrow(/configured for compression "zstd"/)

    /** 中文说明：变量 zstdRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const zstdRoot = await freshRoot('dsh-jsonl-zstd-mismatch-')
    /** 中文说明：变量 zstd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const zstd = await mount(zstdRoot)
    await writeLog(zstd.sessionPersistence, meta('zstd-log'), oneTurnLog())
    const rawBackend = await mount(zstdRoot, 'none')
    await expect(rawBackend.sessionPersistence.list()).rejects.toThrow(/configured for compression "none"/)
  })

  it('rechecks targeted artifacts and listing after an initially empty root', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    expect(await ctx.sessionPersistence.list()).toEqual([])

    /** 中文说明：变量 loadHeader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loadHeader = meta('late-raw-load', '/late')
    await mkdir(sessionDir(root, loadHeader.cwd, loadHeader.id), { recursive: true })
    await writeFile(logPath(root, loadHeader.cwd, loadHeader.id, 'none'), [
      JSON.stringify(toHeaderLine(loadHeader)),
      ...oneTurnLog().map(e => JSON.stringify(e)),
      '',
    ].join('\n'))
    await expect(ctx.sessionPersistence.open(loadHeader.id, 'read')).rejects.toThrow(/uses \.jsonl/)
    await expect(ctx.sessionPersistence.open(loadHeader.id, 'write')).rejects.toThrow(/uses \.jsonl/)
    await expect(ctx.sessionPersistence.list()).rejects.toThrow(/uses \.jsonl/)
  })

  it('refuses materialization when an opposite artifact appears after create', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await freshRoot()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await mount(root)
    await ctx.sessionPersistence.list()
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('late-raw-materialize', '/late')
    const handle = await ctx.sessionPersistence.create(header)
    await mkdir(sessionDir(root, header.cwd, header.id), { recursive: true })
    await writeFile(logPath(root, header.cwd, header.id, 'none'), [
      JSON.stringify(toHeaderLine(header)),
      ...oneTurnLog().map(e => JSON.stringify(e)),
      '',
    ].join('\n'))
    await expect(handle.append(oneTurnLog())).rejects.toThrow(/uses \.jsonl/)
    await handle.close()
    expect((await readdir(sessionDir(root, header.cwd, header.id))).some(name => name.endsWith('.jsonl.zstd'))).toBe(false)
  })
})
