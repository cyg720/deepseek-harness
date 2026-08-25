/**
 * 文件职责：验证 tools-catalog.spec.ts 覆盖的Typert 类型系统行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的Typert 类型系统能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { EVENT_API, SERVICE_API, TYPE_API } from '@deepseek-ai/dsh-tool-cordis/src/api-catalog.ts'
import { WorkspaceAnalyzer } from '../src/analyzer.ts'
import { FaceModelEmitter } from '../src/emitter.ts'

/** 中文说明：变量 workspaceRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const workspaceRoot = resolve(import.meta.dirname, '../../../..')
/** 中文说明：变量 temporaryRoots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const temporaryRoots: string[] = []

afterEach(() => {
  /** 中文说明：该循环依次处理输入或结果；循环变量仅在当前循环中有效。 */
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('model-driven dsh-tools generation', () => {
  it('round-trips the complete service and event structure through the runtime registry', { timeout: 30_000 }, async () => {
    /** 中文说明：变量 workspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workspace = new WorkspaceAnalyzer({
      root: workspaceRoot,
      faces: ['host'],
      packages: ['@deepseek-ai/dsh-tools'],
    }).analyze()
    /** 中文说明：函数值 host 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const host = workspace.faces.find(candidate => candidate.face === 'host')
    if (host === undefined) throw new Error('dsh-tools has no analyzed host face')
    /** 中文说明：变量 artifact 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const artifact = new FaceModelEmitter(host).emit('@deepseek-ai/dsh-tools')

    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(import.meta.dirname, '.generated-tools-'))
    temporaryRoots.push(root)
    /** 中文说明：变量 modulePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const modulePath = join(root, 'host.mjs')
    writeFileSync(modulePath, artifact.js)
    /** 中文说明：变量 generated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const generated = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`) as {
      TYPERT: TypertContribution
    }

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = ctx.typert.register(generated.TYPERT)
    /** 中文说明：变量 record 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const record = ctx.typert.getPackage('@deepseek-ai/dsh-tools', 'host')
    /** 中文说明：函数值 service 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const service = record?.model.services.find(candidate => candidate.key === 'tools')
    expect(service).toBeDefined()
    expect({
      key: service?.key,
      summary: service?.summary,
      methods: service?.members
        .filter(member => member.kind === 'method' && !member.name.startsWith('['))
        .map(member => member.signature),
    }).toEqual((() => {
      /** 中文说明：函数值 api 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const api = SERVICE_API.find(candidate => candidate.key === 'tools')
      return {
        key: api?.key,
        summary: api?.summary,
        methods: api?.methods.map(method => method.signature),
      }
    })())
    expect(record?.model.events.filter(event => event.name.startsWith('tools/')).map(event => ({
      name: event.name,
      mode: event.mode,
      signature: event.signature,
      summary: event.summary,
    }))).toEqual(EVENT_API.filter(event => event.name.startsWith('tools/')).map(event => ({
      name: event.name,
      mode: event.mode,
      signature: event.signature,
      summary: event.summary,
    })))
    expect(service?.types.find(type => type.name === 'ToolDefinition')).toEqual(
      TYPE_API.find(type => type.name === 'ToolDefinition'),
    )

    await dispose()
    expect(ctx.typert.getPackage('@deepseek-ai/dsh-tools', 'host')).toBeUndefined()
  })
})
