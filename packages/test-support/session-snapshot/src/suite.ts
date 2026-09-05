/**
 * Keyless-by-default ACP snapshot suite factory. Each scenario drives the real
 * subprocess and compares normalized stdout; comparable session fixtures are
 * both replay input and expected output. Record mode refreshes reproducible
 * model scenarios from the live API, while refresh mode replays committed
 * scripts and rewrites derived artifacts without a key.
 * Replay scenarios run concurrently because each subprocess owns unique temp
 * cwd and persistence roots and reads only committed fixtures. Record and
 * refresh stay serial while writing.
 *
 * Exactly one scenario per header-composition class pins the tokenized header
 * sequence. Its prompt and tool-schema sequences live in independent
 * sidecars, each of which may be shared with another class pin when the bytes
 * are identical. Every live header is checked against the composed pin, so
 * session-dependent composition must declare a separate class instead of
 * escaping coverage.
 * @module @deepseek-ai/dsh-session-snapshot/suite
 */
/*
 * 文件职责：实现 suite.ts 覆盖的快照与装载测试支持行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的快照与装载测试支持能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isSurfaceEligibleType } from '@deepseek-ai/dsh-session/surface'
import { describe, expect, it } from 'vitest'
import { type AgentUnderTest, type HarvestedLog, type InputScript, runScenario } from './harness.ts'
import {
  parseSnapshotManifest,
  writesCurrentSessionFixtures,
  type SnapshotSessionFormatManifest,
} from './manifest.ts'
import { redactSessionSnapshotIds } from './identity.ts'
import { captureExpectedWorkspaceSnapshot } from './workspace.ts'
import {
  assertSessionFixtureVersion,
  sessionFixtureName,
  sessionFixtureNames,
  sessionHeaderVersion,
} from './session-files.ts'
import {
  type CwdPathMode,
  /** 中文说明：type NormalizeContext 定义本模块所需的数据或行为，用于表达快照与装载测试支持场景。 */
  type NormalizeContext,
  extractSnapshotSpillPaths,
  normalizeSessionLog,
  normalizeSessionSnapshots,
  normalizeStdout,
  scrubRequestHeaders,
  scrubSessionSnapshot,
  scrubSystemPrompts,
  scrubToolSchemas,
  tokenizeSessionFixtureCwd,
} from './normalize.ts'

/** The readable system-prompt snapshot beside its owning header pin. */
/* 中文说明：常量 SYSTEM_PROMPT_SNAPSHOT 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SYSTEM_PROMPT_SNAPSHOT = 'system-prompt.expected.md'

/** The structured tool-schema snapshot beside its owning header pin. */
/* 中文说明：常量 TOOL_SCHEMAS_SNAPSHOT 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TOOL_SCHEMAS_SNAPSHOT = 'tool-schemas.expected.json'

/** Return the dedicated tool-schema sidecar for one child fixture index. */
/* 中文说明：函数 childToolSchemasSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function childToolSchemasSnapshot(index: number): string {
  return `tool-schemas.${index}.expected.json`
}

/** Return the dedicated system-prompt sidecar for one child fixture index. */
/* 中文说明：函数 childSystemPromptSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function childSystemPromptSnapshot(index: number): string {
  return `system-prompt.${index}.expected.md`
}

/** The optional full Windows-native stdout transcript. */
/* 中文说明：常量 WINDOWS_STDOUT_SNAPSHOT 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const WINDOWS_STDOUT_SNAPSHOT = 'stdout.expected.windows.jsonl'

/** Stable session-log token standing in for the sidecar's initial schemas. */
/* 中文说明：常量 TOOLS_TOKEN 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TOOLS_TOKEN = '{{tools}}'

/** 中文说明：常量 PACKED_CHUNK_ROW_TYPES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PACKED_CHUNK_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

/** Canonical UUID spelling minted for ordinary message identities. */
/* 中文说明：常量 UUID_RE 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A snapshot scenario and how its fixtures are produced. */
/* 中文说明：interface Scenario 定义本模块所需的数据或行为，用于表达快照与装载测试支持场景。 */
export interface Scenario {
  name: string
  /** Deployment environment for this scenario's subprocess. */
  env?: NodeJS.ProcessEnv
  /** Whether the scenario drives at least one model turn (so a JSONL expected output applies). */
  hasModelTurn: boolean
  /**
   * Whether the run persists a comparable session log to diff against the
   * selected parent Session fixture. Defaults to {@link hasModelTurn} (a model turn
   * always produces a log worth comparing). Set it independently for a scenario
   * that produces a non-trivial durable log without calling the model.
   */
  comparesLog?: boolean
  /**
   * Whether `test:snapshot:record` regenerates this scenario's current-version
   * Session fixtures from the LIVE API. `recorded` scenarios are model-driven and reproducible;
   * `authored` scenarios (fixtures hand-written or hand-harvested — e.g. a
   * provider error or a cancel the live API can't be coaxed into
   * deterministically, a deterministic hook scenario, or a scripted repetition
   * a live model won't reproduce) are NEVER re-recorded.
   */
  recorded: boolean
  /** Historical generation retained as a read-only migration fixture. */
  sessionFormat?: SnapshotSessionFormatManifest
  /**
   * Whether replay is driven by a hand-written `replay.override.json` sidecar
   * (a `ReplayOverrideDoc` that replaces or patches the script derived from
   * selected parent Session fixture) — the throw/hang cases chunks cannot express. The fixture
   * guard requires the sidecar exactly when this is set: the harness forwards
   * the file purely on existence, so an unregistered stray sidecar would
   * silently alter the derived script. The guard fails loud on either
   * mismatch. Defaults to false (replay derives from the fixture's
   * `assistant/chunk` events).
   */
  overridden?: boolean
  /**
   * Whether this scenario is its header class's sole tokenized request-header
   * pin. Prompt and tool-schema sidecars are selected independently, while
   * every classmate is checked for equality with the reconstructed header.
   */
  pinsHeader?: boolean
  /**
   * Header-pinning scenario whose `system-prompt.expected.md` this pin reuses.
   * Defaults to this scenario. The source must own its prompt sidecar and
   * declare the same {@link expectedHeaderChanges}; meaningless off a pin.
   */
  systemPromptSource?: string
  /**
   * Header-pinning scenario whose `tool-schemas.expected.json` this pin reuses.
   * Defaults to this scenario. The source must own its schema sidecar and
   * declare the same {@link expectedHeaderChanges}; meaningless off a pin.
   */
  toolSchemasSource?: string
  /**
   * Child fixture indices whose own schema sequence is pinned separately,
   * where `1` names `session.1.jsonl` and
   * `tool-schemas.1.expected.json`. The class pin still owns every other
   * request-header field.
   */
  pinsChildToolSchemas?: readonly number[]
  /**
   * Child fixture indices whose own system prompt is pinned separately, where
   * `1` names `session.1.jsonl` and `system-prompt.1.expected.md`. A child
   * scope that installs its own prompt section (the continuable `report`
   * guidance) composes a prompt the class pin cannot describe.
   */
  pinsChildSystemPrompts?: readonly number[]
  /**
   * How many changed `request/header` snapshots this PINNING scenario's primary
   * fixture legitimately carries (default 0). Their full prompt text is kept in
   * the readable Markdown pin; any other count fails. Meaningless off the pin.
   */
  expectedHeaderChanges?: number
  /**
   * Which header-composition class this scenario belongs to. Scenarios that
   * boot the same config compose the same header; each class has exactly one
   * {@link pinsHeader} scenario, and the uniformity guard compares every
   * other member against ITS class's pin. Defaults to `'default'`; a
   * scenario booting an alternate config ({@link configPath}) whose tool
   * list or prompt sections differ by construction carries its own class.
   */
  headerClass?: string
  /**
   * Alternate live profile patch (absolute) this scenario boots instead of
   * {@link AgentUnderTest.configPath}. Its basename must still end in
   * `cordis.yml` so the launcher finds the replay sibling. A scenario whose
   * patch changes the composed header also needs its own
   * {@link headerClass}.
   */
  configPath?: string
  /**
   * Parent directory for the generated session cwd. Defaults to the platform
   * temp directory; set this when temp is itself part of the behavior under
   * test and the scenario needs an independent project location.
   */
  workspaceParent?: string
  /**
   * Optional final workspace preparation after the committed fixture is
   * copied. Reserve this for paths that Git cannot represent portably; normal
   * scenario files belong under the scenario's `workspace/` directory.
   */
  prepareWorkspace?: (cwd: string) => void | Promise<void>
  /**
   * Whether Windows additionally compares stdout with native separators against
   * `stdout.expected.windows.jsonl`. The shared canonical stdout expected output is still
   * compared on every platform, and the fixture guard requires this sidecar
   * exactly when the option is set.
   */
  pinsNativeWindowsStdout?: boolean
  /**
   * Whether the scenario requires a non-Windows host, such as for POSIX process
   * semantics or generated paths Windows cannot represent. The scenario's run
   * test is skipped on Windows; its fixtures stay guarded on every platform.
   */
  posixOnly?: boolean
  /**
   * Whether the scenario boots a composition that needs a usable `pwsh`
   * (the pwsh-tool-turn scenario). The run test is skipped when the suite's
   * {@link SnapshotSuiteOptions.hasPwsh} probe is false; fixtures stay guarded
   * on every platform.
   */
  pwshOnly?: boolean
}

/**
 * Whether a scenario's run test is skipped for this mode and host: record mode
 * skips authored (non-`recorded`) scenarios and explicit historical Session
 * generations, {@link Scenario.posixOnly} scenarios skip on Windows, and
 * {@link Scenario.pwshOnly} scenarios skip when the caller's `hasPwsh` probe
 * is false.
 *
 * @param scenario The scenario whose run test is being registered.
 * @param recording Whether the suite runs in record mode.
 * @param platform The running Node platform, injectable for unit coverage.
 * @param hasPwsh The caller's pwsh-availability probe; `pwshOnly` scenarios
 *   skip unless it is true.
 * @returns True when the scenario's run test must not execute.
 */
/*
 * 中文说明：函数 scenarioSkipped 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param scenario 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param recording 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param platform 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param hasPwsh 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function scenarioSkipped(
  scenario: Scenario,
  recording: boolean,
  platform: NodeJS.Platform = process.platform,
  hasPwsh?: boolean,
): boolean {
  if (recording && (!scenario.recorded || scenario.sessionFormat !== undefined)) return true
  if (scenario.posixOnly === true && platform === 'win32') return true
  return scenario.pwshOnly === true && hasPwsh !== true
}

/** One stdout expected output selected for a platform run. */
/* 中文说明：interface StdoutExpectedVariant 定义本模块所需的数据或行为，用于表达快照与装载测试支持场景。 */
interface StdoutExpectedVariant {
  file: string
  cwdPathMode: CwdPathMode
}

/**
 * Select the shared stdout expected output plus any platform-native assertion declared by a scenario.
 *
 * @param scenario The scenario whose stdout contract is being selected.
 * @param platform The running Node platform, injectable for unit coverage.
 * @returns The ordered expected-output variants: shared canonical first, then optional Windows native.
 */
/*
 * 中文说明：函数 stdoutExpectedVariants 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param scenario 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param platform 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function stdoutExpectedVariants(
  scenario: Scenario,
  platform: NodeJS.Platform = process.platform,
): StdoutExpectedVariant[] {
  /** 中文说明：变量 canonical 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const canonical: StdoutExpectedVariant = { file: 'stdout.expected.jsonl', cwdPathMode: 'canonical' }
  if (platform !== 'win32' || scenario.pinsNativeWindowsStdout !== true) return [canonical]
  return [canonical, { file: WINDOWS_STDOUT_SNAPSHOT, cwdPathMode: 'native' }]
}

/** One suite's inputs: the agent to boot, where its fixtures live, and its scenario table. */
/* 中文说明：interface SnapshotSuiteOptions 定义本模块所需的数据或行为，用于表达快照与装载测试支持场景。 */
export interface SnapshotSuiteOptions {
  /** The agent composition every scenario boots. */
  agent: AgentUnderTest
  /** Absolute path of the suite's `snapshots/` directory (one subdir per scenario). */
  snapshotsDir: string
  /** The scenario table; exactly one entry per header class must set `pinsHeader`. */
  scenarios: Scenario[]
  /**
   * `replay` (keyless, the default tier), `record` (live API; re-records the
   * `recorded` scenarios' fixtures and refreshes the Vitest expected outputs under
   * `--update`), or `refresh` (keyless replay that rewrites stdout expected outputs and
   * comparable session fixtures from the replay run). The caller derives this
   * from `$DSH_SNAPSHOT` — env reading stays outside this library.
   */
  mode: 'replay' | 'record' | 'refresh'
  /**
   * Whether a real `pwsh` executable is available on this host (the probe the
   * caller owns; `pwshOnly` scenarios skip when this is not true).
   */
  hasPwsh?: boolean
}

/** One scenario's generated claim on a shared snapshot file. */
/* 中文说明：interface SharedSnapshotClaim 定义本模块所需的数据或行为，用于表达快照与装载测试支持场景。 */
export interface SharedSnapshotClaim {
  /** Scenario that first generated the snapshot in this suite run. */
  scenario: string
  /** Complete generated file content. */
  content: string
}

/** One committed snapshot file and its complete content. */
/* 中文说明：interface NamedSnapshotContent 定义本模块所需的数据或行为，用于表达快照与装载测试支持场景。 */
export interface NamedSnapshotContent {
  /** Diagnostic path of the committed file. */
  path: string
  /** Complete committed file content. */
  content: string
}

/**
 * Record one scenario's generated content for a shared snapshot source.
 * A later claimant must generate identical bytes; otherwise record/refresh
 * would make the final file depend on scenario order.
 *
 * @param claims Claims already made in this suite run, keyed by source path.
 * @param source The shared snapshot path being claimed.
 * @param scenario The scenario generating the content.
 * @param content The complete content the scenario generated.
 * @returns Nothing.
 */
/*
 * 中文说明：函数 claimSharedSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param claims 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param source 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param scenario 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param content 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function claimSharedSnapshot(
  claims: Map<string, SharedSnapshotClaim>,
  source: string,
  scenario: string,
  content: string,
): void {
  /** 中文说明：变量 previous 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const previous = claims.get(source)
  if (previous !== undefined && previous.content !== content) {
    throw new Error(
      `acp-snapshot: shared snapshot ${source} diverged between ${previous.scenario} and ${scenario}`,
    )
  }
  if (previous === undefined) claims.set(source, { scenario, content })
}

/**
 * Reject byte-identical committed snapshots stored under different paths.
 *
 * @param kind Human-readable snapshot kind for the diagnostic.
 * @param snapshots The committed files to compare.
 * @returns Nothing.
 */
/*
 * 中文说明：函数 assertUniqueSnapshotContents 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param kind 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param snapshots 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function assertUniqueSnapshotContents(
  kind: string,
  snapshots: readonly NamedSnapshotContent[],
): void {
  /** 中文说明：变量 firstPathByContent 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const firstPathByContent = new Map<string, string>()
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const snapshot of snapshots) {
    /** 中文说明：变量 firstPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstPath = firstPathByContent.get(snapshot.content)
    if (firstPath !== undefined) {
      throw new Error(
        `acp-snapshot: identical ${kind} snapshots appear in ${firstPath} and ${snapshot.path}; reuse one source`,
      )
    }
    firstPathByContent.set(snapshot.content, snapshot.path)
  }
}

/** Read one scenario directory's validated session-fixture inventory. */
/* 中文说明：函数 sessionFixtures 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function sessionFixtures(dir: string): Promise<string[]> {
  /** 中文说明：变量 entries 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries = await readdir(dir, { withFileTypes: true })
  const names = sessionFixtureNames(entries.filter(entry => entry.isFile()).map(entry => entry.name))
  await Promise.all(names.map(async (name) => {
    assertSessionFixtureVersion(name, await readFile(join(dir, name), 'utf8'))
  }))
  return names
}

/**
 * Derive normalization values from a fixture's own session header. Recorded ids and cwd differ
 * from the live replay run; the non-empty sentinel for missing cwd avoids accidental empty-
 * string replacement.
 *
 * @param fixture The selected committed parent Session fixture content.
 * @returns The fixture's own volatile values, ready for {@link normalizeSessionLog}.
 */
/*
 * 中文说明：函数 fixtureContext 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param fixture 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function fixtureContext(fixture: string): NormalizeContext {
  /** 中文说明：函数值 firstLine 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const firstLine = fixture.split('\n').find(line => line.trim().length > 0) ?? '{}'
  /** 中文说明：变量 header 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const header = JSON.parse(firstLine) as { id?: unknown; cwd?: unknown }
  return {
    sessionIds: typeof header.id === 'string' ? [header.id] : [],
    cwd: typeof header.cwd === 'string' ? header.cwd : '\0no-cwd\0',
  }
}

interface NormalizedHeaderEvent {
  readonly header: unknown
  readonly reason: unknown
}

/** Normalize request-header payloads while retaining the reason that selects a pin revision. */
function normalizedHeaderEvents(rawLog: string, ctx: NormalizeContext): NormalizedHeaderEvent[] {
  return normalizeSessionLog(rawLog, ctx)
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as {
      type?: unknown
      data?: { header?: unknown; reason?: unknown }
    })
    .filter(record => record.type === 'request/header')
    .map(record => ({ header: record.data?.header, reason: record.data?.reason }))
}

/**
 * Header revisions that own sidecar content. `series` reuses the current revision, while
 * `resume` owns sidecars because its full snapshot may drift across the process boundary.
 * Pinning fixtures therefore cover one loop instance; a mid-log `resume` fails their
 * pin-count invariant.
 */
function pinningHeaderPayloads(rawLog: string, ctx: NormalizeContext): unknown[] {
  return normalizedHeaderEvents(rawLog, ctx)
    .filter(event => event.reason !== 'series')
    .map(event => event.header)
}

/** Extract every string system prompt from a normalized header sequence. */
function systemPromptsFrom(headers: readonly unknown[]): string[] {
  return headers.flatMap((header) => {
    if (header === null || typeof header !== 'object') return []
    const system = (header as { system?: unknown }).system
    return typeof system === 'string' ? [system] : []
  })
}

/** Extract every array-valued tool catalog from a normalized header sequence. */
function toolSchemasFrom(headers: readonly unknown[]): unknown[][] {
  return headers.flatMap((header) => {
    if (header === null || typeof header !== 'object') return []
    const tools = (header as { tools?: unknown }).tools
    return Array.isArray(tools) ? [tools] : []
  })
}

/**
 * The `data.header` payload of every `request/header` event in a session
 * JSONL, in log order, with the log's volatile values scrubbed first
 * ({@link normalizeSessionLog}) so headers harvested from different runs —
 * each embedding its own generated cwd in the composed prompt — compare on equal
 * footing.
 *
 * @param rawLog The session `.jsonl` content to extract headers from.
 * @param ctx The volatile values of the run that produced it.
 * @returns The normalized `data.header` payloads, in log order.
 */
/*
 * 中文说明：函数 normalizedHeaders 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param ctx 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function normalizedHeaders(rawLog: string, ctx: NormalizeContext): unknown[] {
  return normalizedHeaderEvents(rawLog, ctx).map(event => event.header)
}

/**
 * The normalized string-valued system prompts carried by request headers in a
 * session JSONL, in log order. Headers without a string prompt are omitted so
 * callers can assert one prompt per header explicitly.
 *
 * @param rawLog The session `.jsonl` content to inspect.
 * @param ctx The volatile values of the run that produced it.
 * @returns The normalized system prompts, in header order.
 */
/*
 * 中文说明：函数 normalizedSystemPrompts 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param ctx 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function normalizedSystemPrompts(rawLog: string, ctx: NormalizeContext): string[] {
  return systemPromptsFrom(normalizedHeaders(rawLog, ctx))
}

/**
 * The normalized tool-schema arrays carried by request headers in a session
 * JSONL, in log order. Headers without an array-valued tools field are omitted
 * so callers can assert one schema set per header explicitly.
 *
 * @param rawLog The session `.jsonl` content to inspect.
 * @param ctx The volatile values of the run that produced it.
 * @returns The normalized initial tool-schema arrays, in header order.
 */
/*
 * 中文说明：函数 normalizedToolSchemas 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param ctx 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function normalizedToolSchemas(rawLog: string, ctx: NormalizeContext): unknown[][] {
  return toolSchemasFrom(normalizedHeaders(rawLog, ctx))
}

/** The structured contents of a tool-schema sidecar. */
/* 中文说明：interface ToolSchemasSnapshot 定义本模块所需的数据或行为，用于表达快照与装载测试支持场景。 */
export interface ToolSchemasSnapshot {
  /** The complete tool schemas from the pinned request header. */
  initial: unknown[]
  /** Complete tool schemas from subsequent changed-header snapshots. */
  changes: unknown[][]
}

/**
 * Render the full tool-schema sequence as canonical, readable JSON.
 *
 * @param initial The pinned request header's complete tool schemas.
 * @param changes Complete tool schemas from later changed headers.
 * @returns A pretty-printed JSON snapshot ending in one newline.
 */
/*
 * 中文说明：函数 formatToolSchemasSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param initial 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param changes 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function formatToolSchemasSnapshot(initial: readonly unknown[], changes: readonly unknown[][] = []): string {
  return `${JSON.stringify({ initial, changes }, null, 2)}\n`
}

/**
 * Parse and validate the stable top-level fields of a tool-schema sidecar.
 *
 * @param snapshot The JSON sidecar text.
 * @returns Its initial and changed-header schema sets.
 */
/*
 * 中文说明：函数 parseToolSchemasSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param snapshot 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function parseToolSchemasSnapshot(snapshot: string): ToolSchemasSnapshot {
  /** 中文说明：变量 parsed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = JSON.parse(snapshot) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('acp-snapshot: tool-schema snapshot must be an object')
  }
  const { initial, changes } = parsed as { initial?: unknown; changes?: unknown }
  if (!Array.isArray(initial) || !Array.isArray(changes) || !changes.every(Array.isArray)) {
    throw new Error('acp-snapshot: tool-schema snapshot must carry array-valued initial and changes fields')
  }
  return { initial, changes }
}

/**
 * Restore one sidecar schema set into a tokenized pinned header.
 *
 * @param header The parsed request header carrying `tools: "{{tools}}"`.
 * @param schemas The complete schemas for this full header snapshot.
 * @returns A copy of the header with its complete schemas restored.
 */
/*
 * 中文说明：函数 restorePinnedToolSchemas 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param header 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param schemas 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function restorePinnedToolSchemas(header: unknown, schemas: readonly unknown[]): unknown {
  if (header === null || typeof header !== 'object' || Array.isArray(header)) {
    throw new Error('acp-snapshot: pinned request header must be an object')
  }
  if ((header as { tools?: unknown }).tools !== TOOLS_TOKEN) {
    throw new Error(`acp-snapshot: pinned request header tools must equal ${TOOLS_TOKEN}`)
  }
  return { ...header, tools: schemas }
}

/**
 * Render a normalized prompt as a repository-friendly Markdown snapshot.
 * Prompt text is unchanged except that a missing terminal newline is added so
 * the committed file follows the repository newline contract.
 *
 * @param prompt The normalized system prompt.
 * @param changes Full normalized prompts from later changed-header snapshots.
 * @returns Markdown snapshot text ending in a newline.
 */
/*
 * 中文说明：函数 formatSystemPromptSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param prompt 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param changes 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function formatSystemPromptSnapshot(
  prompt: string,
  changes: readonly string[] = [],
): string {
  /** 中文说明：变量 snapshot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let snapshot = prompt.endsWith('\n') ? prompt : `${prompt}\n`
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const [index, change] of changes.entries()) {
    snapshot += `\n<!-- request/header change ${index + 1} -->\n\n`
    snapshot += change.endsWith('\n') ? change : `${change}\n`
  }
  return snapshot
}

/**
 * Reject a child prompt sidecar that cannot own distinct, canonical prompt text.
 * @param sidecar - committed child prompt snapshot.
 * @param classPin - initial prompt snapshot owned by the scenario's header class.
 * @param label - repository-relative fixture label for diagnostics.
 */
/*
 * 中文说明：函数 assertChildSystemPromptSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param sidecar 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param classPin 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param label 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function assertChildSystemPromptSnapshot(sidecar: string, classPin: string, label: string): void {
  if (sidecar.trim().length === 0) throw new Error(`${label} must pin a non-empty prompt`)
  if (!sidecar.endsWith('\n')) throw new Error(`${label} must end in a newline`)
  if (sidecar === classPin) throw new Error(`${label} must differ from its class pin`)
}

/** Return the initial-prompt portion of a possibly multi-header snapshot. */
/* 中文说明：函数 initialSystemPromptSnapshot 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function initialSystemPromptSnapshot(snapshot: string): string {
  /** 中文说明：变量 marker 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const marker = snapshot.indexOf('\n<!-- request/header change ')
  return marker < 0 ? snapshot : snapshot.slice(0, marker)
}

/**
 * Count changed `request/header` snapshots in a session JSONL.
 *
 * @param rawLog The session `.jsonl` content.
 * @returns How many headers carry reason `change`.
 */
/*
 * 中文说明：函数 headerChangeCount 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function headerChangeCount(rawLog: string): number {
  return rawLog.split('\n')
    .filter(line => line.trim().length > 0)
    .filter((line) => {
      /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const record = JSON.parse(line) as { type?: unknown; data?: { reason?: unknown } }
      return record.type === 'request/header' && record.data?.reason === 'change'
    })
    .length
}

/** A literal replacement from a fresh replay-run volatile to its existing fixture value. */
/* 中文说明：interface FixtureReplacement 定义本模块所需的数据或行为，用于表达快照与装载测试支持场景。 */
export interface FixtureReplacement {
  /** The fresh replay run's volatile value. */
  from: string
  /** The existing fixture value retained during write-back. */
  to: string
}

/** 中文说明：函数 parseJsonlRecords 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function parseJsonlRecords(text: string): Record<string, unknown>[] {
  return text.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

/** Narrow one parsed value to the complete identified-message shape retained by fixtures. */
/* 中文说明：函数 completeMessage 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function completeMessage(value: unknown): Record<string, unknown> | undefined {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !UUID_RE.test(value.id)
    || typeof value.role !== 'string'
    || !Array.isArray(value.content)
    || !isRecord(value.source)
  ) return undefined
  return value
}

/** Return the complete identified message carried by one surface event. */
/* 中文说明：函数 surfaceEventMessage 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function surfaceEventMessage(record: Record<string, unknown>): Record<string, unknown> | undefined {
  /** 中文说明：变量 type 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const type = record.type
  if (typeof type !== 'string' || !isSurfaceEligibleType(type)) return undefined
  /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const data = record.data
  if (!isRecord(data)) return undefined
  /** 中文说明：变量 message 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let message: unknown
  switch (type) {
    case 'user/message':
      message = data
      break
    case 'assistant/message':
    case 'tool/result':
      message = data.message
      break
    /* v8 ignore next -- the authoritative predicate must fail loud when a new surface shape lands. */
    default: throw new Error(`acp-snapshot: unsupported surface event type "${type}"`)
  }
  return completeMessage(message)
}

/** Return complete message identities structurally owned by one durable record. */
/* 中文说明：函数 recordMessages 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function recordMessages(record: Record<string, unknown>): Record<string, unknown>[] {
  /** 中文说明：变量 surfaceMessage 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const surfaceMessage = surfaceEventMessage(record)
  if (surfaceMessage !== undefined) return [surfaceMessage]
  if (record.type !== 'agent/inbox/spliced' || !isRecord(record.data) || !Array.isArray(record.data.inserted)) {
    return []
  }
  return record.data.inserted.flatMap((value) => {
    /** 中文说明：变量 message 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const message = completeMessage(value)
    return message === undefined ? [] : [message]
  })
}

/** Serialize parsed JSON by value rather than insertion order. */
/* 中文说明：函数 canonicalJson 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Index identity-free message values whose ID and fingerprint are mutually unique. */
/* 中文说明：函数 uniqueMessageIds 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function uniqueMessageIds(logs: readonly string[]): Map<string, string> {
  /** 中文说明：变量 fingerprintsById 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fingerprintsById = new Map<string, Set<string>>()
  /** 中文说明：变量 idsByFingerprint 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const idsByFingerprint = new Map<string, Set<string>>()
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const log of logs) {
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const record of parseJsonlRecords(log)) {
      /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
      for (const message of recordMessages(record)) {
        const { id, ...withoutId } = message
        /** 中文说明：变量 messageId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const messageId = id as string
        /** 中文说明：变量 fingerprint 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const fingerprint = canonicalJson(withoutId)
        /** 中文说明：变量 fingerprints 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const fingerprints = fingerprintsById.get(messageId)
        if (fingerprints === undefined) fingerprintsById.set(messageId, new Set([fingerprint]))
        else fingerprints.add(fingerprint)
        /** 中文说明：变量 ids 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ids = idsByFingerprint.get(fingerprint)
        if (ids === undefined) idsByFingerprint.set(fingerprint, new Set([messageId]))
        else ids.add(messageId)
      }
    }
  }

  /** 中文说明：变量 unique 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const unique = new Map<string, string>()
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const [id, fingerprints] of fingerprintsById) {
    if (fingerprints.size !== 1) continue
    /** 中文说明：变量 fingerprint 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fingerprint = fingerprints.values().next().value as string
    if (idsByFingerprint.get(fingerprint)?.size !== 1) continue
    unique.set(fingerprint, id)
  }
  return unique
}

/**
 * Match unchanged complete messages across a scenario's fresh and existing logs.
 * New, changed, duplicate-content, or otherwise ambiguous messages keep their fresh ids.
 */
/* 中文说明：函数 fixtureMessageIdReplacements 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function fixtureMessageIdReplacements(logs: readonly string[], fixtures: readonly string[]): Map<string, string> {
  /** 中文说明：变量 freshIds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const freshIds = uniqueMessageIds(logs)
  /** 中文说明：变量 existingIds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const existingIds = uniqueMessageIds(fixtures)
  /** 中文说明：变量 replacements 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const replacements = new Map<string, string>()
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const [fingerprint, fresh] of freshIds) {
    /** 中文说明：变量 existing 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const existing = existingIds.get(fingerprint)
    if (existing === undefined || fresh === existing) continue
    replacements.set(fresh, existing)
  }
  return replacements
}

/** Apply literal fixture replacements without changing any other fresh value. */
/* 中文说明：函数 applyFixtureReplacements 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function applyFixtureReplacements(content: string, replacements: readonly FixtureReplacement[]): string {
  /** 中文说明：变量 stable 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let stable = content
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const { from, to } of replacements) stable = stable.split(from).join(to)
  return stable
}

/** Rewrite only validated durable-message ID fields, leaving every other occurrence untouched. */
/* 中文说明：函数 applyFixtureMessageIds 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function applyFixtureMessageIds(content: string, replacements: ReadonlyMap<string, string>): string {
  return content.split('\n').map((line) => {
    if (line.trim().length === 0) return line
    /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const record = JSON.parse(line) as Record<string, unknown>
    /** 中文说明：变量 changed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let changed = false
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const message of recordMessages(record)) {
      /** 中文说明：变量 replacement 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const replacement = replacements.get(message.id as string)
      if (replacement === undefined) continue
      message.id = replacement
      changed = true
    }
    return changed ? JSON.stringify(record) : line
  }).join('\n')
}

/**
 * Carry committed UUIDs into unchanged, unambiguous messages in fresh session fixtures.
 *
 * @param logs Fresh fixture-ready session JSONL contents for one scenario.
 * @param fixtures Existing fixture contents in matching order; missing fixtures may be empty strings.
 * @returns The fresh contents with only reusable message UUIDs replaced.
 */
/*
 * 中文说明：函数 stabilizeFixtureMessageIds 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param logs 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param fixtures 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function stabilizeFixtureMessageIds(logs: readonly string[], fixtures: readonly string[]): string[] {
  /** 中文说明：变量 replacements 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const replacements = fixtureMessageIdReplacements(logs, fixtures)
  return logs.map(log => applyFixtureMessageIds(log, replacements))
}

/** One packed row's member times, or `undefined` for an ordinary record. */
/* 中文说明：函数 packedTimes 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function packedTimes(record: Record<string, unknown>): number[] | undefined {
  if (!PACKED_CHUNK_ROW_TYPES.has(record.type as string)) return undefined
  /** 中文说明：变量 row 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const row = record as unknown as { time0?: number; data: { dt: number[] } }
  /** 中文说明：变量 times 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const times = [row.time0 ?? 0]
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const gap of row.data.dt) times.push((times[times.length - 1] as number) + gap)
  return times
}

/** Expand packed timing envelopes so refresh alignment follows logical events, not physical lines. */
/* 中文说明：函数 logicalRecords 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function logicalRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  return records.flatMap((record) => {
    /** 中文说明：变量 times 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const times = packedTimes(record)
    return times === undefined ? [record] : times.map(time => ({ type: 'assistant/chunk', time }))
  })
}

/**
 * Find tool calls whose structured result reports `UNKNOWN_TOOL`.
 *
 * Snapshot refresh must not turn a missing registration into accepted behavior;
 * intentional unknown-tool behavior belongs in a focused unit or e2e test.
 *
 * @param rawLog The session JSONL to inspect.
 * @returns The failing call ids in log order, using a diagnostic placeholder when absent.
 */
/*
 * 中文说明：函数 unknownToolCallIds 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rawLog 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function unknownToolCallIds(rawLog: string): string[] {
  return parseJsonlRecords(rawLog).flatMap((record) => {
    if (record.type !== 'tool/result') return []
    /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const data = record.data
    if (data === null || typeof data !== 'object') return []
    const { message, error } = data as { message?: unknown; error?: unknown }
    if (error === null || typeof error !== 'object') return []
    if ((error as { code?: unknown }).code !== 'UNKNOWN_TOOL') return []
    /** 中文说明：变量 source 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = typeof message === 'object' && message !== null
      ? (message as { source?: unknown }).source
      : undefined
    /** 中文说明：变量 callId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const callId = typeof source === 'object' && source !== null
      ? (source as { callId?: unknown }).callId
      : undefined
    return [typeof callId === 'string' ? callId : '<missing callId>']
  })
}

/**
 * Build refresh write-back replacements for per-log session ids, cwd values,
 * and spill paths. Durable message ids have a later structural owner.
 *
 * @param logs The freshly harvested logs, in fixture order.
 * @param fixtures The existing fixture contents, in matching order.
 * @returns Literal replacements from fresh values to the fixture's existing values.
 */
/*
 * 中文说明：函数 refreshFixtureReplacements 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param logs 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param fixtures 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function refreshFixtureReplacements(logs: HarvestedLog[], fixtures: string[]): FixtureReplacement[] {
  /** 中文说明：变量 replacements 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const replacements: FixtureReplacement[] = []
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (let i = 0; i < logs.length; i++) {
    /** 中文说明：变量 fresh 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fresh = parseJsonlRecords((logs[i] as HarvestedLog).content)[0]
    /** 中文说明：变量 existing 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const existing = parseJsonlRecords(fixtures[i] ?? '')[0]
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const field of ['id', 'cwd'] as const) {
      /** 中文说明：变量 from 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const from = fresh?.[field]
      /** 中文说明：变量 to 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const to = existing?.[field]
      if (typeof from === 'string' && typeof to === 'string' && from.length > 0 && from !== to) {
        replacements.push({ from, to })
      }
    }
    // Stabilize snapshot spill paths: match by filename suffix so the raw
    // fixture does not churn on every refresh from a different session run.
    /** 中文说明：变量 freshSpills 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const freshSpills = extractSnapshotSpillPaths((logs[i] as HarvestedLog).content)
    /** 中文说明：变量 existingSpills 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const existingSpills = extractSnapshotSpillPaths(fixtures[i] ?? '')
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const [name, existingPath] of existingSpills) {
      /** 中文说明：变量 freshPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const freshPath = freshSpills.get(name)
      if (freshPath !== undefined && freshPath !== existingPath) {
        replacements.push({ from: freshPath, to: existingPath })
      }
    }
  }
  return replacements
}

/** 中文说明：函数 preserveFixtureVolatiles 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function preserveFixtureVolatiles(record: Record<string, unknown>, existing: Record<string, unknown> | undefined): void {
  if (existing === undefined || existing.type !== record.type) return
  if (record.type === 'session') {
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const field of ['id', 'createdAt', 'cwd', 'parentSession'] as const) {
      if (field in record && field in existing) record[field] = existing[field]
    }
    return
  }
  if ('time' in record && 'time' in existing) record.time = existing.time
  if (record.type !== 'hook/result') return
  /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const data = record.data
  /** 中文说明：变量 existingData 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const existingData = existing.data
  if (
    data !== null && typeof data === 'object'
    && existingData !== null && typeof existingData === 'object'
    && 'durationMs' in data && 'durationMs' in existingData
  ) {
    (data as Record<string, unknown>).durationMs = (existingData as Record<string, unknown>).durationMs
  }
}

/** Carry logical member times into a fresh packed row while leaving its fragment arrays untouched. */
/* 中文说明：函数 preservePackedMemberTimes 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function preservePackedMemberTimes(
  record: Record<string, unknown>,
  existingMembers: Record<string, unknown>[],
): void {
  if (!PACKED_CHUNK_ROW_TYPES.has(record.type as string)) return
  /** 中文说明：变量 row 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const row = record as unknown as { time0: number; data: { dt: number[] } }
  /** 中文说明：变量 firstTime 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const firstTime = existingMembers[0]?.time
  if (!Number.isSafeInteger(firstTime)) return
  row.time0 = firstTime as number
  if (existingMembers.length !== row.data.dt.length + 1) return
  /** 中文说明：函数值 times 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const times = existingMembers.map(member => Number.isSafeInteger(member.time) ? member.time as number : undefined)
  if (times.some(time => time === undefined)) return
  /** 中文说明：变量 memberTimes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const memberTimes = times as number[]
  /** 中文说明：函数值 gaps 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const gaps = memberTimes.slice(1).map((time, index) => time - (memberTimes[index] as number))
  if (gaps.some(gap => !Number.isSafeInteger(gap))) return
  row.data.dt = gaps
}

/** Whether a parsed JSON value is a non-array object. */
/* 中文说明：函数 isRecord 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Reuse existing leaves whose normalized values equal the fresh values.
 * Objects merge by key; arrays merge only when their positions still align.
 */
/* 中文说明：函数 preserveNormalizedVolatiles 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function preserveNormalizedVolatiles(
  fresh: unknown,
  existing: unknown,
  normalizedFresh: unknown,
  normalizedExisting: unknown,
  stringMappings: ReadonlyMap<string, string>,
): unknown {
  if (
    Array.isArray(fresh)
    && Array.isArray(existing)
    && Array.isArray(normalizedFresh)
    && Array.isArray(normalizedExisting)
  ) {
    if (
      fresh.length !== existing.length
      || fresh.length !== normalizedFresh.length
      || fresh.length !== normalizedExisting.length
    ) return fresh
    return fresh.map((value, index) => preserveNormalizedVolatiles(
      value,
      existing[index],
      normalizedFresh[index],
      normalizedExisting[index],
      stringMappings,
    ))
  }
  if (
    isRecord(fresh)
    && isRecord(existing)
    && isRecord(normalizedFresh)
    && isRecord(normalizedExisting)
  ) {
    return Object.fromEntries(Object.entries(fresh).map(([key, value]) => [
      key,
      Object.hasOwn(existing, key)
        && Object.hasOwn(normalizedFresh, key)
        && Object.hasOwn(normalizedExisting, key)
        ? preserveNormalizedVolatiles(
          value,
          existing[key],
          normalizedFresh[key],
          normalizedExisting[key],
          stringMappings,
        )
        : value,
    ]))
  }
  if (
    typeof fresh === 'string'
    && typeof existing === 'string'
    && typeof normalizedFresh === 'string'
    && normalizedFresh === normalizedExisting
  ) {
    return stringMappings.get(JSON.stringify([normalizedFresh, fresh])) === existing
      ? existing
      : fresh
  }
  return Object.is(normalizedFresh, normalizedExisting) ? existing : fresh
}

/** Normalize one aligned record with the same contract used by fixture comparison. */
/* 中文说明：函数 normalizedRefreshRecord 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function normalizedRefreshRecord(
  record: Record<string, unknown>,
  context: NormalizeContext,
): Record<string, unknown> {
  return JSON.parse(normalizeSessionLog(`${JSON.stringify(record)}\n`, context)) as Record<string, unknown>
}

/**
 * Add normalized-equivalent string replacements to a bijection.
 * Structural differences are fresh-owned and therefore contribute no mapping.
 */
/* 中文说明：函数 collectNormalizedStringMappings 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function collectNormalizedStringMappings(
  fresh: unknown,
  existing: unknown,
  normalizedFresh: unknown,
  normalizedExisting: unknown,
  excludedStrings: ReadonlySet<string>,
  forward: Map<string, string>,
  reverse: Map<string, string>,
): boolean {
  if (
    Array.isArray(fresh)
    && Array.isArray(existing)
    && Array.isArray(normalizedFresh)
    && Array.isArray(normalizedExisting)
  ) {
    if (
      fresh.length !== existing.length
      || fresh.length !== normalizedFresh.length
      || fresh.length !== normalizedExisting.length
    ) return true
    return fresh.every((value, index) => collectNormalizedStringMappings(
      value,
      existing[index],
      normalizedFresh[index],
      normalizedExisting[index],
      excludedStrings,
      forward,
      reverse,
    ))
  }
  if (
    isRecord(fresh)
    && isRecord(existing)
    && isRecord(normalizedFresh)
    && isRecord(normalizedExisting)
  ) {
    return Object.entries(fresh).every(([key, value]) =>
      !Object.hasOwn(existing, key)
      || !Object.hasOwn(normalizedFresh, key)
      || !Object.hasOwn(normalizedExisting, key)
      || collectNormalizedStringMappings(
        value,
        existing[key],
        normalizedFresh[key],
        normalizedExisting[key],
        excludedStrings,
        forward,
        reverse,
      ))
  }
  if (
    typeof fresh !== 'string'
    || typeof existing !== 'string'
    || typeof normalizedFresh !== 'string'
    || normalizedFresh !== normalizedExisting
    || fresh === existing
    || excludedStrings.has(fresh)
    || excludedStrings.has(existing)
  ) return true
  /** 中文说明：变量 freshKey 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const freshKey = JSON.stringify([normalizedFresh, fresh])
  /** 中文说明：变量 existingKey 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const existingKey = JSON.stringify([normalizedFresh, existing])
  /** 中文说明：变量 mappedExisting 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mappedExisting = forward.get(freshKey)
  /** 中文说明：变量 mappedFresh 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mappedFresh = reverse.get(existingKey)
  if (
    mappedExisting !== undefined && mappedExisting !== existing
    || mappedFresh !== undefined && mappedFresh !== fresh
  ) return false
  forward.set(freshKey, existing)
  reverse.set(existingKey, fresh)
  return true
}

/**
 * Build a log-wide bijection for normalized-equivalent strings.
 * Any unexplained record mismatch or conflicting replacement disables reuse.
 */
/* 中文说明：函数 normalizedStringMappings 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function normalizedStringMappings(
  records: Record<string, unknown>[],
  freshRecords: Record<string, unknown>[],
  existingRecords: Record<string, unknown>[],
  freshContext: NormalizeContext,
  existingContext: NormalizeContext,
): Map<string, string> | undefined {
  /** 中文说明：变量 excludedStrings 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const excludedStrings = new Set<string>()
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const record of [...freshRecords, ...existingRecords]) {
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const message of recordMessages(record)) excludedStrings.add(message.id as string)
  }
  /** 中文说明：变量 forward 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const forward = new Map<string, string>()
  /** 中文说明：变量 reverse 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const reverse = new Map<string, string>()
  /** 中文说明：变量 existingIndex 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let existingIndex = 0
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const record = records[recordIndex] as Record<string, unknown>
    /** 中文说明：变量 existingRecord 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const existingRecord = existingRecords[existingIndex]
    /** 中文说明：变量 memberCount 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const memberCount = packedTimes(record)?.length ?? 1
    if (record.type === 'session/title' && existingRecord?.type !== 'session/title') continue
    if (memberCount > 1) {
      /** 中文说明：变量 existingMembers 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const existingMembers = existingRecords.slice(existingIndex, existingIndex + memberCount)
      if (
        existingMembers.length !== memberCount
        || existingMembers.some(member => member.type !== 'assistant/chunk')
      ) return undefined
    } else {
      if (existingRecord === undefined || existingRecord.type !== record.type) return undefined
      if (!collectNormalizedStringMappings(
        record,
        existingRecord,
        normalizedRefreshRecord(freshRecords[recordIndex] as Record<string, unknown>, freshContext),
        normalizedRefreshRecord(existingRecord, existingContext),
        excludedStrings,
        forward,
        reverse,
      )) return undefined
    }
    existingIndex += memberCount
  }
  return existingIndex === existingRecords.length ? forward : undefined
}

/**
 * Rewrite a fresh replay-produced log so repeated refreshes do not churn
 * volatile fixture fields. Meaningful event payloads come from `fresh`; the
 * existing fixture lends normalized-equivalent values, including non-message ids, paths,
 * creation/event times, spill locators, and hook durations, only when the
 * complete record layout aligns and volatile strings form a consistent
 * bijection. Complete durable-message ids are excluded because the later
 * fixture-ready structural pass owns them. Ambiguous layouts or mappings
 * keep fresh strings. Packed timing gaps expand from zero when a projected
 * fixture omits `time0`, so packing does not shift later records;
 * fresh semantic values and fragment arrays remain authoritative.
 *
 * @param fresh The newly harvested session JSONL.
 * @param existing The committed fixture JSONL being refreshed.
 * @param replacements Cross-log literal replacements from {@link refreshFixtureReplacements}.
 * @param freshContext The harvested run's ids, cwd, and every cwd alias.
 * @returns The stabilized JSONL content to write back.
 */
/*
 * 中文说明：函数 stabilizeRefreshLog 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param fresh 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param existing 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param replacements 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param freshContext 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function stabilizeRefreshLog(
  fresh: string,
  existing: string,
  replacements: FixtureReplacement[],
  freshContext: NormalizeContext,
): string {
  /** 中文说明：变量 freshRecords 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const freshRecords = parseJsonlRecords(fresh)
  /** 中文说明：变量 stable 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stable = applyFixtureReplacements(fresh, replacements)
  /** 中文说明：变量 existingRecords 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const existingRecords = logicalRecords(parseJsonlRecords(existing))
  /** 中文说明：变量 records 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const records = parseJsonlRecords(stable)
  /** 中文说明：变量 existingContext 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const existingContext = fixtureContext(existing)
  /** 中文说明：变量 stringMappings 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stringMappings = normalizedStringMappings(
    records,
    freshRecords,
    existingRecords,
    freshContext,
    existingContext,
  )
  /** 中文说明：变量 existingIndex 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let existingIndex = 0
  /** 中文说明：变量 previousEventTime 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let previousEventTime: unknown
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (let i = 0; i < records.length; i++) {
    /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let record = records[i] as Record<string, unknown>
    /** 中文说明：变量 existingRecord 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const existingRecord = existingRecords[existingIndex]
    /** 中文说明：变量 memberCount 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const memberCount = packedTimes(record)?.length ?? 1
    /** 中文说明：变量 insertedTitle 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const insertedTitle = record.type === 'session/title' && existingRecord?.type !== 'session/title'
    if (insertedTitle) {
      /* v8 ignore next -- a title is turn-enclosed, so a preceding event time exists in every valid fixture. */
      if (typeof previousEventTime !== 'number') throw new Error('acp-snapshot: inserted title has no preceding event time')
      record.time = previousEventTime
    } else {
      if (
        stringMappings !== undefined
        && memberCount === 1
        && existingRecord !== undefined
        && existingRecord.type === record.type
      ) {
        record = preserveNormalizedVolatiles(
          record,
          existingRecord,
          normalizedRefreshRecord(freshRecords[i] as Record<string, unknown>, freshContext),
          normalizedRefreshRecord(existingRecord, existingContext),
          stringMappings,
        ) as Record<string, unknown>
        records[i] = record
      }
      preservePackedMemberTimes(record, existingRecords.slice(existingIndex, existingIndex + memberCount))
      preserveFixtureVolatiles(record, existingRecord)
      existingIndex += memberCount
    }
    if (typeof record.time === 'number') previousEventTime = record.time
  }
  return records.map(record => JSON.stringify(record)).join('\n') + '\n'
}

/**
 * Register the suite: one test per scenario (the expected-output and log comparisons and
 * the header-uniformity guard) plus the fixture guard block (no orphan
 * scenario dirs, required files present, exactly one pin per header class,
 * shared sidecars unique and well-formed, every JSONL prompt-scrubbed,
 * non-pinning fixtures fully header-scrubbed). Must
 * run at vitest collection time — it calls `describe`/`it`. Throws
 * immediately if any header class lacks a pinning scenario or carries two
 * (the uniformity guard needs exactly one comparison anchor per class).
 *
 * @param options The agent, snapshots directory, scenario table, and mode.
 */
/*
 * 中文说明：函数 defineAcpSnapshotSuite 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function defineAcpSnapshotSuite(options: SnapshotSuiteOptions): void {
  const { agent, snapshotsDir, scenarios, mode } = options
  /** 中文说明：常量 RECORDING 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
  const RECORDING = mode === 'record'
  /** 中文说明：常量 REFRESHING 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
  const REFRESHING = mode === 'refresh'
  /** 中文说明：变量 childMode 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const childMode: 'replay' | 'record' = RECORDING ? 'record' : 'replay'
  /** 中文说明：变量 scenarioSuite 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const scenarioSuite = mode === 'replay' ? describe.concurrent : describe

  /** The class a scenario's header composition belongs to (see {@link Scenario.headerClass}). */
  /* 中文说明：函数值 classOf 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const classOf = (scenario: Scenario): string => scenario.headerClass ?? 'default'

  /** 中文说明：变量 scenariosByName 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const scenariosByName = new Map<string, Scenario>()
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const scenario of scenarios) {
    if (scenariosByName.has(scenario.name)) {
      throw new Error(`acp-snapshot: duplicate scenario name "${scenario.name}"`)
    }
    scenariosByName.set(scenario.name, scenario)
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const field of ['systemPromptSource', 'toolSchemasSource'] as const) {
      if (scenario[field] !== undefined && scenario.pinsHeader !== true) {
        throw new Error(`acp-snapshot: ${scenario.name}.${field} is only valid on a header-pinning scenario`)
      }
    }
  }

  /** Each header class's single pinning scenario. Guarded here (and by meta-tests) so a pin cannot silently vanish or split. */
  /* 中文说明：变量 pinningByClass 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const pinningByClass = new Map<string, Scenario>()
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const scenario of scenarios) {
    if (scenario.pinsHeader !== true) continue
    /** 中文说明：变量 cls 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cls = classOf(scenario)
    /** 中文说明：变量 existing 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const existing = pinningByClass.get(cls)
    if (existing) throw new Error(`acp-snapshot: header class "${cls}" pinned by both ${existing.name} and ${scenario.name}`)
    pinningByClass.set(cls, scenario)
  }
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const scenario of scenarios) {
    if (!pinningByClass.has(classOf(scenario))) {
      throw new Error(`acp-snapshot: no scenario pins the request-header content of class "${classOf(scenario)}" (needed by ${scenario.name})`)
    }
  }

  /** 中文说明：变量 sourceFor 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceFor = (
    pinningScenario: Scenario,
    field: 'systemPromptSource' | 'toolSchemasSource',
    label: string,
  ): Scenario => {
    /** 中文说明：变量 sourceName 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sourceName = pinningScenario[field] ?? pinningScenario.name
    /** 中文说明：变量 source 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = scenariosByName.get(sourceName)
    if (source === undefined) {
      throw new Error(`acp-snapshot: ${pinningScenario.name} names unknown ${label} source "${sourceName}"`)
    }
    if (source.pinsHeader !== true) {
      throw new Error(`acp-snapshot: ${pinningScenario.name} names non-pinning ${label} source "${sourceName}"`)
    }
    if (source[field] !== undefined && source[field] !== source.name) {
      throw new Error(`acp-snapshot: ${pinningScenario.name} names ${label} source "${sourceName}", which does not own its sidecar`)
    }
    /** 中文说明：变量 expectedChanges 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expectedChanges = pinningScenario.expectedHeaderChanges ?? 0
    /** 中文说明：变量 sourceChanges 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sourceChanges = source.expectedHeaderChanges ?? 0
    if (sourceChanges !== expectedChanges) {
      throw new Error(
        `acp-snapshot: ${pinningScenario.name} and ${sourceName} declare different header-change counts for shared ${label}`,
      )
    }
    return source
  }

  /** 中文说明：变量 promptSourceByClass 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const promptSourceByClass = new Map<string, Scenario>()
  /** 中文说明：变量 schemaSourceByClass 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const schemaSourceByClass = new Map<string, Scenario>()
  /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
  for (const [cls, pinningScenario] of pinningByClass) {
    promptSourceByClass.set(cls, sourceFor(pinningScenario, 'systemPromptSource', 'system-prompt snapshot'))
    schemaSourceByClass.set(cls, sourceFor(pinningScenario, 'toolSchemasSource', 'tool-schema snapshot'))
  }
  /** 中文说明：函数值 promptOwners 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const promptOwners = new Set([...promptSourceByClass.values()].map(source => source.name))
  /** 中文说明：函数值 schemaOwners 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const schemaOwners = new Set([...schemaSourceByClass.values()].map(source => source.name))
  /** 中文说明：变量 promptClaims 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const promptClaims = new Map<string, SharedSnapshotClaim>()
  /** 中文说明：变量 schemaClaims 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const schemaClaims = new Map<string, SharedSnapshotClaim>()

  scenarioSuite('snapshot scenarios', () => {
    /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
    for (const scenario of scenarios) {
      // In RECORD mode, only re-run the `recorded` (live-API) scenarios; the `authored` ones
      // (sidecar-driven errors/cancel) are never re-recorded. `posixOnly` scenarios skip on Windows;
      // `pwshOnly` scenarios skip when the caller's `hasPwsh` probe is false.
      it.skipIf(scenarioSkipped(scenario, RECORDING, process.platform, options.hasPwsh))(`snapshot: ${scenario.name} matches the expected outputs`, async ({ expect }) => {
        /** 中文说明：变量 dir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const dir = join(snapshotsDir, scenario.name)
        const manifestPath = join(dir, 'snapshot.yml')
        const manifest = parseSnapshotManifest(await readFile(manifestPath, 'utf8'), manifestPath)
        const input = JSON.parse(await readFile(join(dir, 'input.json'), 'utf8')) as InputScript
        /** 中文说明：变量 overrideFile 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const overrideFile = join(dir, 'replay.override.json')
        /** 中文说明：变量 workspaceDir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const workspaceDir = join(dir, 'workspace')
        // Replay/refresh need the committed inventory up front because those
        // files drive the model scripts. Record mode creates that inventory
        // from the harvested live logs, so it must also work for a brand-new
        // scenario with no Session fixture yet.
        let fixtureFiles = RECORDING ? [] : await sessionFixtures(dir)
        /** 中文说明：变量 childFixtureFiles 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const childFixtureFiles = fixtureFiles.slice(1)
        const primaryFixtureFile = fixtureFiles[0] ?? sessionFixtureName(0, 0)
        const comparesLog = scenario.comparesLog ?? scenario.hasModelTurn
        /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const result = await runScenario(input, {
          agent,
          mode: childMode,
          fixtureFile: join(dir, primaryFixtureFile),
          ...scenario.env !== undefined ? { env: scenario.env } : {},
          ...existsSync(overrideFile) ? { overrideFile } : {},
          // In REPLAY, forward the recorded child fixtures so each subagent session
          // replays from its own script. In RECORD they are harvested, not read.
          ...!RECORDING && childFixtureFiles.length > 0 ? { childFiles: childFixtureFiles.map(file => join(dir, file)) } : {},
          ...existsSync(workspaceDir) ? { workspaceDir } : {},
          ...scenario.prepareWorkspace !== undefined ? { prepareWorkspace: scenario.prepareWorkspace } : {},
          ...scenario.workspaceParent !== undefined ? { workspaceParent: scenario.workspaceParent } : {},
          // A scenario passes its live profile patch; the launcher derives
          // the sibling `*cordis.snapshot.yml` for replay.
          ...scenario.configPath !== undefined ? { configPath: scenario.configPath } : {},
        })

        /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
        for (const log of result.sessionLogs) {
          expect(unknownToolCallIds(log.content), `session ${log.id}: snapshot scenarios must not accept UNKNOWN_TOOL`)
            .toEqual([])
        }

        // Scrub every volatile id the run produced: the ACP server-issued session id plus every
        // harvested log's recorded id (a subagent child id never surfaces over ACP, but it
        // appears in the child's own log header).
        /** 中文说明：变量 ctx 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ctx: NormalizeContext = {
          sessionIds: [
            ...result.sessionId !== undefined ? [result.sessionId] : [],
            ...result.sessionLogs.map(l => l.id),
          ],
          cwd: result.cwd,
          cwdAliases: result.cwdAliases,
        }

        /** 中文说明：变量 childSchemaPins 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const childSchemaPins = new Set(scenario.pinsChildToolSchemas ?? [])
        /** 中文说明：变量 childPromptPins 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const childPromptPins = new Set(scenario.pinsChildSystemPrompts ?? [])

        // Record writes live model fixtures; keyless refresh writes every comparable replayed
        // fixture. Pinning JSONL keeps prefixes but moves prompts and schemas into sidecars.
        /** 中文说明：变量 portableFixture 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const portableFixture = scenario.workspaceParent === undefined
          ? tokenizeSessionFixtureCwd
          : (log: string): string => log
        const writesSessionFixtures = writesCurrentSessionFixtures(manifest, mode)
          && ((RECORDING && scenario.recorded && scenario.hasModelTurn) || (REFRESHING && comparesLog))
        if (writesSessionFixtures) {
          expect(result.sessionLogs.length, `${mode} produced no session log to harvest`).toBeGreaterThan(0)
          if (REFRESHING) {
            expect(result.sessionLogs.length, `expected ${fixtureFiles.length} session logs (parent + children)`)
              .toBe(fixtureFiles.length)
          }
          const outputFixtureFiles = result.sessionLogs.map((log, index) => sessionFixtureName(
            index,
            sessionHeaderVersion(log.content, `harvested Session ${index}`),
          ))
          const existingFixtures = await Promise.all(outputFixtureFiles.map(async (_file, index) => {
            const file = fixtureFiles[index]
            if (file === undefined) return ''
            return readFile(join(dir, file), 'utf8')
          }))
          /** 中文说明：变量 refreshReplacements 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const refreshReplacements = REFRESHING
            ? refreshFixtureReplacements(result.sessionLogs, existingFixtures)
            : []
          /** 中文说明：变量 freshFixtures 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const freshFixtures = REFRESHING
            ? result.sessionLogs.map((log, index) => scrubSessionSnapshot(portableFixture(stabilizeRefreshLog(
              log.content,
              existingFixtures[index] as string,
              refreshReplacements,
              ctx,
            ))))
            : result.sessionLogs.map(log => scrubSessionSnapshot(portableFixture(log.content)))
          const outputFixtures = redactSessionSnapshotIds(stabilizeFixtureMessageIds(freshFixtures, existingFixtures))
          await Promise.all(outputFixtures.map((fixture, index) =>
            writeFile(join(dir, outputFixtureFiles[index] as string), fixture)))
          fixtureFiles = outputFixtureFiles
          if (scenario.pinsHeader === true) {
            /** 中文说明：变量 primary 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const primary = result.sessionLogs[0] as HarvestedLog
            const pinningHeaders = pinningHeaderPayloads(primary.content, ctx)
            const prompts = systemPromptsFrom(pinningHeaders)
            expect(prompts.length, `${mode} produced no system prompt to snapshot`).toBeGreaterThan(0)
            /** 中文说明：变量 promptSnapshot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const promptSnapshot = formatSystemPromptSnapshot(prompts[0] as string, prompts.slice(1))
            /** 中文说明：变量 promptSource 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            /* v8 ignore next -- registration guarantees every scenario class has resolved sources. */
            const promptSource = promptSourceByClass.get(classOf(scenario)) ?? scenario
            /** 中文说明：变量 promptPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const promptPath = join(snapshotsDir, promptSource.name, SYSTEM_PROMPT_SNAPSHOT)
            claimSharedSnapshot(promptClaims, promptPath, scenario.name, promptSnapshot)
            await writeFile(promptPath, promptSnapshot)

            const schemaSets = toolSchemasFrom(pinningHeaders)
            expect(schemaSets.length, `${mode} produced no tool schemas to snapshot`).toBeGreaterThan(0)
            expect(schemaSets.length, `${mode} produced a tool-schema sequence that differs from its prompt sequence`)
              .toBe(prompts.length)
            /** 中文说明：变量 toolSchemasSnapshot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const toolSchemasSnapshot = formatToolSchemasSnapshot(
              schemaSets[0] as unknown[],
              schemaSets.slice(1),
            )
            /** 中文说明：变量 schemaSource 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            /* v8 ignore next -- registration guarantees every scenario class has resolved sources. */
            const schemaSource = schemaSourceByClass.get(classOf(scenario)) ?? scenario
            /** 中文说明：变量 schemaPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const schemaPath = join(snapshotsDir, schemaSource.name, TOOL_SCHEMAS_SNAPSHOT)
            claimSharedSnapshot(schemaClaims, schemaPath, scenario.name, toolSchemasSnapshot)
            await writeFile(schemaPath, toolSchemasSnapshot)
          }
          /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
          for (const index of childSchemaPins) {
            /** 中文说明：变量 log 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const log = result.sessionLogs[index]
            expect(log, `${mode}: no child session log at index ${index} to snapshot schemas from`)
              .toBeDefined()
            const schemaSets = toolSchemasFrom(pinningHeaderPayloads(
              (log as HarvestedLog).content,
              ctx,
            ))
            expect(schemaSets.length, `${mode}: child ${index} produced no tool schemas to snapshot`)
              .toBeGreaterThan(0)
            await writeFile(join(dir, childToolSchemasSnapshot(index)), formatToolSchemasSnapshot(
              schemaSets[0] as unknown[],
              schemaSets.slice(1),
            ))
          }
          /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
          for (const index of childPromptPins) {
            /** 中文说明：变量 log 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const log = result.sessionLogs[index]
            expect(log, `${mode}: no child session log at index ${index} to snapshot a prompt from`)
              .toBeDefined()
            const prompts = systemPromptsFrom(pinningHeaderPayloads(
              (log as HarvestedLog).content,
              ctx,
            ))
            expect(prompts.length, `${mode}: child ${index} produced no system prompt to snapshot`)
              .toBeGreaterThan(0)
            await writeFile(
              join(dir, childSystemPromptSnapshot(index)),
              formatSystemPromptSnapshot(prompts[0] as string),
            )
          }
        }

        /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
        for (const expected of stdoutExpectedVariants(scenario)) {
          /** 中文说明：变量 stdout 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const stdout = normalizeStdout(result.rawStdout, ctx, { cwdPathMode: expected.cwdPathMode })
          if (REFRESHING) {
            await writeFile(join(dir, expected.file), stdout)
          }
          await expect(stdout, `${expected.file} mismatch`).toMatchFileSnapshot(join(dir, expected.file))
        }

        // A model turn always produces a log worth comparing; an explicitly
        // authored non-model scenario may opt in independently.
        if (comparesLog) {
          // The harvested logs (primary-first) must match their committed fixtures 1:1.
          expect(result.sessionLogs.length, 'this scenario must persist one log per session fixture').toBe(fixtureFiles.length)
          const harvested = result.sessionLogs.map(log => log.content)
          const fixtures = await Promise.all(fixtureFiles.map(file => readFile(join(dir, file), 'utf8')))
          const fixtureContexts = fixtures.map(fixtureContext)
          const fixtureCtx: NormalizeContext = {
            sessionIds: fixtureContexts.flatMap(context => context.sessionIds),
            cwd: (fixtureContexts[0] as NormalizeContext).cwd,
          }
          const actualSnapshots = normalizeSessionSnapshots(harvested, ctx)
          const expectedSnapshots = normalizeSessionSnapshots(fixtures, fixtureCtx)
          for (const [index, actual] of actualSnapshots.entries()) {
            expect(actual, `${fixtureFiles[index]} mismatch`).toEqual(expectedSnapshots[index])
          }
        }

        // Every live full header must equal its class pin reconstructed from
        // tokenized JSONL plus readable prompt and structured schema sidecars.
        /** 中文说明：变量 pinningScenario 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        /* v8 ignore next -- construction guarantees the pin exists; a miss would fail the one-header assertion loudly. */
        const pinningScenario = pinningByClass.get(classOf(scenario)) ?? scenario
        /** 中文说明：变量 promptSource 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        /* v8 ignore next -- registration guarantees every scenario class has resolved sources. */
        const promptSource = promptSourceByClass.get(classOf(scenario)) ?? pinningScenario
        /** 中文说明：变量 schemaSource 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        /* v8 ignore next -- registration guarantees every scenario class has resolved sources. */
        const schemaSource = schemaSourceByClass.get(classOf(scenario)) ?? pinningScenario
        /** 中文说明：变量 pinningDir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const pinningDir = join(snapshotsDir, pinningScenario.name)
        const [pinningFixtureFile] = await sessionFixtures(pinningDir)
        const pinnedFixture = await readFile(join(pinningDir, pinningFixtureFile as string), 'utf8')
        const pinned = pinningHeaderPayloads(pinnedFixture, fixtureContext(pinnedFixture))
        const promptSnapshot = await readFile(
          join(snapshotsDir, promptSource.name, SYSTEM_PROMPT_SNAPSHOT),
          'utf8',
        )
        /** 中文说明：变量 initialPromptSnapshot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const initialPromptSnapshot = initialSystemPromptSnapshot(promptSnapshot)
        expect(pinned.length, `the pinning fixture (${pinningScenario.name}) has an unexpected request/header count`)
          .toBe(1 + (pinningScenario.expectedHeaderChanges ?? 0))
        /** 中文说明：变量 toolSchemasSnapshot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const toolSchemasSnapshot = await readFile(
          join(snapshotsDir, schemaSource.name, TOOL_SCHEMAS_SNAPSHOT),
          'utf8',
        )
        /** 中文说明：变量 toolSchemas 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const toolSchemas = parseToolSchemasSnapshot(toolSchemasSnapshot)
        /** 中文说明：变量 pinnedSchemaSets 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const pinnedSchemaSets = [toolSchemas.initial, ...toolSchemas.changes]
        expect(pinnedSchemaSets.length, `the schema source (${schemaSource.name}) has an unexpected tool-schema count`)
          .toBe(pinned.length)
        /** 中文说明：函数值 pinnedHeaders 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
        const pinnedHeaders = pinned.map((header, index) => restorePinnedToolSchemas(
          header,
          pinnedSchemaSets[index] as unknown[],
        ))
        /** 中文说明：变量 childPinnedSchemas 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const childPinnedSchemas = new Map<number, unknown[][]>()
        /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
        for (const index of childSchemaPins) {
          /** 中文说明：变量 sidecar 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const sidecar = await readFile(join(dir, childToolSchemasSnapshot(index)), 'utf8')
          /** 中文说明：变量 parsed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const parsed = parseToolSchemasSnapshot(sidecar)
          childPinnedSchemas.set(index, [parsed.initial, ...parsed.changes])
        }
        /** 中文说明：变量 childPinnedPrompts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const childPinnedPrompts = new Map<number, string>()
        /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
        for (const index of childPromptPins) {
          childPinnedPrompts.set(
            index,
            await readFile(join(dir, childSystemPromptSnapshot(index)), 'utf8'),
          )
        }
        /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
        for (const [logIndex, log] of result.sessionLogs.entries()) {
          /** 中文说明：变量 childSchemas 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const childSchemas = childPinnedSchemas.get(logIndex)
          /** 中文说明：变量 expectedChanges 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const expectedChanges = scenario.pinsHeader === true && logIndex === 0
            ? scenario.expectedHeaderChanges ?? 0
            : 0
          expect(headerChangeCount(log.content), `session ${log.id}: changed request/header count`)
            .toBe(expectedChanges)
          const headerEvents = normalizedHeaderEvents(scrubSystemPrompts(log.content), ctx)
          const headers = headerEvents.map(event => event.header)
          const prompts = normalizedSystemPrompts(log.content, ctx)
          /** 中文说明：变量 schemaSets 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const schemaSets = normalizedToolSchemas(log.content, ctx)
          expect(prompts.length, `session ${log.id}: every request/header must carry a string system prompt`)
            .toBe(headers.length)
          expect(schemaSets.length, `session ${log.id}: every request/header must carry an array-valued tools field`)
            .toBe(headers.length)
          if (childSchemas !== undefined) {
            expect(childSchemas.length, `session ${log.id}: ${childToolSchemasSnapshot(logIndex)} has an unexpected tool-schema count`)
              .toBe(1 + headerChangeCount(log.content))
          }
          let revision = 0
          for (const [k, header] of headers.entries()) {
            if (headerEvents[k]?.reason === 'change') revision++
            const classPin = expectedChanges > 0 ? pinnedHeaders[revision] : pinnedHeaders[0]
            const expected = childSchemas === undefined
              ? classPin
              : { ...classPin as Record<string, unknown>, tools: childSchemas[revision] }
            expect(header, `session ${log.id}: request/header #${k + 1} diverged from the pinned (${pinningScenario.name}) header`)
              .toEqual(expected)
            if (expectedChanges === 0) {
              // A pinned child owns its whole prompt: its scope-local sections
              // are exactly what the class pin cannot describe.
              /** 中文说明：变量 childPrompt 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
              const childPrompt = childPinnedPrompts.get(logIndex)
              /** 中文说明：变量 promptOrigin 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
              const promptOrigin = childPrompt === undefined
                ? `${promptSource.name}/${SYSTEM_PROMPT_SNAPSHOT}`
                : childSystemPromptSnapshot(logIndex)
              expect(formatSystemPromptSnapshot(prompts[k] as string), `session ${log.id}: initial system prompt #${k + 1} diverged from ${promptOrigin}`)
                .toEqual(childPrompt ?? initialPromptSnapshot)
            }
          }
          if (scenario.pinsHeader === true && logIndex === 0) {
            const pinningHeaders = pinningHeaderPayloads(log.content, ctx)
            const pinningPrompts = systemPromptsFrom(pinningHeaders)
            const pinningSchemas = toolSchemasFrom(pinningHeaders)
            expect(formatSystemPromptSnapshot(
              pinningPrompts[0] as string,
              pinningPrompts.slice(1),
            ), `session ${log.id}: changed system prompts diverged from ${promptSource.name}/${SYSTEM_PROMPT_SNAPSHOT}`)
              .toEqual(promptSnapshot)
            expect(formatToolSchemasSnapshot(
              pinningSchemas[0] as unknown[],
              pinningSchemas.slice(1),
            ), `session ${log.id}: changed tool schemas diverged from ${schemaSource.name}/${TOOL_SCHEMAS_SNAPSHOT}`)
              .toEqual(toolSchemasSnapshot)
          }
        }

        if (manifest.workspace?.final === true) {
          const expectedWorkspace = await captureExpectedWorkspaceSnapshot(join(dir, 'workspace.expected'))
          expect(result.finalWorkspace, `${scenario.name}: complete final workspace`).toEqual(expectedWorkspace)
        } else {
          expect(result.finalWorkspace, `${scenario.name}: a changed workspace requires workspace.final`)
            .toEqual(result.initialWorkspace)
        }
      })
    }
  })

  describe('snapshot fixtures', () => {
    it('every scenario directory is registered (no orphans)', async () => {
      // toMatchFileSnapshot does not prune orphaned expected-output or fixture files, so a
      // renamed/removed scenario could leave a stale dir that nothing exercises.
      // Fail loud on any snapshots/<dir> not present in the scenario table.
      /** 中文说明：变量 entries 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const entries = await readdir(snapshotsDir, { withFileTypes: true })
      /** 中文说明：函数值 onDisk 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const onDisk = entries.filter(e => e.isDirectory()).map(e => e.name).sort()
      /** 中文说明：函数值 registered 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const registered = scenarios.map(s => s.name).sort()
      expect(onDisk).toEqual(registered)
    })

    it('every registered scenario has its required fixture files', async () => {
      // Every scenario needs input, stdout, a primary session fixture, and matching optional sidecars.
      /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
      for (const { name, overridden, pinsNativeWindowsStdout, pinsChildToolSchemas, pinsChildSystemPrompts } of scenarios) {
        /** 中文说明：变量 dir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const dir = join(snapshotsDir, name)
        /** 中文说明：变量 files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const files = (await readdir(dir, { withFileTypes: true }))
          .filter(entry => entry.isFile())
          .map(entry => entry.name)
        const manifestPath = join(dir, 'snapshot.yml')
        expect(existsSync(manifestPath), `${name}/snapshot.yml`).toBe(true)
        const manifest = parseSnapshotManifest(await readFile(manifestPath, 'utf8'), manifestPath)
        expect(manifest.profile, `${name}: manifest profile`).toBe(agent.profile ?? 'acp')
        expect(manifest.session, `${name}: ACP scenarios own their session`).toBeUndefined()
        const childIndices = (pattern: RegExp): Set<number> => new Set(files
          .map(file => pattern.exec(file))
          .filter((match): match is RegExpExecArray => match !== null)
          .map(match => Number(match[1])))
        expect(childIndices(/^tool-schemas\.([1-9]\d*)\.expected\.json$/), `${name}: child tool-schema sidecars must match \`pinsChildToolSchemas\``)
          .toEqual(new Set(pinsChildToolSchemas ?? []))
        expect(childIndices(/^system-prompt\.([1-9]\d*)\.expected\.md$/), `${name}: child system-prompt sidecars must match \`pinsChildSystemPrompts\``)
          .toEqual(new Set(pinsChildSystemPrompts ?? []))
        expect(existsSync(join(dir, 'input.json')), `${name}/input.json`).toBe(true)
        expect(existsSync(join(dir, 'stdout.expected.jsonl')), `${name}/stdout.expected.jsonl`).toBe(true)
        expect(
          existsSync(join(dir, WINDOWS_STDOUT_SNAPSHOT)),
          `${name}/${WINDOWS_STDOUT_SNAPSHOT} presence must match \`pinsNativeWindowsStdout\``,
        ).toBe(pinsNativeWindowsStdout === true)
        expect(existsSync(join(dir, 'replay.override.json')), `${name}/replay.override.json presence must match \`overridden\``)
          .toBe(overridden === true)
        expect(existsSync(join(dir, SYSTEM_PROMPT_SNAPSHOT)), `${name}/${SYSTEM_PROMPT_SNAPSHOT} presence must match snapshot-source ownership`)
          .toBe(promptOwners.has(name))
        expect(existsSync(join(dir, TOOL_SCHEMAS_SNAPSHOT)), `${name}/${TOOL_SCHEMAS_SNAPSHOT} presence must match snapshot-source ownership`)
          .toBe(schemaOwners.has(name))
        await expect(sessionFixtures(dir), `${name}: session fixture inventory`).resolves.toBeDefined()
      }
    })

    it('exactly one scenario pins the request-header content of each header class', () => {
      // Zero pins would drop a class's structural header surface from the suite entirely; two
      // would split it.
      /** 中文说明：变量 pins 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const pins = new Map<string, string[]>()
      /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
      for (const scenario of scenarios.filter(s => s.pinsHeader === true)) {
        /** 中文说明：变量 cls 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const cls = classOf(scenario)
        pins.set(cls, [...pins.get(cls) ?? [], scenario.name])
      }
      expect(Object.fromEntries([...pins].map(([cls, names]) => [cls, names.length]))).toEqual(
        Object.fromEntries([...pinningByClass.keys()].map(cls => [cls, 1])))
      /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
      for (const scenario of scenarios) {
        expect(pinningByClass.has(classOf(scenario)), `class "${classOf(scenario)}" (scenario ${scenario.name}) has a pin`).toBe(true)
      }
    })

    it('every pinning fixture composes one tokenized header sequence with its referenced sidecars', async () => {
      // Assert the committed pin directly because a class containing only its
      // pinning scenario has no non-pinning live run to catch undeclared changes.
      /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
      for (const scenario of pinningByClass.values()) {
        /** 中文说明：变量 promptSource 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        /* v8 ignore next -- registration guarantees every pin has resolved sources. */
        const promptSource = promptSourceByClass.get(classOf(scenario)) ?? scenario
        /** 中文说明：变量 schemaSource 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        /* v8 ignore next -- registration guarantees every pin has resolved sources. */
        const schemaSource = schemaSourceByClass.get(classOf(scenario)) ?? scenario
        const fixtureDir = join(snapshotsDir, scenario.name)
        const [fixtureFile] = await sessionFixtures(fixtureDir)
        const fixture = await readFile(join(fixtureDir, fixtureFile as string), 'utf8')
        const headers = pinningHeaderPayloads(fixture, fixtureContext(fixture))
        const promptSnapshot = await readFile(
          join(snapshotsDir, promptSource.name, SYSTEM_PROMPT_SNAPSHOT),
          'utf8',
        )
        expect(headers.length, `${scenario.name}: unexpected request/header count`)
          .toBe(1 + (scenario.expectedHeaderChanges ?? 0))
        /** 中文说明：变量 toolSchemasSnapshot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const toolSchemasSnapshot = await readFile(
          join(snapshotsDir, schemaSource.name, TOOL_SCHEMAS_SNAPSHOT),
          'utf8',
        )
        /** 中文说明：变量 toolSchemas 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const toolSchemas = parseToolSchemasSnapshot(toolSchemasSnapshot)
        /** 中文说明：变量 schemaSets 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const schemaSets = [toolSchemas.initial, ...toolSchemas.changes]
        expect(schemaSets.length, `${schemaSource.name}: tool-schema sequence must match ${scenario.name}'s header sequence`)
          .toBe(headers.length)
        /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
        for (const [index, header] of headers.entries()) {
          expect(() => restorePinnedToolSchemas(header, schemaSets[index] as unknown[]), `${scenario.name}: tools must use the sidecar token`)
            .not.toThrow()
        }
        expect(promptSnapshot.length, `${promptSource.name}/${SYSTEM_PROMPT_SNAPSHOT} must not be empty`).toBeGreaterThan(0)
        expect(promptSnapshot.endsWith('\n'), `${promptSource.name}/${SYSTEM_PROMPT_SNAPSHOT} must end in a newline`).toBe(true)
        expect(toolSchemasSnapshot, `${schemaSource.name}/${TOOL_SCHEMAS_SNAPSHOT} must use canonical JSON formatting`)
          .toBe(formatToolSchemasSnapshot(toolSchemas.initial, toolSchemas.changes))
        expect(headerChangeCount(fixture), `${scenario.name}: a pinning fixture must carry exactly its declared changed headers`)
          .toBe(scenario.expectedHeaderChanges ?? 0)
      }
    })

    it('stores each distinct prompt and tool-schema snapshot once', async () => {
      /** 中文说明：函数值 prompts 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const prompts = await Promise.all([...promptOwners].map(async (owner): Promise<NamedSnapshotContent> => ({
        path: `${owner}/${SYSTEM_PROMPT_SNAPSHOT}`,
        content: await readFile(join(snapshotsDir, owner, SYSTEM_PROMPT_SNAPSHOT), 'utf8'),
      })))
      /** 中文说明：函数值 schemas 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const schemas = await Promise.all([...schemaOwners].map(async (owner): Promise<NamedSnapshotContent> => ({
        path: `${owner}/${TOOL_SCHEMAS_SNAPSHOT}`,
        content: await readFile(join(snapshotsDir, owner, TOOL_SCHEMAS_SNAPSHOT), 'utf8'),
      })))
      assertUniqueSnapshotContents('system-prompt', prompts)
      assertUniqueSnapshotContents('tool-schema', schemas)
    })

    it('every declared child sidecar is canonical and names a real child', async () => {
      /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
      for (const scenario of scenarios) {
        /** 中文说明：变量 dir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const dir = join(snapshotsDir, scenario.name)
        /** 中文说明：变量 files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const files = await sessionFixtures(dir)
        /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
        for (const index of scenario.pinsChildToolSchemas ?? []) {
          expect(files[index], `${scenario.name}: child schema pin ${index} must name an existing session.<n>.jsonl fixture`)
            .toBeDefined()
          /** 中文说明：变量 file 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const file = childToolSchemasSnapshot(index)
          /** 中文说明：变量 sidecar 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const sidecar = await readFile(join(dir, file), 'utf8')
          /** 中文说明：变量 parsed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const parsed = parseToolSchemasSnapshot(sidecar)
          expect(sidecar, `${scenario.name}/${file} must use canonical JSON formatting`)
            .toBe(formatToolSchemasSnapshot(parsed.initial, parsed.changes))
          expect(parsed.initial.length, `${scenario.name}/${file} must pin at least one schema`)
            .toBeGreaterThan(0)
        }
        /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
        for (const index of scenario.pinsChildSystemPrompts ?? []) {
          expect(files[index], `${scenario.name}: child prompt pin ${index} must name an existing session.<n>.jsonl fixture`)
            .toBeDefined()
          /** 中文说明：变量 file 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const file = childSystemPromptSnapshot(index)
          /** 中文说明：变量 sidecar 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const sidecar = await readFile(join(dir, file), 'utf8')
          /** 中文说明：变量 promptSource 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          /* v8 ignore next -- registration guarantees every scenario class has resolved sources. */
          const promptSource = promptSourceByClass.get(classOf(scenario)) ?? scenario
          /** 中文说明：变量 classPin 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const classPin = await readFile(join(snapshotsDir, promptSource.name, SYSTEM_PROMPT_SNAPSHOT), 'utf8')
          assertChildSystemPromptSnapshot(sidecar, initialSystemPromptSnapshot(classPin), `${scenario.name}/${file}`)
        }
      }
    })

    it('every committed JSONL has valid tool results and canonical fixture storage', async () => {
      // Prompts and schemas always leave JSONL. Header pins retain prefixes;
      // every other fixture tokenizes those too. Portable cwd tokens never
      // retain a platform realpath prefix. Fixed-point checks make these
      // storage rules fail loud.
      /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
      for (const scenario of scenarios) {
        /** 中文说明：变量 dir 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const dir = join(snapshotsDir, scenario.name)
        /** 中文说明：变量 files 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const files = await sessionFixtures(dir)
        /** 中文说明：该循环依次处理夹具或生成数据；循环变量仅在当前循环中有效。 */
        for (const file of files) {
          /** 中文说明：变量 fixture 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const fixture = await readFile(join(dir, file), 'utf8')
          expect(unknownToolCallIds(fixture), `${scenario.name}/${file} contains UNKNOWN_TOOL`)
            .toEqual([])
          expect(fixture, `${scenario.name}/${file} carries a non-canonical macOS cwd token`)
            .not.toContain('/private{{cwd}}')
          expect(scrubSystemPrompts(fixture), `${scenario.name}/${file} carries an unscrubbed system prompt`)
            .toEqual(fixture)
          expect(scrubToolSchemas(fixture), `${scenario.name}/${file} carries unscrubbed tool schemas`)
            .toEqual(fixture)
          if (scenario.pinsHeader !== true) {
            expect(scrubRequestHeaders(fixture), `${scenario.name}/${file} carries unscrubbed header content`)
              .toEqual(fixture)
          }
        }
        const fixtures = await Promise.all(files.map(file => readFile(join(dir, file), 'utf8')))
        expect(redactSessionSnapshotIds(fixtures), `${scenario.name}: identity redaction fixed point`).toEqual(fixtures)
      }
    })
  })
}
