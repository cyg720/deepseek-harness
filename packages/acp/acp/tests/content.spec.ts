/**
 * 文件职责：单元验证 ACP 富内容编解码器的图片能力判断、严格准入、取消和输出投影。
 * 技术维度：使用 Vitest 模拟函数、最小 Cordis 上下文和伪附件引用隔离内容转换逻辑。
 * 产品维度：防止畸形图片、错误路由或损坏附件进入自动化会话，同时保持文本图片顺序。
 * 逻辑维度：构造可配置夹具，测试初始化能力、全量预验证、写入失败分类、取消时机和输出转换。
 * 关键边界：模拟对象只实现被测函数读取的服务成员；附件引用和模型能力均使用确定值。
 * 新手阅读建议：先看 admissionFixture 的最小依赖，再按准入前置条件、持久化和重建三个阶段阅读用例。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import {
  AcpContentError,
  admitAcpPrompt,
  assistantBlockToAcp,
  supportsAcpImagePrompts,
} from '../src/content.ts'

// 所有用例复用的最小合法图片附件引用。
const REF: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'1'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}

/** 内容准入测试所需的上下文、代理和可观察模拟函数。 */
interface AdmissionFixture {
  /** 只实现附件与 LLM 查询的最小 Cordis 上下文。 */
  ctx: Context
  route: ModelSelection | undefined
  saveImages: ReturnType<typeof vi.fn<(inputs: readonly SaveImageAttachment[]) => Promise<readonly ImageAttachmentRef[]>>>
  /** 可断言精确路由并覆盖能力结果的模型查询模拟函数。 */
  resolveModelInfo: ReturnType<typeof vi.fn>
}

/**
 * 构造具有可选服务和路由覆盖的最小内容准入夹具。
 * @param options 控制附件、LLM、默认路由和请求头路由是否存在。
 * @returns 可直接传给内容函数并观察调用的夹具。
 * @example admissionFixture({ attachments: false })
 */
function admissionFixture(options: {
  attachments?: boolean
  llm?: boolean
  provider?: string | undefined
  model?: string | undefined
} = {}): AdmissionFixture {
  // 按输入顺序生成确定性附件引用的批量保存模拟函数。
  const saveImages = vi.fn(async (inputs: readonly SaveImageAttachment[]) => inputs.map((input, index) => ({
    ...REF,
    attachmentId: AttachmentId(`sha256:${String(index + 1).padStart(64, '0')}`),
    mediaType: input.mediaType,
    bytes: input.data.byteLength,
  })))
  // 默认声明文本与图片输入能力的模型查询模拟函数。
  const resolveModelInfo = vi.fn(async (provider: string, model: string) => ({
    provider,
    id: model,
    name: model,
    inputModalities: ['text', 'image'] as const,
  }))
  // options 可显式关闭的最小附件服务。
  const attachments = options.attachments === false ? undefined : { saveImages }
  // options 可显式关闭的最小 LLM 服务。
  const llm = options.llm === false ? undefined : { resolveModelInfo }
  // 根据服务名称返回上述伪服务的最小上下文。
  const ctx = {
    get(name: string) {
      if (name === 'attachments') return attachments
      if (name === 'llm') return llm
      return undefined
    },
  } as unknown as Context
  // 允许测试显式传入 undefined 的默认提供方。
  const provider = 'provider' in options ? options.provider : 'mock'
  // 允许测试显式传入 undefined 的默认模型。
  const model = 'model' in options ? options.model : 'vision'
  const route = provider === undefined || model === undefined ? undefined : { provider, model }
  return { ctx, route, saveImages, resolveModelInfo }
}

describe('ACP rich content codec', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('advertises image input only when every deployment prerequisite is explicit', async () => {
    const absent = (attachments: unknown, llm: unknown): Context => ({
      get: (name: string) => name === 'attachments' ? attachments : name === 'llm' ? llm : undefined,
    }) as unknown as Context
    const store = { imageLimits: { mediaTypes: ['image/png'] } }
    const noMediaStore = { imageLimits: { mediaTypes: [] } }
    const imageLlm = { resolveModelInfo: vi.fn().mockResolvedValue({ inputModalities: ['text', 'image'] }) }
    const textLlm = { resolveModelInfo: vi.fn().mockResolvedValue({ inputModalities: ['text'] }) }
    const unknownLlm = { resolveModelInfo: vi.fn().mockResolvedValue({}) }
    const brokenLlm = { resolveModelInfo: vi.fn().mockRejectedValue(new Error('catalog down')) }

    await expect(supportsAcpImagePrompts(absent(undefined, imageLlm), 'p', 'm')).resolves.toBe(false)
    await expect(supportsAcpImagePrompts(absent(store, undefined), 'p', 'm')).resolves.toBe(false)
    await expect(supportsAcpImagePrompts(absent(store, imageLlm), undefined, 'm')).resolves.toBe(false)
    await expect(supportsAcpImagePrompts(absent(store, imageLlm), 'p', undefined)).resolves.toBe(false)
    await expect(supportsAcpImagePrompts(absent(noMediaStore, imageLlm), 'p', 'm')).resolves.toBe(false)
    await expect(supportsAcpImagePrompts(absent(store, brokenLlm), 'p', 'm')).resolves.toBe(false)
    await expect(supportsAcpImagePrompts(absent(store, unknownLlm), 'p', 'm')).resolves.toBe(false)
    await expect(supportsAcpImagePrompts(absent(store, textLlm), 'p', 'm')).resolves.toBe(false)
    await expect(supportsAcpImagePrompts(absent(store, imageLlm), 'p', 'm')).resolves.toBe(true)
  })

  it('validates every rich wire block before any image write', async () => {
    const fixture = admissionFixture()
    const signal = new AbortController().signal

    await expect(admitAcpPrompt(fixture.ctx, fixture.route, [
      { type: 'image', data: 'AQ==', mimeType: 'image/tiff' },
    ] as never, true, signal)).rejects.toThrow(/mimeType/)
    await expect(admitAcpPrompt(fixture.ctx, fixture.route, [
      { type: 'image', data: 'not base64', mimeType: 'image/png' },
    ], true, signal)).rejects.toThrow(/canonical base64/)
    await expect(admitAcpPrompt(fixture.ctx, fixture.route, [
      { type: 'image', data: 'AB==', mimeType: 'image/png' },
    ], true, signal)).rejects.toThrow(/canonical base64/)
    await expect(admitAcpPrompt(fixture.ctx, fixture.route, [
      { type: 'audio', data: 'AQ==', mimeType: 'audio/wav' },
    ], true, signal)).rejects.toThrow(/audio prompt/)
    await expect(admitAcpPrompt(fixture.ctx, fixture.route, [
      { type: 'resource', resource: { uri: 'file:///tmp/a', text: 'a' } },
    ], true, signal)).rejects.toThrow(/embedded resource/)
    expect(fixture.saveImages).not.toHaveBeenCalled()
  })

  it('requires the advertised capability, store, and exact image-capable route', async () => {
    const prompt = [{ type: 'image', data: 'AQ==', mimeType: 'image/png' }] as const
    const capable = admissionFixture()
    await expect(admitAcpPrompt(capable.ctx, capable.route, prompt, false, new AbortController().signal))
      .rejects.toThrow(/not advertised/)

    const noStore = admissionFixture({ attachments: false })
    await expect(admitAcpPrompt(noStore.ctx, noStore.route, prompt, true, new AbortController().signal))
      .rejects.toThrow(/no attachment store/)

    const noProvider = admissionFixture({ provider: undefined })
    await expect(admitAcpPrompt(noProvider.ctx, noProvider.route, prompt, true, new AbortController().signal))
      .rejects.toThrow(/route could not be resolved/)
    const noModel = admissionFixture({ model: undefined })
    await expect(admitAcpPrompt(noModel.ctx, noModel.route, prompt, true, new AbortController().signal))
      .rejects.toThrow(/route could not be resolved/)
    const noLlm = admissionFixture({ llm: false })
    await expect(admitAcpPrompt(noLlm.ctx, noLlm.route, prompt, true, new AbortController().signal))
      .rejects.toThrow(/route could not be resolved/)

    const broken = admissionFixture()
    broken.resolveModelInfo.mockRejectedValueOnce(new Error('catalog down'))
    const routeFailure = admitAcpPrompt(broken.ctx, broken.route, prompt, true, new AbortController().signal)
    await expect(routeFailure).rejects.toMatchObject({ kind: 'internal' })
    await expect(routeFailure).rejects.toThrow(/route could not be verified/)
    const unknown = admissionFixture()
    unknown.resolveModelInfo.mockResolvedValueOnce({ provider: 'mock', id: 'vision', name: 'vision' })
    await expect(admitAcpPrompt(unknown.ctx, unknown.route, prompt, true, new AbortController().signal))
      .rejects.toThrow(/does not declare image input/)
    const textOnly = admissionFixture()
    textOnly.resolveModelInfo.mockResolvedValueOnce({
      provider: 'mock', id: 'vision', name: 'vision', inputModalities: ['text'],
    })
    await expect(admitAcpPrompt(textOnly.ctx, textOnly.route, prompt, true, new AbortController().signal))
      .rejects.toThrow(/does not declare image input/)

    const routed = admissionFixture({ provider: 'live', model: 'vision-2' })
    await expect(admitAcpPrompt(routed.ctx, routed.route, prompt, true, new AbortController().signal)).resolves.toHaveLength(1)
    expect(routed.resolveModelInfo).toHaveBeenCalledWith('live', 'vision-2', expect.any(AbortSignal))
  })

  it('classifies image-policy failures separately from durable write failures', async () => {
    const fixture = admissionFixture()
    const prompt = [{ type: 'image', data: 'AQ==', mimeType: 'image/png' }] as const
    fixture.saveImages.mockRejectedValueOnce(new AttachmentError('too many', 'TOO_MANY_IMAGES'))
    await expect(admitAcpPrompt(fixture.ctx, fixture.route, prompt, true, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'invalid', message: 'too many' })
    fixture.saveImages.mockRejectedValueOnce(new AttachmentError('disk failed', 'ATTACHMENT_WRITE_FAILED'))
    await expect(admitAcpPrompt(fixture.ctx, fixture.route, prompt, true, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'internal', message: 'unable to persist the prompt image batch' })
    fixture.saveImages.mockRejectedValueOnce(new AttachmentError('corrupt object', 'ATTACHMENT_CORRUPT'))
    await expect(admitAcpPrompt(fixture.ctx, fixture.route, prompt, true, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'internal', message: 'unable to persist the prompt image batch' })
    fixture.saveImages.mockRejectedValueOnce(new Error('unknown store failure'))
    await expect(admitAcpPrompt(fixture.ctx, fixture.route, prompt, true, new AbortController().signal))
      .rejects.toBeInstanceOf(AcpContentError)
  })

  it('honors cancellation on both sides of the durable image write', async () => {
    const prompt = [{ type: 'image', data: 'AQ==', mimeType: 'image/png' }] as const
    const before = admissionFixture()
    const beforeController = new AbortController()
    beforeController.abort(new Error('cancel before write'))
    await expect(admitAcpPrompt(before.ctx, before.route, prompt, true, beforeController.signal))
      .rejects.toThrow('cancel before write')
    expect(before.saveImages).not.toHaveBeenCalled()

    const after = admissionFixture()
    const afterController = new AbortController()
    after.saveImages.mockImplementationOnce(async () => {
      afterController.abort(new Error('cancel after write'))
      return [REF]
    })
    await expect(admitAcpPrompt(after.ctx, after.route, prompt, true, afterController.signal))
      .rejects.toThrow('cancel after write')
    expect(after.saveImages).toHaveBeenCalledOnce()
  })

  it('reconstructs image-only and baseline prompts without empty text blocks', async () => {
    const fixture = admissionFixture()
    const imageOnly = await admitAcpPrompt(fixture.ctx, fixture.route, [
      { type: 'image', data: 'AQ==', mimeType: 'image/png' },
    ], true, new AbortController().signal)
    expect(imageOnly).toHaveLength(1)
    expect(imageOnly[0]?.type).toBe('image')
    await expect(admitAcpPrompt(fixture.ctx, fixture.route, [
      { type: 'text', text: 'before' },
      { type: 'resource_link', name: 'Guide', uri: 'https://example.test/guide' },
      { type: 'text', text: 'after' },
    ], true, new AbortController().signal)).resolves.toEqual([{
      type: 'text',
      text: 'before\n[resource_link name="Guide" uri="https://example.test/guide"]\nafter',
    }])
    await expect(admitAcpPrompt(fixture.ctx, fixture.route, [
      { type: 'text', text: ' \n ' },
    ], true, new AbortController().signal)).rejects.toThrow(/empty prompt/)
  })

  it('projects only non-empty text and verified durable images to ACP', async () => {
    const fixture = admissionFixture()
    await expect(assistantBlockToAcp(fixture.ctx, { type: 'text', text: '' })).resolves.toBeUndefined()
    await expect(assistantBlockToAcp(fixture.ctx, { type: 'text', text: 'hello' })).resolves.toEqual({
      type: 'text', text: 'hello',
    })
    await expect(assistantBlockToAcp(fixture.ctx, { type: 'reasoning', text: 'private' })).resolves.toBeUndefined()

    const noStore = admissionFixture({ attachments: false })
    await expect(assistantBlockToAcp(noStore.ctx, { type: 'image', attachment: REF }))
      .rejects.toThrow(/no attachment store/)
    const readImage = vi.fn().mockRejectedValue(new AttachmentError('gone', 'ATTACHMENT_NOT_FOUND'))
    const missingCtx = { get: (name: string) => name === 'attachments' ? { readImage } : undefined } as unknown as Context
    await expect(assistantBlockToAcp(missingCtx, { type: 'image', attachment: REF }))
      .rejects.toThrow(/unavailable or corrupt/)
    const storedCtx = {
      get: (name: string) => name === 'attachments'
        ? { readImage: vi.fn().mockResolvedValue({ ref: REF, data: Uint8Array.of(1) }) }
        : undefined,
    } as unknown as Context
    await expect(assistantBlockToAcp(storedCtx, { type: 'image', attachment: REF })).resolves.toEqual({
      type: 'image', data: 'AQ==', mimeType: 'image/png',
    })
  })
})
