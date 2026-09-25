/**
 * Deliverables plugin, browser half: registers the produced-files row into
 * the chat view's turn-tail chain, and provides the `chatFileMentions`
 * service that links inline-code mentions of produced or delivered files in the closing
 * prose. All policy lives here — the supported mutation calls, mention
 * matching, chip cap, and copy — so
 * composing this plugin out of cordis.yml removes both surfaces entirely;
 * the owning view renders an empty chain and inert prose at zero cost.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { PresentedOpenController } from './present-open.ts'
import { createDeliverablesPresentation, type DeliverablesPresentation } from './qs/presentation.ts'
import { PresentRow } from './PresentRow.tsx'
import { Deliverables } from './Deliverables.tsx'
import { en, NS, zh, type DeliverablesKey } from './locales.ts'
import {
  deliverablesDefinition, presentedForClosing, producedFileMentions, selectProducedFiles,
} from './turn-deliverables.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Produced-files row copy. */
    'deliverables': DeliverablesKey
  }
}

export { ProducedFiles, type ProducedFilesProps } from './ProducedFiles.tsx'
export { producedForClosing } from './turn-deliverables.ts'
export type { DeliverablesPresentation } from './qs/presentation.ts'
export type { DeliverablesInjected } from './Deliverables.tsx'
export type { PresentedPath } from './turn-deliverables.ts'
export type { PresentedAction, PresentedHost } from '../presented.ts'
export type { PresentedOpenPhase } from './present-open.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 奇术与官方共用交付投影和本机操作，不另建请求所有者。 */
    deliverablesPresentation: DeliverablesPresentation
  }
}

/** Required services for the tail-slot registration and its dictionaries. */
export const inject = ['slots', 'locale', 'uiConversation', 'remote', 'remote.session']

/**
 * Client plugin body: register the dictionaries and the turn-tail entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const opener = new PresentedOpenController()
  // 原插件仍负责控制器释放；切换呈现不丢失正在执行的打开状态。
  const presentation = createDeliverablesPresentation(opener)
  ctx.provide('deliverablesPresentation', presentation)
  ctx.effect(() => () => opener.dispose())
  ctx.on('connection/reset', () => { opener.resetHost() })
  ctx.uiConversation.events.register(deliverablesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deliverables: dictionaries')
  ctx.slots.inject(
    'conversation.chat.turnTail',
    () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: presentation.select,
      locale: NS,
      inject: () => presentation.injected,
    }, Deliverables),
  )
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'present', locale: NS }, PresentRow,
  ))
  // The prose side of the same vocabulary: the chat view reaches this face
  // via ctx.get, so its absence — this plugin composed out — is the off state.
  const t = ctx.locale.bind(NS)
  const mentions: ChatFileMentions = {
    forClosing(owner) {
      const paths = selectProducedFiles(owner)
      const presented = presentedForClosing(owner)
      if (paths === null && presented.length === 0) return undefined
      return producedFileMentions([...new Set([...paths ?? [], ...presented.map(file => file.path)])], owner.openFile,
        path => t('presented.previewButton', { name: path }))
    },
  }
  ctx.provide('chatFileMentions', mentions)
}
