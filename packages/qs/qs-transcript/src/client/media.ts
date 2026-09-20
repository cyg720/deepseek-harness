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
