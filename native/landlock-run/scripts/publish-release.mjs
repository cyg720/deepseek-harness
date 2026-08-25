#!/usr/bin/env node
/**
 * Publish the packed launcher family from the tarballs `pack-release.mjs`
 * produced, in `publish-order.txt` order.
 *
 * What goes out is decided per package against the registry, never from the
 * order file alone: a version the registry lacks is published, a version whose
 * published tarball has the same integrity is skipped, and a version whose
 * published tarball differs fails the run — that last case means the content
 * changed without a version bump. Skipping on identical integrity is what makes
 * re-running the publish step over the same artifact safe, which matters here
 * because a partial publication used to leave no way forward: republishing an
 * existing version fails permanently.
 *
 * Usage: `node scripts/publish-release.mjs [packed dir]`.
 */
/*
 * 文件职责：按照打包顺序把 Landlock 包发布到 npm，并安全处理重复执行和注册表短暂故障。
 * 技术维度：使用 npm CLI 查询与发布，使用 SHA-512 完整性值比对内容，并通过指数退避重试暂时性失败。
 * 产品维度：让部分发布后的重跑保持安全，同时阻止相同版本号对应不同内容的不可恢复发布错误。
 * 逻辑维度：读取顺序文件，解析每个 tarball 身份，查询注册表状态，比对完整性，再选择跳过、发布或报错。
 * 关键边界：已存在版本只有完整性完全相同才可跳过；非暂时错误不会重试；预发布版本使用 next 标签。
 * 新手阅读建议：先理解 registryState 的两种状态，再读主循环的三种分支，最后研究 publishTarball 的重试策略。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { root } from './repo.mjs';

/**
 * Registry codes that answer a write which did not settle, rather than a
 * rejection of what was sent. `E409 Failed to save packument` is the one this
 * sequence actually hits: publishing the platform packages and the entry back
 * to back can outrun the registry's own processing. A rejected payload (`E403`
 * over an existing version, a malformed manifest) never clears on a retry.
 */
/* 以下错误码表示注册表写入可能尚未稳定，适合先复查结果再有限重试。 */
const TRANSIENT_PUBLISH_CODES = ['E409', 'E429', 'E500', 'E502', 'E503', 'E504', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'];
// 上述错误码表示注册表写入可能尚未稳定，适合先复查再有限重试。

/** How many times one tarball's publish is attempted before the run fails. */
/* 单个 tarball 的最大发布尝试次数，限制持续故障下的等待时间。 */
const PUBLISH_ATTEMPTS = 4;
// 单个 tarball 最多尝试四次，避免注册表持续异常时无限等待。

/**
 * Shortest gap between two publishes, and the first retry backoff. The registry
 * needs a moment to commit a packument before the next write; back to back
 * publishes are what produce `E409`.
 */
/* 连续真实发布之间的最短间隔，同时也是指数退避的初始等待时间。 */
const PUBLISH_SPACING_MS = 2_000;
// 连续发布和首次重试之间至少间隔两秒，后续重试按倍数增长。

// 打包产物目录；未传路径时读取 dist/npm。
const destination = path.resolve(process.argv.slice(2).find((arg) => !arg.startsWith('--')) || path.join(root, 'dist', 'npm'));

/**
 * @param {string} output Combined npm output.
 * @returns {boolean} True when the registry reported a write it did not commit.
 */
function isTransientFailure(output) {
  return TRANSIENT_PUBLISH_CODES.some((code) => output.includes(`code ${code}`));
}

/**
 * @param {string} tarball Absolute tarball path.
 * @returns {string} The `sha512-<base64>` integrity npm records for it.
 */
function integrityOf(tarball) {
  return `sha512-${crypto.createHash('sha512').update(fs.readFileSync(tarball)).digest('base64')}`;
}

/**
 * @param {string} tarball Absolute tarball path.
 * @returns {{name: string, version: string}} What the packed manifest declares.
 */
function packedIdentity(tarball) {
  // 从压缩包标准位置读取 package.json 的 tar 命令结果。
  const result = spawnSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`cannot read the manifest inside ${tarball}:\n${result.stderr}`);
  // 压缩包内的包清单，用于提取注册表查询所需的名称和版本。
  const manifest = JSON.parse(result.stdout);
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`${tarball} manifest lacks name/version`);
  }
  return { name: manifest.name, version: manifest.version };
}

/**
 * Ask the registry whether a version exists, and with what integrity.
 * @param {string} name Package name.
 * @param {string} version Package version.
 * @returns {{kind: 'absent'} | {kind: 'present', integrity: string}} Registry state.
 */
function registryState(name, version) {
  // npm view 的同步结果；404 表示版本不存在，其他失败均需中止。
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json'], { encoding: 'utf8' });
  if (result.status !== 0) {
    // 合并标准输出和错误输出，兼容 npm 将错误信息写入任一通道的情况。
    const output = `${result.stdout}${result.stderr}`;
    if (output.includes('E404') || output.includes('404 Not Found')) return { kind: 'absent' };
    throw new Error(`npm view ${name}@${version} failed:\n${output}`);
  }
  // 注册表返回的完整性字符串，必须是非空 JSON 字符串。
  const parsed = JSON.parse(result.stdout);
  if (typeof parsed !== 'string' || parsed === '') {
    throw new Error(`registry reported no dist.integrity for ${name}@${version}`);
  }
  return { kind: 'present', integrity: parsed };
}

/**
 * Publish one tarball, retrying a registry write that did not settle.
 *
 * Every retry re-reads the registry first, because `E409` can answer a write
 * that landed anyway: republishing a version that now exists fails permanently,
 * so the same integrity appearing under the failed attempt counts as success.
 * @param {string} tarball Absolute tarball path.
 * @param {string} name Package name the tarball declares.
 * @param {string} version Package version the tarball declares.
 */
async function publishTarball(tarball, name, version) {
  // A prerelease version never takes the latest dist-tag.
  // 预发布版本使用 next 标签，避免覆盖普通用户安装时默认取得的 latest。
  const tagArgs = version.includes('-') ? ['--tag', 'next'] : [];
  for (let tries = 1; tries <= PUBLISH_ATTEMPTS; tries += 1) {
    // No --access: publishConfig.access in each manifest decides, and a
    // command-line flag would override it.
    // 发布结果保留为文本，便于识别暂时错误码和生成诊断信息。
    const result = spawnSync('npm', ['publish', tarball, ...tagArgs], { encoding: 'utf8' });
    // npm 的完整可读输出，兼容错误位于 stdout 或 stderr。
    const output = `${result.stdout}${result.stderr}`;
    if (result.status === 0) return;

    // 每次失败后重新查询的最终注册表状态，避免重复发布其实已落库的版本。
    const settled = registryState(name, version);
    if (settled.kind === 'present' && settled.integrity === integrityOf(tarball)) {
      console.log(`landlock publish: ${name}@${version} landed despite a reported failure, continuing`);
      return;
    }
    if (tries === PUBLISH_ATTEMPTS || !isTransientFailure(output)) {
      throw new Error(`npm publish ${name}@${version} failed:\n${output}`);
    }
    // 当前轮次的指数退避时间，首轮为基础间隔，之后逐次翻倍。
    const backoff = PUBLISH_SPACING_MS * 2 ** (tries - 1);
    console.log(
      `landlock publish: ${name}@${version} hit a transient registry failure`
      + ` (attempt ${tries} of ${PUBLISH_ATTEMPTS}), retrying in ${backoff}ms`,
    );
    await sleep(backoff);
  }
}

// publish-order.txt 中去除空行后的 tarball 文件名列表。
const order = fs
  .readFileSync(path.join(destination, 'publish-order.txt'), 'utf8')
  .split('\n')
  .filter((line) => line !== '');

// 本次实际成功发布的包数量。
let published = 0;
// 因注册表已有相同内容而安全跳过的包数量。
let skipped = 0;
for (const filename of order) {
  // 当前顺序项对应的 tarball 绝对路径。
  const tarball = path.join(destination, filename);
  // 从 tarball 本身读取的包名和版本，避免信任外部顺序文件中的推断信息。
  const { name, version } = packedIdentity(tarball);
  // 发布前查询到的注册表状态。
  const state = registryState(name, version);
  if (state.kind === 'present') {
    // 本地 tarball 的完整性值，用于证明已有版本内容一致。
    const local = integrityOf(tarball);
    if (state.integrity !== local) {
      throw new Error(
        `${name}@${version} is already published with different content`
        + `\n  registry: ${state.integrity}\n  packed:   ${local}`
        + '\nBump the version, or investigate why the build is not reproducible.',
      );
    }
    console.log(`landlock publish: ${name}@${version} already published, skipping`);
    skipped += 1;
    continue;
  }
  // Space out the writes: the gap belongs between publishes, so a run that only
  // skips does not wait at all.
  // 只在两次真实写入之间等待，全部跳过的重跑不会产生无意义延迟。
  if (published > 0) await sleep(PUBLISH_SPACING_MS);
  await publishTarball(tarball, name, version);
  console.log(`landlock publish: ${name}@${version} published`);
  published += 1;
}

console.log(`landlock publish: ${published} published, ${skipped} already present`);
