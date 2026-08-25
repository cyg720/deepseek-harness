/*
 * ================================ 文件注释 ================================
 * 【文件职责】工作区路径的工具函数：把相对路径解析成 Host 侧拼写，
 *   以及把 POSIX home 缩写为展示用的 ~ 形式。
 * 【技术维度】纯字符串处理：兼容 Windows 盘符/UNC 路径与 POSIX 路径；
 *   openPath 用绝对拼写，Web 展示用缩写。
 * 【产品维度】用户在界面看到的工作区路径应简洁（~ 缩写）且不误导
 *   （Windows 路径不改写）；发送给 Host 的路径必须规范。
 * 【逻辑维度】resolveWorkspacePath 把相对路径拼到工作区根下；
 *   isWindowsStylePath 识别盘符/UNC；abbreviateHomePath 做 ~ 缩写。
 * 【关键边界】Windows 盘符/UNC 路径一律保持原样（含 home 本身是
 *   Windows 路径时）；home 缺失/为空/为根时不做缩写。
 * 【新手阅读建议】两个导出函数分别对应入站（发给 Host）与出站（展示）。
 * ==========================================================================
 */
/**
 * Resolve a workspace-relative path into the Host-facing spelling used by openPath.
 * @param cwd - session workspace root, when known.
 * @param path - absolute or workspace-relative path.
 * @returns an absolute path when a workspace root is available, otherwise the original path.
 */
/*
 * 把工作区相对路径解析为 openPath 使用的 Host 侧拼写。
 * @param cwd 会话工作区根路径（已知时）。
 * @param path 绝对路径或工作区相对路径。
 * @returns 有工作区根时返回绝对路径，否则返回原路径。
 */
export function resolveWorkspacePath(cwd: string | undefined, path: string): string {
  if (path.startsWith('/') || isWindowsStylePath(path)) return path
  if (cwd === undefined || cwd === '') return path
  const base = cwd.replace(/[/\\]+$/, '') // 去掉工作区根结尾的分隔符
  const rel = path.replace(/^[/\\]+/, '') // 去掉相对路径开头的分隔符
  return `${base}/${rel}`
}

/** Drive-letter or UNC path; Web display must not rewrite these as `~`. */
/* 盘符或 UNC 路径；Web 展示不得把它们改写成 ~。 */
function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
}

/**
 * Display-only POSIX home abbreviation. Windows drive and UNC paths stay
 * verbatim, including when `home` itself is a Windows path. A missing, empty,
 * or filesystem-root `home` leaves `path` unchanged so `/` cannot become `~`.
 * @param path - absolute or already-short display path.
 * @param home - host account home from `host.describe`; absent skips abbreviation.
 * @returns `~` or `~/…` for the POSIX home and its descendants, otherwise `path`.
 */
/*
 * 仅用于展示的 POSIX home 缩写。Windows 盘符与 UNC 路径保持原样，包括
 * home 本身是 Windows 路径时；home 缺失、为空或为文件系统根时不缩写，
 * 以免把 / 变成 ~。
 * @param path 绝对路径或已缩写的展示路径。
 * @param home 来自 host.describe 的 Host 账户 home；缺失则跳过缩写。
 * @returns POSIX home 及其后代返回 ~ 或 ~/…，其余返回原 path。
 */
export function abbreviateHomePath(path: string, home?: string): string {
  if (home === undefined || home === '') return path
  if (isWindowsStylePath(path) || isWindowsStylePath(home)) return path
  const root = home.replace(/\/+$/, '') // 去掉 home 结尾的斜杠便于前缀比较
  if (root === '' || root === '/') return path
  if (path.replace(/\/+$/, '') === root) return '~'
  if (path.startsWith(`${root}/`)) return `~${path.slice(root.length)}`
  return path
}
