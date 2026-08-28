/*
 * ================================ 文件注释 ================================
 * 【文件职责】typert 加载器插件：当 loader（Cordis 插件加载器）挂载某个插件入口时，
 *             自动解析该入口的 package.json；包若导出 ./typert，则导入其 host 面产物
 *             并把 TYPERT 清单注册进 ctx.typert；入口卸载时撤销注册。
 *             显式 packages 配置覆盖"嵌套在别的 Loader 入口后面"的插件。
 * 【技术维度】Cordis 插件三件套（name / inject / apply）+ schemastery 配置校验；
 *             监听 loader 的 internal/plugin 事件做增量扫描（脏集合 + 微任务 flush，
 *             与 client-modules 节点半区一致）；动态 import 产物 + 运行时清单逐字段校验
 *             （validateTypertManifest 及一系列 require* 辅助）。
 * 【产品维度】让"参与远程通信的包"零配置接入：打包产物带 ./typert 导出即自动注册，
 *             无需手工调用 ctx.typert.register()；插件卸载自动清理，不留残留。
 * 【逻辑维度】按代码顺序：① 导出常量与配置（TYPERT_HOST_EXPORT / name / inject /
 *             Config）；② 产物解析（typertExportOf）；③ 清单校验（validateTypertManifest
 *             及 require* 系列）；④ apply 主逻辑（require 锚点、缓存表、resolveArtifact /
 *             loadManifest / qualifies / processOne / flush、事件订阅、激活扫描）。
 * 【关键边界】校验是"失败即抛"：显式配置的包解析失败 / 无 ./typert 导出 / 清单结构
 *             非法都会抛错（激活期聚合为一次响亮失败，稳态按包记日志不互相毒害）；
 *             从 Loader 入口发现的"无导出包"静默跳过。包判定与清单按包名缓存且不过期。
 * 【新手阅读建议】先读 apply 主流程（缓存表与 resolveArtifact → loadManifest →
 *             processOne → flush），再看 validateTypertManifest 理解"产物边界校验"。
 * ==========================================================================
 */

/**
 * Typert Loader integration: automatic registration for mounted plugin packages.
 *
 * When a loader entry mounts, this plugin resolves the entry's package.json; a
 * package exporting `./typert` has its host face imported and its
 * `TYPERT` manifest registered into `ctx.typert`, and the registration is
 * withdrawn when the entry unmounts. Explicit `packages` cover plugins nested
 * behind another Loader entry, whose Cordis fibers carry no resolvable package
 * specifier. Packages without the export are skipped silently when discovered
 * from Loader entries; an explicit package or declared artifact that is broken
 * fails loud — aggregated into this plugin's activation throw for existing
 * entries, contained to a logged error per package in steady state.
 *
 * Scanning is incremental per entry name. Every cordis `internal/plugin`
 * emission marks the fiber's entry name dirty, and a microtask flush
 * reconciles each dirty name against the live
 * loader entries; the activation pass seeds the same dirty set with all
 * current entries. Package verdicts and imported manifests are cached per
 * package name and never expire — plugin-set changes take effect on restart.
 *
 * Manual `ctx.typert.register()` remains available for contributions
 * that do not use a `./typert` artifact (hand-written wire schemas,
 * tests, non-loader compositions).
 *
 * @module @deepseek-ai/dsh-typert-loader
 */
// 中文导读：本插件把"打包产物的 ./typert 导出"与"运行时注册中心"接起来：
// 装载即注册、卸载即撤销，全程自动。

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'

/** The package.json exports key naming a package's host-face typert artifact. */
// 中文：package.json exports 里约定"host 面 typert 产物"的子路径键：包导出 ./typert
// 即声明自己参与 typert 注册（与 generator 生成的产物路径一致）。
export const TYPERT_HOST_EXPORT = './typert'

/** Cordis plugin name. */
// 中文：Cordis 插件名。
export const name = 'typert-loader'
/** Services required before registration: the registry this plugin feeds and the Loader it observes. */
// 中文：本插件依赖的服务：typert（注册中心，插件往里写清单）与 loader（要观察的加载器）。
export const inject = ['typert', 'loader']

/** Additional package artifacts whose owning plugins are nested behind another Loader entry. */
// 中文：额外配置：这些包的真身插件嵌套在别的 Loader 入口后面，纤维上解析不到包名，
// 因此需要在配置里显式点名。
export interface Config {
  /** Exact npm package names that must resolve and export `./typert`. */
  // 中文：必须能解析且导出 ./typert 的精确 npm 包名列表。
  packages?: string[]
}

/** Validate explicit package names and default to Loader-entry discovery only. */
// 中文：配置校验器：packages 必须是非空字符串数组，缺省为 []（只走 Loader 入口发现）。
export const Config: z<Config> = z.object({
  packages: z.array(z.string().min(1)).default([]),
})

// 中文：解析后的配置：packages 必填（缺省空数组）。
type ResolvedConfig = Required<Config>

// 中文：成员 kind 的合法取值集合（与 model 的 MemberModel 对齐，校验产物用）。
const MEMBER_KINDS = new Set(['property', 'method', 'getter', 'setter', 'call', 'construct', 'index'])

/** Resolve the `./typert` export to a relative path, accepting the string and one-level conditional forms. */
// 中文：从 package.json 的 exports 里解析 ./typert 对应的相对路径：支持字符串形式与
// "对象里带 default 条件"的一层条件形式；其余形式视为非法（抛错）。
function typertExportOf(pkgName: string, exportsField: unknown): string | undefined {
  if (typeof exportsField !== 'object' || exportsField === null) return undefined
  const target = (exportsField as Record<string, unknown>)[TYPERT_HOST_EXPORT]
  if (target === undefined) return undefined
  if (typeof target === 'string') return target
  if (typeof target === 'object' && target !== null) {
    const fallback = (target as Record<string, unknown>).default
    if (typeof fallback === 'string') return fallback
  }
  throw new Error(`typert-loader: ${pkgName} exports["${TYPERT_HOST_EXPORT}"] must be a string or an object with a string default`)
}

/**
 * Narrow a dynamically imported typert module's `TYPERT` export to a
 * contribution owned by `pkgName`. This is the module/file boundary: the
 * manifest crosses from a build artifact into the typed registry, so every
 * field is checked and every failure names the package and the defect.
 * @param pkgName - the package whose typert face was imported.
 * @param exported - the module's `TYPERT` export.
 * @returns the validated contribution.
 */
// 中文：把动态导入的 typert 模块的 TYPERT 导出"收窄"成属于 pkgName 的贡献。
// 这是模块 / 文件边界：清单从构建产物进入类型化注册中心，因此逐字段校验，
// 任何失败都会指明包名与缺陷。校验通过后断言成 TypertContribution 交给注册中心。
export function validateTypertManifest(pkgName: string, exported: unknown): TypertContribution {
  if (typeof exported !== 'object' || exported === null) {
    throw new Error(`typert-loader: ${pkgName} exports "${TYPERT_HOST_EXPORT}" but its module has no TYPERT manifest object`)
  }
  const manifest = exported as Record<string, unknown>
  // 中文：清单里的 package 必须等于导出它的包名（防止 A 包冒充 B 包的清单）。
  if (manifest.package !== pkgName) {
    throw new Error(
      `typert-loader: ${pkgName} TYPERT manifest names package ${JSON.stringify(manifest.package)} — the manifest must be owned by the package that exports it`,
    )
  }
  // 中文：./typert 导出必须是 host 面产物（client 面不在此注册）。
  if (manifest.face !== 'host') {
    throw new Error(`typert-loader: ${pkgName} exports "${TYPERT_HOST_EXPORT}" but TYPERT.face is not "host"`)
  }
  if (!Array.isArray(manifest.schemas)) {
    throw new Error(`typert-loader: ${pkgName} TYPERT.schemas must be an array`)
  }
  // 中文：每个 schema 条目必须有名字，且必须是 zod v4 的 schema 实例（带 _zod 标记）。
  for (const value of manifest.schemas as unknown[]) {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`typert-loader: ${pkgName} TYPERT.schemas contains a non-object schema`)
    }
    const schema = value as Record<string, unknown>
    requireString(pkgName, schema, 'name', 'schema')
    if (typeof schema.schema !== 'object' || schema.schema === null || !('_zod' in schema.schema)) {
      throw new Error(`typert-loader: ${pkgName} TYPERT schema "${schema.name as string}" is not a zod v4 schema instance`)
    }
  }
  // 中文：模型区（服务 / 事件 / 对象）逐条校验结构与必填字符串。
  const model = requireObject(pkgName, manifest.model, 'TYPERT.model')
  const services = requireArray(pkgName, model.services, 'TYPERT.model.services')
  const events = requireArray(pkgName, model.events, 'TYPERT.model.events')
  const objects = requireArray(pkgName, model.objects, 'TYPERT.model.objects')
  for (const value of services) {
    const service = requireObject(pkgName, value, 'service')
    requireDocumentation(pkgName, service, 'service')
    requireString(pkgName, service, 'key', 'service')
    requireString(pkgName, service, 'exportName', 'service')
    requireMembers(pkgName, service.members, `service "${service.key as string}"`)
    requireTypes(pkgName, service.types, `service "${service.key as string}"`)
  }
  for (const value of events) {
    const event = requireObject(pkgName, value, 'event')
    requireDocumentation(pkgName, event, 'event')
    requireString(pkgName, event, 'name', 'event')
    requireString(pkgName, event, 'signature', `event "${event.name as string}"`)
    if (event.mode !== undefined && typeof event.mode !== 'string') {
      throw new Error(`typert-loader: ${pkgName} event "${event.name as string}" mode must be a string`)
    }
  }
  for (const value of objects) {
    const object = requireObject(pkgName, value, 'object')
    requireDocumentation(pkgName, object, 'object')
    requireString(pkgName, object, 'name', 'object')
    requireString(pkgName, object, 'exportName', 'object')
    requireMembers(pkgName, object.members, `object "${object.name as string}"`)
    requireTypes(pkgName, object.types, `object "${object.name as string}"`)
  }
  for (const value of requireArray(pkgName, manifest.invocations, 'TYPERT.invocations')) {
    requireInvocation(pkgName, value)
  }
  return manifest as unknown as TypertContribution
}

// 中文：断言值是"普通对象"（非 null / 非数组），否则抛错。
function requireObject(pkgName: string, value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`typert-loader: ${pkgName} ${subject} must be an object`)
  }
  return value as Record<string, unknown>
}

// 中文：断言值是数组，否则抛错。
function requireArray(pkgName: string, value: unknown, subject: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`typert-loader: ${pkgName} ${subject} must be an array`)
  return value
}

// 中文：断言对象里指定键是"非空字符串"。
function requireString(pkgName: string, value: Record<string, unknown>, key: string, subject: string): void {
  if (typeof value[key] !== 'string' || value[key].length === 0) {
    throw new Error(`typert-loader: ${pkgName} ${subject} has a missing or empty ${key}`)
  }
}

// 中文：断言文档结构合法：tags 必须是数组，description / summary / jsDoc 若有则必须是字符串。
function requireDocumentation(pkgName: string, value: Record<string, unknown>, subject: string): void {
  requireArray(pkgName, value.tags, `${subject}.tags`)
  for (const key of ['description', 'summary', 'jsDoc'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`typert-loader: ${pkgName} ${subject}.${key} must be a string`)
    }
  }
}

// 中文：断言成员列表合法：每项是对象、有非空 name / signature，且 kind 在合法集合内。
function requireMembers(pkgName: string, value: unknown, subject: string): void {
  for (const item of requireArray(pkgName, value, `${subject}.members`)) {
    const member = requireObject(pkgName, item, `${subject} member`)
    requireString(pkgName, member, 'name', `${subject} member`)
    requireString(pkgName, member, 'signature', `${subject} member`)
    if (typeof member.kind !== 'string' || !MEMBER_KINDS.has(member.kind)) {
      throw new Error(`typert-loader: ${pkgName} ${subject} member "${member.name as string}" has invalid kind`)
    }
  }
}

// 中文：断言类型列表合法：每项是对象、有非空 name / declaration。
function requireTypes(pkgName: string, value: unknown, subject: string): void {
  for (const item of requireArray(pkgName, value, `${subject}.types`)) {
    const type = requireObject(pkgName, item, `${subject} type`)
    requireString(pkgName, type, 'name', `${subject} type`)
    requireString(pkgName, type, 'declaration', `${subject} type`)
  }
}

// 中文：断言一条调用描述合法：id / service / namespace / method 必填；接收者只能是
// direct 或 context；参数 wire 全局唯一、source 只能是 json / lookup（lookup 必须带
// lookup 键，json 不得带）；cancellation 只能是 signal；scope 必须指向唯一的 lookup
// 参数且不能与 context 接收者同用；结果必须是 strict codec；sourceLocation 若存在则
// 行 / 列必须是正整数。
function requireInvocation(pkgName: string, value: unknown): void {
  const invocation = requireObject(pkgName, value, 'invocation')
  for (const key of ['id', 'service', 'namespace', 'method'] as const) {
    requireString(pkgName, invocation, key, 'invocation')
  }
  const id = invocation.id as string
  const receiver = requireObject(pkgName, invocation.invocation, `invocation "${id}" receiver`)
  if (receiver.kind === 'context') {
    requireString(pkgName, receiver, 'context', `invocation "${id}" Context receiver`)
    requireString(pkgName, receiver, 'wire', `invocation "${id}" Context receiver`)
    requireStrictCodec(pkgName, receiver.codec, `invocation "${id}" Context codec`)
  } else if (receiver.kind !== 'direct') {
    throw new Error(`typert-loader: ${pkgName} invocation "${id}" receiver kind must be "direct" or "context"`)
  }
  const wires = new Set<string>()
  const parameters = new Map<string, Record<string, unknown>>()
  let lookupCount = 0
  for (const valueParameter of requireArray(pkgName, invocation.parameters, `invocation "${id}" parameters`)) {
    const parameter = requireObject(pkgName, valueParameter, `invocation "${id}" parameter`)
    requireString(pkgName, parameter, 'name', `invocation "${id}" parameter`)
    requireString(pkgName, parameter, 'wire', `invocation "${id}" parameter`)
    const wire = parameter.wire as string
    // 中文：线上字段名必须唯一（scope / context 的 wire 也占用同一命名空间）。
    if (wires.has(wire)) {
      throw new Error(`typert-loader: ${pkgName} invocation "${id}" repeats wire field "${wire}"`)
    }
    wires.add(wire)
    if (parameter.source === 'lookup') {
      lookupCount += 1
      requireString(pkgName, parameter, 'lookup', `invocation "${id}" lookup parameter`)
    } else if (parameter.source === 'json') {
      if (parameter.lookup !== undefined) {
        throw new Error(`typert-loader: ${pkgName} invocation "${id}" JSON parameter declares a lookup`)
      }
    } else {
      throw new Error(`typert-loader: ${pkgName} invocation "${id}" parameter source must be "json" or "lookup"`)
    }
    parameters.set(wire, parameter)
    requireStrictCodec(pkgName, parameter.codec, `invocation "${id}" parameter codec`)
  }
  if (invocation.cancellation !== undefined) {
    const cancellation = requireObject(pkgName, invocation.cancellation, `invocation "${id}" cancellation`)
    if (cancellation.parameter !== 'signal') {
      throw new Error(`typert-loader: ${pkgName} invocation "${id}" cancellation parameter must be "signal"`)
    }
  }
  // 中文：scope 投影必须选中唯一的 lookup 参数，且不能与 context 接收者并存。
  if (invocation.scope !== undefined) {
    if (receiver.kind !== 'direct') {
      throw new Error(`typert-loader: ${pkgName} invocation "${id}" Context receiver cannot declare a direct scope projection`)
    }
    const scope = requireObject(pkgName, invocation.scope, `invocation "${id}" scope`)
    requireString(pkgName, scope, 'context', `invocation "${id}" scope`)
    requireString(pkgName, scope, 'wire', `invocation "${id}" scope`)
    const parameter = parameters.get(scope.wire as string)
    if (lookupCount !== 1 || parameter?.source !== 'lookup' || parameter.lookup !== scope.context) {
      throw new Error(
        `typert-loader: ${pkgName} invocation "${id}" scope wire "${scope.wire as string}" must select its only lookup parameter`,
      )
    }
  }
  if (receiver.kind === 'context' && wires.has(receiver.wire as string)) {
    throw new Error(`typert-loader: ${pkgName} invocation "${id}" repeats Context wire field "${receiver.wire as string}"`)
  }
  requireStrictCodec(pkgName, invocation.result, `invocation "${id}" result codec`)
  if (invocation.sourceLocation !== undefined) {
    const location = requireObject(pkgName, invocation.sourceLocation, `invocation "${id}" sourceLocation`)
    requireString(pkgName, location, 'file', `invocation "${id}" sourceLocation`)
    for (const key of ['line', 'column'] as const) {
      if (!Number.isInteger(location[key]) || (location[key] as number) < 1) {
        throw new Error(`typert-loader: ${pkgName} invocation "${id}" sourceLocation.${key} must be a positive integer`)
      }
    }
  }
}

// 中文：断言一个 codec 是 strict 模式且由 zod v4 schema 支撑：mode 必须 strict、
// 有非空 typeSymbol、schema 带 _zod 标记且有 parse 方法。
function requireStrictCodec(pkgName: string, value: unknown, subject: string): void {
  const codec = requireObject(pkgName, value, subject)
  if (codec.mode !== 'strict') {
    throw new Error(`typert-loader: ${pkgName} ${subject} must use a strict codec`)
  }
  requireString(pkgName, codec, 'typeSymbol', subject)
  if (typeof codec.schema !== 'object'
    || codec.schema === null
    || !('_zod' in codec.schema)
    || typeof (codec.schema as { parse?: unknown }).parse !== 'function') {
    throw new Error(`typert-loader: ${pkgName} ${subject} is not backed by a zod v4 schema`)
  }
}

/**
 * Scan current Loader entries during activation, then follow entry mounts and
 * unmounts for this plugin's lifetime.
 * @param ctx - plugin context carrying `typert` and `loader`.
 * @param config - explicit package artifacts in addition to Loader entries.
 */
// 中文：插件主逻辑：激活时扫描当前 Loader 入口，随后在本插件生命周期内跟随入口的
// 挂载 / 卸载做增量注册 / 撤销。显式配置的包始终纳入。
export async function apply(ctx: Context, config: Config): Promise<void> {
  // Resolution anchor: the config tree's baseUrl (the cordis.yml directory,
  // whose package declares every composed plugin as a dependency). This
  // package's own URL would miss sibling packages under pnpm's isolated
  // node_modules.
  // 中文：解析锚点用配置树（cordis.yml 所在目录）的 baseUrl——该目录的 package 声明了
  // 全部组合插件为依赖；用本包自己的 URL 会在 pnpm 的隔离 node_modules 下漏掉兄弟包。
  if (ctx.baseUrl === undefined) {
    throw new Error('typert-loader: ctx.baseUrl is unset — the loader needs the config-tree anchor to resolve plugin packages')
  }
  const require = createRequire(ctx.baseUrl)
  const configured = new Set((config as ResolvedConfig).packages)

  // Registered contributions by entry name; the disposer withdraws the entry's registration.
  // 中文：按入口名登记"已注册贡献"；disposer 用于撤销该入口的注册。
  const registered = new Map<string, () => Promise<void>>()
  // In-flight import/register tasks by entry name.
  // 中文：按入口名记录"进行中的导入 / 注册任务"（防并发重复注册）。
  const pending = new Map<string, Promise<void>>()
  // Artifact paths by package name. Negative verdicts (unresolvable specifier —
  // loader builtins, subpath rows — or no typert export) are cached as null and
  // never expire: plugin-set changes take effect on restart.
  // 中文：按包名缓存产物路径。否定判定（说明符解析不了——loader 内建、子路径行——或
  // 无 typert 导出）缓存为 null 且永不过期：插件集合变化要重启才生效。
  const artifactPath = new Map<string, string | null>()
  // Imported+validated manifests by package name (one import per package per process).
  // 中文：按包名缓存"已导入并校验的清单"（每个包每个进程只导入一次）。
  const manifests = new Map<string, Promise<TypertContribution>>()
  // 中文：脏入口名集合：internal/plugin 事件或激活扫描会把入口名加入，flush 时逐名处理。
  const dirty = new Set<string>()
  let flushQueued = false
  let active = true
  // 中文：插件生命周期结束（ctx.effect 的清理回调）时停用本插件并清空脏集合。
  ctx.effect(function* () {
    yield () => {
      active = false
      dirty.clear()
    }
  }, 'typert loader lifetime')

  // 中文：解析一个包的 ./typert 产物路径（带缓存）。配置内的包解析失败 / 无导出会
  // 响亮失败；loader 内建与子路径入口（无法解析到包根的）永久判为"非 typert 贡献"。
  const resolveArtifact = (pkgName: string): string | null => {
    const cached = artifactPath.get(pkgName)
    if (cached !== undefined) return cached
    let pkgPath: string
    try {
      pkgPath = require.resolve(`${pkgName}/package.json`)
    } catch (cause) {
      if (configured.has(pkgName)) {
        throw new Error(
          `typert-loader: configured package "${pkgName}" cannot be resolved from the config tree — add it to the composition package dependencies or remove it from packages`,
          { cause },
        )
      }
      // Not a resolvable package root: loader builtins (cordis:include) and
      // subpath entries land here — permanently not a typert contributor.
      // 中文：解析不到包根的多是 loader 内建（cordis:include）与子路径入口——永久判定
      // 为"不是 typert 贡献者"并缓存否定结论。
      artifactPath.set(pkgName, null)
      return null
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    const rel = typertExportOf(pkgName, pkg.exports)
    // 中文：显式配置的包必须导出 ./typert，否则是配置错误，直接失败。
    if (rel === undefined && configured.has(pkgName)) {
      throw new Error(`typert-loader: configured package "${pkgName}" does not export "${TYPERT_HOST_EXPORT}"`)
    }
    const resolved = rel === undefined ? null : join(dirname(pkgPath), rel)
    artifactPath.set(pkgName, resolved)
    return resolved
  }

  // 中文：导入并校验一个包的 TYPERT 清单（每个包每进程一次，结果以 Promise 缓存；
  // 导入失败也会缓存为已拒绝的 Promise，保证只报一次错）。
  const loadManifest = (pkgName: string, path: string): Promise<TypertContribution> => {
    let loading = manifests.get(pkgName)
    if (loading === undefined) {
      loading = import(pathToFileURL(path).href).then(
        (mod: Record<string, unknown>) => validateTypertManifest(pkgName, mod.TYPERT),
        (cause: unknown) => {
          throw new Error(
            `typert-loader: ${pkgName} exports "${TYPERT_HOST_EXPORT}" but importing ${path} failed: ${String(cause)}`,
          )
        },
      )
      manifests.set(pkgName, loading)
    }
    return loading
  }

  // 中文：判断一个入口名当前是否"合格"：显式配置的包恒合格；loader 里"同名、有纤维、
  // 未禁用"的入口也合格。不合格说明已卸载，需要撤销其注册。
  const qualifies = (entryName: string): boolean => {
    if (configured.has(entryName)) return true
    for (const entry of ctx.loader.entries()) {
      if (entry.options.name === entryName && entry.fiber !== undefined && !entry.disabled) return true
    }
    return false
  }

  /** Reconcile one entry name against the live loader entries; a mount returns its async task. */
  // 中文：让一个入口名与"当前 loader 条目"对齐：不合格 → 若有注册就撤销并返回撤销任务；
  // 合格且未注册 → 解析产物、导入清单、注册贡献。返回的任务供 flush 聚合错误。
  const processOne = (entryName: string): Promise<void> | undefined => {
    if (!qualifies(entryName)) {
      const dispose = registered.get(entryName)
      if (dispose !== undefined) {
        registered.delete(entryName)
        return dispose()
      }
      return undefined
    }
    if (registered.has(entryName) || pending.has(entryName)) return undefined
    const path = resolveArtifact(entryName)
    if (path === null) return undefined
    const task = loadManifest(entryName, path).then((manifest) => {
      // The entry may have unmounted (or already re-registered) while the import was in flight.
      // 中文：导入期间入口可能已卸载（或已重新注册），此时跳过本次注册。
      if (!active || !qualifies(entryName) || registered.has(entryName)) return
      registered.set(entryName, ctx.typert.register(manifest))
    })
    pending.set(entryName, task)
    // Two-armed settle: a bare .finally() would mint a second, unhandled rejection.
    // 中文：双臂收尾：只用 .finally() 会再造出一个没人处理的拒绝，因此用 then 双参收尾。
    const settle = (): void => { pending.delete(entryName) }
    void task.then(settle, settle)
    return task
  }

  // 中文：冲洗脏集合：逐个入口调用 processOne，把任务与同步抛错都收进 onError 回调
  //（稳态记日志，激活期聚合成一次抛错）。
  const flush = (onError: (error: Error) => void): Promise<void>[] => {
    const tasks: Promise<void>[] = []
    for (const entryName of [...dirty]) {
      dirty.delete(entryName)
      try {
        const task = processOne(entryName)
        if (task !== undefined) tasks.push(task.catch((error: unknown) => { onError(toError(error)) }))
      } catch (error) {
        // Steady state: one broken package must not poison the others; the
        // activation pass aggregates these into a loud throw instead.
        // 中文：稳态下单个坏包不能毒害其他包；激活扫描则把这些错误聚合成一次响亮抛出。
        onError(toError(error))
      }
    }
    return tasks
  }

  // Subscribe before seeding so an entry arriving mid-activation lands in the
  // same dirty set (Set idempotence makes the overlap harmless). An entry-less
  // fiber is a child plugin or a manual mount — never a loader row; O(1) drop.
  // 中文：先订阅再播种，这样激活期间到达的入口也会落进同一个脏集合（Set 幂等，重叠
  // 无害）。没有入口名的纤维是子插件或手工挂载——绝不是 loader 行，O(1) 丢弃。
  ctx.on('internal/plugin', (fiber) => {
    const entryName = fiber.entry?.options.name
    if (entryName === undefined) return
    dirty.add(entryName)
    if (flushQueued) return
    flushQueued = true
    queueMicrotask(() => {
      flushQueued = false
      if (!active) return
      for (const task of flush((err) => { ctx.logger.error(err) })) void task
    })
  })

  // Activation pass: the initial scan IS the incremental path over the current
  // entries; a malformed typert contributor among the already-loaded entries
  // aggregates into one loud throw (FAILED loader fiber; the boot sweep reports it).
  // 中文：激活扫描：初始扫描就是"对当前条目走一遍增量路径"；已加载条目里的畸形
  // typert 贡献会聚合成一次响亮失败（loader 纤维标记 FAILED，启动清扫会报告它）。
  for (const packageName of configured) dirty.add(packageName)
  for (const entry of ctx.loader.entries()) dirty.add(entry.options.name)
  const failures: Error[] = []
  await Promise.all(flush((err) => { failures.push(err) }))
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `typert-loader: ${String(failures.length)} typert contributor(s) failed to register:\n${failures.map(e => `  - ${e.message}`).join('\n')}`,
    )
  }
}

/** Normalize an arbitrary import or manifest failure to an Error. */
// 中文：把任意导入 / 清单失败归一成 Error（非 Error 值包成新 Error）。
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
