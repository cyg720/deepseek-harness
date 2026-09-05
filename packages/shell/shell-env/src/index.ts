

/**
 * Tool-independent shell environment plugin: owns the `ctx.shellEnv` registry of
 * trusted, per-execution `DSH_*` variables consumed by the model-facing shell
 * tools (`dsh-tool-bash`, `dsh-tool-pwsh`). Built-in shell facts are owned by
 * the registry itself while plugins can register additional, enumerable facts
 * with effect-scoped disposal.
 *
 * @module @deepseek-ai/dsh-shell-env
 */

/*
 * 【文件职责】管理工具无关的 DSH_ 执行环境变量及受信任事实，插件额外贡献随效果生命周期注册和撤销。
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DSH_ENV_PREFIX } from '@deepseek-ai/dsh-shell'
import type { DshEnvironment, DshEnvironmentKey } from '@deepseek-ai/dsh-shell'
import { DSH_HOME_ENV, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/cordis' {
  interface Context {
    shellEnv: ShellEnvRegistry
  }
}

export const name = 'shell-env'
export const inject: string[] = []

/** Plugin config (all optional — the built-in facts resolve without defaults). */
/* 插件配置（全部可选——内置事实不需要默认值即可解析）。 */
export interface Config {
  /** DeepSeek Harness home directory exposed as `DSH_HOME`; defaults to `$DSH_HOME` or `~/.dsh`. */
  /* 作为 DSH_HOME 暴露的 DeepSeek Harness 主目录；缺省为 $DSH_HOME 或 ~/.dsh。 */
  dshHome?: string
}

/** Runtime configuration schema for the shell-env plugin. */
/* shell-env 插件的运行时配置 schema（schemastery 校验用）。 */
export const Config: z<Config> = z.object({
  dshHome: z.string(),
})

/** Model-visible metadata for one managed `DSH_*` environment variable. */
/* 一个受管 DSH_* 环境变量的模型可见元数据。 */
export interface BashEnvVariable {
  /** Concise description of the environment fact represented by the variable. */
  /* 该变量所代表环境事实的简明描述（会展示给模型）。 */
  description: string
}

/**
 * A plugin contribution to the managed environment of each model shell call.
 * Declared keys make ownership conflicts detectable before the first command;
 * `resolve` computes only the values available for the current execution.
 */
/*
 * 插件对每次模型 shell 调用受管环境的一份贡献。声明键使所有权冲突在第一条命令运行前
 * 就可被发现；resolve 只计算当前执行可用的值。
 */
export interface BashEnvContributor {
  /** Stable contributor name used in diagnostics and duplicate detection. */
  /* 稳定的贡献者名，用于诊断与重复检测。 */
  name: string
  /** Complete set of `DSH_*` keys this contributor may return. */
  /* 该贡献者可能返回的完整 DSH_* 键集合。 */
  variables: Readonly<Record<DshEnvironmentKey, BashEnvVariable>>
  /**
   * Resolve this contributor's available values for one tool execution.
   * @param execution - the shell tool execution and its optional calling agent.
   * @returns a partial map containing only keys declared in {@link variables}.
   */
  /*
   * 为一次工具执行解析该贡献者可用的值。
   * @param execution shell 工具执行及其可选的调用方 agent
   * @returns 只包含 variables 中声明键的部分映射
   */
  resolve(execution: ToolExecution): Readonly<Partial<Record<DshEnvironmentKey, string>>>
}

/** An enumerable declaration returned by {@link ShellEnvRegistry.list}. */
/* list 返回的一条可枚举声明。 */
export interface BashEnvVariableInfo extends BashEnvVariable {
  /** Contributor that owns the variable. */
  /* 拥有该变量的贡献者。 */
  contributor: string
  /** Declared `DSH_*` environment variable name. */
  /* 声明的 DSH_* 环境变量名。 */
  key: DshEnvironmentKey
}

const DSH_SHELL_KEY = `${DSH_ENV_PREFIX}SHELL` as const
const DSH_SESSION_ID_KEY = `${DSH_ENV_PREFIX}SESSION_ID` as const
const RESERVED_BASH_ENV_KEYS = new Set<DshEnvironmentKey>([
  DSH_HOME_ENV,
  DSH_SHELL_KEY,
  DSH_SESSION_ID_KEY,
])
// DSH_ 前缀之后的键名必须符合"大写字母开头，仅含大写字母/数字/下划线"的命名规范。
const BASH_ENV_KEY_SUFFIX = /^[A-Z][A-Z0-9_]*$/

/**
 * Registry (`ctx.shellEnv`) for trusted, per-execution `DSH_*` variables.
 * The namespace is rebuilt for every model shell call: ambient `DSH_*` values
 * are discarded by the executor, then the registry's current snapshot is
 * injected. Built-in shell facts remain owned by the registry itself while
 * plugins can register additional, enumerable facts with effect-scoped
 * disposal.
 */
/*
 * ctx.shellEnv 注册表：可信、按次执行的 DSH_* 变量注册中心。命名空间在每次模型 shell
 * 调用时重建：执行器先丢弃环境里残留的 DSH_* 值，再注入注册表当前快照。内置 shell 事实
 * 由注册表自身拥有；插件可登记额外的可枚举事实（随 effect 释放）。
 */
export class ShellEnvRegistry extends Service {
  /** 按贡献者名索引的贡献者表（用于查重与遍历）。 */
  private readonly contributors = new Map<string, BashEnvContributor>()
  /** 按键索引的所有权表（用于检测键冲突）。 */
  private readonly keyOwners = new Map<DshEnvironmentKey, string>()
  /** 已解析的 DSH_HOME 目录，内置事实之一。 */
  private readonly dshHome: string

  /**
   * Create and install the `ctx.shellEnv` service.
   * @param ctx - Cordis context that owns the service and registrations.
   * @param config - home-directory configuration for the built-in variables.
   */
  /*
   * 创建并安装 ctx.shellEnv 服务。
   * @param ctx 拥有该服务与注册的 Cordis 上下文
   * @param config 内置变量所需的主目录配置
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'shellEnv')
    this.dshHome = resolveDshHome(config.dshHome)
  }

  /**
   * Register one environment contributor. Names and keys are unique; built-in
   * keys are reserved. Registration is disposed with the calling plugin fiber.
   * @param contributor - declared key ownership and per-execution resolver.
   * @returns the disposer that unregisters the contribution.
   */
  /*
   * 注册一个环境贡献者。名称与键都要求唯一，内置键被保留（不可抢占）；注册随调用插件的
   * 生命周期自动释放。
   * @param contributor 声明了键所有权与按次解析器的贡献者
   * @returns 注销该贡献的释放器
   */
  register(contributor: BashEnvContributor): () => void {
    const dispose = this.ctx.effect(function* (this: ShellEnvRegistry) {
      if (contributor.name.trim().length === 0) {
        throw new Error('bash env contributor name must be non-empty')
      }
      if (this.contributors.has(contributor.name)) {
        throw new Error(`bash env contributor "${contributor.name}" is already registered`)
      }

      const variables = Object.entries(contributor.variables) as [DshEnvironmentKey, BashEnvVariable][]
      // 逐一校验声明：键前缀、命名规范、保留键、描述非空、键所有权唯一。
      for (const [key, variable] of variables) {
        if (!key.startsWith(DSH_ENV_PREFIX)
          || !BASH_ENV_KEY_SUFFIX.test(key.slice(DSH_ENV_PREFIX.length))) {
          throw new Error(`bash env contributor "${contributor.name}" declared invalid key "${key}"`)
        }
        if (RESERVED_BASH_ENV_KEYS.has(key)) {
          throw new Error(`bash env contributor "${contributor.name}" cannot own reserved key "${key}"`)
        }
        if (variable.description.trim().length === 0) {
          throw new Error(`bash env contributor "${contributor.name}" must describe "${key}"`)
        }
        const owner = this.keyOwners.get(key)
        if (owner !== undefined) {
          throw new Error(`bash env key "${key}" is already owned by contributor "${owner}"; contributor "${contributor.name}" cannot also own it`)
        }
      }

      // 校验通过后写入两份索引（按贡献者名、按键），yield 的清理函数在插件卸载时运行。
      this.contributors.set(contributor.name, contributor)
      for (const [key] of variables) this.keyOwners.set(key, contributor.name)
      yield () => {
        this.contributors.delete(contributor.name)
        for (const [key] of variables) this.keyOwners.delete(key)
      }
    }.bind(this), 'bashEnv.register()')
    return () => void dispose()
  }

  /**
   * Build the trusted `DSH_*` snapshot for one shell tool execution.
   * @param execution - the current tool execution.
   * @returns an immutable environment overlay containing built-ins and current contributions.
   */
  /*
   * 为一次 shell 工具执行构建可信的 DSH_* 快照：先放入内置事实（DSH_HOME、DSH_SHELL=1、
   * 有 agent 时加 DSH_SESSION_ID），再按贡献者名排序后合并各贡献者解析出的值；返回值
   * 是冻结（Object.freeze）且按键排序的不可变覆盖层。
   * @param execution 当前工具执行
   * @returns 包含内置事实与当前贡献值、且不可变的环境覆盖层
   */
  collect(execution: ToolExecution): DshEnvironment {
    // 以内置事实为基底：DSH_HOME 指向解析出的主目录，DSH_SHELL 恒为 1 表示"正在 shell 工具内"。
    const values: Record<DshEnvironmentKey, string> = {
      [DSH_HOME_ENV]: this.dshHome,
      [DSH_SHELL_KEY]: '1',
    }
    if (execution.agent !== undefined) {
      values[DSH_SESSION_ID_KEY] = execution.agent.session.header.id
    }

    // 按贡献者名排序以保证快照顺序稳定（同名贡献者的合并次序可预期）。
    for (const contributor of [...this.contributors.values()].sort((left, right) => left.name.localeCompare(right.name))) {
      const resolved = contributor.resolve(execution)
      for (const [rawKey, value] of Object.entries(resolved)) {
        const key = rawKey as DshEnvironmentKey
        // 返回了未声明键或非字符串值都立即抛错：快照必须可信，静默丢弃会掩盖贡献者 bug。
        if (!Object.hasOwn(contributor.variables, key)) {
          throw new Error(`bash env contributor "${contributor.name}" returned undeclared key "${key}"`)
        }
        if (typeof value !== 'string') {
          throw new Error(`bash env contributor "${contributor.name}" returned a non-string value for "${key}"`)
        }
        values[key] = value
      }
    }

    // 冻结并按键排序，产出不可变的最终快照。
    return Object.freeze(Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))))
  }

  // TODO(bash-env-list-builtins): Include registry-owned built-ins before diagnostics,
  // prompt, or UI code treats list() as an exhaustive environment catalog.
  /**
   * Enumerate plugin-contributed variables without executing their resolvers.
   * @returns declarations sorted by environment variable name.
   */
  /*
   * 枚举插件贡献的变量而不执行其解析器（用于诊断/提示/UI 展示；注意当前不含
   * 注册表自身的内置键，见上方 TODO 标记）。
   * @returns 按环境变量名排序的声明列表
   */
  list(): BashEnvVariableInfo[] {
    return [...this.contributors.values()]
      .flatMap(contributor => Object.entries(contributor.variables).map(([key, variable]) => ({
        contributor: contributor.name,
        description: variable.description,
        key: key as DshEnvironmentKey,
      })))
      .sort((left, right) => left.key.localeCompare(right.key))
  }
}

/**
 * Load the shell-env plugin: register the `ctx.shellEnv` registry service.
 * @param ctx - Cordis context that owns the service and registrations.
 * @param config - home-directory configuration for the built-in variables.
 */
/*
 * 加载 shell-env 插件：注册 ctx.shellEnv 服务与与 shell 无关的持久化贡献者
 * （DSH_SESSION_JSONL，把当前会话 JSONL 的绝对路径暴露给模型 shell 调用）。
 * @param ctx 拥有该服务与注册的 Cordis 上下文
 * @param config 内置变量所需的主目录配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  new ShellEnvRegistry(ctx, config)
}
