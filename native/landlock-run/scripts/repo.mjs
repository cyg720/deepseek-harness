#!/usr/bin/env node
/**
 * Shared helpers for the repo scripts: package discovery, the checked-in
 * prebuild matrix, and binary verification. The package matrix is explicit
 * metadata — `packages/<name>/prebuilds.json` marks a platform package and
 * declares its binaries; everything else under `packages/` is an entry
 * package. Scripts derive from these files and never guess.
 */
/**
 * 文件职责：为 Landlock 发布脚本提供包发现、JSON 读取和平台二进制校验等共享能力。
 * 技术维度：使用 ESM URL、Node.js 文件系统与路径 API，并读取 ELF 头部的 e_machine 字段核对架构。
 * 产品维度：让所有发布脚本从同一份显式元数据识别包，防止错包、漏包或跨架构二进制进入发行物。
 * 逻辑维度：确定子项目根目录，区分平台包和入口包，生成发布顺序，并逐项验证平台二进制。
 * 关键边界：平台包必须包含 prebuilds.json；仅支持 x64 与 arm64 ELF；异常会在首个不一致处抛出。
 * 新手阅读建议：先看 platformDirs 与 entryDirs 的分类规则，再看 packageDirs 顺序，最后阅读二进制校验流程。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Landlock 子项目根目录，供其他发布脚本复用。
export const root = fileURLToPath(new URL('..', import.meta.url));
// 包工作区目录，平台包和入口包都从这里发现。
const packagesRoot = path.join(root, 'packages');

/** ELF `e_machine` (offset 18, little-endian) per platform-package `cpu` value. */
/** CPU 名称到 ELF 头机器编号的固定对应关系。 */
const E_MACHINE = { x64: 62, arm64: 183 };
// CPU 名称到 ELF e_machine 数值的固定映射，用于识别二进制真实架构。

/**
 * 同步读取并解析 JSON 文件。
 * @param {string} file JSON 文件路径。
 * @returns {any} JSON 中保存的对象或值。
 * @example readJson(path.join(root, 'package.json'));
 */
export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Platform packages: every `packages/<name>` carrying a `prebuilds.json`. */
/**
 * 查找所有带 prebuilds.json 的平台包。
 * @returns {string[]} 排序后的平台包相对目录。
 * @example platformDirs();
 */
export function platformDirs() {
  return fs.readdirSync(packagesRoot)
    .filter((name) => fs.existsSync(path.join(packagesRoot, name, 'prebuilds.json')))
    .sort()
    .map((name) => path.join('packages', name));
}

/** Entry packages: every other `packages/<name>` with a `package.json`. */
/**
 * 查找没有 prebuilds.json、但带 package.json 的入口包。
 * @returns {string[]} 排序后的入口包相对目录。
 * @example entryDirs();
 */
export function entryDirs() {
  return fs.readdirSync(packagesRoot)
    .filter((name) => !fs.existsSync(path.join(packagesRoot, name, 'prebuilds.json')))
    .filter((name) => fs.existsSync(path.join(packagesRoot, name, 'package.json')))
    .sort()
    .map((name) => path.join('packages', name));
}

/** All published packages in publish order: platform packages before the entries that optionally depend on them. */
/**
 * 生成平台包在前、入口包在后的完整发布目录列表。
 * @returns {string[]} 可直接用于打包或发布的相对目录。
 * @example packageDirs();
 */
export function packageDirs() {
  return [...platformDirs(), ...entryDirs()];
}

/**
 * Verify one platform package's binaries against its `prebuilds.json`:
 * every declared binary exists, nothing undeclared sits in `bin/`, and each
 * file's ELF `e_machine` matches the package's declared `cpu`. Throws with
 * a remediation message on the first mismatch.
 */
/**
 * 根据清单和 prebuilds.json 验证一个平台包的二进制集合、权限和架构。
 * @param {string} packageDir 平台包目录，可以是绝对或当前进程可解析的路径。
 * @returns {{name: string, count: number}} 包名及已验证二进制数量。
 * @example verifyPlatformBinaries(path.join(root, 'packages/linux-x64'));
 */
export function verifyPlatformBinaries(packageDir) {
  // 平台包的 npm 清单，提供包名和目标 CPU。
  const manifest = readJson(path.join(packageDir, 'package.json'));
  // 预构建元数据，声明目标平台和应存在的二进制路径。
  const prebuilds = readJson(path.join(packageDir, 'prebuilds.json'));
  // 清单 cpu 数组中的唯一目标架构。
  const cpu = manifest.cpu?.[0];
  if (cpu === undefined || !(cpu in E_MACHINE)) {
    throw new Error(`${manifest.name}: unsupported or missing "cpu" in package.json (expected one of: ${Object.keys(E_MACHINE).join(', ')})`);
  }

  for (const binary of prebuilds.binaries) {
    // 当前声明二进制的完整文件路径。
    const file = path.join(packageDir, binary.path);
    if (!fs.existsSync(file)) {
      throw new Error(`${manifest.name}: missing ${binary.path} — run \`pnpm build:native\` on a ${prebuilds.platform} host (or assemble release artifacts) before packing.`);
    }
    try {
      fs.accessSync(file, fs.constants.X_OK);
    } catch {
      // Only reachable when the mode was mangled somewhere between build and
      // here (e.g. an archive step that normalized permissions) — the build
      // itself always produces 755.
      // 这里仅吞掉 accessSync 的具体异常，再抛出带修复建议的统一错误。
      throw new Error(`${manifest.name}: ${binary.path} is not executable — a pack/extract step stripped the mode bit.`);
    }
    // ELF 头偏移18处的机器架构编号，以小端无符号16位读取。
    const machine = fs.readFileSync(file).readUInt16LE(18);
    if (machine !== E_MACHINE[cpu]) {
      throw new Error(`${manifest.name}: ${binary.path} has ELF e_machine ${machine}, expected ${E_MACHINE[cpu]} for ${cpu} — the binary was built for a different architecture.`);
    }
  }

  // 元数据声明的二进制文件名集合，排序后便于稳定比较。
  const declared = prebuilds.binaries.map((binary) => path.basename(binary.path)).sort();
  // 平台包实际存放可执行文件的 bin 目录。
  const binDir = path.join(packageDir, 'bin');
  // bin 中真实存在的文件名；目录不存在时按空集合处理。
  const actual = fs.existsSync(binDir) ? fs.readdirSync(binDir).sort() : [];
  // 实际存在但未在 prebuilds.json 声明的多余文件。
  const extra = actual.filter((name) => !declared.includes(name));
  if (extra.length) {
    throw new Error(`${manifest.name}: bin/ contains files not declared in prebuilds.json: ${extra.join(', ')}`);
  }

  return { name: manifest.name, count: prebuilds.binaries.length };
}
