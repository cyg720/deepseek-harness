#!/usr/bin/env node
/**
 * Release verification. Always: every published package carries one shared
 * version, and — when running from a tag or publishing — the
 * `landlock-run-vX.Y.Z` tag matches it. With `--prebuilds`: every platform package's declared
 * binaries exist with the right ELF architecture (run after
 * `assemble-prebuilds.mjs` or a local `build:native`).
 */
/*
 * 文件职责：验证 landlock-run 发布包版本一致、Git 标签匹配，并可选检查全部平台二进制架构。
 * 技术维度：使用 Node.js ESM、package.json 读取、Set 去重和共享 ELF 平台验证函数。
 * 产品维度：阻止版本不一致、错误标签或缺失/错架构原生制品进入发布流程。
 * 逻辑维度：verifyVersions 汇总包和版本并检查发布 ref；verifyPrebuilds 遍历平台包；--prebuilds 控制第二阶段。
 * 关键边界：发布模式必须从 landlock-run-v* 标签运行；所有 published 包只能有一个共同版本。
 * 新手阅读建议：先看 TAG_PREFIX，再读 verifyVersions 的三层检查，最后看可选 verifyPrebuilds。
 */

import path from 'node:path';
import { packageDirs, platformDirs, readJson, root, verifyPlatformBinaries } from './repo.mjs';

// GitHub Actions 发布标签引用的固定前缀。
const TAG_PREFIX = 'refs/tags/landlock-run-v';

/** 验证发布版本和标签。@returns 无，失败时抛错。@example verifyVersions()。 */
function verifyVersions() {
  // 每个发布包的目录与解析后清单。
  const packages = packageDirs().map((dir) => ({
    dir,
    manifest: readJson(path.join(root, dir, 'package.json')),
  }));
  // 全部发布包版本的去重集合，必须恰好一项。
  const versions = new Set(packages.map((pkg) => pkg.manifest.version));
  if (versions.size !== 1) {
    throw new Error([
      'published package versions must match:',
      ...packages.map((pkg) => `${pkg.dir}: ${pkg.manifest.version}`),
    ].join('\n'));
  }

  // 唯一共同版本。
  const version = packages[0].manifest.version;
  // 当前 GitHub ref，非 CI 环境为空字符串。
  const ref = process.env.GITHUB_REF || '';
  // 是否处于实际发布阶段。
  const publish = process.env.RELEASE_PUBLISH === 'true';
  if (publish && !ref.startsWith(TAG_PREFIX)) {
    throw new Error('publishing requires running the workflow from a landlock-run-v* tag');
  }
  if (ref.startsWith(TAG_PREFIX)) {
    // 从标签前缀后截取的版本文本。
    const tagVersion = ref.slice(TAG_PREFIX.length);
    if (tagVersion !== version) {
      throw new Error(`tag/version mismatch: tag landlock-run-v${tagVersion}, packages ${version}`);
    }
  }

  console.log(`Verified release version ${version}`);
}

/** 验证全部平台包预构建二进制。@returns 无，失败时抛错。@example verifyPrebuilds()。 */
function verifyPrebuilds() {
  // 当前平台包目录。
  for (const dir of platformDirs()) {
    // 已验证包名和二进制数量。
    const { name, count } = verifyPlatformBinaries(path.join(root, dir));
    console.log(`Verified ${name}: ${count} binaries`);
  }
}

verifyVersions();
if (process.argv.includes('--prebuilds')) {
  verifyPrebuilds();
}
