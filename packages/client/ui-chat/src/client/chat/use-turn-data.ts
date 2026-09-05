/*
 * 【文件职责】订阅单个轮次位置存储中的声明合并键，向组件提供该键的当前业务值。
 */

import { useSyncExternalStore } from 'react'
import type {
  ConversationLocationDataSource, ConversationLocationDataStore, ConversationTurnDataMap,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

const EMPTY_SOURCE: ConversationLocationDataSource<undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

/**
 * Subscribe to one value from a Turn's keyed Location-data store.
 * @param data - current Turn data store, or absence for a Node outside a Turn.
 * @param key - declaration-merged business key.
 * @returns the current value for that key.
 */
export function useTurnDataValue<Key extends Extract<keyof ConversationTurnDataMap, string>>(
  data: ConversationLocationDataStore<ConversationTurnDataMap> | undefined,
  key: Key,
): Readonly<ConversationTurnDataMap[Key]> | undefined {
  const source = data?.source(key) ?? EMPTY_SOURCE
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}
