/**
 * 文件职责：验证 content.spec.ts 覆盖的 LLM 配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型接入在配置变化、认证、重试与异常场景下仍能给 Agent 稳定反馈。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、结果和清理行为。
 * 关键边界：测试替身必须保持确定性；敏感凭据不可写入日志；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import {
  CallId,
  createUserMessage,
  OFFLOADED_IMAGE_TEXT,
  offloadRequestImages,
  offloadRequestImagesWithPolicy,
  projectImagesForTextModel,
} from '../src/index.ts'
import type { ContentBlock } from '../src/index.ts'

/** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const source = { kind: 'plugin' as const, plugin: 'test' }

/** 中文说明：函数 image 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function image(bytes: number): ContentBlock {
  return {
    type: 'image',
    attachment: {
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: 'image/png',
      bytes,
      width: 1,
      height: 1,
    },
  }
}

describe('offloadRequestImages', () => {
  it('preserves every image when no payload bound is configured', () => {
    /** 中文说明：变量 messages 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const messages = [createUserMessage({ content: [image(300)], source })]
    expect(offloadRequestImages(messages, undefined)).toBe(messages)
  })

  it('preserves the original request when its base64 payload fits exactly', () => {
    /** 中文说明：变量 messages 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const messages = [createUserMessage({ content: [image(3), image(3)], source })]
    expect(offloadRequestImages(messages, 8)).toBe(messages)
  })

  it('keeps five 3 MiB images at 20 MiB and offloads the oldest after one more raw byte', () => {
    /** 中文说明：变量 rawImageBytes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rawImageBytes = 3 * 1024 * 1024
    /** 中文说明：变量 maxRequestImageBytes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const maxRequestImageBytes = 20 * 1024 * 1024
    /** 中文说明：变量 exact 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exact = [createUserMessage({
      content: Array.from({ length: 5 }, () => image(rawImageBytes)),
      source,
    })]
    expect(offloadRequestImages(exact, maxRequestImageBytes)).toBe(exact)

    /** 中文说明：变量 over 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const over = [createUserMessage({
      content: [image(rawImageBytes + 1), ...Array.from({ length: 4 }, () => image(rawImageBytes))],
      source,
    })]
    expect(offloadRequestImages(over, maxRequestImageBytes)[0]?.content).toEqual([
      { type: 'text', text: OFFLOADED_IMAGE_TEXT },
      ...Array.from({ length: 4 }, () => image(rawImageBytes)),
    ])
  })

  it('replaces the oldest nested occurrences without mutating durable messages', () => {
    /** 中文说明：变量 shared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shared = image(3)
    /** 中文说明：变量 messages 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const messages = [
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('shot'),
          content: [shared],
        }],
        source,
      }),
      createUserMessage({ content: [shared, image(3)], source }),
    ]

    /** 中文说明：变量 fitted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fitted = offloadRequestImages(messages, 8)
    expect(fitted).not.toBe(messages)
    expect(fitted[0]?.content).toEqual([{
      type: 'tool-result',
      toolCallId: CallId('shot'),
      content: [{ type: 'text', text: OFFLOADED_IMAGE_TEXT }],
    }])
    expect(fitted[1]?.content).toEqual([shared, image(3)])
    expect(messages[0]?.content[0]).toMatchObject({ type: 'tool-result', content: [shared] })
  })

  it('replaces a single image that cannot fit', () => {
    /** 中文说明：变量 messages 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const messages = [createUserMessage({ content: [image(300)], source })]
    expect(offloadRequestImages(messages, 8)[0]?.content)
      .toEqual([{ type: 'text', text: OFFLOADED_IMAGE_TEXT }])
  })

  it('keeps unchanged nested content while replacing a later image', () => {
    /** 中文说明：变量 nested 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nested = {
      type: 'tool-result' as const,
      toolCallId: CallId('text-only'),
      content: [{ type: 'text' as const, text: 'kept' }],
    }
    /** 中文说明：变量 messages 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const messages = [createUserMessage({ content: [nested, image(3)], source })]
    expect(offloadRequestImages(messages, 1)[0]?.content).toEqual([
      nested,
      { type: 'text', text: OFFLOADED_IMAGE_TEXT },
    ])
  })
})

describe('offloadRequestImagesWithPolicy', () => {
  it('drops 129 MiB to 64 MiB and keeps the removed prefix stable through 192 MiB', () => {
    /** 中文说明：变量 mib 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mib = 1024 * 1024
    /** 中文说明：函数值 project 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const project = (count: number) => offloadRequestImagesWithPolicy([
      createUserMessage({ content: Array.from({ length: count }, () => image(mib)), source }),
    ], {
      representation: 'raw',
      maxBytes: 128 * mib,
      byteQuantum: 64 * mib,
    })[0]?.content

    expect(project(128)?.filter(block => block.type === 'image')).toHaveLength(128)
    expect(project(129)?.filter(block => block.type === 'text')).toHaveLength(65)
    expect(project(192)?.filter(block => block.type === 'text')).toHaveLength(65)
    expect(project(193)?.filter(block => block.type === 'text')).toHaveLength(129)
  })

  it('rounds a count excess up to a 20-image removal step', () => {
    /** 中文说明：变量 projected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const projected = offloadRequestImagesWithPolicy([
      createUserMessage({ content: Array.from({ length: 601 }, () => image(1)), source }),
    ], {
      representation: 'raw',
      maxImages: 600,
      countQuantum: 20,
    })
    expect(projected[0]?.content.filter(block => block.type === 'text')).toHaveLength(20)
    expect(projected[0]?.content.filter(block => block.type === 'image')).toHaveLength(581)
  })

  it('uses route-owned request byte lengths when supplied', () => {
    /** 中文说明：变量 messages 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const messages = [createUserMessage({ content: [image(100), image(100)], source })]
    /** 中文说明：变量 projected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const projected = offloadRequestImagesWithPolicy(messages, {
      representation: 'raw',
      maxBytes: 3,
      byteLength: () => 2,
    })
    expect(projected[0]?.content).toEqual([
      { type: 'text', text: OFFLOADED_IMAGE_TEXT },
      image(100),
    ])
  })
})

describe('projectImagesForTextModel', () => {
  it('returns image-free history unchanged', () => {
    /** 中文说明：变量 messages 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const messages = [createUserMessage({ content: [{ type: 'text', text: 'plain' }], source })]
    expect(projectImagesForTextModel(messages)).toBe(messages)
  })

  it('replaces direct and nested images while retaining unaffected messages and blocks', () => {
    /** 中文说明：变量 plain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plain = createUserMessage({ content: [{ type: 'text', text: 'plain' }], source })
    /** 中文说明：变量 nested 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nested = {
      type: 'tool-result' as const,
      toolCallId: CallId('nested-image'),
      content: [{ type: 'text' as const, text: 'before' }, image(3), { type: 'text' as const, text: 'after' }],
    }
    /** 中文说明：变量 unchangedNested 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unchangedNested = {
      type: 'tool-result' as const,
      toolCallId: CallId('text-only'),
      content: [{ type: 'text' as const, text: 'unchanged' }],
    }
    /** 中文说明：变量 visual 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const visual = createUserMessage({
      content: [{ type: 'text', text: 'lead' }, image(3), unchangedNested, nested],
      source,
    })

    /** 中文说明：变量 projected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const projected = projectImagesForTextModel([plain, visual])
    expect(projected[0]).toBe(plain)
    expect(projected[1]?.content).toEqual([
      { type: 'text', text: 'lead' },
      { type: 'text', text: '[image omitted because this model accepts text only; attachment sha256:aaaaaaaa]' },
      unchangedNested,
      {
        ...nested,
        content: [
          { type: 'text', text: 'before' },
          { type: 'text', text: '[image omitted because this model accepts text only; attachment sha256:aaaaaaaa]' },
          { type: 'text', text: 'after' },
        ],
      },
    ])
  })
})
