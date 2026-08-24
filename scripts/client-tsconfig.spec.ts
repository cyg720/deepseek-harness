/** Regression coverage for source declarations owned by the client test aggregate. */
/**
 * 文件职责：验证客户端 TypeScript 聚合配置直接加载各客户端包的 CSS Modules 声明。
 * 技术维度：使用 TypeScript 配置解析 API、Node 目录枚举和 Vitest 比较规范化文件路径。
 * 产品维度：防止工作区软链接真实路径差异导致客户端样式类型在某些环境丢失。
 * 逻辑维度：枚举 client/extensions 包声明，解析 tsconfig.client.json，筛选实际加载声明并比较。
 * 关键边界：只检查存在的 src/css-modules.d.ts；路径统一为正斜杠并排序后比较。
 * 新手阅读建议：先看 root，再读 clientCssDeclarations 的枚举流程，最后看 TypeScript 配置解析。
 */

import { existsSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// 仓库根绝对路径。
const root = fileURLToPath(new URL('..', import.meta.url))

/** 收集客户端包 CSS 声明。@returns 排序且使用正斜杠的绝对路径数组。@example clientCssDeclarations()。 */
function clientCssDeclarations(): string[] {
  // 参与客户端聚合的两个包组。
  const clientGroups = ['client', 'extensions']
  // group 是当前包组名称。
  return clientGroups.flatMap((group) => {
    // 当前包组在仓库中的绝对目录。
    const clientRoot = resolve(root, 'packages', group)
    return readdirSync(clientRoot, { withFileTypes: true })
      // entry 是包组下的目录项，只保留包目录。
      .filter(entry => entry.isDirectory())
      // entry 是包目录，为其构造约定 CSS 声明路径。
      .map(entry => resolve(clientRoot, entry.name, 'src/css-modules.d.ts'))
  })
    .filter(existsSync)
    // file 是存在的声明路径，统一分隔符以跨平台比较。
    .map(file => file.replaceAll(sep, '/'))
    .sort()
}

// 客户端 TypeScript 聚合测试套件。
describe('client TypeScript aggregate', () => {
  // 验证配置加载集合与源码目录枚举完全一致。
  it('loads package CSS declarations without relying on workspace-link realpaths', () => {
    // 客户端聚合 tsconfig 绝对路径。
    const configPath = resolve(root, 'tsconfig.client.json')
    // TypeScript 读取配置的结果，可能包含 error。
    const read = ts.readConfigFile(configPath, file => ts.sys.readFile(file))
    if (read.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
    }
    // 解析后的完整 TypeScript 配置与文件列表。
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
    // 实际载入的 CSS 声明路径，已规范化并排序。
    const loaded = parsed.fileNames
      .map(file => file.replaceAll(sep, '/'))
      .filter(file => file.endsWith('/src/css-modules.d.ts'))
      .sort()
    expect(loaded).toEqual(clientCssDeclarations())
  })
})
