#!/usr/bin/env node
/**
 * Derive the GitHub Actions matrices from the checked-in package matrix
 * (`packages/<name>/prebuilds.json`). Single source: adding a platform
 * package extends CI and Release without editing a workflow.
 *
 *   node scripts/github-matrix.mjs ci                → one leg per distinct platform
 *   node scripts/github-matrix.mjs release-prebuild  → one leg per platform package
 */
/**
 * 中文说明：
 * - 文件职责：从原生平台包清单生成 GitHub Actions 的 CI 或发布矩阵 JSON。
 * - 技术维度：使用 Node.js ESM、文件路径工具、Set 去重和命令行标准输出。
 * - 产品维度：新增原生平台包后可自动进入构建与发布流程，减少工作流配置遗漏。
 * - 逻辑维度：读取平台清单，映射原生 Runner，再按目标生成去重 CI 矩阵或逐包发布矩阵。
 * - 关键边界：仅支持 RUNNERS 中明确登记的平台；未知目标或平台会立即失败。
 * - 新手阅读建议：先看 RUNNERS 对照表，再比较 ciMatrix 与 releasePrebuildMatrix 的粒度差异。
 */

import path from 'node:path';
import { platformDirs, readJson, root } from './repo.mjs';

/** GitHub runner per prebuilds.json `platform` value — native builders only, no cross toolchain. */
/** 中文：平台标识到 GitHub 原生构建机器的固定映射；不使用交叉编译工具链。 */
const RUNNERS = {
  'linux-x64': 'ubuntu-24.04',
  'linux-arm64': 'ubuntu-24.04-arm',
};

/** 中文：查询 platform 对应的 Runner；返回 Runner 名称，未配置时抛错。示例：runnerFor('linux-x64')。 */
function runnerFor(platform) {
  /** 当前平台对应的 Runner；空值表示维护者漏配了构建环境。 */
  const runner = RUNNERS[platform];
  if (!runner) {
    throw new Error(`missing GitHub runner for platform: ${platform}`);
  }
  return runner;
}

/** 中文：读取所有平台目录及其 prebuilds.json；返回目录名、包名和清单组成的数组。 */
function platformManifests() {
  return platformDirs().map((dir) => ({
    dir,
    name: path.basename(dir),
    prebuilds: readJson(path.join(root, dir, 'prebuilds.json')),
  }));
}

/** 中文：生成按平台去重的 CI include 矩阵；返回平台与 Runner 项列表。 */
function ciMatrix() {
  /** 清单中出现的唯一平台列表；排序保证工作流输出稳定。 */
  const platforms = [...new Set(platformManifests().map(({ prebuilds }) => prebuilds.platform))].sort();
  return {
    include: platforms.map((platform) => ({ platform, runner: runnerFor(platform) })),
  };
}

/** 中文：生成每个平台包一项的发布矩阵；返回包、目录、Runner 和产物名。 */
function releasePrebuildMatrix() {
  return {
    include: platformManifests().map(({ dir, name, prebuilds }) => ({
      platform: prebuilds.platform,
      package: name,
      dir,
      runner: runnerFor(prebuilds.platform),
      artifact: `prebuild-${name}`,
    })),
  };
}

/** 命令行选择的矩阵目标；只接受 ci 或 release-prebuild。 */
const target = process.argv[2];
/** 目标名到矩阵生成函数的查找表，用于统一校验和调用。 */
const matrices = {
  ci: ciMatrix,
  'release-prebuild': releasePrebuildMatrix,
};

if (!target || !matrices[target]) {
  console.error(`Usage: node scripts/github-matrix.mjs <${Object.keys(matrices).join('|')}>`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(matrices[target]()));
