#!/usr/bin/env node
/**
 * Pack every published package into release tarballs, in publish order
 * (platform packages first, then the entries that optionally depend on
 * them), and write `publish-order.txt` next to them. `pnpm pack` produces
 * the EXACT bytes `pnpm publish` would upload and runs each package's
 * `prepack` gate, so a missing binary or unbuilt `lib/` refuses here.
 *
 * Usage: `node scripts/pack-release.mjs [dest] [--current-platform-only]`.
 * The flag packs only THIS host's platform package plus the entries — for
 * per-architecture CI legs, where the other architecture's binary does not
 * exist (the exact refusal its prepack gate exists for).
 */
/**
 * 文件职责：按发布顺序把 Landlock 平台包和入口包打成 npm tarball，并记录后续发布顺序。
 * 技术维度：使用 Node.js 同步文件 API、子进程 API，以及 npm/pnpm pack 生成与实际发布一致的压缩包。
 * 产品维度：在上传注册表前暴露缺少二进制、构建产物或可执行权限等发布问题。
 * 逻辑维度：解析目标目录和平台过滤参数，清空输出目录，逐包打包并核对产物，最后写入顺序文件。
 * 关键边界：平台包必须用 npm 保留可执行位；入口包用 pnpm 转换 workspace 依赖；已有目标目录会被清空。
 * 新手阅读建议：先看 dirs 如何确定打包顺序，再看平台包与入口包的命令差异，最后看产物存在性校验。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { entryDirs, platformDirs, readJson, root } from './repo.mjs';

// 去掉 node 和脚本路径后的命令行参数。
const args = process.argv.slice(2);
// 是否仅打包当前主机平台包，供按架构拆分的 CI 使用。
const currentPlatformOnly = args.includes('--current-platform-only');
// tarball 输出目录；未指定时使用子项目的 dist/npm。
const destination = path.resolve(args.find((arg) => !arg.startsWith('--')) || path.join(root, 'dist', 'npm'));

/**
 * 找出与当前操作系统和 CPU 架构匹配的平台包目录。
 * @returns {string[]} 当前主机可构建的平台包相对目录。
 * @example hostPlatformDirs();
 */
function hostPlatformDirs() {
  // 与 prebuilds.json platform 字段一致的“系统-架构”标识。
  const hostPlatform = `${process.platform}-${process.arch}`;
  return platformDirs().filter((dir) => readJson(path.join(root, dir, 'prebuilds.json')).platform === hostPlatform);
}

/**
 * 同步执行打包命令并把输出传给当前终端。
 * @param {string} command npm 或 pnpm 命令。
 * @param {string[]} args 命令参数。
 * @returns {void} 成功时无返回值，失败时终止流程。
 * @example run('npm', ['pack', './packages/example']);
 */
function run(command, args) {
  // 打包子进程的启动错误与退出状态。
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/**
 * 按 npm 命名规则计算某个包的 tarball 文件名。
 * @param {{name: string, version: string}} manifest 包清单中的名称和版本。
 * @returns {string} npm pack 应生成的 tgz 文件名。
 * @example tarballName({ name: '@scope/pkg', version: '1.0.0' });
 */
function tarballName(manifest) {
  if (manifest.name.startsWith('@')) {
    return `${manifest.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`;
  }
  return `${manifest.name}-${manifest.version}.tgz`;
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });

// 本次打包目录，始终保证平台包排在依赖它们的入口包之前。
const dirs = [...(currentPlatformOnly ? hostPlatformDirs() : platformDirs()), ...entryDirs()];
// 用于快速判断当前目录是否属于平台包的集合。
const platformSet = new Set(platformDirs());
// 成功生成的 tarball 名称，随后写入发布顺序文件。
const publishOrder = [];
for (const dir of dirs) {
  // 当前待打包包的 package.json 内容。
  const manifest = readJson(path.join(root, dir, 'package.json'));
  // Platform packages are packed with npm: pnpm pack (observed on 11.7.0)
  // normalizes file modes and STRIPS the executable bit, which ships a
  // launcher no consumer can spawn; npm pack preserves it. Platform packages
  // have no dependencies by construction, so they need none of pnpm's
  // workspace-protocol conversion — the entry packages do, and carry no
  // executables, so they keep pnpm pack.
  // 平台包用 npm 保留可执行位；入口包用 pnpm 解析 workspace 依赖。
  if (platformSet.has(dir)) {
    run('npm', ['pack', `./${dir}`, '--pack-destination', destination]);
  } else {
    run('pnpm', ['--dir', dir, 'pack', '--pack-destination', destination]);
  }

  // 按清单推导出的预期压缩包文件名。
  const tarball = tarballName(manifest);
  // 用于确认 pack 命令确实生成产物的绝对路径。
  const tarballPath = path.join(destination, tarball);
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`expected pack output not found: ${tarballPath}`);
  }
  publishOrder.push(tarball);
}

fs.writeFileSync(path.join(destination, 'publish-order.txt'), `${publishOrder.join('\n')}\n`);
console.log(`Packed ${publishOrder.length} packages into ${path.relative(root, destination)}`);
