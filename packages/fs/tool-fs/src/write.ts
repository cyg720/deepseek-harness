/**
 * ================================ 文件注释 ================================
 * 【文件职责】面向模型的"整文件写"工具。它从单策略槽取可选意图，调用
 * ctx.fs.writeText（不做 stat），然后记录结果版本；没有策略时是无条件原子
 * 创建或覆盖。
 * 【技术维度】defineTool 注册：schema 校验 file_path/content（+可选升级字段）；
 * execute 流程 = 解析策略 → 解析目标 → waterfall 取写意图 → writeText（带信号与
 * 策略）→ 发 observed 事件 → 返回 { path, operation, before, after }；错误经
 * sandbox.mapError + remediateFsError 双层处理；展示层 presentCall/presentResult
 * 负责 diff 卡片。
 * 【产品维度】模型创建/整体替换文件的标准工具：输出带 before/after 供上下文 diff，
 * 系统提示指导"覆盖前先读、目标改动用 edit"。
 * 【逻辑维度】按出现顺序：parseWriteArgs（校验）→ formatWriteOutput（结果信封）→
 * WriteToolArgs（含升级字段的参数类型）→ applyWriteTool（注册工具 + 指南 + 展示）。
 * 【关键边界】空 content 合法（写空文件），只有 file_path 必须非空白；写意图槽
 * 决策失败（如未读先写）由策略插件抛 FS_NOT_OBSERVED；升级调用在任何非批准结果
 * 上都抛专属文本。
 * 【新手阅读建议】先看 execute 的调用链（策略 → 意图 → 写 → 观察），再看
 * presentCall/presentResult 理解调用时与结果时的 diff 展示差异。
 * ==========================================================================
 */
/**
 * Model-facing full-file write. It obtains an optional intent from the single policy slot, calls
 * `ctx.fs.writeText` without a stat, then records the resulting version; no policy means an
 * unconditional atomic create-or-overwrite.
 * @module @deepseek-ai/dsh-tool-fs/src/write
 */
/**
 * 模块总览：本文件是 write 工具的定义与执行体。观察态策略插件加载后，
 * "未读先写"会被意图槽挡住（createIfAbsent 防止盲目覆盖）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffCallView, DiffResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { computeHunkDiffs, diffsFromMeta } from './diff.ts'
import { remediateFsError } from './error.ts'
import { sessionResolveOptions } from './session-cwd.ts'
import type { FsSandboxController } from './sandbox.ts'

/**
 * Validate value constraints the schema DSL can't express: only a non-blank
 * `file_path` — an empty `content` is legitimate (it writes an empty file).
 * @param args - the schema-validated raw tool arguments.
 * @returns the camelCased input; `content` passes through untouched.
 */
/**
 * 校验 schema DSL 表达不了的值约束：只有 file_path 必须非空白——空 content 是合法的
 * （写空文件）。
 * @param args 已通过 schema 校验的原始工具参数。
 * @returns 驼峰化输入；content 原样穿过。
 */
export function parseWriteArgs(args: { file_path: string; content: string }): { filePath: string; content: string } {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  return { filePath: args.file_path, content: args.content }
}

/**
 * Format a write outcome as one model-facing text block body.
 * @param displayPath - the backend-resolved path rendered in the envelope's `<path>` element.
 * @param outcome - the write outcome; its `operation` selects the Created/Updated wording.
 * @returns the model-facing confirmation envelope (no file content is echoed back).
 */
/**
 * 把写结果格式化成一段模型可见的文本块主体。
 * @param displayPath 信封 <path> 元素里的后端解析路径。
 * @param outcome 写结果；其 operation 选择 Created/Updated 措辞。
 * @returns 模型可见的确认信封（不回显文件内容）。
 */
export function formatWriteOutput(displayPath: string, outcome: Pick<FsWriteOutcome, 'operation'>): string {
  const verb = outcome.operation === 'create' ? 'Created' : 'Updated'
  return `<path>${displayPath}</path>
<type>file</type>
<content>
${verb} file
</content>`
}

/**
 * The `write` tool's validated arguments: the base parameters plus the
 * two escalation fields, advertised only under a confining `ctx.fs` (absent
 * from the schema otherwise, so the validator rejects them before `execute`).
 */
/**
 * write 工具的已校验参数：基础参数加两个升级字段（只在有围栏 ctx.fs 下被广告；
 * 否则 schema 里没有它们，校验器在 execute 之前就拒绝）。
 */
interface WriteToolArgs {
  file_path: string
  content: string
  sandbox_permissions?: string
  justification?: string
}

/**
 * Register the `write` tool and its system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param sandbox - the shared sandbox-escalation API (advertisement, mode stamping, denial mapping).
 */
/**
 * 注册 write 工具与其系统提示指南。
 * @param ctx 插件上下文；注册是作用域于它的副作用，执行使用其 fs 服务。
 * @param sandbox 共享的沙箱升级 API（广告、模式盖章、拒绝映射）。
 */
export function applyWriteTool(ctx: Context, sandbox: FsSandboxController): void {
  ctx.systemPrompt.section({
    name: 'tool:write',
    order: 101,
    text: 'Use the write tool to create files or completely replace file contents. Existing files are overwritten, so read an existing file first (the default fs-observation-policy requires it) and prefer edit for targeted changes.',
  })

  ctx.tools.register(defineTool({
    name: 'write',
    description: 'Create or fully replace a UTF-8 text file.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to write, resolved by the filesystem backend.' },
      content: { type: 'string', required: true, description: 'Full UTF-8 text content to write.' },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          operation: { type: 'string', required: true, enum: ['create', 'update'] },
          before: {
            required: true,
            oneOf: [
              { type: 'string' },
              { type: 'null' },
            ],
          },
          after: { type: 'string', required: true },
        },
      },
      // 模型可见信封 + 结果时展示元数据（上下文 diff，before 为 null 时无 diff）。
      render: (_args, value) => [{ type: 'text', text: formatWriteOutput(value.path, value) }],
      presentationMeta: (args, value) => ({
        diffs: value.before === null
          ? []
          : computeHunkDiffs(args.file_path, value.before, value.after)
            .map(({ path, oldText, newText }) => ({ path, oldText, newText })),
      }),
    },
    async execute(args: WriteToolArgs, exec) {
      const input = parseWriteArgs(args)
      // Resolve the per-call sandbox policy (approved mode > session override
      // > backend default, plus the session cwd root) BEFORE anything executes;
      // an escalating call throws its distinct text on any non-grant.
      // 中文说明：在一切执行之前解析按调用沙箱策略（批准模式 > 会话覆盖 > 后端默认，
      // 再加会话 cwd 根）；带升级参数的调用在任何非批准结果上都抛专属文本。
      const sandboxPolicy = await sandbox.resolvePolicy('write', args, exec)
      const target = await ctx.fs.resolve(input.filePath, sessionResolveOptions(exec, input.filePath, sandboxPolicy?.workspaceRoot))
      // Single-slot decision: the policy plugin produces createIfAbsent/
      // replaceIfVersion; the bare default is undefined (unconditional). No stat.
      // 中文说明：单槽决策——策略插件产出 createIfAbsent/replaceIfVersion；裸默认
      // 是 undefined（无条件）。不做 stat。
      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
      let outcome: FsWriteOutcome
      try {
        outcome = await ctx.fs.writeText(target, input.content, intent, exec.signal, sandboxPolicy)
      } catch (error: unknown) {
        // A sandbox denial becomes the shared [sandbox: …] marker (the model
        // recognizes it from bash); stale/not-observed failures gain their
        // model-facing remedy; anything else passes through.
        // 中文说明：沙箱拒绝变成共享 [sandbox: …] 标记（模型从 bash 就认识）；
        // 过期/未观察失败获得模型侧补救；其它错误穿透。
        throw remediateFsError(sandbox.mapError(error, sandboxPolicy))
      }
      // Record the present observation (a no-op when no policy plugin listens).
      // 中文说明：记录 present 观察（没有策略插件监听时是空操作）。
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      return {
        path: target.displayPath,
        operation: outcome.operation,
        before: outcome.before,
        after: outcome.after,
      }
    },
    // Pure display: a diff card. A call-time presenter has no access to prior
    // file content, so `oldText: null` also represents an overwrite here.
    // 中文说明：纯展示——diff 卡片。调用时展示器拿不到先前内容，所以这里
    // oldText: null 也表示覆盖写。
    presentCall(args): DiffCallView {
      return {
        card: 'diff',
        title: `Write ${args.file_path}`,
        diffs: [{ path: args.file_path, oldText: null, newText: args.content }],
        locations: [{ path: args.file_path }],
      }
    },
    // Result-time display repeats the diff because completed views replace the
    // pending view. Overwrites use applied metadata; creates and identical
    // overwrites use the replay-safe args fallback.
    // 中文说明：结果时展示重复 diff（完成视图会替换挂起视图）。覆盖写用已应用元
    // 数据；创建与"内容相同"的覆盖写用重放安全的参数兜底。
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const diffs = diffsFromMeta(result.meta)
        ?? [{ path: args.file_path, oldText: null, newText: args.content }]
      return { card: 'diff', title: `Write ${args.file_path}`, diffs }
    },
  }))
}
