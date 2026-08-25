/** Generate model-visible Host/Client Service and Event inspect catalogs. */
/**
 * 文件职责：实现 gen-cordis-inspect-catalog.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { projectCordisCatalog } from '@deepseek-ai/dsh-typert-generator'
import type { CordisCatalogModel, ServiceMethodEntry } from '@deepseek-ai/dsh-typert-generator'
import { CORDIS_CATALOG_POLICY } from './gen-cordis-catalog.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：常量 CLIENT_OUT 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLIENT_OUT = 'packages/extensions/cordis-client-runner/src/client/api-catalog.ts'

/** 中文说明：常量 CLIENT_SERVICES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLIENT_SERVICES: Readonly<Record<string, readonly string[]>> = {
  layout: ['toggleSidebar', 'openDetails', 'closeDetails'],
  locale: ['getLocale', 'getSnapshot', 'subscribe', 'setLocale', 'register', 'bind'],
  sessions: ['open', 'openSubagent', 'setSubagentCatalogOpen', 'refreshSubagents', 'search', 'fork', 'scope', 'binding'],
  slots: ['register', 'inject'],
  theme: ['getTheme', 'setTheme', 'register', 'overrideTokens'],
  workspaces: [
    'connectWorkspace', 'startSession', 'create', 'pickDirectory', 'listDirectory', 'createDirectory',
    'openPath', 'rename', 'delete', 'insertSessionBefore', 'archiveSession',
  ],
}

/** 中文说明：常量 CLIENT_EVENTS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLIENT_EVENTS = new Set([
  'connection/reset',
  'locale/change',
  'slots/changed',
  'theme/change',
])

/** 中文说明：函数 methodName 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function methodName(method: ServiceMethodEntry): string | undefined {
  return /^(?:declare\s+)?(?:readonly\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)/.exec(method.signature)?.[1]
}

/** 中文说明：函数 clientModel 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function clientModel(model: CordisCatalogModel): CordisCatalogModel {
  return {
    services: model.services.flatMap((service) => {
      /** 中文说明：变量 allowed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const allowed = CLIENT_SERVICES[service.key]
      if (allowed === undefined) return []
      /** 中文说明：变量 names 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const names = new Set(allowed)
      return [{ ...service, methods: service.methods.filter(method => names.has(methodName(method) ?? '')) }]
    }),
    events: model.events.filter(event => CLIENT_EVENTS.has(event.name)),
  }
}

/** 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function main(): void {
  const { projector, model } = projectCordisCatalog(root, CORDIS_CATALOG_POLICY, 'client')
  /** 中文说明：变量 destination 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const destination = resolve(root, CLIENT_OUT)
  /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = projector.renderRuntimeApi(clientModel(model))
    .replaceAll('@deepseek-ai/dsh-tool-cordis/api-catalog', '@deepseek-ai/dsh-cordis-client-runner/client/api-catalog')
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, source)
  console.log(`gen-cordis-inspect-catalog: wrote ${CLIENT_OUT}`)
}

main()
