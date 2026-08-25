/*
 * ================================ 文件注释 ================================
 * 【文件职责】RPC 方法注册表与从签名派生的泛型：一张"方法名 → 方法签名"的
 * 映射表，是全协议的单一声明来源——载荷/值类型全部从这里派生。
 * 【技术维度】映射键即线上路径段（POST /api/session.list）；payload/value 类型
 * 经 Parameters/ReturnType 索引类型从签名推导；新增方法只改一处，schema 表、
 * 分发表、客户端值表的键覆盖都由编译器强制与它一致。
 * 【产品维度】保证客户端与服务端对每个方法的载荷/返回值认知严格同步，新增
 * 或修改方法时任何一侧漏改都会编译失败，而不是运行期意外。
 * 【逻辑维度】导入各域接口 → 定义 RpcMethodMap（键→签名）→ 派生 RequestPayload
 * （取请求载荷）与 ResponseValue（取成功值）。
 * 【关键边界】只登记客户端请求方法（respond 是 client-response 故缺席）；方法
 * 可在请求后声明尾随 AbortSignal 参数——载体传请求信号，绝不作为线上字段。
 * 【新手阅读建议】对照一个方法（如 session.prompt）从 map 键 → 域名接口签名 →
 * 派生类型的完整链路，体会"单一声明来源"的设计。
 * ==========================================================================
 */
/**
 * RPC method registry and signature-derived generics. The map
 * registers only client-request methods (respond is a client-response, so it is absent);
 * map keys are the wire path segments (POST /api/session.list).
 */

import type { SessionsApi } from './sessions.ts'
import type { HostApi } from './host.ts'
import type { WorkspaceApi } from './workspace.ts'
import type { AgentPresetsApi } from './agent-presets.ts'
import type { SkillsApi } from './skills.ts'
import type { GoalsApi } from './goals.ts'
import type { SettingsApi } from './settings.ts'
import type { CredentialsApi } from './credentials.ts'
import type { LlmApi } from './llm.ts'
import type { SubagentsApi } from './subagents.ts'
import type { RpcResponse } from './rpc.ts'

/**
 * Method name → method signature. Signatures are the single source of truth; payload/value
 * types are always derived from here. A method may declare a trailing AbortSignal after the
 * the request (command.execute): the carrier passes its request signal, never a wire field.
 */
// 方法注册表本体：键是线上路径段，值是该方法的域名接口签名。签名是唯一事实来源，
// 服务端分发表、客户端值表、请求/响应 schema 表都从这里派生并被编译器强制对齐。
export interface RpcMethodMap {
  'session.list': SessionsApi['list']
  'session.search': SessionsApi['search']
  'session.create': SessionsApi['create']
  'session.history': SessionsApi['history']
  'session.models': SessionsApi['models']
  'session.selectModel': SessionsApi['selectModel']
  'session.rename': SessionsApi['rename']
  'session.fork': SessionsApi['fork']
  'session.prompt': SessionsApi['prompt']
  'session.attachment': SessionsApi['attachment']
  'session.updateQueue': SessionsApi['updateQueue']
  'session.cancel': SessionsApi['cancel']
  'subagent.list': SubagentsApi['list']
  'subagent.history': SubagentsApi['history']
  'subagent.prompt': SubagentsApi['prompt']
  'subagent.interrupt': SubagentsApi['interrupt']
  'host.describe': HostApi['describe']
  'host.pickDirectory': HostApi['pickDirectory']
  'host.listDirectory': HostApi['listDirectory']
  'host.createDirectory': HostApi['createDirectory']
  'host.openPath': HostApi['openPath']
  'workspace.list': WorkspaceApi['list']
  'workspace.create': WorkspaceApi['create']
  'workspace.rename': WorkspaceApi['rename']
  'workspace.delete': WorkspaceApi['delete']
  'workspace.insertBefore': WorkspaceApi['insertBefore']
  'workspace.insertSessionBefore': WorkspaceApi['insertSessionBefore']
  'workspace.archiveSession': WorkspaceApi['archiveSession']
  'skill.list': SkillsApi['list']
  'agentPreset.list': AgentPresetsApi['list']
  'agentPreset.select': AgentPresetsApi['select']
  'agentPreset.read': AgentPresetsApi['read']
  'agentPreset.copy': AgentPresetsApi['copy']
  'agentPreset.openDocument': AgentPresetsApi['openDocument']
  'agentPreset.remove': AgentPresetsApi['remove']
  'goal.create': GoalsApi['create']
  'goal.edit': GoalsApi['edit']
  'goal.pause': GoalsApi['pause']
  'goal.resume': GoalsApi['resume']
  'goal.complete': GoalsApi['complete']
  'goal.clear': GoalsApi['clear']
  'settings.describe': SettingsApi['describe']
  'settings.openDocument': SettingsApi['openDocument']
  'settings.update': SettingsApi['update']
  'settings.replace': SettingsApi['replace']
  'settings.mutate': SettingsApi['mutate']
  'credentials.describe': CredentialsApi['describe']
  'credentials.set': CredentialsApi['set']
  'credentials.unset': CredentialsApi['unset']
  'llm.providers': LlmApi['providers']
  'llm.models': LlmApi['models']
  'llm.discoverModels': LlmApi['discoverModels']
}

/** Business request payload of method K (reaches through the RpcRequest narrow form to payload). */
// 方法 K 的业务请求载荷：穿透 RpcRequest 窄形式取 payload 类型。
export type RequestPayload<K extends keyof RpcMethodMap> = Parameters<RpcMethodMap[K]>[0]['payload']

/** Business return value of method K (reaches through the RpcResponse narrow form to infer the ok value of result). */
// 方法 K 的业务返回值：穿透 RpcResponse 窄形式推断 result.ok 分支的 value 类型。
export type ResponseValue<K extends keyof RpcMethodMap> =
  Awaited<ReturnType<RpcMethodMap[K]>> extends RpcResponse<infer T> ? T : never
