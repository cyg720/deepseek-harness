/** Publication payload policy shared by static manifests and packed tarballs. */
/*
 * 文件职责：实现 publication-payload.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

/**
 * Whether a package manifest exports generated Host-for-Client metadata.
 * @param manifest - parsed package manifest to inspect.
 * @returns whether the canonical `./remote` export pair is present.
 */
/* 中文说明：函数 hasTypertRemoteNavigation 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function hasTypertRemoteNavigation(manifest: unknown): boolean {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  /** 中文说明：变量 exportsField 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const exportsField = (manifest as Record<string, unknown>).exports
  if (exportsField === null || typeof exportsField !== 'object' || Array.isArray(exportsField)) return false
  /** 中文说明：变量 remote 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const remote = (exportsField as Record<string, unknown>)['./remote']
  if (remote === null || typeof remote !== 'object' || Array.isArray(remote)) return false
  /** 中文说明：变量 entry 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entry = remote as Record<string, unknown>
  return entry.types === './lib/typert.remote-client.d.ts'
    && entry.default === './lib/typert.remote-client.js'
}

/** Normalize a package manifest path or npm tarball member to its payload-relative path. */
/* 中文说明：函数 payloadPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function payloadPath(file: string): string {
  /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normalized = file.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalized.startsWith('package/') ? normalized.slice('package/'.length) : normalized
}

/**
 * Whether a package payload path exposes source or map intermediates. Maps
 * serve editor navigation during development, where a workspace consumer
 * resolves their source through the package link; a published map resolves
 * nothing, so no payload publishes one.
 * @param file - manifest path or tarball member to classify.
 * @returns whether publishing this path is forbidden.
 */
/* 中文说明：函数 isForbiddenPublicationFile 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function isForbiddenPublicationFile(file: string): boolean {
  /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normalized = payloadPath(file)
  return normalized === 'src'
    || normalized.startsWith('src/')
    || normalized.endsWith('.d.ts.map')
    || normalized.endsWith('.js.map')
}

/**
 * Reject source and map members in a packed npm tarball.
 * @param files - tarball members to validate.
 * @param context - tarball identity named in the failure.
 */
/* 中文说明：函数 validateTarballPayload 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function validateTarballPayload(files: readonly string[], context: string): void {
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const file of files) {
    if (!isForbiddenPublicationFile(file)) continue
    /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const normalized = payloadPath(file)
    if (normalized === 'src' || normalized.startsWith('src/')) {
      throw new Error(`${context} publishes source file ${file}`)
    }
    throw new Error(`${context} publishes source map ${file}`)
  }
}
