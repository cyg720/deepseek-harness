#!/usr/bin/env node
/**
 * Publish-path rehearsal without publishing: verify the packed tarballs are
 * exactly what a consumer install needs. `pnpm pack` already produced the
 * bytes `pnpm publish` would upload; this script checks the payload
 * (coverage, concrete dependency versions, NO lifecycle install scripts —
 * this family has no install fallback on purpose), unpacks the entry plus
 * THIS host's platform tarball into a throwaway consumer OUTSIDE the repo,
 * byte-pins the installed binary against the workspace build it was packed
 * from, and drives the INSTALLED entry under plain `node` — resolution,
 * probe, and a real confinement world-proof through the installed launcher.
 *
 * On non-Linux hosts (no platform package exists) it instead proves the
 * documented degradation: resolution falls back to a nonexistent path and
 * the probe reports `unusable`.
 *
 * Usage: `node scripts/verify-packed-install.mjs [tarball-dir] [--current-platform-only]`.
 * The flag skips the all-platforms tarball-presence check for
 * per-architecture CI legs. `NALR_REQUIRE_LANDLOCK=1` makes an unenforcing
 * kernel a failure instead of a skipped world-proof (set on CI, where the
 * kernel is known).
 */
/**
 * 文件职责：在不发布 npm 的前提下，按真实消费者安装路径验证 Landlock tarball 的内容、依赖和运行效果。
 * 技术维度：使用 tar 解包、临时 ESM 工程、哈希比对和同步子进程，并在 Linux 上执行真实 Landlock 隔离证明。
 * 产品维度：提前发现压缩包缺文件、依赖未转换、二进制被替换或安装后不可运行等发布级问题。
 * 逻辑维度：检查 tarball 与清单，建立临时安装目录，解包入口和当前平台包，比对字节，再运行生成的驱动脚本。
 * 关键边界：临时目录位于仓库外；Linux 必须存在匹配平台包；非 Linux 只验证明确的降级行为；CI 可强制要求隔离可用。
 * 新手阅读建议：先看清单和 tarball 校验，再看临时安装布局，最后阅读 driver 字符串中的运行时断言。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { entryDirs, packageDirs, platformDirs, readJson, root } from './repo.mjs';

// 脚本自身路径之后的命令行参数。
const args = process.argv.slice(2);
// 是否只要求当前平台相关的 tarball 存在。
const currentPlatformOnly = args.includes('--current-platform-only');
// 待验证 tarball 目录，默认与打包脚本输出位置一致。
const tarballDir = path.resolve(args.find((arg) => !arg.startsWith('--')) || path.join(root, 'dist', 'npm'));
// 需要作为消费者入口安装和执行的主包名称。
const entryPackageName = '@deepseek-ai/node-addon-landlock-run';

/**
 * 根据包名和版本计算 npm tarball 文件名。
 * @param {{name: string, version: string}} manifest 包清单。
 * @returns {string} 对应的 tgz 文件名。
 * @example tarballName({ name: '@scope/pkg', version: '1.0.0' });
 */
function tarballName(manifest) {
  if (manifest.name.startsWith('@')) {
    return `${manifest.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`;
  }
  return `${manifest.name}-${manifest.version}.tgz`;
}

/**
 * 取得清单对应的 tarball 绝对路径并确认文件存在。
 * @param {{name: string, version: string}} manifest 包清单。
 * @returns {string} 已确认存在的 tgz 路径。
 * @example tarballPath(entryManifest);
 */
function tarballPath(manifest) {
  // 由输出目录和标准文件名组成的预期产物路径。
  const tarball = path.join(tarballDir, tarballName(manifest));
  if (!fs.existsSync(tarball)) {
    throw new Error(`missing packed tarball: ${tarball}`);
  }
  return tarball;
}

/**
 * 同步运行命令并继承终端输出，适合解包和驱动执行。
 * @param {string} command 可执行命令。
 * @param {string[]} commandArgs 命令参数。
 * @param {{cwd?: string, env?: Record<string, string>}} options 可选工作目录和环境变量覆盖。
 * @returns {void} 成功时无返回值，失败时终止脚本。
 * @example run('tar', ['-xzf', archive, '-C', target]);
 */
function run(command, commandArgs, options = {}) {
  // 命令执行结果；输出直接继承，便于发布诊断。
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || root,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/**
 * 同步运行命令并返回标准输出文本。
 * @param {string} command 可执行命令。
 * @param {string[]} commandArgs 命令参数。
 * @returns {string} 命令成功时的 stdout。
 * @example runCapture('tar', ['-tf', archive]);
 */
function runCapture(command, commandArgs) {
  // 带大缓冲区的捕获结果，用于读取 tarball 内的清单。
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

/**
 * 从某个 tarball 中读取实际打包后的 package.json。
 * @param {{name: string, version: string}} manifest 源工作区包清单。
 * @returns {any} 压缩包内解析出的包清单对象。
 * @example readPackedManifest(entryManifest);
 */
function readPackedManifest(manifest) {
  return JSON.parse(runCapture('tar', ['-xOf', tarballPath(manifest), 'package/package.json']));
}

/**
 * 检查打包清单不含安装生命周期脚本或 workspace 协议版本。
 * @param {any} packed tarball 内的 package.json 对象。
 * @returns {void} 合法时无返回值，不合法时抛出错误。
 * @example verifyPackedManifest(readPackedManifest(entryManifest));
 */
function verifyPackedManifest(packed) {
  // 发布包明确禁止携带的安装阶段脚本名称。
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare'];
  for (const script of lifecycle) {
    if (packed.scripts?.[script]) {
      throw new Error(`${packed.name}: packed manifest carries a "${script}" lifecycle script — this family has no install fallback`);
    }
  }
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(packed[field] ?? {})) {
      if (version.includes('workspace:')) {
        throw new Error(`${packed.name}: packed ${field} still uses the workspace protocol: ${name}@${version}`);
      }
    }
  }
}

/**
 * 计算文件的 SHA-256 十六进制摘要。
 * @param {string} file 文件路径。
 * @returns {string} 用于字节一致性比对的摘要。
 * @example sha256('/tmp/binary');
 */
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * 计算包在临时消费者 node_modules 下的安装目录。
 * @param {string} packageName 可带作用域的 npm 包名。
 * @returns {string} 对应的绝对安装路径。
 * @example packageInstallDir('@scope/pkg');
 */
function packageInstallDir(packageName) {
  return path.join(tempRoot, 'node_modules', ...packageName.split('/'));
}

/**
 * 把一个 tarball 解包并移动到模拟消费者的 node_modules 目录。
 * @param {{name: string, version: string}} manifest 要安装的包清单。
 * @returns {void} 安装完成后不返回值。
 * @example unpackTarball(entryManifest);
 */
function unpackTarball(manifest) {
  // 每次解包使用的独立临时目录，避免不同包互相覆盖。
  const extractRoot = fs.mkdtempSync(path.join(tempRoot, 'extract-'));
  run('tar', ['-xzf', tarballPath(manifest), '-C', extractRoot]);

  // npm tarball 解开后固定出现的 package 源目录。
  const source = path.join(extractRoot, 'package');
  // 当前包在模拟 node_modules 中的最终安装位置。
  const destination = packageInstallDir(manifest.name);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(source, destination);
  fs.rmSync(extractRoot, { recursive: true, force: true });
  console.log(`Unpacked ${manifest.name} -> ${path.relative(tempRoot, destination)}`);
}

// 全部发布包的目录及源清单，顺序与真实发布顺序一致。
const manifests = packageDirs().map((dir) => ({ dir, manifest: readJson(path.join(root, dir, 'package.json')) }));
// 主入口包的源清单；缺失说明包矩阵配置不完整。
const entryManifest = manifests.find(({ manifest }) => manifest.name === entryPackageName)?.manifest;
if (!entryManifest) throw new Error(`missing source manifest for ${entryPackageName}`);

// 当前主机的“操作系统-架构”标识。
const hostPlatform = `${process.platform}-${process.arch}`;
// 与当前主机匹配的平台包记录；非 Linux 平台通常不存在。
const currentPlatformEntry = manifests.find(
  ({ dir, manifest }) => platformDirs().includes(dir) && manifest.name === `${entryPackageName}-${hostPlatform}`,
);

// Payload checks: every expected tarball exists (full mode), the packed
// entry's optional-dependency set names exactly the platform packages, and
// no packed manifest carries workspace versions or install lifecycle.
// 当前验证模式下必须存在的 tarball 集合。
const expectedTarballs = currentPlatformOnly
  ? manifests.filter(({ dir }) => entryDirs().includes(dir) || dir === currentPlatformEntry?.dir)
  : manifests;
for (const { manifest } of expectedTarballs) {
  tarballPath(manifest);
}

// 从 tarball 读取的入口包清单，用于验证发布后的真实依赖字段。
const packedEntry = readPackedManifest(entryManifest);
// 包矩阵中全部平台包名称，排序后用于精确集合比较。
const platformPackageNames = manifests
  .filter(({ dir }) => platformDirs().includes(dir))
  .map(({ manifest }) => manifest.name)
  .sort();
// 入口 tarball 实际声明的可选依赖名称。
const optionalNames = Object.keys(packedEntry.optionalDependencies || {}).sort();
if (optionalNames.join('\n') !== platformPackageNames.join('\n')) {
  throw new Error(`packed entry optionalDependencies mismatch\nactual:\n${optionalNames.join('\n')}\nexpected:\n${platformPackageNames.join('\n')}`);
}
for (const { manifest } of expectedTarballs) {
  verifyPackedManifest(readPackedManifest(manifest));
}

// Throwaway ESM consumer, built from local tarballs only — no registry.
// 仓库外的新临时 ESM 消费者根目录，不会受工作区解析影响。
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nalr-packed-install-'));
fs.writeFileSync(
  path.join(tempRoot, 'package.json'),
  `${JSON.stringify({ name: 'nalr-packed-install-check', version: '0.0.0', private: true, type: 'module' }, null, 2)}\n`,
);
console.log(`Verifying packed install in ${tempRoot}`);

unpackTarball(entryManifest);
if (currentPlatformEntry) {
  unpackTarball(currentPlatformEntry.manifest);

  // Byte-pin: the installed binary must be the workspace build it was packed
  // from — any divergence means the tarball did not carry the built bytes.
  // 当前平台包的预构建清单，列出需要逐字节比对的文件。
  const prebuilds = readJson(path.join(root, currentPlatformEntry.dir, 'prebuilds.json'));
  for (const binary of prebuilds.binaries) {
    // 工作区构建产生的原始二进制路径。
    const workspaceFile = path.join(root, currentPlatformEntry.dir, binary.path);
    // tarball 解包后安装到消费者目录中的二进制路径。
    const installedFile = path.join(packageInstallDir(currentPlatformEntry.manifest.name), binary.path);
    if (sha256(workspaceFile) !== sha256(installedFile)) {
      throw new Error(`installed ${binary.path} differs from the workspace build it was packed from`);
    }
    console.log(`Byte-pinned ${binary.path} against the workspace build`);
  }
} else if (process.platform === 'linux') {
  throw new Error(`linux host without a platform package in the matrix: ${hostPlatform}`);
}

// Drive the INSTALLED entry under plain node: resolution, probe, and (on an
// enforcing kernel) a real confinement world-proof through the installed
// launcher.
// 将写入临时消费者并由普通 node 执行的验证驱动脚本路径。
const driver = path.join(tempRoot, 'driver.mjs');
fs.writeFileSync(driver, `
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { grantArgs, launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run';

const requireLandlock = process.env.NALR_REQUIRE_LANDLOCK === '1';
const platformPackage = '@deepseek-ai/node-addon-landlock-run-' + process.platform + '-' + process.arch;
const resolved = launcherPath();
assert.ok(path.isAbsolute(resolved), 'launcherPath must be absolute');
assert.ok(resolved.includes(path.join(...platformPackage.split('/'))), 'launcherPath must point into the platform package: ' + resolved);

if (process.platform === 'linux') {
  assert.ok(fs.existsSync(resolved), 'installed launcher missing at ' + resolved);
  try {
    fs.accessSync(resolved, fs.constants.X_OK);
  } catch {
    throw new Error('installed launcher is not executable — the pack path stripped the mode bit: ' + resolved);
  }
  const enforcement = probe(resolved);
  console.log('probe through the installed launcher: ' + enforcement);
  if (enforcement === 'unusable') {
    if (requireLandlock) throw new Error('NALR_REQUIRE_LANDLOCK=1 but the probe reports unusable');
    console.log('kernel does not enforce Landlock — skipping the confinement world-proof');
  } else {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nalr-confine-'));
    const denied = path.join(work, 'denied.txt');
    const deniedRun = spawnSync(resolved, [...grantArgs({ readOnly: ['/'] }), '--', '/bin/sh', '-c', 'echo x > ' + denied], { encoding: 'utf8' });
    assert.notEqual(deniedRun.status, 0, 'write outside the grants must fail');
    assert.ok(!fs.existsSync(denied), 'denied write must not land on disk');
    const granted = path.join(work, 'granted.txt');
    const grantedRun = spawnSync(resolved, [...grantArgs({ readOnly: ['/'], readWrite: [work] }), '--', '/bin/sh', '-c', 'echo ok > ' + granted], { encoding: 'utf8' });
    assert.equal(grantedRun.status, 0, 'granted write must succeed: ' + grantedRun.stderr);
    assert.equal(fs.readFileSync(granted, 'utf8').trim(), 'ok');
    console.log('confinement world-proof passed through the installed launcher');
  }
} else {
  assert.ok(!fs.existsSync(resolved), 'no platform package exists for this host — the fallback path must not exist');
  assert.equal(probe(resolved), 'unusable');
  console.log('non-linux host: fallback resolution and unusable probe verified');
}
`);
run(process.execPath, [driver], { cwd: tempRoot });

console.log('Packed install verification passed.');
