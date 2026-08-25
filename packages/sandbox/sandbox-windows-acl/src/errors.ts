/**
 * Fail-closed Win32 error type. Every backend API failure raises this with the
 * API name and the exact Win32 code; the original POC silently ignored every
 * failed call and would run children UNRESTRICTED (fail-open) — that is the
 * failure mode this class exists to prevent.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/errors
 */
/*
 * 文件职责：定义 Windows ACL 沙箱后端的失败关闭错误，完整保留失败 API 和 Win32 错误码。
 * 技术维度：扩展 JavaScript Error，并把 BOOL API 的 GetLastError 或 ACL 返回码保存为只读字段。
 * 产品维度：沙箱限制设置失败时明确中止，防止子进程在没有限制的情况下继续运行。
 * 逻辑维度：构造函数拼装诊断消息、设置错误名称，再保存 API 名、错误码和可选详情。
 * 关键边界：任何后端 API 失败都应抛出此错误；调用方不能吞掉错误后继续启动子进程。
 * 新手阅读建议：先理解“失败关闭”表示出错即停止，再沿 api 和 win32Code 查找调用点。
 */

/* Win32Error：表示某个 Windows 安全 API 失败，并携带可定位的系统错误信息。 */
export class Win32Error extends Error {
  /** The failing Win32 API name, e.g. `CreateRestrictedToken`. */
  /* api：失败的 Win32 API 名称，例如 CreateRestrictedToken。 */
  readonly api: string
  /** The Win32 error code (`GetLastError` for BOOL APIs, the HRESULT-style return for ACL APIs). */
  /* win32Code：BOOL API 的 GetLastError 或 ACL API 返回的 HRESULT 风格数值。 */
  readonly win32Code: number

  /**
   * 功能描述：构造一条失败关闭错误，并保存机器可读的 API 名与错误码。
   * 参数说明：api 是失败函数名；win32Code 是原始系统码；detail 是可选补充文本。
   * 返回值解释：构造函数返回新的 Win32Error 实例。
   * 使用示例：new Win32Error('CreateRestrictedToken', 5, 'access denied')。
   */
  constructor(api: string, win32Code: number, detail?: string) {
    super(`${api} failed (Win32 ${win32Code})${detail === undefined ? '' : `: ${detail}`}`)
    this.name = 'Win32Error'
    this.api = api
    this.win32Code = win32Code
  }
}
