#!/usr/bin/env node
/**
 * Prepack gate for platform packages: refuse to pack a tarball whose
 * declared binaries are missing or built for the wrong architecture.
 *
 * Without it, `pnpm pack` on a checkout that never ran
 * `pnpm run build:native` would ship an EMPTY platform package — the
 * binary's absence surfacing only at runtime as a failed probe on every
 * consumer — and a binary copied across packages would advertise an
 * architecture it cannot execute. The check is presence + ELF `e_machine`
 * against the package's declared `cpu`. `verify-packed-install.mjs`
 * separately pins the installed tarball bytes to the workspace build.
 *
 * Runs from each platform package's `prepack` hook (pnpm sets the script
 * cwd to the package directory). Also callable directly with an explicit
 * package directory: `node scripts/verify-launcher-binary.mjs packages/<name>`.
 */
/**
 * 文件职责：在打包平台包前验证启动器二进制存在且 ELF 架构与 package.json 的 cpu 声明一致。
 * 技术维度：使用 Node.js ESM、路径解析和共享 verifyPlatformBinaries 原生制品检查器。
 * 产品维度：阻止发布空平台包或架构错误的可执行文件，避免用户安装后才遇到启动失败。
 * 逻辑维度：解析可选包目录，执行二进制检查，成功打印包名和数量，失败输出诊断并返回 1。
 * 关键边界：prepack 默认以当前包目录运行；显式参数相对仓库根解析，实际字节一致性由另一安装验证脚本负责。
 * 新手阅读建议：先看 packageDir 的两种来源，再查看 verifyPlatformBinaries 返回值与 catch 的错误格式化。
 */

import path from 'node:path';
import { root, verifyPlatformBinaries } from './repo.mjs';

// 待验证平台包目录；显式参数相对仓库根解析，未传时采用 prepack 当前工作目录。
const packageDir = process.argv[2] ? path.resolve(root, process.argv[2]) : process.cwd();

try {
  // 已验证包名和二进制数量；函数失败会直接进入 catch。
  const { name, count } = verifyPlatformBinaries(packageDir);
  console.log(`verify-launcher-binary: ${name} — ${count} binaries present with the right ELF architecture.`);
} catch (error) {
  // 验证失败原因；Error 使用 message，其他未知拒绝值转成字符串后输出。
  console.error(`verify-launcher-binary: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
