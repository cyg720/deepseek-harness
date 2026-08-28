/** Capture readable, path-stable workspace state for recorded-session tests.
 * @remarks 文件说明：文件职责：实现 test-support/session-snapshot 中 workspace 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * test-support/session-snapshot 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { readFile, readdir, readlink } from 'node:fs/promises'
import { join } from 'node:path'

/** Marker that lets Git retain an expected empty directory without becoming expected workspace state.
 * @remarks 中文说明：常量说明：EMPTY_WORKSPACE_MARKER 用于处理 EMPTY_WORKSPACE_MARKER
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const EMPTY_WORKSPACE_MARKER = '.empty'

/** One UTF-8 file in a captured workspace. */
export interface WorkspaceTextFileSnapshot {
  /** Cwd-relative POSIX path. */
  readonly path: string
  /** Entry discriminator. */
  readonly kind: 'text'
  /** Exact UTF-8 contents. */
  readonly content: string
}

/** One non-text file in a captured workspace. */
export interface WorkspaceBinaryFileSnapshot {
  /** Cwd-relative POSIX path. */
  readonly path: string
  /** Entry discriminator. */
  readonly kind: 'binary'
  /** Exact bytes encoded for deterministic diffs. */
  readonly base64: string
}

/** One symbolic link in a captured workspace. */
export interface WorkspaceSymlinkSnapshot {
  /** Cwd-relative POSIX path. */
  readonly path: string
  /** Entry discriminator. */
  readonly kind: 'symlink'
  /** Exact link text without resolving the target. */
  readonly target: string
}

/** One empty directory in a captured workspace. */
export interface WorkspaceEmptyDirectorySnapshot {
  /** Cwd-relative POSIX path. */
  readonly path: string
  /** Entry discriminator. */
  readonly kind: 'empty-directory'
}

/** Stable complete file, link, and empty-directory state below one workspace root. */
export type WorkspaceSnapshotEntry =
  | WorkspaceTextFileSnapshot
  | WorkspaceBinaryFileSnapshot
  | WorkspaceSymlinkSnapshot
  | WorkspaceEmptyDirectorySnapshot

/** Options for excluding harness-owned root entries from a runtime workspace. */
export interface CaptureWorkspaceSnapshotOptions {
  /** Exact immediate children of the workspace root to omit. */
  readonly ignoredRootEntries?: readonly string[]
}

/**
 * 功能说明：处理 textContent 相关流程；使用场景由所在模块及调用位置决定。
 * @param bytes （Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 textContent(bytes)，并按返回类型处理结果。
 */
function textContent(bytes: Buffer): string | undefined {
  if (bytes.includes(0)) return undefined
  /**
   * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const text = bytes.toString('utf8')
  return Buffer.from(text, 'utf8').equals(bytes) ? text : undefined
}

/**
 * Capture one workspace without resolving links or depending on host path separators.
 * @param root - Absolute directory whose user-visible state is captured.
 * @param options - Harness-owned immediate children to omit.
 * @returns Stable entries sorted by relative path.
 * @remarks 中文说明：功能说明：处理 captureWorkspaceSnapshot 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：root（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（CaptureWorkspaceSnapshotOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<WorkspaceSnapshotEntry[]>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 captureWorkspaceSnapshot(root,
 * options)，并按返回类型处理结果。
 */
export async function captureWorkspaceSnapshot(
  root: string,
  options: CaptureWorkspaceSnapshotOptions = {},
): Promise<WorkspaceSnapshotEntry[]> {
  /**
   * 常量说明：ignoredRootEntries 用于处理 ignoredRootEntries 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const ignoredRootEntries = new Set(options.ignoredRootEntries ?? [])

  /**
   * 常量说明：visit 用于处理 visit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 visit 相关流程；使用场景由所在模块及调用位置决定。
   * @param directory （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param segments （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<WorkspaceSnapshotEntry[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 visit(directory, segments)，并按返回类型处理结果。
   */
  const visit = async (directory: string, segments: readonly string[]): Promise<WorkspaceSnapshotEntry[]> => {
    /**
     * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
     */
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => segments.length > 0 || !ignoredRootEntries.has(entry.name))
      .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))
    /**
     * 常量说明：captured 用于处理 captured 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const captured: WorkspaceSnapshotEntry[] = []
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of entries) {
      /**
       * 常量说明：childSegments 用于处理 childSegments 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const childSegments = [...segments, entry.name]
      /**
       * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const path = childSegments.join('/')
      /**
       * 常量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        /**
         * 常量说明：children 用于处理 children 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const children = await visit(absolute, childSegments)
        captured.push(...children.length === 0 ? [{ path, kind: 'empty-directory' as const }] : children)
      } else if (entry.isFile()) {
        /**
         * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const bytes = await readFile(absolute)
        /**
         * 常量说明：content 用于处理 content 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const content = textContent(bytes)
        captured.push(content === undefined
          ? { path, kind: 'binary', base64: bytes.toString('base64') }
          : { path, kind: 'text', content })
      } else {
        captured.push({ path, kind: 'symlink', target: await readlink(absolute) })
      }
    }
    return captured
  }

  return visit(root, [])
}

/**
 * Capture a committed `workspace.expected/` tree, excluding its Git-only empty marker.
 * @param root - Absolute expected-workspace directory.
 * @returns Stable expected entries.
 * @remarks 中文说明：功能说明：处理 captureExpectedWorkspaceSnapshot 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：root（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<WorkspaceSnapshotEntry[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 captureExpectedWorkspaceSnapshot(root)，并按返回类型处理结果。
 */
export function captureExpectedWorkspaceSnapshot(root: string): Promise<WorkspaceSnapshotEntry[]> {
  return captureWorkspaceSnapshot(root, { ignoredRootEntries: [EMPTY_WORKSPACE_MARKER] })
}
