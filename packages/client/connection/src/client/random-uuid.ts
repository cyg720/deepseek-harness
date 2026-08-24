/** Browser-safe UUID generation for client-side wire correlation. */
/**
 * 文件职责：在浏览器端生成用于线协议关联的随机 UUID v4。
 * 技术维度：使用 Web Crypto 填充 16 字节，并按 RFC 4122 设置版本与变体位。
 * 产品维度：并发客户端请求可携带互不混淆的关联标识。
 * 逻辑维度：生成随机字节、调整固定比特、编码十六进制并插入连字符。
 * 关键边界：不要求安全上下文，但依赖浏览器提供 `crypto.getRandomValues`。
 * 新手阅读建议：先看 16 字节布局，再关注第 6、8 字节的位掩码。
 */

/**
 * Generate an RFC 4122 version 4 UUID without requiring a secure context.
 * @returns a UUID backed by `crypto.getRandomValues()`, which browsers expose on insecure origins.
 */
/**
 * 生成一个 RFC 4122 第 4 版 UUID。
 * @returns 形如 `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` 的随机字符串。
 * @example `const rpcId = randomUuid()`
 */
export function randomUuid(): string {
  /** 16 个随机字节；每个元素范围 0–255，随后原地写入版本和变体位。 */
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  /** 与 bytes 共享内存的字节视图，用于精确修改 UUID 固定位。 */
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x40)
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80)
  /** 32 位小写十六进制正文；每个字节固定编码成两位，尚未插入连字符。 */
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
