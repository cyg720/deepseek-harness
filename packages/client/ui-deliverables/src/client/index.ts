/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-deliverables 包在浏览器侧的插件入口：把"产物"行注册进对话的回合尾链，
 *             并提供 chatFileMentions 服务让关闭消息中的内联代码提及可点击。
 * 【技术维度】Cordis 浏览器插件：conversationEvents.register 注册回合数据定义、
 *             slots.register 挂回合尾槽位、ctx.provide 提供服务；所有策略（从工具
 *             locations 推导、提及匹配、数量上限、文案）都集中在本包。
 * 【产品维度】用户可在对话中看到"本次回复产生的文件"，点击即可打开或定位到文件夹。
 * 【逻辑维度】1) 注册 deliverablesDefinition（回合内累积成功变更路径）；
 *             2) 注册 ProducedFiles 到回合尾链；3) 提供 chatFileMentions 服务。
 * 【关键边界】从插件组合中移除本包即可同时移除两个表面，宿主视图零成本退回空态。
 * 【新手阅读建议】先读 turn-deliverables.ts 的推导逻辑，再看本文件的注册接线。
 * ==========================================================================
 */
/**
 * Deliverables plugin, browser half: registers the produced-files row into
 * the chat view's turn-tail chain, and provides the `chatFileMentions`
 * service that links inline-code mentions of produced files in the closing
 * prose. All policy lives here — the supported mutation calls, mention
 * matching, chip cap, and copy — so
 * composing this plugin out of cordis.yml removes both surfaces entirely;
 * the owning view renders an empty chain and inert prose at zero cost.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ProducedFiles } from './ProducedFiles.tsx'
import { en, NS, zh, type DeliverablesKey } from './locales.ts'
import {
  deliverablesDefinition, producedFileMentions, selectProducedFiles,
} from './turn-deliverables.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Produced-files row copy. */
    'deliverables': DeliverablesKey
  }
}

export { ProducedFiles, type ProducedFilesProps } from './ProducedFiles.tsx'
export { producedForClosing } from './turn-deliverables.ts'

/** Required services for the tail-slot registration and its dictionaries. */
export const inject = ['slots', 'locale', 'uiConversation', 'connection', 'remote', 'remote.session']

/**
 * Client plugin body: register the dictionaries and the turn-tail entry.
 * @param ctx - client root context.
 */
// 浏览器侧入口：注册回合数据定义、字典、回合尾槽位，并提供文件提及服务。
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const workspacePathOpen = createSnapshotStore<boolean | undefined>(undefined)
  let requestedWorkspacePathOpen = false
  let capabilityRevision = 0
  let pendingCapability: Promise<void> | undefined
  const loadWorkspacePathOpen = (): void => {
    if (pendingCapability !== undefined) return
    const revision = capabilityRevision
    const pending = ctx.remote.session.canOpenWorkspacePath()
      .then((result) => {
        if (revision === capabilityRevision) workspacePathOpen.set(result.ok && result.value)
      }, () => {
        if (revision === capabilityRevision) workspacePathOpen.set(false)
      })
      .finally(() => {
        if (pendingCapability === pending) pendingCapability = undefined
      })
    pendingCapability = pending
  }
  const ensureWorkspacePathOpen = (): void => {
    requestedWorkspacePathOpen = true
    if (workspacePathOpen.getSnapshot() === undefined) loadWorkspacePathOpen()
  }
  ctx.on('connection/reset', () => {
    capabilityRevision++
    pendingCapability = undefined
    workspacePathOpen.set(undefined)
    if (requestedWorkspacePathOpen) loadWorkspacePathOpen()
  })
  ctx.uiConversation.events.register(deliverablesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deliverables: dictionaries')
  ctx.slots.inject(
    'conversation.chat.turnTail',
    () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: selectProducedFiles,
      locale: NS,
      inject: () => ({
        isLoopback: connection.isLoopback,
        ensureWorkspacePathOpen,
        hooks: { workspacePathOpen },
      }),
    }, ProducedFiles),
  )
  // The prose side of the same vocabulary: the chat view reaches this face
  // via ctx.get, so its absence — this plugin composed out — is the off state.
  const t = ctx.locale.bind(NS)
  const mentions: ChatFileMentions = {
    forClosing(owner) {
      // Same claim test the turn-tail chain entry runs: no produced files,
      // no vocabulary — the two surfaces agree by construction.
      const paths = selectProducedFiles(owner)
      if (paths === null) return undefined
      return producedFileMentions(paths, owner.openFile, path => t('produced.open', { name: path }))
    },
  }
  ctx.provide('chatFileMentions', mentions)
}
