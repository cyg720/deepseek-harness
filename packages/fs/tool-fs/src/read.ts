/**
 * ================================ 文件注释 ================================
 * 【文件职责】面向模型的 UTF-8 读取工具。它做一次提供者 stat（用于类型、路由与
 * 观察版本），大文件或大小未知的文件走流式，渲染一个有界窗口，然后发出观察事件。
 * 【技术维度】defineTool 注册：schema 校验 file_path/offset/limit；execute 流程 =
 * parseReadArgs → resolveRegularReadTarget（解析+stat）→ 按大小选 readText 或
 * streamText → buildWindow（行/字节双上限，见 read-render.ts）→ 发 observed →
 * 返回 { path, offset, lines, totalLines }；展示层把结构化窗口投影进 meta（重放
 * 安全），presentResult 用 meta 重建带行号的代码视图。
 * 【产品维度】模型查看文本文件的标准工具：带行号、支持 offset/limit 续读大文件、
 * 行与字节双上限防失控；系统提示引导"用 read 而非 cat"。
 * 【逻辑维度】按出现顺序：READ_LIMIT/STREAM_MIN_SIZE（默认常量）→ ReadToolCaps →
 * ReadInput → parsePositiveInteger/parseReadArgs（校验）→ applyReadTool（注册）。
 * 【关键边界】isConcurrencySafe 为 true：观察竞争"失败即关闭"——守卫变更会在锁内
 * 重查版本，过期即要求重读；流式阈值同时覆盖"size 未知"（无大小后端永不无界缓冲）；
 * presentResult 对畸形 meta 走通用兜底，绝不在重放时抛错。
 * 【新手阅读建议】先看 parseReadArgs 的默认与上限，再看 execute 的流式路由，最后
 * 看 presentResult 的 meta 收窄与信封正则。
 * ==========================================================================
 */
/**
 * Model-facing UTF-8 read. It performs one provider stat for type, routing, and observed version,
 * streams large or size-unknown files, renders a bounded window, then emits the observation.
 * @module @deepseek-ai/dsh-tool-fs/src/read
 */
/**
 * 模块总览：本文件是 read 工具的定义与执行体。读取成功后的 observed 事件是
 * "先读后写"策略的状态来源。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ReadResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { buildWindow, formatReadOutput, langFromPath, readMetaFromMeta } from './read-render.ts'
import { resolveRegularReadTarget } from './read-target.ts'

/** Default and maximum number of lines returned by one `read` call (the `readLimit` config). */
/** 单次 read 默认且最大的返回行数（readLimit 配置的默认值）：2000。 */
export const READ_LIMIT = 2000

/**
 * Default streaming threshold (the `readStreamMinSize` config): files at or
 * above this size stream; smaller files read whole into memory.
 */
/**
 * 默认流式阈值（readStreamMinSize 配置）：达到或超过 10 MiB 的文件流式读取；
 * 更小的整读进内存。
 */
export const STREAM_MIN_SIZE = 10 * 1024 * 1024

/** Resolved read-tool caps — plugin config after defaulting (see `Config` in index.ts). */
/** 已解析的读工具上限——默认化后的插件配置（见 index.ts 的 Config）。 */
export interface ReadToolCaps {
  /** Default and maximum number of lines returned by one call. */
  /** 单次调用默认且最大的返回行数。 */
  limit: number
  /** Maximum characters returned for a single line. */
  /** 单行最大返回字符数。 */
  maxLineLength: number
  /** Maximum bytes returned for selected file lines. */
  /** 选中行最大返回字节数。 */
  maxBytes: number
  /** Files at or above this size stream; smaller files read whole into memory. */
  /** 达到或超过该大小流式；更小的整读进内存。 */
  streamMinSize: number
}

/** Validated `read` arguments after defaulting. */
/** 默认化后的已校验 read 参数。 */
interface ReadInput {
  filePath: string
  offset: number
  limit: number
}

// 校验正整数（offset/limit 用）。
function parsePositiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

/**
 * Validate value constraints the schema DSL can't express. `maxLimit` is the deployment's line cap.
 * @param args - the schema-validated raw tool arguments; `offset`/`limit` must be positive integers when given.
 * @param maxLimit - the configured line cap: both the default `limit` and the largest one accepted.
 * @returns the validated input with `offset` defaulted to 1 and `limit` to `maxLimit`.
 */
/**
 * 校验 schema DSL 表达不了的值约束。maxLimit 是部署的行上限（既是默认 limit 也是
 * 可接受的最大值）。
 * @param args 已通过 schema 校验的原始工具参数；给定时 offset/limit 必须是正整数。
 * @param maxLimit 配置的行上限。
 * @returns 已校验输入，offset 默认 1、limit 默认 maxLimit。
 */
export function parseReadArgs(args: { file_path: string; offset?: number; limit?: number }, maxLimit: number): ReadInput {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  const offset = args.offset === undefined ? 1 : parsePositiveInteger(args.offset, 'offset')
  const limit = args.limit === undefined ? maxLimit : parsePositiveInteger(args.limit, 'limit')
  if (limit > maxLimit) throw new Error(`limit must be less than or equal to ${maxLimit}`)
  return { filePath: args.file_path, offset, limit }
}

/**
 * Register the `read` tool and its system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param caps - the deployment's resolved read caps (plugin config after defaulting).
 */
/**
 * 注册 read 工具与其系统提示指南。
 * @param ctx 插件上下文；注册是作用域于它的副作用，执行使用其 fs 服务。
 * @param caps 部署的已解析读上限（默认化后的插件配置）。
 */
export function applyReadTool(ctx: Context, caps: ReadToolCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:read',
    order: 100,
    text: 'Use the read tool — not shell commands like cat — to inspect text files. Results include line numbers. Use offset and limit to continue reading large files.',
  })

  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Read a UTF-8 text file and return line-numbered content.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to read, resolved by the filesystem backend.' },
      offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
      limit: { type: 'number', description: `Maximum number of lines to return. Defaults to ${caps.limit}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          lines: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
          totalLines: { type: 'integer', required: true },
        },
      },
      render: (args, value) => {
        const input = parseReadArgs(args, caps.limit)
        const endLine = value.lines.at(-1)?.number ?? Math.max(0, value.offset - 1)
        const truncatedByBytes = value.lines.length < input.limit && endLine < value.totalLines
        return [{
          type: 'text',
          text: formatReadOutput(value.path, {
            offset: value.offset,
            lines: value.lines,
            totalLines: value.totalLines,
            ...truncatedByBytes ? { truncatedByBytes: true } : {},
          }),
        }]
      },
      // Project the structured window into persisted `meta` so a UI's read card
      // survives replay: the raw canonical output object is not on the wire, only
      // the model-facing text, from which the line/lang data cannot be recovered.
      // 中文说明：把结构化窗口投影进持久化的 meta，让 UI 的读卡片在重放时存活：
      // 线上只有模型侧文本（没有原始结构化对象），行/语言数据无法从文本恢复。
      presentationMeta: (_args, value) => {
        const lang = langFromPath(value.path)
        return {
          path: value.path,
          offset: value.offset,
          lines: value.lines.map(({ number, text }) => ({ number, text })),
          totalLines: value.totalLines,
          ...lang === undefined ? {} : { lang },
        }
      },
    },
    // Observation races fail closed because guarded mutations re-check the version in-lock.
    // 中文说明：观察竞争"失败即关闭"——守卫变更会在锁内重查版本。
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseReadArgs(args, caps.limit)
      // One stat: absence observation OR type check + size routing + present version.
      // A concurrent write can only make a later guarded mutation fail stale and require reread.
      // 中文说明：一次 stat 同时完成"缺失观察 / 类型检查 / 大小路由 / present 版本"。
      // 并发写只会让之后的守卫变更报过期并要求重读。
      const { target, info } = await resolveRegularReadTarget(ctx, exec, input.filePath)

      // Stream when the file is large OR size is unknown, so a size-less backend
      // never buffers an arbitrarily large file.
      // 中文说明：文件大 OR 大小未知时流式——无大小后端永远不会缓冲任意大的文件。
      const chunks = info.size === undefined || info.size >= caps.streamMinSize
        ? await ctx.fs.streamText(target, exec.signal)
        : [await ctx.fs.readText(target, exec.signal)]
      const window = await buildWindow(
        chunks,
        { offset: input.offset, limit: input.limit, maxLineLength: caps.maxLineLength, maxBytes: caps.maxBytes },
        target.displayPath,
      )

      const outcome = {
        path: target.displayPath,
        offset: input.offset,
        lines: window.lines,
        totalLines: window.totalLines,
      }
      // Record the present observation (a no-op when no policy plugin listens). The
      // read already succeeded; an fs/observed listener is contractually a
      // synchronous, side-effect-only recorder.
      // 中文说明：记录 present 观察（没有策略插件监听时是空操作）。读取已成功；
      // fs/observed 监听器契约上是同步、纯副作用的记录器。
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return outcome
    },
    // Result-time display: a `read` card carrying the structured line window a
    // capable UI renders as a line-numbered, syntax-highlighted view. The
    // structured data is narrowed from the persisted `meta` (replay-safe); the
    // envelope-stripped model-facing text rides along as `content` so a UI without
    // the read capability still shows the file text. A malformed or absent meta,
    // or a result whose text is not the read envelope, declines to `undefined`
    // (the generic fallback), never throwing on replay of obsolete logged output.
    // 中文说明：结果时展示——read 卡片带结构化行窗口，有能力的 UI 渲染成带行号、
    // 语法高亮的视图。结构化数据从持久化 meta 收窄（重放安全）；剥掉信封的模型侧
    // 文本作为 content 随行，让没有 read 能力的 UI 也能显示文件文本。meta 畸形/
    // 缺失、或结果文本不是读信封时返回 undefined（通用兜底），重放过时日志绝不抛错。
    presentResult(_args, result: ToolResult): ReadResultView | undefined {
      if (result.isError) return undefined
      const meta = readMetaFromMeta(result.meta)
      if (meta === undefined) return undefined
      const only = result.content.length === 1 ? result.content[0] : undefined
      const text = only?.type === 'text' ? only.text : undefined
      if (text === undefined) return undefined
      // Group 1 always captures (possibly empty) when the envelope matches.
      // 中文说明：信封匹配时第 1 组总是能捕获（可能为空）。
      const body = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
      if (body === undefined) return undefined
      return {
        card: 'read',
        path: meta.path,
        offset: meta.offset,
        lines: meta.lines,
        totalLines: meta.totalLines,
        ...meta.lang === undefined ? {} : { lang: meta.lang },
        content: [{ type: 'text', text: body }],
      }
    },
    // Pure display: a generic card titled by the file with the read window appended (`Read
    // foo.txt (5 - 8)`), `read` kind (icon), and a follow-along location whose line is the
    // read's offset (defaulting to 1). The window reflects raw args, so an omitted limit keeps
    // the title bare instead of smuggling config into this pure presenter.
    // 中文说明：纯展示——通用卡片，标题为文件加读取窗口（Read foo.txt (5 - 8)），
    // read 图标，跟随位置行号为读取的 offset（默认 1）。窗口反映原始参数：省略 limit
    // 时标题保持裸奔，而不是把配置走私进这个纯展示器。
    presentCall(args): GenericCallView {
      const { offset, limit } = args
      const window = limit !== undefined && limit > 0
        ? ` (${offset ?? 1} - ${(offset ?? 1) + limit - 1})`
        : offset !== undefined ? ` (from line ${offset})` : ''
      return {
        card: 'generic',
        title: `Read ${args.file_path}${window}`,
        kind: 'read',
        locations: [{ path: args.file_path, line: offset ?? 1 }],
      }
    },
  }))
}
