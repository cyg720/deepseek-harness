/**
 * ================================ 文件注释 ================================
 * 【文件职责】Safari 专属的输入区 textarea 布局修复：识别 Safari 浏览器身份，并通过
 *             强制重排（+1px 再还原）修复过期的原生 textarea 布局与可能被污染的
 *             滚动容器自适应高度。
 * 【技术维度】纯函数 + 浏览器 UA 检测；用强制同步重排（offsetHeight 读取）触发布局刷新。
 * 【产品维度】Safari 下输入框高度与滚动容器在特定操作后可能错位，本修复让输入体验一致。
 * 【逻辑维度】1) 身份检测（vendor + Version/Safari 形态，排除 iOS 其它浏览器内核）；
 *             2) 布局修复（textarea 与滚动容器各做一次"+1px → 读 offsetHeight → 还原"）。
 * 【关键边界】只在 scrollHeight 超出 clientHeight 时干预；找不到滚动容器时跳过。
 * 【新手阅读建议】理解"读 offsetHeight 强制同步布局"这一技巧。
 * ==========================================================================
 */
/** Safari-specific textarea layout recovery for the conversation composer. */

/** Browser identity fields needed to distinguish Safari from other WebKit-based browsers. */
// 区分 Safari 与其它 WebKit 内核浏览器所需的浏览器身份字段。
export interface BrowserIdentity {
  readonly userAgent: string
  readonly vendor: string
}

// 排除 iOS 上其它内核浏览器（Chrome / Firefox / Edge / Opera / DuckDuckGo / Brave）的标记。
const ALTERNATE_IOS_BROWSER = /\b(?:CriOS|FxiOS|EdgiOS|OPiOS|OPT|DuckDuckGo|Brave)(?:\/|\b)/

/**
 * Detect Safari's `Version/... Safari/...` form while excluding known alternate iOS browser tokens.
 * @param identity - Browser user-agent and vendor values.
 * @returns Whether the identity should use the Safari-specific recovery.
 */
/**
 * 检测 Safari 的 `Version/... Safari/...` 形态，同时排除已知的 iOS 其它浏览器标记。
 * @param identity - 浏览器的 user-agent 与 vendor。
 * @returns 是否应使用 Safari 专属修复。
 */
export function isSafariBrowser(identity: BrowserIdentity): boolean {
  return identity.vendor === 'Apple Computer, Inc.'
    && /\bVersion\/[\d.]+.*\bSafari\/[\d.]+/.test(identity.userAgent)
    && !ALTERNATE_IOS_BROWSER.test(identity.userAgent)
}

/**
 * Repair Safari's stale native textarea layout and the scrollport auto height it can contaminate.
 * @param input - Composer textarea whose own scrollable overflow must stay zero.
 */
export function repairSafariTextareaLayout(input: HTMLTextAreaElement | null): void {
  if (input === null || input.scrollHeight <= input.clientHeight) return
  const scrollport = input.closest<HTMLElement>('[data-input-scroll]')
  if (scrollport === null) return

  const inputHeight = input.style.height
  input.style.height = `${String(input.clientHeight + 1)}px`
  void input.offsetHeight
  input.style.height = inputHeight
  void input.offsetHeight

  const scrollportHeight = scrollport.style.height
  scrollport.style.height = `${String(scrollport.clientHeight + 1)}px`
  void scrollport.offsetHeight
  scrollport.style.height = scrollportHeight
  void scrollport.offsetHeight
}
