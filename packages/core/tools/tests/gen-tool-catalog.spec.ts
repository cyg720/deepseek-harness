/**
 * Guarantee tests for the tool-schema catalog generator (`scripts/gen-tool-catalog.ts`).
 */
/*
 * 文件职责：验证工具注册与执行的 gen-tool-catalog.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证工具注册与执行在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */

import { describe, expect, it } from 'vitest'
import {
  assertManifestComplete,
  assertToolsHarvested,
  collectToolCatalog,
  render,
  /** 中文说明：类型或类 ToolCatalog 约束服务或测试数据职责。 */
  type ToolCatalog,
  /** 中文说明：类型或类 ToolPackage 约束服务或测试数据职责。 */
  type ToolPackage,
} from '../../../../scripts/gen-tool-catalog.ts'

/** JSON Schema shape enough to reach the values AST extraction can't. */
/* 中文说明：类型或类 JsonSchema 约束服务或测试数据职责。 */
interface JsonSchema {
  type: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  enum?: string[]
  required?: string[]
}

describe('gen-tool-catalog collectToolCatalog', () => {
  it('boots every shipped tool package and harvests its model-facing schemas', async () => {
    /** 中文说明：测试局部值 catalog，由紧邻初始化决定。 */
    const catalog = await collectToolCatalog()
    /** 中文说明：测试局部值 names，由紧邻初始化决定。 */
    const names = catalog.flatMap(entry => entry.schemas.map(s => s.name)).sort()
    expect(names).toEqual([
      'ask_user_question', 'bash', 'bash', 'cordis_define', 'cordis_inspect_list',
      'cordis_inspect_query', 'cordis_inspect_self', 'cordis_run', 'cordis_stop',
      'cordis_undefine', 'create_goal', 'edit', 'exit_plan_mode', 'get_goal', 'glob', 'grep',
      'interrupt_agent', 'interrupt_agent', 'job_kill', 'job_list', 'job_output',
      'list_agents', 'list_agents', 'list_subagent_models', 'lsp', 'pwsh', 'pwsh', 'ralph',
      'read', 'read_image', 'run_code', 'schedule_create', 'schedule_delete',
      'schedule_list', 'send_message', 'send_message', 'session_event_read', 'session_event_search',
      'session_event_trace', 'session_search', 'session_trace', 'skill', 'spawn_teammate',
      'str_replace_editor', 'subagent', 'team_task_create',
      'team_task_get', 'team_task_list', 'team_task_update', 'terminal_close', 'terminal_list',
      'terminal_open', 'terminal_read', 'terminal_send', 'terminal_signal', 'todo_write',
      'update_goal', 'wait_agent', 'web_fetch', 'web_search', 'workflow', 'write',
    ])
    // Every tool carries a JSON-Schema `parameters` object (what the model sees).
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    for (const entry of catalog) {
      /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
      for (const schema of entry.schemas) {
        expect((schema.parameters as unknown as JsonSchema).type).toBe('object')
      }
    }
  })

  it('resolves a runtime-spread enum to its literal members (the payoff over AST)', async () => {
    /** 中文说明：测试局部值 catalog，由紧邻初始化决定。 */
    const catalog = await collectToolCatalog()
    /** 中文说明：测试局部值 todo，由紧邻初始化决定。 */
    const todo = catalog
      .flatMap(entry => entry.schemas)
      .find(s => s.name === 'todo_write')
    // `todo-todo` writes `enum: [...STATUSES]` — a source AST would see the
    // spread, not the values. Booting yields the shipped enum literals.
    /** 中文说明：测试局部值 status，由紧邻初始化决定。 */
    const status = (((todo?.parameters as unknown as JsonSchema).properties?.todos)?.items)?.properties?.status
    expect(status?.enum).toEqual(['pending', 'in_progress', 'completed'])
  })

  it('attributes each harvested tool with its registering plugin source', async () => {
    /** 中文说明：测试局部值 catalog，由紧邻初始化决定。 */
    const catalog = await collectToolCatalog()
    /** 中文说明：测试局部值 bash，由紧邻初始化决定。 */
    const bash = catalog.find(entry => entry.pkg === '@deepseek-ai/dsh-tool-bash')
    expect(bash?.sources.bash).toBe('packages/shell/tool-bash/src/index.ts')
    /** 中文说明：测试局部值 control，由紧邻初始化决定。 */
    const control = catalog.find(entry => entry.pkg === '@deepseek-ai/dsh-tool-subagent-control')
    expect(control?.sources).toEqual({
      interrupt_agent: 'packages/subagent/tool-subagent-control/src/index.ts',
      list_agents: 'packages/subagent/tool-subagent-control/src/list-agents.ts',
      send_message: 'packages/subagent/tool-subagent-control/src/index.ts',
    })
  })

  it('harvests search tools without depending on the generator process PATH', async () => {
    /** 中文说明：测试局部值 oldPath，由紧邻初始化决定。 */
    const oldPath = process.env.PATH
    try {
      process.env.PATH = ''
      /** 中文说明：测试局部值 catalog，由紧邻初始化决定。 */
      const catalog = await collectToolCatalog()
      /** 中文说明：测试局部值 search，由紧邻初始化决定。 */
      const search = catalog.find(entry => entry.pkg === '@deepseek-ai/dsh-tool-fs-search')
      expect(search?.schemas.map(s => s.name).sort()).toEqual(['glob', 'grep'])
    } finally {
      if (oldPath === undefined) delete process.env.PATH
      else process.env.PATH = oldPath
    }
  })

  it('records the shipped `subagent_fork` alias in a note (config-driven tool name)', async () => {
    // `tool-subagent`'s registered name is the load-time `toolName` config, so the shipped
    // agents surface this one package as both `subagent` and `subagent_fork`.
    /** 中文说明：测试局部值 catalog，由紧邻初始化决定。 */
    const catalog = await collectToolCatalog()
    /** 中文说明：测试局部值 subagent，由紧邻初始化决定。 */
    const subagent = catalog.find(entry => entry.pkg === '@deepseek-ai/dsh-tool-subagent')
    expect(subagent?.schemas.map(s => s.name)).toEqual(['list_subagent_models', 'subagent'])
    expect(subagent?.note).toMatch(/subagent_fork/)
  })
})

describe('gen-tool-catalog assertManifestComplete', () => {
  it('passes when the manifest lists every on-disk tool package (the default)', () => {
    expect(() => { assertManifestComplete() }).not.toThrow()
  })

  it('throws, naming the omitted package, when a tool package is missing from the manifest', () => {
    // An empty manifest scanned against the real tree: every `tool-*` package
    // is unlisted, so the guard must fire and name them.
    expect(() => { assertManifestComplete([]) }).toThrow(/not in the boot manifest/)
    expect(() => { assertManifestComplete([]) }).toThrow(/tool-bash/)
  })
})

describe('gen-tool-catalog assertToolsHarvested', () => {
  /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
  const entry: ToolPackage = {
    pkg: '@deepseek-ai/dsh-tool-demo',
    dir: 'tool-demo',
    source: 'packages/demo/tool-demo/src/index.ts',
    requires: ['ctx.tools', 'ctx.somethingUnmounted'],
    writes: ['tool/result'],
    mount: () => Promise.resolve(),
  }

  it('accepts a boot that registered at least one tool', () => {
    expect(() => { assertToolsHarvested(entry, 1) }).not.toThrow()
  })

  it('throws, naming the package and its requirements, when a boot registers nothing', () => {
    // The failure this guards is silent by construction: the package is in the
    // manifest, its plugin merely stays PENDING on an unmounted service, and the
    // catalog would ship without its tools while every gate stays green.
    expect(() => { assertToolsHarvested(entry, 0) }).toThrow(/@deepseek-ai\/dsh-tool-demo booted without registering a single tool/)
    expect(() => { assertToolsHarvested(entry, 0) }).toThrow(/ctx.somethingUnmounted/)
  })
})

describe('gen-tool-catalog render', () => {
  it('emits a package heading, a tool heading, and a json schema fence', () => {
    /** 中文说明：测试局部值 catalog，由紧邻初始化决定。 */
    const catalog: ToolCatalog = [
      {
        pkg: '@deepseek-ai/dsh-tool-demo',
        sources: { demo: 'packages/demo/tool-demo/src/index.ts' },
        requires: ['ctx.tools'],
        writes: ['tool/result'],
        schemas: [{ name: 'demo', description: 'A demo tool.', parameters: { type: 'object', properties: {} } }],
      },
    ]
    /** 中文说明：测试局部值 md，由紧邻初始化决定。 */
    const md = render(catalog)
    expect(md).toContain('| `@deepseek-ai/dsh-tool-demo` | `demo` | `ctx.tools` | `tool/result` |')
    expect(md).toContain('## `@deepseek-ai/dsh-tool-demo`')
    expect(md).toContain('### `demo`')
    expect(md).toContain('A demo tool.')
    expect(md).toContain('```json')
    expect(md).toContain('Source: [`packages/demo/tool-demo/src/index.ts`]')
  })
})
