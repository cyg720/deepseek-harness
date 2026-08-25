#!/usr/bin/env node
/**
 * Bump the launcher workspace root and packages/* to one version, refresh the
 * repository lockfile, and verify. Usage: `pnpm release:bump <major|minor|patch|x.y.z>`.
 */
/*
 * 文件职责：统一提升 Landlock 启动器工作区及其发布包的版本，并刷新锁文件、执行发布校验。
 * 技术维度：使用 Node.js 文件系统、路径和同步子进程 API 修改 JSON 清单并调用 pnpm 与校验脚本。
 * 产品维度：保证同一发布批次中的平台包和入口包版本一致，降低漏改版本造成的安装失败风险。
 * 逻辑维度：解析版本参数，确认当前发布版本唯一，计算目标版本，逐个写回清单，最后更新锁文件并校验。
 * 关键边界：只接受 major、minor、patch 或合法语义化版本；任一包版本不一致或外部命令失败都会终止。
 * 新手阅读建议：先看 nextVersion 的版本计算，再看文件遍历写回，最后理解 run 如何传递命令失败状态。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageDirs, readJson, root } from './repo.mjs';

// 用户提供的版本提升方式或明确目标版本；缺失时脚本会输出用法并退出。
const bump = process.argv[2];
// 允许使用的三种相对版本提升类型，其他字符串必须是完整版本号。
const releaseTypes = new Set(['major', 'minor', 'patch']);
// 主仓库根目录，用于在正确位置刷新共享锁文件。
const repositoryRoot = path.resolve(root, '../..');

/**
 * 将对象以统一的两空格缩进 JSON 格式写入文件。
 * @param {string} file 目标 JSON 文件路径。
 * @param {unknown} value 要序列化的内容。
 * @returns {void} 写入完成后不返回值。
 * @example writeJson('/tmp/package.json', { version: '1.0.0' });
 */
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 同步执行发布流程命令，并把输出直接显示给调用者。
 * @param {string} command 可执行命令名称。
 * @param {string[]} args 命令参数列表。
 * @param {string} cwd 工作目录，默认是 Landlock 子项目根目录。
 * @returns {void} 成功时无返回值；启动或退出失败时抛错或结束进程。
 * @example run('node', ['./scripts/verify-release.mjs']);
 */
function run(command, args, cwd = root) {
  // 同步子进程结果，包含启动异常和退出状态。
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/**
 * 收集工作区根清单和所有发布包清单的相对路径。
 * @returns {string[]} 以根清单开头的 package.json 路径列表。
 * @example const files = packageFiles();
 */
function packageFiles() {
  return ['package.json', ...packageDirs().map((dir) => path.join(dir, 'package.json'))];
}

/**
 * 将不带预发布标记的 x.y.z 版本拆成三个数字。
 * @param {string} version 当前版本字符串。
 * @returns {number[]} 依次包含主版本、次版本和修订版本。
 * @example parseVersion('1.2.3');
 */
function parseVersion(version) {
  // 严格匹配三段非负整数，避免对预发布版本做含糊的相对提升。
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) {
    throw new Error(`increment types need a plain x.y.z current version (current: ${version}) — pass an explicit target version instead`);
  }
  return match.slice(1).map((part) => Number(part));
}

/** Explicit target versions accept full semver, prereleases included (test publishes). */
/* 明确目标版本可包含预发布段，主要用于正式发布前的测试发布。 */
const EXPLICIT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/**
 * 根据当前版本和提升请求计算目标版本。
 * @param {string} current 当前统一发布版本。
 * @param {string} release 提升类型或明确的目标版本。
 * @returns {string} 要写入全部清单的新版本。
 * @example nextVersion('1.2.3', 'minor');
 */
function nextVersion(current, release) {
  if (EXPLICIT_VERSION.test(release)) return release;

  if (!releaseTypes.has(release)) {
    throw new Error('Usage: pnpm release:bump <major|minor|patch|x.y.z>');
  }

  // 当前版本的三个数字分量，用于分别执行 major、minor、patch 提升。
  const [major, minor, patch] = parseVersion(current);
  if (release === 'major') return `${major + 1}.0.0`;
  if (release === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * 确认所有可发布包使用同一版本，并返回该版本。
 * @param {string[]} files 全部清单相对路径。
 * @returns {string} 平台包与入口包共同使用的当前版本。
 * @example currentPublishedVersion(packageFiles());
 */
function currentPublishedVersion(files) {
  // 去重后的发布包版本集合；集合必须恰好只有一个元素。
  const versions = new Set(
    files
      .filter((file) => file.startsWith('packages/'))
      .map((file) => readJson(path.join(root, file)).version),
  );
  if (versions.size !== 1) {
    throw new Error(`published package versions differ: ${[...versions].join(', ')}`);
  }
  return [...versions][0];
}

if (!bump) {
  console.error('Usage: pnpm release:bump <major|minor|patch|x.y.z>');
  process.exit(1);
}

// 本次需要同步修改的全部 package.json 路径。
const files = packageFiles();
// 根据当前统一版本和用户参数得到的最终版本号。
const targetVersion = nextVersion(currentPublishedVersion(files), bump);

for (const file of files) {
  // 当前清单的绝对路径，用于读取和覆写同一文件。
  const fullPath = path.join(root, file);
  // 当前清单对象；只修改其中的 version 字段。
  const json = readJson(fullPath);
  json.version = targetVersion;
  writeJson(fullPath, json);
  console.log(`${file}: ${targetVersion}`);
}

run('pnpm', ['install', '--ignore-scripts', '--lockfile-only'], repositoryRoot);
run('node', ['./scripts/verify-release.mjs']);

console.log(`Release version bumped to ${targetVersion}`);
