/**
 * Names of external npm packages the worker replaces wholesale. Kept in a module
 * with no imports so both consumers can read it: the runtime builtin table
 * (`./builtins.ts`) and the build-time VFS image collector, which must leave
 * these packages out of the image entirely — the loader answers them from the
 * bundle before it ever reaches `node_modules`.
 */

/*
 * 【文件职责】集中列出 Worker 整体替换的外部包名，使运行时解析和 VFS 构建排除规则保持一致。
 */

export const REPLACED_EXTERNAL_PACKAGES: readonly string[] = [
  '@earendil-works/pi-ai',
  '@vscode/ripgrep',
  'fs-ext',
  'koffi',
  'node-pty',
  'sharp',
  'ws',
]
