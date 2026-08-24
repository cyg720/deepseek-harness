/** Web-localized copy for the four shipped presets and file copy for every other row. */
/**
 * 文件职责：验证四个内置代理 preset 使用 Web 本地化文案，其他 preset 保留文件元数据。
 * 技术维度：使用 Vitest 参数化测试和轻量翻译函数覆盖中英文资源。
 * 产品维度：让内置选项在界面中正确翻译，同时尊重用户自定义名称和描述。
 * 逻辑维度：参数化检查四个 system preset；另一个用例覆盖用户 preset、未知 system preset 和无描述记录。
 * 关键边界：只有已知 id 且 trust=system 才本地化；用户文件内容不得被同名内置文案覆盖。
 * 新手阅读建议：先看 translate，再对照参数化 nameKey/descriptionKey，最后看 fileCopy 三种保留场景。
 */

import { describe, expect, it } from 'vitest'
import { en, presetDisplayText, zh } from '../src/client/locales.ts'

// 根据资源 bundle 创建按键直接取值的测试翻译函数。
const translate = (bundle: typeof en) => (key: keyof typeof en): string => bundle[key]

// preset 显示文案测试套件。
describe('preset display copy', () => {
  // 参数化四个内置 preset；id、nameKey、descriptionKey 分别表示标识和两类翻译键。
  it.each([
    ['standard', 'presetStandardName', 'presetStandardDescription'],
    ['code', 'presetCodeName', 'presetCodeDescription'],
    ['minimal', 'presetMinimalName', 'presetMinimalDescription'],
    ['cordis', 'presetCordisName', 'presetCordisDescription'],
  ] as const)('localizes the shipped %s preset in English and Chinese', (id, nameKey, descriptionKey) => {
    // 模拟来自配置文件的 system preset 元数据；内置项应忽略 file name/description。
    const preset = { id, trust: 'system' as const, name: 'file name', description: 'file description' }

    expect(presetDisplayText(preset, translate(en)))
      .toEqual({ name: en[nameKey], description: en[descriptionKey] })
    expect(presetDisplayText(preset, translate(zh)))
      .toEqual({ name: zh[nameKey], description: zh[descriptionKey] })
  })

  // 验证用户和未知系统 preset 继续使用文件元数据。
  it('keeps file metadata for user and unknown system presets', () => {
    // 用户文件提供的中文名称和描述，应原样保留。
    const fileCopy = { name: '我的标准', description: '团队自己的 preset。' }

    expect(presetDisplayText({ id: 'standard', trust: 'user', ...fileCopy }, translate(en)))
      .toEqual(fileCopy)
    expect(presetDisplayText({ id: 'deployment-extra', trust: 'system', ...fileCopy }, translate(en)))
      .toEqual(fileCopy)
    expect(presetDisplayText({ id: 'bare', trust: 'user' }, translate(en)))
      .toEqual({ name: 'bare' })
  })
})
