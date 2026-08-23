/**
 * ================================ 文件注释 ================================
 * 【文件职责】settings 域的 zod schema 集合（名字从地图键派生）：describe /
 * openDocument / update / replace / mutate 的请求载荷与响应值校验。
 * 【技术维度】satisfies Wire<> 对齐契约类型；设置值本身是 unknown（schema 语义
 * 由各命名空间自己的 schema 定义）；mutate 用判别联合定义路径操作（set/unset）。
 * 【产品维度】设置界面的数据校验：命名空间总览（含脱敏秘密槽位）、打开设置
 * 文档、合并/整体替换/路径操作三种写模式（均支持 expectedRevision 乐观并发）。
 * 【逻辑维度】秘密槽位视图 → 命名空间视图 → describe/openDocument 请求响应 →
 * update/replace 请求（patch/section + 可选 revision）→ mutate 路径操作与请求
 * → 三种写模式的响应值（均为新脱敏视图）。
 * 【关键边界】applies 只能是 live/restart（生效时机）；update 的 patch 与
 * replace 的 section 都是字符串键记录；ops 用判别联合约束操作类型。
 * 【新手阅读建议】与 settings.ts 契约及 api-proxy.ts 的 settingsWrite 对照。
 * ==========================================================================
 */
/**
 * settings domain zod schemas (names derived from map keys: settingsDescribeRequestSchema /
 * settingsDescribeValueSchema / settingsUpdate* / settingsReplace*).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { SettingsNamespaceView, SettingsPathOpView, SettingsSecretView } from './settings.ts'

/** One redacted secret slot. */
// 一个脱敏秘密槽位：路径 + 是否已设置。
export const settingsSecretViewSchema = z.object({
  path: z.array(z.string()),
  set: z.boolean(),
}) satisfies z.ZodType<Wire<SettingsSecretView>>

/** SettingsNamespaceView row of settings.describe and the write responses. */
export const settingsNamespaceViewSchema = z.object({
  ns: z.string().min(1),
  schema: z.unknown(),
  value: z.unknown(),
  base: z.unknown().optional(),
  user: z.unknown().optional(),
  applies: z.union([z.literal('live'), z.literal('restart')]),
  secrets: z.array(settingsSecretViewSchema),
  revision: z.number(),
}) satisfies z.ZodType<Wire<SettingsNamespaceView>>

/** settings.describe request payload. */
export const settingsDescribeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'settings.describe'>>>

/** settings.describe response value. */
export const settingsDescribeValueSchema = z.object({
  writable: z.boolean(),
  hasDocument: z.boolean(),
  namespaces: z.array(settingsNamespaceViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'settings.describe'>>>

/** settings.openDocument request payload. */
export const settingsOpenDocumentRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'settings.openDocument'>>>

/** settings.openDocument response value. */
export const settingsOpenDocumentValueSchema = z.object({
  opened: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'settings.openDocument'>>>

/** settings.update request payload. */
export const settingsUpdateRequestSchema = z.object({
  ns: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
  expectedRevision: z.number().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'settings.update'>>>

/** settings.update response value: the namespace's new redacted view. */
export const settingsUpdateValueSchema = settingsNamespaceViewSchema satisfies z.ZodType<Wire<ResponseValue<'settings.update'>>>

/** settings.replace request payload. */
export const settingsReplaceRequestSchema = z.object({
  ns: z.string().min(1),
  section: z.record(z.string(), z.unknown()),
  expectedRevision: z.number().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'settings.replace'>>>

/** One path-addressed edit of settings.mutate. */
export const settingsPathOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), path: z.array(z.string()), value: z.unknown() }),
  z.object({ op: z.literal('unset'), path: z.array(z.string()) }),
]) as unknown as z.ZodType<Wire<SettingsPathOpView>>

/** settings.mutate request payload. */
export const settingsMutateRequestSchema = z.object({
  ns: z.string().min(1),
  ops: z.array(settingsPathOpSchema),
  expectedRevision: z.number().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'settings.mutate'>>>

/** settings.mutate response value: the namespace's new redacted view. */
export const settingsMutateValueSchema = settingsNamespaceViewSchema satisfies z.ZodType<Wire<ResponseValue<'settings.mutate'>>>

/** settings.replace response value. */
export const settingsReplaceValueSchema = settingsNamespaceViewSchema satisfies z.ZodType<Wire<ResponseValue<'settings.replace'>>>
