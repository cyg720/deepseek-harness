/** Assistant block classifier (moved here with sessions/conversation.ts). */
/**
 * 文件职责：验证 API 内容块到客户端助手消息块的分类和字段转换。
 * 技术维度：使用 Vitest、品牌化 AttachmentId 和 ContentBlock 判别联合构造四类输入。
 * 产品维度：保证正文、推理、工具调用和图片在会话界面中进入正确渲染分支。
 * 逻辑维度：创建附件与四类块，批量转换后比较完整结果，再单独验证一个文本块。
 * 关键边界：测试中的工具调用通过类型断言模拟线协议输入；附件摘要必须使用合法品牌格式。
 * 新手阅读建议：先逐项对照 blocks 输入与期望 kind，再看单块和批量函数的关系。
 */

import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-api-remotes/client'
import { toAssistantBlock, toAssistantBlocks } from '../src/client/sessions/conversation.ts'

// 助手内容块分类测试套件。
describe('toAssistantBlock', () => {
  // 覆盖四种支持的内容块；回调无参数且不返回业务值。
  it('classifies the four block shapes', () => {
    // 最小合法图片附件摘要；哈希为 64 个 a，尺寸为 1×1。
    const attachment = {
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: 'image/png' as const,
      bytes: 68,
      width: 1,
      height: 1,
    }
    // 四种 API 内容块输入；顺序用于验证批量转换保持原有排列。
    const blocks: ContentBlock[] = [
      { type: 'text', text: '正文' },
      { type: 'reasoning', text: '思考' },
      { type: 'tool-call', id: 'c1', name: 'echo', arguments: '{}' } as ContentBlock,
      { type: 'image', attachment },
    ]
    expect(toAssistantBlocks(blocks)).toEqual([
      { kind: 'text', text: '正文' },
      { kind: 'reasoning', text: '思考' },
      { kind: 'tool-call', callId: 'c1', name: 'echo', argsRaw: '{}' },
      { kind: 'image', attachment },
    ])
    expect(toAssistantBlock(blocks[0] as ContentBlock)).toEqual({ kind: 'text', text: '正文' })
  })
})
