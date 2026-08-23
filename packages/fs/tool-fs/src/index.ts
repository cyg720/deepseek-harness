/**
 * ================================ 文件注释 ================================
 * 【文件职责】面向模型的 read、read_image、write、edit 工具套件，全部建立在
 * ctx.fs 之上。本包拥有 schema、校验、读取窗口、格式化与观察事件，但绝不拥有
 * 具体提供者；可选的事件策略提供变更守卫，没有策略时工具用无条件提供者调用。
 * 【技术维度】Cordis 插件：apply 校验四个读取上限（正整数）后依次注册 read（读取
 * 窗口/流式）、read_image（挂在 attachments 服务就绪时）、write/edit（共享一个
 * FsSandboxController 升级 API）。Config 用 schemastery 提供默认值。
 * 【产品维度】这是模型与文件系统之间的"最后一公里"：把后端能力包装成模型可调用、
 * 有清晰参数说明与输出格式的工具，并接入观察态策略（先读后写）与沙箱升级。
 * 【逻辑维度】按出现顺序：name/inject → Config 与 Config → ResolvedConfig →
 * assertPositiveInteger（上限校验）→ apply（注册四个工具 + 升级控制器）。
 * 【关键边界】read_image 是"组合条件"注册：没有挂 attachment 存储就无法持久提交
 * 图片字节，工具不注册（execute 仍对直接调用者做防御性复查）；升级 API 只在一个
 * 有围栏的 ctx.fs 下启用。
 * 【新手阅读建议】先看 Config 与 apply 的组装顺序，再按 read.ts → write.ts →
 * edit.ts → read-image.ts 逐个看工具实现。
 * ==========================================================================
 */
/**
 * Model-facing read, read_image, write, and edit tools over `ctx.fs`. This package owns schemas, validation,
 * read windows, formatting, and observation events, never a concrete provider. An optional
 * event policy supplies mutation guards; without one the tools use unconditional provider calls.
 * @module @deepseek-ai/dsh-tool-fs
 */
/**
 * 模块总览：本包是"模型 → ctx.fs"的工具层。它不直接碰磁盘，而是面向 dsh-fs 的
 * 服务定义编程；提供者可以是本地后端也可以是沙箱后端。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-user-approval'
import { applyReadTool, READ_LIMIT, STREAM_MIN_SIZE } from './read.ts'
import { applyWriteTool } from './write.ts'
import { applyEditTool } from './edit.ts'
import { applyReadImageTool } from './read-image.ts'
import { READ_MAX_BYTES, READ_MAX_LINE_LENGTH } from './read-render.ts'
import { FsSandboxController } from './sandbox.ts'

/** Cordis plugin name used by loader diagnostics. */
/** 插件名（供加载器诊断使用）。 */
export const name = 'tool-fs'

/** Services required by the filesystem tool suite. */
/** 文件系统工具套件依赖的服务：tools（注册）、fs（能力）、systemPrompt（指南）。 */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Plugin config (all optional — `Config` supplies the defaults). */
/**
 * 插件配置（全部可选——Config 提供默认值）。
 */
export interface Config {
  /** Default and maximum number of lines returned by one `read` call. */
  /** 单次 read 默认且最大的返回行数。 */
  readLimit?: number
  /** Maximum characters returned for a single line before truncation. */
  /** 单行返回的最大字符数，超限截断。 */
  readMaxLineLength?: number
  /** Maximum bytes returned for the selected lines of one `read` call. */
  /** 单次 read 选中行返回的最大字节数。 */
  readMaxBytes?: number
  /** Files at or above this size stream instead of loading whole into memory. */
  /** 达到或超过该大小的文件改用流式读取（而不是整载内存）。 */
  readStreamMinSize?: number
}

// schemastery 配置校验器：四个读取上限各带默认值（见 read.ts/read-render.ts 常量）。
export const Config: z<Config> = z.object({
  readLimit: z.number().default(READ_LIMIT),
  readMaxLineLength: z.number().default(READ_MAX_LINE_LENGTH),
  readMaxBytes: z.number().default(READ_MAX_BYTES),
  readStreamMinSize: z.number().default(STREAM_MIN_SIZE),
})

/** The shape after schemastery applied the defaults. */
/** schemastery 套用默认值后的配置形态。 */
type ResolvedConfig = Required<Config>

/** Every read cap counts lines/chars/bytes — a positive integer, or windowing arithmetic misbehaves silently. */
/**
 * 每个读取上限都是行/字符/字节计数——必须是正整数，否则窗口算术会静默出错。
 */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-fs: ${name} must be a positive integer`)
  }
}

/** Register the full `read`/`write`/`edit` filesystem tool suite, plus `read_image` while `attachments` is mounted. */
/**
 * 注册完整的 read/write/edit 文件系统工具套件；read_image 仅在 attachments 挂载期间注册。
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  // 中文说明：schemastery（Config）已填充所有带默认值的字段，这里只需做约束校验。
  const resolved = config as ResolvedConfig
  assertPositiveInteger('readLimit', resolved.readLimit)
  assertPositiveInteger('readMaxLineLength', resolved.readMaxLineLength)
  assertPositiveInteger('readMaxBytes', resolved.readMaxBytes)
  assertPositiveInteger('readStreamMinSize', resolved.readStreamMinSize)
  applyReadTool(ctx, {
    limit: resolved.readLimit,
    maxLineLength: resolved.readMaxLineLength,
    maxBytes: resolved.readMaxBytes,
    streamMinSize: resolved.readStreamMinSize,
  })
  // read_image is composition-conditional: without a mounted attachment store
  // the deployment cannot durably commit image bytes, so the tool never
  // registers; the execute body keeps a defensive re-check for direct callers.
  // 中文说明：read_image 按组合条件注册——没有挂 attachment 存储，部署就无法持久
  // 提交图片字节，工具就不注册；execute 主体对直接调用者保留防御性复查。
  ctx.inject(['attachments'], (imageCtx) => {
    applyReadImageTool(imageCtx)
  })
  // One escalation API shared by both mutating tools: advertisement gating,
  // per-call policy resolution, and denial-marker mapping, all keyed off whether
  // the mounted ctx.fs confines (ctx.fs.sandboxMode).
  // 中文说明：两个变更工具共享一个升级 API：广告门控、按调用策略解析、拒绝标记
  // 映射，全部以"挂载的 ctx.fs 是否限制"（ctx.fs.sandboxMode）为开关。
  const sandbox = new FsSandboxController(ctx)
  applyWriteTool(ctx, sandbox)
  applyEditTool(ctx, sandbox)
}
