/**
 * Parse Codex's five-event hook subset into shared {@link MatcherGroup}s. Only synchronous command
 * hooks run; other types and `async: true` commands are recorded as skipped. Codex performs no
 * command substitution.
 * @module @deepseek-ai/dsh-hooks-codex/config
 */
/*
 * 文件职责：实现Codex Hook 桥的 config.ts 模块。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Codex Hook 桥可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：解析配置，匹配事件，执行处理器并合并输出。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

import { matcherDiagnostic, type MatcherGroup } from '@deepseek-ai/dsh-hook-protocol'

/** The five Codex hook points this bridge supports. */
/* 中文说明：协议局部值 CODEX_EVENTS，由紧邻初始化决定。 */
export const CODEX_EVENTS = ['PreToolUse', 'PostToolUse', 'SessionStart', 'UserPromptSubmit', 'Stop'] as const

/** A parsed Codex config: event name → its matcher groups (command hooks only). */
/* 中文说明：类型或类 CodexHookConfig 约束 Hook、守卫或目标数据职责。 */
export type CodexHookConfig = Record<string, MatcherGroup[]>

/** A skipped non-command (or async) hook, surfaced so the bridge can warn. */
/* 中文说明：类型或类 SkippedHook 约束 Hook、守卫或目标数据职责。 */
export interface SkippedHook {
  event: string
  reason: string
}

/** The outcome of parsing one Codex config file. */
/* 中文说明：类型或类 ParsedCodexConfig 约束 Hook、守卫或目标数据职责。 */
export interface ParsedCodexConfig {
  config: CodexHookConfig
  skipped: SkippedHook[]
}

/** 中文说明：函数 asObject 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Parse a wrapped or bare Codex event map. Unknown events and malformed entries are ignored rather
 * than failing boot; unsupported or asynchronous hooks are returned in `skipped`. Matcher fields on
 * UserPromptSubmit and Stop are discarded because those events have no matcher subject. A
 * matcher-bearing runnable group with an invalid regex throws a `SyntaxError`, allowing the bridge
 * to reject the complete config before listener registration.
 * @param raw - the parsed JSON config: a `{ hooks: … }` wrapper or the bare event map.
 * @returns the runnable per-event groups plus the skipped hooks with their reasons.
 */
/*
 * 中文说明：函数 parseCodexConfig 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param raw 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function parseCodexConfig(raw: unknown): ParsedCodexConfig {
  /** 中文说明：协议局部值 config，由紧邻初始化决定。 */
  const config: CodexHookConfig = {}
  /** 中文说明：协议局部值 skipped，由紧邻初始化决定。 */
  const skipped: SkippedHook[] = []
  /** 中文说明：协议局部值 root，由紧邻初始化决定。 */
  const root = asObject(raw)
  /** 中文说明：协议局部值 hooksMap，由紧邻初始化决定。 */
  const hooksMap = root ? asObject(root.hooks) ?? root : undefined
  if (!hooksMap) return { config, skipped }

  /** 中文说明：协议局部值 event，由紧邻初始化决定。 */
  for (const event of CODEX_EVENTS) {
    /** 中文说明：协议局部值 rawGroups，由紧邻初始化决定。 */
    const rawGroups = hooksMap[event]
    // Matcher-group parsing remains dialect-local because the supported hook
    // shapes and skip reasons differ from Claude Code's.
    /* jscpd:ignore-start */
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
        if (type !== 'command') { skipped.push({ event, reason: `unsupported "${type}" hook` }); continue }
        /* jscpd:ignore-end */
        if (hook.async === true) { skipped.push({ event, reason: 'async hook' }); continue }
        if (typeof hook.command !== 'string') continue
        // Codex accepts `timeout` or the `timeoutSec` alias.
        /** 中文说明：协议局部值 timeout，由紧邻初始化决定。 */
        const timeout = typeof hook.timeout === 'number' ? hook.timeout
          : typeof hook.timeoutSec === 'number' ? hook.timeoutSec : undefined
        commands.push({ command: hook.command, ...timeout !== undefined ? { timeoutSec: timeout } : {} })
      }
      if (commands.length === 0) continue
      /** 中文说明：协议局部值 matcher，由紧邻初始化决定。 */
      const matcher = event === 'UserPromptSubmit' || event === 'Stop'
        ? undefined
        : typeof group.matcher === 'string' ? group.matcher : undefined
      /** 中文说明：协议局部值 diagnostic，由紧邻初始化决定。 */
      const diagnostic = matcherDiagnostic(matcher, 'codex')
      if (diagnostic !== undefined) throw new SyntaxError(`${diagnostic} on event ${JSON.stringify(event)}`)
      groups.push({ ...matcher !== undefined ? { matcher } : {}, hooks: commands })
    }
    if (groups.length > 0) config[event] = groups
  }

  return { config, skipped }
}
