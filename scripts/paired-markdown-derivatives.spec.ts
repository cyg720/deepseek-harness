/**
 * 文件职责：验证 paired-markdown-derivatives.spec.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */
import { describe, expect, it } from 'vitest'
import { partitionPairedMarkdownDerivatives } from './paired-markdown-derivatives.ts'

/** 中文说明：interface Block 定义本测试所需的数据或行为，用于表达仓库脚本场景。 */
interface Block {
  doc: string
  kind: string
  code: string
}

/** 中文说明：函数值 partition 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const partition = (blocks: Block[]) => partitionPairedMarkdownDerivatives(
  blocks,
  block => block.doc,
  block => `${block.kind}\0${block.code}`,
)

describe('partitionPairedMarkdownDerivatives', () => {
  it('treats a complete byte-identical Chinese sequence as derivative', () => {
    /** 中文说明：变量 english 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const english = [
      { doc: 'docs/example.md', kind: 'ts', code: 'const one = 1' },
      { doc: 'docs/example.md', kind: 'type-equiv', code: 'interface Example {}' },
    ]
    /** 中文说明：函数值 chinese 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const chinese = english.map(block => ({ ...block, doc: 'docs/example.zh.md' }))
    /** 中文说明：变量 unrelated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unrelated = { doc: 'docs/other.md', kind: 'ts', code: 'const other = 2' }

    expect(partition([...english, ...chinese, unrelated])).toEqual({
      primary: [...english, unrelated],
      derivatives: chinese,
    })
  })

  it('keeps reordered, changed, partial, and orphan Chinese sequences primary', () => {
    /** 中文说明：函数值 sequence 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const sequence = (doc: string) => [
      { doc, kind: 'ts', code: 'const one = 1' },
      { doc, kind: 'ts', code: 'const two = 2' },
    ]
    /** 中文说明：变量 english 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const english = sequence('docs/example.md')
    /** 中文说明：函数值 changed 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const changed = english.map((block, index) => ({
      ...block,
      doc: 'docs/example.zh.md',
      code: index === 0 ? 'const one = 0' : block.code,
    }))
    /** 中文说明：变量 reorderedEnglish 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reorderedEnglish = sequence('docs/reordered.md')
    /** 中文说明：函数值 reordered 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const reordered = [...reorderedEnglish].reverse().map(block => ({ ...block, doc: 'docs/reordered.zh.md' }))
    /** 中文说明：变量 partialEnglish 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const partialEnglish = sequence('docs/partial.md')
    /** 中文说明：变量 partial 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const partial = [{ ...partialEnglish[0]!, doc: 'docs/partial.zh.md' }]
    /** 中文说明：变量 orphan 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const orphan = [{ doc: 'docs/orphan.zh.md', kind: 'ts', code: 'const orphan = true' }]
    /** 中文说明：变量 blocks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blocks = [
      ...english,
      ...changed,
      ...reorderedEnglish,
      ...reordered,
      ...partialEnglish,
      ...partial,
      ...orphan,
    ]

    expect(partition(blocks)).toEqual({ primary: blocks, derivatives: [] })
  })

  it('requires the fence kind to match as well as the body', () => {
    /** 中文说明：变量 english 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const english = { doc: 'docs/example.md', kind: 'type-equiv', code: 'interface Example {}' }
    /** 中文说明：变量 chinese 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chinese = { ...english, doc: 'docs/example.zh.md', kind: 'public-api' }

    expect(partition([english, chinese])).toEqual({ primary: [english, chinese], derivatives: [] })
  })
})
