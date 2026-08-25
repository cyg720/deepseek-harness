/**
 * Parse Claude Code's event-to-matcher-group hook format into shared {@link MatcherGroup}s.
 * Only command hooks run; other hook types are returned as skipped so the
 * bridge can warn. Plugin-root and project-directory substitutions are applied
 * to commands at parse time.
 * @module @deepseek-ai/dsh-hooks-claude-code/config
 */
/**
 * 文件职责：实现Claude Code Hook 桥的 config.ts 模块。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Claude Code Hook 桥可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：解析配置，匹配事件，执行处理器并合并输出。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

import { matcherDiagnostic, type MatcherGroup } from '@deepseek-ai/dsh-hook-protocol'

/** 中文说明：协议局部值 CLAUDE_EVENTS，由紧邻初始化决定。 */
const CLAUDE_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStart',
  'SubagentStop',
] as const

/** A parsed CC config: event name → its matcher groups (command hooks only). */
/** 中文说明：类型或类 ClaudeCodeHookConfig 约束 Hook、守卫或目标数据职责。 */
export type ClaudeCodeHookConfig = Record<string, MatcherGroup[]>

/** A skipped non-command hook, surfaced so the bridge can warn about it. */
/** 中文说明：类型或类 SkippedHook 约束 Hook、守卫或目标数据职责。 */
export interface SkippedHook {
  event: string
  type: string
}

/** The outcome of parsing one config file: the runnable groups + what was skipped. */
/** 中文说明：类型或类 ParsedClaudeConfig 约束 Hook、守卫或目标数据职责。 */
export interface ParsedClaudeConfig {
  config: ClaudeCodeHookConfig
  skipped: SkippedHook[]
}

/** Substitution variables applied to each `command` string at parse time. */
/** 中文说明：类型或类 SubstitutionVars 约束 Hook、守卫或目标数据职责。 */
export interface SubstitutionVars {
  /** Replaces `${CLAUDE_PLUGIN_ROOT}` — the plugin's root dir. */
  pluginRoot?: string
  /** Replaces `${CLAUDE_PROJECT_DIR}` — the project root. */
  projectDir?: string
}

/** A plain (non-null, non-array) object, else undefined. */
/** 中文说明：函数 asObject 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Apply `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` substitution to a command string.
 * @param command - the raw command from config.
 * @param vars - the substitution values; a token whose variable is unset stays verbatim.
 * @returns the command with every occurrence of each set token replaced.
 */
/** 中文说明：函数 substituteCommand 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function substituteCommand(command: string, vars: SubstitutionVars): string {
  /** 中文说明：协议局部值 out，由紧邻初始化决定。 */
  let out = command
  if (vars.pluginRoot !== undefined) out = out.split('${CLAUDE_PLUGIN_ROOT}').join(vars.pluginRoot)
  if (vars.projectDir !== undefined) out = out.split('${CLAUDE_PROJECT_DIR}').join(vars.projectDir)
  return out
}

/**
 * Parse either a settings `hooks` value or a bare `hooks.json` event map. Malformed entries are
 * ignored rather than failing boot; unsupported events are ignored before their groups are parsed,
 * non-command hooks are returned in `skipped`, and substitutions are applied to every surviving
 * command. Matcher fields on UserPromptSubmit and Stop are discarded because those events have no
 * matcher subject. A matcher-bearing supported runnable group with an invalid regex throws a
 * `SyntaxError`, allowing the bridge to reject the complete config before listener registration.
 *
 * @param raw - the parsed JSON config: a settings object with a `hooks` key, or the bare
 *   event map.
 * @param vars - substitution values applied to every surviving `command` (defaults to
 *   none).
 * @returns the runnable per-event groups plus the skipped non-command hooks.
 */
/** 中文说明：函数 parseClaudeCodeConfig 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function parseClaudeCodeConfig(raw: unknown, vars: SubstitutionVars = {}): ParsedClaudeConfig {
  /** 中文说明：协议局部值 config，由紧邻初始化决定。 */
  const config: ClaudeCodeHookConfig = {}
  /** 中文说明：协议局部值 skipped，由紧邻初始化决定。 */
  const skipped: SkippedHook[] = []
  // Accept either `{ hooks: { … } }` (a settings file) or the bare event map.
  /** 中文说明：协议局部值 root，由紧邻初始化决定。 */
  const root = asObject(raw)
  /** 中文说明：协议局部值 hooksMap，由紧邻初始化决定。 */
  const hooksMap = root ? asObject(root.hooks) ?? root : undefined
  if (!hooksMap) return { config, skipped }

  /** 中文说明：协议局部值 event，由紧邻初始化决定。 */
  for (const event of CLAUDE_EVENTS) {
    /** 中文说明：协议局部值 rawGroups，由紧邻初始化决定。 */
    const rawGroups = hooksMap[event]
    if (!Array.isArray(rawGroups)) continue
    /** 中文说明：协议局部值 groups，由紧邻初始化决定。 */
    const groups: MatcherGroup[] = []
    /** 中文说明：协议局部值 rawGroup，由紧邻初始化决定。 */
    for (const rawGroup of rawGroups) {
      /** 中文说明：协议局部值 group，由紧邻初始化决定。 */
      const group = asObject(rawGroup)
      if (!group || !Array.isArray(group.hooks)) continue
      /** 中文说明：协议局部值 commands，由紧邻初始化决定。 */
      const commands: MatcherGroup['hooks'] = []
      /** 中文说明：协议局部值 rawHook，由紧邻初始化决定。 */
      for (const rawHook of group.hooks) {
        /** 中文说明：协议局部值 hook，由紧邻初始化决定。 */
        const hook = asObject(rawHook)
        if (!hook) continue
        /** 中文说明：协议局部值 type，由紧邻初始化决定。 */
        const type = typeof hook.type === 'string' ? hook.type : 'command'
        if (type !== 'command') {
          skipped.push({ event, type })
          continue
        }
        if (typeof hook.command !== 'string') continue
        commands.push({
          command: substituteCommand(hook.command, vars),
          ...typeof hook.timeout === 'number' ? { timeoutSec: hook.timeout } : {},
        })
      }
      if (commands.length === 0) continue
      /** 中文说明：协议局部值 matcher，由紧邻初始化决定。 */
      const matcher = event === 'UserPromptSubmit' || event === 'Stop'
        ? undefined
        : typeof group.matcher === 'string' ? group.matcher : undefined
      /** 中文说明：协议局部值 diagnostic，由紧邻初始化决定。 */
      const diagnostic = matcherDiagnostic(matcher, 'claude-code')
      if (diagnostic !== undefined) throw new SyntaxError(`${diagnostic} on event ${JSON.stringify(event)}`)
      groups.push({
        ...matcher !== undefined ? { matcher } : {},
        hooks: commands,
      })
    }
    if (groups.length > 0) config[event] = groups
  }

  return { config, skipped }
}
