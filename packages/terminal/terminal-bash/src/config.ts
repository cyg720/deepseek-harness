/** Validated configuration for the local PTY backend. */
/**
 * ================================ 文件注释 ================================
 * 【文件职责】本地 PTY 后端（terminal-bash）的配置：公开配置、按方言的默认值解析
 * （bash/pwsh）、Schemastery schema 与数值/界限校验。
 * 【技术维度】z.object schema + 显式 resolveConfig 默认化步骤（"为空"即用方言默认，
 * 因为 Schemastery 把缺失可选数组物化为 []）；validateConfig 用类型断言收窄。
 * 【产品维度】部署方可按会话微调终端尺寸、滚动区、就绪轮询与超时，无需改代码；
 * pwsh 方言自动复用 dsh-pwsh-local 的可执行文件解析。
 * 【逻辑维度】定义方言/配置接口 → 方言默认常量 → resolveConfig 解析 → schema →
 * validateConfig 断言正安全整数与界限自洽。
 * 【关键边界】默认化必须显式（不隐藏在 run 里）；maxReadBytes ≤ scrollbackMaxBytes、
 * handoffGraceMs ≥ pollIntervalMs 等界限在写入处拒绝；数字字段必须为正安全整数。
 * 【新手阅读建议】先看 resolveConfig 的"空即默认"语义，再看 validateConfig 的界限规则。
 * ==========================================================================
 */

import z from '@deepseek-ai/schemastery'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'

/** One supported interactive shell dialect. */
/** 支持的交互式 shell 方言：bash 或 pwsh。 */
export type ShellDialect = 'bash' | 'pwsh'

/** Public plugin configuration. */
/** 公开插件配置（全部可选，缺省按方言取默认值）。 */
export interface Config {
  /** Backend registry type (default: `shell`). */
  /** 后端注册表类型（默认 shell）。 */
  backendType?: string
  /** Interactive shell dialect (default: `bash`); selects the argv/env/startup defaults. */
  /** 交互式 shell 方言（默认 bash）；决定 argv/env/启动默认值。 */
  shellDialect?: ShellDialect
  /** Interactive shell executable (default per dialect: `/bin/bash`, or the resolved pwsh). */
  /** 交互式 shell 可执行文件（按方言默认：/bin/bash 或解析出的 pwsh）。 */
  shellPath?: string
  /** Shell arguments (default per dialect: bash `--noprofile --norc -i`, pwsh `-NoLogo -NoProfile`). */
  /** shell 参数（按方言默认：bash 为 --noprofile --norc -i，pwsh 为 -NoLogo -NoProfile）。 */
  shellArgs?: string[]
  /** Terminal rows. */
  /** 终端行数。 */
  rows?: number
  /** Terminal columns. */
  /** 终端列数。 */
  cols?: number
  /** Maximum retained logical lines. */
  /** 最大保留逻辑行数。 */
  scrollbackLines?: number
  /** Maximum retained UTF-8 bytes. */
  /** 最大保留 UTF-8 字节数。 */
  scrollbackMaxBytes?: number
  /** Maximum bytes returned by one read or settled viewport. */
  /** 单次读取或落定 viewport 返回的最大字节数。 */
  maxReadBytes?: number
  /** Readiness polling interval. */
  /** 就绪轮询间隔。 */
  pollIntervalMs?: number
  /** Delay before Linux exact syscall probes. */
  /** Linux 精确系统调用探测前的延迟。 */
  exactProbeAfterMs?: number
  /** Silence duration that yields `inferred_idle`. */
  /** 产生 inferred_idle 的静默时长。 */
  idleSilenceMs?: number
  /**
   * Extra wait beyond `idleSilenceMs`, once a prompt marker was seen, for the shell to
   * regain the foreground before `inferred_idle` settles; at least one `pollIntervalMs`.
   */
  /**
   * 看到提示符标记后，在 inferred_idle 落定前额外等待 shell 重夺前台的时间；
   * 至少一个 pollIntervalMs。
   */
  handoffGraceMs?: number
  /** Absolute send wait bound. */
  /** 发送等待的绝对上限。 */
  timeoutMs?: number
  /** Grace before teardown escalates to `SIGKILL`. */
  /** 拆解升级到 SIGKILL 前的宽限期。 */
  disposeGraceMs?: number
}

/** Configuration after Schemastery defaults and dialect resolution. */
/** Schemastery 默认值与方言解析之后的配置形状。 */
export type ResolvedConfig = Omit<Required<Config>, 'shellDialect' | 'shellPath' | 'shellArgs'> & {
  shellDialect: ShellDialect
  shellPath: string
  shellArgs: string[]
}

/** Bash dialect default executable. */
/** bash 方言的默认可执行文件。 */
export const DEFAULT_BASH_SHELL = '/bin/bash'
/** Bash dialect default arguments (interactive, profile-free). */
/** bash 方言默认参数（交互式、免 profile）。 */
export const DEFAULT_BASH_ARGS = ['--noprofile', '--norc', '-i']
/** Pwsh dialect default arguments (interactive host, profile-free). */
/** pwsh 方言默认参数（交互式宿主、免 profile）。 */
export const DEFAULT_PWSH_ARGS = ['-NoLogo', '-NoProfile']

/**
 * Resolve the effective per-dialect shell specification. Defaulting is this
 * explicit step: an unset or empty `shellPath`/`shellArgs` selects the
 * dialect's defaults, while a non-empty explicit value always wins.
 * (Schemastery materializes an absent optional array as `[]`, so emptiness —
 * not just `undefined` — means "dialect default".)
 * @param config - Schemastery-resolved plugin configuration.
 * @returns the fully resolved configuration.
 */
/**
 * 解析按方言生效的 shell 规格。默认化是这一步的显式行为：未设置或为空的
 * shellPath/shellArgs 选方言默认值，非空显式值总是优先。
 * （Schemastery 把缺失的可选数组物化为 []，因此"为空"——而非仅 undefined——
 * 即表示"用方言默认"。）
 * @param config Schemastery 解析后的插件配置
 * @returns 完全解析后的配置
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const shellDialect = config.shellDialect ?? 'bash'
  return {
    ...(config as Required<Config>),
    shellDialect,
    shellPath: config.shellPath !== undefined && config.shellPath.length > 0
      ? config.shellPath
      : (shellDialect === 'pwsh' ? resolvePwshPath() : DEFAULT_BASH_SHELL),
    shellArgs: config.shellArgs !== undefined && config.shellArgs.length > 0
      ? config.shellArgs
      : (shellDialect === 'pwsh' ? DEFAULT_PWSH_ARGS : DEFAULT_BASH_ARGS),
  }
}

/** Schemastery config exposed by the plugin. */
/** 插件暴露的 Schemastery 配置。 */
export const Config: z<Config> = z.object({
  backendType: z.string().default('shell'),
  shellDialect: z.union(['bash', 'pwsh'] as const).default('bash'),
  shellPath: z.string().required(false),
  shellArgs: z.array(z.string()).required(false),
  rows: z.number().default(40),
  cols: z.number().default(160),
  scrollbackLines: z.number().default(10_000),
  scrollbackMaxBytes: z.number().default(4 * 1024 * 1024),
  maxReadBytes: z.number().default(256 * 1024),
  pollIntervalMs: z.number().default(50),
  exactProbeAfterMs: z.number().default(150),
  idleSilenceMs: z.number().default(3_000),
  handoffGraceMs: z.number().default(500),
  timeoutMs: z.number().default(30_000),
  disposeGraceMs: z.number().default(3_000),
})

/**
 * Assert every effective numeric config field is a positive safe integer and bounds compose.
 * @param config - Schemastery-resolved plugin configuration.
 * @returns Narrows the input to the fully resolved configuration.
 */
/**
 * 断言每个生效的数字配置字段都是正安全整数且各界限自洽（写入处拒绝，避免运行期
 * 意外）。
 * @param config Schemastery 解析后的插件配置
 * @returns 把输入收窄为完全解析后的配置
 */
export function validateConfig(config: Config): asserts config is ResolvedConfig {
  const resolved = config as ResolvedConfig
  if (resolved.backendType.length === 0) throw new Error('terminal-bash: backendType must be non-empty')
  if (resolved.shellPath.length === 0) throw new Error('terminal-bash: shellPath must be non-empty')
  for (const [name, value] of Object.entries(resolved)) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`terminal-bash: ${name} must be a positive safe integer`)
    }
  }
  if (resolved.maxReadBytes > resolved.scrollbackMaxBytes) {
    throw new Error('terminal-bash: maxReadBytes must not exceed scrollbackMaxBytes')
  }
  if (resolved.handoffGraceMs < resolved.pollIntervalMs) {
    throw new Error('terminal-bash: handoffGraceMs must be at least pollIntervalMs so one readiness poll runs inside the grace window')
  }
}
