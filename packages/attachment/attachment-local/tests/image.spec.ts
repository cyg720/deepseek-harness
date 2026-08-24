/**
 * 文件职责：验证本地附件图片检测对支持格式、尺寸限制、损坏字节、动画、方向和元数据的判断。
 * 技术维度：使用sharp动态生成栅格图片，再用Vitest断言完整解码与快速探测结果。
 * 产品维度：确保只有格式和尺寸真实可信的图片能进入附件准入与持久读取流程。
 * 逻辑维度：生成四种格式的最小图片，覆盖正常检测、像素限制、截断数据、多帧和EXIF方向。
 * 关键边界：动态夹具依赖sharp/libvips；截断图片可能有可读头部但完整解码仍必须失败。
 * 新手阅读建议：先看raster如何生成统一输入，再从基本格式用例读到方向和元数据等特殊情况。
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { detectImage, probeImage } from '../src/image.ts'

/**
 * 生成固定3×2、完全不透明的受支持格式图片。
 * @param format sharp目标格式。
 * @returns 完整编码图片字节。
 * @example await raster('png')
 */
async function raster(format: 'png' | 'jpeg' | 'webp' | 'gif'): Promise<Uint8Array> {
  // 含固定颜色像素的sharp图片管线。
  const image = sharp({
    create: { width: 3, height: 2, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  })
  return new Uint8Array(await image.toFormat(format).toBuffer())
}

describe('raster decoding', () => {
  it('decodes every supported format and its intrinsic dimensions', async () => {
    for (const [format, mediaType] of [
      ['png', 'image/png'],
      ['jpeg', 'image/jpeg'],
      ['webp', 'image/webp'],
      ['gif', 'image/gif'],
    ] as const) {
      await expect(detectImage(await raster(format)))
        .resolves.toMatchObject({ mediaType, width: 3, height: 2, animated: false, carriesMetadata: false, depth: 'uchar', space: 'srgb' })
    }
  })

  it('rejects excess decoded pixels before decoding', async () => {
    await expect(detectImage(await raster('png'), { maxPixels: 5 }))
      .rejects.toMatchObject({ code: 'IMAGE_TOO_MANY_PIXELS' })
  })

  it('rejects a side above the per-side limit and accepts a side exactly at it', async () => {
    await expect(detectImage(await raster('png'), { maxDimension: 2 }))
      .rejects.toMatchObject({ code: 'IMAGE_DIMENSION_TOO_LARGE' })
    await expect(detectImage(await raster('png'), { maxDimension: 3 }))
      .resolves.toMatchObject({ mediaType: 'image/png', width: 3, height: 2, animated: false, carriesMetadata: false, depth: 'uchar', space: 'srgb' })
  })

  it('rejects malformed bytes and truncated payloads with readable headers', async () => {
    await expect(detectImage(Uint8Array.of(1, 2, 3)))
      .rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    const unsupported = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).tiff().toBuffer()
    await expect(detectImage(unsupported)).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    const complete = await raster('png')
    const truncated = complete.subarray(0, 62)
    await expect(sharp(truncated).metadata()).resolves.toMatchObject({ width: 3, height: 2 })
    await expect(detectImage(truncated)).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
  })

  it('reports animation from a multi-frame container and perceived axes from EXIF orientation', async () => {
    const header = Buffer.from('47494638396101000100800000000000ffffff', 'hex')
    const frame = Buffer.from('21f90401000000002c0000000001000100000202440100', 'hex')
    const twoFrameGif = Uint8Array.from(Buffer.concat([header, frame, frame, Buffer.from('3b', 'hex')]))
    await expect(detectImage(twoFrameGif)).resolves.toMatchObject({ mediaType: 'image/gif', animated: true })

    const oriented = new Uint8Array(await sharp({
      create: { width: 4, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer())
    await expect(detectImage(oriented)).resolves.toMatchObject({
      mediaType: 'image/jpeg', width: 2, height: 4, animated: false, carriesMetadata: true,
    })

    const flipped = new Uint8Array(await sharp({
      create: { width: 4, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().withMetadata({ orientation: 3 }).toBuffer())
    await expect(detectImage(flipped)).resolves.toMatchObject({
      mediaType: 'image/jpeg', width: 4, height: 2, animated: false, carriesMetadata: true,
    })
  })

  it('reports color profiles and encoder metadata as metadata', async () => {
    const profiled = new Uint8Array(await sharp({
      create: { width: 4, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().withIccProfile('p3').toBuffer())
    await expect(detectImage(profiled)).resolves.toMatchObject({ carriesMetadata: true })

    const commented = new Uint8Array(await sharp({
      create: { width: 4, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().withMetadata().toBuffer())
    await expect(detectImage(commented)).resolves.toMatchObject({ carriesMetadata: true })
  })

  it('probes malformed bytes and unsupported formats into the same stable error', async () => {
    await expect(probeImage(Uint8Array.of(1, 2, 3)))
      .rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    const unsupported = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).tiff().toBuffer()
    await expect(probeImage(unsupported)).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
  })
})
