#!/usr/bin/env node
/**
 * Assemble downloaded release artifacts into the platform packages and
 * verify the result. The Release workflow's build legs upload one
 * `prebuild-<package>` artifact per platform package (its `bin/` payload);
 * this script copies each into `packages/<package>/bin/` and then checks
 * every declared binary for presence and ELF architecture.
 *
 * Usage: `node scripts/assemble-prebuilds.mjs <artifact-root>`.
 */
/**
 * 中文说明：
 * - 文件职责：把发布工作流下载的原生二进制产物装配进各平台包并验证结果。
 * - 技术维度：使用 Node.js 同步文件系统 API、路径处理、可执行权限和 ELF 架构校验。
 * - 产品维度：确保发布的每个平台 npm 包都携带正确、可执行的 landlock-run 二进制。
 * - 逻辑维度：解析产物根目录，清空平台 bin，映射并复制每个产物，最后逐平台验证。
 * - 关键边界：会递归重建平台包 bin 目录；未知产物名、缺失目录或错误架构都会失败。
 * - 新手阅读建议：先看 artifactRoot/platforms 的来源，再沿清理、复制、verify 三个循环阅读。
 */

import fs from 'node:fs';
import path from 'node:path';
import { platformDirs, root, verifyPlatformBinaries } from './repo.mjs';

/** 发布产物根目录的绝对路径；未传参数时使用 .release/prebuild-artifacts。 */
const artifactRoot = path.resolve(process.argv[2] || '.release/prebuild-artifacts');

if (!fs.existsSync(artifactRoot)) {
  throw new Error(`prebuild artifact directory does not exist: ${artifactRoot}`);
}

/** 已登记的平台包短名称列表，用于创建目标目录和匹配产物名称。 */
const platforms = platformDirs().map((dir) => path.basename(dir));

/** 当前待初始化的平台包名称。 */
for (const name of platforms) {
  /** 当前平台包的二进制目标目录。 */
  const binDir = path.join(root, 'packages', name, 'bin');
  fs.rmSync(binDir, { recursive: true, force: true });
  fs.mkdirSync(binDir, { recursive: true });
}

/** 下载目录中的单个产物名称，应采用 prebuild-<平台包> 格式。 */
for (const artifactName of fs.readdirSync(artifactRoot)) {
  /** 当前产物的完整路径。 */
  const artifactDir = path.join(artifactRoot, artifactName);
  if (!fs.statSync(artifactDir).isDirectory()) continue;

  /** 与产物名称匹配的平台包；找不到时不能安全决定复制目标。 */
  const name = platforms.find((candidate) => artifactName === `prebuild-${candidate}`);
  if (!name) {
    throw new Error(`cannot map artifact to a platform package: ${artifactName}`);
  }

  /** 当前产物目录内要复制的单个文件名。 */
  for (const file of fs.readdirSync(artifactDir)) {
    /** 下载产物文件的源路径。 */
    const source = path.join(artifactDir, file);
    /** 平台包 bin 下的目标路径。 */
    const destination = path.join(root, 'packages', name, 'bin', file);
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, 0o755);
    console.log(`Copied ${path.relative(root, source)} -> ${path.relative(root, destination)}`);
  }
}

/** 当前接受最终完整性校验的平台包目录。 */
for (const dir of platformDirs()) {
  /** name 是已验证包名，count 是发现并通过检查的二进制数量。 */
  const { name, count } = verifyPlatformBinaries(path.join(root, dir));
  console.log(`Verified ${name}: ${count} binaries`);
}
