/**
 * ================================ 文件注释 ================================
 * 【文件职责】提供统一的宿主剪贴板写入函数 writeClipboard：优先使用异步 Clipboard API，
 *             在不支持的环境（jsdom、非安全上下文）回退到 execCommand('copy')。
 * 【技术维度】async 函数 + 能力检测；回退路径用隐藏 textarea + select + execCommand；
 *             用 oxlint-disable 抑制 no-unnecessary-condition 与 no-deprecated 告警。
 * 【产品维度】Web UI 各处"复制"按钮共用此入口；成功与否的反馈由各控件自己渲染，
 *             本函数只报告宿主是否接受了写入。
 * 【逻辑维度】1) 能力检测 navigator.clipboard?.writeText；2) 异步写入并 try/catch；
 *             3) 回退：临时 textarea 选中后 execCommand('copy')，finally 移除元素。
 * 【关键边界】权限被拒/iframe 策略拦截时不谎报成功；execCommand 已废弃但刻意保留为
 *             唯一回退手段；返回布尔值而非抛错。
 * 【新手阅读建议】注意 try/catch/finally 的对称结构，以及两个 oxlint-disable 的位置。
 * ==========================================================================
 */
// Host clipboard write shared by Web UI copy controls. Success feedback stays
// with each control; this helper only reports whether the host accepted a write.
// 本文件提供 writeClipboard：宿主剪贴板写入的统一入口。成功与否的反馈由各控件自己处理，
// 这里只报告宿主是否接受了写入。

/**
 * Write text to the host clipboard, preferring the async Clipboard API and
 * falling back to `execCommand('copy')` on hosts (jsdom, insecure contexts)
 * that omit it.
 * @param text - the exact text to place on the clipboard.
 * @returns true only when the host accepted the write.
 */
/**
 * 把文本写入宿主剪贴板：优先异步 Clipboard API，缺失时（jsdom、非安全上下文）
 * 回退到 execCommand('copy')。
 * 使用示例：const ok = await writeClipboard('hello')；ok 为 false 时不显示"已复制"。
 * @param text - 要放入剪贴板的原文。
 * @returns 仅当宿主接受写入时为 true。
 */
export async function writeClipboard(text: string): Promise<boolean> {
  // lib.dom types clipboard non-optional, but insecure contexts omit it —
  // that runtime gap is exactly what this guard detects.
  // lib.dom 把 clipboard 声明为非可选，但非安全上下文里它确实可能缺失——此守卫检测的
  // 正是这个运行时差异。
  /* oxlint-disable-next-line typescript/no-unnecessary-condition */
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Denied permissions / iframe policy — do not claim success.
      // 权限被拒或 iframe 策略拦截：不谎报成功，返回 false。
      return false
    }
  }
  // jsdom and older hosts: best-effort execCommand path when present.
  // execCommand('copy') is the only clipboard fallback where the async API
  // is missing; deprecated but deliberately retained.
  // jsdom 与旧宿主：尽量走 execCommand 回退。它是异步 API 缺失时唯一的兜底方案，
  // 虽已废弃但刻意保留。
  /* oxlint-disable typescript/no-deprecated */
  const exec = typeof document.execCommand === 'function'
    ? document.execCommand.bind(document)
    : undefined
  if (exec === undefined) return false
  // 临时 textarea 方案：放到视口外、选中、execCommand('copy')，最后在 finally 里移除。
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  el.select()
  try {
    return exec('copy')
  } catch {
    return false
  } finally {
    el.remove()
  }
  /* oxlint-enable typescript/no-deprecated */
}
