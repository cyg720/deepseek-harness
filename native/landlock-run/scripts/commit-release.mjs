#!/usr/bin/env node
/**
 * Bump, stage, and commit a release in one command:
 * `pnpm release:commit <major|minor|patch|x.y.z>`. The namespaced tag stays
 * manual — create it from the merged release commit.
 */
/**
 * 文件职责：一次完成 landlock-run 版本提升、文件暂存和发布提交。
 * 技术维度：使用 Node.js ESM、spawnSync 和仓库辅助函数执行受控的 Git 与版本脚本命令。
 * 产品维度：减少原生沙箱发布时漏改版本或漏暂存锁文件的风险。
 * 逻辑维度：读取版本参数，执行 bump 脚本，读取新版本，暂存清单并创建提交，最后提示手工打标签。
 * 关键边界：必须提供合法版本参数；命令失败立即退出；标签故意不由脚本创建。
 * 新手阅读建议：先看 bump 的输入检查，再阅读 run 的失败传播，最后核对暂存文件和提交消息。
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageDirs, readJson, root } from './repo.mjs';

// 命令行中的版本提升参数；允许 major、minor、patch 或明确版本号，缺失时立即报错。
const bump = process.argv[2];

/** 执行发布子命令。@param command 可执行文件名。@param args 原样传递的参数数组。@returns 无返回值，失败时退出或抛错。@example run('git', ['status'])。 */
function run(command, args) {
  // 同步子进程结果；继承终端输出、固定仓库根目录并设置 CI 以禁用交互行为。
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!bump) {
  console.error('Usage: pnpm release:commit <major|minor|patch|x.y.z>');
  process.exit(1);
}

run('node', ['./scripts/bump-release.mjs', bump]);

// 版本提升后的首个原生包版本；所有 landlock-run 包应由 bump 脚本保持一致。
const version = readJson(path.join(root, packageDirs()[0], 'package.json')).version;
run('git', [
  'add',
  'package.json',
  'packages/*/package.json',
  '../../pnpm-lock.yaml',
]);
run('git', ['commit', '-m', `release(landlock-run): ${version}`]);

console.log(`Committed release ${version}. Create the tag manually: git tag landlock-run-v${version}`);
