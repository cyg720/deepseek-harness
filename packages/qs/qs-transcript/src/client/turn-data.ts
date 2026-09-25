/** 行槽仅订阅当前轮次的单项数据，避免收尾更新时扫描整个转写。 */
import { useSyncExternalStore } from 'react'
import type { SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseChatNodeTurnData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationLocationDataSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from './contract.ts'

const empty: ConversationLocationDataSource<undefined> = { getSnapshot: () => undefined, subscribe: () => () => {} }
/**
 * 对应官方 Chat 行的数据 hook，只绑定框架传入的轮次来源。
 * @param _standard - 标准槽座位。
 * @param data - 当前行的官方轮次数据。
 * @returns 按业务键订阅的 React hook。
 */
export const turnDataFactory: SlotHookFactory<'qs.stage.transcript.row', UseChatNodeTurnData> = (_standard, data) => function useTurnData(key) {
  const source = data?.source(key) ?? empty
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}
