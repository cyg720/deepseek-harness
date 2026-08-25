/*
 * ================================ 文件注释 ================================
 * 【文件职责】agent-presets 域的 zod schema 集合（名字从地图键派生）：list /
 * select / read / copy / openDocument / remove 的请求载荷与响应值校验。
 * 【技术维度】satisfies Wire<> 对齐契约类型；trust 收窄为 system/user；
 * broken 是最小长度 1 的可选字段。
 * 【产品维度】预设选择器与预设管理界面的数据校验。
 * 【逻辑维度】agentPresetEntrySchema → 六个方法的请求/响应 schema。
 * 【关键边界】openDocument 响应是二选一联合（opened:true 或 opened:false +
 * 目录路径文本）；copy 的 name 可选。
 * 【新手阅读建议】与 agent-presets.ts 契约及 api-proxy.ts 的 agentPresets 域
 * 实现对照阅读。
 * ==========================================================================
 */
/**
 * agent-presets domain zod schemas (names derived from map keys:
 * agentPresetListRequestSchema / agentPresetListValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { AgentPresetEntry } from './agent-presets.ts'

/** AgentPresetEntry row of agentPreset.list. */
// agentPreset.list 的预设条目行。
export const agentPresetEntrySchema = z.object({
  id: z.string().min(1),
  trust: z.union([z.literal('system'), z.literal('user')]),
  isDefault: z.boolean(),
  name: z.string().optional(),
  description: z.string().optional(),
  broken: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<AgentPresetEntry>>

/** agentPreset.list request payload. */
export const agentPresetListRequestSchema = z.object({
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.list'>>>

/** agentPreset.list response value. */
export const agentPresetListValueSchema = z.object({
  presets: z.array(agentPresetEntrySchema),
  authorable: z.boolean(),
  hasDocument: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.list'>>>

/** agentPreset.select request payload. */
export const agentPresetSelectRequestSchema = z.object({
  sessionId: sessionIdSchema,
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.select'>>>

/** agentPreset.select response value. */
export const agentPresetSelectValueSchema = z.object({
  agentPreset: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.select'>>>

/** agentPreset.read request payload. */
export const agentPresetReadRequestSchema = z.object({
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.read'>>>

/** agentPreset.read response value. */
export const agentPresetReadValueSchema = z.object({
  agentPreset: z.string(),
  trust: z.union([z.literal('system'), z.literal('user')]),
  content: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.read'>>>

/** agentPreset.copy request payload. */
export const agentPresetCopyRequestSchema = z.object({
  from: z.string().min(1),
  agentPreset: z.string().min(1),
  name: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.copy'>>>

/** agentPreset.copy response value. */
export const agentPresetCopyValueSchema = z.object({
  agentPreset: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.copy'>>>

/** agentPreset.openDocument request payload. */
export const agentPresetOpenDocumentRequestSchema = z.object({
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.openDocument'>>>

/** agentPreset.openDocument response value. */
export const agentPresetOpenDocumentValueSchema = z.union([
  z.object({ opened: z.literal(true) }),
  z.object({ opened: z.literal(false), path: z.string() }),
]) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.openDocument'>>>

/** agentPreset.remove request payload. */
export const agentPresetRemoveRequestSchema = z.object({
  agentPreset: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.remove'>>>

/** agentPreset.remove response value. */
export const agentPresetRemoveValueSchema = z.object({
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.remove'>>>
