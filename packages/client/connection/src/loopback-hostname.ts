/**
 * Browser-safe, zero-dependency loopback classification shared by the `/api`
 * Host fence and the package's `ctx.connection` state. The predicate stays
 * package-internal; client plugins consume the derived state through Cordis.
 */
/*
 * 文件职责：提供浏览器安全、零依赖的回环主机名判断，供 API 宿主围栏和连接状态共享。
 * 技术维度：使用字符串精确比较、IPv4 分段和正则数值校验处理 WHATWG URL hostname。
 * 产品维度：只在真实本机地址启用本地连接能力，防止相似远端域名被误判为可信主机。
 * 逻辑维度：先接受 localhost 与带括号 IPv6 回环，再验证四段 IPv4 是否属于 127/8。
 * 关键边界：输入必须是规范化 URL hostname；裸 ::1 不在该格式内并会返回 false。
 * 新手阅读建议：先看两个快速返回值，再逐项拆解 parts 的长度、首段和每段范围条件。
 */

/**
 * Whether a normalized URL hostname names the local loopback authority.
 * @param hostname - WHATWG URL hostname (IPv6 literals retain brackets).
 * @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
 */
/*
 * 判断规范化 URL 主机名是否指向本机回环地址。
 * @param hostname - WHATWG URL 的 hostname；IPv6 字面量保留方括号。
 * @returns localhost、[::1] 或合法 127/8 IPv4 返回 true，其余返回 false。
 * @example isLoopbackHostname('127.8.9.10') 返回 true。
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  // parts：按点分割的 IPv4 文本段；只有恰好四段时才继续判断。
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    // part：当前 IPv4 文本段，必须是 1 至 3 位十进制数字且不大于 255。
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}
