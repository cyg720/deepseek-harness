/** Package-owned prompt-assembly invariants. @module @deepseek-ai/dsh-system-prompt/invariant */
/*
 * 文件职责：实现系统提示词的 invariant.ts 不变量。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证系统提示词在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：检查已注册贡献与权威状态之间的一致关系。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { PromptAssembly } from './index.ts'

/** 中文说明：服务局部值 PACKAGE_NAME，由紧邻初始化决定。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-system-prompt'
/** 中文说明：服务局部值 VARIABLE_NAME，由紧邻初始化决定。 */
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/

/** Cordis companion plugin name. */
/* 中文说明：服务局部值 name，由紧邻初始化决定。 */
export const name = 'system-prompt-invariant'
/** Service required before the companion can reserve package ownership. */
/* 中文说明：服务局部值 inject，由紧邻初始化决定。 */
export const inject = ['invariants']

/** Validate the authoritative assembly returned by the waterfall. */
/* 中文说明：函数 validateAssembly 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateAssembly(assembly: PromptAssembly, fail: InvariantFailure): void {
  /** 中文说明：服务局部值 sectionNames，由紧邻初始化决定。 */
  const sectionNames = new Set<string>()
  /** 中文说明：服务局部值 section，由紧邻初始化决定。 */
  for (const section of assembly.sections) {
    if (section.name.length === 0) fail('assembled section names must be non-empty')
    if (sectionNames.has(section.name)) fail(`assembled section name ${JSON.stringify(section.name)} is duplicated`)
    sectionNames.add(section.name)
    if (typeof section.text !== 'string') fail(`assembled section ${JSON.stringify(section.name)} text must be a string`)
  }

  /** 中文说明：服务局部值 contextNames，由紧邻初始化决定。 */
  const contextNames = new Set<string>()
  /** 中文说明：服务局部值 context，由紧邻初始化决定。 */
  for (const context of assembly.contexts) {
    if (context.name.length === 0) fail('assembled context names must be non-empty')
    if (contextNames.has(context.name)) fail(`assembled context name ${JSON.stringify(context.name)} is duplicated`)
    contextNames.add(context.name)
    if (typeof context.text !== 'string') fail(`assembled context ${JSON.stringify(context.name)} text must be a string`)
  }

  /** 中文说明：服务局部值 tool，由紧邻初始化决定。 */
  for (const tool of assembly.tools) {
    if (tool.name.length === 0) fail('assembled tool names must be non-empty')
  }

  /** 中文说明：服务局部值 [name，由紧邻初始化决定。 */
  for (const [name, value] of Object.entries(assembly.variables)) {
    if (!VARIABLE_NAME.test(name)) fail(`assembled variable name ${JSON.stringify(name)} is invalid`)
    if (value !== undefined && typeof value !== 'string') {
      fail(`assembled variable ${JSON.stringify(name)} must be a string or undefined`)
    }
  }
}

/** Install validation around the authoritative assembly waterfall result. */
/* 中文说明：服务局部值 install，由紧邻初始化决定。 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    /** 中文说明：服务局部值 assembled，由紧邻初始化决定。 */
    const assembled = await next()
    validateAssembly(assembled, fail)
    return assembled
  }, { global: true, prepend: true })
}

/**
 * Register the system-prompt invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 中文说明：服务局部值 apply，由紧邻初始化决定。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
