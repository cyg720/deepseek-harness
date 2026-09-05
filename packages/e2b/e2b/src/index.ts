/**
 * Shared ownership of one E2B sandbox. Capability adapters await the same SDK
 * handle, so filesystem and process operations inhabit one remote Linux world.
 * @module @deepseek-ai/dsh-e2b
 */

/*
 * 【文件职责】持有一个共享 E2B 沙箱，文件和进程适配器等待同一 SDK 句柄，以保证操作发生在同一远程 Linux 环境。
 */

import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileType, Sandbox, SandboxNotFoundError } from 'e2b'
import { proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'
import { e2bApiUrl } from './api-url.ts'

export {
  CommandExitError,
  FileNotFoundError,
  FileType,
  Sandbox,
  SandboxNotFoundError,
} from 'e2b'
export type { CommandHandle, CommandResult, EntryInfo } from 'e2b'

/**
 * Quote one opaque argument for the SDK's unavoidable `/bin/bash -l -c` layer.
 * @param value - Exact argument value to preserve.
 * @returns A single shell word with no interpolation.
 */
/*
 * 中文说明：函数 quoteE2BShellArg 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param value 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function quoteE2BShellArg(value: string): string {
  return `'${value.replaceAll('\'', "'\"'\"'")}'`
}

/**
 * Isolate E2B's hard-coded login shell behind a fresh randomized home path.
 * @param overrides - Additional environment entries for the internal command.
 * @returns A fresh mutable map that the E2B SDK may extend.
 */
/*
 * 中文说明：函数 e2bControlEnvs 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param overrides 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function e2bControlEnvs(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return { ...overrides, HOME: `/.dsh-e2b-control-${randomUUID()}` }
}

/** Configuration for the shared E2B sandbox owner. */
/* 中文说明：类型或类 Config 约束远程资源或测试数据职责。 */
export interface Config {
  /** API key; omission reads `E2B_API_KEY`. It is never forwarded into the sandbox. */
  apiKey?: string
  /** Shared remote working directory, created before adapters receive the sandbox. */
  cwd?: string
  /** E2B sandbox lifetime in milliseconds; expiry always deletes the sandbox. */
  timeoutMs?: number
}

/** 中文说明：类型或类 ResolvedConfig 约束远程资源或测试数据职责。 */
interface ResolvedConfig {
  apiKey: string
  cwd: string
  timeoutMs: number
}

/** 中文说明：类型或类 SchemaResolvedConfig 约束远程资源或测试数据职责。 */
interface SchemaResolvedConfig extends Config {
  cwd: string
  timeoutMs: number
}

declare module '@deepseek-ai/cordis' {
  /** 中文说明：类型或类 Context 约束远程资源或测试数据职责。 */
  interface Context {
    e2b: E2BRuntime
  }
}


/**
 * Creates one lazily consumable E2B SDK handle and deletes the sandbox at
 * timeout or disposal. Creation begins at plugin construction; adapters await
 * {@link getSandbox} before their first operation.
 */
/* 中文说明：类型或类 E2BRuntime 约束远程资源或测试数据职责。 */
export class E2BRuntime extends Service {
  static Config: z<Config> = z.object({
    apiKey: z.string(),
    cwd: z.string().default('/home/user/workspace'),
    timeoutMs: z.number().default(300_000),
  })

  /** Validated remote working directory shared by provider adapters. */
  readonly cwd: string
  /** Remote directory reserved for adapter-owned process and terminal state. */
  readonly runtimeRoot: string

  private readonly config: ResolvedConfig
  private readonly ready: Promise<Sandbox>
  private disposed = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'e2b')
    // Schemastery fills these fields before construction; the type does not encode that step.
    /** 中文说明：运行时局部值 resolved，由紧邻初始化决定。 */
    const resolved = config as SchemaResolvedConfig
    /** 中文说明：运行时局部值 apiKey，由紧邻初始化决定。 */
    const apiKey = config.apiKey ?? process.env.E2B_API_KEY
    this.config = {
      apiKey: apiKey ?? '',
      cwd: resolved.cwd,
      timeoutMs: resolved.timeoutMs,
    }
    this.validate()
    this.cwd = this.config.cwd
    this.runtimeRoot = posix.join(this.cwd, '.dsh-e2b')
    this.ready = this.open()
    // A deployment may load the owner before any adapter uses it. Keep a
    // failed eager connection observed; getSandbox() still returns the error.
    void this.ready.catch(() => {})

    ctx.effect(() => async () => {
      this.disposed = true
      /** 中文说明：运行时局部值 sandbox: Sandbox，由紧邻初始化决定。 */
      let sandbox: Sandbox
      try {
        sandbox = await this.ready
      } catch (_sandboxSetupFailure) {
        // open() either acquired no sandbox or already made the POC's one rollback attempt.
        return
      }
      try {
        await sandbox.kill()
      } catch (error: unknown) {
        if (!(error instanceof SandboxNotFoundError)) throw error
      }
    }, 'e2b sandbox teardown')
  }

  /**
   * Return the shared live SDK handle.
   * @returns the created sandbox after the configured cwd exists.
   * @throws when E2B rejects creation or the service is disposing.
   */
  async getSandbox(): Promise<Sandbox> {
    if (this.disposed) throw new Error('E2B sandbox service is disposing')
    /** 中文说明：运行时局部值 sandbox，由紧邻初始化决定。 */
    const sandbox = await this.ready
    // Disposal can race the awaited sandbox readiness despite the synchronous precheck.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Awaiting readiness yields to disposal.
    if (this.disposed) throw new Error('E2B sandbox service is disposing')
    return sandbox
  }

  private validate(): void {
    if (this.config.apiKey.length === 0) {
      throw new Error('dsh-e2b: configure apiKey or set E2B_API_KEY')
    }
    if (!posix.isAbsolute(this.config.cwd)) {
      throw new Error(`dsh-e2b: cwd must be an absolute Linux path: ${this.config.cwd}`)
    }
    if (!Number.isFinite(this.config.timeoutMs) || this.config.timeoutMs <= 0) {
      throw new Error('dsh-e2b: timeoutMs must be a positive finite number')
    }
  }

  private async open(): Promise<Sandbox> {
    // The SDK builds its own undici dispatcher, so the global one never reaches it; it takes a proxy
    // URL instead and reads no environment of its own. The decision is made against the URL the SDK
    // will really call, so a bypass entry naming that host is honored and a loopback debug plane
    // stays direct.
    const route = proxyRouteFor(new URL(e2bApiUrl()))
    const sandbox = await Sandbox.create({
      apiKey: this.config.apiKey,
      timeoutMs: this.config.timeoutMs,
      secure: true,
      lifecycle: { onTimeout: 'kill' },
      ...route.proxied ? { proxy: route.proxy } : {},
    })
    try {
      await sandbox.files.makeDir(this.cwd)
      await sandbox.files.makeDir(this.runtimeRoot)
      /** 中文说明：运行时局部值 runtimeRoot，由紧邻初始化决定。 */
      const runtimeRoot = await sandbox.files.getInfo(this.runtimeRoot)
      if (runtimeRoot.type !== FileType.DIR || runtimeRoot.symlinkTarget !== undefined) {
        throw new Error(`dsh-e2b: runtime root must be a real directory: ${this.runtimeRoot}`)
      }
      await sandbox.commands.run(
        `chmod 700 -- ${quoteE2BShellArg(this.runtimeRoot)}`,
        { envs: e2bControlEnvs() },
      )
      return sandbox
    } catch (error: unknown) {
      try {
        await sandbox.kill()
      } catch (_sandboxSetupRollbackFailure) {
        // TODO(e2b-setup-rollback): Add retry state only if a real double failure
        // outlives E2B's configured sandbox timeout.
      }
      throw error
    }
  }
}

export default E2BRuntime
