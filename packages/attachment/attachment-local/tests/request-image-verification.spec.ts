import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

// 提升到 mock 初始化前的可变控制状态；true 时伪造宽度不一致。
const control = vi.hoisted(() => ({ mismatch: false }))

// 部分模拟图片模块，只包装 detectImage 并保留其他真实导出。
vi.mock('../src/image.ts', async (importOriginal) => {
  // 图片模块真实实现。
  const actual = await importOriginal<typeof import('../src/image.ts')>()
  return {
    ...actual,
    /** 检测图片并可伪造宽度。@param data 图片字节。@returns 真实或宽度加一的检测结果。 */
    async detectImage(data: Uint8Array): Promise<Awaited<ReturnType<typeof actual.detectImage>>> {
      // 真实检测元数据。
      const detected = await actual.detectImage(data)
      return control.mismatch ? { ...detected, width: detected.width + 1 } : detected
    },
  }
})

import LocalAttachmentStore from '../src/index.ts'

// 测试创建的附件 home 目录列表。
const homes: string[] = []

// 重置 mock 并递归删除全部临时 home。
afterEach(async () => {
  control.mismatch = false
  // home 是单个受控临时目录。
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

// 请求图片元数据验证测试套件。
describe('request image verification', () => {
  // 验证解码宽度与编码结果不一致时拒绝模型请求图片。
  it('rejects an encoded request whose decoded facts disagree with the encoder result', async () => {
    // 本用例临时 DSH home。
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-request-verification-'))
    homes.push(dshHome)
    // 绑定临时 home 的本地附件存储。
    const attachments = new LocalAttachmentStore(new Context(), { dshHome })
    // Sharp 生成的 64×32 三通道 PNG 字节。
    const source = new Uint8Array(await sharp({
      create: { width: 64, height: 32, channels: 3, background: { r: 12, g: 34, b: 56 } },
    }).png().toBuffer())
    // 已持久化源图片引用。
    const attachment = await attachments.saveImage({ data: source, mediaType: 'image/png' })
    control.mismatch = true

    await expect(attachments.readImageRequest(attachment, { maxPixels: 16 * 16, maxBytes: 1024 * 1024 }))
      .rejects.toMatchObject({
        code: 'ATTACHMENT_WRITE_FAILED',
        message: 'Encoded model-request image does not match its verified 8-bit sRGB metadata.',
      })
  })
})
/**
 * 文件职责：验证模型请求图片编码结果的解码事实必须与编码器报告元数据一致。
 * 技术维度：使用 Vitest hoisted 控制、模块部分 mock、Sharp 生成真实 PNG 和临时附件存储。
 * 产品维度：阻止损坏或错误标注的压缩图片进入模型请求，保持像素与颜色元数据可信。
 * 逻辑维度：mock detectImage 可制造宽度偏差；测试保存源图，启用 mismatch，再读取请求图片并断言写入失败。
 * 关键边界：每例重置 mismatch 并删除临时 home；只修改检测返回宽度，不改变真实图片字节。
 * 新手阅读建议：先看 control/vi.mock，再跟踪 dshHome、source、attachment、mismatch 和最终错误。
 */
