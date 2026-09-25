import type { MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
/** Host-served local Markdown images use the existing authenticated file endpoint. */

/**
 * Resolve an absolute local image path on a Web page; the Host checks file policy.
 * @param protocol - Current page protocol.
 * @param origin - Current page origin.
 * @param path - Authored Markdown image destination.
 * @returns Same-origin file URL, or undefined for unsupported destinations.
 */
export function localImageUrl(protocol: string, origin: string, path: string): string | undefined {
  if (protocol !== 'http:' && protocol !== 'https:') return undefined
  if (!(path.startsWith('/') && !path.startsWith('//')) && !/^[a-z]:[\\/]/i.test(path)) return undefined
  return `${origin}/api/file?path=${encodeURIComponent(path)}`
}

/**
 * Detect message blocks that the text-only input presenter cannot display.
 * @param blocks - Persisted user, steering, or context content.
 * @returns Whether a visible limitation notice is needed.
 */
export function hasNonTextContent(blocks: readonly unknown[]): boolean {
  return blocks.some(block => typeof block !== 'object' || block === null || !('text' in block) || typeof block.text !== 'string')
}

/**
 * 提取持久图片引用；未知或残缺块仍由消息行显示限制提示。
 * @param blocks - 官方转写返回的原始内容块。
 * @returns 按原顺序排列的合法持久图片。
 */
export function historyImages(blocks: readonly unknown[]): MessageImageSource[] {
  return blocks.flatMap((block) => {
    if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== 'image' || !('attachment' in block)) return []
    const ref = block.attachment
    if (typeof ref !== 'object' || ref === null) return []
    const value = ref as Record<string, unknown>
    if (typeof value.attachmentId !== 'string' || value.attachmentId === '' || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(value.mediaType))) return []
    if (![value.bytes, value.width, value.height].every(size => typeof size === 'number' && Number.isFinite(size) && size >= 0)) return []
    if (value.name !== undefined && typeof value.name !== 'string') return []
    return [{ attachment: ref as Extract<MessageImageSource, { attachment: unknown }>['attachment'] }]
  })
}

/** 已有普通文件的可见元数据，不将存储标识解释为本机路径。 */
export interface HistoryFile { readonly name: string; readonly bytes: number }
/**
 * 读取单个持久文件块；残缺元数据留给消息行限制提示。
 * @param block - 原始消息内容块。
 * @returns 可展示的文件名和字节数，或 undefined。
 */
export function historyFile(block: unknown): HistoryFile | undefined {
  if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== 'file' || !('attachment' in block)) return undefined
  const ref = block.attachment
  if (typeof ref !== 'object' || ref === null) return undefined
  const value = ref as Record<string, unknown>
  if (typeof value.attachmentId !== 'string' || value.attachmentId === '' || typeof value.name !== 'string'
    || typeof value.bytes !== 'number' || !Number.isFinite(value.bytes) || value.bytes < 0) return undefined
  return { name: value.name, bytes: value.bytes }
}
