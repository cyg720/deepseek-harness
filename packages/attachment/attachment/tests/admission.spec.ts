/**
 * 文件职责：验证线协议Base64图片批次在进入附件存储前的解码、顺序和错误传播。
 * 技术维度：使用Vitest模拟AttachmentStore.saveImages，并以确定性引用观察委托输入。
 * 产品维度：确保畸形上传在任何存储调用前被拒绝，合法批次按用户消息顺序持久化。
 * 逻辑维度：构造记录批次的存储替身，覆盖有名/无名图片、空批次、非法Base64和后端拒绝。
 * 关键边界：只接受规范且非空的Base64；该层不吞掉存储错误；空批次仍原样委托。
 * 新手阅读建议：先看storeOf返回的替身，再比较合法批次和非法Base64用例中的saveImages调用次数。
 */
import { describe, expect, it, vi } from 'vitest'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment/types'

// 规范Base64测试值，解码后恰好为3字节。
const PNG = 'AAAA' // canonical base64, 3 bytes

/** Delegation double: records the exact saveImages batch and answers ordered refs. */
/**
 * 创建记录精确saveImages批次并返回有序引用的委托替身。
 * @returns 类型化存储接口及可断言的模拟对象。
 * @example storeOf()
 */
function storeOf() {
  // 只实现被测准入函数使用的saveImages方法的对象。
  const store = {
    saveImages: vi.fn((inputs: readonly SaveImageAttachment[]) => Promise.resolve(inputs.map((input, index): ImageAttachmentRef => ({
      attachmentId: `att-${index + 1}` as ImageAttachmentRef['attachmentId'],
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    })))),
  }
  return { store: store as unknown as AttachmentStore, mocks: store }
}

describe('admitEncodedImages', () => {
  it('decodes every member and delegates one ordered batch to saveImages', async () => {
    const { store, mocks } = storeOf()
    const refs = await admitEncodedImages(store, [
      { mediaType: 'image/png', data: PNG, name: 'first.png' },
      { mediaType: 'image/jpeg', data: PNG, name: 'second.jpg' },
    ])
    expect(mocks.saveImages).toHaveBeenCalledTimes(1)
    const batch = mocks.saveImages.mock.calls[0]?.[0] as readonly SaveImageAttachment[]
    expect(batch.map(input => [input.name, input.mediaType, input.data.byteLength]))
      .toEqual([['first.png', 'image/png', 3], ['second.jpg', 'image/jpeg', 3]])
    expect(refs.map(ref => ref.attachmentId)).toEqual(['att-1', 'att-2'])
  })

  it('omits the name from store inputs when the upload has none', async () => {
    const { store, mocks } = storeOf()
    const refs = await admitEncodedImages(store, [{ mediaType: 'image/webp', data: PNG }])
    const batch = mocks.saveImages.mock.calls[0]?.[0] as readonly SaveImageAttachment[]
    expect('name' in (batch[0] as object)).toBe(false)
    expect(refs[0]?.name).toBeUndefined()
  })

  it('delegates an empty batch unchanged', async () => {
    const { store, mocks } = storeOf()
    await expect(admitEncodedImages(store, [])).resolves.toEqual([])
    expect(mocks.saveImages).toHaveBeenCalledWith([])
  })

  it('rejects non-canonical and empty base64 payloads before any store call', async () => {
    const { store, mocks } = storeOf()
    for (const data of ['', 'AAA', '!!!!']) {
      await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data }]))
        .rejects.toMatchObject({ name: 'AttachmentError', code: 'INVALID_IMAGE_BASE64' })
    }
    expect(mocks.saveImages).not.toHaveBeenCalled()
  })

  it('propagates the store batch rejection unchanged', async () => {
    const { store, mocks } = storeOf()
    const refused = Object.assign(new Error('Image batch exceeds the configured image-count limit.'), { code: 'TOO_MANY_IMAGES' })
    mocks.saveImages.mockRejectedValueOnce(refused)
    await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data: PNG }])).rejects.toBe(refused)
  })
})
